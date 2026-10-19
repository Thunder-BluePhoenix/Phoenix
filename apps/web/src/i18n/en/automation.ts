// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for the automation screens: workflows, plans and the automation settings sections. */
export const automation = {
  // ---- workflows: tables and checks (core/workflows.ts) ----
  "automation.workflows.environment.local": "Local",
  "automation.workflows.environment.dev": "Development",
  "automation.workflows.environment.staging": "Staging",
  "automation.workflows.environment.production": "PRODUCTION",
  "automation.workflows.environment.productionLive": "PRODUCTION (changes live systems)",

  "automation.workflows.runStatus.queued": "Queued",
  "automation.workflows.runStatus.running": "Running",
  "automation.workflows.runStatus.waiting_approval": "Waiting for your approval",
  "automation.workflows.runStatus.compensating": "Undoing earlier steps",
  "automation.workflows.runStatus.succeeded": "Succeeded",
  "automation.workflows.runStatus.rejected": "Rejected by you",
  "automation.workflows.runStatus.failed": "Failed",
  "automation.workflows.runStatus.failed_needs_attention": "Failed: needs your attention",
  "automation.workflows.runStatus.cancelled": "Cancelled",
  "automation.workflows.runStatus.interrupted": "Interrupted (Phoenix restarted)",
  "automation.workflows.runStatus.refused": "Refused: it was not allowed to run",

  "automation.workflows.stepStatus.running": "Running",
  "automation.workflows.stepStatus.waiting": "Waiting",
  "automation.workflows.stepStatus.succeeded": "Succeeded",
  "automation.workflows.stepStatus.failed": "Failed",
  "automation.workflows.stepStatus.timed_out": "Timed out (outcome unknown)",
  "automation.workflows.stepStatus.rejected": "Rejected",
  "automation.workflows.stepStatus.expired": "Expired",
  "automation.workflows.stepStatus.unknown": "Outcome unknown",

  "automation.workflows.authorisation.notNeeded": "No authorisation needed",
  "automation.workflows.authorisation.authorised": "Authorised for production",
  "automation.workflows.authorisation.notAuthorised": "NOT authorised: triggers are refused",

  "automation.workflows.expiry.invalid": "That is not a date and time.",
  "automation.workflows.expiry.past": "The expiry must be in the future.",
  "automation.workflows.expiry.tooFar": "The expiry can be at most {days} days away.",
  "automation.workflows.refused.noReason": "No reason was given.",
  "automation.workflows.payload.invalidJson": "The payload is not valid JSON.",
  "automation.workflows.payload.notObject": "The payload must be a JSON object, like '{}'.",
  "automation.workflows.payload.tooMany": "The payload can have at most {max} keys.",

  // ---- workflows: the list ----
  "automation.workflows.title": "Workflows",
  "automation.workflows.intro":
    "A workflow reacts to an event with a fixed list of steps. A workflow that changes production does nothing until you authorise exactly the definition you reviewed.",
  "automation.workflows.empty": "No workflows yet. Create one by reviewing a definition below.",
  "automation.workflows.row.runsWhen": "Runs when {event} happens · version {version}",
  "automation.workflows.row.cannotRun": "Cannot run: {problems}",
  "automation.workflows.row.metrics": "{started} run(s), {succeeded} succeeded",

  // ---- workflows: the numbers of one workflow ----
  "automation.workflows.metrics.title": "Numbers",
  "automation.workflows.metrics.label": "Metrics",
  "automation.workflows.metrics.none": "This workflow has not run yet, so there are no numbers.",
  "automation.workflows.metrics.started": "Runs started",
  "automation.workflows.metrics.succeeded": "Succeeded",
  "automation.workflows.metrics.failed": "Failed",
  "automation.workflows.metrics.attention": "Needing your attention",
  "automation.workflows.metrics.cancelled": "Cancelled",
  "automation.workflows.metrics.refused": "Refused",
  "automation.workflows.metrics.interrupted": "Interrupted",
  "automation.workflows.metrics.stepsFailed": "Steps that failed",
  "automation.workflows.metrics.stepsFailedValue": "{count} ({percent}% of steps)",
  "automation.workflows.metrics.approvalsWaiting": "Approvals waiting",
  "automation.workflows.metrics.approvalsOutcome": "Approvals approved / rejected / expired",
  "automation.workflows.metrics.approvalsOutcomeValue": "{approved} / {rejected} / {expired}",
  "automation.workflows.metrics.runTime": "Run time (median / 90th percentile)",
  "automation.workflows.metrics.runTimeValue":
    "{median} ms / {p90} ms over {samples, plural, one {# run} other {# runs}}",
  "automation.workflows.metrics.noFinishedRuns": "no finished runs",

  // ---- workflows: the definition editor ----
  "automation.workflows.editor.titleEdit": "Edit definition",
  "automation.workflows.editor.titleCreate": "Create workflow",
  "automation.workflows.editor.introExisting":
    'Enter the complete JSON definition. Keep "enabled": {enabled}; this edit preserves its current switch state. Saving does not authorise or run it. Checking never saves.',
  "automation.workflows.editor.introNew":
    'Enter the complete JSON definition. New definitions must have "enabled": false. Saving does not run, enable or authorise them. Checking never saves.',
  "automation.workflows.editor.label": "Workflow definition (JSON)",
  "automation.workflows.editor.check": "Check draft",
  "automation.workflows.editor.enterJson": "Enter a JSON workflow definition before checking it.",
  "automation.workflows.editor.notObject": "A workflow definition must be a JSON object.",
  "automation.workflows.editor.keepEnabled":
    'Keep "enabled": {enabled}. Change the switch separately after saving.',
  "automation.workflows.editor.setDisabled":
    'Set "enabled": false. Saving a new definition must not switch it on.',
  "automation.workflows.editor.keepId":
    "Editing must keep the same workflow ID. Use Create workflow for a new ID.",
  "automation.workflows.editor.notValid": "Not valid: {problems}",
  "automation.workflows.editor.noHash": "Validation did not return a valid definition hash.",
  "automation.workflows.editor.hashDiffers":
    "The saved definition hash differs from the reviewed hash. Review the stored definition before using it.",
  "automation.workflows.editor.savedExisting":
    "Definition saved. Existing switch state is unchanged; saving does not authorise it.",
  "automation.workflows.editor.savedNew":
    "Definition saved switched off. Saving does not authorise or enable it.",
  "automation.workflows.editor.reviewed": "Reviewed definition",
  "automation.workflows.editor.validLead": "Valid draft.",
  "automation.workflows.editor.valid":
    "{lead} Review this exact definition and hash before saving. A change requires another check.",
  "automation.workflows.editor.toSave": "Definition to save",
  "automation.workflows.editor.hash": "Validated hash: {hash}",
  "automation.workflows.editor.authRequired": "Authorisation required separately: {reasons}",
  "automation.workflows.editor.authNotRequired": "No authorisation required.",
  "automation.workflows.editor.switchOn": "Saving never authorises; the switch remains on.",
  "automation.workflows.editor.switchOff": "Saving never authorises; the switch remains off.",
  "automation.workflows.editor.switchNew":
    "Saving never authorises; the new workflow stays switched off.",
  "automation.workflows.editor.confirm": "Confirm: save exactly this definition",
  "automation.workflows.editor.reviewStored": "Review stored workflow",

  // ---- workflows: checking the stored definition ----
  "automation.workflows.validate.button": "Check the definition",
  "automation.workflows.validate.dryRun": "A dry run. Nothing is saved and nothing runs.",
  "automation.workflows.validate.validLead": "Valid.",
  "automation.workflows.validate.valid": "{lead} Hash {hash}. {authorisation}",
  "automation.workflows.validate.needsAuth": "Needs your authorisation: {reasons}.",
  "automation.workflows.validate.noAuth": "No authorisation needed.",
  "automation.workflows.validate.invalidLead": "Not valid.",
  "automation.workflows.validate.invalid": "{lead} {count, plural, other {# problem(s):}}",
  "automation.workflows.validate.problems": "Problems",

  // ---- workflows: authorising ----
  "automation.workflows.authorise.title": "Authorise for production",
  "automation.workflows.authorise.notNeeded": "This workflow does not need authorisation.",
  "automation.workflows.authorise.why": "Why it needs your authorisation:",
  "automation.workflows.authorise.reasons": "Reasons",
  "automation.workflows.authorise.intro":
    "This will let the workflow {name} run whenever {event} happens, with no further question for these steps unless the workflow asks:",
  "automation.workflows.authorise.allowed": "What would be allowed to run",
  "automation.workflows.authorise.noTools": "It calls no tools.",
  "automation.workflows.authorise.step": "Step {step} calls {tool}",
  "automation.workflows.authorise.stepUndo": "Step {step} calls {tool} (undo: {undo})",
  "automation.workflows.authorise.being":
    "Definition being authorised: version {version}, hash {hash}",
  "automation.workflows.authorise.expires": "Expires {hint}",
  "automation.workflows.authorise.expiresHint": "(optional, within {days} days)",
  "automation.workflows.authorise.submit": "Authorise exactly this definition",
  "automation.workflows.authorise.done":
    "Authorised version {version}. Any later change to the definition ends this.",

  // ---- workflows: run now ----
  "automation.workflows.runNow.title": "Run now",
  "automation.workflows.runNow.intro":
    "Starts the workflow by hand with the same checks as when its event happens: enabled, not stopped by the emergency stop, valid, and authorised if it changes production.",
  "automation.workflows.runNow.payload": "Data the event would have carried {hint}",
  "automation.workflows.runNow.payloadHint": "(a JSON object, optional)",
  "automation.workflows.runNow.button": "Run now",
  "automation.workflows.runNow.cannotRun": "It cannot run: {problems}",
  "automation.workflows.runNow.enableFirst": "Enable the workflow to run it.",
  "automation.workflows.runNow.refusedLead": "The start was refused.",
  "automation.workflows.runNow.seeRefused": "See the refused run",
  "automation.workflows.runNow.started": "Started. {link}",
  "automation.workflows.runNow.follow": "Follow the run",

  // ---- workflows: one workflow ----
  "automation.workflows.detail.all": "All workflows",
  "automation.workflows.detail.backAll": "← All workflows",
  "automation.workflows.detail.productionLead": "Production.",
  "automation.workflows.detail.production":
    "{lead} This workflow can change live systems. It runs only while you have authorised its exact definition.",
  "automation.workflows.detail.cannotRunNow": "It cannot run right now:",
  "automation.workflows.detail.definition": "Definition",
  "automation.workflows.detail.versionHash": "Version {version} · hash {hash}",
  "automation.workflows.detail.runsWhen": "Runs when {event} happens.",
  "automation.workflows.detail.runsWhenAnd": "Runs when {event} happens and {condition}.",
  "automation.workflows.detail.tools": "Tools it can call",
  "automation.workflows.detail.toolsLabel": "Tools",
  "automation.workflows.detail.none": "None.",
  "automation.workflows.detail.toolStep": "Step {step}: {tool}",
  "automation.workflows.detail.flagged": "Production or critical action",
  "automation.workflows.detail.declaredUndo": "declared undo: {undo}",
  "automation.workflows.detail.definitionText": "Definition (read-only text, scrolls)",
  "automation.workflows.detail.unreadable": "The stored definition could not be read.",
  "automation.workflows.detail.switch": "Switch",
  "automation.workflows.detail.enable": "Enable",
  "automation.workflows.detail.disable": "Disable",
  "automation.workflows.detail.switchNote":
    "Enabling does not authorise. An enabled production workflow that is not authorised records every trigger as refused.",
  "automation.workflows.detail.authorisations": "Authorisations",
  "automation.workflows.detail.noneYet": "None yet.",
  "automation.workflows.detail.inForce": "In force",
  "automation.workflows.detail.revoked": "Revoked",
  "automation.workflows.detail.notInForce": "Not in force",
  "automation.workflows.detail.authorisedBy": "by {by} on {date}",
  "automation.workflows.detail.authExpires": "expires {date}",
  "automation.workflows.detail.authChanged": "the definition changed or it expired",
  "automation.workflows.detail.forHash": "for hash {hash}",
  "automation.workflows.detail.confirmRevoke": "Confirm: revoke authorisation",
  "automation.workflows.detail.revoke": "Revoke authorisation…",
  "automation.workflows.detail.revokeNote": "Runs in flight stop at their next step.",
  "automation.workflows.detail.recentRuns": "Recent runs",
  "automation.workflows.detail.noRuns": "No runs yet.",

  // ---- workflows: runs and steps ----
  "automation.workflows.run.needsLook": "(needs a look)",
  "automation.workflows.run.notSuccess": "(not a success)",
  "automation.workflows.run.nowAtStep": "now at step {step}",
  "automation.workflows.run.atStep": "at step {step}",
  "automation.workflows.run.backToWorkflow": "Back to the workflow",
  "automation.workflows.run.title": "Run of {name}",
  "automation.workflows.run.created": "Created {date}",
  "automation.workflows.run.finished": "finished {date}",
  "automation.workflows.run.chainDepth": "chain depth {depth}",
  "automation.workflows.run.waitingForYou": "Waiting for you",
  "automation.workflows.run.stop": "Stop this run",
  "automation.workflows.run.confirmCancel": "Confirm: cancel this run",
  "automation.workflows.run.keepRunning": "Keep running",
  "automation.workflows.run.cancel": "Cancel this run…",
  "automation.workflows.run.cancelNote":
    "A cancel does not run declared undo steps. A step already in progress may still finish.",
  "automation.workflows.run.trigger": "What started it",
  "automation.workflows.run.triggerText": "Trigger (plain text, scrolls)",
  "automation.workflows.run.stepsHeading": "Steps ({count})",
  "automation.workflows.run.stepsLabel": "Steps",
  "automation.workflows.run.noSteps": "No step has started.",
  "automation.workflows.step.undo": "Undo: {step}",
  "automation.workflows.step.attempts": "{count, plural, one {# attempt} other {# attempts}}",
  "automation.workflows.step.changesState": "Changes state",
  "automation.workflows.step.destructive": "{lead}: this step can change a real system.",
  "automation.workflows.step.tool": "Tool {tool}",
  "automation.workflows.step.input": "Input of step {step} (plain text, scrolls)",
  "automation.workflows.step.output": "Output of step {step} (plain text, scrolls)",

  // ---- plans: tables and checks (core/plans.ts) ----
  "automation.plans.status.draft": "Draft: not yet proposed",
  "automation.plans.status.proposed": "Proposed: waiting for your approval",
  "automation.plans.status.approved": "Approved: ready to create",
  "automation.plans.status.creating": "Creating tasks…",
  "automation.plans.status.created": "Created",
  "automation.plans.status.failed": "Failed: some tasks were not created",
  "automation.plans.status.cancelled": "Cancelled",
  "automation.plans.basis.meeting": "from the meeting",
  "automation.plans.basis.suggested": "suggested by the model",
  "automation.plans.basis.user": "written by you",
  "automation.plans.run.pending": "Not started",
  "automation.plans.run.attempting": "In progress",
  "automation.plans.run.created": "Created",
  "automation.plans.run.failed": "Failed",
  "automation.plans.tool.githubIssue": "Create a GitHub issue",
  "automation.plans.tool.frappeTask": "Create a Frappe task",
  "automation.plans.kind.decision": "decision",
  "automation.plans.kind.action_item": "action item",
  "automation.plans.kind.requirement": "requirement",
  "automation.plans.authorship.rules":
    "Rules-based draft: no AI wrote this, it only restates the meeting item.",
  "automation.plans.authorship.model":
    "Model output ({model}): check it against the meeting before approving.",
  "automation.plans.destination.github": "GitHub repository {repository}",
  "automation.plans.destination.frappe": "Frappe site {site}",
  "automation.plans.problem.repository": 'The repository must look like "owner/name".',
  "automation.plans.problem.site": "That is not a valid Frappe site name.",
  "automation.plans.problem.titleEmpty": "The title cannot be empty.",
  "automation.plans.problem.titleLong": "The title is longer than {max}.",
  "automation.plans.problem.summaryEmpty": "The summary cannot be empty.",
  "automation.plans.problem.summaryLong": "The summary is longer than {max}.",
  "automation.plans.problem.taskCount": "A plan needs 1 to {max} tasks.",
  "automation.plans.problem.taskTitle": "Task {n} needs a title.",
  "automation.plans.problem.bodyLong": "The body is longer than {max}.",
  "automation.plans.problem.labelCount": "At most {max} labels.",
  "automation.plans.problem.labelLong": "A label is longer than {max}.",

  // ---- plans: make a plan from a meeting item ----
  "automation.plans.off": "Planning is off.",
  "automation.plans.make.open": "Make a plan…",
  "automation.plans.make.openFrom": "Make a plan from {kind}: {text}",
  "automation.plans.make.intro":
    "A plan is a draft of engineering tasks. Nothing is created until you approve it and confirm each task.",
  "automation.plans.make.where": "Where would the tasks go?",
  "automation.plans.make.githubIssues": "GitHub issues",
  "automation.plans.make.frappeTasks": "Frappe tasks",
  "automation.plans.make.repository": "Repository (owner/name)",
  "automation.plans.make.site": "Frappe site",
  "automation.plans.make.chooseSite": "Choose a site",
  "automation.plans.make.drafting": "Drafting the plan…",
  "automation.plans.make.draft": "Draft a plan",
  "automation.plans.make.localModel":
    "A local model can take a minute. Nothing is sent anywhere else.",
  "automation.plans.make.drafted": "Plan drafted.",
  "automation.plans.make.openPlan": "Open the plan",

  // ---- plans: on a meeting ----
  "automation.plans.meeting.title": "Plans and tasks from this meeting",
  "automation.plans.meeting.plans": "Plans",
  "automation.plans.meeting.summary": "{status} · {count, plural, other {# task(s)}} · {system}",
  "automation.plans.meeting.tasksCreated": "Tasks created",
  "automation.plans.meeting.tasksLabel": "Tasks created from this meeting",
  "automation.plans.link.frappeTask": "Task {id}",
  "automation.plans.link.detail": "task {index} of {plan} · approved {date}",
  "automation.plans.link.itsPlan": "its plan",

  // ---- plans: the editor ----
  "automation.plans.editor.label": "Edit the plan",
  "automation.plans.editor.title": "Title {hint}",
  "automation.plans.editor.summary": "Summary {hint}",
  "automation.plans.editor.upTo": "(up to {max})",
  "automation.plans.editor.tasks": "Tasks {hint}",
  "automation.plans.editor.tasksRange": "(1 to {max})",
  "automation.plans.editor.task": "Task {n}",
  "automation.plans.editor.taskTitle": "Task {n} title",
  "automation.plans.editor.taskBody": "Task {n} body {hint}",
  "automation.plans.editor.taskLabels": "Task {n} labels {hint}",
  "automation.plans.editor.labelsHint": "(comma separated, up to {max})",
  "automation.plans.editor.removeTask": "Remove task {n}",
  "automation.plans.editor.addTask": "Add a task",
  "automation.plans.editor.note":
    "Saving returns the plan to draft and clears any approval. You then propose and approve it again.",
  "automation.plans.editor.save": "Save changes",

  // ---- plans: preview and results ----
  "automation.plans.preview.title": "Exactly what would be sent",
  "automation.plans.preview.intro":
    "Each task is one call made as you. This is the real input, shown as plain text.",
  "automation.plans.preview.calls": "Calls that would be made",
  "automation.plans.preview.task": "Task {n}: {tool}",
  "automation.plans.preview.decision": "(effect: {effect}, risk: {risk})",
  "automation.plans.preview.input": "Input of task {n} (plain text, scrolls)",
  "automation.plans.runs.title": "Task by task",
  "automation.plans.runs.label": "Task results",
  "automation.plans.runs.task": "Task {n}:",
  "automation.plans.runs.attempts": "{count, plural, one {# attempt} other {# attempts}}",
  "automation.plans.runs.frappeTask": "Frappe Task {id}",
  "automation.plans.runs.stopped":
    "Stopped at task {n}: {message}. Nothing after it was created. You can run Create again: tasks that exist are found, not duplicated.",

  // ---- plans: one plan ----
  "automation.plans.page.allMeetings": "All meetings",
  "automation.plans.page.meeting": "← The meeting",
  "automation.plans.page.rules": "Rules-based draft",
  "automation.plans.page.model": "Model output",
  "automation.plans.page.destination": "Destination: {destination}",
  "automation.plans.page.from": "From {kind}: {text}",
  "automation.plans.page.owner": "owner {owner}",
  "automation.plans.page.due": "due {due}",
  "automation.plans.page.proposedNotice": "Proposed. Check the preview, then approve.",
  "automation.plans.page.approvedNotice": "Approved. Nothing has been created yet.",
  "automation.plans.page.savedNotice":
    "Saved. The plan is a draft again; propose it to approve it.",
  "automation.plans.page.cancelledNotice": "Cancelled. Nothing was created.",
  "automation.plans.page.plan": "The plan",
  "automation.plans.page.tasks": "Tasks ({count})",
  "automation.plans.page.tasksLabel": "Tasks",
  "automation.plans.page.labels": "Labels:",
  "automation.plans.page.edit": "Edit the plan",
  "automation.plans.page.acceptance": "Acceptance criteria",
  "automation.plans.page.risks": "Risks",
  "automation.plans.page.questions": "Open questions",
  "automation.plans.frappe.doctype": "Proposed Frappe DocType: {doctype}",
  "automation.plans.frappe.note":
    "Suggested design only. Creating tasks does not create this DocType, its fields, workflow or permissions.",
  "automation.plans.frappe.fields": "Fields",
  "automation.plans.frappe.fieldsLabel": "Proposed Frappe fields",
  "automation.plans.frappe.required": "required",
  "automation.plans.frappe.noFields": "No fields proposed.",
  "automation.plans.frappe.states": "Workflow states",
  "automation.plans.frappe.statesLabel": "Proposed Frappe workflow states",
  "automation.plans.frappe.noStates": "No workflow states proposed.",
  "automation.plans.frappe.permissions": "Permissions",
  "automation.plans.frappe.permissionsLabel": "Proposed Frappe permissions",
  "automation.plans.frappe.noPermissions": "No permissions proposed.",
  "automation.plans.frappe.access": "{role}: {access}",
  "automation.plans.frappe.read": "read",
  "automation.plans.frappe.write": "write",
  "automation.plans.frappe.create": "create",
  "automation.plans.frappe.noAccess": "no access",
  "automation.plans.decide.title": "Decide",
  "automation.plans.decide.fingerprint":
    "Fingerprint of what you are looking at: {hash}. Approval covers exactly this content; if the plan changes it is refused.",
  "automation.plans.decide.propose": "Propose this plan",
  "automation.plans.decide.nameMeeting": "Name the meeting in the created tasks",
  "automation.plans.decide.approve": "Approve this exact plan",
  "automation.plans.decide.approved": "Approved by {by} on {date}.",
  "automation.plans.decide.approvedNamed":
    "Approved by {by} on {date} · the meeting is named in the tasks.",
  "automation.plans.decide.understand":
    "I understand this creates {count, plural, one {# task} other {# tasks}} in {destination}, as me.",
  "automation.plans.decide.createRemaining": "Create the remaining tasks",
  "automation.plans.decide.create": "Create tasks",
  "automation.plans.decide.waiting": "Waiting for your approval of task {n} of {total}.",
  "automation.plans.decide.waitingNote":
    "Core asks you before each task is created. Answer below; this page waits for as long as it takes.",
  "automation.plans.decide.cancel": "Cancel this plan",

  // ---- automation settings (AutomationSettings.tsx) ----
  "automation.settings.title": "Automation",
  "automation.settings.intro":
    "Automation is off until you turn it on. While it is off, Fawkes starts no tasks and runs nothing by itself. When it is on, Fawkes can only start a task when you ask for one, such as “Diagnose a CI failure” in the Chat tab. It reads data and proposes; anything that changes something waits for your approval, and you can cancel a task at any time. Turning automation off cancels every task that is running.",
  "automation.settings.allow": "Allow Fawkes to run tasks I start",
  "automation.settings.statusOn":
    "Automation is on. {active, plural, one {# task is} other {# tasks are}} running (at most {max} at once).",
  "automation.settings.statusOff":
    "Automation is off. {active, plural, one {# task is} other {# tasks are}} running (at most {max} at once).",
  "automation.settings.unavailable":
    "Automation settings are not available from Phoenix Core ({error}).",

  // ---- proactive suggestions (ProactiveSettings.tsx) ----
  "automation.proactive.title": "Proactive suggestions",
  "automation.proactive.intro":
    "Off by default. The only supported source is accepted, unassigned action items from Kage meetings. Kage must be available. No deployment prediction, incident or dependency provider is available. Evaluation is manual unless you explicitly select a cadence after opting in. Scheduled evaluation runs locally and respects quiet hours, rate limits and emergency stop.",
  "automation.proactive.status": "Kage source: {source}. Suggestions are {state} ({cadence}).",
  "automation.proactive.sourceAvailable": "available",
  "automation.proactive.sourceUnavailable": "unavailable",
  "automation.proactive.stateOn": "on",
  "automation.proactive.stateOff": "off",
  "automation.proactive.cadenceEvery": "every {minutes, plural, one {# minute} other {# minutes}}",
  "automation.proactive.cadenceManual": "manual only",
  "automation.proactive.optIn": "Opt in",
  "automation.proactive.enable": "Enable proactive suggestions",
  "automation.proactive.kageItems": "Kage accepted, unassigned action items",
  "automation.proactive.cadence": "Automatic evaluation cadence",
  "automation.proactive.cadenceOff": "Manual only (off)",
  "automation.proactive.cadence15": "Every 15 minutes",
  "automation.proactive.cadence30": "Every 30 minutes",
  "automation.proactive.cadence60": "Every hour",
  "automation.proactive.cadence1440": "Every day",
  "automation.proactive.quietHours": "Quiet hours",
  "automation.proactive.useQuiet": "Use quiet hours",
  "automation.proactive.timezone": "Time zone (IANA)",
  "automation.proactive.quietFrom": "Quiet from",
  "automation.proactive.quietUntil": "Quiet until",
  "automation.proactive.maxPerHour": "Maximum suggestions per hour",
  "automation.proactive.preview": "Preview suggestions",
  "automation.proactive.evaluate": "Evaluate now",
  "automation.proactive.refreshNoise": "Refresh noise metrics",
  "automation.proactive.delivered": "Delivered suggestions",
  "automation.proactive.dismiss": "Dismiss {title}",
  "automation.proactive.previewHeading": "Grounded preview",
  "automation.proactive.previewLabel": "Suggestion preview",
  "automation.proactive.previewEmpty": "No eligible accepted, unassigned Kage action items.",
  "automation.proactive.evidence": "Evidence: meeting {meeting}, item {item} ({source}): “{quote}”",
  "automation.proactive.sourceTranscript": "transcript",
  "automation.proactive.sourceSummary": "summary",
  "automation.proactive.noiseLabel": "Suggestion noise metrics",
  "automation.proactive.noiseDelivered": "Delivered",
  "automation.proactive.noiseDismissed": "Dismissed",
  "automation.proactive.noiseSuppressed": "Suppressed",
  "automation.proactive.noiseRate": "Dismissal rate",
  "automation.proactive.saved": "Suggestion preferences saved.",
  "automation.proactive.previewCount":
    "{count, plural, other {# grounded suggestion(s) in preview.}}",
  "automation.proactive.evaluated": "{delivered} delivered; {suppressed} suppressed.",
  "automation.proactive.dismissed": "Suggestion dismissed.",

  // ---- capability registry (RegistrySettings.tsx) ----
  "automation.registry.title": "Capability registry",
  "automation.registry.intro":
    "Browse metadata from a locally configured, host-trusted signed index. Phoenix Core verifies the index signature before returning entries. Browsing does not install or run third-party code.",
  "automation.registry.noInstall":
    "Installation unavailable: an audited OS sandbox is not available. Third-party capabilities cannot be installed here.",
  "automation.registry.unavailable": "Registry unavailable",
  "automation.registry.loadFailed": "Registry could not be loaded: {error}",
  "automation.registry.loading": "Loading registry…",
  "automation.registry.notConfigured":
    "No local registry is configured. Ask the host administrator to configure a trusted key and signed index to browse capabilities.",
  "automation.registry.indexSignature":
    "Index signature: verified with host-trusted Ed25519 signer {signer}.",
  "automation.registry.signature": "Signature: {signature}",
  "automation.registry.indexHash": "Signed index SHA-256: {hash}",
  "automation.registry.empty": "The signed registry contains no capabilities.",
  "automation.registry.preview": "Preview {name} {version}",
  "automation.registry.previewFailed": "Preview unavailable: {error}",
  "automation.registry.previewLoading": "Loading verified preview…",
  "automation.registry.permissions": "Permissions",
  "automation.registry.noDescription": "No description supplied",
  "automation.registry.noneDeclared": "None declared.",
  "automation.registry.dataCategories": "Data categories",
  "automation.registry.licence": "Licence",
  "automation.registry.licenceLine": "{licence}. {policy}",
  "automation.registry.security": "Security",
  "automation.registry.securityContact": "Security contact",
  "automation.registry.advisories": "Advisories",
  "automation.registry.provenance": "Signed provenance",
  "automation.registry.artifact":
    "Artifact SHA-256 declared by the signed index: {hash} ({bytes, plural, one {# byte} other {# bytes}}). Artifact verification: not verified; artifact bytes have not been fetched or checked. Browsing does not execute the artifact.",
  "automation.registry.sandbox":
    "Sandbox: unavailable. Installation is disabled; no install request will be sent.",

  // ---- encrypted sync (SyncSettings.tsx) ----
  "automation.sync.title": "Encrypted sync",
  "automation.sync.intro":
    "Optional and off by default. Sync requires your own available HTTPS relay and relay authentication; Phoenix does not provide a hosted relay. Configuring is explicit opt-in: it sends nothing during setup, but queued records sync automatically while online afterward. Sync now starts an immediate attempt. The adapter stages only the two explicitly selected non-content settings; later local changes require Publish current. Meeting, person and memory text is never included by this adapter.",
  "automation.sync.unavailable":
    "Sync settings are unavailable from Phoenix Core. This status request did not contact the relay.",
  "automation.sync.relayNone": "not configured",
  "automation.sync.relayUnknown": "configured relay (URL unavailable)",
  "automation.sync.statusOn":
    "Sync is on. {pending} queued; {conflicts, plural, other {# conflict(s)}}.",
  "automation.sync.statusOff":
    "Sync is off. {pending} queued; {conflicts, plural, other {# conflict(s)}}.",
  "automation.sync.chooseExclusions":
    "Choose exclusions before opting in; excluded classes and projects are not uploaded.",
  "automation.sync.excludeClasses": "Exclude data classes",
  "automation.sync.class.preference": "preference",
  "automation.sync.class.context": "context",
  "automation.sync.class.project_profile": "project profile",
  "automation.sync.excludeProject": "Exclude project by name",
  "automation.sync.excludeProjectButton": "Exclude project",
  "automation.sync.removeExclusion": "Remove exclusion for {name}",
  "automation.sync.exclusionsSaved": "Exclusions saved.",
  "automation.sync.adapterLegend": "Opt in existing settings individually",
  "automation.sync.adapterNote":
    "Only account-owner-scoped reduced motion (preference) and search result count (context configuration) are eligible; there are no project-scoped sources. Selecting stages the current value. Publish a later local change explicitly. Incoming values remain staged until you review and confirm applying them locally. Excluding a class also removes its adapter selection when allowed; already published records must first be deleted and synced. Deselecting does not erase uploaded ciphertext; delete its synced item separately if needed.",
  "automation.sync.adapter.reducedMotion": "Reduced motion preference",
  "automation.sync.adapter.searchCount": "Search result count metadata",
  "automation.sync.adapterSaved":
    "Adapter selection saved. Newly selected current settings are staged; no other sources are included.",
  "automation.sync.adapterApplied": "Selected synced setting applied locally.",
  "automation.sync.adapterPublished": "Current local setting staged for encrypted sync.",
  "automation.sync.publish": "Publish current {key}",
  "automation.sync.reviewApply": "Review applying {key}",
  "automation.sync.applyPreview": "Setting apply preview",
  "automation.sync.applyText":
    "Apply decrypted staged {key} revision {revision} to the existing local setting? It will replace the current value only after confirmation. Current and incoming values are hidden; identify the versions by source and revision, or cancel. A changed local value or staged revision invalidates this preview.",
  "automation.sync.confirmApply": "Confirm apply setting",
  "automation.sync.cancelApply": "Cancel apply",
  "automation.sync.relayLine":
    "Relay: {relay}. Identity: {identity}. A reachable relay is required; this status does not prove the relay is available.",
  "automation.sync.identityNone": "not available",
  "automation.sync.identityNote":
    "This identity represents the shared recovery-key account, not a distinct device. Devices with the same key and relay token cannot be individually revoked, and relay replay protection is not established.",
  "automation.sync.syncNow": "Sync now",
  "automation.sync.turnOff": "Turn sync off",
  "automation.sync.turnedOff": "Sync is off. Queued records remain local.",
  "automation.sync.offlineNote":
    "If the relay is offline, a manual sync reports an error and pending items remain queued for later retry. No silent overwrite occurs on conflicts.",
  "automation.sync.syncedPending":
    "{pending, plural, other {# item(s)}} still queued. Review status and conflicts below.",
  "automation.sync.syncedDone": "Sync finished. Review items and conflicts below.",
  "automation.sync.items": "Synced items",
  "automation.sync.itemsNote":
    "Metadata only; item contents and conflicting values are not displayed.",
  "automation.sync.noItems": "No sync records staged.",
  "automation.sync.itemLine":
    "{id} · {dataClass} · owner {owner} · scope {scope} · project {project} · revision {revision} · updated {updated} · {state}",
  "automation.sync.projectNone": "none",
  "automation.sync.updatedUnknown": "unknown",
  "automation.sync.state.deletionQueued": "deletion queued",
  "automation.sync.state.deleted": "deleted",
  "automation.sync.state.queued": "queued",
  "automation.sync.state.synced": "synced",
  "automation.sync.conflictMissing":
    "Conflict: this record is missing on the relay. Keep local to restore it on the relay, or accept remote deletion to delete the local staged sync record. Nothing is overwritten automatically.",
  "automation.sync.conflictRemote":
    "Conflict: remote revision {revision}, updated {updated}. Nothing is overwritten until you choose a side.",
  "automation.sync.reviewKeepLocal": "Review keeping local for {id}",
  "automation.sync.reviewKeepRemote": "Review keeping remote for {id}",
  "automation.sync.reviewAcceptDeletion": "Review accepting remote deletion for {id}",
  "automation.sync.reviewDeletion": "Review remote deletion for {id}",
  "automation.sync.resolutionPreview": "Conflict resolution preview",
  "automation.sync.previewFor": "Preview for {id} ({scope}):",
  "automation.sync.previewAcceptDeletion":
    "Accept remote deletion: delete the local staged sync record now; nothing is uploaded.",
  "automation.sync.previewRestore":
    "Restore missing remote: queue the local version for upload on the next successful sync.",
  "automation.sync.previewKeepRemote":
    "Keep remote: replace the local staged sync record with the remote version now.",
  "automation.sync.previewKeepLocal":
    "Keep local: queue this version for upload on the next successful sync. A newer remote change will still require resolution.",
  "automation.sync.previewTail":
    "Item contents are hidden here; if you cannot identify the versions from metadata, cancel. This cannot be undone here.",
  "automation.sync.confirmAcceptDeletion": "Confirm accept remote deletion",
  "automation.sync.confirmRestore": "Confirm restore missing remote",
  "automation.sync.confirmKeepLocal": "Confirm keep local",
  "automation.sync.confirmKeepRemote": "Confirm keep remote",
  "automation.sync.cancelResolution": "Cancel resolution",
  "automation.sync.resolvedDeletion":
    "Remote deletion accepted. Local staged sync record is now deleted; nothing is queued for upload.",
  "automation.sync.resolvedChoice":
    "Conflict choice saved. Pending changes sync automatically while online; Sync now starts an immediate attempt.",
  "automation.sync.deletionConfirmation": "Remote deletion confirmation",
  "automation.sync.deletionText":
    "Delete {id} ({scope}) from the relay? This queues a tombstone locally; the remote copy is removed only after successful sync. This cannot be undone here.",
  "automation.sync.confirmDeletion": "Confirm remote deletion",
  "automation.sync.cancelDeletion": "Cancel deletion",
  "automation.sync.deletionQueued":
    "Deletion queued. The remote copy is not deleted until a successful sync.",
  "automation.sync.relayUrl": "Relay HTTPS URL",
  "automation.sync.relayToken": "Relay authentication token",
  "automation.sync.restoreKey": "Existing recovery key (optional, for restoring an identity)",
  "automation.sync.optInNote":
    "Explicit opt-in: configuring stores relay credentials locally and enables automatic sync of queued records while online. A new identity shows a recovery key once: save it immediately; it cannot be retrieved later. Reconfiguring after turning sync off reuses the locally stored identity when available. Never share your key with the relay operator.",
  "automation.sync.configure": "Configure encrypted sync",
  "automation.sync.configured":
    "Sync is configured. Queued records sync automatically while online; Sync now starts an immediate attempt.",
  "automation.sync.recoveryGroup": "One-time recovery key",
  "automation.sync.recoveryText":
    "Copy and store this recovery key in a safe place now. It is shown only once and cannot be retrieved later. Do not share it.",
  "automation.sync.copyKey": "Copy recovery key",
  "automation.sync.savedKey": "I saved the key — dismiss",
  "automation.sync.refresh": "Refresh sync status",
} as const;
