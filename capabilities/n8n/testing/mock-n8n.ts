// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for a self-hosted n8n shaped from the n8n public API docs: lists answer
// `{ data: [...], nextCursor }` under /api/v1, authentication is the X-N8N-API-KEY header,
// executions have `id`, `workflowId`, `status` (success | error | running | waiting | crashed |
// new), `mode`, `startedAt`, `stoppedAt`, and `data` only when includeData=true.
// POST /executions/{id}/retry and POST /workflows/{id}/deactivate are the two mutations.
// Nothing here talks to a real n8n.
import { startMockService, type MockReply, type MockService } from "@phoenix/service-kit/testing";

/** Built at runtime so no key-shaped literal sits in the source tree. */
export const MOCK_KEY = ["fake", "n8n", "credential", "0042"].join("-");
/** Placed in hostile bodies; no error, event, log or audit row may contain it. */
export const REMOTE_MARKER = "REMOTE-TEXT-MUST-NOT-LEAK";

export interface MockWorkflowData {
  id: string;
  name: string;
  active: boolean;
  [extra: string]: unknown;
}

export interface MockExecutionData {
  id: number | string;
  workflowId: string;
  status: string;
  mode?: string;
  startedAt: string;
  stoppedAt?: string | null;
  finished?: boolean;
  data?: unknown;
  [extra: string]: unknown;
}

export interface MockN8n {
  service: MockService;
  url: string;
  workflows: MockWorkflowData[];
  executions: MockExecutionData[];
  override: { current: ((path: string, method: string) => MockReply | undefined) | undefined };
  /** POSTs received (retries and deactivations). */
  posts: { path: string }[];
  close(): Promise<void>;
}

export function workflow(over: Partial<MockWorkflowData> = {}): MockWorkflowData {
  return {
    id: "wf1",
    name: "Nightly sync",
    active: true,
    createdAt: "2026-09-01T00:00:00Z",
    nodes: [],
    ...over,
  };
}

export function execution(over: Partial<MockExecutionData> = {}): MockExecutionData {
  return {
    id: 101,
    workflowId: "wf1",
    status: "success",
    mode: "trigger",
    finished: true,
    startedAt: "2026-10-05T10:00:00.000Z",
    stoppedAt: "2026-10-05T10:00:05.000Z",
    ...over,
  };
}

export async function startMockN8n(): Promise<MockN8n> {
  const workflows: MockWorkflowData[] = [];
  const executions: MockExecutionData[] = [];
  const posts: MockN8n["posts"] = [];
  const override: MockN8n["override"] = { current: undefined };
  let counter = 900;
  const service = await startMockService((req) => {
    const reply = override.current?.(req.path, req.method);
    if (reply) return reply;
    if (req.headers["x-n8n-api-key"] !== MOCK_KEY) {
      return { status: 401, body: { message: "unauthorized" } };
    }
    const path = req.path.split("?")[0] ?? "";
    if (req.method === "GET" && path === "/api/v1/workflows") {
      return { body: { data: workflows, nextCursor: null } };
    }
    if (req.method === "GET" && path === "/api/v1/executions") {
      return {
        body: { data: executions.map(({ data: _data, ...rest }) => rest), nextCursor: null },
      };
    }
    const retry = /^\/api\/v1\/executions\/([^/]+)\/retry$/.exec(path);
    if (req.method === "POST" && retry) {
      posts.push({ path: req.path });
      if (!executions.some((e) => String(e.id) === decodeURIComponent(retry[1] ?? ""))) {
        return { status: 404, body: { message: "not found" } };
      }
      counter++;
      return {
        body: {
          id: counter,
          workflowId: "wf1",
          status: "running",
          startedAt: "2026-10-05T11:00:00Z",
        },
      };
    }
    const off = /^\/api\/v1\/workflows\/([^/]+)\/deactivate$/.exec(path);
    if (req.method === "POST" && off) {
      posts.push({ path: req.path });
      const found = workflows.find((w) => w.id === decodeURIComponent(off[1] ?? ""));
      if (!found) return { status: 404, body: { message: "not found" } };
      found.active = false;
      return { body: found };
    }
    return undefined;
  });
  return {
    service,
    url: service.url,
    workflows,
    executions,
    override,
    posts,
    close: () => service.close(),
  };
}
