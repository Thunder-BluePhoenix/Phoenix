// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIssuesCapability, type IssuesOptions } from "../src";
import {
  JIRA_ACCOUNT,
  LINEAR_VIEWER,
  MOCK_GITHUB_TOKEN,
  MOCK_JIRA_EMAIL,
  MOCK_JIRA_TOKEN,
  MOCK_LINEAR_KEY,
  MOCK_LOGIN,
  startMockTrackers,
  type Mode,
  type MockTrackers,
} from "../testing/mock-trackers";

let h: Harness | undefined;
let mock: MockTrackers | undefined;
afterEach(async () => {
  await h?.close();
  await mock?.close();
  h = mock = undefined;
});

/**
 * Lets a test run poll cycles one at a time: the capability's pause between cycles waits for
 * `next()`, which resolves when the following cycle has finished. No real waiting involved.
 */
function createStepper() {
  let arrival = Promise.withResolvers<void>();
  let release = () => {};
  return {
    wait(_ms: number, signal: AbortSignal): Promise<void> {
      arrival.resolve();
      const pause = Promise.withResolvers<void>();
      release = pause.resolve;
      signal.addEventListener("abort", () => pause.resolve(), { once: true });
      return pause.promise;
    },
    /** The first cycle (started by enable) has finished. */
    ready: () => arrival.promise,
    next(): Promise<void> {
      arrival = Promise.withResolvers<void>();
      const done = arrival.promise;
      release();
      return done;
    },
  };
}

interface Setup {
  trackers?: ("github" | "linear" | "jira")[];
  secrets?: Record<string, string>;
  options?: IssuesOptions;
  githubLogin?: string;
  preload?: (m: MockTrackers) => void;
}

const ALL_SECRETS: Record<string, string> = {
  github_token: MOCK_GITHUB_TOKEN,
  linear_api_key: MOCK_LINEAR_KEY,
  jira_email: MOCK_JIRA_EMAIL,
  jira_api_token: MOCK_JIRA_TOKEN,
};

async function start(setup: Setup = {}) {
  const m = (mock = await startMockTrackers());
  setup.preload?.(m);
  const stepper = createStepper();
  const kinds = setup.trackers ?? ["github", "linear", "jira"];
  const trackers = kinds.map((kind) =>
    kind === "github"
      ? {
          kind,
          repositories: ["acme/widgets"],
          api_url: `${m.url}/gh`,
          ...(setup.githubLogin ? { login: setup.githubLogin } : {}),
        }
      : kind === "linear"
        ? { kind, api_url: `${m.url}/linear` }
        : { kind, site: `${m.url}/jira` },
  );
  const harness = (h = createHarness({
    modules: [createIssuesCapability({ wait: stepper.wait, ...setup.options })],
  }));
  harness.manager.configure("issues", { trackers });
  for (const [name, value] of Object.entries(setup.secrets ?? ALL_SECRETS)) {
    await harness.manager.setSecret("issues", name, value);
  }
  await harness.enable("issues");
  await stepper.ready();
  await harness.drain();
  const cycle = async () => {
    await stepper.next();
    await harness.drain();
  };
  const issueEvents = () => harness.events.filter((e) => e.source === "issues");
  const types = () => issueEvents().map((e) => e.event_type);
  const health = async () => (await harness.manager.checkHealth("issues")).health;
  return { h: harness, m, cycle, issueEvents, types, health };
}

const me = [{ login: "me-dev" }];

describe("one event protocol across GitHub, Linear and Jira", () => {
  it("baselines silently, then reports assignment, status change, unassignment and completion for every tracker", async () => {
    const t = await start({
      preload(m) {
        m.github.add({ number: 1, title: "Old GH", assignees: me });
        m.linear.add({ identifier: "ENG-1", title: "Old Linear", assignee: LINEAR_VIEWER });
        m.jira.add({ key: "PROJ-1", summary: "Old Jira", assignee: JIRA_ACCOUNT });
      },
    });
    // First poll: existing assignments are remembered, never replayed.
    expect(t.types()).toEqual([]);
    await t.cycle();
    expect(t.types()).toEqual([]);

    // New assignment on each tracker.
    t.m.github.add({ number: 2, title: "New GH", assignees: me });
    t.m.linear.add({ identifier: "ENG-2", title: "New Linear", assignee: LINEAR_VIEWER });
    t.m.jira.add({ key: "PROJ-2", summary: "New Jira", assignee: JIRA_ACCOUNT });
    // Someone else's issue is not mine.
    t.m.github.add({ number: 3, assignees: [{ login: "other" }] });
    await t.cycle();
    const assigned = t.issueEvents().filter((e) => e.event_type === "issues.assigned");
    expect(assigned.map((e) => [e.payload.tracker, e.payload.key, e.subject, e.severity])).toEqual(
      expect.arrayContaining([
        ["github", "acme/widgets#2", "acme/widgets#2", "info"],
        ["linear", "ENG-2", "ENG-2", "info"],
        ["jira", "PROJ-2", "PROJ-2", "info"],
      ]),
    );
    expect(assigned).toHaveLength(3);
    expect(assigned.find((e) => e.payload.tracker === "linear")).toMatchObject({
      correlation_id: "issues-linear-ENG-2",
      payload: {
        title: "New Linear",
        url: "https://linear.app/acme/issue/ENG-2",
        status: "Todo",
        category: "open",
      },
    });
    expect(assigned.find((e) => e.payload.tracker === "jira")?.payload.url).toBe(
      "https://acme.atlassian.net/browse/PROJ-2".replace(
        "https://acme.atlassian.net",
        `${t.m.url}/jira`,
      ),
    );
    // Being assigned something is not a call to action: Fawkes stays calm.
    expect(t.h.state.snapshot().state).toBe("IDLE");

    // Polling again with no change adds nothing (overlapping `since` windows are de-duplicated).
    await t.cycle();
    expect(t.issueEvents().filter((e) => e.event_type === "issues.assigned")).toHaveLength(3);

    // Status changes carry from → to categories and the raw status names.
    t.m.github.update(2, { state: "closed", state_reason: "completed" });
    t.m.linear.update("ENG-2", { stateName: "In Review", stateType: "started" });
    t.m.jira.update("PROJ-2", {
      statusName: "Selected for Development",
      categoryKey: "indeterminate",
    });
    await t.cycle();
    const changed = t.issueEvents().filter((e) => e.event_type === "issues.status_changed");
    const by = Object.fromEntries(changed.map((e) => [e.payload.tracker as string, e]));
    expect(by.github).toMatchObject({
      severity: "success",
      payload: { from: "open", to: "done", from_status: "open", to_status: "closed" },
    });
    expect(by.linear).toMatchObject({
      severity: "info",
      payload: { from: "open", to: "in_progress", from_status: "Todo", to_status: "In Review" },
    });
    expect(by.jira).toMatchObject({
      payload: { from: "open", to: "in_progress", to_status: "Selected for Development" },
    });
    // Done on GitHub also lights Fawkes up, briefly, for exactly that issue.
    expect(t.h.state.snapshot()).toMatchObject({
      state: "SUCCESS",
      explanation: "Done: acme/widgets#2",
    });

    // Unassignment, including from trackers whose "assigned to me" filter no longer matches it.
    t.m.linear.update("ENG-1", { assignee: "someone-else" });
    t.m.jira.update("PROJ-1", { assignee: "acct-other" });
    t.m.github.update(1, { assignees: [{ login: "other" }] });
    await t.cycle();
    const gone = t.issueEvents().filter((e) => e.event_type === "issues.unassigned");
    expect(gone.map((e) => e.payload.key).sort()).toEqual(["ENG-1", "PROJ-1", "acme/widgets#1"]);
    // Ephemeral completion events never reach the stored activity feed.
    expect(
      t.h.db
        .prepare("SELECT COUNT(*) AS n FROM events WHERE event_type = 'issues.completed'")
        .get(),
    ).toMatchObject({ n: 0 });
  });

  it("filters pull requests out of GitHub's issue list", async () => {
    const t = await start({ trackers: ["github"] });
    t.m.github.add({ number: 5, title: "A PR", assignees: me, pull_request: { url: "x" } });
    t.m.github.add({ number: 6, title: "A real issue", assignees: me });
    await t.cycle();
    expect(t.issueEvents().map((e) => e.payload.key)).toEqual(["acme/widgets#6"]);
  });

  it("an empty baseline still works: the tracker's own clock seeds the cursor", async () => {
    const t = await start({ trackers: ["linear"] });
    t.m.linear.add({ identifier: "ENG-9", assignee: LINEAR_VIEWER });
    await t.cycle();
    expect(t.types()).toEqual(["issues.assigned"]);
  });

  it("an issue assigned to me that was already closed when first seen is not announced", async () => {
    const t = await start({ trackers: ["github"] });
    t.m.github.add({ number: 8, assignees: me, state: "closed", state_reason: "completed" });
    await t.cycle();
    expect(t.types()).toEqual([]);
  });

  it("sends a Linear query for my issues only, with a tracked-id filter after the baseline", async () => {
    const t = await start({
      trackers: ["linear"],
      preload: (m) => m.linear.add({ identifier: "ENG-1", assignee: LINEAR_VIEWER }),
    });
    await t.cycle();
    const [first, second] = t.m.bodies.map(
      (b) => JSON.parse(b) as { query: string; variables: Record<string, unknown> },
    );
    expect(first?.query).toContain("viewer");
    expect(JSON.stringify(first?.variables.filter)).toContain('"isMe"');
    expect(JSON.stringify(second?.variables.filter)).toContain("id-ENG-1");
  });
});

describe("failure isolation", () => {
  const modes: [Mode, RegExp][] = [
    ["unauthorized", /rejected the credentials/],
    ["error", /responded 500/],
    ["garbage", /not JSON/],
    ["redirect", /unreachable/],
  ];
  it.each(modes)(
    "a GitHub %s degrades only GitHub; Linear and Jira keep reporting",
    async (mode, message) => {
      const t = await start();
      t.m.setMode("gh", mode);
      t.m.linear.add({ identifier: "ENG-3", assignee: LINEAR_VIEWER });
      t.m.jira.add({ key: "PROJ-3", assignee: JIRA_ACCOUNT });
      await t.cycle();
      expect(
        t
          .issueEvents()
          .map((e) => e.payload.key)
          .sort(),
      ).toEqual(["ENG-3", "PROJ-3"]);
      const health = await t.health();
      expect(health.status).toBe("degraded");
      expect(health.message).toMatch(new RegExp(`github: .*${message.source}`));
      expect(health.message).toMatch(/linear: 1 open assigned/);
      expect(health.message).toMatch(/jira: 1 open assigned/);
      expect(t.h.manager.get("issues").status).toBe("enabled");
      expect(t.m.landings()).toBe(0); // a redirect (which could carry credentials) is never followed

      // And it recovers by itself.
      t.m.setMode("gh", "ok");
      t.m.github.add({ number: 20, assignees: me });
      await t.cycle();
      expect(t.types().filter((x) => x === "issues.assigned")).toHaveLength(3);
      expect((await t.health()).status).toBe("healthy");
    },
  );

  it("a Linear outage and a Jira outage do not stop GitHub either", async () => {
    const t = await start();
    t.m.setMode("linear", "error");
    t.m.setMode("jira", "unauthorized");
    t.m.github.add({ number: 30, assignees: me });
    await t.cycle();
    expect(t.issueEvents().map((e) => e.payload.key)).toEqual(["acme/widgets#30"]);
    expect((await t.health()).message).toMatch(/linear: .*500.*jira: .*rejected/);
  });

  it("every tracker failing makes the capability unhealthy, still enabled and answering", async () => {
    const t = await start();
    for (const area of ["gh", "linear", "jira"] as const) t.m.setMode(area, "error");
    await t.cycle();
    expect((await t.health()).status).toBe("unhealthy");
    expect(t.h.manager.get("issues").status).toBe("enabled");
    const op = await t.h.run("issues", "list");
    expect(op.status).toBe("succeeded");
    expect(JSON.stringify(op.result)).toMatch(/500/);
  });

  it("a reply that is too large is refused, not buffered", async () => {
    const t = await start({ trackers: ["github"], options: { limits: { maxBytes: 64 * 1024 } } });
    t.m.setMode("gh", "huge");
    await t.cycle();
    expect((await t.health()).message).toMatch(/too large/);
    expect(t.types()).toEqual([]);
  });

  it("a tracker that never answers times out and is reported", async () => {
    const t = await start({ trackers: ["github"], options: { limits: { timeoutMs: 80 } } });
    t.m.setMode("gh", "hang");
    await t.cycle();
    expect((await t.health()).message).toMatch(/did not answer in time/);
  });

  it("a missing credential degrades that tracker with a clear message while others work", async () => {
    const t = await start({
      secrets: { github_token: MOCK_GITHUB_TOKEN, linear_api_key: MOCK_LINEAR_KEY },
    });
    t.m.linear.add({ identifier: "ENG-4", assignee: LINEAR_VIEWER });
    await t.cycle();
    expect(t.types()).toEqual(["issues.assigned"]);
    const health = await t.health();
    expect(health).toMatchObject({ status: "degraded" });
    expect(health.message).toMatch(/jira: Set the Jira email and API token/);
    expect(t.m.requests.jira).toBe(0);

    const none = await start({ secrets: {} });
    expect((await none.health()).message).toMatch(/Set the Linear API key/);
  });

  it("with no trackers configured nothing polls and health says why", async () => {
    mock = await startMockTrackers();
    h = createHarness({ modules: [createIssuesCapability()] });
    await h.enable("issues");
    expect((await h.manager.checkHealth("issues")).health).toMatchObject({
      status: "degraded",
      message: "No trackers are configured",
    });
    expect(mock.requests).toEqual({ gh: 0, linear: 0, jira: 0 });
  });

  it("rejects a malformed trackers config before it is stored", async () => {
    h = createHarness({ modules: [createIssuesCapability()] });
    for (const trackers of [
      [{ kind: "trello" }],
      [{ kind: "github" }],
      [{ kind: "github", repositories: ["../../etc"] }],
      [{ kind: "jira" }],
      [{ kind: "linear", token: "ghp_" + "a".repeat(30) }],
    ]) {
      expect(() => h!.manager.configure("issues", { trackers })).toThrow();
    }
  });

  it("refuses a non-https Jira site that is not loopback, without sending credentials", async () => {
    h = createHarness({ modules: [createIssuesCapability({ wait: createStepper().wait })] });
    h.manager.configure("issues", {
      trackers: [{ kind: "jira", site: "http://jira.example.test" }],
    });
    await h.manager.setSecret("issues", "jira_email", MOCK_JIRA_EMAIL);
    await h.manager.setSecret("issues", "jira_api_token", MOCK_JIRA_TOKEN);
    await h.enable("issues");
    await vi.waitFor(async () =>
      expect((await h!.manager.checkHealth("issues")).health.message).toMatch(/must use https/),
    );
  });
});

describe("secrets stay secret", () => {
  it("no event, health message, config view or command result contains a credential", async () => {
    const t = await start();
    t.m.github.add({ number: 40, title: `Rotate ${MOCK_GITHUB_TOKEN} now`, assignees: me });
    t.m.setMode("linear", "error");
    t.m.setMode("jira", "unauthorized");
    await t.cycle();
    const op = await t.h.run("issues", "list");
    const everything = JSON.stringify([
      t.h.events,
      t.h.manager.get("issues"),
      await t.health(),
      op.result,
    ]);
    const basic = Buffer.from(`${MOCK_JIRA_EMAIL}:${MOCK_JIRA_TOKEN}`).toString("base64");
    for (const secret of [MOCK_GITHUB_TOKEN, MOCK_LINEAR_KEY, MOCK_JIRA_TOKEN, basic]) {
      expect(everything).not.toContain(secret);
    }
    // The token that appeared in an issue title was redacted before it was emitted.
    expect(t.issueEvents().find((e) => e.payload.key === "acme/widgets#40")?.payload.title).toBe(
      "Rotate [REDACTED] now",
    );
    // The credentials went only in the Authorization headers.
    expect(t.m.seenAuth).toContain(`Bearer ${MOCK_GITHUB_TOKEN}`);
    expect(t.m.seenAuth).toContain(MOCK_LINEAR_KEY);
  });

  it("secrets are refused in config", async () => {
    h = createHarness({ modules: [createIssuesCapability()] });
    expect(() =>
      h!.manager.configure("issues", { github_token: "ghp_" + "a".repeat(30) }),
    ).toThrow();
  });

  it("GitHub works without a token for public repos when github_login says who I am", async () => {
    const t = await start({
      trackers: ["github"],
      secrets: {},
      githubLogin: "me-dev",
      preload: (m) => m.allowAnonymousGithub(),
    });
    t.m.github.add({ number: 50, assignees: me });
    await t.cycle();
    expect(t.types()).toEqual(["issues.assigned"]);
    expect(t.m.seenAuth.every((a) => a === "")).toBe(true);
    expect((await t.health()).message).toMatch(/no token: 60 requests\/hour/);
  });

  it("GitHub without a token and without github_login explains what to set", async () => {
    const t = await start({
      trackers: ["github"],
      secrets: {},
      preload: (m) => m.allowAnonymousGithub(),
    });
    const health = await t.health();
    expect(health.message).toMatch(/Set a GitHub token .* or github_login/);
    expect(t.m.requests.gh).toBe(0);
  });

  it("asks GitHub who the token belongs to (GET /user) and matches that login", async () => {
    const t = await start({ trackers: ["github"] });
    expect(MOCK_LOGIN).toBe("Me-Dev");
    t.m.github.add({ number: 51, assignees: [{ login: "ME-DEV" }] });
    await t.cycle();
    expect(t.types()).toEqual(["issues.assigned"]);
  });
});

describe("limits", () => {
  it("honours GitHub's rate limit: stops calling until the reset, then resumes", async () => {
    let clock = 1_000_000;
    const t = await start({ trackers: ["github"], options: { now: () => clock } });
    t.m.setMode("gh", "ratelimit");
    await t.cycle();
    const afterLimit = t.m.requests.gh;
    expect((await t.health()).message).toMatch(/rate limit/);
    await t.cycle();
    await t.cycle();
    expect(t.m.requests.gh).toBe(afterLimit); // backed off: no hammering

    t.m.setMode("gh", "ok");
    t.m.github.add({ number: 60, assignees: me });
    clock += 119_000;
    await t.cycle();
    expect(t.m.requests.gh).toBe(afterLimit); // GitHub said 120 s
    clock += 2_000;
    await t.cycle();
    expect(t.m.requests.gh).toBeGreaterThan(afterLimit);
    expect(t.types()).toEqual(["issues.assigned"]);
    expect((await t.health()).status).toBe("healthy");
  });

  it("reads at most maxPages pages per poll and says so in health", async () => {
    const t = await start({
      trackers: ["github"],
      options: { maxPages: 2 },
      preload(m) {
        m.setPageSize(2);
        for (let n = 1; n <= 9; n++) m.github.add({ number: n, assignees: me });
      },
    });
    // /user + exactly 2 pages, although 5 exist.
    expect(t.m.requests.gh).toBe(3);
    expect((await t.health()).message).toMatch(/more than 2 pages/);
  });

  it("never follows a pagination link to another host", async () => {
    const t = await start({ trackers: ["github"] });
    t.m.setMode("gh", "evil-link");
    t.m.github.add({ number: 70, assignees: me });
    const before = t.m.requests.gh;
    await t.cycle();
    expect(t.m.requests.gh - before).toBe(1);
    expect(t.types()).toEqual(["issues.assigned"]);
    expect((await t.health()).status).toBe("healthy");
  });

  it("a malformed issue in an otherwise valid page is skipped and counted, not fatal", async () => {
    const t = await start({ trackers: ["github"] });
    t.m.github.add({ number: 80, assignees: me, title: "" });
    t.m.github.add({ number: 81, assignees: me });
    await t.cycle();
    expect(t.issueEvents().map((e) => e.payload.key)).toEqual(["acme/widgets#81"]);
    expect((await t.health()).message).toMatch(/1 malformed issue\(s\) ignored/);
  });

  it("stops polling once disabled", async () => {
    const t = await start({ trackers: ["github"] });
    await t.h.manager.disable("issues");
    const before = t.m.requests.gh;
    t.m.github.add({ number: 90, assignees: me });
    // Disabling aborts the pause between cycles; the loop must exit instead of polling again.
    await t.h.drain();
    expect(t.m.requests.gh).toBe(before);
    expect(t.types()).toEqual([]);
  });
});

describe("list command", () => {
  it("lists my open issues per tracker with url and normalised status, and no bodies", async () => {
    const t = await start({
      preload(m) {
        m.github.add({ number: 1, title: "GH open", assignees: me });
        m.github.add({
          number: 2,
          title: "GH closed",
          assignees: me,
          state: "closed",
          state_reason: "completed",
        });
        m.github.add({ number: 3, title: "Not mine", assignees: [{ login: "other" }] });
        m.linear.add({
          identifier: "ENG-1",
          assignee: LINEAR_VIEWER,
          stateName: "In Progress",
          stateType: "started",
        });
        m.jira.add({ key: "PROJ-1", assignee: JIRA_ACCOUNT });
      },
    });
    const op = await t.h.run("issues", "list");
    expect(op.status).toBe("succeeded");
    expect(op.result).toEqual([
      {
        tracker: "github",
        issues: [
          {
            key: "acme/widgets#1",
            title: "GH open",
            url: "https://github.com/acme/widgets/issues/1",
            status: "open",
            category: "open",
          },
        ],
      },
      {
        tracker: "linear",
        issues: [
          {
            key: "ENG-1",
            title: "Issue ENG-1",
            url: "https://linear.app/acme/issue/ENG-1",
            status: "In Progress",
            category: "in_progress",
          },
        ],
      },
      {
        tracker: "jira",
        issues: [
          {
            key: "PROJ-1",
            title: "Issue PROJ-1",
            url: `${t.m.url}/jira/browse/PROJ-1`,
            status: "To Do",
            category: "open",
          },
        ],
      },
    ]);
    const filtered = await t.h.run("issues", "list", { tracker: "linear" });
    expect((filtered.result as unknown[]).length).toBe(1);
    await expect(t.h.run("issues", "list", { tracker: "trello" })).rejects.toThrow(
      /Invalid command input/,
    );
  });

  it("one failing tracker shows its error, the others still list", async () => {
    const t = await start({
      preload: (m) => m.linear.add({ identifier: "ENG-1", assignee: LINEAR_VIEWER }),
    });
    t.m.setMode("gh", "unauthorized");
    const op = await t.h.run("issues", "list");
    expect(op.result).toMatchObject([
      { tracker: "github", issues: [], error: expect.stringMatching(/rejected/) },
      { tracker: "linear", issues: [{ key: "ENG-1" }] },
      { tracker: "jira", issues: [] },
    ]);
  });

  it("is a read: it asks for no confirmation and declares network only", async () => {
    const t = await start({ trackers: ["linear"] });
    const view = t.h.manager.get("issues");
    expect(view.permissions.map((p) => p.permission)).toEqual(["network"]);
    expect(view.commands.map((c) => [c.name, c.side_effect])).toEqual([["list", "read"]]);
  });
});
