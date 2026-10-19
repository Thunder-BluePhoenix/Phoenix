// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Notion → Phoenix events. History rule (see ChangeTracker): an object first seen whose
// `last_edited_time` is before the capability was enabled is recorded silently; after that every
// edit (a newer last_edited_time) is announced once.
import { ChangeTracker } from "@phoenix/service-kit";
import type { NotionObject } from "./parse";

export interface NotionEvent {
  event_type: string;
  severity: "info";
  correlation_id: string;
  subject: string;
  payload: Record<string, unknown>;
}

export const EVENT_FOR_KIND: Readonly<Record<NotionObject["kind"], string>> = {
  page: "notion.page.updated",
  database: "notion.database.updated",
};

export function updateEvent(object: NotionObject): NotionEvent {
  return {
    event_type: EVENT_FOR_KIND[object.kind],
    severity: "info",
    correlation_id: `notion-${object.kind}-${object.id}`,
    subject: object.title,
    payload: {
      [`${object.kind}_id`]: object.id,
      title: object.title,
      archived: object.archived,
      edited_at: new Date(object.editedAt).toISOString(),
      ...(object.url ? { url: object.url } : {}),
    },
  };
}

export class ObjectDiff {
  private readonly tracker: ChangeTracker<NotionObject>;

  constructor(liveSince: number) {
    this.tracker = new ChangeTracker<NotionObject>({
      key: (object) => `${object.kind}:${object.id}`,
      state: (object) => `${object.editedAt}:${object.archived}`,
      at: (object) => object.editedAt,
      liveSince,
    });
  }

  update(objects: readonly NotionObject[]): NotionEvent[] {
    return this.tracker.update(objects).map((change) => updateEvent(change.item));
  }
}
