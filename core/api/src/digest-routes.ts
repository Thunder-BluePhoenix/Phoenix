// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { DailyDigest } from "../../runtime/src/daily-digest";
import { isDayKey } from "../../runtime/src/recap-calendar";
import { route, type Route } from "./http";

export interface DigestService {
  generate(day?: string): Promise<DailyDigest>;
  commit(sha: string): Promise<{ sha: string; title: string; occurredAt: string } | null>;
  event(id: string): {
    id: string;
    title: string;
    kind: "commit" | "meeting" | "ci" | "task" | "session";
    status: "done" | "planned" | "blocked";
    occurredAt: string;
    verified: false;
  } | null;
}
/** Read-only digest route; publishing to Slack/Teams is intentionally not exposed. */
export function digestRoutes(service: DigestService): Route[] {
  return [
    route("GET", "/api/digest", async ({ url }) => {
      for (const key of url.searchParams.keys())
        if (key !== "day")
          throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Unknown digest parameter");
      const day = url.searchParams.get("day") ?? undefined;
      if (day !== undefined && !isDayKey(day))
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Invalid digest day");
      return service.generate(day);
    }),
    route("GET", "/api/digest/commit/:sha", async ({ params }) => {
      const commit = await service.commit(params.sha!);
      if (!commit) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Commit not found");
      return commit;
    }),
    route("GET", "/api/digest/event/:id", ({ params }) => {
      const event = service.event(params.id!);
      if (!event) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Digest event not found");
      return event;
    }),
  ];
}
