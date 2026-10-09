// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, intParam, route, type Route } from "./http";
import { MAX_QUESTION_CHARS } from "./memory-routes";
import type { CoreServices } from "./services";

const MAX_NODE_ID_CHARS = 400;
const MAX_NAME_CHARS = 200;
const MAX_DEPTH = 2;

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);
const notFound = () => new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Node not found");

function exactKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalid(`Unknown field "${key.slice(0, 40)}"`);
  }
}

function text(value: unknown, key: string, max: number): string {
  if (typeof value !== "string") throw invalid(`"${key}" must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw invalid(`"${key}" must not be empty`);
  if (trimmed.length > max) throw invalid(`"${key}" must be at most ${max} characters`);
  return trimmed;
}

/** Knowledge graph: provenance inspection, questions, forgetting a person (Phase 38). */
export function graphRoutes(s: CoreServices): Route[] {
  const graph = () => {
    if (!s.graph) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Graph not found");
    return s.graph;
  };
  /** Node ids contain `/`, `#` and `:`; clients send them %-encoded and the router decodes them. */
  const nodeId = (value: string | undefined): string => {
    if (value === undefined || value.length === 0 || value.length > MAX_NODE_ID_CHARS) {
      throw notFound();
    }
    return value;
  };

  return [
    route("GET", "/api/graph/status", () => graph().status()),
    route("GET", "/api/graph/nodes/:id", ({ params }) => {
      const found = graph().inspect(nodeId(params.id));
      if (!found) throw notFound();
      return found;
    }),
    route("GET", "/api/graph/nodes/:id/neighbors", ({ params, url }) => {
      const depth = intParam(url, "depth", 1)!;
      if (depth < 1 || depth > MAX_DEPTH) throw invalid(`"depth" must be 1 or ${MAX_DEPTH}`);
      const found = graph().neighbors(nodeId(params.id), depth);
      if (!found) throw notFound();
      return found;
    }),
    route("POST", "/api/graph/ask", async ({ body }) => {
      const b = expectObject(await body());
      exactKeys(b, ["question", "narrate"]);
      if (b.narrate !== undefined && typeof b.narrate !== "boolean") {
        throw invalid('"narrate" must be a boolean');
      }
      return graph().ask(text(b.question, "question", MAX_QUESTION_CHARS), {
        narrate: b.narrate === true,
      });
    }),
    // Forgetting a person is permanent and also blocks them from coming back: say so literally.
    route("POST", "/api/graph/people/forget", async ({ body }) => {
      const b = expectObject(await body());
      exactKeys(b, ["name", "confirm"]);
      if (b.confirm !== true) {
        throw new PhoenixError(
          ErrorCode.ACTION_REQUIRES_CONFIRMATION,
          'Forgetting a person needs {"confirm": true}',
        );
      }
      return graph().forgetPerson(text(b.name, "name", MAX_NAME_CHARS));
    }),
  ];
}
