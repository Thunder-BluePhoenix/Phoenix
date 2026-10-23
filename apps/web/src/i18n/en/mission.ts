// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for mission control (Phase 78): the board of agent sessions, tokens, cost and budgets. */
export const mission = {
  "mission.title": "Mission control",
  "mission.nav": "Mission",
  "mission.note":
    "Tokens and cost are what the agents themselves report. They are not verified against the provider's bill.",
  "mission.sourceMissing":
    "Some agent sessions could not be read right now (the agents capability is off or not answering), so the board may be missing sessions.",
  "mission.refresh": "Refresh",
  "mission.loadFailed": "Mission control could not be loaded.",

  "mission.filter.search": "Search sessions",
  "mission.filter.searchPlaceholder": "Agent, project or session id",
  "mission.filter.agent": "Agent",
  "mission.filter.project": "Project",
  "mission.filter.state": "State",
  "mission.filter.all": "All",
  "mission.filter.clear": "Clear filters",

  "mission.state.working": "Working",
  "mission.state.waiting": "Waiting on you",
  "mission.state.finished": "Finished",
  "mission.state.stuck": "Stuck",
  "mission.reason.permission": "Needs your permission",
  "mission.reason.input": "Has a question for you",
  "mission.reason.idle": "Idle at its prompt",
  "mission.stuck.noReport": "No report for longer than the stall limit",
  "mission.stuck.safetyStall": "Flagged as stalled by the safety net",

  "mission.board.title": "Sessions",
  "mission.board.empty": "No agent sessions to show.",
  "mission.board.noMatch": "No session matches the filters.",
  "mission.column.count": "{count, plural, one {# session} other {# sessions}}",
  "mission.column.empty": "None",

  "mission.card.open": "Details",
  "mission.card.focus": "Jump to terminal",
  "mission.card.focused": "The terminal window was brought to the front.",
  "mission.card.unnamedProject": "unknown project",
  "mission.card.tokens": "{input} in, {output} out",
  "mission.card.noTokens": "No token counts reported",
  "mission.card.cost": "Cost {cost}",
  "mission.card.costPartial": "Cost {cost} or more (some usage has no known cost)",
  "mission.card.costUnknown": "Cost unknown",
  "mission.card.lastSeen": "Last heard {ago}",
  "mission.card.steps": "{count, plural, one {# step} other {# steps}}",

  "mission.totals.title": "Tokens and cost",
  "mission.totals.window": "Last {days, plural, one {# day} other {# days}}",
  "mission.totals.input": "Input tokens",
  "mission.totals.output": "Output tokens",
  "mission.totals.cost": "Cost",
  "mission.totals.unknown": "unknown",
  "mission.totals.partial": "{cost} or more",
  "mission.totals.unpriced":
    "No price is set for: {models}. Their cost is unknown, not zero. Add a price below to see a cost.",
  "mission.totals.empty": "No agent has reported tokens or cost in this window.",

  "mission.by.day": "By day",
  "mission.by.agent": "By agent",
  "mission.by.project": "By project",
  "mission.by.session": "By session",
  "mission.col.day": "Day",
  "mission.col.agent": "Agent",
  "mission.col.project": "Project",
  "mission.col.session": "Session",
  "mission.col.input": "Input",
  "mission.col.output": "Output",
  "mission.col.cost": "Cost",

  "mission.budgets.title": "Budgets",
  "mission.budgets.note":
    "An alert comes before a limit is reached, at {thresholds} of it, once per budget per day. Cost budgets only count usage with a known cost.",
  "mission.budgets.none": "No budgets yet.",
  "mission.budgets.line": "{scope}, {metric}{agent}: {used} of {limit} ({pct}%)",
  "mission.budgets.lineAtLeast":
    "{scope}, {metric}{agent}: at least {used} of {limit} ({pct}%); some usage has no known cost and is not counted",
  "mission.ingest.notice":
    "Today Core cut {clamped, plural, one {# report} other {# reports}} to a limit and refused {refused, plural, one {# report} other {# reports}}, so the numbers below can be lower than what agents reported. Agents: {agents}.",
  "mission.budgets.lineUnknown": "{scope}, {metric}{agent}: usage unknown, limit {limit}",
  "mission.budgets.agentSuffix": " ({agent})",
  "mission.budgets.scope": "Applies to",
  "mission.budgets.scope.daily": "All of a day",
  "mission.budgets.scope.session": "Each session",
  "mission.budgets.metric": "Measured in",
  "mission.budgets.metric.tokens": "Tokens",
  "mission.budgets.metric.cost": "US dollars",
  "mission.budgets.limit": "Limit",
  "mission.budgets.agent": "Agent (optional)",
  "mission.budgets.add": "Add budget",
  "mission.budgets.remove": "Remove budget {id}",
  "mission.budgets.invalid": "Enter a limit above zero.",

  "mission.prices.title": "Prices",
  "mission.prices.note":
    "Phoenix has no built-in prices. Enter your own, in US dollars per million tokens, under the model name the agent reports.",
  "mission.prices.aiNote": "Models that also have a price in the AI settings: {models}.",
  "mission.prices.none": "No prices yet.",
  "mission.prices.model": "Model",
  "mission.prices.input": "Input per million tokens",
  "mission.prices.output": "Output per million tokens",
  "mission.prices.line": "{model}: {input} in, {output} out per million tokens",
  "mission.prices.add": "Save price",
  "mission.prices.remove": "Remove price for {model}",
  "mission.prices.invalid": "Enter a model name and two prices of zero or more.",

  "mission.stall.label": "Mark an active session stuck after this many minutes without a report",
  "mission.stall.save": "Save",

  "mission.keep.label": "Delete usage records older than this many days (7 to 3650)",
  "mission.keep.save": "Save",

  "mission.saved": "Saved",
  "mission.delete.button": "Delete all agent usage",
  "mission.delete.warning":
    "Delete every stored token and cost number? Budgets and prices stay. This cannot be undone.",
  "mission.delete.confirm": "Yes, delete",
  "mission.delete.done": "{count, plural, one {# record deleted} other {# records deleted}}",
} as const;
