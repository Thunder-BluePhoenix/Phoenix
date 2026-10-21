// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Which processes hold a power or audio assertion right now, from the read-only
// `/usr/bin/pmset -g assertions`. This is the only way Phoenix can tell that an app (a Slack huddle,
// a WhatsApp or Discord call, music) is in use without being told by a Phoenix capability: such an
// app asks macOS to keep the system or display awake, or holds an audio stream, while it is used.
// An app that holds one is never frozen.
//
// UNVERIFIED on a real Mac: the text format is the usual one of recent macOS releases. Anything
// that does not look like it (a failing command, no "Assertion status" header) is "unknown", and
// unknown means "do not freeze" (fail closed).
import type { Runner } from "../system";

export const PMSET = "/usr/bin/pmset";
export const ASSERTIONS_ARGV: readonly string[] = ["-g", "assertions"];
const TIMEOUT_MS = 8_000;

const HEADER = /^Assertion status system-wide:/m;
const OWNER = /^\s*pid\s+(\d+)\(/;
const HOLDING_TYPE =
  /\b(?:PreventUserIdleSystemSleep|PreventUserIdleDisplaySleep|PreventSystemSleep|NoIdleSleepAssertion|NoDisplaySleepAssertion)\b/;
const AUDIO = /\bResources:.*\baudio-(?:out|in)\b/;
const CREATED_FOR = /\bCreated for PID:\s*(\d+)/;

function safePid(text: string | undefined): number | undefined {
  const pid = Number(text);
  return Number.isSafeInteger(pid) && pid > 1 ? pid : undefined;
}

interface Block {
  pids: number[];
  holding: boolean;
}

/**
 * The pids that hold an idle-sleep, display-sleep or audio assertion (the owner of the assertion
 * and the pid it was "created for"), or null when the text is not an assertions listing.
 */
export function parseAssertionHolders(output: string): Set<number> | null {
  if (!HEADER.test(output)) return null;
  const holders = new Set<number>();
  let block: Block | undefined;
  const close = (): void => {
    if (block?.holding) for (const pid of block.pids) holders.add(pid);
  };
  for (const line of output.split("\n")) {
    const head = OWNER.exec(line);
    if (head) {
      close();
      const owner = safePid(head[1]);
      block = { pids: owner === undefined ? [] : [owner], holding: HOLDING_TYPE.test(line) };
      continue;
    }
    if (!block) continue;
    if (AUDIO.test(line)) block.holding = true;
    const created = safePid(CREATED_FOR.exec(line)?.[1]);
    if (created !== undefined) block.pids.push(created);
  }
  close();
  return holders;
}

/** The holders now, or null when the probe failed or its output could not be read. Never throws. */
export async function readAssertionHolders(run: Runner): Promise<Set<number> | null> {
  try {
    const result = await run(PMSET, ASSERTIONS_ARGV, { timeoutMs: TIMEOUT_MS });
    return result.code === 0 ? parseAssertionHolders(result.stdout) : null;
  } catch {
    return null;
  }
}
