// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Reads the outputs of `github.ci.failure_details` and `git.recent_commits`. Tool output is
// untrusted data: the gateway checked size and serialisability, nothing more. Everything here is
// checked field by field, flattened to one line where it is a label, and bounded.
import { isRecord } from "./guards";

export const MAX_JOBS = 10;
export const MAX_STEPS = 20;
export const MAX_COMMITS = 10;
export const MAX_COMMIT_FILES = 30;

export interface FailedStep {
  name: string;
  number: number;
  conclusion: string;
}
export interface FailedJob {
  name: string;
  url: string | null;
  conclusion: string;
  steps: FailedStep[];
}
export interface FailureDetails {
  repository: string;
  run: {
    id: number;
    name: string;
    url: string;
    status: string;
    conclusion: string | null;
    branch: string;
    headSha: string;
    shortSha: string;
    event: string;
    attempt: number;
    createdAt: string | null;
  };
  jobs: FailedJob[];
  jobsTotal: number;
  authenticated: boolean;
  log: { job: string; text: string; truncated: boolean } | null;
}

export interface CommitInfo {
  sha: string;
  shortSha: string;
  subject: string;
  /** Author date (ISO). */
  date: string | null;
  /** Committer date (ISO): when the commit was applied here. */
  committedAt: string | null;
  filesChanged: number;
  files: string[];
}

/** A label from a tool: one line, no control characters, bounded. */
export function label(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text.length === 0 ? null : text.slice(0, max);
}

const FULL_SHA = /^[0-9a-f]{40}$/;
const posInt = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;

export function parseFailureDetails(value: unknown): FailureDetails | null {
  if (!isRecord(value) || !isRecord(value.run) || !Array.isArray(value.failed_jobs)) return null;
  const r = value.run;
  const id = posInt(r.id);
  const url = typeof r.url === "string" && /^https:\/\/\S{1,480}$/.test(r.url) ? r.url : null;
  const headSha = typeof r.head_sha === "string" && FULL_SHA.test(r.head_sha) ? r.head_sha : null;
  const repository = label(value.repository, 140);
  if (id === null || url === null || headSha === null || repository === null) return null;

  const jobs: FailedJob[] = [];
  for (const j of value.failed_jobs.slice(0, MAX_JOBS)) {
    if (!isRecord(j)) continue;
    const name = label(j.name);
    if (name === null) continue;
    const steps: FailedStep[] = [];
    for (const s of (Array.isArray(j.failed_steps) ? j.failed_steps : []).slice(0, MAX_STEPS)) {
      if (!isRecord(s)) continue;
      const stepName = label(s.name);
      const number = count(s.number);
      if (stepName !== null && number !== null) {
        steps.push({ name: stepName, number, conclusion: label(s.conclusion, 40) ?? "failure" });
      }
    }
    jobs.push({
      name,
      url: typeof j.url === "string" && /^https:\/\/\S{1,480}$/.test(j.url) ? j.url : null,
      conclusion: label(j.conclusion, 40) ?? "failure",
      steps,
    });
  }

  let log: FailureDetails["log"] = null;
  if (isRecord(value.log_excerpt) && typeof value.log_excerpt.text === "string") {
    log = {
      job: label(value.log_excerpt.job) ?? "unknown",
      // Kept multi-line: a log is a log. Control characters other than newline and tab go.
      text: value.log_excerpt.text
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
        .slice(0, 4000),
      truncated: value.log_excerpt.truncated === true,
    };
  }
  return {
    repository,
    run: {
      id,
      name: label(r.name) ?? "workflow",
      url,
      status: label(r.status, 40) ?? "completed",
      conclusion: label(r.conclusion, 40),
      branch: label(r.branch) ?? "unknown",
      headSha,
      shortSha: headSha.slice(0, 7),
      event: label(r.event, 40) ?? "unknown",
      attempt: posInt(r.attempt) ?? 1,
      createdAt: label(r.created_at, 40),
    },
    jobs,
    jobsTotal: count(value.jobs_total) ?? jobs.length,
    authenticated: value.authenticated === true,
    log,
  };
}

export interface CommitResult {
  /** Present when a `ref` was asked for: did that commit exist in the repository? */
  ref: { requested: string; found: boolean } | null;
  commits: CommitInfo[];
}

export function parseCommits(value: unknown): CommitResult | null {
  if (!isRecord(value) || !Array.isArray(value.commits)) return null;
  const ref =
    isRecord(value.ref) &&
    typeof value.ref.requested === "string" &&
    typeof value.ref.found === "boolean"
      ? { requested: value.ref.requested.slice(0, 40), found: value.ref.found }
      : null;
  const out: CommitInfo[] = [];
  for (const c of value.commits.slice(0, MAX_COMMITS)) {
    if (!isRecord(c) || typeof c.sha !== "string" || !FULL_SHA.test(c.sha)) continue;
    const files = (Array.isArray(c.files) ? c.files : [])
      .slice(0, MAX_COMMIT_FILES)
      .flatMap((f) => label(f) ?? []);
    out.push({
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      subject: label(c.subject) ?? "(no subject)",
      date: label(c.author_date, 40),
      committedAt: label(c.committer_date, 40),
      filesChanged: count(c.files_changed) ?? files.length,
      files,
    });
  }
  return { ref, commits: out };
}

/**
 * Splits commits into those that may be tied to a run and those that may not. A commit is
 * excluded when it was authored OR committed after the run was created, or when either date is
 * missing or unreadable (its order cannot be established). Pure.
 */
export function splitByRunTime(
  commits: readonly CommitInfo[],
  runCreatedAt: string | null,
): { kept: CommitInfo[]; excluded: CommitInfo[] } {
  const runMs = runCreatedAt === null ? Number.NaN : Date.parse(runCreatedAt);
  const kept: CommitInfo[] = [];
  const excluded: CommitInfo[] = [];
  for (const c of commits) {
    const times = [c.date, c.committedAt].map((d) => (d === null ? Number.NaN : Date.parse(d)));
    const ordered = !Number.isNaN(runMs) && times.every((t) => !Number.isNaN(t) && t <= runMs);
    (ordered ? kept : excluded).push(c);
  }
  return { kept, excluded };
}

/** File paths a log names, for matching against what a commit changed. */
export function pathsNamedBy(text: string, max = 10): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(
    /[A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|cjs|json|ya?ml|md|toml|sh|py|rs|go)\b/g,
  )) {
    const path = m[0].replace(/^\.\//, "");
    if (path.includes("/") && !path.startsWith("/") && !found.includes(path)) found.push(path);
    if (found.length >= max) break;
  }
  return found;
}

// ── Evidence text ────────────────────────────────────────────────────────────

export function runEvidenceText(d: FailureDetails): string {
  const r = d.run;
  return [
    `Workflow "${r.name}" run ${r.id} in ${d.repository}`,
    `status ${r.status}, conclusion ${r.conclusion ?? "unknown"}, attempt ${r.attempt}`,
    `branch ${r.branch}, event ${r.event}, head commit ${r.headSha}`,
    `failed jobs: ${d.jobs.length} of ${d.jobsTotal}`,
    `url ${r.url}`,
  ].join("\n");
}

export function jobEvidenceText(j: FailedJob): string {
  const steps =
    j.steps.length > 0
      ? j.steps.map((s) => `  step ${s.number} "${s.name}": ${s.conclusion}`).join("\n")
      : "  (no failed step was reported)";
  return `Job "${j.name}" concluded ${j.conclusion}\n${steps}${j.url ? `\nurl ${j.url}` : ""}`;
}

export function commitEvidenceText(c: CommitInfo): string {
  const shown = c.files.join(", ");
  const more = c.filesChanged > c.files.length ? ` (+${c.filesChanged - c.files.length} more)` : "";
  return `Commit ${c.sha}${c.date ? ` on ${c.date}` : ""}\nsubject: ${c.subject}\nchanged ${c.filesChanged} file(s): ${shown || "(none listed)"}${more}`;
}
