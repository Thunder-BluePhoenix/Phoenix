// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The scenario format. A scenario is typed data: what to set up (memory, tool data, a scripted
// model), what task to run, and machine-checkable expectations. Nothing in an expectation asks a
// model whether it behaved: every oracle reads the persisted trace, the audit log and the
// capabilities' own call counters.
import type { AgentRunState } from "@phoenix/protocol";

export const CATEGORIES = [
  "benchmark",
  "prompt_injection",
  "malicious_tool_output",
  "conflicting_context",
  "stale_memory",
  "unauthorised_deploy",
  "permission_escalation",
  "hallucination",
  "partial_failure",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** The adversarial categories (everything except the plain benchmark). */
export const ADVERSARIAL: readonly Category[] = CATEGORIES.filter((c) => c !== "benchmark");

/** ci: the real CI-failure agent. ops: a model-planned agent. hostile: scripted attacker code. ask: memory Q&A. retrieval: relevance. */
export type Subject = "ci" | "ops" | "hostile" | "ask" | "retrieval";

export interface MemorySeed {
  /** Unique within the scenario; also the dedupe key. */
  key: string;
  text: string;
  /** Default `project` (a doc, internal). `meeting` items are sensitive. */
  kind?: "doc" | "commit" | "meeting";
  scope?: string;
  /** Days before the scenario clock that the thing was observed (default 1). */
  ageDays?: number;
  /** Days after last confirmation that the item counts as stale (default: never). */
  ttlDays?: number;
}

/** What a scripted model sees and does. First matching responder wins; `reply` may be an Error. */
export interface ModelResponder {
  /** Matches if the whole prompt (all messages joined) contains this text. Absent = always. */
  whenPromptHas?: string;
  reply: string | { error: string };
  /** Consumed after one use, so a scenario can script a sequence of replies. */
  once?: boolean;
  /** Virtual milliseconds the call takes. */
  latencyMs?: number;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface CiFixture {
  repository: string;
  runId: number;
  /** Failed job and failed step names the fake GitHub reports. */
  jobs: { name: string; failedSteps: string[] }[];
  headSha: string;
  runCreatedAt: string;
  /** Commits `git.recent_commits` reports, newest first. */
  commits: { sha: string; subject: string; files: string[]; date: string }[];
  /** The head commit is missing locally (ref.found false). */
  headMissing?: boolean;
  log?: string;
}

export type Fault =
  | { tool: string; mode: "error"; code?: string }
  | { tool: string; mode: "timeout" }
  | { tool: string; mode: "garbage"; value: unknown };

export type ApprovalPolicy = "none" | "approve_all" | "reject_all";

/** Everything the harness needs to build the world a scenario runs in. */
export interface Setup {
  memory?: MemorySeed[];
  ci?: CiFixture;
  model?: ModelResponder[];
  faults?: Fault[];
  /** What the simulated user does with approval prompts. Default `reject_all`. */
  approvals?: ApprovalPolicy;
  /** Text a capability returns for `ops.read_notes` (malicious tool output). */
  notes?: string;
  /** Policy rules the (trusted) user added before the run. */
  policyRules?: Record<string, unknown>[];
  /** Engage the emergency stop before submitting. */
  killSwitch?: boolean;
  /** Strings that must never appear in the audit log, trace, events or the final answer. */
  canaries?: string[];
  /** Strings that must never appear in any prompt sent to ANY model. */
  neverToModel?: string[];
  /** Capability ids to leave disabled (so their tools do not exist). */
  disabled?: string[];
  /** Make the viewer unable to see sensitive memory (default: owner who can). */
  viewerMaxSensitivity?: "public" | "internal" | "sensitive";
}

export type Expectation =
  | { type: "state"; oneOf: readonly (AgentRunState | "REFUSED")[] }
  | { type: "tool_not_executed"; tool: string }
  | { type: "tool_executed"; tool: string; min?: number }
  | { type: "no_unauthorised_side_effect" }
  | { type: "no_policy_bypass" }
  | { type: "no_leak" }
  | { type: "policy_decision"; tool: string; effect: "allow" | "deny" | "require_approval" }
  | { type: "risk_at_least"; tool: string; risk: "low" | "medium" | "high" | "critical" }
  | { type: "audit_action"; action: string; min?: number }
  | { type: "audit_action_absent"; action: string }
  | { type: "output_absent"; text: string }
  | { type: "output_present"; anyOf: string[] }
  | { type: "all_claims_cite_existing_evidence" }
  | { type: "claims_supported_by_evidence" }
  | { type: "coverage_at_most"; value: number }
  | { type: "ai_used"; value: boolean }
  | { type: "model_calls_at_most"; value: number }
  | { type: "no_causal_claim_naming"; sha: string }
  | { type: "fact_stale"; containing: string }
  | { type: "policy_state_unchanged" }
  | { type: "tool_not_attempted"; tool: string }
  | { type: "tool_failure_code"; tool: string; code: string }
  | { type: "facts_listed"; all: string[] }
  | { type: "evidence_count_at_least"; kind: string; value: number }
  | { type: "prompt_contains_exactly"; text: string; count: number }
  | { type: "no_claim_cites_stale_memory" }
  | { type: "state_is_not"; state: AgentRunState }
  | { type: "output_discloses_failure" }
  | { type: "retrieval_at_least"; metric: "recallAtK" | "mrr" | "ndcgAtK"; value: number }
  | { type: "never_in_prompt"; text: string };

export interface Scenario {
  id: string;
  category: Category;
  subject: Subject;
  description: string;
  setup: Setup;
  task: { kind: string; input: Record<string, unknown> };
  expectations: Expectation[];
  /** Facts a correct answer must state (any spelling in the list counts). Feeds the correctness metric. */
  expectedFacts?: string[][];
  /** Set when the expectation is known to fail because the runtime lacks the defence. */
  knownDefect?: { id: string; severity: "safety" | "quality"; note: string };
  /** True when the scenario uses unusual encodings (zero-width, homoglyph, RTL, mixed script). */
  unicode?: boolean;
  /** Procedure for subject "hostile". */
  hostile?: "policy_admin_as_agent";
  /** Queries for subject "retrieval". */
  retrieval?: { k: number; queries: { id: string; query: string; relevant: string[] }[] };
}

export interface OracleResult {
  expectation: Expectation;
  passed: boolean;
  detail: string;
}
