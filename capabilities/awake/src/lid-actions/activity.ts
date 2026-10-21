// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What Phoenix knows from Core's events, for the lid actions:
//   - whether the user is in a meeting, being recorded or dictating (kage.*, notetaker.*,
//     dictation.*, voice.*): the ProtectedState seam;
//   - the pids of coding agents Phoenix tracks (agent.* events that carry a numeric `pid`): the
//     AgentPids seam.
// Without a feed there is no way to know about a meeting, so the answer is "unknown", and unknown
// never allows a change (fail closed).
//
// Every activity is a SET of live ids (a capture's title, a session id): an end event removes only
// its own id, so two overlapping captures keep the flag on until both have ended. A meeting or
// recording never expires by itself: only its end event clears it (a lost end event keeps the lid
// actions off, which is the safe side). Dictation and voice are short by design (seconds to two
// minutes), so a lost "idle" for those stops counting after ACTIVITY_STALE_MS.
import type { AgentEventFeed, AwakeClock, FeedEvent } from "../system";
import type { AgentPids, ProtectedState } from "./types";

export const ACTIVITY_STALE_MS = 3 * 60 * 60_000;
export const MAX_TRACKED_PIDS = 200;

const SUBSCRIBER = "awake.lid.activity";
const PATTERNS = ["kage.*", "dictation.*", "notetaker.*", "voice.*", "agent.*"] as const;

/** Activities whose lost end event is forgotten after ACTIVITY_STALE_MS (they are short by design). */
const EXPIRES: Readonly<Record<string, true>> = { dictation: true, voice: true };
/** Most ids tracked per activity; further ids share the unnamed slot (never dropped). */
const MAX_IDS = 64;

/** event type → whether it starts (true) or ends (false) a protected activity. */
const EDGES: Record<string, { activity: string; on: boolean }> = {
  "kage.meeting.started": { activity: "meeting", on: true },
  "kage.meeting.recording": { activity: "meeting", on: true },
  "kage.meeting.ended": { activity: "meeting", on: false },
  "kage.meeting.failed": { activity: "meeting", on: false },
  "kage.capture.finished": { activity: "meeting", on: false },
  "dictation.listening": { activity: "dictation", on: true },
  "dictation.idle": { activity: "dictation", on: false },
  "notetaker.recording": { activity: "recording", on: true },
  "notetaker.idle": { activity: "recording", on: false },
  "voice.listening": { activity: "voice", on: true },
  "voice.idle": { activity: "voice", on: false },
};

const AGENT_LIVE: Record<string, true> = {
  "agent.started": true,
  "agent.working": true,
  "agent.progress": true,
  "agent.waiting": true,
  "agent.idle": true,
};
const AGENT_GONE: Record<string, true> = {
  "agent.completed": true,
  "agent.failed": true,
  "agent.ended": true,
};

export interface Activity {
  protectedState: ProtectedState;
  agentPids: AgentPids;
  stop(): void;
}

/** Which capture or session an event is about: `session`, else `title`, else `meeting_id`, else the unnamed slot. */
function idOf(event: FeedEvent): string {
  for (const key of ["session", "title", "meeting_id"] as const) {
    const value = event.payload?.[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 200) return value;
  }
  return "";
}

export function trackActivity(feed: AgentEventFeed | undefined, clock: AwakeClock): Activity {
  if (!feed) return { protectedState: () => "unknown", agentPids: () => [], stop() {} };
  /** activity → live id → when it started. */
  const live = new Map<string, Map<string, number>>();
  const agents = new Map<string, number>();
  const unsubscribe = feed.subscribe(SUBSCRIBER, PATTERNS, (event: FeedEvent) => {
    const edge = Object.hasOwn(EDGES, event.event_type) ? EDGES[event.event_type] : undefined;
    if (edge) {
      const ids = live.get(edge.activity) ?? new Map<string, number>();
      let id = idOf(event);
      if (edge.on) {
        if (!ids.has(id) && ids.size >= MAX_IDS) id = "";
        ids.set(id, clock.now());
        live.set(edge.activity, ids);
      } else {
        // An end event with an id nobody started (the title differs between the live capture and
        // the server's record) clears only the unnamed slot, never another capture.
        if (!ids.delete(id)) ids.delete("");
        if (ids.size === 0) live.delete(edge.activity);
      }
      return;
    }
    const id = event.payload?.agent_id;
    const pid = event.payload?.pid;
    if (typeof id !== "string" || id.length === 0 || id.length > 200) return;
    if (Object.hasOwn(AGENT_GONE, event.event_type)) agents.delete(id);
    else if (
      Object.hasOwn(AGENT_LIVE, event.event_type) &&
      typeof pid === "number" &&
      Number.isSafeInteger(pid) &&
      pid > 1
    ) {
      agents.delete(id);
      agents.set(id, pid);
      while (agents.size > MAX_TRACKED_PIDS) {
        const oldest = agents.keys().next();
        if (oldest.done) break;
        agents.delete(oldest.value);
      }
    }
  });
  return {
    protectedState() {
      const now = clock.now();
      for (const [activity, ids] of live) {
        if (Object.hasOwn(EXPIRES, activity)) {
          for (const [id, at] of ids) if (now - at >= ACTIVITY_STALE_MS) ids.delete(id);
        }
        if (ids.size === 0) live.delete(activity);
      }
      return live.size > 0 ? "active" : "idle";
    },
    agentPids: () => [...agents.values()],
    stop: unsubscribe,
  };
}
