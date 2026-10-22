// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { basename } from "node:path";
import type { PhoenixEvent } from "@phoenix/protocol";
import type { Meeting } from "@phoenix/persistence";
import type { LiveSessionView } from "../../../api/src/agent-live-routes";
import { cleanTitle, type DigestSource } from "./index";

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Events that only END a blocker (an agent resumed); they never produce a line of their own. */
const RESUME_EVENTS = ["agent.working", "agent.started"];

/**
 * Which thing an event is about, so a later pass can clear an earlier failure: a CI workflow on a
 * branch of a repository, or one agent session. Empty when the event names nothing stable.
 */
function subjectOf(event: PhoenixEvent): string {
  const p = event.payload;
  if (event.source === "github") {
    const key = [text(p.repository), text(p.workflow), text(p.branch)].join("|");
    return key === "||" ? `ci:${text(event.subject)}` : `ci:${key}`;
  }
  if (event.source === "agents") return `agent:${text(p.agent)}:${text(p.agent_id)}`;
  if (event.source === "issues") return `task:${text(p.tracker)}:${text(p.key)}`;
  return "";
}

/**
 * Convert stored events into digest sources. Every claim is cited to the stored event itself
 * (`#/digest/event/<id>`) and labelled "Unverified event": `POST /api/events` can carry these
 * sources without capability authentication, and payload URLs are never followed or shown.
 */
export function eventDigestSources(events: readonly PhoenixEvent[]): DigestSource[] {
  const result: DigestSource[] = [];
  for (const event of events) {
    const payload = event.payload;
    const title = cleanTitle(
      event.source === "issues" && typeof payload.title === "string"
        ? payload.title
        : text(event.subject),
    );
    const href = /^evt_[A-Za-z0-9_-]{6,128}$/.test(event.event_id)
      ? `#/digest/event/${event.event_id}`
      : "";
    let kind: DigestSource["kind"];
    let status: DigestSource["status"];
    let clears = false;
    if (
      event.source === "github" &&
      ["github.ci.passed", "github.ci.failed"].includes(event.event_type)
    ) {
      kind = "ci";
      status = event.event_type.endsWith("failed") ? "blocked" : "done";
    } else if (
      event.source === "issues" &&
      ["issues.assigned", "issues.status_changed", "issues.completed"].includes(event.event_type)
    ) {
      kind = "task";
      if (event.event_type === "issues.completed" || payload.to === "done") status = "done";
      else if (event.event_type === "issues.assigned" || payload.to === "in_progress")
        status = "planned";
      else continue;
    } else if (
      event.source === "agents" &&
      ["agent.completed", "agent.failed", "agent.waiting", ...RESUME_EVENTS].includes(
        event.event_type,
      )
    ) {
      kind = "session";
      if (RESUME_EVENTS.includes(event.event_type)) {
        status = "done";
        clears = true;
      } else status = event.event_type === "agent.completed" ? "done" : "blocked";
    } else continue;
    // The event envelope is the only evidence here. External payload URLs are untrusted data.
    if (!title || !href) continue;
    const subject = subjectOf(event);
    result.push({
      kind,
      status,
      title: `Unverified event · ${title}`,
      href,
      occurredAt: event.timestamp,
      ...(subject ? { subject } : {}),
      ...(clears ? { clears: true as const } : {}),
    });
  }
  return result;
}

/** Meeting detail is local and stable; only pass this data when sensitive-meeting permission is on. */
export function meetingDigestSources(meetings: readonly Meeting[]): DigestSource[] {
  return meetings.flatMap((meeting) => {
    const title = cleanTitle(meeting.title ?? "");
    if (!title || !meeting.started_at || !meeting.ended_at || meeting.archived_at) return [];
    return [
      {
        kind: "meeting" as const,
        status: "done" as const,
        title,
        href: `#/meetings/${encodeURIComponent(meeting.id)}`,
        occurredAt: meeting.ended_at,
      },
    ];
  });
}

export interface SessionSourceOptions {
  /** Name the project folder in the line. Off by default, like the recap's share image. */
  projectNames?: boolean;
}

/** Only completed observed sessions have an EOD claim; active sessions are not called completed. */
export function sessionDigestSources(
  sessions: readonly LiveSessionView[],
  options: SessionSourceOptions = {},
): DigestSource[] {
  return sessions
    .filter((session) => !session.active && session.step_count > 0)
    .map((session) => ({
      kind: "session" as const,
      status: "done" as const,
      title: cleanTitle(
        options.projectNames
          ? `${session.agent} · ${basename(session.project)} (${session.step_count} steps)`
          : `${session.agent} (${session.step_count} steps)`,
      ),
      href: `#/agents/${encodeURIComponent(session.id)}`,
      occurredAt: session.last_seen,
    }));
}
