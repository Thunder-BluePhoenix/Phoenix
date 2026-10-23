// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { DailyDigest } from "../../runtime/src/daily-digest";
import type {
  DailyDigestSlackResult,
  DailyDigestSlackStatus,
} from "../../runtime/src/daily-digest/slack";
import { isDayKey } from "../../runtime/src/recap-calendar";
import { expectObject, route, type Route } from "./http";

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
export interface DailyDigestSlackService {
  status(): Promise<DailyDigestSlackStatus>;
  setEnabled(enabled: boolean): Promise<DailyDigestSlackStatus>;
  send(day?: string): Promise<DailyDigestSlackResult>;
}

/** Read-only digest evidence plus a separately opted-in, confirmation-gated Slack delivery. */
export function digestRoutes(service: DigestService, slack?: DailyDigestSlackService): Route[] {
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
    ...(slack
      ? [
          route("POST", "/api/digest/:day/slack", async ({ params, body }) => {
            const input = expectObject(await body());
            if (Object.keys(input).length !== 0)
              throw new PhoenixError(
                ErrorCode.INVALID_REQUEST,
                "Daily digest Slack send accepts no fields",
              );
            const day = params.day!;
            if (!isDayKey(day))
              throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Invalid digest day");
            return slack.send(day);
          }),
          route("POST", "/api/digest/slack", async ({ body }) => {
            const input = expectObject(await body());
            if (Object.keys(input).length !== 0)
              throw new PhoenixError(
                ErrorCode.INVALID_REQUEST,
                "Daily digest Slack send accepts no fields",
              );
            return slack.send();
          }),
          route("GET", "/api/digest/slack", () => slack.status()),
          route("PUT", "/api/digest/slack", async ({ body }) => {
            const input = expectObject(await body());
            if (Object.keys(input).length !== 1 || typeof input.enabled !== "boolean")
              throw new PhoenixError(
                ErrorCode.INVALID_REQUEST,
                'Expected only a boolean "enabled"',
              );
            return slack.setEnabled(input.enabled);
          }),
        ]
      : []),
  ];
}
