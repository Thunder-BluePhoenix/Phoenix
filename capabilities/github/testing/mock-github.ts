// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for api.github.com with the routes, headers and ETag behaviour the capability
// uses. Tests set `data` (usually from the recorded fixtures) and read `requests` to see what
// was sent. Every request is recorded, including its Authorization header, so tests can prove
// when the token is and is not sent.
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const MOCK_TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
/** The only credential the mock accepts for creating issues (built at runtime: no token literal). */
export const MOCK_WRITE_TOKEN = ["gh", "p_", "WRITEWRITEWRITEWRITEWRITE0123456789"].join("");

export interface RecordedRequest {
  method: string;
  /** Path and query, e.g. /repos/octo/phoenix/pulls?state=all */
  path: string;
  authorization: string | undefined;
  ifNoneMatch: string | undefined;
  status: number;
}

/** An issue the mock stores when it accepts a POST (Phase 36). */
export interface MockIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  /** Hidden from GET /repos/{r}/issues (as if it had scrolled out of the newest page). */
  hiddenFromList?: boolean;
  /** Hidden from GET /search/issues (as if not indexed yet: eventual consistency). */
  hiddenFromSearch?: boolean;
  /** A pull request, which GitHub also lists under /issues. */
  pullRequest?: boolean;
}

/** What the mock does with POST /repos/{r}/issues after checking the credential. */
export type WriteMode =
  | "ok"
  | "redirect"
  | "http500"
  | "http422"
  | "malformed"
  | "huge"
  | "bad-link"
  /** Stores the issue, then drops the connection: the client cannot know the outcome. */
  | "store-then-drop";

export interface RecordedWrite {
  method: string;
  path: string;
  authorization: string | undefined;
  contentType: string | undefined;
  /** The parsed JSON body (undefined when it was not JSON). */
  body: unknown;
  status: number;
}

/** Marker placed in hostile response bodies; no error, event or audit row may contain it. */
export const MOCK_REMOTE_MARKER = "REMOTE-TEXT-MUST-NOT-LEAK";

export interface MockData {
  user: unknown;
  runs: unknown[];
  pulls: unknown[];
  deployments: unknown[];
  /** Newest first, by deployment id. */
  statuses: Record<number, unknown[]>;
  reviews: Record<number, unknown[]>;
  jobs: Record<number, unknown[]>;
  /** Answers GET /actions/runs/{id}; falls back to the entry of `runs` with that id. */
  runDetails: Record<number, unknown>;
  /** Job id -> Location of the 302 that GET /actions/jobs/{id}/logs answers (404 when absent). */
  logRedirects: Record<number, string>;
}

export interface MockControl {
  /** Answers the request itself when it returns true (rate limits, hostile bodies, …). */
  respond?: (path: string, res: ServerResponse) => boolean;
}

export interface MockGithub {
  url: string;
  data: MockData;
  requests: RecordedRequest[];
  /** Every non-GET request, with its body. Also recorded in `requests`. */
  writes: RecordedWrite[];
  /** Issues stored by accepted POSTs (and any the test adds), by creation order. */
  issues: MockIssue[];
  writeMode: { current: WriteMode };
  control: MockControl;
  /** Repositories ("owner/name") that answer 404. */
  missingRepos: string[];
  close(): Promise<void>;
}

export async function startMockGithub(): Promise<MockGithub> {
  const data: MockData = {
    user: { login: "me" },
    runs: [],
    pulls: [],
    deployments: [],
    statuses: {},
    reviews: {},
    jobs: {},
    runDetails: {},
    logRedirects: {},
  };
  const requests: RecordedRequest[] = [];
  const writes: RecordedWrite[] = [];
  const issues: MockIssue[] = [];
  const writeMode: { current: WriteMode } = { current: "ok" };
  const missingRepos: string[] = [];
  const control: MockControl = {};

  const send = (res: ServerResponse, status: number, body: unknown, extra = {}) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4000",
      ...extra,
    });
    res.end(JSON.stringify(body));
  };

  function route(path: string): unknown | undefined {
    const url = new URL(path, "http://github");
    const p = url.pathname;
    if (p === "/user") return data.user;
    if (p === "/search/issues") {
      const q = url.searchParams.get("q") ?? "";
      const repo = /repo:(\S+)/.exec(q)?.[1] ?? "";
      const needle = /"([^"]+)"/.exec(q)?.[1] ?? "\0";
      const items = issues
        .filter((i) => i.hiddenFromSearch !== true && i.body.includes(needle))
        .map((i) => issueView(repo, i));
      return { total_count: items.length, items };
    }
    const m = /^\/repos\/([^/]+)\/([^/]+)\/(.+)$/.exec(p);
    if (!m) return undefined;
    const rest = m[3]!;
    if (rest === "actions/runs") {
      const wanted = url.searchParams.get("status");
      const runs = wanted
        ? data.runs.filter(
            (r) =>
              typeof r === "object" &&
              r !== null &&
              (("conclusion" in r && r.conclusion === wanted) ||
                ("status" in r && r.status === wanted)),
          )
        : data.runs;
      return { total_count: runs.length, workflow_runs: runs };
    }
    const jobs = /^actions\/runs\/(\d+)\/jobs$/.exec(rest);
    if (jobs) {
      const list = data.jobs[Number(jobs[1])] ?? [];
      return { total_count: list.length, jobs: list };
    }
    const detail = /^actions\/runs\/(\d+)$/.exec(rest);
    if (detail) {
      const runId = Number(detail[1]);
      return (
        data.runDetails[runId] ??
        data.runs.find((r) => typeof r === "object" && r !== null && "id" in r && r.id === runId)
      );
    }
    if (rest === "issues") {
      const repo = `${m[1]}/${m[2]}`;
      return issues
        .filter((i) => i.hiddenFromList !== true)
        .map((i) => issueView(repo, i))
        .reverse();
    }
    if (rest === "pulls") return data.pulls;
    const reviews = /^pulls\/(\d+)\/reviews$/.exec(rest);
    if (reviews) return data.reviews[Number(reviews[1])] ?? [];
    if (rest === "deployments") return data.deployments;
    const statuses = /^deployments\/(\d+)\/statuses$/.exec(rest);
    if (statuses) return data.statuses[Number(statuses[1])] ?? [];
    return undefined;
  }

  const issueView = (repo: string, i: MockIssue) => ({
    number: i.number,
    title: i.title,
    body: i.body,
    state: "open",
    html_url: `https://github.com/${repo}/issues/${i.number}`,
    ...(i.pullRequest ? { pull_request: {} } : {}),
  });

  /** POST /repos/{owner}/{name}/issues: needs the write credential; stores what it is sent. */
  function createIssue(req: IncomingMessage, res: ServerResponse, path: string): void {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        body = undefined;
      }
      const note = (status: number) =>
        void writes.push({
          method: req.method ?? "",
          path,
          authorization: req.headers.authorization,
          contentType: req.headers["content-type"],
          body,
          status,
        });
      const done = (status: number) => {
        requests.push({
          method: req.method ?? "",
          path,
          authorization: req.headers.authorization,
          ifNoneMatch: undefined,
          status,
        });
        note(status);
      };
      const repo = /^\/repos\/([^/]+\/[^/?]+)\/issues$/.exec(path)?.[1];
      if (req.method !== "POST" || !repo) {
        done(405);
        return send(res, 405, { message: "Method Not Allowed" });
      }
      if (req.headers.authorization !== `Bearer ${MOCK_WRITE_TOKEN}`) {
        // A read-only token (or none) cannot create issues; GitHub answers 403/404 here.
        const status = req.headers.authorization ? 403 : 401;
        done(status);
        return send(res, status, { message: `${MOCK_REMOTE_MARKER} no write access` });
      }
      const fields = typeof body === "object" && body !== null ? body : {};
      const title = "title" in fields && typeof fields.title === "string" ? fields.title : "";
      const text = "body" in fields && typeof fields.body === "string" ? fields.body : "";
      const labels =
        "labels" in fields && Array.isArray(fields.labels)
          ? fields.labels.filter((l): l is string => typeof l === "string")
          : [];
      switch (writeMode.current) {
        case "redirect":
          done(302);
          res.writeHead(302, { location: `http://${req.headers.host}/redirected-write` });
          return void res.end();
        case "http500":
          done(500);
          res.writeHead(500, { "content-type": "text/html" });
          return void res.end(`<html>${MOCK_REMOTE_MARKER}</html>`);
        case "http422":
          done(422);
          return send(res, 422, { message: MOCK_REMOTE_MARKER });
        default:
      }
      const issue: MockIssue = { number: issues.length + 1, title, body: text, labels };
      issues.push(issue);
      switch (writeMode.current) {
        case "store-then-drop":
          done(0);
          return void req.socket.destroy();
        case "malformed":
          done(201);
          res.writeHead(201, { "content-type": "application/json" });
          return void res.end(`{"number": ${MOCK_REMOTE_MARKER}`);
        case "huge":
          done(201);
          res.writeHead(201, { "content-type": "application/json" });
          res.write(`{"number":${issue.number},"pad":"${MOCK_REMOTE_MARKER}`);
          for (let i = 0; i < 80; i++) res.write("x".repeat(4096 * 4));
          return void res.end('"}');
        case "bad-link":
          done(201);
          return send(res, 201, { number: issue.number, html_url: "javascript:alert(1)" });
        default:
          done(201);
          return send(res, 201, issueView(repo, issue));
      }
    });
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = req.url ?? "/";
    if (req.method === "POST" && /^\/repos\/[^/]+\/[^/?]+\/issues$/.test(path)) {
      return createIssue(req, res, path);
    }
    const record = (status: number) =>
      requests.push({
        method: req.method ?? "",
        path,
        authorization: req.headers.authorization,
        ifNoneMatch: req.headers["if-none-match"],
        status,
      });
    if (req.method !== "GET") {
      record(405);
      return send(res, 405, { message: "Method Not Allowed" });
    }
    if (control.respond?.(path, res)) return record(res.statusCode);
    if (
      req.headers.authorization &&
      req.headers.authorization !== `Bearer ${MOCK_TOKEN}` &&
      req.headers.authorization !== `Bearer ${MOCK_WRITE_TOKEN}`
    ) {
      record(401);
      return send(res, 401, { message: "Bad credentials" });
    }
    const repo = /^\/repos\/([^/]+\/[^/]+)\//.exec(path)?.[1];
    // The log endpoint answers 302 to a signed URL on another host (a blob server in tests).
    const logJob = /^\/repos\/[^/]+\/[^/]+\/actions\/jobs\/(\d+)\/logs$/.exec(path)?.[1];
    if (logJob !== undefined) {
      const location =
        repo && missingRepos.includes(repo) ? undefined : data.logRedirects[Number(logJob)];
      if (location === undefined) {
        record(404);
        return send(res, 404, { message: "Not Found" });
      }
      record(302);
      res.writeHead(302, { location });
      return void res.end();
    }
    const body = repo && missingRepos.includes(repo) ? undefined : route(path);
    if (body === undefined) {
      record(404);
      return send(res, 404, { message: "Not Found" });
    }
    const etag = `W/"${createHash("sha1").update(JSON.stringify(body)).digest("hex")}"`;
    if (req.headers["if-none-match"] === etag) {
      record(304);
      res.writeHead(304, { etag, "x-ratelimit-remaining": "4000" });
      return void res.end();
    }
    record(200);
    send(res, 200, body, { etag });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url,
    data,
    requests,
    writes,
    issues,
    writeMode,
    control,
    missingRepos,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
