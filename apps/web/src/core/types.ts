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

/** Phase 35: a decision, action item or other thing taken from a meeting, awaiting review. */
export const MEETING_ITEM_STATUSES = ["proposed", "accepted", "edited", "rejected"] as const;
export type MeetingItemStatus = (typeof MEETING_ITEM_STATUSES)[number];
export type MeetingItemKind = "decision" | "action_item" | "requirement" | "topic" | "project_ref";

export interface MeetingItem {
  id: string;
  meeting_id: string;
  kind: MeetingItemKind;
  text: string;
  owner: string | null;
  due: string | null;
  status: MeetingItemStatus;
  /** "kage", "manual" or "ai:<provider>/<model>". */
  extracted_by: string;
  evidence: {
    source: "transcript" | "summary";
    quote: string;
    segment_start?: number;
    segment_end?: number;
    char_start?: number;
    char_end?: number;
  } | null;
  original: { text: string; owner: string | null; due: string | null } | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

/** GET /api/meetings/:id/items. */
export interface MeetingItemList {
  meeting_id: string;
  items: MeetingItem[];
  counts: Record<MeetingItemStatus, number>;
}

/** Result of accept, reject, reopen and edit. */
export interface MeetingReviewResult {
  item: MeetingItem;
  /** `refused` is non-empty when the item is accepted but memory refused to remember it. */
  memory: { stored: number; refused: string[] };
}

/** POST /api/meetings/:id/items/extract. */
export interface MeetingExtraction {
  meeting_id: string;
  has_transcript: boolean;
  kage: { imported: number; duplicates: number; removed: number };
  ai: {
    stored: number;
    unavailable: string | null;
    stats: {
      chars_skipped: number;
      dropped: Record<string, number>;
    };
  } | null;
  counts: MeetingItemList["counts"];
}

/** How a search or ask found its facts (Phase 37). */
export interface RetrievalInfo {
  mode: "lexical" | "hybrid";
  vector_skipped_reason?: string;
  truncated?: boolean;
}

export interface MeetingSearchHit {
  meeting_id: string;
  item_id: string | null;
  memory_id: string;
  text: string;
  origin: "reviewed" | "kage";
  part: string;
  observed_at: string;
  freshness: "fresh" | "stale";
  score: number;
}

export interface MeetingSearchResult {
  query: string;
  hits: MeetingSearchHit[];
  total: number;
  retrieval: RetrievalInfo;
}

export interface MeetingAnswer {
  question: string;
  facts: {
    ref: string;
    text: string;
    meeting_id: string;
    item_id: string | null;
    memory_id: string;
    origin: "reviewed" | "kage";
  }[];
  interpretation: string | null;
  processed_by: string | null;
  ai_used: boolean;
  note: string | null;
  retrieval: RetrievalInfo;
}

/** Phase 38: where a graph node or edge came from. */
export interface GraphProvenance {
  source_kind: "event" | "capability" | "memory" | "meeting" | "meeting_item" | "user";
  source_id: string;
  capability: string;
  observed_at: string;
  recorded_at: string;
  confidence: number;
  /** "rule", "capability", "user" or "ai:<model>". */
  asserted_by: string;
  scope: string;
  domain: string;
  sensitivity: MemorySensitivity;
  detail: Record<string, string | number | boolean | null>;
}

export interface GraphNode {
  id: string;
  type: string;
  key: string;
  label: string;
  status: "fact" | "proposed";
  detail: Record<string, string | number | boolean | null>;
  provenance: GraphProvenance[];
}

export interface GraphEdge {
  id: string;
  src: string;
  rel: string;
  dst: string;
  status: "fact" | "proposed";
  provenance: GraphProvenance[];
}

/** GET /api/graph/nodes/:id. */
export interface GraphInspection {
  node: GraphNode;
  origin: GraphProvenance[];
  summary: { sources: number; assertors: string[]; capabilities: string[]; status: string };
  visible_edges: number;
}

/** GET /api/graph/nodes/:id/neighbors. */
export interface GraphNeighborhood {
  center: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface GraphPath {
  nodes: GraphNode[];
  hops: { from: string; to: string; direction: "forward" | "backward"; edge: GraphEdge }[];
  text: string;
}

export type GraphTruncation = Partial<
  Record<"depth" | "fanout" | "visited" | "time" | "results", true>
>;

export type GraphAnswer =
  | { kind: "why"; subject: GraphNode | null; paths: GraphPath[]; truncated: GraphTruncation }
  | {
      kind: "which";
      subject: GraphNode | null;
      type: string;
      results: { node: GraphNode; path: GraphPath }[];
      truncated: GraphTruncation;
    }
  | {
      kind: "who";
      subject: GraphNode | null;
      people: { person: GraphNode; paths: GraphPath[] }[];
      truncated: GraphTruncation;
    };

/** POST /api/graph/ask. */
export interface GraphAsk {
  question: string;
  seeds: GraphNode[];
  answers: GraphAnswer[];
  documents: {
    id: string;
    text: string;
    source: string;
    source_ref: string;
    score: number | null;
  }[];
  notes: string[];
  retrieval: RetrievalInfo;
}

/** Phase 34: a coding-agent session Phoenix started (`session.list` / `session.get`). */
export type OrchestratedState = "running" | "waiting" | "completed" | "failed" | "stopped";

export interface OrchestratedSession {
  id: string;
  launcher: string;
  workspace: string;
  repository: string;
  state: OrchestratedState;
  started_at: string;
  ended_at?: string;
  exit_code?: number | null;
  signal?: string | null;
  stop_reason?: string;
  failure?: string;
  accepts_input: boolean;
  messages_sent: number;
}

export interface AgentLink {
  id: number;
  session_id: string | null;
  kind: "commit" | "ci_run" | "pr" | "task";
  ref: string;
  repo: string;
  confidence: "time+path" | "sha-match" | "branch-match" | "user" | "ambiguous";
  source: string;
  why: Record<string, unknown>;
  detail?: Record<string, unknown>;
  candidates?: string[];
  created_at: string;
  resolved_at?: string;
}

export interface OrchestratedSessionList {
  sessions: OrchestratedSession[];
  ambiguous_links: AgentLink[];
}

export interface OrchestratedSessionDetail {
  session: OrchestratedSession | null;
  links: AgentLink[];
  ambiguous: AgentLink[];
  timeline: { at: string; kind: string; detail?: Record<string, unknown> }[];
  output?: { stdout: string[]; stderr: string[] };
}

/** One launcher from the `agents` capability's config (a name, the fixed command and its folders). */
export interface AgentLauncher {
  command: string[];
  cwd_roots: string[];
}

/** Phase 37: GET/POST /api/retrieval/settings. */
export interface RetrievalSettings {
  enabled: boolean;
  provider: string;
  model: string;
  k: number;
  vector_weight: number;
  reranker: "feature" | "none";
}

/** GET /api/retrieval/status. */
export interface RetrievalStatus {
  enabled: boolean;
  active: boolean;
  inactive_reason: "retrieval_disabled" | "ai_disabled" | null;
  provider: string;
  model: string;
  vector_space: string;
  embedded: number;
  total: number;
  unembedded: number;
  failures: number;
  other_models: { model: string; vectors: number }[];
  payload_bytes: number;
  last_run: {
    at: string;
    embedded: number;
    failed: number;
    remaining: number;
    capped: boolean;
    degraded: string[];
  } | null;
}

/** GET /api/graph/status. */
export interface GraphStatus {
  nodes: number;
  edges: number;
  provenance: number;
  visible_nodes_by_type: Record<string, number>;
  commits_backfilled: number;
  last_ingest: { at: string; memories: number; meetings: number } | null;
}
