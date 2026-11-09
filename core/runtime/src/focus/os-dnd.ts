// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A read-only reader of the operating system's Do Not Disturb state, behind an injected exec seam.
//
// Built (never run on a real desktop; tests use a fake exec):
//   - Linux / GNOME: `gsettings get org.gnome.desktop.notifications show-banners`. `false` means
//     banners are hidden, which is GNOME's Do Not Disturb.
//   - Linux / KDE Plasma: `gdbus call` reading the `Inhibited` property of
//     org.freedesktop.Notifications on the session bus (`true` means notifications are inhibited).
// Deliberately not built, each with its reason in docs/focus-and-screenshot.md:
//   - macOS: Apple's only public Focus-status API (`INFocusStatusCenter`) needs a native app that
//     asks the user for authorisation (`NSFocusStatusUsageDescription`); Core is a Node process
//     with no such API. The Focus databases and `defaults` keys are private and undocumented.
//   - Windows: Focus Assist / Quiet Hours has no documented read API. `SHQueryUserNotificationState`
//     is documented but does not report it (only screen saver, full screen, presentation, quiet
//     time after first logon).
// Nothing here ever writes an OS setting: the argv lists are fixed constants, no shell, no caller
// input, bounded time and output, and every failure maps to a fixed reason code.
import { execFile } from "node:child_process";

export type DndState = "on" | "off" | "unknown";

/** Why a reading is unknown. Fixed codes; no program output is ever carried. */
export type DndUnknownReason =
  | "unsupported_macos"
  | "unsupported_windows"
  | "unsupported_platform"
  | "desktop_unsupported"
  | "tool_missing"
  | "timeout"
  | "failed"
  | "output_too_large"
  | "unexpected_output";

export interface DndReading {
  state: DndState;
  platform: NodeJS.Platform;
  /** The documented setting or property read; null when nothing could be read on this platform. */
  source: string | null;
  /** Set exactly when `state` is `unknown`. */
  reason: DndUnknownReason | null;
}

export interface DndExecLimits {
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface DndExecResult {
  /** Exit code; null when the program did not run to a normal exit. */
  code: number | null;
  stdout: string;
  /** The program does not exist on PATH. */
  notFound: boolean;
  timedOut: boolean;
  outputCapped: boolean;
}

/** Runs `file argv` (no shell, minimal environment). Tests inject a fake; it must never throw. */
export type DndExec = (
  file: string,
  argv: readonly string[],
  limits: DndExecLimits,
) => Promise<DndExecResult>;

export const DND_EXEC_TIMEOUT_MS = 3_000;
export const DND_EXEC_MAX_OUTPUT_BYTES = 1_024;
/** A reading younger than this is reused, so a burst of callers causes one program run. */
export const DND_MIN_READ_INTERVAL_MS = 5_000;

const GNOME_SOURCE = "gsettings:org.gnome.desktop.notifications/show-banners";
const KDE_SOURCE = "dbus:org.freedesktop.Notifications.Inhibited (KDE Plasma)";

const GSETTINGS_FILE = "gsettings";
const GSETTINGS_ARGV = ["get", "org.gnome.desktop.notifications", "show-banners"] as const;

const GDBUS_FILE = "gdbus";
const GDBUS_ARGV = [
  "call",
  "--session",
  "--dest",
  "org.freedesktop.Notifications",
  "--object-path",
  "/org/freedesktop/Notifications",
  "--method",
  "org.freedesktop.DBus.Properties.Get",
  "org.freedesktop.Notifications",
  "Inhibited",
] as const;

type Method = {
  file: string;
  argv: readonly string[];
  source: string;
  /** Maps exact program output to the DND state; null when the output is not one documented form. */
  parse: (stdout: string) => DndState | null;
};

/** `gsettings get` prints a GVariant boolean: exactly `true` or `false`. `show-banners` false = DND on. */
export function parseGsettingsBanners(stdout: string): DndState | null {
  const text = stdout.trim();
  if (text === "false") return "on";
  if (text === "true") return "off";
  return null;
}

/** `gdbus call ... Properties.Get` prints the variant in a tuple: exactly `(<true>,)` or `(<false>,)`. */
export function parseGdbusInhibited(stdout: string): DndState | null {
  const text = stdout.trim();
  if (text === "(<true>,)") return "on";
  if (text === "(<false>,)") return "off";
  return null;
}

const GNOME: Method = {
  file: GSETTINGS_FILE,
  argv: GSETTINGS_ARGV,
  source: GNOME_SOURCE,
  parse: parseGsettingsBanners,
};
const KDE: Method = {
  file: GDBUS_FILE,
  argv: GDBUS_ARGV,
  source: KDE_SOURCE,
  parse: parseGdbusInhibited,
};

/** XDG_CURRENT_DESKTOP is a colon-separated list (`ubuntu:GNOME`). KDE wins when both appear. */
function methodFor(env: Readonly<Record<string, string | undefined>>): Method | null {
  const tokens = (env.XDG_CURRENT_DESKTOP ?? "")
    .toUpperCase()
    .split(":")
    .map((token) => token.trim());
  if (tokens.includes("KDE")) return KDE;
  if (tokens.includes("GNOME")) return GNOME;
  return null;
}

export interface OsDndOptions {
  platform: NodeJS.Platform;
  /** Only XDG_CURRENT_DESKTOP is read. */
  env: Readonly<Record<string, string | undefined>>;
  exec: DndExec;
  now: () => number;
}

/** Reads the OS Do Not Disturb state; `FocusDndReader`-compatible (`read()` is true / false / null). */
export class OsDndReader {
  private readonly method: Method | null;
  private readonly fixed: DndReading | null;
  private last: DndReading | null = null;
  private lastAt = 0;
  private inflight: Promise<DndReading> | null = null;
  private missing = false;

  constructor(private readonly options: OsDndOptions) {
    const { platform } = options;
    this.method = platform === "linux" ? methodFor(options.env) : null;
    let reason: DndUnknownReason | null = null;
    if (platform === "darwin") reason = "unsupported_macos";
    else if (platform === "win32") reason = "unsupported_windows";
    else if (platform !== "linux") reason = "unsupported_platform";
    else if (this.method === null) reason = "desktop_unsupported";
    this.fixed = reason === null ? null : { state: "unknown", platform, source: null, reason };
  }

  /** The most recent reading, or null before the first read. */
  reading(): DndReading | null {
    return this.fixed ?? this.last;
  }

  /** True when no read can ever succeed here (unsupported platform or desktop, tool not installed). */
  permanentlyUnavailable(): boolean {
    return this.fixed !== null || this.missing;
  }

  async read(): Promise<boolean | null> {
    const reading = await this.readReading();
    return reading.state === "unknown" ? null : reading.state === "on";
  }

  /** One reading. Never throws. Reuses a fresh reading and shares an in-flight read. */
  readReading(): Promise<DndReading> {
    if (this.fixed !== null) return Promise.resolve(this.fixed);
    if (this.missing && this.last !== null) return Promise.resolve(this.last);
    const now = this.options.now();
    if (this.last !== null && now >= this.lastAt && now - this.lastAt < DND_MIN_READ_INTERVAL_MS) {
      return Promise.resolve(this.last);
    }
    this.inflight ??= this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async run(): Promise<DndReading> {
    const method = this.method!;
    const { platform } = this.options;
    const unknown = (reason: DndUnknownReason): DndReading => ({
      state: "unknown",
      platform,
      source: method.source,
      reason,
    });
    let reading: DndReading;
    try {
      const run = await this.options.exec(method.file, method.argv, {
        timeoutMs: DND_EXEC_TIMEOUT_MS,
        maxOutputBytes: DND_EXEC_MAX_OUTPUT_BYTES,
      });
      if (run.notFound) {
        this.missing = true;
        reading = unknown("tool_missing");
      } else if (run.timedOut) reading = unknown("timeout");
      else if (run.outputCapped || run.stdout.length > DND_EXEC_MAX_OUTPUT_BYTES) {
        reading = unknown("output_too_large");
      } else if (run.code !== 0) reading = unknown("failed");
      else {
        const state = method.parse(run.stdout);
        reading =
          state === null
            ? unknown("unexpected_output")
            : { state, platform, source: method.source, reason: null };
      }
    } catch {
      reading = unknown("failed");
    }
    this.last = reading;
    this.lastAt = this.options.now();
    return reading;
  }
}

/** The real exec: argv only, no shell, a minimal environment, hard timeout, bounded output. */
export const execDnd: DndExec = (file, argv, limits) => {
  const done = Promise.withResolvers<DndExecResult>();
  const env: Record<string, string> = {};
  // The session bus is reached through these; nothing else of the environment is passed on.
  for (const name of ["PATH", "HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  try {
    execFile(
      file,
      [...argv],
      {
        timeout: limits.timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: limits.maxOutputBytes,
        windowsHide: true,
        encoding: "utf8",
        env,
      },
      (err, stdout) => {
        if (err === null) {
          done.resolve({
            code: 0,
            stdout: String(stdout),
            notFound: false,
            timedOut: false,
            outputCapped: false,
          });
          return;
        }
        const failure = err as Error & { code?: unknown; killed?: boolean };
        const capped = failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        done.resolve({
          code: typeof failure.code === "number" ? failure.code : null,
          stdout: "",
          notFound: failure.code === "ENOENT",
          // An output-limit stop also sets `killed`; only the other kills are the deadline.
          timedOut: failure.killed === true && !capped,
          outputCapped: capped,
        });
      },
    );
  } catch {
    done.resolve({ code: null, stdout: "", notFound: false, timedOut: false, outputCapped: false });
  }
  return done.promise;
};

/** The reader for this machine. Not constructed by default: Core's host (`main.ts`) opts in. */
export function createOsDndReader(
  platform: NodeJS.Platform = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env,
): OsDndReader {
  return new OsDndReader({ platform, env, exec: execDnd, now: Date.now });
}
