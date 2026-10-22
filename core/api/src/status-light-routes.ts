// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { ProvisionedLight } from "../../runtime/src/status-lights/provision";
import { expectObject, route, type Route } from "./http";

/**
 * Session-token routes only. Provisioning says where a light is; consent to use it is the
 * `devices` setting of the status-lights capability, which these routes never touch.
 */
export interface StatusLightsApi {
  lights(): ProvisionedLight[];
  setLights(input: unknown): ProvisionedLight[];
}

export function statusLightRoutes(service: StatusLightsApi): Route[] {
  return [
    route("GET", "/api/status-lights/devices", () => ({ lights: service.lights() })),
    route("PUT", "/api/status-lights/devices", async ({ body }) => ({
      lights: service.setLights(expectObject(await body())),
    })),
  ];
}
