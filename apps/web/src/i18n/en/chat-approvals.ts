// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Settings for chat approvals (Phase 86). Errors are fixed texts, never Core's or a provider's own words. */
export const chatApprovals = {
  "chatApprovals.title": "Chat approvals",
  "chatApprovals.notAvailable": "Chat approvals are not available in this Phoenix Core.",
  "chatApprovals.intro":
    "Answer a pending agent or Phoenix approval from Slack or Discord, and get notified in Teams. Everything is off until you switch it on here, for each provider and each project.",
  "chatApprovals.limits":
    "Never used with a real Slack, Discord or Teams workspace: the code is tested only with simulated callbacks. Teams is notify-only (a link into Phoenix, never an Allow button). A button press is checked against the provider's signature and your approver list, and the decision is audited.",
  "chatApprovals.noDm":
    "Digests and notices go only to the channel set below. Direct messages to a person are not built.",
  "chatApprovals.capabilityOff": "The Chat approvals capability is off, so nothing is sent.",
  "chatApprovals.enable": "Turn on the capability",
  "chatApprovals.ready": "Ready: this provider can post cards.",
  "chatApprovals.notReady":
    "Not ready: it needs to be switched on, with a workspace id, a channel id and at least one approver.",
  "chatApprovals.teamsNote":
    "Teams is notify-only. Its webhook address and link key are stored below.",
  "chatApprovals.save": "Save chat approvals",
  "chatApprovals.saved": "Saved.",

  "chatApprovals.provider.slack": "Slack",
  "chatApprovals.provider.discord": "Discord",
  "chatApprovals.provider.teams": "Microsoft Teams",
  "chatApprovals.enabledNamed": "Enable {name}",
  "chatApprovals.notifyNamed": "Send a generic notice on {name}",
  "chatApprovals.digestNamed": "Include {name} in digests",
  "chatApprovals.notify": "Notify (no details) for requests not switched on",
  "chatApprovals.digest.send": "Receive the digest",
  "chatApprovals.workspace.slack": "Slack workspace (team) id",
  "chatApprovals.workspace.discord": "Discord server (guild) id",
  "chatApprovals.channel.slack": "Slack channel id",
  "chatApprovals.channel.discord": "Discord channel id",
  "chatApprovals.approvers.label": "{name} user ids that may decide (one per line)",
  "chatApprovals.approvers.hint":
    "Letters and digits only, up to 24 characters each, at most 20. An empty list means nobody can decide.",

  "chatApprovals.projects.title": "Projects allowed",
  "chatApprovals.projects.hint":
    "Only agent approvals from these projects may be answered from chat. Empty: none.",
  "chatApprovals.projects.label": "Project names (one per line)",

  "chatApprovals.digest.title": "Scheduled digest",
  "chatApprovals.digest.intro":
    "Off by default. Sends counts and short approval ids to the channel above, only to providers that receive the digest, never in quiet hours and never when nothing happened.",
  "chatApprovals.digest.enabled": "Send a scheduled digest",
  "chatApprovals.digest.interval": "Minutes between digests",
  "chatApprovals.digest.hint": "From {min} (one hour) to {max} minutes (one week).",

  "chatApprovals.cred.title": "Credentials",
  "chatApprovals.cred.writeOnly":
    "Write-only. What you type is sent to Core's credential store and removed from this page at once. Saved values are never shown again.",
  "chatApprovals.cred.save": "Save",
  "chatApprovals.cred.stored": "Stored",
  "chatApprovals.cred.notStored": "Not stored",
  "chatApprovals.cred.remove": "Remove",
  "chatApprovals.cred.removeNamed": "Remove stored {name}",
  "chatApprovals.field.slackBot": "Slack bot token",
  "chatApprovals.field.slackSigning": "Slack signing secret",
  "chatApprovals.field.discordBot": "Discord bot token",
  "chatApprovals.field.discordKey": "Discord application public key",
  "chatApprovals.field.teamsWebhook": "Teams webhook address",
  "chatApprovals.field.teamsKey": "Teams link key",

  "chatApprovals.error.ids":
    "Workspace and channel ids use letters and digits only, up to 24 characters.",
  "chatApprovals.error.approvers":
    "Approver ids use letters and digits only, up to 24 characters each, at most 20.",
  "chatApprovals.error.projects":
    "Project names must be 1 to 120 visible characters, at most 200 projects.",
  "chatApprovals.error.interval":
    "The digest interval must be a whole number from 60 to 10080 minutes.",
  "chatApprovals.error.save": "The chat approvals setting could not be saved.",
  "chatApprovals.error.capability": "The Chat approvals capability could not be changed.",
  "chatApprovals.error.unavailable":
    "This Phoenix Core has no OS credential store, so a credential cannot be kept.",
  "chatApprovals.error.cred": "The credential was not saved or removed.",
  "chatApprovals.error.credShape":
    "That value does not look right for this field, so it was not sent. Check it and try again.",
} as const;
