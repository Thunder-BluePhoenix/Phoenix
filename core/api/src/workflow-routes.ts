// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectBoolean, expectObject, intParam, route, type Route } from "./http";
import type { CoreServices } from "./services";

const MAX_ID_CHARS = 200;
const MAX_PAGE = 200;
const MAX_PAYLOAD_KEYS = 20;
const MAX_PAYLOAD_DEPTH = 6;
const MAX_FILTER_CHARS = 48;

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

function exactKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalid(`Unknown field "${key.slice(0, 40)}"`);
  }
}

/** An id taken from the URL path. Overlong ids cannot exist, so they are 404 without a lookup. */
function pathId(value: string | undefined, what: string): string {
  if (value === undefined || value.length === 0 || value.length > MAX_ID_CHARS) {
    throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, `${what} not found`);
  }
  return value;
}

function depthOf(value: unknown, depth: number): number {
  if (depth > MAX_PAYLOAD_DEPTH)
    throw invalid(`"payload" is nested deeper than ${MAX_PAYLOAD_DEPTH}`);
  if (value === null || typeof value !== "object") return depth;
  return Math.max(depth, ...Object.values(value).map((v) => depthOf(v, depth + 1)));
}

function payloadOf(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  const payload = expectObject(value);
  if (Object.keys(payload).length > MAX_PAYLOAD_KEYS) {
    throw invalid(`"payload" has more than ${MAX_PAYLOAD_KEYS} keys`);
  }
  depthOf(payload, 1);
  return payload;
}

function filter(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  if (value === null || value === "") return undefined;
  if (value.length > MAX_FILTER_CHARS) throw invalid(`"${key}" is not a known value`);
  return value;
}

/** The `definition` of a body; a body without it is a malformed request, not an invalid workflow. */
function definitionOf(b: Record<string, unknown>): unknown {
  exactKeys(b, ["definition"]);
  if (!("definition" in b)) throw invalid('"definition" is required');
  return b.definition;
}

/**
 * Workflows (Phases 39-40). USER routes only: they need the session token, and nothing an agent, a
 * workflow step, a model or a capability can call reaches them (no tool or capability command
 * exists for any of them). The fixed paths (`runs`, `metrics`, `validate`) are registered before the
 * `:id` routes.
 */
export function workflowRoutes(s: CoreServices): Route[] {
  const workflows = () => {
    if (!s.workflows) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Workflows not found");
    return s.workflows;
  };

  return [
    route("GET", "/api/workflows", () => ({ workflows: workflows().list() })),
    route("GET", "/api/workflows/metrics", () => ({ metrics: workflows().metrics() })),
    route("GET", "/api/workflows/runs", ({ url }) => {
      const limit = intParam(url, "limit", 50)!;
      if (limit < 1 || limit > MAX_PAGE) throw invalid(`"limit" must be between 1 and ${MAX_PAGE}`);
      const workflowId = filter(url, "workflow_id");
      const status = filter(url, "status");
      return workflows().listRuns({
        limit,
        ...(workflowId ? { workflowId } : {}),
        ...(status ? { status } : {}),
      });
    }),
    route("POST", "/api/workflows/runs/prune", async ({ body }) => {
      const b = expectObject(await body());
      exactKeys(b, ["before", "limit", "confirm_evidence"]);
      if (typeof b.before !== "string" || !Number.isFinite(Date.parse(b.before)))
        throw invalid('"before" must be an ISO timestamp');
      if (b.confirm_evidence !== undefined && typeof b.confirm_evidence !== "boolean")
        throw invalid('"confirm_evidence" must be boolean');
      if (
        typeof b.limit !== "number" ||
        !Number.isInteger(b.limit) ||
        b.limit < 1 ||
        b.limit > MAX_PAGE
      )
        throw invalid(`"limit" must be between 1 and ${MAX_PAGE}`);
      return workflows().pruneRuns({
        before: Date.parse(b.before),
        limit: b.limit,
        ...(b.confirm_evidence === undefined ? {} : { confirmEvidence: b.confirm_evidence }),
      });
    }),
    route("GET", "/api/workflows/runs/:id", ({ params }) => {
      const run = workflows().getRun(pathId(params.id, "Run"));
      if (!run) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Run not found");
      return run;
    }),
    route("POST", "/api/workflows/runs/:id/cancel", async ({ params, body, res }) => {
      exactKeys(expectObject(await body()), []);
      const result = workflows().cancelRun(pathId(params.id, "Run"));
      res.statusCode = 202;
      return result;
    }),
    route("POST", "/api/workflows/runs/:id/delete", async ({ params, body }) => {
      const b = expectObject(await body());
      exactKeys(b, ["confirm_evidence"]);
      if (b.confirm_evidence !== undefined && typeof b.confirm_evidence !== "boolean")
        throw invalid('"confirm_evidence" must be boolean');
      return workflows().deleteRun(pathId(params.id, "Run"), b.confirm_evidence === true);
    }),
    route("POST", "/api/workflows/validate", async ({ body }) => {
      return workflows().validate(definitionOf(expectObject(await body())));
    }),
    route("POST", "/api/workflows", async ({ body, res }) => {
      const b = expectObject(await body());
      exactKeys(b, ["definition", "expected_hash", "create_only"]);
      if (!("definition" in b)) throw invalid('"definition" is required');
      if (
        b.expected_hash !== undefined &&
        (typeof b.expected_hash !== "string" ||
          b.expected_hash.length === 0 ||
          b.expected_hash.length > 128)
      )
        throw invalid('"expected_hash" must be a workflow hash');
      if (b.create_only !== undefined && typeof b.create_only !== "boolean")
        throw invalid('"create_only" must be boolean');
      if (b.create_only === true && b.expected_hash !== undefined)
        throw invalid('"create_only" cannot be combined with "expected_hash"');
      const { created, ...saved } = workflows().save(b.definition, {
        ...(b.expected_hash === undefined ? {} : { expectedHash: b.expected_hash }),
        ...(b.create_only === undefined ? {} : { createOnly: b.create_only }),
      });
      res.statusCode = created ? 201 : 200;
      return saved;
    }),
    route("GET", "/api/workflows/:id", ({ params }) => {
      const found = workflows().get(pathId(params.id, "Workflow"));
      if (!found) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Workflow not found");
      return found;
    }),
    route("POST", "/api/workflows/:id/enabled", async ({ params, body }) => {
      const b = expectObject(await body());
      exactKeys(b, ["enabled"]);
      return {
        workflow: workflows().setEnabled(
          pathId(params.id, "Workflow"),
          expectBoolean(b, "enabled"),
        ),
      };
    }),
    route("POST", "/api/workflows/:id/authorise", async ({ params, body }) => {
      const b = expectObject(await body());
      exactKeys(b, ["hash", "expires_at"]);
      if (typeof b.hash !== "string" || b.hash.length === 0 || b.hash.length > 128) {
        throw invalid('"hash" must be the hash of the workflow you reviewed');
      }
      if (b.expires_at !== undefined && typeof b.expires_at !== "string") {
        throw invalid('"expires_at" must be an ISO timestamp');
      }
      return workflows().authorise(pathId(params.id, "Workflow"), {
        hash: b.hash,
        ...(b.expires_at === undefined ? {} : { expiresAt: b.expires_at }),
      });
    }),
    route("POST", "/api/workflows/:id/revoke", async ({ params, body }) => {
      exactKeys(expectObject(await body()), []);
      return workflows().revoke(pathId(params.id, "Workflow"));
    }),
    route("POST", "/api/workflows/:id/runs", async ({ params, body, res }) => {
      const b = expectObject(await body());
      exactKeys(b, ["payload"]);
      const started = workflows().startRun(pathId(params.id, "Workflow"), payloadOf(b.payload));
      res.statusCode = 202;
      return started;
    }),
  ];
}
