// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// GitHub → Phoenix event mapping. Everything here is pure: the poller feeds it what it saw last
// time and what GitHub says now, and gets back events plus the new "seen" bookkeeping.
//
// History rule (what keeps a CI failure from last week out of Fawkes' state at startup): an item
// the capability has not seen before is only announced if its own timestamp is at or after
// `liveSince` (the moment the capability was enabled). Items seen earlier are announced whenever
// they change, whatever their age (a run that was in progress at startup still reports its
// result). The one exception is an outstanding review request, which is an obligation, not
// history, so it is announced even if it predates startup.
import type {
  Deployment,
  DeploymentStatus,
  PullRequest,
  Review,
  WorkflowJob,
  WorkflowRun,
} from "./parse";

export interface GithubEvent {
  event_type: string;
  severity: "info" | "success" | "warning" | "error";
  correlation_id: string;
  subject: string;
  requires_action?: boolean;
  payload: Record<string, unknown>;
}

export interface DiffContext {
  /** "owner/name" */
  repository: string;
  /** Epoch ms; unseen items older than this are recorded silently. */
  liveSince: number;
  /** Login of the authenticated user, when a token is set. */
  viewer?: string | undefined;
}

type Phase = "active" | "success" | "failed" | "cancelled" | "ignored";

const CONCLUSION_PHASE: Readonly<Record<string, Phase>> = {
  success: "success",
  failure: "failed",
  timed_out: "failed",
  startup_failure: "failed",
  cancelled: "cancelled",
};

const RUN_EVENT: Readonly<Record<Exclude<Phase, "ignored">, string>> = {
  active: "started",
  success: "passed",
  failed: "failed",
  cancelled: "cancelled",
};

const RUN_SEVERITY: Readonly<Record<Exclude<Phase, "ignored">, GithubEvent["severity"]>> = {
  active: "info",
  success: "success",
  failed: "error",
  cancelled: "warning",
};

function lookup<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** What a run is doing, ignoring conclusions Phoenix has no event for (skipped, neutral, …). */
export function runPhase(run: WorkflowRun): Phase {
  if (run.status !== "completed") return "active";
  return lookup(CONCLUSION_PHASE, run.conclusion ?? "") ?? "ignored";
}

export function runEvent(
  repository: string,
  run: WorkflowRun,
  phase: Exclude<Phase, "ignored">,
): GithubEvent {
  return {
    event_type: `github.ci.${RUN_EVENT[phase]}`,
    severity: RUN_SEVERITY[phase],
    correlation_id: `github-run-${run.id}`,
    subject: `${repository} · ${run.name}`,
    payload: {
      repository,
      // The run's page on github.com: for a failure this is the diagnosis link.
      url: run.url,
      run_id: run.id,
      workflow: run.name,
      branch: run.branch,
      actor: run.actor,
      trigger: run.trigger,
      attempt: run.attempt,
      ...(run.title ? { title: run.title } : {}),
      ...(run.sha ? { commit: run.sha } : {}),
      ...(phase === "active" ? {} : { conclusion: run.conclusion }),
    },
  };
}

/** Adds the first failed job to a ci.failed event (a more precise diagnosis link). */
export function withFailedJob(event: GithubEvent, jobs: readonly WorkflowJob[]): GithubEvent {
  const failed = jobs.find((j) => j.conclusion === "failure" || j.conclusion === "timed_out");
  if (!failed) return event;
  return {
    ...event,
    payload: {
      ...event.payload,
      failed_job: failed.name,
      ...(failed.url ? { job_url: failed.url } : {}),
    },
  };
}

export interface RunChange {
  run: WorkflowRun;
  event: GithubEvent;
}

export interface RunDiff {
  changes: RunChange[];
  /** phase:attempt per run in the latest page. Replaces the previous map. */
  seen: Record<number, string>;
}

/** Workflow runs → ci.started / passed / failed / cancelled. `runs` is GitHub's list order. */
export function diffRuns(
  runs: readonly WorkflowRun[],
  seen: Readonly<Record<number, string>>,
  ctx: DiffContext,
): RunDiff {
  const changes: RunChange[] = [];
  const next: Record<number, string> = {};
  const oldestFirst = [...runs].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  for (const run of oldestFirst) {
    const phase = runPhase(run);
    const key = `${phase}:${run.attempt}`;
    next[run.id] = key;
    const prev = seen[run.id];
    if (prev === key || phase === "ignored") continue;
    // Unseen: judge by when the thing happened (start for active runs, last update once done).
    const when = phase === "active" ? run.createdAt : (run.updatedAt ?? run.createdAt);
    const live = prev !== undefined || (when !== undefined && when >= ctx.liveSince);
    if (live) changes.push({ run, event: runEvent(ctx.repository, run, phase) });
  }
  return { changes, seen: next };
}

export interface PrSeen {
  phase: "open" | "closed" | "merged";
  /** The viewer's review is requested on this open PR. */
  requested: boolean;
  /** Review ids already handled. */
  reviews: Record<number, true>;
}

export interface PrDiff {
  events: GithubEvent[];
  seen: Record<number, PrSeen>;
}

function prEvent(
  repository: string,
  pr: PullRequest,
  type: string,
  severity: GithubEvent["severity"],
  extra: Record<string, unknown> = {},
): GithubEvent {
  return {
    event_type: `github.${type}`,
    severity,
    correlation_id: `github-pr-${repository}-${pr.number}`,
    subject: `${repository}#${pr.number}`,
    payload: {
      repository,
      url: pr.url,
      number: pr.number,
      title: pr.title,
      branch: pr.branch,
      base: pr.base,
      // The PR's author: GitHub's PR list does not say who merged or closed it.
      actor: pr.author,
      ...extra,
    },
  };
}

/** Pull requests → pr.opened / merged / closed and review.requested / request_removed. */
export function diffPulls(
  prs: readonly PullRequest[],
  seen: Readonly<Record<number, PrSeen>>,
  ctx: DiffContext,
): PrDiff {
  const events: GithubEvent[] = [];
  const next: Record<number, PrSeen> = {};
  const oldestFirst = [...prs].sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
  for (const pr of oldestFirst) {
    const phase = pr.merged ? "merged" : pr.open ? "open" : "closed";
    const requested =
      ctx.viewer !== undefined && pr.open && pr.requestedReviewers.includes(ctx.viewer);
    const prev = seen[pr.number];
    const when =
      phase === "open"
        ? pr.createdAt
        : phase === "merged"
          ? pr.mergedAt
          : (pr.closedAt ?? undefined);
    const live = prev !== undefined || (when !== undefined && when >= ctx.liveSince);
    if (prev?.phase !== phase && live) {
      if (phase === "open") {
        events.push(
          prEvent(ctx.repository, pr, "pr.opened", "info", prev ? { reopened: true } : {}),
        );
      } else if (phase === "merged") {
        events.push(prEvent(ctx.repository, pr, "pr.merged", "success"));
      } else {
        events.push(prEvent(ctx.repository, pr, "pr.closed", "info"));
      }
    }
    if (requested && !prev?.requested) {
      events.push({
        ...prEvent(ctx.repository, pr, "review.requested", "info"),
        requires_action: true,
      });
    } else if (!requested && prev?.requested && phase === "open") {
      events.push(prEvent(ctx.repository, pr, "review.request_removed", "info"));
    }
    next[pr.number] = {
      phase,
      requested,
      reviews: prev?.reviews ?? {},
    };
  }
  return { events, seen: next };
}

export interface ReviewDiff {
  events: GithubEvent[];
  reviews: Record<number, true>;
}

/** Reviews on the viewer's PR → review.approved / review.changes_requested. */
export function diffReviews(
  pr: PullRequest,
  reviews: readonly Review[],
  seen: Readonly<Record<number, true>>,
  ctx: DiffContext,
): ReviewDiff {
  const events: GithubEvent[] = [];
  const next: Record<number, true> = {};
  const oldestFirst = [...reviews].sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
  for (const review of oldestFirst) {
    next[review.id] = true;
    if (seen[review.id]) continue;
    const type =
      review.state === "APPROVED"
        ? "approved"
        : review.state === "CHANGES_REQUESTED"
          ? "changes_requested"
          : undefined;
    if (!type || review.reviewer === pr.author) continue;
    if (review.submittedAt === undefined || review.submittedAt < ctx.liveSince) continue;
    const base = prEvent(
      ctx.repository,
      pr,
      `review.${type}`,
      type === "approved" ? "success" : "warning",
      { actor: review.reviewer, review_state: review.state.toLowerCase() },
    );
    events.push(review.url ? { ...base, payload: { ...base.payload, url: review.url } } : base);
  }
  return { events, reviews: next };
}

type DeployPhase = "started" | "succeeded" | "failed" | "inactive";

const DEPLOY_STATE_PHASE: Readonly<Record<string, DeployPhase>> = {
  queued: "started",
  pending: "started",
  in_progress: "started",
  success: "succeeded",
  failure: "failed",
  error: "failed",
  inactive: "inactive",
};

const DEPLOY_EVENT: Readonly<Record<Exclude<DeployPhase, "inactive">, string>> = {
  started: "started",
  succeeded: "succeeded",
  failed: "failed",
};

const DEPLOY_SEVERITY: Readonly<Record<Exclude<DeployPhase, "inactive">, GithubEvent["severity"]>> =
  { started: "info", succeeded: "success", failed: "error" };

/** A deployment with no status yet counts as started. Unknown states are treated as inactive. */
export function deployPhase(status: DeploymentStatus | undefined): DeployPhase {
  return status ? (lookup(DEPLOY_STATE_PHASE, status.state) ?? "inactive") : "started";
}

/**
 * Whether a deployment's statuses must be read this round: always while it is still running, and
 * for a deployment never seen before only if it was created after startup (older ones are
 * history, recorded as settled without spending a request on each).
 */
export function needsStatusLookup(
  deployment: Deployment,
  seen: string | undefined,
  liveSince: number,
): boolean {
  if (seen === undefined)
    return deployment.createdAt !== undefined && deployment.createdAt >= liveSince;
  return seen === "started";
}

export function deployEvent(
  repository: string,
  deployment: Deployment,
  status: DeploymentStatus | undefined,
  phase: Exclude<DeployPhase, "inactive">,
): GithubEvent {
  return {
    event_type: `github.deploy.${DEPLOY_EVENT[phase]}`,
    severity: DEPLOY_SEVERITY[phase],
    correlation_id: `github-deploy-${deployment.id}`,
    subject: `${deployment.environment} (${repository})`,
    payload: {
      repository,
      url: status?.url ?? `https://github.com/${repository}/deployments`,
      deployment_id: deployment.id,
      environment: deployment.environment,
      branch: deployment.ref,
      actor: status?.creator ?? deployment.creator,
      state: status?.state ?? "created",
    },
  };
}

export interface DeployDiff {
  events: GithubEvent[];
  seen: Record<number, string>;
}

/**
 * Deployments → deploy.started / succeeded / failed. `latest` holds the newest status of each
 * deployment whose statuses were read this round (`null` = it has none); deployments missing
 * from it keep their previous phase.
 */
export function diffDeployments(
  deployments: readonly Deployment[],
  latest: Readonly<Record<number, DeploymentStatus | null>>,
  seen: Readonly<Record<number, string>>,
  ctx: DiffContext,
): DeployDiff {
  const events: GithubEvent[] = [];
  const next: Record<number, string> = {};
  const oldestFirst = [...deployments].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  for (const deployment of oldestFirst) {
    const prev = seen[deployment.id];
    const status = latest[deployment.id];
    if (status === undefined) {
      // Not looked up this round: keep what we knew, or record old history as settled.
      next[deployment.id] = prev ?? "settled";
      continue;
    }
    const phase = deployPhase(status ?? undefined);
    next[deployment.id] = phase;
    if (prev === phase || phase === "inactive") continue;
    const when =
      phase === "started" ? deployment.createdAt : (status?.createdAt ?? deployment.createdAt);
    const live = prev !== undefined || (when !== undefined && when >= ctx.liveSince);
    if (live) events.push(deployEvent(ctx.repository, deployment, status ?? undefined, phase));
  }
  return { events, seen: next };
}
