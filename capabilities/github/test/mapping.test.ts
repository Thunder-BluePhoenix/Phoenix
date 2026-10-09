// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deployPhase,
  diffDeployments,
  diffPulls,
  diffReviews,
  diffRuns,
  isRateLimited,
  needsStatusLookup,
  nextDelay,
  parseDeploymentStatuses,
  parseDeployments,
  parseJobs,
  parsePulls,
  parseReviews,
  parseRuns,
  parseViewer,
  readRateLimit,
  runPhase,
  withFailedJob,
  type DeploymentStatus,
  type DiffContext,
  type WorkflowRun,
} from "../src";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));

const T = (iso: string) => Date.parse(iso);
const ctx = (liveSince: string, extra: Partial<DiffContext> = {}): DiffContext => ({
  repository: "octo/phoenix",
  liveSince: T(liveSince),
  ...extra,
});

function run(over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 1,
    name: "CI",
    title: "fix things",
    url: "https://github.com/octo/phoenix/actions/runs/1",
    status: "completed",
    conclusion: "success",
    branch: "main",
    actor: "ada",
    trigger: "push",
    attempt: 1,
    sha: "abc1234",
    createdAt: T("2026-10-05T10:00:00Z"),
    updatedAt: T("2026-10-05T10:05:00Z"),
    ...over,
  };
}

describe("contract: recorded responses from Thunder-BluePhoenix/Phoenix", () => {
  it("parses the real workflow runs and keeps each run's own html_url", () => {
    const runs = parseRuns(fixture("runs.json"));
    expect(runs).toHaveLength(4);
    const failed = runs.find((r) => r.id === 37145498780)!;
    expect(failed).toMatchObject({
      name: "CI",
      status: "completed",
      conclusion: "failure",
      branch: "claude/upbeat-faraday-qor262",
      actor: "Thunder-BluePhoenix",
      trigger: "pull_request",
      url: "https://github.com/Thunder-BluePhoenix/Phoenix/actions/runs/37145498780",
    });
    expect(runs.find((r) => r.id === 37827195337)).toMatchObject({
      conclusion: "success",
      branch: "main",
    });
  });

  it("maps the real failed run to github.ci.failed (error) and the real passing run to ci.passed", () => {
    const runs = parseRuns(fixture("runs.json"));
    const { changes } = diffRuns(
      runs,
      {},
      ctx("2026-10-01T00:00:00Z", { repository: "Thunder-BluePhoenix/Phoenix" }),
    );
    const byId = Object.fromEntries(changes.map((c) => [c.run.id, c.event]));
    expect(byId[37145498780]).toMatchObject({
      event_type: "github.ci.failed",
      severity: "error",
      correlation_id: "github-run-37145498780",
      payload: {
        url: "https://github.com/Thunder-BluePhoenix/Phoenix/actions/runs/37145498780",
        run_id: 37145498780,
        branch: "claude/upbeat-faraday-qor262",
        actor: "Thunder-BluePhoenix",
        repository: "Thunder-BluePhoenix/Phoenix",
        conclusion: "failure",
      },
    });
    expect(byId[37827195337]).toMatchObject({
      event_type: "github.ci.passed",
      severity: "success",
    });
  });

  it("finds the failed job in the real jobs response", () => {
    const [failed] = parseRuns(fixture("runs.json"));
    const { changes } = diffRuns([failed!], {}, ctx("2026-10-01T00:00:00Z"));
    const event = withFailedJob(changes[0]!.event, parseJobs(fixture("jobs-failed-run.json")));
    expect(event.payload).toMatchObject({
      failed_job: "secret-scan",
      job_url:
        "https://github.com/Thunder-BluePhoenix/Phoenix/actions/runs/37145498780/job/111268457077",
    });
  });

  it("parses the real merged pull request and the empty deployments list", () => {
    const [pr] = parsePulls(fixture("pulls.json"));
    expect(pr).toMatchObject({
      number: 1,
      open: false,
      merged: true,
      author: "Thunder-BluePhoenix",
      branch: "claude/upbeat-faraday-qor262",
      base: "main",
      url: "https://github.com/Thunder-BluePhoenix/Phoenix/pull/1",
    });
    expect(parseDeployments(fixture("deployments.json"))).toEqual([]);
  });
});

describe("parsers treat responses as hostile", () => {
  it("rejects bodies of the wrong top-level shape", () => {
    expect(() => parseRuns({ workflow_runs: "nope" })).toThrow(/unexpected/);
    expect(() => parseRuns(null)).toThrow();
    expect(() => parsePulls({ message: "Not Found" })).toThrow();
    expect(() => parseJobs([])).toThrow();
    expect(() => parseViewer({ login: 42 })).toThrow();
  });

  it("drops malformed entries and keeps the good ones", () => {
    const good = { id: 5, html_url: "https://github.com/o/r/actions/runs/5", status: "queued" };
    const runs = parseRuns({
      workflow_runs: [
        null,
        "x",
        [],
        { id: "5", html_url: "https://github.com/o/r/actions/runs/5", status: "queued" },
        { id: -1, html_url: "https://github.com/o/r/actions/runs/1", status: "queued" },
        { id: 2 ** 60, html_url: "https://github.com/o/r/actions/runs/1", status: "queued" },
        { id: 6, status: "queued" },
        { id: 7, html_url: "javascript:alert(1)", status: "queued" },
        { id: 8, html_url: "http://github.com/insecure", status: "queued" },
        { id: 9, html_url: "https://github.com/o/r/actions/runs/9", status: 7 },
        good,
      ],
    });
    expect(runs.map((r) => r.id)).toEqual([5]);
  });

  it("clips and redacts free text, and never trusts login or branch types", () => {
    const [r] = parseRuns({
      workflow_runs: [
        {
          id: 3,
          html_url: "https://github.com/o/r/actions/runs/3",
          status: "completed",
          conclusion: ["failure"],
          name: "x".repeat(10_000),
          display_title: "deploy with ghp_abcdefghijklmnopqrstuvwxyz0123456789 now",
          head_branch: 12,
          actor: { login: "bad login<script>" },
          run_attempt: "2",
          head_sha: "abcdef1234567890zzz",
        },
      ],
    });
    expect(r!.name.length).toBeLessThanOrEqual(200);
    expect(r!.title).not.toContain("ghp_");
    expect(r).toMatchObject({
      conclusion: null,
      branch: "unknown",
      actor: "unknown",
      attempt: 1,
      sha: "abcdef1",
    });
  });

  it("handles null / missing nested objects on pull requests", () => {
    const [pr] = parsePulls([
      {
        number: 4,
        state: "open",
        html_url: "https://github.com/o/r/pull/4",
        user: null,
        head: null,
        base: 3,
        requested_reviewers: [null, { login: "bob" }, "x", { login: 5 }],
        created_at: "not a date",
      },
    ]);
    expect(pr).toMatchObject({ author: "unknown", branch: "unknown", requestedReviewers: ["bob"] });
    expect(pr!.createdAt).toBeUndefined();
    expect(
      parsePulls([{ number: 4, state: "weird", html_url: "https://github.com/o/r/pull/4" }]),
    ).toEqual([]);
  });

  it("parses deployments, statuses and reviews defensively", () => {
    expect(
      parseDeployments([{ id: 1 }, { id: "x" }, null, { id: 2, environment: 3 }]),
    ).toMatchObject([
      { id: 1, environment: "unknown" },
      { id: 2, environment: "unknown" },
    ]);
    expect(
      parseDeploymentStatuses([
        { id: 1, state: "success", target_url: "javascript:x", log_url: "https://example.com/log" },
        { id: 2, state: 5 },
      ]),
    ).toMatchObject([{ state: "success", url: "https://example.com/log" }]);
    expect(
      parseReviews([{ id: 1, state: "APPROVED", user: { login: "bob" } }, { id: 2 }]),
    ).toHaveLength(1);
  });
});

describe("workflow runs → ci events", () => {
  const live = ctx("2026-10-05T09:00:00Z");

  it("maps each phase to its event, severity and a stable per-run correlation id", () => {
    const cases: [Partial<WorkflowRun>, string, string][] = [
      [{ status: "queued", conclusion: null }, "github.ci.started", "info"],
      [{ status: "in_progress", conclusion: null }, "github.ci.started", "info"],
      [{ conclusion: "success" }, "github.ci.passed", "success"],
      [{ conclusion: "failure" }, "github.ci.failed", "error"],
      [{ conclusion: "timed_out" }, "github.ci.failed", "error"],
      [{ conclusion: "startup_failure" }, "github.ci.failed", "error"],
      [{ conclusion: "cancelled" }, "github.ci.cancelled", "warning"],
    ];
    for (const [over, type, severity] of cases) {
      const { changes } = diffRuns([run(over)], {}, live);
      expect(changes[0]?.event, JSON.stringify(over)).toMatchObject({
        event_type: type,
        severity,
        correlation_id: "github-run-1",
        subject: "octo/phoenix · CI",
      });
    }
  });

  it("ignores conclusions Phoenix has no event for (skipped, neutral, stale, action_required)", () => {
    for (const conclusion of [
      "skipped",
      "neutral",
      "stale",
      "action_required",
      "__proto__",
      null,
    ]) {
      expect(runPhase(run({ conclusion }))).toBe("ignored");
      expect(diffRuns([run({ conclusion })], {}, live).changes).toEqual([]);
    }
  });

  it("emits a transition once, then nothing while the run is unchanged", () => {
    const active = run({ status: "in_progress", conclusion: null });
    const first = diffRuns([active], {}, live);
    expect(first.changes).toHaveLength(1);
    expect(diffRuns([active], first.seen, live).changes).toEqual([]);
    const done = diffRuns([run({ conclusion: "failure" })], first.seen, live);
    expect(done.changes.map((c) => c.event.event_type)).toEqual(["github.ci.failed"]);
    expect(diffRuns([run({ conclusion: "failure" })], done.seen, live).changes).toEqual([]);
  });

  it("announces a re-run (new attempt) of a finished run", () => {
    const first = diffRuns([run({ conclusion: "failure" })], {}, live);
    const rerun = diffRuns(
      [run({ status: "in_progress", conclusion: null, attempt: 2 })],
      first.seen,
      live,
    );
    expect(rerun.changes.map((c) => c.event.event_type)).toEqual(["github.ci.started"]);
  });

  it("does not replay history: runs that finished before startup are recorded silently", () => {
    const old = run({
      id: 9,
      conclusion: "failure",
      createdAt: T("2026-09-28T10:00:00Z"),
      updatedAt: T("2026-09-28T10:05:00Z"),
    });
    const first = diffRuns([old], {}, live);
    expect(first.changes).toEqual([]);
    expect(first.seen[9]).toBe("failed:1");
    expect(diffRuns([old], first.seen, live).changes).toEqual([]);
  });

  it("still reports the result of a run that was already in progress at startup", () => {
    const started = run({
      status: "in_progress",
      conclusion: null,
      createdAt: T("2026-10-05T08:55:00Z"),
      updatedAt: T("2026-10-05T08:56:00Z"),
    });
    const first = diffRuns([started], {}, live);
    expect(first.changes).toEqual([]);
    const finished = run({
      conclusion: "failure",
      createdAt: T("2026-10-05T08:55:00Z"),
      updatedAt: T("2026-10-05T09:10:00Z"),
    });
    expect(diffRuns([finished], first.seen, live).changes[0]?.event.event_type).toBe(
      "github.ci.failed",
    );
  });

  it("uses the finish time, not the start time, to judge a run that is first seen already finished", () => {
    const quick = run({
      conclusion: "failure",
      createdAt: T("2026-10-05T08:59:00Z"),
      updatedAt: T("2026-10-05T09:01:00Z"),
    });
    expect(diffRuns([quick], {}, live).changes).toHaveLength(1);
  });

  it("orders events oldest first and forgets runs that left the page", () => {
    const a = run({ id: 1, conclusion: "failure", createdAt: T("2026-10-05T10:00:00Z") });
    const b = run({ id: 2, conclusion: "success", createdAt: T("2026-10-05T11:00:00Z") });
    const out = diffRuns([b, a], {}, live);
    expect(out.changes.map((c) => c.run.id)).toEqual([1, 2]);
    expect(Object.keys(diffRuns([b], out.seen, live).seen)).toEqual(["2"]);
  });
});

describe("failed job lookup", () => {
  it("adds the first failed job and leaves the event alone when none failed", () => {
    const { changes } = diffRuns([run({ conclusion: "failure" })], {}, ctx("2026-10-05T09:00:00Z"));
    const event = changes[0]!.event;
    expect(withFailedJob(event, [{ name: "lint", url: undefined, conclusion: "success" }])).toBe(
      event,
    );
    const out = withFailedJob(event, [
      { name: "lint", url: "https://github.com/o/r/runs/1/job/9", conclusion: "success" },
      { name: "test", url: "https://github.com/o/r/runs/1/job/10", conclusion: "failure" },
    ]);
    expect(out.payload).toMatchObject({
      failed_job: "test",
      job_url: "https://github.com/o/r/runs/1/job/10",
    });
    expect(out.payload.url).toBe(event.payload.url);
  });
});

describe("pull requests → events", () => {
  const live = ctx("2026-10-05T09:00:00Z", { viewer: "me" });
  const pr = (over = {}) => ({
    number: 7,
    title: "Add thing",
    url: "https://github.com/octo/phoenix/pull/7",
    open: true,
    merged: false,
    draft: false,
    author: "ada",
    branch: "feature",
    base: "main",
    requestedReviewers: [] as string[],
    createdAt: T("2026-10-05T10:00:00Z"),
    updatedAt: T("2026-10-05T10:00:00Z"),
    ...over,
  });

  it("opened → merged, with a stable correlation id, subject and the PR link", () => {
    const opened = diffPulls([pr()], {}, live);
    expect(opened.events).toEqual([
      expect.objectContaining({
        event_type: "github.pr.opened",
        correlation_id: "github-pr-octo/phoenix-7",
        subject: "octo/phoenix#7",
        payload: expect.objectContaining({
          url: "https://github.com/octo/phoenix/pull/7",
          number: 7,
          actor: "ada",
          branch: "feature",
          repository: "octo/phoenix",
        }),
      }),
    ]);
    expect(diffPulls([pr()], opened.seen, live).events).toEqual([]);
    const merged = diffPulls(
      [pr({ open: false, merged: true, mergedAt: T("2026-10-05T11:00:00Z") })],
      opened.seen,
      live,
    );
    expect(merged.events.map((e) => [e.event_type, e.severity])).toEqual([
      ["github.pr.merged", "success"],
    ]);
  });

  it("closed without merging is pr.closed; reopening says so", () => {
    const opened = diffPulls([pr()], {}, live);
    const closed = diffPulls(
      [pr({ open: false, closedAt: T("2026-10-05T11:00:00Z") })],
      opened.seen,
      live,
    );
    expect(closed.events.map((e) => e.event_type)).toEqual(["github.pr.closed"]);
    const reopened = diffPulls([pr()], closed.seen, live);
    expect(reopened.events[0]).toMatchObject({
      event_type: "github.pr.opened",
      payload: { reopened: true },
    });
  });

  it("does not replay old pull requests at startup", () => {
    const old = pr({
      open: false,
      merged: true,
      createdAt: T("2026-09-01T10:00:00Z"),
      mergedAt: T("2026-09-02T10:00:00Z"),
    });
    expect(
      diffPulls([old, pr({ number: 8, createdAt: T("2026-09-01T00:00:00Z") })], {}, live).events,
    ).toEqual([]);
  });

  it("announces an outstanding review request even on a PR opened before startup", () => {
    const old = pr({ requestedReviewers: ["me"], createdAt: T("2026-09-01T10:00:00Z") });
    const out = diffPulls([old], {}, live);
    expect(out.events).toEqual([
      expect.objectContaining({
        event_type: "github.review.requested",
        subject: "octo/phoenix#7",
        correlation_id: "github-pr-octo/phoenix-7",
        requires_action: true,
      }),
    ]);
    expect(diffPulls([old], out.seen, live).events).toEqual([]);
  });

  it("ignores review requests for other people and anonymous use", () => {
    expect(
      diffPulls([pr({ requestedReviewers: ["bob"] })], {}, live).events.map((e) => e.event_type),
    ).toEqual(["github.pr.opened"]);
    expect(
      diffPulls([pr({ requestedReviewers: ["me"] })], {}, ctx("2026-10-05T09:00:00Z")).events.map(
        (e) => e.event_type,
      ),
    ).toEqual(["github.pr.opened"]);
  });

  it("says when the request goes away on a PR that is still open", () => {
    const requested = diffPulls([pr({ requestedReviewers: ["me"] })], {}, live);
    const removed = diffPulls([pr()], requested.seen, live);
    expect(removed.events.map((e) => e.event_type)).toEqual(["github.review.request_removed"]);
    const closedWhileRequested = diffPulls([pr({ requestedReviewers: ["me"] })], {}, live);
    const closed = diffPulls(
      [pr({ open: false, closedAt: T("2026-10-05T11:00:00Z"), requestedReviewers: ["me"] })],
      closedWhileRequested.seen,
      live,
    );
    expect(closed.events.map((e) => e.event_type)).toEqual(["github.pr.closed"]);
  });
});

describe("reviews of the user's own PR", () => {
  const live = ctx("2026-10-05T09:00:00Z", { viewer: "me" });
  const pr = {
    number: 7,
    title: "Mine",
    url: "https://github.com/octo/phoenix/pull/7",
    open: true,
    merged: false,
    draft: false,
    author: "me",
    branch: "feature",
    base: "main",
    requestedReviewers: [],
  };
  const review = (id: number, state: string, at: string, reviewer = "bob") => ({
    id,
    state,
    reviewer,
    url: `https://github.com/octo/phoenix/pull/7#pullrequestreview-${id}`,
    submittedAt: T(at),
  });

  it("maps approvals and change requests, actor = the reviewer, link = the review", () => {
    const out = diffReviews(
      pr,
      [
        review(1, "APPROVED", "2026-10-05T10:00:00Z"),
        review(2, "CHANGES_REQUESTED", "2026-10-05T10:30:00Z", "cy"),
      ],
      {},
      live,
    );
    expect(out.events.map((e) => [e.event_type, e.severity, e.payload.actor])).toEqual([
      ["github.review.approved", "success", "bob"],
      ["github.review.changes_requested", "warning", "cy"],
    ]);
    expect(out.events[0]!.payload.url).toBe(
      "https://github.com/octo/phoenix/pull/7#pullrequestreview-1",
    );
    expect(out.events[0]!.correlation_id).toBe("github-pr-octo/phoenix-7");
    expect(
      diffReviews(pr, [review(1, "APPROVED", "2026-10-05T10:00:00Z")], out.reviews, live).events,
    ).toEqual([]);
  });

  it("skips plain comments, dismissals, pending reviews, self reviews and old history", () => {
    const out = diffReviews(
      pr,
      [
        review(1, "COMMENTED", "2026-10-05T10:00:00Z"),
        review(2, "DISMISSED", "2026-10-05T10:00:00Z"),
        review(3, "PENDING", "2026-10-05T10:00:00Z"),
        review(4, "APPROVED", "2026-10-05T10:00:00Z", "me"),
        review(5, "APPROVED", "2026-09-01T10:00:00Z"),
        { ...review(6, "APPROVED", "2026-10-05T10:00:00Z"), submittedAt: undefined },
      ],
      {},
      live,
    );
    expect(out.events).toEqual([]);
    expect(Object.keys(out.reviews)).toHaveLength(6);
  });
});

describe("deployments → events", () => {
  const live = ctx("2026-10-05T09:00:00Z");
  const dep = {
    id: 11,
    environment: "production",
    ref: "main",
    creator: "ada",
    createdAt: T("2026-10-05T10:00:00Z"),
  };
  const status = (state: string, at = "2026-10-05T10:01:00Z"): DeploymentStatus => ({
    id: 1,
    state,
    environment: "production",
    url: "https://deploy.example.com/11",
    creator: "ada",
    createdAt: T(at),
  });

  it("maps statuses to started / succeeded / failed", () => {
    const cases: [DeploymentStatus | null, string, string][] = [
      [null, "github.deploy.started", "info"],
      [status("queued"), "github.deploy.started", "info"],
      [status("in_progress"), "github.deploy.started", "info"],
      [status("success"), "github.deploy.succeeded", "success"],
      [status("failure"), "github.deploy.failed", "error"],
      [status("error"), "github.deploy.failed", "error"],
    ];
    for (const [s, type, severity] of cases) {
      const out = diffDeployments([dep], { 11: s }, {}, live);
      expect(out.events[0], String(s?.state)).toMatchObject({
        event_type: type,
        severity,
        correlation_id: "github-deploy-11",
        payload: { environment: "production", deployment_id: 11, actor: "ada", branch: "main" },
      });
    }
    expect(diffDeployments([dep], { 11: status("success") }, {}, live).events[0]!.payload.url).toBe(
      "https://deploy.example.com/11",
    );
    expect(diffDeployments([dep], { 11: null }, {}, live).events[0]!.payload.url).toBe(
      "https://github.com/octo/phoenix/deployments",
    );
  });

  it("unknown or inactive states produce nothing; a missing lookup keeps the old phase", () => {
    expect(deployPhase(status("inactive"))).toBe("inactive");
    expect(deployPhase(status("weird"))).toBe("inactive");
    expect(diffDeployments([dep], { 11: status("inactive") }, {}, live).events).toEqual([]);
    const running = diffDeployments([dep], { 11: status("in_progress") }, {}, live);
    const skipped = diffDeployments([dep], {}, running.seen, live);
    expect(skipped.events).toEqual([]);
    expect(skipped.seen).toEqual({ 11: "started" });
    const done = diffDeployments([dep], { 11: status("success") }, skipped.seen, live);
    expect(done.events.map((e) => e.event_type)).toEqual(["github.deploy.succeeded"]);
  });

  it("does not replay history and only looks up statuses worth reading", () => {
    const old = { ...dep, id: 3, createdAt: T("2026-09-01T10:00:00Z") };
    expect(
      diffDeployments([old], { 3: status("failure", "2026-09-01T10:01:00Z") }, {}, live).events,
    ).toEqual([]);
    expect(diffDeployments([old], {}, {}, live).seen).toEqual({ 3: "settled" });
    expect(needsStatusLookup(old, undefined, live.liveSince)).toBe(false);
    expect(needsStatusLookup(dep, undefined, live.liveSince)).toBe(true);
    expect(needsStatusLookup(dep, "started", live.liveSince)).toBe(true);
    expect(needsStatusLookup(dep, "succeeded", live.liveSince)).toBe(false);
    expect(needsStatusLookup(old, "started", live.liveSince)).toBe(true);
  });
});

describe("rate limits and back-off", () => {
  const base = {
    intervalMs: 30_000,
    authenticated: true,
    calls: 3,
    failures: 0,
    rate: {},
    now: 1_000_000,
  };

  it("reads rate-limit headers and ignores garbage", () => {
    const h = new Headers({
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": "1700000000",
      "retry-after": "60",
    });
    expect(readRateLimit(h)).toEqual({
      remaining: 0,
      resetAt: 1_700_000_000_000,
      retryAfterMs: 60_000,
    });
    expect(
      readRateLimit(new Headers({ "x-ratelimit-remaining": "-3", "retry-after": "soon" })),
    ).toEqual({});
  });

  it("tells a rate-limit 403 from a permission 403", () => {
    expect(isRateLimited(403, { remaining: 0 })).toBe(true);
    expect(isRateLimited(403, { retryAfterMs: 60_000 })).toBe(true);
    expect(isRateLimited(403, { remaining: 4000 })).toBe(false);
    expect(isRateLimited(403, {})).toBe(false);
    expect(isRateLimited(429, {})).toBe(true);
    expect(isRateLimited(500, { remaining: 0 })).toBe(false);
  });

  it("polls at the configured interval when all is well", () => {
    expect(nextDelay({ ...base, rate: { remaining: 4000 } })).toBe(30_000);
  });

  it("slows down unauthenticated use to stay under 60 requests/hour", () => {
    const delay = nextDelay({ ...base, authenticated: false, calls: 3 });
    expect(delay).toBeGreaterThanOrEqual(3 * 72_000);
    expect(delay * (60 / 3)).toBeGreaterThanOrEqual(3_600_000 * 0.99 * (50 / 60));
  });

  it("backs off exponentially after failures, capped at five minutes", () => {
    expect(nextDelay({ ...base, failures: 1 })).toBe(60_000);
    expect(nextDelay({ ...base, failures: 2 })).toBe(120_000);
    expect(nextDelay({ ...base, failures: 30 })).toBe(300_000);
  });

  it("waits for the reset when the quota is spent or nearly spent", () => {
    const resetAt = base.now + 10 * 60_000;
    expect(
      nextDelay({ ...base, failure: "rate_limit", failures: 1, rate: { remaining: 0, resetAt } }),
    ).toBe(10 * 60_000 + 1000);
    expect(nextDelay({ ...base, rate: { remaining: 3, resetAt } })).toBe(10 * 60_000 + 1000);
    expect(nextDelay({ ...base, rate: { remaining: 400, resetAt } })).toBe(30_000);
  });

  it("honours Retry-After, falls back to five minutes with no reset header, and caps at an hour", () => {
    expect(nextDelay({ ...base, rate: { retryAfterMs: 120_000 } })).toBe(120_000);
    expect(nextDelay({ ...base, failure: "rate_limit", failures: 1, rate: {} })).toBe(300_000);
    expect(
      nextDelay({
        ...base,
        failure: "rate_limit",
        failures: 1,
        rate: { resetAt: base.now + 10 * 3_600_000 },
      }),
    ).toBe(3_600_000);
    expect(nextDelay({ ...base, rate: { retryAfterMs: 99 * 3_600_000 } })).toBe(3_600_000);
  });

  it("does not hammer after a 401 and never goes below the configured interval", () => {
    expect(nextDelay({ ...base, failure: "auth", failures: 1 })).toBeGreaterThanOrEqual(300_000);
    expect(nextDelay({ ...base, intervalMs: 5_000, rate: { resetAt: 0, remaining: 100 } })).toBe(
      5_000,
    );
  });
});
