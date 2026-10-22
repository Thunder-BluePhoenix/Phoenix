// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for the agent safety net (checkpoints, rollback, loop and stall warnings). */
export const safety = {
  "safety.title": "Agent safety net",
  "safety.intro":
    "Before a coding agent's first reported edit in a session, Phoenix saves a snapshot of the project in the project's own git repository (a hidden ref; your branches, index and stashes are never touched). You can roll the files back to it, after a preview and your approval.",
  "safety.timing":
    "Claude Code reports a step after the tool ran, so the snapshot is taken at the first report of an edit: that first edit is normally already in it. Rolling back undoes what the agent did after it, not the first edit itself.",
  "safety.ignored":
    "Files that git ignores (build output, logs, dependencies) are not saved and are never restored or deleted.",
  "safety.loadFailed": "The safety net could not be loaded: {error}",
  "safety.killSwitch": "The kill switch is on, so no new checkpoints are taken.",

  "safety.warnings.title": "Warnings from Fawkes",
  "safety.warnings.loop": "Loop",
  "safety.warnings.stall": "Stalled",
  "safety.warnings.line": "{kind} · {agent} in {repository}: {reason}",

  "safety.checkpoints.title": "Checkpoints",
  "safety.checkpoints.none":
    "No checkpoint yet. One is taken when an agent's first edit is reported.",
  "safety.checkpoints.row": "{agent} in {repository}",
  "safety.checkpoints.facts":
    "Taken {taken} · {count, plural, one {# file} other {# files}} · keeps until {expires}",
  "safety.checkpoints.rolledBack": "Rolled back {when}",
  "safety.checkpoints.preview": "Preview rollback…",
  "safety.checkpoints.previewLabel":
    "Preview the rollback to the checkpoint of {agent} in {repository}",
  "safety.checkpoints.close": "Close preview",

  "safety.skipped.title": "Sessions without a checkpoint",
  "safety.skipped.line": "{agent} in {repository}: {reason}",
  "safety.skipped.disabled": "the safety net is switched off",
  "safety.skipped.kill_switch": "the kill switch was on",
  "safety.skipped.not_git": "this folder is not a git repository, so there is nothing to snapshot",
  "safety.skipped.git_unavailable": "git could not be run",
  "safety.skipped.too_many_files": "the project has more files than the limit",
  "safety.skipped.too_large": "the project is larger than the size limit",
  "safety.skipped.throttled": "a checkpoint was already taken in this project in the last minute",
  "safety.skipped.snapshot_failed": "git could not take the snapshot",

  "safety.preview.title": "Rollback preview",
  "safety.preview.counts":
    "{restore, plural, one {# file would be restored} other {# files would be restored}}, {remove, plural, one {# new file would be deleted} other {# new files would be deleted}}, {kept, plural, one {# difference would be left alone} other {# differences would be left alone}}.",
  "safety.preview.restore": "Restored to the checkpoint",
  "safety.preview.remove": "New files that would be deleted",
  "safety.preview.kept": "Left alone",
  "safety.preview.change.modified": "modified",
  "safety.preview.change.deleted": "deleted by the agent",
  "safety.preview.change.type_changed": "type changed",
  "safety.preview.why.tracked_by_head": "tracked by git, so it is not deleted",
  "safety.preview.why.ignored": "ignored by git",
  "safety.preview.why.submodule": "a submodule",
  "safety.preview.why.unsafe_path": "path not safe to touch",
  "safety.preview.why.not_a_file": "not a regular file",
  "safety.preview.truncated": "The lists are cut; the counts above are exact.",
  "safety.preview.diff": "Changes since the checkpoint",
  "safety.preview.diffTruncated": "The diff is cut at its size limit.",
  "safety.preview.diffRedacted": "Some text that looked like a secret was masked.",
  "safety.preview.diffEmpty": "No text changes to show.",
  "safety.preview.nothing":
    "The files already match the checkpoint. There is nothing to roll back.",
  "safety.preview.refusal.repository_missing": "The project is no longer a git repository here.",
  "safety.preview.refusal.checkpoint_gone": "The snapshot is no longer in the repository.",
  "safety.preview.refusal.head_moved":
    "The repository's HEAD moved since the checkpoint (a commit or a branch switch). Phoenix will not roll back across it; nothing was changed.",
  "safety.preview.refusal.snapshot_failed": "Git could not read the working tree.",
  "safety.preview.approvalNote":
    "Rolling back asks for your approval first. It never changes git history, branches, the index or stashes, and it refuses if the files change after this preview.",

  "safety.rollback.button": "Roll back…",
  "safety.rollback.waiting": "Waiting for your approval in the approvals list above…",
  "safety.rollback.done":
    "Rolled back: {restored, plural, one {# file restored} other {# files restored}}, {removed, plural, one {# new file deleted} other {# new files deleted}}.",
  "safety.rollback.exact": "The files now match the checkpoint.",
  "safety.rollback.inexact":
    "Some differences were left alone, so the files do not match the checkpoint exactly.",

  "safety.settings.title": "Settings",
  "safety.settings.enabled": "Take a checkpoint when an agent's first edit is reported",
  "safety.settings.notify": "Send a notification when Fawkes warns about a loop or a stall",
  "safety.settings.retention": "Keep checkpoints for (days)",
  "safety.settings.maxFiles": "Skip projects with more files than",
  "safety.settings.loopThreshold": "Loop warning after this many repeats",
  "safety.settings.waitingMin": "Warn when an agent has waited on you for (minutes)",
  "safety.settings.idleMin": "Warn when an active agent is silent for (minutes)",
  "safety.settings.saved": "Saved.",
  "safety.settings.detectNote":
    "Hooks report no exit codes or file contents, so a loop means the same command run again and again, or a file whose edits keep undoing each other (by line counts).",
} as const;
