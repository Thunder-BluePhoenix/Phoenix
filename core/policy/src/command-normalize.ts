// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * Normalisation of shell command text for matching user-created DENY rules.
 *
 * This is best-effort and NOT a sandbox. A deny rule written as the prefix `rm -rf *` is only a
 * string match; a shell can spell the same command in unboundedly many ways (variables, globbing,
 * `eval`, encodings, scripts that run the command for you). What this module does is remove the
 * cheap, common spellings so a deny rule is not trivially bypassed: extra whitespace, a chain such
 * as `ls; rm -rf /`, a wrapper (`sudo`, `env`, ...), leading `VAR=value` assignments, an absolute
 * path or backslash on the command word, and the order of single-letter flags (`rm -fr`).
 * Anything that matters for safety must be refused by an allow-list or a real sandbox instead.
 *
 * The same canonical form is applied to the rule's own pattern, so `rm -rf *` and `rm -fr /` meet.
 */

/** Characters that start a new command: `; && || | & newline`, backtick and subshell/group boundaries. */
const SEPARATORS = /;|&|\||\n|\r|`|\$\(|<\(|>\(|\(|\)|\{|\}/;
const QUOTES = /["']/;

/** Wrappers that run their arguments as a command, with the options that consume a value. */
const WRAPPERS: Readonly<Record<string, readonly string[]>> = {
  sudo: ["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U"],
  doas: ["-u", "-C"],
  env: ["-u", "-C"],
  command: [],
  builtin: [],
  nohup: [],
  time: ["-f", "-o"],
  exec: ["-a"],
  nice: ["-n"],
};

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHORT_FLAGS = /^-[A-Za-z]+$/;

/** The command word without quotes, backslashes or a directory prefix (`"/bin/rm"`, `\rm` -> `rm`). */
function commandWord(token: string): string {
  const bare = token.replace(/[\\'"]/g, "");
  const slash = bare.lastIndexOf("/");
  return slash >= 0 && slash < bare.length - 1 ? bare.slice(slash + 1) : bare;
}

/** Drops the value tokens of a `VAR="a b"` assignment whose quote spans several tokens. */
function skipAssignment(tokens: string[]): void {
  const value = (tokens.shift() ?? "").replace(ENV_ASSIGNMENT, "");
  const quote = value[0];
  if (quote !== '"' && quote !== "'") return;
  let closed = value.length > 1 && value.endsWith(quote);
  while (!closed && tokens.length > 0) closed = (tokens.shift() ?? "").endsWith(quote);
}

/** Merges runs of single-dash letter flags into one sorted cluster: `-r -f` and `-fr` become `-fr`. */
function mergeFlags(tokens: string[]): string[] {
  const out: string[] = [];
  let letters = new Set<string>();
  const flush = (): void => {
    if (letters.size > 0) out.push(`-${[...letters].sort().join("")}`);
    letters = new Set();
  };
  for (const token of tokens) {
    if (SHORT_FLAGS.test(token)) for (const letter of token.slice(1)) letters.add(letter);
    else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out;
}

/** Canonical form of ONE simple command (no chaining): see the module comment. */
export function normalizeSegment(segment: string): string {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 0) {
    const head = tokens[0]!;
    if (ENV_ASSIGNMENT.test(head)) {
      skipAssignment(tokens);
      continue;
    }
    const wrapper = commandWord(head);
    const valueOptions = Object.hasOwn(WRAPPERS, wrapper) ? WRAPPERS[wrapper] : undefined;
    if (valueOptions === undefined) break;
    tokens.shift();
    while (tokens.length > 0 && tokens[0]!.startsWith("-")) {
      const option = tokens.shift()!;
      if (option === "--") break;
      if (valueOptions.includes(option)) tokens.shift();
    }
  }
  if (tokens.length === 0) return "";
  tokens[0] = commandWord(tokens[0]!);
  return mergeFlags(tokens).join(" ");
}

/** Every simple command inside `raw`, each normalised; includes the whole text as one segment. */
function segmentsOf(raw: string): string[] {
  const out = new Set<string>();
  out.add(normalizeSegment(raw));
  for (const segment of raw.split(SEPARATORS)) {
    out.add(normalizeSegment(segment));
    // `bash -c "rm -rf /"`: what sits between quotes is a command of its own.
    if (QUOTES.test(segment))
      for (const part of segment.split(QUOTES)) out.add(normalizeSegment(part));
  }
  out.delete("");
  return [...out];
}

/**
 * Texts a deny rule's `resource` is tried against: the raw command, then the normalised whole and
 * every normalised segment of a chained or nested command.
 */
export function commandCandidates(raw: string): string[] {
  return [...new Set([raw, raw.trim(), ...segmentsOf(raw)])];
}

/** The rule's own `resource` in the same canonical form, keeping a trailing `*` (prefix match). */
export function normalizeResourcePattern(pattern: string): string {
  if (!pattern.endsWith("*")) return normalizeSegment(pattern);
  const prefix = pattern.slice(0, -1);
  const body = normalizeSegment(prefix);
  return body === "" ? "*" : `${body}${/\s$/.test(prefix) ? " " : ""}*`;
}
