// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";
import type { CoreServices } from "./services";

export function proactiveRoutes(s: CoreServices): Route[] {
  const service = () => {
    if (!s.proactive)
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Proactive insights not available");
    return s.proactive;
  };
  return [
    route("GET", "/api/proactive", () => service().status()),
    route("POST", "/api/proactive/preferences", async ({ body }) =>
      service().setPreferences(expectObject(await body())),
    ),
    route("GET", "/api/proactive/preview", () => service().preview()),
    route("POST", "/api/proactive/evaluate", async ({ body }) => {
      const input = expectObject(await body());
      if (Object.keys(input).length > 0)
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Evaluation accepts no fields");
      return service().evaluate();
    }),
    route("POST", "/api/proactive/dismiss", async ({ body }) => {
      const input = expectObject(await body());
      if (Object.keys(input).length !== 1 || typeof input.id !== "string")
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, 'Expected {"id": "insight id"}');
      return service().dismiss(input.id);
    }),
    route("GET", "/api/proactive/noise", () => service().noise()),
  ];
}
