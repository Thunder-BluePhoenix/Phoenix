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
  /** Safe workflow linkage or a Core-prepared, bounded daily-digest preview. */
  details?: {
    workflow?: string;
    run?: string;
    step?: string;
    dailyDigest?: { preview: string; citedSourceCount: number };
  };
  /** Optional, present only for a request raised by an active agent run (Phase 31). */
  task_id?: string;
  risk?: AgentRisk;
  target?: string;
  /** What the tool does and its redacted input; at most 300 characters. */
  preview?: string;
  evidence_ids?: string[];
}

export interface AIContextSource {
  name: string;
  description: string;
  data_access: { category: string; sensitivity: string }[];
  permissions: string[];
  provider: { locality: "local" | "cloud"; provider: string };
}

export interface AITool extends AIContextSource {
  command: string;
  kind: "tool" | "model_provider" | "embedding_provider";
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
  context_sources: AIContextSource[];
  ai_tools: AITool[];
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

export type AnswerFreshness = "fresh" | "stale";

export interface MemoryFact {
  id: string;
  text: string;
  domain: string;
  source: string;
  source_ref: string;
  observed_at: string;
  sensitivity: MemorySensitivity;
  classification: "stored_fact";
  confidence: number | null;
  freshness: AnswerFreshness;
}

export interface MemoryEvidence extends Omit<MemoryFact, "classification"> {
  classification: "retrieved_evidence";
}
export interface MemoryStoredInterpretation extends Omit<MemoryFact, "classification"> {
  classification: "stored_interpretation";
}

/** POST /api/memory/ask: source assertions and retrieved material remain separate from generated text. */
export interface MemoryAnswer {
  facts: MemoryFact[];
  stored_interpretations: MemoryStoredInterpretation[];
  retrieved_evidence: MemoryEvidence[];
  interpretation: string | null;
  interpretation_classification: "hypothesis" | null;
  processed_by: string | null;
  ai_used: boolean;
  note: string | null;
  /** Which model answered; absent in older answers. */
  model?: string | null;
  provider?: string | null;
  provider_label?: string | null;
  locality?: AiLocality | null;
  usage?: { input_tokens: number | null; output_tokens: number | null } | null;
  cost?: { amount: number; currency: "USD"; basis: "user-configured prices" } | null;
  retrieval: RetrievalInfo;
}

export type AiLocality = "local" | "cloud";

/** A model a provider lists (only when asked via `?models=<providerId>`). */
export interface AiModelInfo {
  id: string;
  kind: "chat" | "embed" | "unknown";
}

export interface AiProviderStatus {
  id: string;
  label: string;
  locality: AiLocality;
  kind: "builtin" | "preset" | "custom";
  available: boolean;
  reason: string | null;
  key_policy: "none" | "optional" | "required";
  key_set: boolean;
  default_model: string | null;
  base_url: string | null;
  /** Null unless asked for this provider and it could list them. */
  models: AiModelInfo[] | null;
  models_error: string | null;
}

/** Where one category of AI work goes; `model` null means the provider's default. */
export interface AiRoute {
  provider: string;
  model: string | null;
}

export type AiRouteCategory = "chat" | "summaries" | "cleanup";

export type AiPreset = "openai" | "deepseek" | "qwen" | "moonshot" | "lmstudio";

/** A user-added OpenAI-compatible server. Locality is derived by Core from the URL. */
export interface AiEndpoint {
  id: string;
  label: string;
  base_url: string;
  preset: AiPreset | null;
  locality: AiLocality;
}

/** User-supplied prices in USD per million tokens; Phoenix has no built-in prices. */
export interface AiPrice {
  input_per_mtok: number;
  output_per_mtok: number;
}

/** GET /api/ai/status. */
export interface AiStatus {
  enabled: boolean;
  preferred: string | null;
  cloud_opt_in: Record<MemorySensitivity, boolean>;
  external_processing_granted: boolean;
  routing: Record<AiRouteCategory, AiRoute | null>;
  endpoints: AiEndpoint[];
  /** Keyed "<providerId>:<model>". */
  prices: Record<string, AiPrice>;
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
    title: string;
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
  parent?: { task_id: string; run_id: string } | null;
  delegations?: {
    parent_task_id: string;
    parent_run_id: string;
    child_task_id: string;
    child_run_id: string;
    kind: string;
    status: "running" | "completed" | "failed" | "cancelled";
    grant: {
      tools: string[];
      context: {
        scopes: string[];
        domains: string[];
        max_sensitivity: "public" | "internal" | "sensitive";
      };
    };
  }[];
  conflicts?: {
    subject: string;
    children: [string, string];
    conclusions: [string, string];
    evidence: [string[], string[]];
  }[];
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
  origin: "reviewed" | "kage" | "notetaker";
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
    origin: "reviewed" | "kage" | "notetaker";
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
/** GET /api/graph/world/failures/:key/chains. Each node and hop carries its own support. */
export interface GraphWorldEntity {
  node: GraphNode;
  provenance: GraphProvenance[];
  confidence: number;
  observed_at: string;
  age_ms: number;
}

export interface GraphWorldHop {
  from: string;
  to: string;
  edge: GraphEdge;
  provenance: GraphProvenance[];
  confidence: number;
  observed_at: string;
  age_ms: number;
  meaning: string;
}

export interface GraphWorldChain {
  nodes: GraphWorldEntity[];
  hops: GraphWorldHop[];
  confidence: number;
  interpretation: "documented association; causation not established";
}

export interface GraphWorldResult {
  subject: GraphWorldEntity | null;
  chains: GraphWorldChain[];
  truncated: Partial<Record<"fanout" | "visited" | "time" | "results", true>>;
  as_of: string;
  max_age_ms: number;
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

/** Decrypted relay version returned only for explicit conflict inspection. */
export interface SyncRemoteItem {
  id: string;
  owner: string;
  scope: string;
  project: string | null;
  data_class: SyncDataClass;
  value: unknown;
  revision: string;
  updated_at: string;
  deleted: boolean;
}

/** Local sync inspection; value is decrypted for the client but never displayed in Settings. */
export interface SyncItem {
  id: string;
  owner: string;
  scope: string;
  project: string | null;
  data_class: SyncDataClass;
  value: unknown;
  revision: string;
  updated_at: string;
  deleted: boolean;
  pending: boolean;
  base_revision: string | null;
  conflict: SyncRemoteItem | "remote_missing" | null;
}

export type SyncDataClass = "preference" | "context" | "project_profile";

/** GET /api/sync and POST /api/sync/run; configuration adds a one-time recovery_key. */
export interface SyncStatus {
  enabled: boolean;
  identity: string | null;
  endpoint: string | null;
  excluded_projects: string[];
  excluded_classes: SyncDataClass[];
  pending: number;
  conflicts: number;
  items: SyncItem[];
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
  inactive_reason: "retrieval_disabled" | "ai_disabled" | "kill_switch" | null;
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

/** Phase 36: a plan for engineering tasks made from an accepted meeting item. */
export type PlanDestination =
  { system: "github"; repository: string } | { system: "frappe"; site: string };

export type PlanBasis = "meeting" | "suggested" | "user";

export interface PlanStatement {
  text: string;
  basis: PlanBasis;
  item_id?: string;
  quote?: string;
}

export type PlanStatus =
  "draft" | "proposed" | "approved" | "creating" | "created" | "failed" | "cancelled";

export interface PlanTask {
  title: string;
  body: string;
  labels: string[];
  basis: PlanBasis;
  item_id?: string;
  quote?: string;
}

/** A proposed Frappe DocType design; creation only creates Tasks, not this DocType. */
export interface FrappePlanDesign {
  doctype: string;
  fields: { label: string; fieldtype: string; required: boolean }[];
  workflow_states: string[];
  permissions: { role: string; read: boolean; write: boolean; create: boolean }[];
}

export interface Plan {
  id: string;
  meeting_id: string;
  item_id: string;
  target: "github" | "frappe";
  destination: PlanDestination;
  status: PlanStatus;
  /** What `approve` must echo back. */
  content_hash: string;
  approved: { hash: string; by: string; at: string } | null;
  include_meeting_ref: boolean;
  title: string;
  /** "rules" or "ai:<provider>/<model>". */
  generated_by: string;
  not_ai_generated: boolean;
  summary: PlanStatement;
  acceptance_criteria: PlanStatement[];
  risks: PlanStatement[];
  open_questions: string[];
  tasks: PlanTask[];
  frappe: FrappePlanDesign | null;
  source: {
    item_id: string;
    meeting_id: string;
    kind: string;
    item_text: string;
    owner: string | null;
    due: string | null;
    quote: string | null;
  };
  created_at: string;
  updated_at: string;
}

export interface PlanTaskRun {
  task_index: number;
  idempotency_key: string;
  status: "pending" | "attempting" | "created" | "failed";
  attempts: number;
  external_id: string | null;
  url: string | null;
  error: string | null;
  updated_at: string;
}

export interface PlanLink {
  id: string;
  meeting_id: string;
  item_id: string;
  plan_id: string;
  task_index: number;
  system: "github" | "frappe";
  external_id: string;
  url: string;
  approved_by: string;
  approved_at: string;
  created_at: string;
}

/** GET /api/plans/:id and the result of edit, propose, approve and cancel. */
export interface PlanDetail {
  plan: Plan;
  runs: PlanTaskRun[];
  links: PlanLink[];
}

/** POST /api/plans/:id/create. It answers only after every task was confirmed or refused. */
export interface PlanCreationReport extends PlanDetail {
  failure: { task_index: number; message: string } | null;
}

export interface PlanPreview {
  plan_id: string;
  tasks: {
    task_index: number;
    tool: string;
    input: Record<string, unknown>;
    decision: { effect: string; risk: string; reasons: string[]; matched: string[] };
  }[];
}

export interface PlanningStatus {
  enabled: boolean;
  ai_enabled: boolean;
  reasons: string[];
  destinations: {
    github: { capability_enabled: boolean; write_token_set: boolean };
    frappe: { capability_enabled: boolean; write_token_set: boolean; sites: string[] };
  };
}

export interface PlanSummary {
  id: string;
  item_id: string;
  target: "github" | "frappe";
  status: PlanStatus;
  title: string;
  task_count: number;
  created_at: string;
  updated_at: string;
}

/** POST /api/meeting-items/:id/plan. */
export interface PlanGeneration {
  plan: Plan;
  generation: { unavailable: string | null };
}

/** Phases 39 and 40: workflows. */
export type WorkflowEnvironment = "local" | "dev" | "staging" | "production";

export interface Workflow {
  id: string;
  name: string;
  enabled: boolean;
  environment: WorkflowEnvironment;
  version: number;
  hash: string;
  trigger: { event: string; where?: string };
  authorisation_reasons: string[];
  authorised: boolean;
  problems: string[];
}

export interface WorkflowAuthorisation {
  id: string;
  workflow_id: string;
  definition_hash: string;
  authorised_by: string;
  authorised_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  /** Not revoked, not expired and bound to the workflow's current hash. */
  live: boolean;
}

/** The parts of a stored definition the page reads; the rest is shown as text. */
export interface WorkflowDefinitionView {
  id: string;
  name: string;
  version: number;
  environment: WorkflowEnvironment;
  trigger: { event: string; where?: string };
  declares: { tools: string[]; ai: boolean; context?: boolean };
  steps: {
    id: string;
    type: string;
    tool?: string;
    summary?: string;
    compensate?: { tool: string };
  }[];
}

export interface WorkflowDetail {
  workflow: Workflow;
  definition: WorkflowDefinitionView | null;
  authorisations: WorkflowAuthorisation[];
  created_by: string | null;
  created_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

export interface WorkflowValidation {
  valid: boolean;
  problems: string[];
  hash: string | null;
  authorisation: { required: boolean; reasons: string[] } | null;
}

export interface WorkflowRunSummary {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: string;
  terminal: boolean;
  correlation_id: string;
  trigger_event_id: string;
  chain_depth: number;
  current_step: string | null;
  reason: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface WorkflowRunStep {
  seq: number;
  step_id: string;
  phase: "step" | "compensation";
  type: string;
  status: string;
  attempts: number;
  destructive: boolean;
  tool: string | null;
  input: string | null;
  output: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface WorkflowRun extends WorkflowRunSummary {
  trigger: string;
  steps: WorkflowRunStep[];
}

export interface WorkflowMetrics {
  runs_started: number;
  runs_succeeded: number;
  runs_failed: number;
  runs_cancelled: number;
  runs_rejected: number;
  runs_interrupted: number;
  runs_refused: number;
  runs_compensated: number;
  runs_needing_attention: number;
  steps_succeeded: number;
  steps_failed: number;
  step_failure_rate: number;
  duration: { p50: number; p90: number; p99: number; samples: number } | null;
  approvals_waiting: number;
  approvals_approved: number;
  approvals_rejected: number;
  approvals_expired: number;
}

/** Phase 52: manual Kage action-item suggestions. */
export interface ProactivePreferences {
  enabled: boolean;
  capabilities: string[];
  quietHours: { timezone: string; start: string; end: string } | null;
  maxPerHour: number;
  cadenceMinutes: 15 | 30 | 60 | 1440 | null;
}

export interface ProactiveNoise {
  delivered: number;
  dismissed: number;
  suppressed: number;
  dismissalRate: number;
}

export interface ProactiveStatus {
  preferences: ProactivePreferences;
  source: { capability_id: "kage"; available: boolean; mode: "manual" };
  noise: ProactiveNoise;
}

export interface ProactiveInsight {
  id: string;
  kind: "unassigned_action";
  capabilityId: "kage";
  title: string;
  body: string;
  evidenceIds: string[];
  subjectId: string;
  evidence: {
    meeting_id: string;
    item_id: string;
    source: "summary" | "transcript";
    quote: string;
  };
}

export interface AgentApprovalQuestion {
  question: string;
  header: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

/** One pending coding-agent request (Phase 56). Never carries the waiter's nonce. */
export interface AgentApproval {
  id: string;
  kind: "permission" | "question";
  agent: string;
  project: string;
  tool: string;
  input_summary: {
    command?: string;
    path?: string;
    description?: string;
    /** Compact JSON of every other tool argument. */
    detail?: string;
  };
  questions?: AgentApprovalQuestion[];
  expires_at: string;
  /** Whether Core allows an "Always allow here" rule for this request. */
  always_ok?: boolean;
  /** How the request reached Core. */
  via?: "relay" | "http";
}

export interface AgentApprovalRule {
  id: string;
  agent: string;
  project: string;
  tool: string;
  pattern: string;
  created_at: string;
  expires_at: string;
  created_by: string;
  uses: number;
}

export interface AgentRelayStatus {
  running: boolean;
  version: number;
  platform: string;
  path?: string;
  error?: string;
}

export interface AgentInstallView {
  id: string;
  label: string;
  support: "supported" | "unsupported";
  /** Why the agent is unsupported, or a caveat for a supported one. */
  reason?: string;
  doc_url: string;
  detected: boolean;
  detected_via?: string;
  config_path?: string;
  state: "installed" | "not_installed" | "needs_repair" | "unsupported";
  /** Hook events that vanished from the agent's config. */
  missing: string[];
  note?: string;
}

export interface AgentInstallList {
  relay: AgentRelayStatus | null;
  agents: AgentInstallView[];
}

export type AgentInstallAction = "install" | "uninstall" | "repair";

/** A dry run: what the change would do, and the hash to confirm it with. */
export interface InstallPreview {
  mode: "preview";
  action: AgentInstallAction;
  agent: string;
  path: string;
  changed: boolean;
  diff: string;
  hash: string;
  notes: string[];
}

export interface InstallApplied {
  mode: "applied";
  action: AgentInstallAction;
  agent: string;
  path: string;
  changed: boolean;
  summary: string;
  kept_user_edits: boolean;
}

/** Phase 58: live coding-agent sessions (read from the agents' own hooks, not started by Phoenix). */
export interface LiveStep {
  n: number;
  at: string;
  kind: "read" | "edit" | "run" | "other";
  tool: string;
  target: string;
}

export interface LiveFileChange {
  path: string;
  added: number;
  removed: number;
  edits: number;
  last_at: string;
}

export interface LiveSessionView {
  id: string;
  agent: string;
  project: string;
  repository: string;
  first_seen: string;
  last_seen: string;
  active: boolean;
  step_count: number;
  dropped_steps: number;
  has_terminal: boolean;
}

export interface LiveSessionList {
  sessions: LiveSessionView[];
}

export type LiveStepOf = LiveStep & { session_id: string };
export type LiveFileOf = LiveFileChange & { session_id: string };

export interface LiveSessionDetail {
  id: string;
  matched_by: "id" | "folder+time";
  sessions: LiveSessionView[];
  steps: LiveStepOf[];
  files: LiveFileOf[];
  dropped_steps: number;
}

export interface DiffLink {
  ref: string;
  repo: string;
  confidence: string;
  created_at: string;
  conclusion?: string;
}

export interface LiveDiff {
  session_id: string;
  path: string;
  diff: string;
  truncated: boolean;
  redacted?: boolean;
  source: "git diff HEAD" | "untracked file";
  commits: DiffLink[];
  ci_runs: DiffLink[];
}

export interface UsageView {
  agent: string;
  window: "5h" | "weekly";
  used_pct: number;
  resets_at: string;
  observed_at: string;
  level: "ok" | "warn" | "critical";
  stale: boolean;
  reset_credits?: number;
}

export interface UsageSummary {
  usage: UsageView[];
  thresholds: number[];
  unsupported: { agent: string; reason: string }[];
}
