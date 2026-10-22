// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { CalendarEvent } from "./events";

export interface PriorMeeting {
  id: string;
  title: string;
  at: string;
  participants: readonly string[];
  project?: string;
}
export interface ReviewedItem {
  id: string;
  meetingId: string;
  kind: "decision" | "action_item";
  text: string;
  status: "accepted" | "edited" | "rejected" | "proposed";
  /** Optional: an action item the owner has marked done. Stores without a closed state omit it, which means open. */
  closed?: boolean;
}
export interface MeetingPrepQuery {
  /** Query only user-authorized meeting metadata and reviewed items; do not fetch transcripts. */
  meetings(scope: {
    participants: readonly string[];
    project?: string;
    before: string;
    limit: number;
  }): Promise<readonly PriorMeeting[]>;
  reviewedItems(meetingIds: readonly string[]): Promise<readonly ReviewedItem[]>;
}
export interface PrepSource {
  text: string;
  href: string;
  meetingTitle: string;
}
export interface MeetingPrep {
  decisions: PrepSource[];
  actionItems: PrepSource[];
}

/** The owner-readable query implementation enforces permissions before returning each record. */
export async function prepareMeeting(
  event: CalendarEvent,
  query: MeetingPrepQuery,
): Promise<MeetingPrep> {
  const prep: MeetingPrep = { decisions: [], actionItems: [] };
  if (event.private || event.cancelled || (!event.project && event.attendees.length === 0))
    return prep;
  const people = new Set(event.attendees.map((person) => person.toLowerCase()));
  const meetings = (
    await query.meetings({
      participants: event.attendees,
      project: event.project,
      before: event.start,
      limit: 40,
    })
  ).filter(
    (meeting) =>
      Date.parse(meeting.at) < Date.parse(event.start) &&
      (Boolean(event.project && meeting.project?.toLowerCase() === event.project.toLowerCase()) ||
        meeting.participants.some((person) => people.has(person.toLowerCase()))),
  );
  const ids = meetings.map((meeting) => meeting.id);
  if (!ids.length) return prep;
  const byId = new Map(meetings.map((meeting) => [meeting.id, meeting]));
  for (const item of await query.reviewedItems(ids)) {
    const source = byId.get(item.meetingId);
    if (!source || !["accepted", "edited"].includes(item.status) || !item.text.trim()) continue;
    if (item.kind === "action_item" && item.closed) continue;
    const detail: PrepSource = {
      text: item.text.slice(0, 500),
      meetingTitle: source.title.slice(0, 200),
      href: `#/meetings/${encodeURIComponent(source.id)}`,
    };
    if (item.kind === "decision") prep.decisions.push(detail);
    else prep.actionItems.push(detail);
  }
  return prep;
}
