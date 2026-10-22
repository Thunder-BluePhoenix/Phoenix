// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// How Fawkes reacts to `phoenix_notify`. The events live in their OWN namespace (`mcp.agent.*`), so a
// workflow or any other consumer subscribed to `agent.*` (which real coding agents publish under)
// never sees what an MCP client says about itself. The rules are added to the state engine by the
// MCP module, and every state expires: an MCP client that says "waiting" and never says anything
// again cannot pin Fawkes in WAITING.
import type { MappingRule } from "@phoenix/state-engine";

export const MCP_NOTIFY_EVENTS = {
  working: "mcp.agent.working",
  waiting: "mcp.agent.waiting",
  done: "mcp.agent.completed",
} as const;

const MIN = 60_000;

export const MCP_STATE_RULES: readonly MappingRule[] = [
  {
    match: MCP_NOTIFY_EVENTS.working,
    effect: { state: "WORKING", explain: "{payload.agent} is working", ttlMs: 15 * MIN },
  },
  {
    match: MCP_NOTIFY_EVENTS.waiting,
    effect: { state: "WAITING", explain: "{payload.agent} needs your input", ttlMs: 10 * MIN },
  },
  {
    match: MCP_NOTIFY_EVENTS.done,
    effect: { state: "SUCCESS", explain: "{payload.agent} finished", ttlMs: 5_000 },
  },
];
