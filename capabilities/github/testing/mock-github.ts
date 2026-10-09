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

export interface RecordedRequest {
  method: string;
  /** Path and query, e.g. /repos/octo/phoenix/pulls?state=all */
  path: string;
  authorization: string | undefined;
  ifNoneMatch: string | undefined;
  status: number;
}

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
    if (rest === "pulls") return data.pulls;
    const reviews = /^pulls\/(\d+)\/reviews$/.exec(rest);
    if (reviews) return data.reviews[Number(reviews[1])] ?? [];
    if (rest === "deployments") return data.deployments;
    const statuses = /^deployments\/(\d+)\/statuses$/.exec(rest);
    if (statuses) return data.statuses[Number(statuses[1])] ?? [];
    return undefined;
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = req.url ?? "/";
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
    if (req.headers.authorization && req.headers.authorization !== `Bearer ${MOCK_TOKEN}`) {
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
    control,
    missingRepos,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
