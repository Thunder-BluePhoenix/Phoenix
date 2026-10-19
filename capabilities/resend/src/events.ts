// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Resend → Phoenix event mapping. History rule (see ChangeTracker): an email first seen with a
// creation time before the capability was enabled is recorded silently, so enabling it does not
// replay last week's bounces. An email seen earlier is announced whenever its status changes.
import { ChangeTracker } from "@phoenix/service-kit";
import type { ResendEmail } from "./parse";

export interface ResendEvent {
  event_type: string;
  severity: "info" | "success" | "warning" | "error";
  correlation_id: string;
  subject: string;
  payload: Record<string, unknown>;
}

/** The delivery outcomes Phoenix announces; opens, clicks and in-flight states are not news. */
export const EVENT_FOR_STATE: Readonly<
  Record<string, { type: string; severity: ResendEvent["severity"] }>
> = {
  delivered: { type: "resend.email.delivered", severity: "success" },
  bounced: { type: "resend.email.bounced", severity: "warning" },
  failed: { type: "resend.email.failed", severity: "error" },
};

/** The page of the email on resend.com (built here from the validated id, never copied from the remote). */
export function emailUrl(id: string): string {
  return `https://resend.com/emails/${encodeURIComponent(id)}`;
}

export function emailEvent(email: ResendEmail): ResendEvent | undefined {
  const mapped = Object.hasOwn(EVENT_FOR_STATE, email.state)
    ? EVENT_FOR_STATE[email.state]
    : undefined;
  if (!mapped) return undefined;
  return {
    event_type: mapped.type,
    severity: mapped.severity,
    correlation_id: `resend-email-${email.id}`,
    subject: email.subject,
    payload: {
      email_id: email.id,
      subject: email.subject,
      status: email.state,
      to_count: email.toCount,
      to_domains: email.toDomains,
      url: emailUrl(email.id),
      created_at: new Date(email.createdAt).toISOString(),
    },
  };
}

export class EmailDiff {
  private readonly tracker: ChangeTracker<ResendEmail>;

  constructor(liveSince: number) {
    this.tracker = new ChangeTracker<ResendEmail>({
      key: (email) => email.id,
      state: (email) => email.state,
      at: (email) => email.createdAt,
      liveSince,
    });
  }

  /** Events for what changed since the last call, oldest email first. */
  update(emails: readonly ResendEmail[]): ResendEvent[] {
    return this.tracker
      .update(emails)
      .sort((a, b) => a.item.createdAt - b.item.createdAt)
      .flatMap((change) => emailEvent(change.item) ?? []);
  }
}
