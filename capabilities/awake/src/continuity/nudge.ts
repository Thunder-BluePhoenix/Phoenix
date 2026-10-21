// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Nudge: after a long outage, type `continue` into terminals the USER marked, so an agent that
// gave up waiting for the network carries on. A NudgeTarget is one such terminal:
//   * TmuxPaneTarget    a tmux pane id the user listed (`%12`)
//   * SessionTarget     a Phoenix-tracked agent session (Phase 34) the user enabled by id
// Rules held here: targets come from validated config only (never from agent or remote text);
// text is the constant `continue`; tmux gets it as a LITERAL (`-l`), so it can never be read as a
// key name; Enter is a separate keystroke sent only when the user enabled it; the pane must still
// exist and run a program from the user's allow-list (empty = refuse everything); every target is
// nudged at most once per outage; nothing is sent while the user is in a meeting or dictating.
// No shell anywhere: argv arrays through the injected Runner.
import { existsSync } from "node:fs";
import { isPaneId, isSessionId } from "./config";
import type { ProtectedSeam } from "./protected";
import type { AwakeClock, Runner, TimerHandle } from "../system";

export const NUDGE_TEXT = "continue";
const RUN_TIMEOUT_MS = 5_000;
/** While the user is protected, the nudge is re-checked this often. */
export const PROTECTED_RECHECK_MS = 30_000;

export type NudgeOutcome =
  | "sent"
  | "invalid_target"
  | "gone"
  | "command_not_allowed"
  | "pane_in_mode"
  | "unavailable"
  | "failed";

export interface NudgeTarget {
  /** Audit identity: the pane id or the session id, nothing else. */
  readonly id: string;
  readonly kind: "tmux" | "session";
  deliver(enter: boolean): Promise<NudgeOutcome>;
}

/** What the nudge asks tmux about a pane: its id, whether it is in a mode, its running program. */
const PANE_FORMAT = "#{pane_id} #{pane_in_mode} #{pane_current_command}";

/**
 * `#{pane_id} #{pane_in_mode} #{pane_current_command}` → the parts, or null if the line is not
 * that shape. `pane_in_mode` is `1` while the pane is in copy/view mode (keys would go to the
 * mode, not the program) and `0` otherwise; any other value makes the line invalid.
 */
export function parsePaneLine(
  output: string,
): { paneId: string; inMode: boolean; command: string } | null {
  const line = output.split("\n")[0]?.trim() ?? "";
  const match = /^(\S+) ([01]) (.+)$/.exec(line);
  if (match === null) return null;
  const [, paneId, mode, command] = match;
  if (paneId === undefined || command === undefined || !isPaneId(paneId)) return null;
  return { paneId, inMode: mode === "1", command: command.trim() };
}

/** Where tmux may live, in order. The PATH is never searched: a planted `tmux` must not get keystrokes. */
export const TMUX_PATHS: readonly string[] = [
  "/opt/homebrew/bin/tmux",
  "/usr/local/bin/tmux",
  "/usr/bin/tmux",
];

/** Real existence check; any filesystem error counts as "not there". */
export function realFileExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

export class TmuxPaneTarget implements NudgeTarget {
  readonly kind = "tmux";

  constructor(
    readonly id: string,
    private readonly run: Runner,
    private readonly allowedCommands: ReadonlySet<string>,
    private readonly exists: (path: string) => boolean = realFileExists,
  ) {}

  async deliver(enter: boolean): Promise<NudgeOutcome> {
    if (!isPaneId(this.id)) return "invalid_target";
    if (this.allowedCommands.size === 0) return "command_not_allowed";
    // Resolved at deliver time: tmux may be installed or removed while Core runs.
    const tmux = TMUX_PATHS.find((path) => this.exists(path));
    if (tmux === undefined) return "unavailable";
    const probe = await this.run(tmux, ["display-message", "-p", "-t", this.id, PANE_FORMAT], {
      timeoutMs: RUN_TIMEOUT_MS,
    });
    if (probe.code !== 0) return "gone";
    const pane = parsePaneLine(probe.stdout);
    if (pane === null || pane.paneId !== this.id) return "gone";
    // In copy/view mode a keystroke drives the mode (scrolling, searching), not the program.
    if (pane.inMode) return "pane_in_mode";
    if (!this.allowedCommands.has(pane.command)) return "command_not_allowed";
    const typed = await this.run(tmux, ["send-keys", "-t", this.id, "-l", NUDGE_TEXT], {
      timeoutMs: RUN_TIMEOUT_MS,
    });
    if (typed.code !== 0) return "failed";
    if (enter) {
      const pressed = await this.run(tmux, ["send-keys", "-t", this.id, "Enter"], {
        timeoutMs: RUN_TIMEOUT_MS,
      });
      if (pressed.code !== 0) return "failed";
    }
    return "sent";
  }
}

/**
 * Delivers text to a Phoenix-tracked agent session. The agents capability has `session.send`
 * (it writes `text + "\n"` to the session's stdin) but a capability cannot call another
 * capability's command from inside Core, and `session.send` always appends a newline, so it
 * cannot honour "Enter off". No such seam exists yet: GAP. This interface is that seam; a host
 * that implements it must send `text` and press Enter only if `enter` is true.
 */
export interface AgentSessionInput {
  send(sessionId: string, text: string, enter: boolean): Promise<boolean>;
}

export class SessionTarget implements NudgeTarget {
  readonly kind = "session";

  constructor(
    readonly id: string,
    private readonly input: AgentSessionInput | undefined,
  ) {}

  async deliver(enter: boolean): Promise<NudgeOutcome> {
    if (!isSessionId(this.id)) return "invalid_target";
    if (this.input === undefined) return "unavailable";
    try {
      return (await this.input.send(this.id, NUDGE_TEXT, enter)) ? "sent" : "gone";
    } catch {
      return "failed";
    }
  }
}

export interface NudgeReport {
  target: string;
  kind: NudgeTarget["kind"];
  outcome: NudgeOutcome;
}

export interface NudgeOptions {
  clock: AwakeClock;
  targets: readonly NudgeTarget[];
  afterMs: number;
  enter: boolean;
  isProtected: ProtectedSeam;
  /** Called once per target per outage with the pane/session id and the outcome. */
  onReport: (report: NudgeReport) => void;
}

/** One outage at a time: arm on "down", disarm on "up". Each target is nudged at most once. */
export class NudgeController {
  private timer: TimerHandle | undefined;
  private done = new Set<string>();
  private armed = false;
  private outageStart = 0;

  constructor(private readonly o: NudgeOptions) {}

  get nudgedCount(): number {
    return this.done.size;
  }

  /** `failingSince`: when the first failed probe of this outage happened. */
  onDown(failingSince: number): void {
    this.disarm();
    if (this.o.targets.length === 0) return;
    this.armed = true;
    this.done = new Set();
    this.outageStart = failingSince;
    const elapsed = Math.max(0, this.o.clock.now() - failingSince);
    this.schedule(Math.max(0, this.o.afterMs - elapsed));
  }

  onUp(): void {
    this.disarm();
    this.done = new Set();
  }

  stop(): void {
    this.disarm();
  }

  private disarm(): void {
    this.armed = false;
    if (this.timer !== undefined) this.o.clock.clearTimer(this.timer);
    this.timer = undefined;
  }

  private schedule(ms: number): void {
    this.timer = this.o.clock.setTimer(() => void this.fire(), ms);
  }

  /** Exposed for tests: the timer callback. */
  async fire(): Promise<void> {
    this.timer = undefined;
    if (!this.armed) return;
    const outage = this.outageStart;
    for (const target of this.o.targets) {
      if (this.done.has(target.id)) continue;
      // Checked before every target: a meeting can start between two sends.
      if (this.o.isProtected()) {
        this.schedule(PROTECTED_RECHECK_MS);
        return;
      }
      // Marked BEFORE sending: a send that fails or hangs is still the one attempt of this outage.
      this.done.add(target.id);
      const outcome = await target.deliver(this.o.enter);
      if (!this.armed || outage !== this.outageStart) return;
      this.o.onReport({ target: target.id, kind: target.kind, outcome });
    }
  }
}
