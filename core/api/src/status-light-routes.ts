// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { HueBridge, HueLightInfo } from "../../runtime/src/status-lights/hue";
import type { LifxDiscovered, ProvisionedLight } from "../../runtime/src/status-lights/provision";
import { expectObject, route, type Route } from "./http";

/**
 * Session-token routes only. Provisioning says where a light is; consent to use it is the
 * `devices` setting of the status-lights capability, which these routes never touch.
 * No route returns, echoes or lists a Hue application key or a Luxafor token: they are write-only.
 */
export interface StatusLightsApi {
  lights(): ProvisionedLight[];
  setLights(input: unknown): Promise<ProvisionedLight[]>;
  setLuxaforToken(id: string, token: unknown): Promise<void>;
  discoverLifx(input: unknown): Promise<LifxDiscovered[]>;
  hue: {
    bridges(): HueBridge[];
    inspect(input: unknown): Promise<{
      address: string;
      port: number;
      fingerprint: string;
      common_name: string | null;
    }>;
    pair(input: unknown): Promise<HueBridge>;
    lights(bridgeId: string): Promise<HueLightInfo[]>;
    remove(bridgeId: string): Promise<void>;
  };
}

export function statusLightRoutes(service: StatusLightsApi): Route[] {
  return [
    route("GET", "/api/status-lights/devices", () => ({ lights: service.lights() })),
    route("PUT", "/api/status-lights/devices", async ({ body }) => ({
      lights: await service.setLights(expectObject(await body())),
    })),
    route("POST", "/api/status-lights/lifx/discover", async ({ body }) => ({
      lights: await service.discoverLifx(expectObject(await body())),
    })),
    route("PUT", "/api/status-lights/luxafor/:id/token", async ({ params, body }) => {
      await service.setLuxaforToken(params.id!, expectObject(await body()).token);
      return { stored: true };
    }),
    route("GET", "/api/status-lights/hue/bridges", () => ({ bridges: service.hue.bridges() })),
    route("POST", "/api/status-lights/hue/inspect", async ({ body }) =>
      service.hue.inspect(expectObject(await body())),
    ),
    route("POST", "/api/status-lights/hue/bridges", async ({ body }) => ({
      bridge: await service.hue.pair(expectObject(await body())),
    })),
    route("GET", "/api/status-lights/hue/bridges/:id/lights", async ({ params }) => ({
      lights: await service.hue.lights(params.id!),
    })),
    route("DELETE", "/api/status-lights/hue/bridges/:id", async ({ params }) => {
      await service.hue.remove(params.id!);
      return { removed: true };
    }),
  ];
}
