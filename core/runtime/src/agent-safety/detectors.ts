// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Loop and stall detectors (Phase 77). Pure: no clock of their own, no I/O, no events. The caller
// feeds observations (`step`, `waiting`, `resumed`, `finished`) and calls `check(now)` on a timer;
// every call returns the NEW findings only. A finding is raised once per episode: an episode ends
// when the pattern breaks (a different command, a different edit) or the session moves again.
//
// What the hooks let Phoenix see (and so what is detected):
//   - Steps carry no exit code and no output, so "the same FAILING command" is observed as "the same
//     command run N times in a row". A different command ends the streak.
//   - Steps carry no file content, only the lines added and removed. "A file edited back and forth"
//     is observed as consecutive edits of one file whose line counts swap (+a −r, then +r −a),
//     N reversals in a row. A pair of equal counts, a Write, or an edit of other lines is invisible.
export interface DetectorSettings {
  /** The same command, or the same reversal, this many times in a row raises a loop finding. */
  loopThreshold: number;
  /** An agent waiting on the user for this long raises a stall finding. */
  waitingMs: number;
  /** An active session silent for this long raises a stall finding. */
  idleMs: number;
  /** Sessions silent for this long are forgotten, so the table stays bounded. */
  forgetMs: number;
}

export const DEFAULT_DETECTOR_SETTINGS: DetectorSettings = {
  loopThreshold: 3,
  waitingMs: 10 * 60_000,
  idleMs: 30 * 60_000,
  forgetMs: 6 * 3_600_000,
};

export const MAX_TRACKED_SESSIONS = 200;
const MAX_TRACKED_FILES = 50;
const MAX_TEXT = 80;

export type FindingKind = "command" | "file" | "waiting" | "idle";

export interface Finding {
  type: "loop" | "stall";
  kind: FindingKind;
  agent: string;
  sessionId: string;
  /** Short, plain-language reason. Built from fixed words plus a clipped command or file name. */
  reason: string;
  /** Dedup key of the episode. */
  episode: string;
}

export interface StepObservation {
  agent: string;
  sessionId: string;
  kind: "read" | "edit" | "run" | "other";
  /** The (already redacted) command or path the hook reported. */
  target: string;
  /** Lines this single step added and removed in one file. */
  file?: { path: string; added: number; removed: number };
}

interface FileHistory {
  last: { added: number; removed: number };
  /** Consecutive edits of this file that exactly reversed the one before. */
  reversals: number;
}

interface SessionState {
  agent: string;
  sessionId: string;
  lastActivity: number;
  /** Set while the agent is waiting on the user. */
  waitingSince: number | null;
  /** The session finished a turn or ended: silence is expected, not a stall. */
  finished: boolean;
  command: { text: string; count: number } | null;
  files: Map<string, FileHistory>;
  /** Episodes already reported; an entry leaves when its pattern breaks. */
  open: Set<string>;
}

const clip = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
};

const minutes = (ms: number): number => Math.max(1, Math.round(ms / 60_000));

export class SafetyDetectors {
  private readonly sessions = new Map<string, SessionState>();

  constructor(private settings: DetectorSettings = DEFAULT_DETECTOR_SETTINGS) {}

  configure(settings: DetectorSettings): void {
    this.settings = settings;
  }

  /** Sessions currently tracked (tests and the status view). */
  size(): number {
    return this.sessions.size;
  }

  private state(agent: string, sessionId: string, now: number): SessionState {
    const key = `${agent}\u0000${sessionId}`;
    let s = this.sessions.get(key);
    if (!s) {
      s = {
        agent,
        sessionId,
        lastActivity: now,
        waitingSince: null,
        finished: false,
        command: null,
        files: new Map(),
        open: new Set(),
      };
      this.sessions.set(key, s);
      if (this.sessions.size > MAX_TRACKED_SESSIONS) {
        let oldest: [string, SessionState] | undefined;
        for (const entry of this.sessions) {
          if (!oldest || entry[1].lastActivity < oldest[1].lastActivity) oldest = entry;
        }
        if (oldest) this.sessions.delete(oldest[0]);
      }
    }
    return s;
  }

  /** One tool call the agent made. Returns loop findings it completes. */
  step(obs: StepObservation, now: number): Finding[] {
    const s = this.state(obs.agent, obs.sessionId, now);
    s.lastActivity = now;
    s.waitingSince = null;
    s.finished = false;
    s.open.delete("stall:waiting");
    s.open.delete("stall:idle");
    const found: Finding[] = [];
    const n = this.settings.loopThreshold;

    if (obs.kind === "run" && obs.target !== "") {
      if (s.command?.text === obs.target) s.command.count++;
      else {
        if (s.command) s.open.delete(`loop:command:${s.command.text}`);
        s.command = { text: obs.target, count: 1 };
      }
      const episode = `loop:command:${obs.target}`;
      if (s.command.count >= n && !s.open.has(episode)) {
        s.open.add(episode);
        found.push({
          type: "loop",
          kind: "command",
          agent: obs.agent,
          sessionId: obs.sessionId,
          reason: `The same command ran ${s.command.count} times in a row: ${clip(obs.target)}`,
          episode,
        });
      }
    }

    if (obs.kind === "edit" && obs.file) {
      const { path, added, removed } = obs.file;
      const prev = s.files.get(path);
      const reverses =
        prev !== undefined &&
        prev.last.added === removed &&
        prev.last.removed === added &&
        added + removed > 0;
      const history: FileHistory = {
        last: { added, removed },
        reversals: reverses ? prev.reversals + 1 : 0,
      };
      s.files.delete(path);
      s.files.set(path, history);
      if (s.files.size > MAX_TRACKED_FILES) {
        const oldest = s.files.keys().next().value;
        if (oldest !== undefined) {
          s.files.delete(oldest);
          s.open.delete(`loop:file:${oldest}`);
        }
      }
      const episode = `loop:file:${path}`;
      if (history.reversals < 1) s.open.delete(episode);
      // N edits in a row that each undo the last is N-1 reversals; `n` is the number of edits.
      if (history.reversals >= n - 1 && !s.open.has(episode)) {
        s.open.add(episode);
        found.push({
          type: "loop",
          kind: "file",
          agent: obs.agent,
          sessionId: obs.sessionId,
          reason: `The same file was edited back and forth ${history.reversals + 1} times: ${clip(path)}`,
          episode,
        });
      }
    }
    return found;
  }

  /** The agent is waiting on the user (a question, an approval, a permission). */
  waiting(agent: string, sessionId: string, now: number): void {
    const s = this.state(agent, sessionId, now);
    s.lastActivity = now;
    s.finished = false;
    s.waitingSince ??= now;
  }

  /** The agent is working again: the user answered, or it carried on. */
  resumed(agent: string, sessionId: string, now: number): void {
    const s = this.state(agent, sessionId, now);
    s.lastActivity = now;
    s.waitingSince = null;
    s.finished = false;
    s.open.delete("stall:waiting");
    s.open.delete("stall:idle");
  }

  /** The agent finished a turn or the session ended: silence is expected from here. */
  finished(agent: string, sessionId: string, now: number): void {
    const s = this.state(agent, sessionId, now);
    s.lastActivity = now;
    s.waitingSince = null;
    s.finished = true;
  }

  /** Time-based stalls at `now`; also forgets sessions silent for longer than `forgetMs`. */
  check(now: number): Finding[] {
    const found: Finding[] = [];
    for (const [key, s] of this.sessions) {
      if (now - s.lastActivity > this.settings.forgetMs) {
        this.sessions.delete(key);
        continue;
      }
      if (s.finished) continue;
      if (s.waitingSince !== null) {
        const waited = now - s.waitingSince;
        if (waited >= this.settings.waitingMs && !s.open.has("stall:waiting")) {
          s.open.add("stall:waiting");
          found.push({
            type: "stall",
            kind: "waiting",
            agent: s.agent,
            sessionId: s.sessionId,
            reason: `The agent has been waiting for you for ${minutes(waited)} min`,
            episode: "stall:waiting",
          });
        }
        continue;
      }
      const quiet = now - s.lastActivity;
      if (quiet >= this.settings.idleMs && !s.open.has("stall:idle")) {
        s.open.add("stall:idle");
        found.push({
          type: "stall",
          kind: "idle",
          agent: s.agent,
          sessionId: s.sessionId,
          reason: `No activity from the agent for ${minutes(quiet)} min`,
          episode: "stall:idle",
        });
      }
    }
    return found;
  }
}

/** What `agent.session.step` reports for a file: totals for the whole session, not for this step. */
export interface CumulativeFile {
  path: string;
  added: number;
  removed: number;
  edits: number;
}

/**
 * Turns the cumulative per-file totals of consecutive steps into what each step changed. A step is
 * measurable when the edit count went up by exactly one (nothing was missed in between); the first
 * edit of a file is measurable when it is edit number one. Anything else returns undefined, so no
 * guess ever feeds the back-and-forth detector.
 */
export class FileDeltas {
  private readonly last = new Map<string, CumulativeFile>();

  delta(file: CumulativeFile): { path: string; added: number; removed: number } | undefined {
    const prev = this.last.get(file.path);
    this.last.delete(file.path);
    this.last.set(file.path, file);
    if (this.last.size > MAX_TRACKED_FILES) {
      const oldest = this.last.keys().next().value;
      if (oldest !== undefined) this.last.delete(oldest);
    }
    const before = prev ?? { path: file.path, added: 0, removed: 0, edits: 0 };
    if (file.edits !== before.edits + 1) return undefined;
    const added = file.added - before.added;
    const removed = file.removed - before.removed;
    if (added < 0 || removed < 0) return undefined;
    return { path: file.path, added, removed };
  }
}
