// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
export const digest = {
  "digest.title": "Daily digest",
  "digest.yesterday": "Yesterday",
  "digest.today": "Today (confirmed plans)",
  "digest.blockers": "Blockers",
  "digest.endOfDay": "End of day",
  "digest.source": "Source",
  "digest.none": "No linked activity",
  "digest.date": "Date",
  "digest.localNote": "Built locally from linked activity. No cloud model is used.",
  "digest.error": "Unable to load or copy the digest.",
  "digest.loading": "Loading digest…",
  "digest.copy": "Copy with sources",
  "digest.copied": "Copied",
  "digest.sendUnavailable":
    "Slack and Teams sending is unavailable until an approved integration is connected.",
  "digest.back": "Back to digest",
  "digest.eventTitle": "Event evidence",
  "digest.eventMissing": "This event is no longer available.",
  "digest.unverified":
    "Unverified: this is a locally stored event claim, not provider-verified evidence.",
  "digest.commitTitle": "Commit",
  "digest.commitMissing": "This commit is not in a watched repository.",
  "digest.noneIncomplete": "Nothing found in the sources that could be read.",
  "digest.noticeHeading": "Incomplete digest",
  "digest.noticeUnavailable":
    "Could not be read, so this digest may be missing activity: {sources}.",
  "digest.noticePartial":
    "Only the newest records were read, so older activity may be missing: {sources}.",
  "digest.noticeUnattributed":
    "No git identity (user.email) is configured, so commits were left out rather than shown as yours: {sources}.",
  "digest.sources.git": "git repositories",
  "digest.sources.events": "event history",
  "digest.sources.sessions": "agent sessions",
  "digest.sources.meetings": "meetings",
} as const;
