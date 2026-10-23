// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 79 secret guard, the pure half: finds secrets in a tool call's input or in a staged git diff
// and reports WHAT KIND and WHERE, never the secret. The detector is Phoenix's own
// (protocol/src/secrets.ts `SECRET_VALUE_PATTERNS`) plus one guard-only kind, `secret_assignment`
// (a secret-named key such as API_KEY= or "password": followed by a plausible value). It is a
// heuristic: it finds what it recognises and claims nothing more.
//
// Nothing here ever returns, logs or throws a matched value: findings carry a kind and a location
// that was itself passed through the detector, so even a file name that looks like a token is masked.
import { createHash } from "node:crypto";
import { SECRET_VALUE_PATTERNS, findSecrets } from "@phoenix/protocol";
import { isRecord } from "../guards";

/**
 * One name per entry of SECRET_VALUE_PATTERNS, in the same order (a test fails when the lists
 * differ in length, so a new protocol pattern cannot go unnamed), then the guard-only kind.
 */
export const GUARD_KINDS = [
  "bearer_token",
  "github_token",
  "api_key",
  "slack_token",
  "aws_access_key",
  "private_key",
  "stripe_key",
  "gitlab_token",
  "npm_token",
  "jwt",
  "secret_assignment",
] as const;
export type GuardKind = (typeof GUARD_KINDS)[number];

export const isGuardKind = (value: unknown): value is GuardKind =>
  typeof value === "string" && (GUARD_KINDS as readonly string[]).includes(value);

/** Pattern kinds in SECRET_VALUE_PATTERNS order. */
const PATTERN_KINDS: readonly GuardKind[] = GUARD_KINDS.slice(0, SECRET_VALUE_PATTERNS.length);

/** Characters of text looked at per scan; more is cut and the result says so. */
export const MAX_SCAN_CHARS = 1_000_000;
export const MAX_FINDINGS = 20;
export const MAX_LOCATION = 200;
/** Tool-input fields that hold what is being REPLACED: removing a secret must not be blocked. */
const OLD_TEXT_KEYS: Readonly<Record<string, true>> = {
  old_string: true,
  old_str: true,
  old_source: true,
  old_text: true,
};

export interface GuardFinding {
  kind: GuardKind;
  /** For example `tool_input.command line 2` or `staged diff: src/a.ts line 14`. Never a value. */
  location: string;
}

const ASSIGNMENT =
  /(?:^|[\s,{(\[;&|"'])([A-Za-z_][\w.-]{0,63})["']?\s*[:=]\s*(?:"([^"\n]{16,200})"|'([^'\n]{16,200})'|([^\s"'<>,;)\]}]{16,200}))/g;
const SECRET_KEY_SUFFIX =
  /(?:^|[_.-])(?:password|passwd|secret|token|api[_-]?key|apikey|private[_-]?key|credentials?|auth(?:orization)?)$/i;
const PLACEHOLDER = /example|placeholder|changeme|your[_-]|xxxx|\*{3}|redacted|dummy|sample/i;

/** A value that could be a credential: no code or markup characters, letters and digits, some variety. */
function plausibleValue(value: string): boolean {
  if (value.length < 16 || /[\s(){}<>*$`\\]/.test(value)) return false;
  if (/^(?:[./~]|https?:)/i.test(value) || PLACEHOLDER.test(value)) return false;
  if (!/\d/.test(value) || !/[A-Za-z]/.test(value)) return false;
  return new Set(value).size >= 8;
}

/** Kinds found on one line, in pattern order, at most one per kind. */
function kindsOfLine(line: string): GuardKind[] {
  const found: GuardKind[] = [];
  SECRET_VALUE_PATTERNS.forEach((re, i) => {
    if (re.test(line)) found.push(PATTERN_KINDS[i]!);
  });
  for (const m of line.matchAll(ASSIGNMENT)) {
    const key = m[1]!.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    if (SECRET_KEY_SUFFIX.test(key) && plausibleValue(value)) {
      found.push("secret_assignment");
      break;
    }
  }
  return found;
}

/** Control, format (bidi, zero-width) and separator characters: Core refuses them in an approval card. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * A location safe to say out loud: control characters flattened, anything the detector would flag
 * replaced, cut to MAX_LOCATION. A path that looks like a token is not repeated.
 */
export function safeLocation(raw: string): string {
  const flat = raw.replace(HIDDEN, " ").replace(/ {2,}/g, " ").trim();
  const masked = kindsOfLine(flat).length > 0 ? "[hidden: looks like a secret]" : flat;
  return masked.length > MAX_LOCATION ? `${masked.slice(0, MAX_LOCATION - 1)}…` : masked;
}

/** Appends a finding unless the same kind and place is already there or the cap is reached. */
function add(into: GuardFinding[], kind: GuardKind, location: string): void {
  if (into.length >= MAX_FINDINGS) return;
  if (into.some((f) => f.kind === kind && f.location === location)) return;
  into.push({ kind, location });
}

/** Findings in `text`; `label` names where the text came from, a line number is added for multi-line text. */
export function scanText(text: string, label: string): GuardFinding[] {
  const out: GuardFinding[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const kind of kindsOfLine(line)) {
      add(out, kind, safeLocation(lines.length > 1 ? `${label} line ${i + 1}` : label));
    }
  });
  return out;
}

export interface ScanResult {
  findings: GuardFinding[];
  /** What was scanned, in order, for the content hash. Never leaves the hook. */
  scanned: string[];
  /** The input was longer than MAX_SCAN_CHARS and the rest was not looked at. */
  truncated: boolean;
}

/** Every string a tool call carries (command, content, new_string, patch text, MCP arguments). */
export function scanToolInput(toolInput: unknown): ScanResult {
  const result: ScanResult = { findings: [], scanned: [], truncated: false };
  let budget = MAX_SCAN_CHARS;
  const walk = (value: unknown, path: string, depth: number): void => {
    if (budget <= 0 || depth > 8) {
      // Anything that carries text and was not looked at counts as cut: nesting depth and a spent
      // budget are both chosen by whoever wrote the tool input.
      if (typeof value === "string" ? value.length > 0 : Array.isArray(value) || isRecord(value))
        result.truncated = true;
      return;
    }
    if (typeof value === "string") {
      const text = value.length > budget ? value.slice(0, budget) : value;
      if (text.length < value.length) result.truncated = true;
      budget -= text.length;
      result.scanned.push(path, text);
      for (const f of scanText(text, path)) add(result.findings, f.kind, f.location);
    } else if (Array.isArray(value)) {
      if (value.length > 200) result.truncated = true;
      value.slice(0, 200).forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
    } else if (isRecord(value)) {
      for (const [key, v] of Object.entries(value)) {
        if (Object.hasOwn(OLD_TEXT_KEYS, key)) continue;
        walk(v, `${path}.${key}`, depth + 1);
      }
    }
  };
  walk(toolInput, "tool_input", 0);
  return result;
}

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Added lines of a unified diff (`git diff --cached -U0`), with file and new line number.
 * A `+++ <path>` row is a file header only OUTSIDE a hunk: inside one it is an added line whose
 * content starts with `++ `, and it is scanned like any other. The hunk's own line counts say where
 * it ends, so a diff of several files without `diff --git` rows is read the same way.
 */
export function scanDiff(diff: string): ScanResult {
  const result: ScanResult = { findings: [], scanned: [], truncated: false };
  const text = diff.length > MAX_SCAN_CHARS ? diff.slice(0, MAX_SCAN_CHARS) : diff;
  result.truncated = text.length < diff.length;
  result.scanned.push("staged diff", text);
  let file = "(unknown file)";
  let line = 0;
  // Rows of the current hunk still to come (old side, new side); `null` = not inside a hunk.
  let left: { old: number; added: number } | null = null;
  for (const row of text.split("\n")) {
    if (left !== null && left.old <= 0 && left.added <= 0) left = null;
    if (left === null) {
      if (row.startsWith("+++ ")) {
        file = row.startsWith("+++ b/") ? row.slice(6) : row.slice(4);
        continue;
      }
      const m = HUNK.exec(row);
      if (m) {
        line = Number(m[2]);
        left = {
          old: m[1] === undefined ? 1 : Number(m[1]),
          added: m[3] === undefined ? 1 : Number(m[3]),
        };
        continue;
      }
      if (row.startsWith("@@")) {
        // A hunk header this reader cannot parse: no counts, so every `+` row up to the next
        // `diff --git` is scanned.
        const loose = /\+(\d+)/.exec(row);
        line = loose ? Number(loose[1]) : 0;
        left = { old: Number.POSITIVE_INFINITY, added: Number.POSITIVE_INFINITY };
        continue;
      }
    } else if (row.startsWith("diff --git ")) {
      left = null;
      continue;
    }
    if (row.startsWith("+")) {
      for (const kind of kindsOfLine(row.slice(1))) {
        add(result.findings, kind, safeLocation(`staged diff: ${file} line ${line}`));
      }
      line++;
      if (left !== null) left.added--;
    } else if (row.startsWith(" ")) {
      line++;
      if (left !== null) {
        left.old--;
        left.added--;
      }
    } else if (row.startsWith("-") && left !== null) {
      left.old--;
    }
  }
  return result;
}

/** SHA-256 over what was scanned: an approval bound to it cannot be reused for other content. */
export function guardHash(scanned: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of scanned) hash.update(`${part.length}:`).update(part).update("\0");
  return hash.digest("hex");
}

/** "github_token at tool_input.command line 1; api_key at ..." */
export function describeFindings(findings: readonly GuardFinding[]): string {
  return findings.map((f) => `${f.kind} at ${f.location}`).join("; ");
}

/**
 * JSON paths of anything in `value` that is, or holds, a secret: protocol's detector (keys and
 * values) and the guard's own assignment rule. Core uses it to refuse a guard report that contains one.
 */
export function secretPaths(value: unknown, path = "$"): string[] {
  const found = findSecrets(value, path);
  const walk = (v: unknown, p: string): void => {
    if (typeof v === "string") {
      if (kindsOfLine(v).length > 0 && !found.includes(p)) found.push(p);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (isRecord(v)) for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
  };
  walk(value, path);
  return found;
}
