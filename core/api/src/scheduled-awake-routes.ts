// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { ScheduledAwakeView } from "../../runtime/src/scheduled-awake/service";
import { expectObject, route, type Route } from "./http";

/**
 * Session-token routes only. Turning scheduling on and saving a schedule wait for the user's
 * confirmation in the approval UI (so the request can take up to the confirmation timeout);
 * everything that only shortens awake time answers at once.
 */
export interface ScheduledAwakeApi {
  status(): ScheduledAwakeView;
  setEnabled(on: boolean): Promise<ScheduledAwakeView>;
  upsertSchedule(input: unknown): Promise<ScheduledAwakeView>;
  removeSchedule(id: string): Promise<ScheduledAwakeView>;
  skipWindow(key: string): Promise<ScheduledAwakeView>;
  unskipWindow(key: string): Promise<ScheduledAwakeView>;
  cancelCurrent(): Promise<{ status: ScheduledAwakeView; skipped: string[] }>;
}

const SCHEDULE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const WINDOW_KEY = /^[a-z0-9][a-z0-9-]{0,39}@\d{4}-\d{2}-\d{2}$/;

function pathValue(raw: string | undefined, pattern: RegExp, what: string): string {
  let value: string;
  try {
    value = decodeURIComponent(raw ?? "");
  } catch {
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, `Not ${what}`);
  }
  if (!pattern.test(value)) throw new PhoenixError(ErrorCode.INVALID_REQUEST, `Not ${what}`);
  return value;
}

function windowKey(input: Record<string, unknown>): string {
  const key = input.key;
  if (typeof key !== "string" || !WINDOW_KEY.test(key))
    throw new PhoenixError(
      ErrorCode.INVALID_REQUEST,
      '"key" must look like schedule-id@YYYY-MM-DD',
    );
  return key;
}

export function scheduledAwakeRoutes(service: ScheduledAwakeApi): Route[] {
  return [
    route("GET", "/api/scheduled-awake", () => service.status()),
    route("PUT", "/api/scheduled-awake", async ({ body }) => {
      const input = expectObject(await body());
      if (typeof input.enabled !== "boolean" || Object.keys(input).length !== 1)
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, 'Expected only a boolean "enabled"');
      return service.setEnabled(input.enabled);
    }),
    route("POST", "/api/scheduled-awake/schedules", async ({ body }) =>
      service.upsertSchedule(expectObject(await body())),
    ),
    route("DELETE", "/api/scheduled-awake/schedules/:id", ({ params }) =>
      service.removeSchedule(pathValue(params.id, SCHEDULE_ID, "a schedule id")),
    ),
    route("POST", "/api/scheduled-awake/skips", async ({ body }) =>
      service.skipWindow(windowKey(expectObject(await body()))),
    ),
    route("DELETE", "/api/scheduled-awake/skips/:key", ({ params }) =>
      service.unskipWindow(pathValue(params.key, WINDOW_KEY, "a window key")),
    ),
    route("POST", "/api/scheduled-awake/cancel-current", () => service.cancelCurrent()),
  ];
}
