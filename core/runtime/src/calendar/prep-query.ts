// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { MeetingPrepQuery, PriorMeeting, ReviewedItem } from "@phoenix/capability-calendar";
import type { MeetingStore } from "@phoenix/persistence";
import type { MeetingItemService } from "@phoenix/ai-meetings";

/** Reads only local meeting metadata and items reviewed by the owner. Never reads meeting content. */
export class StoreMeetingPrepQuery implements MeetingPrepQuery {
  constructor(
    private readonly meetingsStore: MeetingStore,
    private readonly items: Pick<MeetingItemService, "list">,
    private readonly meetingsAllowed: () => boolean,
  ) {}

  async meetings(scope: {
    participants: readonly string[];
    project?: string;
    before: string;
    limit: number;
  }): Promise<readonly PriorMeeting[]> {
    if (!this.meetingsAllowed()) return [];
    const before = Date.parse(scope.before);
    if (!Number.isFinite(before) || !Number.isFinite(scope.limit) || scope.limit <= 0) return [];
    const people = new Set(scope.participants.map((person) => person.toLowerCase()));
    // Stored meeting records have no project field. A title is not an authorized project match.
    if (people.size === 0) return [];
    return this.meetingsStore
      .listAll()
      .filter(
        (meeting) =>
          !meeting.archived_at &&
          meeting.started_at &&
          Date.parse(meeting.started_at) < before &&
          meeting.participants?.some((person) => people.has(person.toLowerCase())),
      )
      .sort((a, b) => Date.parse(b.started_at!) - Date.parse(a.started_at!))
      .slice(0, Math.min(Math.floor(scope.limit), 500))
      .map((meeting) => ({
        id: meeting.id,
        title: meeting.title ?? "Meeting",
        at: meeting.started_at!,
        participants: meeting.participants ?? [],
      }));
  }

  async reviewedItems(meetingIds: readonly string[]): Promise<readonly ReviewedItem[]> {
    if (!this.meetingsAllowed()) return [];
    const result: ReviewedItem[] = [];
    for (const id of new Set(meetingIds)) {
      const meeting = this.meetingsStore.get(id);
      if (!meeting || meeting.archived_at) continue;
      for (const item of this.items.list(id)) {
        // Only items the owner accepted. An edited item still awaits approval and is not remembered.
        if ((item.kind !== "decision" && item.kind !== "action_item") || item.status !== "accepted")
          continue;
        result.push({
          id: item.id,
          meetingId: item.meetingId,
          kind: item.kind,
          text: item.text,
          status: item.status,
        });
      }
    }
    return result;
  }
}
