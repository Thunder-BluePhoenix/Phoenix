// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The real implementations of the lid-action seams. Each is a thin adapter: the logic that decides
// WHAT to touch lives in the actions and is tested with fakes. Nothing here runs in any test.
//
// This is the ONLY file in the lid-actions module that calls `process.kill`.
import { stat } from "node:fs/promises";
import type { Runner } from "../system";
import type {
  AudioControl,
  AudioDevice,
  FileStat,
  ProcInfo,
  ProcessLister,
  Signaler,
} from "./types";

const ENV = "/usr/bin/env";
const PS = "/bin/ps";
const OSASCRIPT = "/usr/bin/osascript";
const SYSTEM_PROFILER = "/usr/sbin/system_profiler";
const READ_TIMEOUT_MS = 8_000;
/** The audio device name is only a cross-check; it must not hold up an undo. */
const PROFILER_TIMEOUT_MS = 5_000;

/**
 * `ps` prints `lstart` in the local time zone, so a time-zone or DST change between the freeze and
 * the thaw would make a recorded start time differ from the same process's current one. Both
 * recording and checking therefore run it with a fixed zone and locale.
 */
export const PS_ARGV: readonly string[] = [
  "TZ=UTC",
  "LC_ALL=C",
  PS,
  "-axo",
  "pid=,ppid=,uid=,state=,lstart=,comm=",
];

const PS_LINE =
  /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([A-Z][a-z]{2} [A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(\S.*)$/;

/** One `ps -axo pid=,ppid=,uid=,state=,lstart=,comm=` line; anything else is undefined. */
export function parsePsLine(line: string): ProcInfo | undefined {
  const m = PS_LINE.exec(line);
  if (!m) return undefined;
  const pid = Number(m[1]);
  const ppid = Number(m[2]);
  const uid = Number(m[3]);
  if (
    !Number.isSafeInteger(pid) ||
    pid < 1 ||
    !Number.isSafeInteger(ppid) ||
    ppid < 0 ||
    !Number.isSafeInteger(uid) ||
    uid < 0
  )
    return undefined;
  return {
    pid,
    ppid,
    uid,
    state: m[4] ?? "",
    start: (m[5] ?? "").replace(/\s+/g, " "),
    command: (m[6] ?? "").trim(),
  };
}

/** The process table over `ps` (read-only). Throws when `ps` cannot run, so nothing is signalled. */
export function createProcessLister(run: Runner): ProcessLister {
  return async () => {
    const result = await run(ENV, PS_ARGV, { timeoutMs: READ_TIMEOUT_MS });
    if (result.code !== 0) throw new Error("the process list could not be read");
    return result.stdout.split("\n").flatMap((line) => {
      const proc = parsePsLine(line);
      return proc ? [proc] : [];
    });
  };
}

/**
 * `process.kill` for one pid and one of two signals. Refuses pids that could mean "a group" or
 * "everything" (< 2, or not a safe integer) and Phoenix's own pid.
 */
export const realSignaler: Signaler = (pid, signal) => {
  if (!Number.isSafeInteger(pid) || pid < 2 || pid === process.pid) {
    throw new Error("refused to signal that process id");
  }
  try {
    process.kill(pid, signal);
    return "sent";
  } catch (err) {
    const code = err instanceof Error ? Reflect.get(err, "code") : undefined;
    if (code === "ESRCH") return "gone";
    if (code === "EPERM") return "denied";
    throw err;
  }
};

/** The id the osascript adapter gives the one output it can address: the current default. */
export const DEFAULT_OUTPUT_ID = "default";

const PRINTABLE_NAME = /^[\x20-\x7e]{1,128}$/;

/**
 * The name of the default output device in `system_profiler SPAudioDataType -json`, or null when
 * the text is not that shape, has no (or more than one) default output, or the name is not plain.
 */
export function parseDefaultOutputName(json: string): string | null {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return null;
  }
  const groups: unknown =
    root !== null && typeof root === "object" ? Reflect.get(root, "SPAudioDataType") : undefined;
  if (!Array.isArray(groups)) return null;
  const names: string[] = [];
  for (const group of groups) {
    const items: unknown =
      group !== null && typeof group === "object" ? Reflect.get(group, "_items") : undefined;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item === null || typeof item !== "object") continue;
      const name: unknown = Reflect.get(item, "_name");
      if (
        Reflect.get(item, "coreaudio_default_audio_output_device") === "spaudio_yes" &&
        typeof name === "string"
      )
        names.push(name);
    }
  }
  const only = names.length === 1 ? names[0] : undefined;
  return only !== undefined && PRINTABLE_NAME.test(only) ? only : null;
}

/**
 * Mute through `osascript`, which can only address the CURRENT default output (constants only; no
 * value is ever interpolated into a script, and the device name read from `system_profiler`
 * (read-only) is only ever compared, never run). Per-device mute needs CoreAudio APIs: GAP, see
 * README-lid.md. `output muted of (get volume settings)` answers `missing value` for an output
 * without a mute control; that reads as "unknown" and the output is never touched.
 */
export function createOsascriptAudio(run: Runner): AudioControl {
  async function nameOfDefault(): Promise<string | null> {
    try {
      const result = await run(SYSTEM_PROFILER, ["SPAudioDataType", "-json"], {
        timeoutMs: PROFILER_TIMEOUT_MS,
      });
      return result.code === 0 ? parseDefaultOutputName(result.stdout) : null;
    } catch {
      return null;
    }
  }
  async function read(withName: boolean): Promise<AudioDevice | null> {
    const result = await run(OSASCRIPT, ["-e", "output muted of (get volume settings)"], {
      timeoutMs: READ_TIMEOUT_MS,
    });
    if (result.code !== 0) return null;
    const text = result.stdout.trim();
    const muted = text === "true" ? true : text === "false" ? false : null;
    return { id: DEFAULT_OUTPUT_ID, muted, name: withName ? await nameOfDefault() : null };
  }
  return {
    addressing: "default_only",
    async listOutputs() {
      const device = await read(true);
      return device ? [device] : [];
    },
    async defaultOutputId() {
      return (await read(false)) ? DEFAULT_OUTPUT_ID : null;
    },
    async setMuted(id, muted) {
      if (id !== DEFAULT_OUTPUT_ID) throw new Error("only the default output can be addressed");
      const result = await run(
        OSASCRIPT,
        ["-e", muted ? "set volume output muted true" : "set volume output muted false"],
        {
          timeoutMs: READ_TIMEOUT_MS,
        },
      );
      if (result.code !== 0) throw new Error("the output could not be muted or unmuted");
    },
  };
}

/** Owner and mode of a file (read-only). Null when it cannot be read. */
export const realStat: FileStat = async (path) => {
  try {
    const st = await stat(path);
    return { uid: st.uid, mode: st.mode };
  } catch {
    return null;
  }
};
