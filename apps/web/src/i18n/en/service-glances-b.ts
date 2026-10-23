// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for the Resend, Notion and Cal.com glances (Phase 67). */
export const serviceGlancesB = {
  "services.glance.resend.notConfigured":
    "Add a Resend API key in the Resend capability's secrets to see delivery status here.",
  "services.glance.resend.empty": "No recently sent emails to count.",
  "services.glance.resend.summary": "{count, plural, one {# recent email} other {# recent emails}}",
  "services.glance.resend.newest": "Newest: {time}",
  "services.glance.resend.privacy": "Counts only. Subjects and recipients are never shown here.",
  "services.glance.resend.state.delivered": "Delivered",
  "services.glance.resend.state.inFlight": "On the way",
  "services.glance.resend.state.delayed": "Delayed",
  "services.glance.resend.state.bounced": "Bounced",
  "services.glance.resend.state.complained": "Marked as spam",
  "services.glance.resend.state.failed": "Failed",
  "services.glance.resend.state.other": "Other",

  "services.glance.notion.notConfigured":
    "Add a Notion integration token in the Notion capability's secrets to see your watched pages here.",
  "services.glance.notion.empty":
    "No watched pages or databases to show. List them by id in the Notion capability's settings.",
  "services.glance.notion.summary": "{count, plural, one {# watched item} other {# watched items}}",
  "services.glance.notion.privacy": "Titles and edit times only. Page contents are never read.",
  "services.glance.notion.untitled": "Untitled",
  "services.glance.notion.kind.page": "Page",
  "services.glance.notion.kind.database": "Database",
  "services.glance.notion.kind.archived": "Archived",
  "services.glance.notion.edited": "Edited {time}",
  "services.glance.notion.open": "Open in Notion",
  "services.glance.notion.openNamed": "Open {title} in Notion",

  "services.glance.calcom.notConfigured":
    "Add a Cal.com API key in the Cal.com capability's secrets to see your bookings here.",
  "services.glance.calcom.empty": "No upcoming bookings.",
  "services.glance.calcom.summary":
    "{count, plural, one {# upcoming booking} other {# upcoming bookings}}",
  "services.glance.calcom.privacy":
    "Times and attendee counts only. Names and email addresses are never shown here.",
  "services.glance.calcom.booking": "Booking",
  "services.glance.calcom.status.accepted": "Confirmed",
  "services.glance.calcom.status.pending": "Waiting for confirmation",
  "services.glance.calcom.status.other": "Other",
  "services.glance.calcom.attendees": "{count, plural, one {# attendee} other {# attendees}}",
  "services.glance.calcom.more": "{count, plural, one {# more booking} other {# more bookings}}",
} as const;
