// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";
import type { CoreServices } from "./services";

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);
const scopeId = (value: string | undefined): string => {
  if (!value || !/^[a-z][a-z0-9_-]{0,63}$/.test(value))
    throw invalid("Invalid autonomy identifier");
  return value;
};
const environment = (value: string | undefined): string => {
  if (!value || !["local", "dev", "staging", "production"].includes(value))
    throw invalid("Invalid autonomy environment");
  return value;
};
const exactKeys = (body: Record<string, unknown>, allowed: readonly string[]): void => {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalid(`Unknown field "${key.slice(0, 40)}"`);
  }
};

/** Session-token user routes only. No actor, run start, or executable action is accepted here. */
export function autonomyRoutes(s: CoreServices): Route[] {
  const autonomy = () => {
    if (!s.autonomyApi) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Autonomy not found");
    return s.autonomyApi;
  };
  return [
    route("POST", "/api/autonomy/runs/:id/stop", async ({ params, body }) => {
      exactKeys(expectObject(await body()), []);
      autonomy().stop(scopeId(params.id));
      return { stopped: true };
    }),
    route("GET", "/api/autonomy/:capability/:environment", ({ params }) => ({
      setting: autonomy().setting(scopeId(params.capability), environment(params.environment)),
    })),
    route("POST", "/api/autonomy/:capability/:environment", async ({ params, body }) => {
      const b = expectObject(await body());
      exactKeys(b, ["level", "max_actions", "max_duration_ms"]);
      if (
        typeof b.level !== "string" ||
        typeof b.max_actions !== "number" ||
        typeof b.max_duration_ms !== "number"
      )
        throw invalid("Invalid autonomy setting");
      return {
        setting: autonomy().configure(
          scopeId(params.capability),
          environment(params.environment),
          b.level,
          b.max_actions,
          b.max_duration_ms,
        ),
      };
    }),
  ];
}
