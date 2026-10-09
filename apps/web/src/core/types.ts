// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Mirrors core's StateSnapshot (GET /api/pet/state). */
export interface PetState {
  state: string;
  explanation: string;
  since: string;
  recording: boolean;
  sleeping: boolean;
  key?: string;
  source?: string;
  conditions?: unknown[];
}

export interface ActiveTask {
  key: string;
  state: string;
  title: string;
  source: string;
  since: string;
  updatedAt: string;
  progress?: number;
}

export interface PhoenixEvent {
  event_id: string;
  event_type: string;
  source: string;
  timestamp: string;
  severity: "info" | "success" | "warning" | "error";
  payload: Record<string, unknown>;
  subject?: string;
  correlation_id?: string;
  requires_action?: boolean;
}

export interface StoredEvent {
  seq: number;
  event: PhoenixEvent;
  /** Human sentence from core, same wording Fawkes uses. */
  description?: string;
}

export interface Notification {
  id: string;
  eventId: string | null;
  eventType: string | null;
  source: string | null;
  severity: PhoenixEvent["severity"];
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

export interface Confirmation {
  id: string;
  capabilityId: string;
  command: string;
  summary: string;
  sideEffect: string;
  permissions: string[];
  requestedAt: string;
  expiresAt: string;
  /** Optional, present only for a request raised by an active agent run (Phase 31). */
  task_id?: string;
  risk?: AgentRisk;
  target?: string;
  /** What the tool does and its redacted input; at most 300 characters. */
  preview?: string;
  evidence_ids?: string[];
}

export interface CapabilityView {
  id: string;
  name: string;
  version: string;
  description: string;
  kind: "builtin" | "external";
  status: "installed" | "enabled" | "disabled" | "failed" | "disconnected";
  health: { status: "unknown" | "healthy" | "degraded" | "unhealthy"; message?: string };
  permissions: { permission: string; description: string; granted: boolean }[];
  commands: { name: string; description: string; side_effect: string }[];
  data_categories: string[];
  config?: Record<string, unknown>;
  config_schema?: JsonSchema;
  secrets?: { name: string; description?: string; set: boolean }[];
  lastError?: string;
  disabledReason?: string;
}

export type ConnectionStatus = "connecting" | "online" | "offline" | "unauthenticated";

/** GET /api/meetings/{id} (Phoenix's record of a Kage meeting). */
export interface Meeting {
  id: string;
  capability_id: string;
  external_id: string;
  title: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  participants: string[] | null;
  recording: { location: string; retention: string } | null;
  has_transcript: boolean;
  has_summary: boolean;
  archived_at: string | null;
  updated_at: string;
}

export interface Transcript {
  text: string;
  segments?: { start_ms: number; end_ms: number; speaker?: string | null; text: string }[];
}

export type ActionItem = string | { text: string; owner?: string | null; due?: string | null };

export interface Summary {
  text: string;
  generated_by?: "ai" | "extractive";
  topics?: string[];
  decisions?: string[];
  action_items?: ActionItem[];
  follow_up_questions?: string[];
}

/** The subset of JSON Schema the settings form understands. */
export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

export type MemorySensitivity = "public" | "internal" | "sensitive";

/** GET /api/memory item: what Core is willing to show about a stored memory (Phase 29). */
export interface MemoryItem {
  id: string;
  text: string;
  layer: string;
  domain: string;
  kind: "fact" | "interpretation";
  source: string;
  source_ref: string | null;
  scope: string;
  sensitivity: MemorySensitivity;
  observed_at: string;
  confidence: number;
  retention_days: number | null;
  expires_at: string | null;
  redacted: boolean;
}

export type MemorySearchHit = MemoryItem & { score: number };

export interface MemoryList {
  items: MemoryItem[];
  total: number;
  counts: Record<string, number>;
  ai: { enabled: boolean };
}

export const MEMORY_LAYERS = ["working", "episodic", "project", "preference"] as const;
export type MemoryLayer = (typeof MEMORY_LAYERS)[number];

/** GET/POST /api/memory/settings. */
export interface MemorySettings {
  retention_days: Record<MemoryLayer, number | null>;
  allow_sensitive_meetings: boolean;
  doc_paths: string[];
  capture_git: boolean;
}

export interface MemoryFact {
  id: string;
  text: string;
  domain: string;
  source: string;
  source_ref: string | null;
  observed_at: string;
  sensitivity: MemorySensitivity;
}

/** POST /api/memory/ask. `facts` are stored data; `interpretation` is generated and never a fact. */
export interface MemoryAnswer {
  facts: MemoryFact[];
  interpretation: string | null;
  processed_by: string | null;
  ai_used: boolean;
  note: string | null;
}

export interface AiProviderStatus {
  id: string;
  label: string;
  locality: "local" | "cloud";
  available: boolean;
  reason: string | null;
}

/** GET /api/ai/status. */
export interface AiStatus {
  enabled: boolean;
  preferred: string | null;
  cloud_opt_in: Record<MemorySensitivity, boolean>;
  external_processing_granted: boolean;
  providers: AiProviderStatus[];
}

/** One entry of the agents capability's `list` command (Phase 25). */
export interface AgentSession {
  agent: string;
  agent_id: string;
  workspace: string;
  repository: string;
  state: "started" | "working" | "waiting" | "idle" | "completed" | "failed";
  reason?: string;
  task?: string;
  since: string;
  updated_at: string;
}

/** One entry of the frappe capability's `sites` command (Phase 23). */
export interface FrappeSite {
  site: string;
  bench: string;
  url: string;
  status: "checking" | "healthy" | "unhealthy";
  consecutive_failures: number;
  last_checked_at?: string;
  last_ok_at?: string;
  response_ms?: number;
  error?: string;
  apps: string[];
}

export type AgentRisk = "low" | "medium" | "high" | "critical";

export const AGENT_RUN_STATES = [
  "CREATED",
  "READY",
  "RUNNING",
  "WAITING_APPROVAL",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type AgentRunState = (typeof AGENT_RUN_STATES)[number];

/** GET/POST /api/agent/settings. */
export interface AgentSettings {
  enabled: boolean;
  kinds: string[];
  limits: {
    max_steps: number;
    max_tool_calls: number;
    max_wall_ms: number;
    max_active_runs: number;
  };
  active_runs: number;
}

/** One task in POST /api/agent/tasks and GET /api/agent/tasks. */
export interface AgentTaskSummary {
  id: string;
  kind: string;
  state: AgentRunState;
  title: string;
  requested_by: string;
  created_at: string;
  updated_at: string;
  failure_reason: string | null;
}

export interface AgentStep {
  seq: number;
  kind: "stage" | "tool_call";
  name: string;
  status: string;
  detail: Record<string, unknown>;
  policy_audit_id: number | null;
  decision: "allow" | "require_approval" | "deny" | null;
  risk: AgentRisk | null;
  stage_audit_id: number | null;
  started_at: string;
  finished_at: string;
}

export interface AgentEvidence {
  id: string;
  kind: string;
  source: string;
  excerpt_hash: string;
  excerpt: string;
  truncated: boolean;
}

export interface AgentClaim {
  text: string;
  evidence_ids: string[];
  grounded: boolean;
  origin: "rule" | "model";
  note: string | null;
}

export interface AgentProposal {
  text: string;
  rationale: string;
  evidence_ids: string[];
  advisory: boolean;
  grounded: boolean;
}

export interface AgentDiagnosis {
  summary: string;
  evidence_coverage: number;
  model_reported_confidence: string | null;
  ai_used: boolean;
  claims: AgentClaim[];
}

export interface AgentVerification {
  passed: boolean;
  checks: { name: string; passed: boolean; detail: string; required: boolean }[];
}

/** GET /api/agent/tasks/:id. */
export interface AgentTaskDetail {
  task: {
    id: string;
    kind: string;
    input: Record<string, unknown>;
    requested_by: string;
    created_at: string;
    correlation_id: string;
  };
  run: {
    id: string;
    state: AgentRunState;
    agent_id: string;
    agent_version: string;
    created_at: string;
    updated_at: string;
    failure_reason: string | null;
  };
  steps: AgentStep[];
  evidence: AgentEvidence[];
  summary: string | null;
  diagnosis: AgentDiagnosis | null;
  proposals: AgentProposal[];
  ai_used: boolean;
  processed_by: string | null;
  model_calls: number;
  verification: AgentVerification | null;
  audit_ids: number[];
}
