// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// One local HTTP server standing in for GitHub (/gh), Linear (/linear) and Jira (/jira). The
// GitHub routes follow the real API (checked against live responses); Linear and Jira follow
// the providers' documentation. Time is a mock clock: every change moves it forward one
// second and it is what the Date header and every `updated` field say, so tests never sleep.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const MOCK_GITHUB_TOKEN = "ghp_mockmockmockmockmockmockmockmock1234";
export const MOCK_LINEAR_KEY = "lin_api_mockmockmockmockmockmockmockmock";
export const MOCK_JIRA_EMAIL = "me@example.test";
export const MOCK_JIRA_TOKEN = "ATATTmockjiratoken0123456789";
export const MOCK_LOGIN = "Me-Dev";

export type Mode =
  | "ok"
  | "unauthorized"
  | "error"
  | "hang"
  | "huge"
  | "garbage"
  | "ratelimit"
  | "evil-link"
  | "redirect";

export interface MockClock {
  now(): string;
  tick(): string;
}

function createClock(): MockClock {
  let ms = Date.parse("2026-10-09T09:00:00.000Z");
  return {
    now: () => new Date(ms).toISOString(),
    tick: () => ((ms += 1000), new Date(ms).toISOString()),
  };
}

export interface GithubItem {
  number: number;
  title: string;
  state: "open" | "closed";
  state_reason: string | null;
  assignees: { login: string }[];
  updated_at: string;
  pull_request?: { url: string };
}

export interface LinearItem {
  id: string;
  identifier: string;
  title: string;
  stateName: string;
  stateType: string;
  assignee: string | null;
  updatedAt: string;
}

export interface JiraItem {
  key: string;
  summary: string;
  statusName: string;
  categoryKey: string;
  resolution: string | null;
  assignee: string | null;
  updated: string;
}

export const LINEAR_VIEWER = "viewer-1";
export const JIRA_ACCOUNT = "acct-me";

/** Jira's `updated` format: 2026-10-09T09:00:01.000+0000. */
const jiraTime = (iso: string) => iso.replace("Z", "+0000");

type Area = "gh" | "linear" | "jira";

interface LinearRequest {
  variables: {
    filter: {
      state?: unknown;
      updatedAt?: { gte: string };
      or?: ({ assignee: unknown } | { id: { in: string[] } })[];
    };
    first: number;
    after: string | null;
  };
}

/** Handle on the running mock server; tests add and change issues through it. */
export interface MockTrackers {
  url: string;
  clock: MockClock;
  requests: Record<Area, number>;
  /** Authorization headers received, in order (to prove which credentials were sent). */
  seenAuth: string[];
  /** Request bodies received (Linear queries). */
  bodies: string[];
  setMode(area: Area, mode: Mode): void;
  setPageSize(n: number): void;
  allowAnonymousGithub(): void;
  github: {
    add(i: Partial<GithubItem> & { number: number }): GithubItem;
    update(number: number, patch: Partial<GithubItem>): void;
  };
  linear: {
    add(i: Partial<LinearItem> & { identifier: string }): LinearItem;
    update(identifier: string, patch: Partial<LinearItem>): void;
  };
  jira: {
    add(i: Partial<JiraItem> & { key: string }): JiraItem;
    update(key: string, patch: Partial<JiraItem>): void;
  };
  /** Requests that reached the redirect target (should stay 0: redirects are never followed). */
  landings(): number;
  close(): Promise<void>;
}

export async function startMockTrackers(): Promise<MockTrackers> {
  const clock = createClock();
  const modes: Record<Area, Mode> = { gh: "ok", linear: "ok", jira: "ok" };
  const requests: Record<Area, number> = { gh: 0, linear: 0, jira: 0 };
  const seenAuth: string[] = [];
  const bodies: string[] = [];
  const github: GithubItem[] = [];
  const linear: LinearItem[] = [];
  const jira: JiraItem[] = [];
  let origin = "";
  let pageSize = 100;
  let githubTokenRequired = true;
  let landed = 0;

  const sockets = new Set<ServerResponse>();

  const send = (res: ServerResponse, status: number, body: unknown, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", date: clock.now(), ...headers });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  /** Applies a failure mode; returns true when the request has been answered (or parked). */
  function failure(res: ServerResponse, mode: Mode): boolean {
    switch (mode) {
      case "ok":
      case "evil-link":
        return false;
      case "redirect":
        send(res, 302, {}, { location: `${origin}/landing` });
        return true;
      case "unauthorized":
        send(res, 401, { message: "Bad credentials" });
        return true;
      case "error":
        send(res, 500, { message: "boom with a secret " + MOCK_GITHUB_TOKEN });
        return true;
      case "hang":
        sockets.add(res);
        return true;
      case "huge":
        res.writeHead(200, { "content-type": "application/json", date: clock.now() });
        res.write("[" + "0,".repeat(200_000));
        res.end("0]");
        return true;
      case "garbage":
        send(res, 200, "<html>maintenance</html>");
        return true;
      case "ratelimit":
        send(
          res,
          403,
          { message: "API rate limit exceeded" },
          {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(Math.floor(Date.parse(clock.now()) / 1000) + 120),
          },
        );
        return true;
    }
  }

  function githubRoute(req: IncomingMessage, res: ServerResponse, url: URL) {
    seenAuth.push(req.headers.authorization ?? "");
    const authed = req.headers.authorization === `Bearer ${MOCK_GITHUB_TOKEN}`;
    if (req.headers.authorization && !authed) return send(res, 401, { message: "Bad credentials" });
    if (url.pathname === "/gh/user") {
      if (!authed) return send(res, 401, { message: "Requires authentication" });
      return send(res, 200, { login: MOCK_LOGIN, id: 1 });
    }
    if (githubTokenRequired && !authed)
      return send(res, 401, { message: "Requires authentication" });
    const m = /^\/gh\/repos\/([^/]+)\/([^/]+)\/issues$/.exec(url.pathname);
    if (!m) return send(res, 404, { message: "Not Found" });
    if (m[1] !== "acme" || m[2] !== "widgets") return send(res, 404, { message: "Not Found" });
    const q = url.searchParams;
    let rows = github.filter((i) => {
      const state = q.get("state") ?? "open";
      if (state !== "all" && i.state !== state) return false;
      const assignee = q.get("assignee");
      if (assignee && !i.assignees.some((a) => a.login.toLowerCase() === assignee.toLowerCase()))
        return false;
      const since = q.get("since");
      return !since || i.updated_at >= since;
    });
    rows = rows.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    if (q.get("direction") === "desc") rows.reverse();
    const per = Math.min(Number(q.get("per_page") ?? 30), pageSize);
    const page = Number(q.get("page") ?? 1);
    const slice = rows.slice((page - 1) * per, page * per);
    const headers: Record<string, string> = {};
    if (modes.gh === "evil-link") {
      headers.link = '<http://127.0.0.1:9/steal?page=2>; rel="next"';
    } else if (page * per < rows.length) {
      const next = new URL(url);
      next.searchParams.set("page", String(page + 1));
      headers.link = `<${origin}${next.pathname}${next.search}>; rel="next"`;
    }
    send(res, 200, slice.map(githubJson), headers);
  }

  const githubJson = (i: GithubItem) => ({
    ...i,
    html_url: `https://github.com/acme/widgets/${i.pull_request ? "pull" : "issues"}/${i.number}`,
  });

  function linearRoute(req: IncomingMessage, res: ServerResponse, body: string) {
    seenAuth.push(req.headers.authorization ?? "");
    if (req.headers.authorization !== MOCK_LINEAR_KEY) {
      return send(res, 401, {
        errors: [
          { message: "Authentication required", extensions: { code: "AUTHENTICATION_ERROR" } },
        ],
      });
    }
    const request = JSON.parse(body) as LinearRequest; // body written by our own provider
    const { filter, first, after } = request.variables;
    let rows: LinearItem[];
    if (filter.updatedAt) {
      const ids = filter.or?.flatMap((o) => ("id" in o ? o.id.in : [])) ?? [];
      rows = linear.filter(
        (i) =>
          i.updatedAt >= filter.updatedAt!.gte &&
          (i.assignee === LINEAR_VIEWER || ids.includes(i.id)),
      );
    } else {
      rows = linear.filter(
        (i) => i.assignee === LINEAR_VIEWER && !["completed", "canceled"].includes(i.stateType),
      );
    }
    rows = rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const start = after ? Number(after) : 0;
    const per = Math.min(first, pageSize);
    const nodes = rows.slice(start, start + per).map((i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      url: `https://linear.app/acme/issue/${i.identifier}`,
      updatedAt: i.updatedAt,
      state: { name: i.stateName, type: i.stateType },
      assignee: i.assignee ? { id: i.assignee } : null,
    }));
    const hasNextPage = start + per < rows.length;
    send(res, 200, {
      data: {
        viewer: { id: LINEAR_VIEWER },
        issues: { nodes, pageInfo: { hasNextPage, endCursor: String(start + per) } },
      },
    });
  }

  function jiraRoute(req: IncomingMessage, res: ServerResponse, url: URL) {
    seenAuth.push(req.headers.authorization ?? "");
    const expected = `Basic ${Buffer.from(`${MOCK_JIRA_EMAIL}:${MOCK_JIRA_TOKEN}`).toString("base64")}`;
    if (req.headers.authorization !== expected) return send(res, 401, {});
    if (url.pathname === "/jira/rest/api/3/myself") {
      return send(res, 200, { accountId: JIRA_ACCOUNT, emailAddress: MOCK_JIRA_EMAIL });
    }
    if (url.pathname !== "/jira/rest/api/3/search/jql") return send(res, 404, {});
    const jql = url.searchParams.get("jql") ?? "";
    const dateMatch = /updated >= "(\d{4})\/(\d\d)\/(\d\d) (\d\d):(\d\d)"/.exec(jql);
    const keys = /key in \(([^)]*)\)/.exec(jql)?.[1]?.split(",") ?? [];
    let rows: JiraItem[];
    if (dateMatch) {
      const [, y, mo, d, h, mi] = dateMatch;
      const floor = `${y}-${mo}-${d}T${h}:${mi}:00.000Z`;
      rows = jira.filter(
        (i) => jiraIso(i.updated) >= floor && (i.assignee === JIRA_ACCOUNT || keys.includes(i.key)),
      );
    } else {
      rows = jira.filter((i) => i.assignee === JIRA_ACCOUNT && i.categoryKey !== "done");
    }
    rows = rows.sort((a, b) => a.updated.localeCompare(b.updated));
    const per = Math.min(Number(url.searchParams.get("maxResults") ?? 50), pageSize);
    const start = Number(url.searchParams.get("nextPageToken") ?? 0);
    const slice = rows.slice(start, start + per);
    const last = start + per >= rows.length;
    send(res, 200, {
      issues: slice.map((i) => ({
        key: i.key,
        fields: {
          summary: i.summary,
          updated: i.updated,
          status: { name: i.statusName, statusCategory: { key: i.categoryKey } },
          resolution: i.resolution ? { name: i.resolution } : null,
          assignee: i.assignee ? { accountId: i.assignee } : null,
        },
      })),
      ...(last ? { isLast: true } : { nextPageToken: String(start + per) }),
    });
  }

  const jiraIso = (t: string) => t.replace(/([+-]\d\d)(\d\d)$/, "$1:$2").replace("+00:00", "Z");

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const area = url.pathname.startsWith("/gh")
      ? "gh"
      : url.pathname.startsWith("/linear")
        ? "linear"
        : url.pathname.startsWith("/jira")
          ? "jira"
          : undefined;
    if (url.pathname === "/landing") landed++;
    if (!area) return send(res, 404, {});
    requests[area]++;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (body) bodies.push(body);
      if (failure(res, modes[area])) return;
      if (area === "gh") githubRoute(req, res, url);
      else if (area === "linear") linearRoute(req, res, body);
      else jiraRoute(req, res, url);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url: origin,
    clock,
    requests,
    /** Authorization headers received, in order (to prove which credentials were sent). */
    seenAuth,
    /** Request bodies received (Linear queries). */
    bodies,
    setMode(area: Area, mode: Mode) {
      modes[area] = mode;
    },
    setPageSize(n: number) {
      pageSize = n;
    },
    landings: () => landed,
    allowAnonymousGithub() {
      githubTokenRequired = false;
    },
    github: {
      add(i: Partial<GithubItem> & { number: number }): GithubItem {
        const item: GithubItem = {
          title: `Issue ${i.number}`,
          state: "open",
          state_reason: null,
          assignees: [],
          updated_at: clock.tick(),
          ...i,
        };
        github.push(item);
        return item;
      },
      update(number: number, patch: Partial<GithubItem>) {
        const item = github.find((i) => i.number === number)!;
        Object.assign(item, patch, { updated_at: clock.tick() });
      },
    },
    linear: {
      add(i: Partial<LinearItem> & { identifier: string }): LinearItem {
        const item: LinearItem = {
          id: `id-${i.identifier}`,
          title: `Issue ${i.identifier}`,
          stateName: "Todo",
          stateType: "unstarted",
          assignee: null,
          updatedAt: clock.tick(),
          ...i,
        };
        linear.push(item);
        return item;
      },
      update(identifier: string, patch: Partial<LinearItem>) {
        const item = linear.find((i) => i.identifier === identifier)!;
        Object.assign(item, patch, { updatedAt: clock.tick() });
      },
    },
    jira: {
      add(i: Partial<JiraItem> & { key: string }): JiraItem {
        const item: JiraItem = {
          summary: `Issue ${i.key}`,
          statusName: "To Do",
          categoryKey: "new",
          resolution: null,
          assignee: null,
          updated: jiraTime(clock.tick()),
          ...i,
        };
        jira.push(item);
        return item;
      },
      update(key: string, patch: Partial<JiraItem>) {
        const item = jira.find((i) => i.key === key)!;
        Object.assign(item, patch, { updated: jiraTime(clock.tick()) });
      },
    },
    async close() {
      for (const r of sockets) r.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
