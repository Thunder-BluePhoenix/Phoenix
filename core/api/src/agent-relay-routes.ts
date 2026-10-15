// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { route, type Route } from "./http";
import type { CoreServices } from "./services";

export type AgentRelayAction = "install" | "uninstall" | "repair";

/** Whether the owner-only relay socket is up. `error` says why it is not (safe to show). */
export interface AgentRelayStatusView {
  running: boolean;
  version: number;
  platform: string;
  path?: string;
  error?: string;
}

/** One coding agent as the hook installer sees it on this machine. */
export interface AgentRelayAgentView {
  id: string;
  label: string;
  support: "supported" | "unsupported";
  reason?: string;
  doc_url: string;
  detected: boolean;
  detected_via?: string;
  config_path?: string;
  state: "installed" | "not_installed" | "needs_repair" | "unsupported";
  missing: string[];
  note?: string;
}

/** What a change would do. Nothing has been written; `hash` must come back to apply it. */
export interface AgentRelayPreviewView {
  mode: "preview";
  action: AgentRelayAction;
  agent: string;
  path: string;
  changed: boolean;
  diff: string;
  hash: string;
  notes: string[];
}

export interface AgentRelayAppliedView {
  mode: "applied";
  action: AgentRelayAction;
  agent: string;
  path: string;
  changed: boolean;
  summary: string;
  kept_user_edits: boolean;
}

/**
 * The relay socket and the hook installers (Phase 57). Reached only through the session-token
 * routes below; no capability command or tool can install or remove a hook.
 */
export interface AgentRelayApi {
  agents(): { relay: AgentRelayStatusView; agents: AgentRelayAgentView[] };
  /** Without `confirm_hash` in the body: a preview. With it: applies exactly that preview. */
  change(
    action: AgentRelayAction,
    body: unknown,
    client?: string,
  ): AgentRelayPreviewView | AgentRelayAppliedView;
}

export function agentRelayRoutes(s: CoreServices): Route[] {
  const relay = () => {
    if (!s.agentRelay)
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Agent relay not found");
    return s.agentRelay;
  };
  const change = (action: AgentRelayAction) =>
    route("POST", `/api/agent-relay/${action}`, async ({ req, body }) => {
      const client = req.headers["x-phoenix-client"];
      return relay().change(action, await body(), typeof client === "string" ? client : undefined);
    });
  return [
    route("GET", "/api/agent-relay/agents", () => relay().agents()),
    change("install"),
    change("uninstall"),
    change("repair"),
  ];
}
