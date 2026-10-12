// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { randomUUID } from "node:crypto";
import {
  ALL_SCENARIOS,
  evaluateImprovement,
  sha256,
  stringifyReport,
  validateImprovementChange,
  type ImprovementChange,
  type ImprovementEvidence,
  type Report,
  type TaskOutput,
} from "@phoenix/ai-evaluation";
import type { Database } from "@phoenix/persistence";

export interface ImprovementRuntimeDeps {
  db: Database;
  /** Both values come from independently trusted host/build configuration, never from a request or database. */
  pinnedBaseline?: { report: Report; digest: string };
  /** Must authorize the task and return its persisted final output and matching observation. */
  readTask?: (taskId: string) => TaskOutput | null;
  /** Synchronous in-memory effective-setting swap; null restores the previous setting. */
  apply?: (change: ImprovementChange | null) => void;
}

export interface ImprovementFeedback {
  id: string;
  taskId: string;
  runId: string;
  outputDigest: string;
  observationDigest: string;
  userId: string;
  rating: "helpful" | "unhelpful";
  trainingOptIn: boolean;
  recordedAt: string;
}
export interface ImprovementProposal {
  id: string;
  feedbackId: string;
  change: ImprovementChange;
  candidateHash: string;
  baselineDigest: string;
  state:
    "proposed" | "evaluating" | "rejected" | "evaluated" | "approved" | "active" | "rolled_back";
  evidence: ImprovementEvidence | null;
  evidenceHash: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvedEvidenceDigest: string | null;
  risk: {
    level: "low";
    target: "ops.prompt" | "retrieval.limit";
    reversible: true;
    securityChanges: false;
  };
}
export interface ImprovementActivation {
  version: string;
  proposalId: string;
  change: ImprovementChange;
  approvedBy: string;
  baselineDigest: string;
  activatedAt: string;
}

type FeedbackRow = {
  id: string;
  task_id: string;
  run_id: string;
  output_digest: string;
  observation_digest: string;
  user_id: string;
  rating: "helpful" | "unhelpful";
  training_opt_in: number;
  recorded_at: string;
};
type ProposalRow = {
  id: string;
  feedback_id: string;
  change_json: string;
  candidate_hash: string;
  baseline_digest: string;
  state: ImprovementProposal["state"];
  evidence_json: string | null;
  approved_by: string | null;
  approved_at: string | null;
  approved_evidence_digest: string | null;
};
type ActivationRow = {
  version: string;
  proposal_id: string;
  change_json: string;
  approved_by: string;
  baseline_digest: string;
  activated_at: string;
};
const digestChange = (change: ImprovementChange): string => sha256(JSON.stringify(change));
const now = (): string => new Date().toISOString();
function fail(message: string): never {
  throw new Error(message);
}

export class ImprovementRuntime {
  private readonly db: Database;
  private readonly deps: ImprovementRuntimeDeps;
  constructor(deps: ImprovementRuntimeDeps) {
    this.deps = {
      ...deps,
      ...(deps.pinnedBaseline
        ? {
            pinnedBaseline: {
              report: structuredClone(deps.pinnedBaseline.report),
              digest: deps.pinnedBaseline.digest,
            },
          }
        : {}),
    };
    this.db = deps.db;
    // Never let a user-writable database become the trust root for a baseline or effective setting.
    const pinned = this.deps.pinnedBaseline;
    if (
      pinned &&
      (sha256(stringifyReport(pinned.report)) !== pinned.digest ||
        pinned.report.suite !== "offline" ||
        pinned.report.scenarioCount !== ALL_SCENARIOS.length ||
        new Set(pinned.report.scenarios.map((s) => s.id)).size !== ALL_SCENARIOS.length ||
        ALL_SCENARIOS.some(
          (scenario) =>
            !pinned.report.scenarios.some(
              (entry) => entry.id === scenario.id && entry.category === scenario.category,
            ),
        ))
    )
      fail("Independent pinned full offline baseline mismatch");
    const active = this.active();
    if (active) {
      if (
        !deps.readTask ||
        !deps.pinnedBaseline ||
        !deps.apply ||
        active.baselineDigest !== deps.pinnedBaseline.digest
      )
        fail("Cannot restore activation without trusted baseline and reversible consumer");
      const proposal = this.getProposal(active.proposalId);
      if (
        !proposal ||
        proposal.state !== "active" ||
        proposal.baselineDigest !== active.baselineDigest ||
        proposal.candidateHash !== digestChange(active.change) ||
        proposal.approvedBy !== active.approvedBy ||
        !proposal.evidence ||
        proposal.evidence.failures.length ||
        proposal.approvedEvidenceDigest !== proposal.evidenceHash
      )
        fail("Active proposal integrity check failed");
      this.checkFeedbackProvenance(proposal.feedbackId);
      validateSafe(active.change);
      deps.apply(active.change);
    }
  }

  availability(): {
    feedback: boolean;
    evaluation: boolean;
    activation: boolean;
    baselineDigest: string | null;
  } {
    return {
      feedback: !!this.deps.readTask,
      evaluation: !!(this.deps.readTask && this.deps.pinnedBaseline),
      activation: !!(this.deps.readTask && this.deps.pinnedBaseline && this.deps.apply),
      baselineDigest: this.deps.pinnedBaseline?.digest ?? null,
    };
  }

  recordFeedback(
    input: { taskId: string; rating: ImprovementFeedback["rating"]; trainingOptIn?: boolean },
    userId = "owner",
  ): ImprovementFeedback {
    if (!this.deps.readTask) fail("Trusted task output reader unavailable");
    if (
      !input.taskId ||
      !userId ||
      !["helpful", "unhelpful"].includes(input.rating) ||
      (input.trainingOptIn !== undefined && typeof input.trainingOptIn !== "boolean")
    )
      fail("Invalid feedback");
    const task = this.deps.readTask(input.taskId);
    if (
      typeof task?.output !== "string" ||
      !task.output ||
      task.observation?.taskId !== input.taskId ||
      typeof task.observation.runId !== "string" ||
      !task.observation.runId
    )
      fail("Feedback requires authenticated persisted task output and matching run observation");
    const persisted = this.db
      .prepare(
        `SELECT 1 AS present FROM agent_tasks t
      JOIN agent_runs r ON r.task_id = t.id WHERE t.id = ? AND r.id = ?
      AND t.requested_by = 'user' AND r.state = 'COMPLETED'`,
      )
      .get(input.taskId, task.observation.runId);
    if (!persisted) fail("Only completed, persisted user task output may receive feedback");
    const row: ImprovementFeedback = {
      id: randomUUID(),
      taskId: input.taskId,
      runId: task.observation.runId,
      outputDigest: sha256(task.output),
      observationDigest: sha256(JSON.stringify(task.observation)),
      userId,
      rating: input.rating,
      trainingOptIn: input.trainingOptIn === true,
      recordedAt: now(),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO improvement_feedback
        (id, task_id, run_id, output_digest, observation_digest, user_id, rating, training_opt_in, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.id,
          row.taskId,
          row.runId,
          row.outputDigest,
          row.observationDigest,
          row.userId,
          row.rating,
          Number(row.trainingOptIn),
          row.recordedAt,
        );
      this.audit("feedback", row.id, userId, sha256(JSON.stringify(row)));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return row;
  }

  getFeedback(id: string): ImprovementFeedback | null {
    const row = this.db.prepare("SELECT * FROM improvement_feedback WHERE id = ?").get(id) as
      FeedbackRow | undefined;
    return row
      ? {
          id: row.id,
          taskId: row.task_id,
          runId: row.run_id,
          outputDigest: row.output_digest,
          observationDigest: row.observation_digest,
          userId: row.user_id,
          rating: row.rating,
          trainingOptIn: row.training_opt_in === 1,
          recordedAt: row.recorded_at,
        }
      : null;
  }

  propose(feedbackId: string, change: ImprovementChange, userId = "owner"): ImprovementProposal {
    if (!this.deps.readTask) fail("Trusted task output reader unavailable");
    const feedback = this.getFeedback(feedbackId);
    if (!feedback || feedback.userId !== userId || feedback.rating !== "unhelpful")
      fail("Own negative feedback required");
    this.checkFeedbackProvenance(feedback.id);
    validateSafe(change);
    const baseline = this.deps.pinnedBaseline;
    if (!baseline || sha256(stringifyReport(baseline.report)) !== baseline.digest)
      fail("Independent pinned baseline unavailable or changed");
    const candidate = structuredClone(change);
    const id = randomUUID();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO improvement_proposals
        (id, feedback_id, change_json, candidate_hash, baseline_digest, state)
        VALUES (?, ?, ?, ?, ?, 'proposed')`,
        )
        .run(id, feedbackId, JSON.stringify(candidate), digestChange(candidate), baseline.digest);
      this.audit("propose", id, userId, digestChange(candidate));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getProposal(id)!;
  }

  getProposal(id: string): ImprovementProposal | null {
    const row = this.db.prepare("SELECT * FROM improvement_proposals WHERE id = ?").get(id) as
      ProposalRow | undefined;
    if (!row) return null;
    const change = JSON.parse(row.change_json) as ImprovementChange;
    return {
      id: row.id,
      feedbackId: row.feedback_id,
      change,
      candidateHash: row.candidate_hash,
      baselineDigest: row.baseline_digest,
      state: row.state,
      evidence: row.evidence_json ? (JSON.parse(row.evidence_json) as ImprovementEvidence) : null,
      evidenceHash: row.evidence_json ? sha256(row.evidence_json) : null,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      approvedEvidenceDigest: row.approved_evidence_digest,
      risk: {
        level: "low",
        target: change.target as "ops.prompt" | "retrieval.limit",
        reversible: true,
        securityChanges: false,
      },
    };
  }

  async evaluate(id: string, userId = "owner"): Promise<ImprovementProposal> {
    if (!this.deps.readTask) fail("Trusted task output reader unavailable");
    const p = this.owned(id, userId);
    if (p.state !== "proposed") fail("Proposal must be pending evaluation");
    this.checkCandidate(p);
    const claimed = this.db
      .prepare(
        "UPDATE improvement_proposals SET state = 'evaluating' WHERE id = ? AND state = 'proposed'",
      )
      .run(id);
    if (claimed.changes !== 1) fail("Proposal evaluation already claimed");
    try {
      const baseline = this.deps.pinnedBaseline!;
      const evidence = await evaluateImprovement(
        structuredClone(baseline.report),
        baseline.digest,
        p.change,
      );
      const current = this.owned(id, userId);
      this.checkCandidate(current);
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const updated = this.db
          .prepare(
            "UPDATE improvement_proposals SET state = ?, evidence_json = ? WHERE id = ? AND state = 'evaluating'",
          )
          .run(evidence.failures.length ? "rejected" : "evaluated", JSON.stringify(evidence), id);
        if (updated.changes !== 1) fail("Evaluation state changed");
        this.audit("evaluate", id, userId, sha256(JSON.stringify(evidence)));
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      return this.getProposal(id)!;
    } catch (error) {
      this.db
        .prepare(
          "UPDATE improvement_proposals SET state = 'proposed' WHERE id = ? AND state = 'evaluating'",
        )
        .run(id);
      throw error;
    }
  }

  approve(
    id: string,
    candidateHash: string,
    reviewedEvidenceHash: string,
    userId = "owner",
  ): ImprovementProposal {
    const p = this.owned(id, userId);
    this.checkCandidate(p);
    if (
      p.state !== "evaluated" ||
      !p.evidence ||
      p.evidence.failures.length ||
      p.candidateHash !== candidateHash ||
      p.evidenceHash !== reviewedEvidenceHash
    )
      fail("Passing evaluation and matching reviewed candidate/evidence hashes required");
    const at = now();
    const evidenceHash = sha256(JSON.stringify(p.evidence));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const updated = this.db
        .prepare(
          `UPDATE improvement_proposals SET state = 'approved', approved_by = ?,
        approved_at = ?, approved_evidence_digest = ? WHERE id = ? AND state = 'evaluated'`,
        )
        .run(userId, at, evidenceHash, id);
      if (updated.changes !== 1) fail("Approval state changed");
      this.audit("approve", id, userId, evidenceHash);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getProposal(id)!;
  }

  activate(
    id: string,
    candidateHash: string,
    reviewedEvidenceHash: string,
    userId = "owner",
  ): ImprovementActivation {
    const p = this.owned(id, userId);
    this.checkCandidate(p);
    if (
      !this.deps.readTask ||
      !this.deps.apply ||
      p.state !== "approved" ||
      p.approvedBy !== userId ||
      p.candidateHash !== candidateHash ||
      !p.evidence ||
      p.evidence.failures.length ||
      p.evidenceHash !== reviewedEvidenceHash ||
      p.approvedEvidenceDigest !== reviewedEvidenceHash
    )
      fail("Explicit reviewed approval, reversible consumer and intact evidence required");
    if (this.active()) fail("Rollback the current activation before activating another proposal");
    const activation: ImprovementActivation = {
      version: randomUUID(),
      proposalId: id,
      change: structuredClone(p.change),
      approvedBy: userId,
      baselineDigest: p.baselineDigest,
      activatedAt: now(),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.deps.apply(p.change);
      this.db
        .prepare(
          `INSERT INTO improvement_activations
        (version, proposal_id, change_json, approved_by, baseline_digest, activated_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          activation.version,
          id,
          JSON.stringify(p.change),
          userId,
          p.baselineDigest,
          activation.activatedAt,
        );
      const updated = this.db
        .prepare(
          "UPDATE improvement_proposals SET state = 'active' WHERE id = ? AND state = 'approved'",
        )
        .run(id);
      if (updated.changes !== 1) fail("Activation state changed");
      this.audit("activate", id, userId, activation.version);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.deps.apply(null);
      throw error;
    }
    return activation;
  }

  active(): ImprovementActivation | null {
    const row = this.db
      .prepare("SELECT * FROM improvement_activations WHERE rolled_back_at IS NULL LIMIT 1")
      .get() as ActivationRow | undefined;
    return row
      ? {
          version: row.version,
          proposalId: row.proposal_id,
          change: JSON.parse(row.change_json) as ImprovementChange,
          approvedBy: row.approved_by,
          baselineDigest: row.baseline_digest,
          activatedAt: row.activated_at,
        }
      : null;
  }

  rollback(version: string, userId = "owner"): { rolledBack: string; active: null } {
    const active = this.active();
    if (
      !active ||
      active.version !== version ||
      !this.deps.readTask ||
      !this.deps.apply ||
      !this.deps.pinnedBaseline ||
      active.baselineDigest !== this.deps.pinnedBaseline.digest
    )
      fail("Current activation, reversible consumer and intact baseline required");
    const proposal = this.owned(active.proposalId, userId);
    this.checkCandidate(proposal);
    if (proposal.state !== "active" || proposal.approvedEvidenceDigest !== proposal.evidenceHash)
      fail("Active approval integrity check failed");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.deps.apply(null);
      this.db
        .prepare(
          "UPDATE improvement_activations SET rolled_back_at = ? WHERE version = ? AND rolled_back_at IS NULL",
        )
        .run(now(), version);
      const updated = this.db
        .prepare(
          "UPDATE improvement_proposals SET state = 'rolled_back' WHERE id = ? AND state = 'active'",
        )
        .run(active.proposalId);
      if (updated.changes !== 1) fail("Rollback state changed");
      this.audit("rollback", active.proposalId, userId, version);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.deps.apply(active.change);
      throw error;
    }
    return { rolledBack: version, active: null };
  }

  auditHistory(
    id: string,
    userId = "owner",
  ): { action: string; actor: string; detailHash: string; recordedAt: string }[] {
    this.owned(id, userId);
    const rows = this.db
      .prepare(
        "SELECT action, actor, detail_hash, recorded_at FROM improvement_audit WHERE proposal_id = ? ORDER BY id",
      )
      .all(id) as { action: string; actor: string; detail_hash: string; recorded_at: string }[];
    return rows.map((r) => ({
      action: r.action,
      actor: r.actor,
      detailHash: r.detail_hash,
      recordedAt: r.recorded_at,
    }));
  }

  private owned(id: string, userId: string): ImprovementProposal {
    const p = this.getProposal(id);
    if (!p || this.getFeedback(p.feedbackId)?.userId !== userId) fail("Proposal not found");
    return p;
  }
  private checkCandidate(p: ImprovementProposal): void {
    const baseline = this.deps.pinnedBaseline;
    if (
      !baseline ||
      sha256(stringifyReport(baseline.report)) !== baseline.digest ||
      baseline.report.suite !== "offline" ||
      baseline.report.scenarioCount !== ALL_SCENARIOS.length ||
      p.baselineDigest !== baseline.digest ||
      p.candidateHash !== digestChange(p.change)
    )
      fail("Candidate or independently pinned baseline mismatch");
    validateSafe(p.change);
    this.checkFeedbackProvenance(p.feedbackId);
  }
  private checkFeedbackProvenance(id: string): void {
    const feedback = this.getFeedback(id);
    const task = feedback && this.deps.readTask?.(feedback.taskId);
    if (
      !feedback ||
      !task ||
      typeof task.output !== "string" ||
      !task.output ||
      task.observation?.taskId !== feedback.taskId ||
      task.observation.runId !== feedback.runId ||
      sha256(task.output) !== feedback.outputDigest ||
      sha256(JSON.stringify(task.observation)) !== feedback.observationDigest
    )
      fail("Feedback task output provenance no longer matches");
    const persisted = this.db
      .prepare(
        `SELECT 1 AS present FROM agent_tasks t
      JOIN agent_runs r ON r.task_id = t.id WHERE t.id = ? AND r.id = ?
      AND t.requested_by = 'user' AND r.state = 'COMPLETED'`,
      )
      .get(feedback.taskId, feedback.runId);
    if (!persisted) fail("Feedback task no longer completed or persisted");
  }
  private audit(action: string, proposalId: string, actor: string, detailHash: string): void {
    this.db
      .prepare(
        "INSERT INTO improvement_audit (action, proposal_id, actor, detail_hash, recorded_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(action, proposalId, actor, detailHash, now());
  }
}

function validateSafe(change: ImprovementChange): void {
  validateImprovementChange(change);
  if (change.target !== "ops.prompt" && change.target !== "retrieval.limit")
    fail("Only presentation prompts and bounded retrieval settings can be activated");
}
