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
  "digest.slackHeading": "Send to Slack",
  "digest.slackDisclosure":
    "Sending shares this digest, cited activity, unverified event claims, and potentially meeting-derived content with the configured Slack channel. Core asks for confirmation before every send.",
  "digest.slackOptIn": "Allow daily-digest delivery to Slack",
  "digest.sendSlack": "Send to Slack",
  "digest.slack.disabled": "Daily-digest Slack delivery is off.",
  "digest.slack.chat_unavailable": "Chat Approvals must be enabled first.",
  "digest.slack.slack_unconfigured": "Configure and enable Slack in Chat Approvals first.",
  "digest.slack.missing_token": "The configured Slack bot token is unavailable.",
  "digest.slack.emergency_stop": "Delivery is blocked by the emergency stop.",
  "digest.slack.ready": "Slack delivery is ready.",
  "digest.slackUnavailable": "Daily-digest Slack delivery is unavailable.",
  "digest.slackWaiting": "Waiting for your Core confirmation…",
  "digest.slackError": "Slack delivery could not be completed. Nothing was retried automatically.",
  "digest.slackSent": "Daily digest for {day} was sent to Slack.",
  "digest.sendUnavailable":
    "Daily-digest Slack delivery is off until you opt in and configure Chat Approvals.",
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
