// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// GitHub capability (Phase 22): polls the repositories the user selected for pull requests,
// reviews, GitHub Actions runs and deployments, and turns changes into github.* events.
// Read-only: it only ever issues GET requests. Issues are deliberately not covered here; the
// issue-tracker capability (Phase 26) owns them.
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";
import {
  GithubClient,
  GithubError,
  nextDelay,
  type GithubFailureKind,
  type RateLimitInfo,
} from "./client";
import {
  diffDeployments,
  diffPulls,
  diffReviews,
  diffRuns,
  needsStatusLookup,
  withFailedJob,
  type DiffContext,
  type GithubEvent,
  type PrSeen,
} from "./events";
import {
  parseDeploymentStatuses,
  parseDeployments,
  parseJobs,
  parsePulls,
  parseReviews,
  parseRuns,
  parseViewer,
  type Deployment,
  type DeploymentStatus,
  type PullRequest,
} from "./parse";

export * from "./client";
export * from "./events";
export * from "./parse";

export const DEFAULT_POLL_MS = 30_000;
export const MIN_POLL_MS = 5_000;
export const MAX_REPOSITORIES = 20;

/** "owner/name". Rejects "." and ".." as a name: they would rewrite the request path. */
export const REPOSITORY_PATTERN =
  "^[A-Za-z0-9][A-Za-z0-9-]{0,38}/(?!\\.{1,2}$)[A-Za-z0-9._-]{1,100}$";
const REPOSITORY_RE = new RegExp(REPOSITORY_PATTERN);

const PULLS_PER_PAGE = 50;
/** Most pull requests of the user's own whose reviews are read each cycle. */
const REVIEW_LOOKUPS = 10;
const DEPLOYMENTS_PER_PAGE = 10;
const DEPLOYMENT_STATUS_LOOKUPS = 5;
const JOB_LOOKUPS = 3;

/** Failures that say nothing about one repository: stop the cycle and back off. */
const CYCLE_FAILURES: Readonly<Record<GithubFailureKind, boolean>> = {
  auth: true,
  rate_limit: true,
  network: true,
  http: true,
  forbidden: false,
  not_found: false,
  invalid: false,
};

/** What the `status` command and the health message report for one repository. */
export interface RepoView {
  repository: string;
  error?: string;
  checked_at?: string;
  open_pull_requests?: number;
  /** True when the open-PR count may be a lower bound (the newest page was full). */
  pull_requests_truncated?: boolean;
  latest_run?: {
    run_id: number;
    workflow: string;
    status: string;
    conclusion: string | null;
    branch: string;
    url: string;
  };
}

interface RepoSeen {
  runs: Record<number, string>;
  prs: Record<number, PrSeen>;
  deployments: Record<number, string>;
  /** Last list GitHub sent, reused when it answers 304. */
  pulls: PullRequest[];
  deployList: Deployment[];
}

export interface GithubCapabilityOptions {
  /** Epoch ms clock; tests pin it. */
  now?: () => number;
  /** Waits between polls; resolves early when `signal` aborts. Tests control time with it. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function realSleep(ms: number, signal: AbortSignal): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, ms);
  signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      resolve();
    },
    { once: true },
  );
  return promise;
}

interface Settings {
  repositories: string[];
  pollMs: number;
  apiUrl: string | undefined;
}

function settings(ctx: CapabilityContext): Settings {
  const { repositories, poll_ms, api_url } = ctx.config;
  return {
    repositories: Array.isArray(repositories)
      ? repositories.filter((r): r is string => typeof r === "string" && REPOSITORY_RE.test(r))
      : [],
    pollMs: typeof poll_ms === "number" ? Math.max(poll_ms, MIN_POLL_MS) : DEFAULT_POLL_MS,
    apiUrl: typeof api_url === "string" ? api_url : undefined,
  };
}

/** A fresh capability instance (its own watcher state); Phoenix Core uses `githubCapability`. */
export function createGithubCapability(options: GithubCapabilityOptions = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;

  let client: GithubClient | undefined;
  let clientKey = "";
  let viewer: string | undefined;
  let liveSince = 0;
  let seen: Record<string, RepoSeen> = {};
  let views: Record<string, RepoView> = {};
  let polled = false;
  let inflight: Promise<void> | null = null;

  // What the last cycle learned, for health and for the delay before the next one.
  let failure: GithubError | undefined;
  let failures = 0;
  let authenticated = false;
  let resumeAt: number | undefined;

  function clientFor(ctx: CapabilityContext, token: string | undefined): GithubClient {
    const { apiUrl } = settings(ctx);
    const key = `${apiUrl ?? ""}\n${token ?? ""}`;
    // A new token or endpoint starts clean: cached ETags belong to what the old token could see.
    if (!client || key !== clientKey) {
      client = new GithubClient({
        ...(apiUrl ? { baseUrl: apiUrl } : {}),
        token,
        signal: ctx.signal,
      });
      clientKey = key;
      viewer = undefined;
    }
    return client;
  }

  async function section(problems: string[], name: string, run: () => Promise<void>) {
    try {
      await run();
    } catch (err) {
      // Authorisation, rate limits and outages end the cycle; a bad section does not.
      if (!(err instanceof GithubError) || CYCLE_FAILURES[err.kind] || err.kind === "not_found") {
        throw err;
      }
      problems.push(`${name}: ${err.message}`);
    }
  }

  async function pollRepo(ctx: CapabilityContext, http: GithubClient, repo: string) {
    const state = (seen[repo] ??= {
      runs: {},
      prs: {},
      deployments: {},
      pulls: [],
      deployList: [],
    });
    const view = (views[repo] ??= { repository: repo });
    const diffContext: DiffContext = { repository: repo, liveSince, viewer };
    const base = `/repos/${repo}`;
    const problems: string[] = [];
    const emit = (event: GithubEvent) => void ctx.emit(event);

    await section(problems, "Actions", async () => {
      const runs = await http.get(`${base}/actions/runs?per_page=30`, parseRuns);
      if (!runs.value) return;
      const diff = diffRuns(runs.value, state.runs, diffContext);
      state.runs = diff.seen;
      const latest = [...runs.value].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
      if (latest) {
        view.latest_run = {
          run_id: latest.id,
          workflow: latest.name,
          status: latest.status,
          conclusion: latest.conclusion,
          branch: latest.branch,
          url: latest.url,
        };
      } else delete view.latest_run;
      let lookups = 0;
      for (const { run, event } of diff.changes) {
        let out = event;
        if (event.event_type === "github.ci.failed" && lookups++ < JOB_LOOKUPS) {
          // The failed job is a nicety: a failure to find it must not lose the failure itself.
          const jobs = await http
            .get(`${base}/actions/runs/${run.id}/jobs?filter=latest&per_page=30`, parseJobs)
            .catch(() => undefined);
          if (jobs?.value) out = withFailedJob(event, jobs.value);
        }
        emit(out);
      }
    });

    await section(problems, "Pull requests", async () => {
      const pulls = await http.get(
        `${base}/pulls?state=all&sort=updated&direction=desc&per_page=${PULLS_PER_PAGE}`,
        parsePulls,
      );
      if (pulls.value) {
        const diff = diffPulls(pulls.value, state.prs, diffContext);
        state.prs = diff.seen;
        state.pulls = pulls.value;
        for (const event of diff.events) emit(event);
        view.open_pull_requests = pulls.value.filter((p) => p.open).length;
        view.pull_requests_truncated = pulls.value.length >= PULLS_PER_PAGE;
      }
      // Reviews of the user's own open pull requests; unchanged ones answer 304 for free.
      if (!viewer) return;
      const mine = state.pulls
        .filter((p) => p.open && p.author === viewer)
        .slice(0, REVIEW_LOOKUPS);
      for (const pr of mine) {
        const entry = state.prs[pr.number];
        const reviews = await http.get(
          `${base}/pulls/${pr.number}/reviews?per_page=100`,
          parseReviews,
        );
        if (!reviews.value || !entry) continue;
        const diff = diffReviews(pr, reviews.value, entry.reviews, diffContext);
        entry.reviews = diff.reviews;
        for (const event of diff.events) emit(event);
      }
    });

    await section(problems, "Deployments", async () => {
      const list = await http.get(
        `${base}/deployments?per_page=${DEPLOYMENTS_PER_PAGE}`,
        parseDeployments,
      );
      if (list.value) state.deployList = list.value;
      // An unchanged list says nothing about statuses: a running deployment still needs reading.
      const latest: Record<number, DeploymentStatus | null> = {};
      let lookups = 0;
      for (const deployment of state.deployList) {
        if (
          lookups >= DEPLOYMENT_STATUS_LOOKUPS ||
          !needsStatusLookup(deployment, state.deployments[deployment.id], liveSince)
        ) {
          continue;
        }
        lookups++;
        const statuses = await http.get(
          `${base}/deployments/${deployment.id}/statuses?per_page=1`,
          parseDeploymentStatuses,
        );
        if (statuses.value) latest[deployment.id] = statuses.value[0] ?? null;
      }
      const diff = diffDeployments(state.deployList, latest, state.deployments, diffContext);
      state.deployments = diff.seen;
      for (const event of diff.events) emit(event);
    });

    view.checked_at = new Date(now()).toISOString();
    if (problems.length) view.error = problems.join("; ");
    else delete view.error;
  }

  async function poll(ctx: CapabilityContext): Promise<void> {
    const token = await ctx.secret("token");
    const http = clientFor(ctx, token);
    http.calls = 0;
    http.rate = {};
    authenticated = http.authenticated;
    failure = undefined;
    try {
      if (token && !viewer) {
        // Needed to tell which review requests are for this user.
        viewer = (await http.get("/user", parseViewer)).value;
      }
      for (const repo of settings(ctx).repositories) {
        if (ctx.signal.aborted) return;
        try {
          await pollRepo(ctx, http, repo);
        } catch (err) {
          if (!(err instanceof GithubError) || CYCLE_FAILURES[err.kind]) throw err;
          (views[repo] ??= { repository: repo }).error = err.message;
        }
      }
    } catch (err) {
      failure =
        err instanceof GithubError
          ? err
          : new GithubError("http", "Unexpected error while reading GitHub");
    }
    polled = true;
  }

  function pollOnce(ctx: CapabilityContext): Promise<void> {
    return (inflight ??= poll(ctx).finally(() => (inflight = null)));
  }

  /** Milliseconds to wait before the next cycle, given how the last one went. */
  function delayFor(ctx: CapabilityContext): number {
    const http = client;
    failures = failure ? failures + 1 : 0;
    const rate: RateLimitInfo = { ...http?.rate, ...failure?.rate };
    const delay = nextDelay({
      intervalMs: settings(ctx).pollMs,
      authenticated,
      calls: http?.calls ?? 0,
      failures,
      ...(failure ? { failure: failure.kind } : {}),
      rate,
      now: now(),
    });
    resumeAt = delay > settings(ctx).pollMs ? now() + delay : undefined;
    return delay;
  }

  return defineCapability({
    manifest: {
      id: "github",
      name: "GitHub",
      version: "0.1.0",
      description:
        "Pull requests, review requests, GitHub Actions runs and deployments from the repositories you pick. Read-only. The token is optional: without one only public repositories work, at GitHub's low unauthenticated rate limit (60 requests per hour).",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: ["github.*"],
      // external_api: the token makes these calls as you; network alone would not say so.
      permissions: ["network", "external_api"],
      data_categories: [
        "repository names",
        "pull request titles and authors",
        "CI run names and results",
        "deployment environments",
      ],
      healthcheck: { interval_ms: 15_000 },
      secrets: [
        {
          name: "token",
          description:
            "GitHub personal access token, optional. A fine-grained token with read-only access to Pull requests, Actions and Deployments (and Metadata) is enough. Without it only public repositories work, at 60 requests per hour, and review requests for you cannot be detected.",
        },
      ],
      commands: [
        {
          name: "status",
          description: "Open pull requests and the latest CI run of each watched repository",
          side_effect: "read",
          permissions: ["network", "external_api"],
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          repositories: {
            type: "array",
            maxItems: MAX_REPOSITORIES,
            uniqueItems: true,
            items: { type: "string", pattern: REPOSITORY_PATTERN },
            description: 'Repositories to watch, as "owner/name"',
          },
          poll_ms: {
            type: "integer",
            minimum: MIN_POLL_MS,
            maximum: 3_600_000,
            description: `Milliseconds between checks (default ${DEFAULT_POLL_MS}). Unauthenticated use is slowed further to stay under GitHub's limit.`,
          },
          api_url: {
            type: "string",
            pattern: "^(https://[^\\s]+|http://(127\\.0\\.0\\.1|localhost)(:[0-9]+)?(/[^\\s]*)?)$",
            description:
              "API base URL for GitHub Enterprise (https://HOST/api/v3). Plain http is only accepted for localhost.",
          },
        },
      },
      state_rules: [
        // No ttl: the request stays until the review is done (or the PR is closed).
        {
          match: "github.review.requested",
          effect: { state: "WAITING", explain: "Review requested: {subject}" },
        },
        { match: "github.review.approved", effect: { clear: true } },
        { match: "github.review.changes_requested", effect: { clear: true } },
        { match: "github.review.request_removed", effect: { clear: true } },
        { match: "github.pr.closed", effect: { clear: true } },
        { match: "github.pr.merged", effect: { clear: true } },
        {
          match: "github.ci.started",
          effect: { state: "WORKING", explain: "CI running: {subject}", timeoutMs: 60 * 60_000 },
        },
        {
          match: "github.ci.passed",
          effect: { state: "SUCCESS", explain: "CI passed: {subject}", ttlMs: 10_000 },
        },
        { match: "github.ci.failed", effect: { state: "ERROR", explain: "CI failed: {subject}" } },
        { match: "github.ci.cancelled", effect: { clear: true } },
        {
          match: "github.deploy.started",
          effect: {
            state: "DEPLOYING",
            explain: "Deploying to {payload.environment}",
            timeoutMs: 60 * 60_000,
          },
        },
        {
          match: "github.deploy.succeeded",
          effect: { state: "SUCCESS", explain: "Deployed to {payload.environment}", ttlMs: 8_000 },
        },
        {
          match: "github.deploy.failed",
          effect: { state: "ERROR", explain: "Deploy failed: {subject}" },
        },
      ],
    },
    init(ctx) {
      seen = {};
      views = {};
      client = undefined;
      clientKey = "";
      viewer = undefined;
      polled = false;
      failure = undefined;
      failures = 0;
      resumeAt = undefined;
      // History rule: anything that began before this moment is background, not news.
      liveSince = now();
      void (async () => {
        while (!ctx.signal.aborted) {
          await pollOnce(ctx);
          await sleep(delayFor(ctx), ctx.signal);
        }
      })();
    },
    commands: {
      async status(_input, ctx) {
        if (!polled) await pollOnce(ctx);
        return {
          authenticated,
          ...(viewer ? { viewer } : {}),
          repositories: settings(ctx).repositories.map((r) => views[r] ?? { repository: r }),
        };
      },
    },
    health(ctx): HealthResult {
      const { repositories } = settings(ctx);
      if (!repositories.length) return { status: "degraded", message: "No repositories selected" };
      if (!polled) return { status: "healthy", message: "Reading GitHub…" };
      const wait = resumeAt ? ` Next check ${new Date(resumeAt).toISOString()}.` : "";
      if (failure?.kind === "rate_limit") {
        return { status: "degraded", message: `${failure.message}.${wait}` };
      }
      if (failure?.kind === "auth") return { status: "degraded", message: failure.message };
      if (failure) return { status: "unhealthy", message: failure.message };
      const broken = repositories.flatMap((r) =>
        views[r]?.error ? [`${r}: ${views[r].error}`] : [],
      );
      if (broken.length) return { status: "degraded", message: broken.join("; ") };
      const mode = authenticated
        ? viewer
          ? `as ${viewer}`
          : "with a token"
        : "without a token (public repositories only, 60 requests/hour)";
      return {
        status: "healthy",
        message: `Watching ${repositories.length} ${repositories.length === 1 ? "repository" : "repositories"} ${mode}.${wait}`,
      };
    },
  });
}

export const githubCapability = createGithubCapability();
