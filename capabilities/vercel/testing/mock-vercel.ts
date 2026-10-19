// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for api.vercel.com shaped from Vercel's public REST docs: GET /v6/deployments
// (`{ deployments: [...] }`, camelCase fields, `uid`, `name`, `state`, `target`, `created` in epoch
// ms, `meta.github*`), GET /v13/deployments/{id} and POST /v13/deployments (answers `id`, `url`,
// `readyState`). Bearer-token authenticated. Nothing here talks to the real service.
import { startMockService, type MockReply, type MockService } from "@phoenix/service-kit/testing";

/** Built at runtime so no token-shaped literal sits in the source tree. */
export const MOCK_TOKEN = ["fake", "vercel", "credential", "0042"].join("-");
/** Placed in hostile bodies; no error, event, log or audit row may contain it. */
export const REMOTE_MARKER = "REMOTE-TEXT-MUST-NOT-LEAK";

export interface MockDeploymentData {
  uid: string;
  name: string;
  state: string;
  target?: string | null;
  created: number;
  url?: string;
  inspectorUrl?: string;
  creator?: { username?: string };
  meta?: Record<string, unknown>;
  [extra: string]: unknown;
}

export interface MockVercel {
  service: MockService;
  url: string;
  deployments: MockDeploymentData[];
  /** Replies instead of the normal routes while set (hostile bodies, 401, 429, redirects…). */
  override: { current: ((path: string, method: string) => MockReply | undefined) | undefined };
  /** POST /v13/deployments bodies received. */
  posts: { path: string; body: unknown }[];
  close(): Promise<void>;
}

export function deployment(over: Partial<MockDeploymentData> = {}): MockDeploymentData {
  const uid = over.uid ?? "dpl_ABC123";
  return {
    uid,
    name: "web",
    state: "READY",
    target: "production",
    created: Date.parse("2026-10-05T10:00:00Z"),
    url: `web-${uid.toLowerCase()}.vercel.app`,
    inspectorUrl: `https://vercel.com/acme/web/${uid}`,
    creator: { username: "ada" },
    meta: {
      githubOrg: "acme",
      githubRepo: "web",
      githubCommitRef: "main",
      githubCommitSha: "0123456789abcdef0123456789abcdef01234567",
    },
    ...over,
  };
}

export async function startMockVercel(): Promise<MockVercel> {
  const deployments: MockDeploymentData[] = [];
  const posts: MockVercel["posts"] = [];
  const override: MockVercel["override"] = { current: undefined };
  let counter = 0;
  const service = await startMockService((req) => {
    const authorised = req.headers.authorization === `Bearer ${MOCK_TOKEN}`;
    const reply = override.current?.(req.path, req.method);
    if (reply) return reply;
    if (!authorised)
      return { status: 401, body: { error: { code: "forbidden", message: "Not authorized" } } };
    const path = req.path.split("?")[0] ?? "";
    if (req.method === "GET" && path === "/v6/deployments") {
      return { body: { deployments: deployments, pagination: { count: deployments.length } } };
    }
    const one = /^\/v13\/deployments\/([^/]+)$/.exec(path);
    if (req.method === "GET" && one) {
      const found = deployments.find((d) => d.uid === decodeURIComponent(one[1] ?? ""));
      return found ? { body: { ...found, id: found.uid } } : { status: 404, body: { error: {} } };
    }
    if (req.method === "POST" && path === "/v13/deployments") {
      posts.push({ path: req.path, body: JSON.parse(req.body || "null") });
      counter++;
      return {
        body: {
          id: `dpl_NEW${counter}`,
          url: `web-new${counter}.vercel.app`,
          readyState: "QUEUED",
        },
      };
    }
    return undefined;
  });
  return {
    service,
    url: service.url,
    deployments,
    override,
    posts,
    close: () => service.close(),
  };
}
