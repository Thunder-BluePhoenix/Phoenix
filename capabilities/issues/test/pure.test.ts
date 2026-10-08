// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  baseline,
  correlationId,
  diffIssue,
  githubRateLimitWait,
  jiraJql,
  jqlDate,
  linearFilter,
  MAX_SNAPSHOTS,
  nextLink,
  normaliseGithubStatus,
  normaliseJiraStatus,
  normaliseLinearStatus,
  parseGithubIssue,
  parseJiraIssue,
  parseJiraPage,
  parseLinearIssue,
  parseLinearPage,
  parseTrackers,
  reconcile,
  sanitiseText,
  snapshotOf,
  toIso,
  TrackerError,
  type IssueSnapshot,
  type RawIssueChange,
} from "../src";

const fixture = (name: string): unknown[] =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")) as unknown[];

const change = (patch: Partial<RawIssueChange> = {}): RawIssueChange => ({
  tracker: "github",
  key: "acme/widgets#1",
  title: "Fix it",
  url: "https://github.com/acme/widgets/issues/1",
  status: "open",
  category: "open",
  assignedToMe: true,
  updatedAt: "2026-10-09T09:00:01.000Z",
  ref: "acme/widgets#1",
  ...patch,
});

describe("status normalisation", () => {
  it("maps GitHub state and reason", () => {
    expect(normaliseGithubStatus("open", undefined)).toEqual({ status: "open", category: "open" });
    expect(normaliseGithubStatus("closed", "completed").category).toBe("done");
    expect(normaliseGithubStatus("closed", undefined).category).toBe("done");
    expect(normaliseGithubStatus("closed", "not_planned")).toEqual({
      status: "closed (not planned)",
      category: "cancelled",
    });
    expect(normaliseGithubStatus("closed", "duplicate").category).toBe("cancelled");
  });

  it("maps Linear state types, treating unknown ones as open", () => {
    expect(normaliseLinearStatus("started")).toBe("in_progress");
    expect(normaliseLinearStatus("completed")).toBe("done");
    expect(normaliseLinearStatus("canceled")).toBe("cancelled");
    expect(normaliseLinearStatus("backlog")).toBe("open");
    expect(normaliseLinearStatus("triage")).toBe("open");
    expect(normaliseLinearStatus(undefined)).toBe("open");
  });

  it("maps Jira status categories; a done issue resolved as Won't Do is cancelled", () => {
    expect(normaliseJiraStatus("new", undefined)).toBe("open");
    expect(normaliseJiraStatus("indeterminate", undefined)).toBe("in_progress");
    expect(normaliseJiraStatus("done", "Done")).toBe("done");
    expect(normaliseJiraStatus("done", undefined)).toBe("done");
    expect(normaliseJiraStatus("done", "Won't Do")).toBe("cancelled");
    expect(normaliseJiraStatus("done", "Duplicate")).toBe("cancelled");
    expect(normaliseJiraStatus("surprise", undefined)).toBe("open");
  });
});

describe("sanitiseText / toIso", () => {
  it("redacts credentials, strips control characters, truncates at 200 with an ellipsis", () => {
    const t = sanitiseText(`Rotate ghp_${"a".repeat(30)}\u0000\n\tnow`, 200);
    expect(t).toBe("Rotate [REDACTED] now");
    const long = sanitiseText("x".repeat(5000), 200)!;
    expect(long).toHaveLength(200);
    expect(long.endsWith("…")).toBe(true);
  });

  it("rejects non-strings and blank strings", () => {
    for (const v of [undefined, null, 5, {}, [], "", "   \n"])
      expect(sanitiseText(v, 200)).toBeUndefined();
  });

  it("parses Jira offsets and rejects junk and absurd years", () => {
    expect(toIso("2026-10-09T09:00:01.000+0000")).toBe("2026-10-09T09:00:01.000Z");
    expect(toIso("2026-10-09T10:30:01.000+0130")).toBe("2026-10-09T09:00:01.000Z");
    expect(toIso("Thu, 08 Oct 2026 19:27:11 GMT")).toBe("2026-10-08T19:27:11.000Z");
    for (const v of ["yesterday", "", 12, null, "9999-01-01T00:00:00Z", "1970-01-01T00:00:00Z"]) {
      expect(toIso(v)).toBeUndefined();
    }
  });
});

describe("diffIssue", () => {
  it("emits assigned for a new open issue assigned to me, with the shared payload", () => {
    const [e, ...rest] = diffIssue(undefined, change());
    expect(rest).toEqual([]);
    expect(e).toMatchObject({
      event_type: "issues.assigned",
      severity: "info",
      ephemeral: false,
      correlation_id: "issues-github-acme/widgets#1",
      subject: "acme/widgets#1",
      payload: {
        tracker: "github",
        key: "acme/widgets#1",
        title: "Fix it",
        url: "https://github.com/acme/widgets/issues/1",
        status: "open",
        category: "open",
      },
    });
  });

  it("ignores issues never assigned to me and closed issues I did not know about", () => {
    expect(diffIssue(undefined, change({ assignedToMe: false }))).toEqual([]);
    expect(diffIssue(undefined, change({ status: "closed", category: "done" }))).toEqual([]);
  });

  it("emits status_changed with from/to categories and raw status names", () => {
    const prev = snapshotOf(change({ status: "Todo", category: "open" }));
    const [e] = diffIssue(
      prev,
      change({
        status: "In Review",
        category: "in_progress",
        updatedAt: "2026-10-09T09:00:05.000Z",
      }),
    );
    expect(e).toMatchObject({
      event_type: "issues.status_changed",
      severity: "info",
      ephemeral: false,
      payload: { from: "open", to: "in_progress", from_status: "Todo", to_status: "In Review" },
    });
  });

  it("reports a rename within one category (Todo → Backlog) because the status name changed", () => {
    const prev = snapshotOf(change({ status: "Todo", category: "open" }));
    const [e] = diffIssue(
      prev,
      change({ status: "Backlog", updatedAt: "2026-10-09T09:00:05.000Z" }),
    );
    expect(e?.payload).toMatchObject({ from: "open", to: "open", to_status: "Backlog" });
  });

  it("done adds a success status_changed plus an ephemeral completed event for Fawkes", () => {
    const prev = snapshotOf(change());
    const events = diffIssue(
      prev,
      change({ status: "closed", category: "done", updatedAt: "2026-10-09T09:00:05.000Z" }),
    );
    expect(events.map((e) => [e.event_type, e.severity, e.ephemeral])).toEqual([
      ["issues.status_changed", "success", false],
      ["issues.completed", "success", true],
    ]);
    expect(events[1]?.correlation_id).toBe(events[0]?.correlation_id);
  });

  it("cancelled is a status change without the completed celebration", () => {
    const events = diffIssue(
      snapshotOf(change()),
      change({
        status: "closed (not planned)",
        category: "cancelled",
        updatedAt: "2026-10-09T09:00:05.000Z",
      }),
    );
    expect(events.map((e) => e.event_type)).toEqual(["issues.status_changed"]);
  });

  it("emits unassigned when someone else now holds an issue I held, even if its status changed too", () => {
    const events = diffIssue(
      snapshotOf(change()),
      change({
        assignedToMe: false,
        status: "closed",
        category: "done",
        updatedAt: "2026-10-09T09:00:05.000Z",
      }),
    );
    expect(events.map((e) => e.event_type)).toEqual(["issues.unassigned"]);
  });

  it("de-duplicates by updatedAt: the same or an older report yields nothing", () => {
    const prev: IssueSnapshot = snapshotOf(change({ status: "Todo" }));
    expect(diffIssue(prev, change({ status: "Done", category: "done" }))).toEqual([]);
    expect(
      diffIssue(
        prev,
        change({ status: "Done", category: "done", updatedAt: "2026-10-09T08:00:00.000Z" }),
      ),
    ).toEqual([]);
  });

  it("a comment-only update (same status, newer timestamp) is silent", () => {
    expect(
      diffIssue(snapshotOf(change()), change({ updatedAt: "2026-10-09T09:00:09.000Z" })),
    ).toEqual([]);
  });

  it("correlation ids stay within the 200-character event limit", () => {
    const id = correlationId({ tracker: "github", key: "o/" + "r".repeat(400) + "#1" });
    expect(id.length).toBe(200);
  });
});

describe("reconcile / baseline", () => {
  it("baseline remembers only my issues and emits nothing", () => {
    const snaps = new Map<string, IssueSnapshot>();
    baseline(snaps, [change(), change({ key: "x#2", ref: "x#2", assignedToMe: false })]);
    expect([...snaps.keys()]).toEqual(["acme/widgets#1"]);
  });

  it("applies a batch in updatedAt order regardless of arrival order", () => {
    const snaps = new Map<string, IssueSnapshot>();
    baseline(snaps, [change()]);
    const t1 = change({
      status: "In Progress",
      category: "in_progress",
      updatedAt: "2026-10-09T09:00:05.000Z",
    });
    const t2 = change({
      status: "closed",
      category: "done",
      updatedAt: "2026-10-09T09:00:09.000Z",
    });
    const events = reconcile(snaps, [t2, t1]);
    expect(
      events.filter((e) => e.event_type === "issues.status_changed").map((e) => e.payload.to),
    ).toEqual(["in_progress", "done"]);
    // replaying the same batch (overlapping polls) emits nothing
    expect(reconcile(snaps, [t2, t1])).toEqual([]);
  });

  it("forgets an issue once it is unassigned, so reassignment is announced again", () => {
    const snaps = new Map<string, IssueSnapshot>();
    baseline(snaps, [change()]);
    reconcile(snaps, [change({ assignedToMe: false, updatedAt: "2026-10-09T09:00:05.000Z" })]);
    expect(snaps.size).toBe(0);
    const events = reconcile(snaps, [change({ updatedAt: "2026-10-09T09:00:09.000Z" })]);
    expect(events.map((e) => e.event_type)).toEqual(["issues.assigned"]);
  });

  it("bounds memory: finished issues are dropped first when the snapshot limit is exceeded", () => {
    const snaps = new Map<string, IssueSnapshot>();
    const many: RawIssueChange[] = [];
    for (let i = 0; i < MAX_SNAPSHOTS + 10; i++) {
      many.push(
        change({
          key: `a/b#${i}`,
          ref: `a/b#${i}`,
          updatedAt: `2026-10-09T09:00:00.${String(i % 1000).padStart(3, "0")}Z`,
        }),
      );
    }
    reconcile(snaps, many);
    expect(snaps.size).toBeLessThanOrEqual(MAX_SNAPSHOTS);
  });
});

describe("GitHub parsing (real responses)", () => {
  it("drops pull requests that share the issues endpoint (real microsoft/vscode page)", () => {
    const raw = fixture("github-vscode-open.json");
    const prs = raw.filter((i) => (i as { pull_request?: unknown }).pull_request);
    expect(prs.length).toBeGreaterThan(0);
    const parsed = raw.map((i) => parseGithubIssue(i, "microsoft/vscode", "nobody"));
    expect(parsed.filter(Boolean)).toHaveLength(raw.length - prs.length);
  });

  it("matches my login case-insensitively and exposes every field the events need", () => {
    const raw = fixture("github-vscode-open.json");
    const withAssignee = raw.find((i) => {
      const a = i as { assignees: unknown[]; pull_request?: unknown };
      return !a.pull_request && a.assignees.length > 0;
    }) as { assignees: { login: string }[]; number: number; title: string; html_url: string };
    const login = withAssignee.assignees[0]!.login.toUpperCase();
    const c = parseGithubIssue(withAssignee, "microsoft/vscode", login)!;
    expect(c).toMatchObject({
      tracker: "github",
      key: `microsoft/vscode#${withAssignee.number}`,
      url: withAssignee.html_url,
      status: "open",
      category: "open",
      assignedToMe: true,
    });
    expect(c.title.length).toBeLessThanOrEqual(200);
    expect(c.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    expect(parseGithubIssue(withAssignee, "microsoft/vscode", "someone-else")!.assignedToMe).toBe(
      false,
    );
  });

  it("normalises real closed reasons (completed / duplicate / not_planned)", () => {
    const parsed = fixture("github-vscode-closed.json").map((i) =>
      parseGithubIssue(i, "microsoft/vscode", "x")!,
    );
    expect(parsed.map((p) => p.category).sort()).toEqual(["cancelled", "cancelled", "done"]);
    expect(parsed.every((p) => p.status.startsWith("closed"))).toBe(true);
  });

  it("the Phoenix repo's only item is a pull request and is filtered", () => {
    const raw = fixture("github-phoenix.json");
    expect(raw.length).toBeGreaterThan(0);
    expect(
      raw.every((i) => parseGithubIssue(i, "Thunder-BluePhoenix/Phoenix", "x") === undefined),
    ).toBe(true);
  });

  it("rejects hostile shapes instead of emitting them", () => {
    const ok = fixture("github-vscode-open.json").find(
      (i) => !(i as { pull_request?: unknown }).pull_request,
    )!;
    const hostile: unknown[] = [
      null,
      "string",
      [],
      {},
      { ...(ok as object), number: "12" },
      { ...(ok as object), number: -1 },
      { ...(ok as object), title: 5 },
      { ...(ok as object), title: "   " },
      { ...(ok as object), html_url: "javascript:alert(1)" },
      { ...(ok as object), html_url: "https://user:pw@evil.test/x" },
      { ...(ok as object), updated_at: "never" },
      { ...(ok as object), state: "weird" },
    ];
    for (const h of hostile) expect(parseGithubIssue(h, "o/r", "me")).toBeUndefined();
  });

  it("tolerates missing or mistyped assignees and truncates huge titles", () => {
    const ok = fixture("github-vscode-open.json").find(
      (i) => !(i as { pull_request?: unknown }).pull_request,
    )!;
    const c = parseGithubIssue(
      { ...(ok as object), assignees: "me", title: "t".repeat(100_000) },
      "o/r",
      "me",
    )!;
    expect(c.assignedToMe).toBe(false);
    expect(c.title).toHaveLength(200);
    expect(
      parseGithubIssue({ ...(ok as object), assignees: [null, 3, { login: 7 }] }, "o/r", "me")!
        .assignedToMe,
    ).toBe(false);
  });

  it("follows only rel=next links and ignores malformed Link headers", () => {
    expect(nextLink('<https://a/x?page=2>; rel="next", <https://a/x?page=9>; rel="last"')).toBe(
      "https://a/x?page=2",
    );
    expect(nextLink('<https://a/x?page=1>; rel="prev"')).toBeUndefined();
    expect(nextLink(null)).toBeUndefined();
    expect(nextLink("garbage".repeat(1000))).toBeUndefined();
  });

  it("works out the rate-limit wait from GitHub's own clock, not ours", () => {
    const headers = new Headers({
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(Date.parse("2026-10-09T09:02:00Z") / 1000),
      date: "Fri, 09 Oct 2026 09:00:00 GMT",
    });
    expect(githubRateLimitWait(headers)).toBe(120_000);
    expect(githubRateLimitWait(new Headers({ "retry-after": "30" }))).toBe(30_000);
    expect(githubRateLimitWait(new Headers({ "x-ratelimit-remaining": "12" }))).toBeUndefined();
    expect(githubRateLimitWait(new Headers({ "retry-after": "99999999" }))).toBe(3_600_000);
  });
});

describe("Linear parsing (documented shape)", () => {
  const node = {
    id: "9f1c2d3e-0000-4000-8000-000000000001",
    identifier: "ENG-123",
    title: "Crash on login",
    url: "https://linear.app/acme/issue/ENG-123/crash-on-login",
    updatedAt: "2026-10-09T09:00:01.000Z",
    state: { name: "In Progress", type: "started" },
    assignee: { id: "viewer-1" },
  };

  it("parses an issue and decides 'mine' by the viewer id", () => {
    expect(parseLinearIssue(node, "viewer-1")).toMatchObject({
      tracker: "linear",
      key: "ENG-123",
      status: "In Progress",
      category: "in_progress",
      assignedToMe: true,
      ref: node.id,
    });
    expect(parseLinearIssue({ ...node, assignee: null }, "viewer-1")!.assignedToMe).toBe(false);
    expect(parseLinearIssue({ ...node, assignee: { id: "other" } }, "viewer-1")!.assignedToMe).toBe(
      false,
    );
  });

  it("rejects hostile nodes", () => {
    const bad: unknown[] = [
      null,
      { ...node, identifier: "not a key" },
      { ...node, identifier: 5 },
      { ...node, id: "x".repeat(200) },
      { ...node, state: null },
      { ...node, state: { name: 3, type: "started" } },
      { ...node, url: "file:///etc/passwd" },
      { ...node, updatedAt: "soon" },
    ];
    for (const b of bad) expect(parseLinearIssue(b, "viewer-1")).toBeUndefined();
  });

  it("a page with a wrong overall shape is an invalid_response error; bad nodes are skipped and counted", () => {
    for (const body of [
      null,
      {},
      { data: {} },
      { data: { viewer: { id: 1 }, issues: {} } },
      { data: { viewer: { id: "v" }, issues: { nodes: "x" } } },
    ]) {
      expect(() => parseLinearPage(body)).toThrow(TrackerError);
    }
    const page = parseLinearPage({
      data: {
        viewer: { id: "viewer-1" },
        issues: {
          nodes: [node, { junk: true }],
          pageInfo: { hasNextPage: true, endCursor: "abc" },
        },
      },
    });
    expect(page).toMatchObject({ skipped: 1, hasNext: true, endCursor: "abc" });
    expect(page.changes).toHaveLength(1);
  });

  it("builds the filter: baseline = my unfinished issues; later = mine or tracked, updated since", () => {
    expect(linearFilter(undefined, ["ignored"])).toEqual({
      assignee: { isMe: { eq: true } },
      state: { type: { nin: ["completed", "canceled"] } },
    });
    expect(linearFilter("2026-10-09T09:00:00.000Z", ["abc-1", "bad id!", "def-2"])).toEqual({
      updatedAt: { gte: "2026-10-09T09:00:00.000Z" },
      or: [{ assignee: { isMe: { eq: true } } }, { id: { in: ["abc-1", "def-2"] } }],
    });
  });
});

describe("Jira parsing (documented shape)", () => {
  const site = "https://acme.atlassian.net";
  const node = {
    key: "PROJ-45",
    fields: {
      summary: "Add export",
      updated: "2026-10-09T09:00:01.000+0000",
      status: { name: "In Review", statusCategory: { key: "indeterminate" } },
      resolution: null,
      assignee: { accountId: "acct-me" },
    },
  };

  it("parses an issue, builds the browse URL itself and decides 'mine' by account id", () => {
    expect(parseJiraIssue(node, site, "acct-me")).toMatchObject({
      tracker: "jira",
      key: "PROJ-45",
      url: "https://acme.atlassian.net/browse/PROJ-45",
      status: "In Review",
      category: "in_progress",
      assignedToMe: true,
      updatedAt: "2026-10-09T09:00:01.000Z",
    });
    expect(parseJiraIssue(node, site, "someone")!.assignedToMe).toBe(false);
  });

  it("rejects hostile nodes", () => {
    const f = node.fields;
    const bad: unknown[] = [
      null,
      { key: "proj-1", fields: f },
      { key: "PROJ-1; DROP", fields: f },
      { key: "PROJ-1" },
      { key: "PROJ-1", fields: { ...f, summary: 4 } },
      { key: "PROJ-1", fields: { ...f, status: {} } },
      { key: "PROJ-1", fields: { ...f, updated: "x" } },
    ];
    for (const b of bad) expect(parseJiraIssue(b, site, "acct-me")).toBeUndefined();
  });

  it("pages: a missing/oversized nextPageToken or isLast ends paging; bad shape throws", () => {
    expect(parseJiraPage({ issues: [node], nextPageToken: "t1" }, site, "a").nextPageToken).toBe(
      "t1",
    );
    expect(
      parseJiraPage({ issues: [node], nextPageToken: "t1", isLast: true }, site, "a").nextPageToken,
    ).toBeUndefined();
    expect(
      parseJiraPage({ issues: [], nextPageToken: "x".repeat(900) }, site, "a").nextPageToken,
    ).toBeUndefined();
    expect(() => parseJiraPage({ issues: "no" }, site, "a")).toThrow(TrackerError);
    expect(() => parseJiraPage(null, site, "a")).toThrow(TrackerError);
  });

  it("builds JQL: baseline excludes done; later polls only interpolate valid issue keys", () => {
    expect(jiraJql(undefined, [])).toBe(
      "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
    );
    const jql = jiraJql("2026-10-09T09:00:00.000Z", ["PROJ-1", 'x") OR (1=1', "PROJ-2"]);
    expect(jql).toBe(
      `(assignee = currentUser() OR key in (PROJ-1,PROJ-2)) AND updated >= "${jqlDate("2026-10-09T09:00:00.000Z")}" ORDER BY updated ASC`,
    );
    expect(jql).not.toContain("1=1");
  });

  it("JQL dates are UTC minutes, shifted back a day-plus so any profile timezone is covered", () => {
    expect(jqlDate("2026-10-09T09:30:45.000Z")).toBe("2026/10/08 07:30");
  });
});

describe("tracker configuration", () => {
  it("accepts the documented shapes", () => {
    expect(
      parseTrackers({
        trackers: [
          { kind: "github", repositories: ["acme/widgets"], login: "me" },
          { kind: "linear" },
          { kind: "jira", site: "https://acme.atlassian.net" },
        ],
      }),
    ).toEqual({
      specs: [
        { kind: "github", repositories: ["acme/widgets"], login: "me" },
        { kind: "linear" },
        { kind: "jira", site: "https://acme.atlassian.net" },
      ],
      problems: [],
    });
  });

  it("degrades per entry: bad entries are reported, good ones still run", () => {
    const { specs, problems } = parseTrackers({
      trackers: [
        { kind: "github", repositories: ["no-slash"] },
        { kind: "jira" },
        { kind: "trello" },
        { kind: "linear" },
        { kind: "linear" },
        "junk",
      ],
    });
    expect(specs).toEqual([{ kind: "linear" }]);
    expect(problems).toHaveLength(5);
  });

  it("no trackers configured means nothing polls", () => {
    expect(parseTrackers({})).toEqual({ specs: [], problems: [] });
    expect(parseTrackers({ trackers: "github" }).specs).toEqual([]);
  });
});
