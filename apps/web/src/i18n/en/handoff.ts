// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for handoff notes and the secret guard (Settings). */
export const handoff = {
  "handoff.title": "Handoff notes",
  "handoff.intro":
    "A handoff note is a short summary Phoenix builds, with fixed rules and no model, from what a coding agent reported during a session: the goal (only when the agent reported a task title), the files it changed with line counts, the commands it ran (with secrets removed) and any open questions. Phoenix has not checked any of it, so treat it as what the agent said, not as proof. Notes are stored on this computer in the Phoenix data folder, readable by you only; the newest 50 are kept, and “Delete all” for “handoff” in Privacy removes them.",

  "handoff.settings.legend": "Handoff settings",
  "handoff.settings.auto": "Write a note when an agent session ends",
  "handoff.settings.allowCloud":
    "Let a cloud model write the optional summary (off: a model on this device only)",
  "handoff.settings.cloudWarning":
    "If you turn this on, the note text (redacted commands and file names) can leave this computer for a cloud model when you ask for a summary. The cloud permissions in the AI settings still apply on top of this choice.",
  "handoff.settings.saved": "Settings saved.",
  "handoff.settings.unavailable": "Handoff settings could not be loaded.",
  "handoff.notes.unavailable": "Handoff notes could not be loaded.",
  "handoff.guard.unavailable": "The secret guard’s results could not be loaded.",
  "handoff.notes.title": "Saved notes",
  "handoff.notes.listLabel": "Handoff notes",
  "handoff.notes.empty": "No handoff note has been written yet.",
  "handoff.notes.open": "{date} {time} · {agent}",
  "handoff.notes.meta": "{project} · {files} · {lines}",
  "handoff.notes.files": "{count, plural, one {# file} other {# files}}",
  "handoff.notes.lines": "+{added} −{removed}",
  "handoff.notes.noProject": "no project",
  "handoff.notes.hasSummary": "Model summary",
  "handoff.notes.detailLabel": "Selected note",
  "handoff.notes.loading": "Loading the note…",
  "handoff.notes.trigger.auto": "Written automatically",
  "handoff.notes.trigger.user": "You asked for it",
  "handoff.notes.textLabel": "Note text",

  "handoff.summary.title": "Model summary",
  "handoff.summary.processedBy": "Written by: {by}",
  "handoff.summary.warning":
    "A model wrote this summary and it may be wrong. Check it before you rely on it.",
  "handoff.summary.add": "Add a model summary",
  "handoff.summary.note":
    "Phoenix only uses a model on this device, unless you allowed a cloud model above.",
  "handoff.summary.added": "Summary added.",

  "handoff.delete.button": "Delete note",
  "handoff.delete.done": "Note deleted.",

  "handoff.generate.title": "Write a note for a session",
  "handoff.generate.sessionLabel": "Session",
  "handoff.generate.choose": "Choose a session",
  "handoff.generate.option": "{agent} · {repository} · {time}",
  "handoff.generate.none":
    "No coding-agent session is known yet, so there is nothing to write a note about.",
  "handoff.generate.button": "Write a note",
  "handoff.generate.done": "Note written.",

  "handoff.attach.title": "Use this note",
  "handoff.attach.targetLabel": "Where it goes",
  "handoff.attach.target.commit_message": "A commit message",
  "handoff.attach.target.pr_description": "A pull request description",
  "handoff.attach.target.task": "A GitHub issue",
  "handoff.attach.repositoryLabel": "GitHub repository (owner/name)",
  "handoff.attach.repositoryInvalid": "Enter the repository as owner/name, for example acme/app.",
  "handoff.attach.preview": "Preview",
  "handoff.attach.previewAgain": "Preview again",
  "handoff.attach.confirm": "Confirm",
  "handoff.attach.previewLabel": "Preview of what will be attached",
  "handoff.attach.issueTitle": "Issue title: {title}",
  "handoff.attach.textLabel": "Exactly this text",
  "handoff.attach.delivery.copy":
    "Phoenix writes this nowhere: confirm to copy it, then paste it yourself.",
  "handoff.attach.delivery.copyPr":
    "Phoenix has no command that edits a pull request description yet: copy only. Confirm to copy it, then paste it yourself.",
  "handoff.attach.delivery.issue":
    "Phoenix will create a GitHub issue in {repository} with the github capability. You will be asked to confirm once more, and it needs the write token.",
  "handoff.attach.stale":
    "The note changed after this preview, so nothing was attached. Preview it again.",
  "handoff.attach.copied": "Copied to the clipboard. Paste it where you need it.",
  "handoff.attach.copyByHand":
    "Phoenix could not use the clipboard. Select the text below and copy it by hand.",
  "handoff.attach.issueCreated": "Created issue #{number} in {repository}.",
  "handoff.attach.issueExisting": "Issue #{number} in {repository} already existed.",
  "handoff.attach.issueAddress": "Address: {url}",

  "handoff.guard.title": "Secret guard",
  "handoff.guard.intro":
    "The secret guard is installed with the agent hook installer above: it is part of the hooks Phoenix adds to Claude Code and Codex. It blocks a tool call, a git commit or a git push whose input or staged changes contain a secret that Phoenix’s detector recognises, and it tells the agent which kind of secret was found and where, never the secret itself.",
  "handoff.guard.override":
    "You can override one block only through an approval card; the agent cannot override it.",
  "handoff.guard.heuristic":
    "The detector is a heuristic, not a promise that nothing leaks: a secret it does not recognise is not caught.",
  "handoff.guard.failOpen":
    "If Phoenix Core or the hook cannot run, the agent’s work continues (the guard fails open), except that a secret that is found is always blocked.",
  "handoff.guard.countsLabel": "Secret guard results",
  "handoff.guard.allowed": "Allowed after a check: {count}",
  "handoff.guard.blocked": "Blocked: {count}",
  "handoff.guard.overridden": "Allowed after you approved it: {count}",
  "handoff.guard.since": "Counted since {date} {time}",
  "handoff.guard.noResults": "No results yet.",
  "handoff.guard.recentLabel": "Recent secret guard results",
  "handoff.guard.row": "{date} {time} · {agent} · {tool}",
  "handoff.guard.outcome.blocked": "blocked",
  "handoff.guard.outcome.overridden": "allowed after you approved it",
  "handoff.guard.finding": "{kind} at {location}",
} as const;
