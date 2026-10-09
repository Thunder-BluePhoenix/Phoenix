// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GithubClient, GithubError, createGithubCapability, type RepoView } from "../src";
import { MOCK_TOKEN, startMockGithub, type MockGithub } from "../testing/mock-github";

interface RunsFixture {
  workflow_runs: { id: number }[];
}
interface JobsFixture {
  jobs: unknown[];
}

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));

interface StatusResult {
  authenticated: boolean;
  viewer: string;
  repositories: RepoView[];
}

const REPO = "octo/phoenix";
const T0 = Date.parse("2026-10-05T09:00:00Z");

/** Replaces the capability's timers: every wait is recorded and ends only when the test says so. */
class Clock {
  now = T0;
  readonly sleeps: number[] = [];
  private pending: PromiseWithResolvers<void> | undefined;

  readonly sleep = (ms: number, signal: AbortSignal): Promise<void> => {
    this.sleeps.push(ms);
    const wait = Promise.withResolvers<void>();
    this.pending = wait;
    signal.addEventListener("abort", () => wait.resolve(), { once: true });
    return wait.promise;
  };

  /** Ends the current wait; resolves once the next poll cycle has finished and a new wait began. */
  async tick(): Promise<void> {
    const before = this.sleeps.length;
    this.pending?.resolve();
    await vi.waitFor(() => expect(this.sleeps.length).toBeGreaterThan(before));
  }

  /** Resolves once the first poll cycle has finished. */
  first(): Promise<void> {
    return vi.waitFor(() => expect(this.sleeps.length).toBeGreaterThan(0));
  }
}

let h: Harness | undefined;
let gh: MockGithub | undefined;
let clock: Clock;

afterEach(async () => {
  await h?.close();
  await gh?.close();
  h = gh = undefined;
});

async function ready(
  options: {
    token?: string | null;
    config?: Record<string, unknown>;
    data?: (g: MockGithub) => void;
  } = {},
) {
  gh = await startMockGithub();
  clock = new Clock();
  options.data?.(gh);
  h = createHarness({
    modules: [createGithubCapability({ now: () => clock.now, sleep: clock.sleep })],
  });
  h.manager.configure("github", { repositories: [REPO], api_url: gh.url, ...options.config });
  const token = options.token === undefined ? MOCK_TOKEN : options.token;
  if (token) await h.manager.setSecret("github", "token", token);
  await h.enable("github");
  await clock.first();
  return { h, gh };
}

const types = () => h!.types("github");
const fawkes = () => h!.state.snapshot();
const eventOf = (type: string) => h!.events.find((e) => e.event_type === type);
const health = async () => (await h!.manager.checkHealth("github")).health;
const requests = (re: RegExp) => gh!.requests.filter((r) => re.test(r.path));

const rawRun = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  name: "CI",
  head_branch: "main",
  head_sha: "0123456789abcdef",
  display_title: "fix: things",
  event: "push",
  status: "completed",
  conclusion: "success",
  html_url: `https://github.com/${REPO}/actions/runs/${id}`,
  created_at: "2026-10-05T10:00:00Z",
  updated_at: "2026-10-05T10:05:00Z",
  run_attempt: 1,
  actor: { login: "ada" },
  ...over,
});

const rawPull = (number: number, over: Record<string, unknown> = {}) => ({
  number,
  state: "open",
  title: "Add thing",
  html_url: `https://github.com/${REPO}/pull/${number}`,
  created_at: "2026-10-05T10:00:00Z",
  updated_at: "2026-10-05T10:00:00Z",
  closed_at: null,
  merged_at: null,
  draft: false,
  user: { login: "ada" },
  head: { ref: "feature" },
  base: { ref: "main" },
  requested_reviewers: [],
  ...over,
});

describe("manifest and configuration", () => {
  it("asks for network + external_api, keeps the token out of config, is read-only", async () => {
    await ready();
    const view = h!.manager.get("github");
    expect(view.permissions.map((p) => p.permission)).toEqual(["network", "external_api"]);
    expect(view.secrets).toEqual([expect.objectContaining({ name: "token", set: true })]);
    expect(view.commands).toEqual([
      expect.objectContaining({ name: "status", side_effect: "read" }),
      expect.objectContaining({ name: "ci.failure_details", side_effect: "read" }),
    ]);
    expect(JSON.stringify(view)).not.toContain(MOCK_TOKEN);
    expect(() =>
      h!.manager.configure("github", {
        repositories: [REPO],
        token: "ghp_abcdefghijklmnopqrstuvwxyz0123",
      }),
    ).toThrow();
    expect(view.description).toMatch(/optional/);
  });

  it("validates repositories, the 20 repository limit and the 5 s minimum poll interval", async () => {
    await ready();
    const reject = (config: Record<string, unknown>) =>
      h!.manager.configure("github", config) && h!.enable("github");
    const bad: Record<string, unknown>[] = [
      { repositories: ["not-a-repo"] },
      { repositories: ["a/b/c"] },
      { repositories: ["../etc"] },
      { repositories: ["octo/.."] },
      { repositories: ["octo/phoenix?x=1"] },
      { repositories: [REPO, REPO] },
      { repositories: Array.from({ length: 21 }, (_, i) => `octo/r${i}`) },
      { repositories: [REPO], poll_ms: 4_999 },
      { repositories: [REPO], api_url: "http://evil.example.com" },
      { repositories: [REPO], unknown: 1 },
    ];
    await h!.manager.disable("github");
    for (const config of bad) {
      await expect(
        Promise.resolve().then(() => reject(config)),
        JSON.stringify(config).slice(0, 60),
      ).rejects.toThrow();
    }
    expect(() =>
      h!.manager.configure("github", {
        repositories: Array.from({ length: 20 }, (_, i) => `octo/r${i}`),
        poll_ms: 5_000,
        api_url: "https://ghe.example.com/api/v3",
      }),
    ).not.toThrow();
  });
});

describe("authentication", () => {
  it("sends the token only when one is set, and never calls /user without it", async () => {
    await ready({ token: null, data: (g) => (g.data.runs = [rawRun(1)]) });
    expect(gh!.requests.length).toBeGreaterThan(0);
    expect(gh!.requests.every((r) => r.authorization === undefined)).toBe(true);
    expect(requests(/^\/user/)).toEqual([]);
    expect(gh!.requests.every((r) => r.method === "GET")).toBe(true);
    expect(await health()).toMatchObject({
      status: "healthy",
      message: expect.stringMatching(/without a token/),
    });
    await h!.close();
    await gh!.close();

    await ready();
    expect(requests(/^\/user/)[0]?.authorization).toBe(`Bearer ${MOCK_TOKEN}`);
    expect(requests(/actions\/runs/)[0]?.authorization).toBe(`Bearer ${MOCK_TOKEN}`);
    expect(await health()).toMatchObject({
      status: "healthy",
      message: expect.stringMatching(/as me/),
    });
  });

  it("401: degraded with a message that never contains the token, and a long pause before retrying", async () => {
    const wrong = "ghp_wrongwrongwrongwrongwrongwrongwrong1";
    await ready({ token: wrong });
    const result = await health();
    expect(result.status).toBe("degraded");
    expect(result.message).toMatch(/rejected the token \(401\)/);
    expect(result.message).not.toContain(wrong);
    expect(JSON.stringify([h!.events, h!.manager.get("github")])).not.toContain(wrong);
    expect(gh!.requests).toHaveLength(1); // stopped at /user instead of hammering every repo
    expect(clock.sleeps[0]).toBeGreaterThanOrEqual(5 * 60_000);
    expect(types().filter((t) => t.startsWith("github."))).toEqual([]);
  });
});

describe("conditional requests", () => {
  it("sends If-None-Match, treats 304 as no change and emits nothing again", async () => {
    await ready({ data: (g) => (g.data.runs = [rawRun(1, { conclusion: "failure" })]) });
    await vi.waitFor(() => expect(types()).toContain("github.ci.failed"));
    const first = requests(/actions\/runs\?/);
    expect(first[0]).toMatchObject({ status: 200, ifNoneMatch: undefined });

    await clock.tick();
    const second = requests(/actions\/runs\?/)[1]!;
    expect(second.status).toBe(304);
    expect(second.ifNoneMatch).toBeTruthy();
    expect(requests(/pulls\?/)[1]).toMatchObject({ status: 304 });
    expect(types().filter((t) => t === "github.ci.failed")).toHaveLength(1);
    expect(await health()).toMatchObject({ status: "healthy" });

    gh!.data.runs = [
      rawRun(2, { conclusion: "success", created_at: "2026-10-05T11:00:00Z" }),
      ...gh!.data.runs,
    ];
    await clock.tick();
    expect(requests(/actions\/runs\?/)[2]).toMatchObject({ status: 200 });
    expect(types().filter((t) => t === "github.ci.passed")).toHaveLength(1);
  });
});

describe("rate limiting", () => {
  it("403 with no quota left: degraded, one request only, no events, waits for the reset, then recovers", async () => {
    gh = undefined;
    const resetAt = T0 + 10 * 60_000;
    await ready({
      data: (g) => {
        g.data.runs = [rawRun(1, { conclusion: "failure" })];
        g.control.respond = (_path: string, res: ServerResponse) => {
          res.writeHead(403, {
            "content-type": "application/json",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(resetAt / 1000),
          });
          res.end('{"message":"API rate limit exceeded"}');
          return true;
        };
      },
    });
    const result = await health();
    expect(result).toMatchObject({
      status: "degraded",
      message: expect.stringMatching(/rate limit/i),
    });
    expect(gh!.requests).toHaveLength(1);
    expect(clock.sleeps[0]).toBe(10 * 60_000 + 1000);
    expect(types().filter((t) => t.startsWith("github."))).toEqual([]);

    delete gh!.control.respond;
    clock.now = resetAt + 5_000;
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("github.ci.failed"));
    expect(await health()).toMatchObject({ status: "healthy" });
  });

  it("slows down when the remaining quota is nearly spent, even on 200 responses", async () => {
    await ready({
      data: (g) => {
        g.control.respond = (path: string, res: ServerResponse) => {
          if (!path.startsWith("/user")) return false;
          res.writeHead(200, {
            "content-type": "application/json",
            "x-ratelimit-remaining": "2",
            "x-ratelimit-reset": String((T0 + 20 * 60_000) / 1000),
          });
          res.end('{"login":"me"}');
          return true;
        };
      },
    });
    expect(clock.sleeps[0]).toBe(20 * 60_000 + 1000);
  });

  it("429 with Retry-After is honoured", async () => {
    await ready({
      data: (g) => {
        g.control.respond = (_path: string, res: ServerResponse) => {
          res.writeHead(429, { "retry-after": "120" });
          res.end("{}");
          return true;
        };
      },
    });
    expect(clock.sleeps[0]).toBeGreaterThanOrEqual(120_000);
    expect((await health()).status).toBe("degraded");
  });

  it("spaces out unauthenticated polling to stay under 60 requests per hour", async () => {
    await ready({ token: null });
    const calls = gh!.requests.length;
    expect(calls).toBe(3); // runs, pulls, deployments
    expect(clock.sleeps[0]).toBeGreaterThanOrEqual(calls * 72_000);
  });

  it("backs off exponentially when GitHub is failing", async () => {
    await ready({
      data: (g) => {
        g.control.respond = (_path: string, res: ServerResponse) => {
          res.writeHead(502);
          res.end();
          return true;
        };
      },
    });
    expect(await health()).toMatchObject({
      status: "unhealthy",
      message: expect.stringMatching(/HTTP 502/),
    });
    await clock.tick();
    await clock.tick();
    expect(clock.sleeps).toEqual([60_000, 120_000, 240_000]);
  });
});

describe("hostile responses", () => {
  it("a body that is not JSON or the wrong shape degrades that section, loses nothing else", async () => {
    await ready({
      data: (g) => {
        g.data.pulls = [rawPull(7)];
        g.control.respond = (path: string, res: ServerResponse) => {
          if (!path.includes("/actions/runs?")) return false;
          res.writeHead(200, { "content-type": "application/json" });
          res.end("<html>captive portal</html>");
          return true;
        };
      },
    });
    await vi.waitFor(() => expect(types()).toContain("github.pr.opened"));
    const result = await health();
    expect(result).toMatchObject({
      status: "degraded",
      message: expect.stringMatching(/Actions: .*unexpected format/),
    });

    gh!.control.respond = (path: string, res: ServerResponse) => {
      if (!path.includes("/actions/runs?")) return false;
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"workflow_runs": {"0": 1}}');
      return true;
    };
    await clock.tick();
    expect((await health()).status).toBe("degraded");
    expect(types().filter((t) => t.startsWith("github.ci."))).toEqual([]);
  });

  it("clips giant strings and keeps junk entries out of the events", async () => {
    await ready({
      data: (g) => {
        g.data.runs = [
          null,
          42,
          rawRun(1, {
            conclusion: "failure",
            name: "N".repeat(50_000),
            display_title: "T".repeat(50_000),
            head_branch: "B".repeat(50_000),
            actor: { login: "ada\nINJECT" },
          }),
          rawRun(2, { html_url: "javascript:alert(1)", conclusion: "failure" }),
        ];
      },
    });
    await vi.waitFor(() => expect(types()).toContain("github.ci.failed"));
    expect(types().filter((t) => t === "github.ci.failed")).toHaveLength(1);
    const e = eventOf("github.ci.failed")!;
    for (const key of ["title", "workflow", "branch"]) {
      expect((e.payload[key] as string).length).toBeLessThanOrEqual(200);
    }
    expect(e.payload.actor).toBe("unknown");
    expect(e.subject!.length).toBeLessThanOrEqual(500);
  });

  it("caps the size of a response (an endless body does not exhaust memory)", async () => {
    let written = 0;
    await ready({
      data: (g) => {
        g.control.respond = (path: string, res: ServerResponse) => {
          if (!path.includes("/actions/runs?")) return false;
          res.writeHead(200, { "content-type": "application/json" }); // no content-length
          const chunk = Buffer.alloc(256 * 1024, "a");
          const pump = () => {
            while (!res.destroyed && res.write(chunk)) written += chunk.length;
            if (!res.destroyed) res.once("drain", pump);
          };
          pump();
          return true;
        };
      },
    });
    expect(await health()).toMatchObject({
      status: "degraded",
      message: expect.stringMatching(/too large/),
    });
    expect(written).toBeLessThan(64 * 1024 * 1024);
  });

  it("GithubClient refuses a declared oversize body and an oversize chunked body", async () => {
    gh = await startMockGithub();
    gh.control.respond = (path: string, res: ServerResponse) => {
      if (path.includes("declared")) {
        res.writeHead(200, { "content-length": "100000" });
        res.write("[");
        return true;
      }
      res.writeHead(200);
      res.end("[" + "1,".repeat(500) + "1]");
      return true;
    };
    const client = new GithubClient({ baseUrl: gh.url, maxBytes: 1000 });
    for (const path of ["/declared", "/chunked"]) {
      await expect(client.get(path, (b) => b)).rejects.toMatchObject({
        kind: "invalid",
        message: expect.stringMatching(/too large/),
      });
    }
  });

  it("GithubClient never follows redirects and reports network failure without details", async () => {
    gh = await startMockGithub();
    gh.control.respond = (_path: string, res: ServerResponse) => {
      res.writeHead(302, { location: "http://127.0.0.1:1/steal" });
      res.end();
      return true;
    };
    const client = new GithubClient({ baseUrl: gh.url, token: MOCK_TOKEN });
    const err = await client.get("/x", (b) => b).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GithubError);
    const failure = err as GithubError;
    expect(["network", "http"]).toContain(failure.kind);
    expect(failure.message).not.toContain(MOCK_TOKEN);
    expect(gh.requests).toHaveLength(1);
  });
});

describe("Fawkes states", () => {
  it("EXIT CRITERION: a real failed CI run (recorded fixture) shows ERROR with the run's link", async () => {
    const runsFixture = fixture("runs.json") as RunsFixture;
    const jobsFixture = fixture("jobs-failed-run.json") as JobsFixture;
    const runs = runsFixture.workflow_runs;
    const jobs = jobsFixture.jobs;
    const fixtureRepo = "Thunder-BluePhoenix/Phoenix";
    await ready({
      config: { repositories: [fixtureRepo] },
      data: (g) => {
        // Startup is just before the failed pull_request run; the other failure (18:39) and the
        // passing run (18:43) are earlier history.
        g.data.runs = runs.filter((r) => r.id !== 37827195337);
        g.data.jobs[37145498780] = jobs;
      },
    });
    clock.now = Date.parse("2026-10-03T18:46:00Z");
    await h!.manager.disable("github");
    gh!.requests.length = 0;
    await h!.enable("github");
    await vi.waitFor(() => expect(types()).toContain("github.ci.failed"));

    const failed = types().filter((t) => t === "github.ci.failed");
    expect(failed).toHaveLength(1);
    const e = eventOf("github.ci.failed")!;
    expect(e).toMatchObject({
      source: "github",
      severity: "error",
      correlation_id: "github-run-37145498780",
      subject: `${fixtureRepo} · CI`,
      payload: {
        url: "https://github.com/Thunder-BluePhoenix/Phoenix/actions/runs/37145498780",
        run_id: 37145498780,
        repository: fixtureRepo,
        branch: "claude/upbeat-faraday-qor262",
        actor: "Thunder-BluePhoenix",
        failed_job: "secret-scan",
        job_url:
          "https://github.com/Thunder-BluePhoenix/Phoenix/actions/runs/37145498780/job/111268457077",
      },
    });
    expect(fawkes()).toMatchObject({
      state: "ERROR",
      explanation: `CI failed: ${fixtureRepo} · CI`,
      source: "github",
    });
    // The 18:39 failure and everything else older than startup stayed history.
    expect(types().filter((t) => t.startsWith("github.ci."))).toEqual(["github.ci.failed"]);
  });

  it("does not replay history: last week's failure leaves Fawkes IDLE, a new failure does not", async () => {
    await ready({
      data: (g) =>
        (g.data.runs = [
          rawRun(1, {
            conclusion: "failure",
            created_at: "2026-09-28T10:00:00Z",
            updated_at: "2026-09-28T10:05:00Z",
          }),
        ]),
    });
    await h!.drain();
    expect(types().filter((t) => t.startsWith("github.ci."))).toEqual([]);
    expect(fawkes().state).toBe("IDLE");

    gh!.data.runs = [
      rawRun(2, { conclusion: "failure", created_at: "2026-10-05T10:00:00Z" }),
      ...gh!.data.runs,
    ];
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("github.ci.failed"));
    expect(fawkes()).toMatchObject({ state: "ERROR", explanation: `CI failed: ${REPO} · CI` });
    expect(eventOf("github.ci.failed")!.payload.run_id).toBe(2);
  });

  it("CI started → WORKING, then the same run failing replaces it with ERROR; passing gives SUCCESS", async () => {
    await ready();
    gh!.data.runs = [rawRun(5, { status: "in_progress", conclusion: null })];
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("github.ci.started"));
    expect(fawkes()).toMatchObject({ state: "WORKING", explanation: `CI running: ${REPO} · CI` });

    gh!.data.runs = [rawRun(5, { conclusion: "failure" })];
    await clock.tick();
    await vi.waitFor(() => expect(fawkes().state).toBe("ERROR"));
    expect(fawkes().conditions.filter((c) => c.source === "github")).toHaveLength(1);

    gh!.data.runs = [
      rawRun(6, { conclusion: "success", created_at: "2026-10-05T12:00:00Z" }),
      ...gh!.data.runs,
    ];
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("github.ci.passed"));
    expect(
      fawkes()
        .conditions.map((c) => c.state)
        .sort(),
    ).toEqual(["ERROR", "SUCCESS"]);
    expect(fawkes().state).toBe("ERROR"); // an unresolved failure outranks a later success
  });

  it("a cancelled run clears its WORKING state instead of leaving Fawkes busy", async () => {
    await ready();
    gh!.data.runs = [rawRun(5, { status: "queued", conclusion: null })];
    await clock.tick();
    await vi.waitFor(() => expect(fawkes().state).toBe("WORKING"));
    gh!.data.runs = [rawRun(5, { conclusion: "cancelled" })];
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("github.ci.cancelled"));
    expect(fawkes().state).toBe("IDLE");
  });

  it("review requested of you → WAITING until the request is gone; closing the PR clears it too", async () => {
    await ready({
      data: (g) => (g.data.pulls = [rawPull(7, { requested_reviewers: [{ login: "me" }] })]),
    });
    await vi.waitFor(() => expect(types()).toContain("github.review.requested"));
    expect(eventOf("github.review.requested")).toMatchObject({
      subject: `${REPO}#7`,
      requires_action: true,
      payload: { url: `https://github.com/${REPO}/pull/7`, number: 7, actor: "ada" },
    });
    expect(fawkes()).toMatchObject({
      state: "WAITING",
      explanation: `Review requested: ${REPO}#7`,
    });

    // No ttl: still waiting after many polls.
    await clock.tick();
    await clock.tick();
    expect(fawkes().state).toBe("WAITING");

    // You reviewed it: GitHub drops you from requested_reviewers.
    gh!.data.pulls = [rawPull(7, { updated_at: "2026-10-05T11:00:00Z" })];
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("github.review.request_removed"));
    expect(fawkes().state).toBe("IDLE");

    gh!.data.pulls = [
      rawPull(7, { requested_reviewers: [{ login: "me" }], updated_at: "2026-10-05T12:00:00Z" }),
    ];
    await clock.tick();
    await vi.waitFor(() => expect(fawkes().state).toBe("WAITING"));
    gh!.data.pulls = [
      rawPull(7, {
        state: "closed",
        closed_at: "2026-10-05T13:00:00Z",
        requested_reviewers: [{ login: "me" }],
      }),
    ];
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("github.pr.closed"));
    expect(fawkes().state).toBe("IDLE");
  });

  it("without a token nobody's review request is detected", async () => {
    await ready({
      token: null,
      data: (g) => (g.data.pulls = [rawPull(7, { requested_reviewers: [{ login: "me" }] })]),
    });
    await vi.waitFor(() => expect(types()).toContain("github.pr.opened"));
    expect(types()).not.toContain("github.review.requested");
    expect(fawkes().state).toBe("IDLE");
  });

  it("pull requests: opened, merged; reviews on your own PR: changes requested, approved", async () => {
    await ready();
    gh!.data.pulls = [rawPull(8, { user: { login: "me" }, head: { ref: "mine" } })];
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("github.pr.opened"));
    expect(eventOf("github.pr.opened")).toMatchObject({
      severity: "info",
      subject: `${REPO}#8`,
      payload: { actor: "me", branch: "mine", base: "main", number: 8 },
    });

    gh!.data.reviews[8] = [
      {
        id: 100,
        state: "CHANGES_REQUESTED",
        user: { login: "bob" },
        submitted_at: "2026-10-05T10:30:00Z",
        html_url: `https://github.com/${REPO}/pull/8#pullrequestreview-100`,
      },
      { id: 101, state: "COMMENTED", user: { login: "cy" }, submitted_at: "2026-10-05T10:31:00Z" },
    ];
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("github.review.changes_requested"));
    expect(eventOf("github.review.changes_requested")).toMatchObject({
      severity: "warning",
      payload: { actor: "bob", url: `https://github.com/${REPO}/pull/8#pullrequestreview-100` },
    });
    gh!.data.reviews[8] = [
      ...gh!.data.reviews[8]!,
      { id: 102, state: "APPROVED", user: { login: "bob" }, submitted_at: "2026-10-05T11:00:00Z" },
    ];
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("github.review.approved"));
    expect(types().filter((t) => t.startsWith("github.review."))).toEqual([
      "github.review.changes_requested",
      "github.review.approved",
    ]);

    gh!.data.pulls = [
      rawPull(8, {
        user: { login: "me" },
        state: "closed",
        merged_at: "2026-10-05T12:00:00Z",
        closed_at: "2026-10-05T12:00:00Z",
      }),
    ];
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("github.pr.merged"));
    expect(requests(/\/reviews/).every((r) => r.authorization !== undefined)).toBe(true);
  });

  it("deployments: started → DEPLOYING, succeeded → SUCCESS, failed → ERROR", async () => {
    await ready();
    const deployment = (id: number, over = {}) => ({
      id,
      environment: "production",
      ref: "main",
      creator: { login: "ada" },
      created_at: "2026-10-05T10:00:00Z",
      ...over,
    });
    gh!.data.deployments = [deployment(11)];
    gh!.data.statuses[11] = [
      {
        id: 1,
        state: "in_progress",
        creator: { login: "ada" },
        created_at: "2026-10-05T10:01:00Z",
      },
    ];
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("github.deploy.started"));
    expect(fawkes()).toMatchObject({ state: "DEPLOYING", explanation: "Deploying to production" });

    gh!.data.statuses[11] = [
      {
        id: 2,
        state: "success",
        target_url: "https://app.example.com",
        creator: { login: "ada" },
        created_at: "2026-10-05T10:05:00Z",
      },
      ...gh!.data.statuses[11]!,
    ];
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("github.deploy.succeeded"));
    expect(fawkes().state).toBe("SUCCESS");
    expect(eventOf("github.deploy.succeeded")!.payload.url).toBe("https://app.example.com");

    gh!.data.deployments = [
      deployment(12, { environment: "staging", created_at: "2026-10-05T11:00:00Z" }),
      ...gh!.data.deployments,
    ];
    gh!.data.statuses[12] = [
      { id: 3, state: "failure", creator: { login: "ada" }, created_at: "2026-10-05T11:02:00Z" },
    ];
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("github.deploy.failed"));
    expect(fawkes()).toMatchObject({
      state: "ERROR",
      explanation: `Deploy failed: staging (${REPO})`,
    });
    // Settled deployments are not re-read every cycle.
    expect(requests(/deployments\/11\/statuses/)).toHaveLength(2);
  });

  it("deployments from before startup are history", async () => {
    await ready({
      data: (g) => {
        g.data.deployments = [
          {
            id: 3,
            environment: "production",
            ref: "main",
            creator: { login: "ada" },
            created_at: "2026-09-01T10:00:00Z",
          },
        ];
        g.data.statuses[3] = [
          {
            id: 9,
            state: "failure",
            creator: { login: "ada" },
            created_at: "2026-09-01T10:01:00Z",
          },
        ];
      },
    });
    expect(types().filter((t) => t.startsWith("github.deploy"))).toEqual([]);
    expect(requests(/statuses/)).toEqual([]);
    expect(fawkes().state).toBe("IDLE");
  });
});

describe("status command and health", () => {
  it("summarises open pull requests and the latest run per repository (read-only, no confirmation)", async () => {
    await ready({
      data: (g) => {
        g.data.pulls = [
          rawPull(1),
          rawPull(2),
          rawPull(3, { state: "closed", closed_at: "2026-10-05T10:00:00Z" }),
        ];
        g.data.runs = [
          rawRun(1, { conclusion: "success", created_at: "2026-10-05T10:00:00Z" }),
          rawRun(2, { conclusion: "failure", created_at: "2026-10-05T11:00:00Z" }),
        ];
      },
    });
    const op = await h!.run("github", "status");
    expect(op.status).toBe("succeeded");
    const result = op.result as StatusResult;
    expect(result).toMatchObject({ authenticated: true, viewer: "me" });
    expect(result.repositories[0]).toMatchObject({
      repository: REPO,
      open_pull_requests: 2,
      latest_run: {
        run_id: 2,
        conclusion: "failure",
        url: `https://github.com/${REPO}/actions/runs/2`,
      },
    });
    expect(JSON.stringify(op.result)).not.toContain(MOCK_TOKEN);
  });

  it("a missing repository (404) degrades only that repository", async () => {
    gh = undefined;
    await ready({
      config: { repositories: ["octo/gone", REPO] },
      data: (g) => {
        g.missingRepos.push("octo/gone");
        g.data.runs = [rawRun(1, { conclusion: "failure" })];
      },
    });
    await vi.waitFor(() => expect(types()).toContain("github.ci.failed"));
    expect(await health()).toMatchObject({
      status: "degraded",
      message: expect.stringMatching(/octo\/gone: .*404/),
    });
  });

  it("reports an empty repository list as degraded without calling GitHub", async () => {
    await ready({ config: { repositories: [] } });
    expect(await health()).toMatchObject({
      status: "degraded",
      message: "No repositories selected",
    });
    expect(requests(/repos/)).toEqual([]);
  });
});
