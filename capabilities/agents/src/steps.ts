// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 58 step ticker: what an agent reads, edits and runs, one short line per tool call.
//
// A Claude Code PreToolUse/PostToolUse payload is turned into a StepEvent {kind, tool, target}.
// Rules held here (each has a test):
//  - Tool OUTPUT and file CONTENTS are never read, kept or sent. `tool_response` is not looked at;
//    the content of a Write and the old/new strings of an Edit are reduced to line counts.
//  - `target` is a path or a command, control characters flattened, secrets redacted (the same
//    `redactText` the terminal capability uses) and cut to MAX_TARGET characters.
//  - Anything unusable maps to null; nothing throws.
//  - Core keeps steps in a bounded ring (`StepLog`), so a runaway agent cannot grow memory.
import { isAbsolute } from "node:path";
import { redactText } from "../../terminal/src/index";
import { isRecord } from "./guards";
import { AGENT_ID_PATTERN, MAX_WORKSPACE } from "./report";

export const STEP_KINDS = ["read", "edit", "run", "other"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** A step's target (a command or a path) is cut to this many characters. */
export const MAX_TARGET = 200;
export const MAX_TOOL = 100;
export const MAX_FILE_PATH = 1_000;
/** Steps kept per session; older ones are dropped and counted. */
export const MAX_STEPS = 500;
/** Characters of a raw field looked at before redaction (a secret cannot straddle the real cut). */
const RAW_WINDOW = 2_000;
const MAX_LINES = 1_000_000;
const MAX_MULTI_EDITS = 50;

/** Agent slug used by Phase 56/58 events. */
export const LIVE_AGENT_PATTERN = /^[a-z0-9-]{1,24}$/;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** What a hook or the relay sends about one tool call. No content, no output. */
export interface StepEvent {
  agent: string;
  session_id: string;
  /** Absolute project directory (the agent's cwd). */
  project: string;
  kind: StepKind;
  tool: string;
  /** Path or truncated, redacted command (at most MAX_TARGET characters). */
  target: string;
  at: string;
  /** Edit/Write steps: the exact file and the line counts of this one change. */
  file?: { path: string; added: number; removed: number };
  /** Best-effort identity of the agent's terminal, for "jump to terminal". */
  pid?: number;
  tty?: string;
}

/** `[REDACTED]` in place of a secret. */
const MASK = "[REDACTED]";
/** A quoted value (an unterminated quote runs to the end) or one unquoted word. */
const VALUE = String.raw`"[^"]*"?|'[^']*'?|\S+`;
const SECRET_WORD = String.raw`(?:token|secret|passw(?:or)?d|pwd|key|auth|credential)`;
/** An assignment-like name: `API_TOKEN`, `db_password`, `MYSQL_PWD`, `DB_PASS`, `--api-key`. */
const SECRET_NAME = String.raw`[\w.-]*${SECRET_WORD}[\w.-]*|(?:[\w.-]*[_-])?pass`;

const PEM_BLOCK =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;
const SECRET_FLAG = new RegExp(
  String.raw`(--?[\w-]*(?:passw(?:or)?d|pwd|token|secret|api[-_]?key|auth|credential)[\w-]*)(=|\s+)(?!\[REDACTED\])(?:${VALUE})`,
  "gi",
);
const SECRET_ASSIGNMENT = new RegExp(
  String.raw`((?:${SECRET_NAME})=)(?!\[REDACTED\])(?:${VALUE})`,
  "gi",
);
const CURL_LONG_USER = new RegExp(String.raw`(\s--(?:proxy-)?user(?:=|\s+))(?:${VALUE})`, "g");
const CURL_SHORT_USER = /(\bcurl\b[^|;&]*?\s-[uU]\s*)(?:"[^"]*"?|'[^']*'?|\S+)/g;
const AUTH_HEADER =
  /\b((?:proxy-)?authorization|x-api-key|x-auth-token|set-cookie|cookie)(\s*[:=]\s*)[^"'\n]*/gi;
const QUERY_SECRET = new RegExp(
  String.raw`([?&][\w.-]*(?:${SECRET_WORD}|signature|sig)[\w.-]*=)[^&\s"'#]*`,
  "gi",
);
const MYSQL_P = /(\bmysql\w*\b[^|;&]*?\s-p)("[^"]*"?|'[^']*'?|\S+)/g;
const URL_TOKEN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;

/** The password inside `scheme://user:password@host/…`, even when it holds an encoded or raw `/` or `@`. */
function maskUrlPassword(url: string): string {
  const start = url.indexOf("://") + 3;
  const rest = url.slice(start);
  const stop = rest.search(/[/?#]/);
  const authority = stop === -1 ? rest : rest.slice(0, stop);
  let at = authority.lastIndexOf("@");
  // A raw `/` in the password ends the authority early (`u:p/ss@host`); a `host:8080/@x` does not.
  if (at === -1 && authority.includes(":") && !/:\d+$/.test(authority)) at = rest.lastIndexOf("@");
  if (at === -1) return url;
  const userinfo = rest.slice(0, at);
  const colon = userinfo.indexOf(":");
  if (colon === -1) return url;
  return `${url.slice(0, start)}${userinfo.slice(0, colon + 1)}${MASK}${rest.slice(at)}`;
}

/**
 * `redactText` (the terminal capability's) plus what a command line or a diff still leaks through
 * it: private-key blocks, `-u user:pass`, auth headers of any scheme, lower-case and `export`ed
 * assignments, query-string credentials, quoted values with spaces, `mysql -pSECRET`, and URL
 * passwords holding `/` or `@`. A heuristic: it masks what it recognises and claims nothing more.
 */
export function redactSecrets(text: string): string {
  const masked = text
    .replace(PEM_BLOCK, MASK)
    .replace(AUTH_HEADER, `$1$2${MASK}`)
    .replace(CURL_LONG_USER, `$1${MASK}`)
    .replace(CURL_SHORT_USER, `$1${MASK}`)
    .replace(MYSQL_P, `$1${MASK}`)
    .replace(URL_TOKEN, maskUrlPassword)
    .replace(QUERY_SECRET, `$1${MASK}`)
    .replace(SECRET_FLAG, `$1$2${MASK}`)
    .replace(SECRET_ASSIGNMENT, `$1${MASK}`);
  return redactText(masked);
}

/** Flattens control characters, redacts secrets, cuts to `max` characters (the last is `…`). */
export function cleanText(raw: string, max: number): string {
  const flat = raw.slice(0, RAW_WINDOW).replace(CONTROL, " ").replace(/ {2,}/g, " ").trim();
  const redacted = redactSecrets(flat);
  return redacted.length > max ? `${redacted.slice(0, max - 1)}…` : redacted;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Lines added and removed when `before` becomes `after`: the common leading and trailing lines
 * are not counted, so changing one line of three counts +1 −1, not +3 −3.
 */
export function lineDelta(before: string, after: string): { added: number; removed: number } {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return {
    added: Math.min(endB - start, MAX_LINES),
    removed: Math.min(endA - start, MAX_LINES),
  };
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** A usable absolute file path (no control characters, bounded), or undefined. */
function filePathOf(v: unknown): string | undefined {
  const path = str(v);
  if (!path || path.length > MAX_FILE_PATH || /\p{Cc}/u.test(path)) return undefined;
  return isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path) ? path : undefined;
}

const READ_TOOLS: Readonly<Record<string, "path" | "pattern">> = {
  Read: "path",
  NotebookRead: "path",
  LS: "path",
  Glob: "pattern",
  Grep: "pattern",
};
const RUN_TOOLS: Readonly<Record<string, true>> = { Bash: true, PowerShell: true };

interface Mapped {
  kind: StepKind;
  target: string;
  file?: { path: string; added: number; removed: number };
}

function editOf(tool: string, input: Record<string, unknown>): Mapped | null {
  const path = filePathOf(input.file_path ?? input.notebook_path);
  if (!path) return null;
  let delta = { added: 0, removed: 0 };
  if (tool === "Edit") {
    delta = lineDelta(str(input.old_string) ?? "", str(input.new_string) ?? "");
  } else if (tool === "Write") {
    // The hook cannot know what an overwritten file held; `git diff` on demand is exact.
    delta = { added: splitLines(str(input.content) ?? "").length, removed: 0 };
  } else if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    for (const e of input.edits.slice(0, MAX_MULTI_EDITS)) {
      if (!isRecord(e)) continue;
      const d = lineDelta(str(e.old_string) ?? "", str(e.new_string) ?? "");
      delta = { added: delta.added + d.added, removed: delta.removed + d.removed };
    }
  } else if (tool === "NotebookEdit") {
    delta = { added: splitLines(str(input.new_source) ?? "").length, removed: 0 };
  }
  const file = {
    path,
    added: Math.min(delta.added, MAX_LINES),
    removed: Math.min(delta.removed, MAX_LINES),
  };
  const target = cleanText(path, MAX_TARGET);
  // A path that redaction changed is not a path Core could safely use as a key or diff.
  return { kind: "edit", target, ...(redactText(path) === path ? { file } : {}) };
}

function mapTool(tool: string, input: Record<string, unknown>): Mapped {
  if (Object.hasOwn(RUN_TOOLS, tool))
    return { kind: "run", target: cleanText(str(input.command) ?? "", MAX_TARGET) };
  if (tool === "Edit" || tool === "Write" || tool === "MultiEdit" || tool === "NotebookEdit") {
    const edit = editOf(tool, input);
    if (edit) return edit;
    return { kind: "edit", target: cleanText(str(input.file_path) ?? "", MAX_TARGET) };
  }
  const read = Object.hasOwn(READ_TOOLS, tool) ? READ_TOOLS[tool] : undefined;
  if (read === "path") {
    return {
      kind: "read",
      target: cleanText(
        str(input.file_path) ?? str(input.notebook_path) ?? str(input.path) ?? "",
        MAX_TARGET,
      ),
    };
  }
  if (read === "pattern") {
    const where = str(input.path);
    const pattern = str(input.pattern) ?? "";
    return {
      kind: "read",
      target: cleanText(where ? `${pattern} in ${where}` : pattern, MAX_TARGET),
    };
  }
  if (tool === "WebFetch")
    return { kind: "other", target: cleanText(str(input.url) ?? "", MAX_TARGET) };
  if (tool === "WebSearch")
    return { kind: "other", target: cleanText(str(input.query) ?? "", MAX_TARGET) };
  return { kind: "other", target: "" };
}

export interface StepMapOptions {
  now?: () => number;
  agent?: string;
  pid?: number;
  tty?: string;
}

/**
 * The step a Claude Code PreToolUse/PostToolUse hook describes, or null (another hook, or a
 * payload that is not usable). Never throws. Tool output (`tool_response`) is never read.
 */
export function mapClaudeStep(payload: unknown, options: StepMapOptions = {}): StepEvent | null {
  if (!isRecord(payload)) return null;
  const event = payload.hook_event_name;
  if (event !== "PostToolUse" && event !== "PreToolUse") return null;
  const sessionId = payload.session_id;
  if (typeof sessionId !== "string" || !AGENT_ID_PATTERN.test(sessionId)) return null;
  const cwd = payload.cwd;
  if (
    typeof cwd !== "string" ||
    cwd.length > MAX_WORKSPACE ||
    !isAbsolute(cwd) ||
    /\p{Cc}/u.test(cwd)
  ) {
    return null;
  }
  const rawTool = payload.tool_name;
  if (typeof rawTool !== "string" || rawTool === "AskUserQuestion") return null;
  const tool = cleanText(rawTool, MAX_TOOL);
  if (!tool) return null;
  const input = isRecord(payload.tool_input) ? payload.tool_input : {};
  const mapped = mapTool(rawTool, input);
  return {
    agent: options.agent ?? "claude-code",
    session_id: sessionId,
    project: cwd,
    kind: mapped.kind,
    tool,
    target: mapped.target,
    at: new Date((options.now ?? Date.now)()).toISOString(),
    ...(mapped.file ? { file: mapped.file } : {}),
    ...(options.pid ? { pid: options.pid } : {}),
    ...(options.tty ? { tty: options.tty } : {}),
  };
}

export type StepResult = { ok: true; step: StepEvent } | { ok: false; problems: string[] };

const STEP_KEYS: readonly string[] = [
  "agent",
  "session_id",
  "project",
  "kind",
  "tool",
  "target",
  "at",
  "file",
  "pid",
  "tty",
];
const TTY_PATTERN = /^[A-Za-z0-9/._-]{1,40}$/;

const wholeCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_LINES;

/**
 * Validates a step that came from the wire (hook, relay). Core does not trust the sender's
 * cleaning: the target is cleaned again and every field is bounded.
 */
export function validateStep(input: unknown, nowMs: number): StepResult {
  if (!isRecord(input)) return { ok: false, problems: ["step must be an object"] };
  const problems: string[] = [];
  for (const key of Object.keys(input)) {
    if (!STEP_KEYS.includes(key)) problems.push(`unknown field "${key.slice(0, 40)}"`);
  }
  const { agent, session_id: sessionId, project, kind, tool, target, at, file, pid, tty } = input;
  if (typeof agent !== "string" || !LIVE_AGENT_PATTERN.test(agent))
    problems.push("agent is invalid");
  if (typeof sessionId !== "string" || !AGENT_ID_PATTERN.test(sessionId))
    problems.push("session_id is invalid");
  if (
    typeof project !== "string" ||
    project.length > MAX_WORKSPACE ||
    !(isAbsolute(project) || /^[A-Za-z]:[\\/]/.test(project)) ||
    /\p{Cc}/u.test(project)
  ) {
    problems.push("project must be an absolute path");
  }
  if (typeof kind !== "string" || !(STEP_KINDS as readonly string[]).includes(kind))
    problems.push("kind is invalid");
  if (typeof tool !== "string" || tool.length === 0 || tool.length > MAX_TOOL)
    problems.push("tool is invalid");
  if (typeof target !== "string" || target.length > MAX_TARGET * 2)
    problems.push("target is invalid");
  if (
    pid !== undefined &&
    !(typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 && pid < 2 ** 31)
  )
    problems.push("pid is invalid");
  if (
    tty !== undefined &&
    !(typeof tty === "string" && TTY_PATTERN.test(tty) && !tty.includes(".."))
  )
    problems.push("tty is invalid");
  let cleanFile: StepEvent["file"];
  if (file !== undefined) {
    const path = isRecord(file) ? filePathOf(file.path) : undefined;
    if (!isRecord(file) || !path || !wholeCount(file.added) || !wholeCount(file.removed)) {
      problems.push("file is invalid");
    } else if (redactText(path) === path) {
      cleanFile = { path, added: file.added, removed: file.removed };
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  // A clock that is wrong by more than a day is not trusted; Core's own time is used.
  const parsed = typeof at === "string" ? Date.parse(at) : Number.NaN;
  const atMs = Number.isFinite(parsed) && Math.abs(parsed - nowMs) < 86_400_000 ? parsed : nowMs;
  return {
    ok: true,
    step: {
      agent: agent as string,
      session_id: sessionId as string,
      project: project as string,
      kind: kind as StepKind,
      tool: cleanText(tool as string, MAX_TOOL),
      target: cleanText(target as string, MAX_TARGET),
      at: new Date(atMs).toISOString(),
      ...(cleanFile ? { file: cleanFile } : {}),
      ...(typeof pid === "number" ? { pid } : {}),
      ...(typeof tty === "string" ? { tty } : {}),
    },
  };
}

/** A step as Core keeps it: numbered within its session. */
export interface LoggedStep {
  n: number;
  at: string;
  kind: StepKind;
  tool: string;
  target: string;
}

/** Bounded, ordered step history of one session (oldest dropped first). */
export class StepLog {
  private held: LoggedStep[] = [];
  private counter = 0;

  constructor(private readonly capacity = MAX_STEPS) {}

  push(step: Pick<StepEvent, "at" | "kind" | "tool" | "target">): LoggedStep {
    const logged: LoggedStep = {
      n: ++this.counter,
      at: step.at,
      kind: step.kind,
      tool: step.tool,
      target: step.target,
    };
    this.held.push(logged);
    if (this.held.length > this.capacity) this.held.splice(0, this.held.length - this.capacity);
    return logged;
  }

  /** Oldest first. */
  list(): readonly LoggedStep[] {
    return this.held;
  }

  /** Steps pushed out of the ring. */
  get dropped(): number {
    return this.counter - this.held.length;
  }

  /** Steps ever recorded. */
  get total(): number {
    return this.counter;
  }
}
