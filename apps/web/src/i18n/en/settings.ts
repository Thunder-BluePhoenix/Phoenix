// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for the Settings page: Fawkes, notifications, capabilities, support and privacy. */
export const settings = {
  "settings.title": "Settings",
  /** Between the items of a list shown in one line (", " in English). */
  "settings.listSeparator": ", ",

  "settings.fawkes.motion": "Motion",
  "settings.fawkes.motionAuto": "Follow my system setting",
  "settings.fawkes.motionOn": "Always reduce motion (Fawkes stays still)",
  "settings.fawkes.motionOff": "Always animate",
  "settings.fawkes.note":
    "Fawkes' state is always written out in text as well; animation never carries information on its own.",

  "settings.notifications.title": "Notifications",
  "settings.notifications.quiet": "Quiet mode (no notifications; activity is still recorded)",
  "settings.notifications.minSeverity": "Notify me about",
  "settings.notifications.severityWarning": "Warnings and errors",
  "settings.notifications.severityError": "Errors only",
  "settings.notifications.approvalsNote": "Requests for your approval always notify.",
  "settings.notifications.muteLegend": "Mute a capability",

  "settings.capabilities.title": "Capabilities",
  "settings.capability.status.notEnabled": "Not enabled",
  "settings.capability.status.disabled": "disabled",
  "settings.capability.status.failed": "failed",
  "settings.capability.status.disconnected": "disconnected",
  "settings.capability.enable": "Enable {name}",
  "settings.capability.disable": "Disable {name}",
  "settings.capability.restart": "Restart",
  "settings.capability.restartBlocked": "Restarting Kage now would lose the recording",
  "settings.capability.saveConfig": "Save configuration",
  "settings.capability.permissions": "Permissions",
  "settings.capability.revoke": "Revoke {detail}",
  "settings.capability.notGranted": "(not granted)",
  "settings.capability.accesses": "Accesses: {list}",

  "settings.capability.done.enabled": "Enabled.",
  "settings.capability.done.disabled": "Disabled.",
  "settings.capability.done.restarted": "Restarted.",
  "settings.capability.done.saved": "Saved.",
  "settings.capability.done.savedRestart": "Saved. Restart {name} to apply.",
  "settings.capability.done.secretSaved": "Saved to your OS keychain.",
  "settings.capability.done.secretRemoved": "Removed from your keychain.",
  "settings.capability.done.revoked": "Permission revoked. Enabling again asks for it again.",

  "settings.field.baseUrl": "Server address",
  "settings.field.pollMs": "Check every (ms)",
  "settings.field.botPath": "Kage bot path",
  "settings.field.botName": "Bot display name",
  "settings.field.maxDurationMin": "Maximum capture length (min)",
  "settings.field.repositories": "Repositories (one absolute path per line)",
  "settings.field.speed": "Playback speed",

  "settings.secret.apiKey": "API key",
  "settings.secret.stored": "(stored in your OS keychain)",
  "settings.secret.notSet": "(not set)",
  "settings.secret.placeholder": "Enter a new value to replace it",
  "settings.secret.save": "Save {name}",

  "settings.guard.region": "Agent session stop acknowledgement",
  "settings.guard.title": "Stopping active agent sessions",
  "settings.guard.bodyRestart":
    "Restarting {name} will stop these running or waiting sessions: {sessions}.",
  "settings.guard.bodyDisable":
    "Disabling {name} will stop these running or waiting sessions: {sessions}.",
  "settings.guard.acknowledge": "I acknowledge that these agent sessions will be stopped.",
  "settings.guard.confirmRestart": "Confirm restart",
  "settings.guard.confirmDisable": "Confirm disable",
  "settings.guard.capabilityChanged":
    "Capability changed. Review the current state before trying again.",
  "settings.guard.sessionsChanged":
    "Agent sessions changed. Review and acknowledge the current sessions.",
  "settings.guard.checkFailed": "Could not check agent sessions",
  "settings.guard.checkTimeout": "Checking agent sessions took too long",

  "settings.disclosure.region": "AI activation disclosure for {name}",
  "settings.disclosure.titleEnable": "Review AI access before enabling",
  "settings.disclosure.titleRestart": "Review AI access before restarting",
  "settings.disclosure.manifest":
    "Manifest version: {version}. Review the declared access and provider locality before activation.",
  "settings.disclosure.summary": "Capability: {name} — {description} ({kind})",
  "settings.disclosure.dataCategories": "Data categories: {list}",
  "settings.disclosure.noneDeclared": "None declared",
  "settings.disclosure.permissionsHeading": "Capability permissions",
  "settings.disclosure.permissionGranted": "{permission}: {description} (granted)",
  "settings.disclosure.permissionDenied": "{permission}: {description} (not granted)",
  "settings.disclosure.contextHeading": "Context sources",
  "settings.disclosure.toolsHeading": "AI tools and providers",
  "settings.disclosure.providerCloud": "Provider: {provider}; locality: external/cloud",
  "settings.disclosure.providerLocal": "Provider: {provider}; locality: local",
  "settings.disclosure.permissions": "Permissions: {list}",
  "settings.disclosure.dataAccess": "Data access:",
  "settings.disclosure.toolKind": "Kind: {kind}; command: {command}",
  "settings.disclosure.acknowledge":
    "I have reviewed AI access for manifest version {version} and acknowledge this activation.",
  "settings.disclosure.confirmEnable": "Confirm enable for version {version}",
  "settings.disclosure.confirmRestart": "Confirm restart for version {version}",

  "settings.support.title": "Support",
  "settings.support.intro":
    "If something is wrong, attach a diagnostics report to your bug report. It says how Phoenix is behaving (versions, capability health, counts, recent event names). It has no event contents, meeting titles, transcripts, settings values, secrets or file paths.",
  "settings.support.show": "Show diagnostics report",
  "settings.support.refresh": "Refresh report",
  "settings.support.copy": "Copy report",
  "settings.support.reportLabel": "Diagnostics report",
  "settings.support.copied": "Copied.",
  "settings.support.copyFailed": "Could not copy automatically. Select the text above and copy it.",

  "settings.privacy.title": "Privacy and data",
  "settings.privacy.location":
    "Everything stays on this computer, in {location}. Credentials are kept in your OS keychain, never in that folder.",
  "settings.privacy.data.events": "Activity history",
  "settings.privacy.data.notifications": "Notifications",
  "settings.privacy.data.meetings": "Meetings",
  "settings.privacy.data.memory": "Memory",
  "settings.privacy.what.events": "activity history",
  "settings.privacy.what.notifications": "notifications",
  "settings.privacy.what.meetings": "meetings",
  "settings.privacy.what.memory": "memory",
  "settings.privacy.stored": "({count} stored)",
  "settings.privacy.keep": "Keep",
  "settings.privacy.retention.forever": "Until I delete it",
  "settings.privacy.retention.days": "{days, plural, one {# day} other {# days}}",
  "settings.privacy.retention.year": "1 year",
  "settings.privacy.retentionUpdated": "{label}: retention updated.",
  "settings.privacy.deleteAll": "Delete all…",
  "settings.privacy.confirmDelete": "Confirm: delete all {what}",
  "settings.privacy.deleted.events":
    "{count, plural, one {Deleted # activity history record.} other {Deleted # activity history records.}}",
  "settings.privacy.deleted.notifications":
    "{count, plural, one {Deleted # notifications record.} other {Deleted # notifications records.}}",
  "settings.privacy.deleted.meetings":
    "{count, plural, one {Deleted # meetings record.} other {Deleted # meetings records.}}",
  "settings.privacy.deleted.memory":
    "{count, plural, one {Deleted # memory record.} other {Deleted # memory records.}}",
  "settings.privacy.deleted.other":
    "{count, plural, one {Deleted # record.} other {Deleted # records.}}",
  "settings.privacy.audit":
    "{label} ({count, plural, one {# entry} other {# entries}}): {description}",
  "settings.privacy.auditLog": "Audit log",
  "settings.privacy.credentialsLabel": "Credentials:",
  "settings.privacy.credentialsNone": "none stored.",
  "settings.privacy.telemetryLabel": "Telemetry:",
  "settings.privacy.telemetryNone": "Phoenix sends no telemetry.",
  "settings.privacy.externalAiLabel": "External AI:",
} as const;
