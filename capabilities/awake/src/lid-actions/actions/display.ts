// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Display (and keyboard light) off while the lid is closed, brightness saved and restored.
//
// What macOS offers without extra software, checked on paper (UNVERIFIED on a real Mac):
//   - `pmset displaysleepnow` puts the display to sleep. Stock, needs no root. The display wakes
//     by itself when the lid opens, so this part has nothing to undo.
//   - Brightness has NO stock command line. The free third-party `brightness` tool (Homebrew:
//     `brightness -l` lists, `brightness -d <n> <0..1>` sets) is used when it is installed at one
//     of the two fixed Homebrew paths; Phoenix never installs it and adds no dependency. Without
//     it only the display sleep happens, and the status says so (limit `brightness_tool_missing`).
//   - The keyboard backlight needs private APIs or another third-party tool: NOT implemented
//     (limit `keyboard_backlight_unsupported`). Recorded as a GAP.
// The tool is run only if its file is owned by root or the current user and is not group- or
// world-writable (`trustedTool`), checked at plan, at apply and at undo; otherwise only
// `displaysleepnow` runs.
// Not while a meeting, recording or dictation is in progress, nor when that is unknown.
// The journal entry holds the tool path (one of the two constants, re-checked on undo) and the
// brightness of every display, so undo needs nothing from memory.
import type { Fields } from "../../power/format";
import { assertIdle, busyReason } from "./guard";
import type { LidAction, LidSeams } from "../types";

export const DISPLAY_KIND = "lid.display";
const PMSET = "/usr/bin/pmset";
/** Where Homebrew puts `brightness` on Apple Silicon and Intel. Nothing else is ever run. */
export const BRIGHTNESS_TOOLS: readonly string[] = [
  "/opt/homebrew/bin/brightness",
  "/usr/local/bin/brightness",
];
const TIMEOUT = { timeoutMs: 8_000 };
const MAX_DISPLAYS = 16;

export interface DisplayLevel {
  index: number;
  level: number;
}

/** `display 0: brightness 0.500000` lines of `brightness -l`. Anything else is ignored. */
export function parseBrightness(output: string): DisplayLevel[] {
  const out: DisplayLevel[] = [];
  for (const m of output.matchAll(/^display (\d{1,2}): brightness (\d(?:\.\d+)?)\s*$/gm)) {
    const index = Number(m[1]);
    const level = Number(m[2]);
    if (Number.isInteger(index) && index < MAX_DISPLAYS && level >= 0 && level <= 1)
      out.push({ index, level });
  }
  return out;
}

function parseLevels(raw: unknown): DisplayLevel[] {
  if (!Array.isArray(raw)) return [];
  const out: DisplayLevel[] = [];
  for (const item of raw.slice(0, MAX_DISPLAYS)) {
    const index: unknown =
      item !== null && typeof item === "object" ? Reflect.get(item, "index") : undefined;
    const level: unknown =
      item !== null && typeof item === "object" ? Reflect.get(item, "level") : undefined;
    if (
      typeof index === "number" &&
      Number.isInteger(index) &&
      index >= 0 &&
      index < MAX_DISPLAYS &&
      typeof level === "number" &&
      level >= 0 &&
      level <= 1
    ) {
      out.push({ index, level });
    }
  }
  return out;
}

/**
 * A third-party tool is run only when its file is owned by root or by the current user and nobody
 * else may write to it (no group or world write bit): a file another user can replace must not
 * run with this user's rights. Unreadable: not trusted.
 */
export async function trustedTool(seams: LidSeams, tool: string): Promise<boolean> {
  let st;
  try {
    st = await seams.stat(tool);
  } catch {
    return false;
  }
  if (st === null) return false;
  const ownerOk = st.uid === 0 || (seams.uid >= 0 && st.uid === seams.uid);
  return ownerOk && (st.mode & 0o022) === 0;
}

async function findTool(seams: LidSeams): Promise<{ tool: string; levels: DisplayLevel[] } | null> {
  for (const tool of BRIGHTNESS_TOOLS) {
    if (!(await trustedTool(seams, tool))) continue;
    const result = await seams.run(tool, ["-l"], TIMEOUT);
    if (result.code !== 0) continue;
    const levels = parseBrightness(result.stdout);
    if (levels.length > 0) return { tool, levels };
  }
  return null;
}

export function createDisplay(seams: LidSeams): LidAction {
  return {
    id: "display",
    kind: DISPLAY_KIND,
    async plan(ctx) {
      if (seams.platform !== "darwin") return ctx.skip("unsupported_platform");
      const busy = busyReason(seams);
      if (busy !== null) return ctx.skip(busy);
      const found = await findTool(seams);
      const notes = [
        "keyboard_backlight_unsupported",
        ...(found ? [] : ["brightness_tool_missing"]),
      ];
      return {
        apply: { dim: found !== null, tool: found?.tool ?? null },
        undo: { tool: found?.tool ?? null, displays: found?.levels ?? [] },
        count: found?.levels.length ?? 1,
        notes,
      };
    },
    async apply(planned) {
      assertIdle(seams);
      const named = BRIGHTNESS_TOOLS.find((t) => t === planned.apply.tool);
      const tool = named !== undefined && (await trustedTool(seams, named)) ? named : undefined;
      const levels = tool ? parseLevels(planned.undo.displays) : [];
      let failed = 0;
      for (const { index } of levels) {
        const result = await seams.run(tool ?? "", ["-d", String(index), "0"], TIMEOUT);
        if (result.code !== 0) failed += 1;
      }
      const sleep = await seams.run(PMSET, ["displaysleepnow"], TIMEOUT);
      if (sleep.code !== 0) failed += 1;
      if (failed > 0) throw new Error("the display could not be fully turned off");
    },
    async undo(undo: Fields) {
      const named = BRIGHTNESS_TOOLS.find((t) => t === undo.tool);
      if (named === undefined) return { count: 0 };
      // An untrusted file is never run, not even to put the brightness back: reported, not left pending.
      if (!(await trustedTool(seams, named)))
        return { count: 0, notes: ["brightness_tool_untrusted"] };
      const tool = named;
      let count = 0;
      let failed = 0;
      for (const { index, level } of parseLevels(undo.displays)) {
        const result = await seams.run(tool, ["-d", String(index), String(level)], TIMEOUT);
        if (result.code === 0) count += 1;
        else failed += 1;
      }
      if (failed > 0) throw new Error("the brightness could not be restored");
      return { count };
    },
    async support() {
      if (seams.platform !== "darwin") return { supported: false, reason: "unsupported_platform" };
      // Read-only: `brightness -l` lists, it changes nothing.
      const found = await findTool(seams);
      return {
        supported: true,
        limits: ["keyboard_backlight_unsupported", ...(found ? [] : ["brightness_tool_missing"])],
      };
    },
  };
}
