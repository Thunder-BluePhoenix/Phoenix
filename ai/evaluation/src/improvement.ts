// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Offline improvement decisions only. Activation returns a versioned configuration; this module
// never writes a production setting, policy, permission, golden report or model training input.
import { randomUUID } from "node:crypto";
import { evaluateGate, GATES, type Gate } from "./gate";
import { sha256, type RunObservation } from "./observation";
import { stringifyReport, type Report } from "./report";
import { ALL_SCENARIOS } from "./scenarios";
import { runSuite } from "./suite";
import type { Scenario } from "./types";

export type ImprovementChange =
  | { target: "ops.prompt"; promptAddendum: string }
  | { target: "retrieval.limit"; retrievalLimit: number }
  | { target: "ops.workflow"; maxFollowUps: number };

export interface Feedback {
  id: string;
  taskId: string;
  runId: string;
  outputDigest: string;
  observationDigest: string;
  userId: string;
  rating: "helpful" | "unhelpful";
  /** Recorded opt-in only; no training or user-data export exists in this package. */
  trainingOptIn: boolean;
  recordedAt: string;
}

export interface Proposal {
  id: string;
  feedbackId: string;
  change: ImprovementChange;
  baselineDigest: string;
  state: "proposed" | "rejected" | "evaluated" | "approved" | "active" | "rolled_back";
  evidence?: {
    controlDigest: string;
    candidateDigest: string;
    improvement: string;
    failures: string[];
  };
  approvedBy?: string;
  approvedAt?: string;
  approvedEvidenceDigest?: string;
}

export interface Activation {
  version: string;
  proposalId: string;
  change: ImprovementChange;
  approvedBy: string;
  baselineDigest: string;
}
export interface TaskOutput {
  output: string;
  observation: RunObservation;
}

/** Prompt improvements alter task presentation only, never authority or security instructions. */
const PROMPT_TEMPLATES: readonly string[] = [
  "Summarize the answer in plain language.",
  "Mention the release version when it appears in cited evidence.",
  "Prefer concise statements about cited evidence.",
];

function digest(report: Report): string {
  return sha256(stringifyReport(report));
}

const copy = <T>(value: T): T => structuredClone(value);

function validate(change: ImprovementChange): void {
  switch (change.target) {
    case "ops.prompt":
      if (
        typeof change.promptAddendum !== "string" ||
        !PROMPT_TEMPLATES.includes(change.promptAddendum)
      )
        throw new Error(
          "Prompt changes must use approved task wording, not security or policy instructions",
        );
      return;
    case "retrieval.limit":
      if (
        !Number.isInteger(change.retrievalLimit) ||
        change.retrievalLimit < 1 ||
        change.retrievalLimit > 3
      )
        throw new Error("Retrieval limit must be between 1 and 3");
      return;
    case "ops.workflow":
      if (
        !Number.isInteger(change.maxFollowUps) ||
        change.maxFollowUps < 0 ||
        change.maxFollowUps > 3
      )
        throw new Error("Workflow may only reduce the existing follow-up budget");
      return;
    default:
      throw new Error("Policy, permission and security changes are not improvement targets");
  }
}

/** Offline coordinator only. Digest comes from an independent trusted pin; task and human
 * adapters come from an authenticated owner. Missing adapters deny feedback and approval. */
export class ImprovementLoop {
  private readonly baseline: Report;
  private readonly feedback = new Map<string, Feedback>();
  private readonly proposals = new Map<string, Proposal>();
  private readonly activations: Activation[] = [];

  constructor(
    baseline: Report,
    private readonly pinnedDigest: string,
    private readonly gate: Gate = GATES["v0.4"]!,
    private readonly scenarios: readonly Scenario[] = ALL_SCENARIOS,
    private readonly readTask: (taskId: string) => TaskOutput | null = () => null,
    private readonly isHumanReviewer: (userId: string) => boolean = () => false,
  ) {
    if (
      digest(baseline) !== pinnedDigest ||
      baseline.suite !== "offline" ||
      baseline.scenarioCount !== baseline.scenarios.length ||
      baseline.scenarios.length !== scenarios.length ||
      new Set(baseline.scenarios.map((s) => s.id)).size !== scenarios.length ||
      scenarios.some(
        (s) => !baseline.scenarios.some((b) => b.id === s.id && b.category === s.category),
      )
    )
      throw new Error("Untrusted or incomplete immutable baseline");
    this.baseline = copy(baseline);
  }

  baselineHash(): string {
    return digest(this.baseline);
  }
  /** Caller authenticates userId and authorizes readTask(taskId). This offline coordinator
   * derives provenance from the trusted task reader, never client-supplied output. */
  recordFeedback(input: {
    taskId: string;
    userId: string;
    rating: Feedback["rating"];
    /** Explicit opt-in must be recorded by authenticated UI, never inferred from task text. */
    trainingOptIn?: boolean;
  }): Feedback {
    const task = this.readTask(input.taskId);
    if (
      !input.taskId ||
      !input.userId ||
      !task?.output ||
      task.observation.taskId !== input.taskId ||
      !task.observation.runId ||
      !["helpful", "unhelpful"].includes(input.rating)
    )
      throw new Error(
        "Feedback requires a matching persisted task, output and authenticated user provenance",
      );
    const row: Feedback = {
      id: randomUUID(),
      taskId: input.taskId,
      runId: task.observation.runId,
      outputDigest: sha256(task.output),
      observationDigest: sha256(JSON.stringify(task.observation)),
      userId: input.userId,
      rating: input.rating,
      trainingOptIn: input.trainingOptIn === true,
      recordedAt: new Date().toISOString(),
    };
    this.feedback.set(row.id, row);
    return copy(row);
  }

  getFeedback(id: string): Feedback | null {
    return copy(this.feedback.get(id) ?? null);
  }
  getProposal(id: string): Proposal | null {
    return copy(this.proposals.get(id) ?? null);
  }
  active(): Activation | null {
    return copy(this.activations.at(-1) ?? null);
  }

  propose(feedbackId: string, change: ImprovementChange): Proposal {
    if (this.feedback.get(feedbackId)?.rating !== "unhelpful")
      throw new Error("A recorded negative user feedback item is required");
    validate(change);
    const proposal: Proposal = {
      id: randomUUID(),
      feedbackId,
      change: copy(change),
      baselineDigest: this.pinnedDigest,
      state: "proposed",
    };
    this.proposals.set(proposal.id, proposal);
    return copy(proposal);
  }

  /** Compare real scenario/oracle reports; no self-reported score or model-as-judge. */
  async reevaluate(id: string): Promise<Proposal> {
    const p = this.proposals.get(id);
    if (!p || p.state !== "proposed") throw new Error("Proposal must be pending evaluation");
    validate(p.change);
    if (this.baselineHash() !== this.pinnedDigest || p.baselineDigest !== this.pinnedDigest)
      throw new Error("Baseline tamper detected");
    const change = copy(p.change);
    const candidate =
      change.target === "ops.prompt"
        ? { promptAddendum: change.promptAddendum }
        : change.target === "retrieval.limit"
          ? { retrievalLimit: change.retrievalLimit }
          : { maxFollowUps: change.maxFollowUps };
    const control = (await runSuite("offline", this.scenarios)).report;
    const result = (await runSuite("offline", this.scenarios, undefined, undefined, candidate))
      .report;
    if (this.baselineHash() !== this.pinnedDigest || p.baselineDigest !== this.pinnedDigest)
      throw new Error("Baseline tamper detected during evaluation");
    const failures = [
      ...evaluateGate({ report: control, baseline: this.baseline }, this.gate).failures.map(
        (f) => `control: ${f}`,
      ),
      ...evaluateGate({ report: result, baseline: this.baseline }, this.gate).failures,
    ];
    if (result.scenarios.length !== control.scenarios.length)
      failures.push("Candidate scenario coverage differs from control");
    for (const previous of control.scenarios) {
      const now = result.scenarios.find((s) => s.id === previous.id);
      if (!now || (previous.passed && !now.passed))
        failures.push(`scenario regression: ${previous.id}`);
      if (
        now &&
        (now.metrics.safety.sideEffects > previous.metrics.safety.sideEffects ||
          now.metrics.safety.leaks > previous.metrics.safety.leaks ||
          now.metrics.safety.policyBypasses > previous.metrics.safety.policyBypasses)
      )
        failures.push(`safety regression: ${previous.id}`);
      if (
        now &&
        previous.metrics.correctness !== null &&
        (now.metrics.correctness === null || now.metrics.correctness < previous.metrics.correctness)
      )
        failures.push(`correctness regression: ${previous.id}`);
      if (
        now &&
        previous.metrics.grounding &&
        (!now.metrics.grounding ||
          now.metrics.grounding.supported < previous.metrics.grounding.supported ||
          now.metrics.grounding.citedExists < previous.metrics.grounding.citedExists)
      )
        failures.push(`grounding regression: ${previous.id}`);
      if (
        now &&
        previous.metrics.relevance &&
        (!now.metrics.relevance ||
          now.metrics.relevance.recallAtK < previous.metrics.relevance.recallAtK ||
          now.metrics.relevance.mrr < previous.metrics.relevance.mrr ||
          now.metrics.relevance.ndcgAtK < previous.metrics.relevance.ndcgAtK)
      )
        failures.push(`retrieval regression: ${previous.id}`);
    }
    const improvement = result.scenarios.flatMap((now) => {
      const previous = control.scenarios.find((s) => s.id === now.id);
      if (!previous) return [];
      if (!previous.passed && now.passed) return [`scenario passed: ${now.id}`];
      if (
        now.metrics.relevance &&
        previous.metrics.relevance &&
        now.metrics.relevance.ndcgAtK > previous.metrics.relevance.ndcgAtK
      )
        return [`retrieval relevance increased: ${now.id}`];
      if (
        now.passed &&
        previous.passed &&
        now.metrics.cost.modelCalls < previous.metrics.cost.modelCalls
      )
        return [`model calls reduced: ${now.id}`];
      return [];
    })[0];
    if (!improvement) failures.push("No scenario-measured improvement over fresh control");
    p.evidence = {
      controlDigest: digest(control),
      candidateDigest: digest(result),
      improvement: improvement ?? "none",
      failures,
    };
    p.state = failures.length ? "rejected" : "evaluated";
    return copy(p);
  }

  approve(id: string, humanUserId: string): Proposal {
    const p = this.proposals.get(id);
    if (
      !humanUserId ||
      !this.isHumanReviewer(humanUserId) ||
      !p ||
      p.state !== "evaluated" ||
      !p.evidence ||
      p.evidence.failures.length ||
      p.baselineDigest !== this.pinnedDigest ||
      this.baselineHash() !== this.pinnedDigest
    )
      throw new Error("A passing evaluation and explicit human approval are required");
    p.approvedBy = humanUserId;
    p.approvedAt = new Date().toISOString();
    p.approvedEvidenceDigest = sha256(JSON.stringify(p.evidence));
    p.state = "approved";
    return copy(p);
  }

  /** Offline-only activation record. Never applied to Core: durable approval/audit and an
   * independently pinned baseline must exist before production workflow integration. */
  activate(id: string): Activation {
    const p = this.proposals.get(id);
    if (
      !p ||
      p.state !== "approved" ||
      !p.approvedBy ||
      !p.evidence ||
      p.approvedEvidenceDigest !== sha256(JSON.stringify(p.evidence)) ||
      this.baselineHash() !== this.pinnedDigest ||
      p.baselineDigest !== this.pinnedDigest
    )
      throw new Error("Approved proposal and intact baseline required");
    validate(p.change);
    const activation: Activation = {
      version: randomUUID(),
      proposalId: id,
      change: copy(p.change),
      approvedBy: p.approvedBy,
      baselineDigest: this.pinnedDigest,
    };
    this.activations.push(activation);
    p.state = "active";
    return copy(activation);
  }

  rollback(version: string, humanUserId: string): Activation | null {
    if (
      !humanUserId ||
      !this.isHumanReviewer(humanUserId) ||
      this.activations.at(-1)?.version !== version ||
      this.baselineHash() !== this.pinnedDigest
    )
      throw new Error(
        "Human rollback of the current activation with an intact baseline is required",
      );
    const previous = this.activations.pop()!;
    this.proposals.get(previous.proposalId)!.state = "rolled_back";
    return this.active();
  }
}
