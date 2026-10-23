// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";

export interface FocusApi {
  snapshot(): {
    manual: boolean;
    osDnd: boolean | null;
    active: boolean;
    remainingMs: number | null;
    held: number;
  };
  start(minutes?: number): void;
  stop(): void;
}

/** Session-token routes for Phoenix's own notification delivery gate. */
export function focusRoutes(service: FocusApi): Route[] {
  return [
    route("GET", "/api/focus", () => service.snapshot()),
    route("POST", "/api/focus", async ({ body }) => {
      const input = expectObject(await body());
      const minutes = input.minutes;
      const hasMinutes = minutes !== undefined;
      const validMinutes =
        typeof minutes === "number" &&
        Number.isInteger(minutes) &&
        minutes >= 1 &&
        minutes <= 24 * 60;
      if ((hasMinutes && !validMinutes) || Object.keys(input).some((key) => key !== "minutes")) {
        throw new PhoenixError(
          ErrorCode.INVALID_REQUEST,
          '"minutes" must be an integer between 1 and 1440',
        );
      }
      service.start(validMinutes ? minutes : undefined);
      return service.snapshot();
    }),
    route("DELETE", "/api/focus", () => {
      service.stop();
      return service.snapshot();
    }),
  ];
}
