// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, intParam, route, type Route } from "./http";
import type { CoreServices } from "./services";

const MAX_PAGE = 200;
const MAX_KIND_CHARS = 40;
const STATES = [
  "CREATED",
  "READY",
  "RUNNING",
  "WAITING_APPROVAL",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);
const notFound = () => new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Task not found");

function exactKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalid(`Unknown field "${key.slice(0, 40)}"`);
  }
}

/** Agent tasks and automation settings. Everything here is behind the session token. */
export function agentRoutes(s: CoreServices): Route[] {
  const agents = () => {
    if (!s.agents) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Agents not found");
    return s.agents;
  };

  return [
    route("POST", "/api/agent/tasks", async ({ body, res }) => {
      const b = expectObject(await body());
      exactKeys(b, ["kind", "input"]);
      if (typeof b.kind !== "string" || b.kind.length === 0 || b.kind.length > MAX_KIND_CHARS) {
        throw invalid(`"kind" must be a string of 1-${MAX_KIND_CHARS} characters`);
      }
      if (b.input === null || typeof b.input !== "object" || Array.isArray(b.input)) {
        throw invalid('"input" must be an object');
      }
      const task = agents().submit({ kind: b.kind, input: b.input });
      res.statusCode = 202;
      return { task };
    }),
    route("GET", "/api/agent/tasks", ({ url }) => {
      const raw = url.searchParams.get("state");
      let state: string | undefined;
      if (raw !== null && raw !== "") {
        state = raw.toUpperCase();
        if (!(STATES as readonly string[]).includes(state))
          throw invalid('"state" is not a run state');
      }
      const limit = intParam(url, "limit", 50)!;
      if (limit < 1 || limit > MAX_PAGE) throw invalid(`"limit" must be between 1 and ${MAX_PAGE}`);
      return agents().list({ ...(state ? { state } : {}), limit });
    }),
    route("GET", "/api/agent/settings", () => agents().settings()),
    route("POST", "/api/agent/settings", async ({ body }) => {
      const b = expectObject(await body());
      exactKeys(b, ["enabled"]);
      if (typeof b.enabled !== "boolean") throw invalid('"enabled" must be a boolean');
      return agents().setSettings({ enabled: b.enabled });
    }),
    route("GET", "/api/agent/tasks/:id", ({ params }) => {
      const detail = agents().get(params.id!);
      if (!detail) throw notFound();
      return detail;
    }),
    route("POST", "/api/agent/tasks/:id/cancel", async ({ params, body }) => {
      exactKeys(expectObject(await body()), []);
      const result = agents().cancel(params.id!);
      if (!result) throw notFound();
      return result;
    }),
  ];
}
