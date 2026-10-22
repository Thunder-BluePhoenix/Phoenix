// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";
import type { EngineeringSignalsSnapshot } from "../../runtime/src/engineering-signals";

export interface EngineeringSignalsApi {
  status(): Promise<EngineeringSignalsSnapshot>;
  setWatchedRoots(roots: unknown): Promise<EngineeringSignalsSnapshot>;
}

/** Authenticated routes; the service owns canonicalization, persistence and read-only scanning. */
export function engineeringSignalsRoutes(service: EngineeringSignalsApi): Route[] {
  return [
    route("GET", "/api/engineering-signals", () => service.status()),
    route("PUT", "/api/engineering-signals/watched-roots", async ({ body }) => {
      const input = expectObject(await body());
      if (Object.keys(input).length !== 1 || !Object.hasOwn(input, "watchedRoots"))
        throw new PhoenixError(
          ErrorCode.INVALID_REQUEST,
          'Expected {"watchedRoots": [absolute paths]}',
        );
      return service.setWatchedRoots(input.watchedRoots);
    }),
  ];
}
