// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";
import type { CoreServices, PlanDestinationView, PlanEditInput } from "./services";

const MAX_ID_CHARS = 200;
const MAX_TEXT = 20_000;
const MAX_LIST = 50;

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

function text(value: unknown, key: string): string {
  if (typeof value !== "string") throw invalid(`"${key}" must be a string`);
  if (value.length > MAX_TEXT) throw invalid(`"${key}" is too long`);
  return value;
}

function textList(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_LIST) {
    throw invalid(`"${key}" must be a list of at most ${MAX_LIST} strings`);
  }
  return value.map((v) => text(v, key));
}

function destination(value: unknown): PlanDestinationView {
  const d = expectObject(value);
  if (d.system === "github") {
    exactKeys(d, ["system", "repository"]);
    return { system: "github", repository: text(d.repository, "destination.repository") };
  }
  if (d.system === "frappe") {
    exactKeys(d, ["system", "site"]);
    return { system: "frappe", site: text(d.site, "destination.site") };
  }
  throw invalid('"destination.system" must be "github" or "frappe"');
}

function editInput(b: Record<string, unknown>): PlanEditInput {
  exactKeys(b, [
    "title",
    "summary",
    "acceptance_criteria",
    "tasks",
    "risks",
    "open_questions",
    "destination",
  ]);
  const out: PlanEditInput = {};
  if (b.title !== undefined) out.title = text(b.title, "title");
  if (b.summary !== undefined) out.summary = text(b.summary, "summary");
  if (b.acceptance_criteria !== undefined) {
    out.acceptance_criteria = textList(b.acceptance_criteria, "acceptance_criteria");
  }
  if (b.risks !== undefined) out.risks = textList(b.risks, "risks");
  if (b.open_questions !== undefined)
    out.open_questions = textList(b.open_questions, "open_questions");
  if (b.destination !== undefined) out.destination = destination(b.destination);
  if (b.tasks !== undefined) {
    if (!Array.isArray(b.tasks) || b.tasks.length > MAX_LIST) {
      throw invalid(`"tasks" must be a list of at most ${MAX_LIST} tasks`);
    }
    out.tasks = b.tasks.map((raw) => {
      const t = expectObject(raw);
      exactKeys(t, ["title", "body", "labels"]);
      return {
        title: text(t.title, "tasks.title"),
        body: text(t.body, "tasks.body"),
        ...(t.labels === undefined ? {} : { labels: textList(t.labels, "tasks.labels") }),
      };
    });
  }
  return out;
}

/**
 * Plans and task creation (Phase 36). USER routes only: they need the session token and there is no
 * tool, capability command or agent path to any of them. `approve` and `create` in particular exist
 * nowhere else; the tool registry is built from capability manifests and none declares them.
 */
export function planRoutes(s: CoreServices): Route[] {
  const planning = () => {
    if (!s.planning) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Planning not found");
    return s.planning;
  };
  const planAction = (action: "propose" | "cancel") =>
    route("POST", `/api/plans/:id/${action}`, async ({ params, body }) => {
      exactKeys(expectObject(await body()), []);
      return planning()[action](pathId(params.id, "Plan"));
    });

  return [
    route("GET", "/api/plans/status", () => planning().status()),
    route("POST", "/api/meeting-items/:id/plan", async ({ params, body, res }) => {
      const b = expectObject(await body());
      exactKeys(b, ["destination"]);
      const made = await planning().generate(pathId(params.id, "Item"), destination(b.destination));
      res.statusCode = 201;
      return made;
    }),
    route("GET", "/api/meetings/:id/plans", ({ params }) =>
      planning().listForMeeting(pathId(params.id, "Meeting")),
    ),
    route("GET", "/api/meetings/:id/links", ({ params }) =>
      planning().linksForMeeting(pathId(params.id, "Meeting")),
    ),
    route("GET", "/api/task-links", ({ url }) => {
      const system = url.searchParams.get("system");
      const id = url.searchParams.get("id");
      if (system !== "github" && system !== "frappe") {
        throw invalid('"system" must be "github" or "frappe"');
      }
      if (id === null || id.length === 0 || id.length > MAX_ID_CHARS) {
        throw invalid(`"id" must be 1-${MAX_ID_CHARS} characters`);
      }
      return planning().linksForTask(system, id);
    }),
    route("GET", "/api/plans/:id", ({ params }) => planning().get(pathId(params.id, "Plan"))),
    route("GET", "/api/plans/:id/preview", ({ params }) =>
      planning().preview(pathId(params.id, "Plan")),
    ),
    route("POST", "/api/plans/:id/edit", async ({ params, body }) => {
      const change = editInput(expectObject(await body()));
      if (Object.keys(change).length === 0) throw invalid("Nothing to change");
      return planning().edit(pathId(params.id, "Plan"), change);
    }),
    planAction("propose"),
    route("POST", "/api/plans/:id/approve", async ({ params, body }) => {
      const b = expectObject(await body());
      exactKeys(b, ["hash", "include_meeting_ref"]);
      if (b.include_meeting_ref !== undefined && typeof b.include_meeting_ref !== "boolean") {
        throw invalid('"include_meeting_ref" must be a boolean');
      }
      return planning().approve(pathId(params.id, "Plan"), {
        hash: text(b.hash, "hash"),
        includeMeetingRef: b.include_meeting_ref === true,
      });
    }),
    route("POST", "/api/plans/:id/create", async ({ params, body }) => {
      const b = expectObject(await body());
      exactKeys(b, ["confirm"]);
      if (b.confirm !== true) {
        throw new PhoenixError(
          ErrorCode.ACTION_REQUIRES_CONFIRMATION,
          'Creating tasks needs {"confirm": true}',
        );
      }
      return planning().create(pathId(params.id, "Plan"));
    }),
    planAction("cancel"),
  ];
}
