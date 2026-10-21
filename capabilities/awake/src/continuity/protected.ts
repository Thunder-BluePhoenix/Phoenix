// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// "Protected" means the user is in a meeting, dictating or being recorded. While it is true,
// Phoenix never types into a terminal and never quits a browser. It is learned from the same
// Core events that drive Fawkes' RECORDING / LISTENING states. Without a feed there is no way to
// know, so the answer is "protected" (fail closed).
import type { AgentEventFeed, AwakeClock, FeedEvent } from "../system";

/** True while the user must not be interrupted. */
export type ProtectedSeam = () => boolean;

/** A flag nobody cleared this long ago (a lost "idle" event) stops counting. */
export const PROTECTED_STALE_MS = 3 * 60 * 60_000;

const SUBSCRIBER = "awake.continuity.protected";
const PATTERNS = ["kage.*", "dictation.*", "notetaker.*"] as const;

/** event type → whether it starts (true) or ends (false) a protected activity. */
const EDGES: Record<string, { activity: "meeting" | "dictation" | "recording"; on: boolean }> = {
  "kage.meeting.started": { activity: "meeting", on: true },
  "kage.meeting.recording": { activity: "meeting", on: true },
  "kage.meeting.ended": { activity: "meeting", on: false },
  "kage.meeting.failed": { activity: "meeting", on: false },
  "kage.capture.finished": { activity: "meeting", on: false },
  "dictation.listening": { activity: "dictation", on: true },
  "dictation.idle": { activity: "dictation", on: false },
  "notetaker.recording": { activity: "recording", on: true },
  "notetaker.idle": { activity: "recording", on: false },
};

export interface ProtectedTracker {
  readonly isProtected: ProtectedSeam;
  stop(): void;
}

export function trackProtected(
  feed: AgentEventFeed | undefined,
  clock: AwakeClock,
): ProtectedTracker {
  if (!feed) return { isProtected: () => true, stop() {} };
  const since = new Map<string, number>();
  const unsubscribe = feed.subscribe(SUBSCRIBER, PATTERNS, (event: FeedEvent) => {
    const edge = Object.hasOwn(EDGES, event.event_type) ? EDGES[event.event_type] : undefined;
    if (!edge) return;
    if (edge.on) since.set(edge.activity, clock.now());
    else since.delete(edge.activity);
  });
  return {
    isProtected() {
      const now = clock.now();
      for (const [activity, at] of since) {
        if (now - at >= PROTECTED_STALE_MS) since.delete(activity);
      }
      return since.size > 0;
    },
    stop: unsubscribe,
  };
}
