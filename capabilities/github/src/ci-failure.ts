// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `ci.failure_details`: why did a workflow run fail? Reads the run, its jobs with their steps
// and (with a token) the tail of the first failed job's log. GET only, at most 3 requests, and
// the result is built field by field from validated values: no GitHub object is passed through.
import { redact } from "@phoenix/logging";
import { GithubError, type GithubClient } from "./client";
import {
  parseJobsWithSteps,
  parseRunDetail,
  parseRunDetails,
  type JobWithSteps,
  type RunDetail,
} from "./parse";

export const MAX_FAILED_JOBS = 10;
export const MAX_FAILED_STEPS = 20;
export const MAX_LOG_EXCERPT_CHARS = 4000;

/** Job conclusions that count as failed (cancelled only together with a failed step). */
const FAILED_JOB: Readonly<Record<string, boolean>> = { failure: true, timed_out: true };
const FAILED_STEP: Readonly<Record<string, boolean>> = { failure: true, timed_out: true };

// CSI/OSC escape sequences first, then any remaining control character except \n and \t.
const ANSI = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export interface FailedStep {
  name: string;
  number: number;
  conclusion: string;
}

export interface FailedJob {
  name: string;
  url: string | null;
  conclusion: string;
  failed_steps: FailedStep[];
}

export interface LogExcerpt {
  job: string;
  /** The last lines of the job log, ANSI escapes removed and secrets redacted. */
  text: string;
  truncated: boolean;
}

export interface CiFailureDetails {
  repository: string;
  run: {
    id: number;
    name: string;
    url: string;
    status: string;
    conclusion: string | null;
    branch: string;
    head_sha: string;
    short_sha: string;
    event: string;
    attempt: number;
    created_at: string | null;
  };
  failed_jobs: FailedJob[];
  jobs_total: number;
  authenticated: boolean;
  log_excerpt?: LogExcerpt;
}

/** Strips terminal escapes, redacts secrets, and keeps the last {@link MAX_LOG_EXCERPT_CHARS}. */
export function logTail(raw: string): { text: string; truncated: boolean } {
  const text = (redact(raw.replace(ANSI, "").replace(CONTROL, "")) as string).trim();
  if (text.length <= MAX_LOG_EXCERPT_CHARS) return { text, truncated: false };
  let tail = text.slice(-MAX_LOG_EXCERPT_CHARS);
  // Do not start in the middle of a line (unless the whole tail is one line).
  const firstBreak = tail.indexOf("\n");
  if (firstBreak >= 0 && firstBreak < tail.length - 1) tail = tail.slice(firstBreak + 1);
  return { text: tail, truncated: true };
}

function failedSteps(job: JobWithSteps): FailedStep[] {
  return job.steps.flatMap((s) =>
    s.conclusion && FAILED_STEP[s.conclusion]
      ? [{ name: s.name, number: s.number, conclusion: s.conclusion }]
      : [],
  );
}

async function pickRun(
  http: GithubClient,
  repository: string,
  runId: number | undefined,
): Promise<RunDetail> {
  if (runId !== undefined) {
    const detail = await http.get(`/repos/${repository}/actions/runs/${runId}`, parseRunDetail);
    if (!detail.value) throw new GithubError("invalid", "GitHub sent an empty run");
    return detail.value;
  }
  const list = await http.get(
    `/repos/${repository}/actions/runs?status=failure&per_page=10`,
    parseRunDetails,
  );
  const failed = list.value?.find((r) => r.conclusion === "failure");
  if (!failed) {
    throw new GithubError("not_found", "No failed workflow run found in the latest runs");
  }
  return failed;
}

/**
 * Builds the failure report. `runId` omitted = the newest of the last ten runs that concluded
 * `failure`. Throws GithubError (messages never contain the token) for anything that stops the
 * run or its jobs from being read; the optional log excerpt never fails the command.
 */
export async function ciFailureDetails(
  http: GithubClient,
  repository: string,
  runId: number | undefined,
): Promise<CiFailureDetails> {
  const run = await pickRun(http, repository, runId);
  const jobsResponse = await http.get(
    `/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=30`,
    parseJobsWithSteps,
  );
  if (!jobsResponse.value) throw new GithubError("invalid", "GitHub sent an empty job list");
  const { jobs, total } = jobsResponse.value;

  const failed = jobs.flatMap((job) => {
    const steps = failedSteps(job);
    const isFailed =
      (job.conclusion !== null && FAILED_JOB[job.conclusion]) ||
      (job.conclusion === "cancelled" && steps.length > 0);
    return isFailed && job.conclusion ? [{ job, steps, conclusion: job.conclusion }] : [];
  });

  const result: CiFailureDetails = {
    repository,
    run: {
      id: run.id,
      name: run.name,
      url: run.url,
      status: run.status,
      conclusion: run.conclusion,
      branch: run.branch,
      head_sha: run.headSha,
      short_sha: run.shortSha,
      event: run.event,
      attempt: run.attempt,
      created_at: run.createdAt,
    },
    failed_jobs: failed.slice(0, MAX_FAILED_JOBS).map(({ job, steps, conclusion }) => ({
      name: job.name,
      url: job.url ?? null,
      conclusion,
      failed_steps: steps.slice(0, MAX_FAILED_STEPS),
    })),
    jobs_total: total,
    authenticated: http.authenticated,
  };

  const first = failed[0]?.job;
  if (http.authenticated && first?.id !== undefined) {
    try {
      const log = logTail(await http.getLog(`/repos/${repository}/actions/jobs/${first.id}/logs`));
      if (log.text) result.log_excerpt = { job: first.name, ...log };
    } catch {
      // The failed steps are the evidence; a log that cannot be had (permission, expired, too
      // large, slow) just leaves the excerpt out.
    }
  }
  return result;
}
