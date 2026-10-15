// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Claude Code's `statusLine` (https://code.claude.com/docs/en/statusline: `{type:"command",
// command, padding?}`) is wrapped, never replaced. Phoenix's entry runs
//
//   <tsx> statusline.ts --then '<the user's previous statusLine command>'
//
// which relays the usage windows to Core and prints the previous command's output byte for byte.
// The previous command is POSIX single-quoted; Phoenix reads it back out of that wrapper on
// uninstall, so the user's exact command (spaces, quotes, unicode) comes back. Other statusLine
// fields (`padding`, ...) are kept. A statusLine that already is Phoenix's is only refreshed, never
// wrapped again. On Windows nothing is wrapped (shell quoting there is unverified): the user's
// statusLine is left alone and usage is simply not offered.
import { isRecord } from "../guards";
import type { AdapterContext, StatusLineHook } from "./adapters";
import { HOOK_SCRIPT_PATTERN } from "./commands";
import type { JsonObject } from "./config-json";

const STATUSLINE_PATTERN = /capabilities[\\/]agents[\\/]src[\\/]statusline\.ts(?=["'\s]|$)/;

/** The exact inverse of the POSIX quoting `commands.ts` uses (`'` becomes `'\''`); null if it is not that. */
export function posixUnquote(text: string): string | null {
  let out = "";
  let at = 0;
  while (at < text.length) {
    if (text[at] === "'") {
      const close = text.indexOf("'", at + 1);
      if (close < 0) return null;
      out += text.slice(at + 1, close);
      at = close + 1;
    } else if (text.startsWith("\\'", at)) {
      out += "'";
      at += 2;
    } else {
      return null;
    }
  }
  return out;
}

const isPhoenixLine = (command: unknown): command is string =>
  typeof command === "string" && STATUSLINE_PATTERN.test(command) && HOOK_SCRIPT_PATTERN.test(command);

/** The user's command inside Phoenix's wrapper: "" for none, null when it cannot be read back. */
function wrapped(command: string): string | null {
  const m = STATUSLINE_PATTERN.exec(command);
  const rest = command.slice(m!.index + m![0].length);
  const after = /^['"]?(?: --then (.*))?$/s.exec(rest);
  if (!after) return null;
  return after[1] === undefined ? "" : posixUnquote(after[1]);
}

/** What the statusLine should be, or null when Phoenix must not touch it. */
function wanted(doc: JsonObject, ctx: AdapterContext): JsonObject | null {
  if (ctx.platform === "win32") return null;
  const current = doc.statusLine;
  if (current === undefined) return { type: "command", command: ctx.commands.statusline() };
  if (!isRecord(current)) return null;
  if (current.type !== undefined && current.type !== "command") return null;
  if (typeof current.command !== "string") return null;
  const previous = isPhoenixLine(current.command) ? wrapped(current.command) : current.command;
  if (previous === null) return null;
  return {
    ...current,
    type: "command",
    command: ctx.commands.statusline(previous === "" ? undefined : previous),
  };
}

export const claudeStatusLine: StatusLineHook = {
  apply(doc, ctx) {
    const next = wanted(doc, ctx);
    if (next === null || JSON.stringify(next) === JSON.stringify(doc.statusLine)) return false;
    doc.statusLine = next;
    return true;
  },
  remove(doc) {
    const current = doc.statusLine;
    if (!isRecord(current) || !isPhoenixLine(current.command)) return false;
    const previous = wrapped(current.command);
    if (previous === null) return false;
    if (previous === "") delete doc.statusLine;
    else doc.statusLine = { ...current, command: previous };
    return true;
  },
  stale(doc, ctx) {
    const next = wanted(doc, ctx);
    return next !== null && JSON.stringify(next) !== JSON.stringify(doc.statusLine);
  },
};
