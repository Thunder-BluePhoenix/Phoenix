// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { CoreError } from "./errors";
import { isRecord } from "./format";

/** Where a pending request lives in Core: the permission gateway or the coding-agent approvals. */
export type ApprovalSource = "confirmation" | "agent";

/** One pending request as the CLI shows it. `raw` is everything Core listed, for the binding hash. */
export interface PendingApproval {
  source: ApprovalSource;
  id: string;
  /** One line for a person: the command, path or summary. Untrusted text. */
  title: string;
  /** Who is asking: a capability id or an agent name. Untrusted text. */
  requester: string;
  detail: string[];
  expiresAt: string;
  raw: Record<string, unknown>;
}

export interface CoreEvent {
  seq: number;
  at: string;
  type: string;
  source: string;
  severity: string;
  description: string;
}

export interface HealthView {
  status: string;
  version: string;
  protocol: string;
  env: string;
  uptimeMs: number;
  killSwitch: boolean;
  activeTasks: number;
  capabilities: { id: string; status: string; health: string }[];
}

export interface PetView {
  state: string;
  explanation: string;
  recording: boolean;
  sleeping: boolean;
}

const bad = (what: string): CoreError =>
  new CoreError("protocol", `Core answered ${what} in an unexpected shape`);

function list(value: unknown, key: string, what: string): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value[key])) throw bad(what);
  return (value[key] as unknown[]).filter(isRecord);
}

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

export function parseConfirmations(value: unknown): PendingApproval[] {
  return list(value, "confirmations", "the confirmations list").flatMap((c) => {
    if (typeof c.id !== "string") return [];
    const permissions = Array.isArray(c.permissions) ? c.permissions.map(String).join(", ") : "";
    const detail = [
      `command: ${str(c.command)}`,
      `side effect: ${str(c.sideEffect)}`,
      ...(permissions ? [`permissions: ${permissions}`] : []),
      ...(typeof c.risk === "string" ? [`risk: ${c.risk}`] : []),
      ...(typeof c.target === "string" ? [`target: ${c.target}`] : []),
    ];
    return [
      {
        source: "confirmation" as const,
        id: c.id,
        title: str(c.summary, str(c.command)),
        requester: str(c.capabilityId, "unknown"),
        detail,
        expiresAt: str(c.expiresAt),
        raw: c,
      },
    ];
  });
}

export function parseAgentApprovals(value: unknown): PendingApproval[] {
  return list(value, "approvals", "the agent approvals list").flatMap((a) => {
    // A question needs an answer text; the CLI only carries allow or deny.
    if (typeof a.id !== "string" || a.kind === "question") return [];
    const input = isRecord(a.input_summary) ? a.input_summary : {};
    const title = str(input.command) || str(input.path) || str(input.description) || str(a.tool);
    return [
      {
        source: "agent" as const,
        id: a.id,
        title,
        requester: str(a.agent, "unknown"),
        detail: [
          `tool: ${str(a.tool)}`,
          `project: ${str(a.project)}`,
          ...(typeof input.detail === "string" ? [`input: ${input.detail}`] : []),
        ],
        expiresAt: str(a.expires_at),
        raw: a,
      },
    ];
  });
}

export function parseEvents(value: unknown): CoreEvent[] {
  return list(value, "events", "the event list").flatMap((item) => {
    const event = item.event;
    if (typeof item.seq !== "number" || !isRecord(event)) return [];
    return [
      {
        seq: item.seq,
        at: str(event.timestamp),
        type: str(event.event_type),
        source: str(event.source),
        severity: str(event.severity),
        description: str(item.description),
      },
    ];
  });
}

export function parseHealth(value: unknown): HealthView {
  if (!isRecord(value) || typeof value.status !== "string") throw bad("the health report");
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.filter(isRecord).map((c) => ({
        id: str(c.id),
        status: str(c.status),
        health: str(c.health),
      }))
    : [];
  return {
    status: value.status,
    version: str(value.version, "unknown"),
    protocol: str(value.protocol, "unknown"),
    env: str(value.env, "unknown"),
    uptimeMs: typeof value.uptime_ms === "number" ? value.uptime_ms : 0,
    killSwitch: value.kill_switch === true,
    activeTasks: typeof value.active_tasks === "number" ? value.active_tasks : 0,
    capabilities,
  };
}

export function parsePet(value: unknown): PetView {
  if (!isRecord(value) || typeof value.state !== "string") throw bad("the Fawkes state");
  return {
    state: value.state,
    explanation: str(value.explanation),
    recording: value.recording === true,
    sleeping: value.sleeping === true,
  };
}
