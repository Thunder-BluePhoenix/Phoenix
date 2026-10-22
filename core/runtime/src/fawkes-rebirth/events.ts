// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
/** Source events are authoritative, ordered outcomes from a CI/PR adapter, not display-state changes. */
export interface BuildOutcome {
  kind: "build";
  /** Opaque, stable CI pipeline identifier; never a user name or URL. */
  stream: string;
  /** Strictly increasing sequence for this pipeline, supplied by its adapter. */
  sequence: number;
  result: "failed" | "passed" | "unknown";
  /** UTC event timestamp from the provider; not used as proof of recovery. */
  at: number;
}

export interface PullRequestOutcome {
  kind: "pull-request";
  /** Opaque repository identifier; no title, author or branch name is retained. */
  stream: string;
  /** Distinct PR identifier scoped to stream. */
  item: string;
  sequence: number;
  result: "merged" | "closed" | "unknown";
  at: number;
}

export type Outcome = BuildOutcome | PullRequestOutcome;
export type Celebration =
  | { kind: "rebirth"; stream: string }
  | { kind: "first-green-week"; stream: string }
  | { kind: "pr-streak"; stream: string };

export interface CelebrationOptions {
  /** Milestones are disabled unless the user explicitly enables them. */
  milestones?: boolean;
  /** Sunday = 0; ISO week starts Monday (UTC). */
  now?: () => number;
}

interface BuildState {
  sequence: number;
  streak: number;
  week: string | null;
}
interface PullState {
  sequence: number;
  streak: number;
  lastItem: string | null;
}

/**
 * Transient, bounded source-event gate. Attach one instance per authenticated adapter session.
 * Start with no inferred history: a green result alone (including after restart) is never a recovery.
 * A failed build followed by a newer pass on the SAME pipeline is the only rebirth trigger.
 * No persistence, user identity, badges, scores, or gameplay incentives.
 */
export function createCelebrationGate(options: CelebrationOptions = {}) {
  const builds = new Map<string, BuildState>();
  const pulls = new Map<string, PullState>();
  const clock = options.now ?? Date.now;
  const MAX_STREAMS = 128;
  const valid = (value: string) => value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9._:-]+$/.test(value);
  const weekOf = (timestamp: number): string => {
    const date = new Date(timestamp);
    const day = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - ((day + 6) % 7) + 3);
    return date.toISOString().slice(0, 10);
  };
  return {
    accept(event: Outcome): Celebration[] {
      if (!valid(event.stream) || !Number.isSafeInteger(event.sequence) || event.sequence < 0 ||
          !Number.isFinite(event.at) || event.at > clock() + 60_000 || event.at < 0) return [];
      if (event.kind === "build") {
        const previous = builds.get(event.stream);
        if (previous && event.sequence <= previous.sequence) return [];
        if (!previous && builds.size >= MAX_STREAMS) builds.delete(builds.keys().next().value!);
        const week = weekOf(event.at);
        const streak = event.result === "failed" ? (previous?.streak ?? 0) + 1 : 0;
        builds.set(event.stream, { sequence: event.sequence, streak, week: previous?.week ?? null });
        if (event.result !== "passed") return [];
        const result: Celebration[] = [];
        if (previous && previous.streak > 0) result.push({ kind: "rebirth", stream: event.stream });
        if (options.milestones && previous?.week !== week) {
          builds.get(event.stream)!.week = week;
          result.push({ kind: "first-green-week", stream: event.stream });
        }
        return result;
      }
      if (event.kind !== "pull-request" || !valid(event.item)) return [];
      const previous = pulls.get(event.stream);
      if (previous && event.sequence <= previous.sequence) return [];
      if (!previous && pulls.size >= MAX_STREAMS) pulls.delete(pulls.keys().next().value!);
      const streak = event.result === "merged" ? (previous?.streak ?? 0) + (previous?.lastItem !== event.item ? 1 : 0) : 0;
      pulls.set(event.stream, { sequence: event.sequence, streak, lastItem: event.result === "merged" ? event.item : null });
      return options.milestones && streak === 3 ? [{ kind: "pr-streak", stream: event.stream }] : [];
    },
    reset(): void { builds.clear(); pulls.clear(); },
  };
}
