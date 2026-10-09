// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Validation of GitHub REST responses. Everything GitHub (or whatever answers in its place)
// sends is treated as hostile: wrong types, missing fields and giant strings are dropped or
// clipped here, so the rest of the capability only ever sees well-formed, bounded values.
import { redact } from "@phoenix/logging";

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Longest free text (titles, branch and workflow names) kept from GitHub. */
export const MAX_TEXT = 200;
const MAX_URL = 500;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,99}$/;

/** Free text from GitHub, secret-redacted and clipped. */
function clean(v: unknown, max = MAX_TEXT): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const s = redact(v.trim()) as string;
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Only https links are kept: they end up as clickable "diagnosis links". */
function link(v: unknown): string | undefined {
  return typeof v === "string" && v.length <= MAX_URL && /^https:\/\/[^\s]+$/.test(v)
    ? v
    : undefined;
}

function id(v: unknown): number | undefined {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : undefined;
}

function login(v: unknown): string {
  const name = isRecord(v) ? v.login : undefined;
  return typeof name === "string" && LOGIN.test(name) ? name : "unknown";
}

function time(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

function items(body: unknown, key?: string): unknown[] {
  const list = key !== undefined ? (isRecord(body) ? body[key] : undefined) : body;
  if (!Array.isArray(list)) throw new Error("GitHub sent an unexpected response shape");
  return list;
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  open: boolean;
  merged: boolean;
  draft: boolean;
  author: string;
  branch: string;
  base: string;
  createdAt?: number;
  updatedAt?: number;
  closedAt?: number;
  mergedAt?: number;
  requestedReviewers: string[];
}

export interface WorkflowRun {
  id: number;
  /** Workflow name, e.g. "CI". */
  name: string;
  /** Commit or PR title the run was started for. */
  title: string;
  url: string;
  status: string;
  conclusion: string | null;
  branch: string;
  actor: string;
  trigger: string;
  attempt: number;
  sha: string;
  createdAt?: number;
  startedAt?: number;
  updatedAt?: number;
}

export interface WorkflowJob {
  name: string;
  url: string | undefined;
  conclusion: string | null;
}

export interface Deployment {
  id: number;
  environment: string;
  ref: string;
  creator: string;
  createdAt?: number;
}

export interface DeploymentStatus {
  id: number;
  state: string;
  environment: string | undefined;
  /** Where the deployment can be looked at (target_url, else log_url). */
  url: string | undefined;
  creator: string;
  createdAt?: number;
}

export interface Review {
  id: number;
  state: string;
  reviewer: string;
  url: string | undefined;
  submittedAt?: number;
}

function parsePull(raw: unknown): PullRequest | null {
  if (!isRecord(raw)) return null;
  const number = id(raw.number);
  const url = link(raw.html_url);
  if (number === undefined || !url || (raw.state !== "open" && raw.state !== "closed")) return null;
  const head = isRecord(raw.head) ? raw.head : {};
  const base = isRecord(raw.base) ? raw.base : {};
  const reviewers = Array.isArray(raw.requested_reviewers) ? raw.requested_reviewers : [];
  return {
    number,
    title: clean(raw.title) ?? `Pull request #${number}`,
    url,
    open: raw.state === "open",
    merged: typeof raw.merged_at === "string",
    draft: raw.draft === true,
    author: login(raw.user),
    branch: clean(head.ref) ?? "unknown",
    base: clean(base.ref) ?? "unknown",
    createdAt: time(raw.created_at),
    updatedAt: time(raw.updated_at),
    closedAt: time(raw.closed_at),
    mergedAt: time(raw.merged_at),
    requestedReviewers: reviewers.map(login).filter((l) => l !== "unknown"),
  };
}

/** GET /repos/{repo}/pulls. Throws if the body is not a list; skips malformed entries. */
export function parsePulls(body: unknown): PullRequest[] {
  return items(body).flatMap((r) => parsePull(r) ?? []);
}

function parseRun(raw: unknown): WorkflowRun | null {
  if (!isRecord(raw)) return null;
  const runId = id(raw.id);
  const url = link(raw.html_url);
  if (runId === undefined || !url || typeof raw.status !== "string") return null;
  return {
    id: runId,
    name: clean(raw.name) ?? "Workflow",
    title: clean(raw.display_title) ?? "",
    url,
    status: raw.status,
    conclusion: typeof raw.conclusion === "string" ? raw.conclusion : null,
    branch: clean(raw.head_branch) ?? "unknown",
    actor: login(raw.actor),
    trigger: clean(raw.event, 40) ?? "unknown",
    attempt: id(raw.run_attempt) ?? 1,
    sha:
      typeof raw.head_sha === "string" ? raw.head_sha.replace(/[^0-9a-f]/gi, "").slice(0, 7) : "",
    createdAt: time(raw.created_at),
    startedAt: time(raw.run_started_at),
    updatedAt: time(raw.updated_at),
  };
}

/** GET /repos/{repo}/actions/runs. */
export function parseRuns(body: unknown): WorkflowRun[] {
  return items(body, "workflow_runs").flatMap((r) => parseRun(r) ?? []);
}

/** GET /repos/{repo}/actions/runs/{id}/jobs. */
export function parseJobs(body: unknown): WorkflowJob[] {
  return items(body, "jobs").flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const name = clean(raw.name);
    if (!name) return [];
    return [
      {
        name,
        url: link(raw.html_url),
        conclusion: typeof raw.conclusion === "string" ? raw.conclusion : null,
      },
    ];
  });
}

/** Longest list of jobs / steps taken from one response; GitHub pages at 30 jobs, ~100 steps. */
const MAX_PARSED_JOBS = 100;
const MAX_PARSED_STEPS = 200;
const FULL_SHA = /^[0-9a-f]{40}$/i;

/** One workflow run with everything a failure report needs. */
export interface RunDetail {
  id: number;
  name: string;
  url: string;
  status: string;
  conclusion: string | null;
  branch: string;
  /** Full 40-hex commit id, lower-case. */
  headSha: string;
  shortSha: string;
  event: string;
  attempt: number;
  /** ISO 8601, or null when GitHub sent none. */
  createdAt: string | null;
}

export interface JobStep {
  name: string;
  number: number;
  conclusion: string | null;
}

export interface JobWithSteps {
  /** Needed to ask for the job's log; never shown. */
  id: number | undefined;
  name: string;
  url: string | undefined;
  conclusion: string | null;
  steps: JobStep[];
}

export interface JobsWithSteps {
  /** Jobs in the run according to GitHub (at least as many as were parsed). */
  total: number;
  jobs: JobWithSteps[];
}

function outcome(v: unknown): string | null {
  return clean(v, 40) ?? null;
}

function parseRunDetailItem(raw: unknown): RunDetail | null {
  if (!isRecord(raw)) return null;
  const runId = id(raw.id);
  const url = link(raw.html_url);
  const status = clean(raw.status, 40);
  const sha = typeof raw.head_sha === "string" ? raw.head_sha : "";
  if (runId === undefined || !url || !status || !FULL_SHA.test(sha)) return null;
  const created = time(raw.created_at);
  return {
    id: runId,
    name: clean(raw.name) ?? "Workflow",
    url,
    status,
    conclusion: outcome(raw.conclusion),
    branch: clean(raw.head_branch) ?? "unknown",
    headSha: sha.toLowerCase(),
    shortSha: sha.slice(0, 7).toLowerCase(),
    event: clean(raw.event, 40) ?? "unknown",
    attempt: id(raw.run_attempt) ?? 1,
    createdAt: created === undefined ? null : new Date(created).toISOString(),
  };
}

/** GET /repos/{repo}/actions/runs/{id}. Throws unless the body is a usable run. */
export function parseRunDetail(body: unknown): RunDetail {
  const run = parseRunDetailItem(body);
  if (!run) throw new Error("GitHub sent an unexpected response shape");
  return run;
}

/** GET /repos/{repo}/actions/runs, with the detail of {@link parseRunDetail}; skips unusable entries. */
export function parseRunDetails(body: unknown): RunDetail[] {
  return items(body, "workflow_runs").flatMap((r) => parseRunDetailItem(r) ?? []);
}

/** GET /repos/{repo}/actions/runs/{id}/jobs including each job's steps. */
export function parseJobsWithSteps(body: unknown): JobsWithSteps {
  const jobs = items(body, "jobs")
    .slice(0, MAX_PARSED_JOBS)
    .flatMap((raw): JobWithSteps[] => {
      if (!isRecord(raw)) return [];
      const steps = Array.isArray(raw.steps) ? raw.steps.slice(0, MAX_PARSED_STEPS) : [];
      return [
        {
          id: id(raw.id),
          name: clean(raw.name) ?? "(unnamed job)",
          url: link(raw.html_url),
          conclusion: outcome(raw.conclusion),
          steps: steps.flatMap((s): JobStep[] =>
            isRecord(s)
              ? [
                  {
                    name: clean(s.name) ?? "(unnamed step)",
                    number: id(s.number) ?? 0,
                    conclusion: outcome(s.conclusion),
                  },
                ]
              : [],
          ),
        },
      ];
    });
  const declared = isRecord(body) ? body.total_count : undefined;
  const total =
    typeof declared === "number" && Number.isSafeInteger(declared) && declared > jobs.length
      ? declared
      : jobs.length;
  return { total, jobs };
}

/** GET /repos/{repo}/deployments. */
export function parseDeployments(body: unknown): Deployment[] {
  return items(body).flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const deploymentId = id(raw.id);
    if (deploymentId === undefined) return [];
    return [
      {
        id: deploymentId,
        environment: clean(raw.environment, 80) ?? "unknown",
        ref: clean(raw.ref, 100) ?? "unknown",
        creator: login(raw.creator),
        createdAt: time(raw.created_at),
      },
    ];
  });
}

/** GET /repos/{repo}/deployments/{id}/statuses (newest first). */
export function parseDeploymentStatuses(body: unknown): DeploymentStatus[] {
  return items(body).flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const statusId = id(raw.id);
    if (statusId === undefined || typeof raw.state !== "string") return [];
    return [
      {
        id: statusId,
        state: raw.state,
        environment: clean(raw.environment, 80),
        url: link(raw.target_url) ?? link(raw.log_url),
        creator: login(raw.creator),
        createdAt: time(raw.created_at),
      },
    ];
  });
}

/** GET /repos/{repo}/pulls/{n}/reviews. */
export function parseReviews(body: unknown): Review[] {
  return items(body).flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const reviewId = id(raw.id);
    if (reviewId === undefined || typeof raw.state !== "string") return [];
    return [
      {
        id: reviewId,
        state: raw.state,
        reviewer: login(raw.user),
        url: link(raw.html_url),
        submittedAt: time(raw.submitted_at),
      },
    ];
  });
}

/** GET /user: the authenticated user's login. Throws if the answer is unusable. */
export function parseViewer(body: unknown): string {
  const name = isRecord(body) ? login(body) : "unknown";
  if (name === "unknown") throw new Error("GitHub sent an unexpected response shape");
  return name;
}
