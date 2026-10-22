// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";

export interface RemoteRelayStatusView {
  enabled: boolean;
  connected: boolean;
  url: string | null;
  route: string | null;
  core_public_key: string | null;
  last_error: string | null;
}

/** Session-token routes only: a relay is the owner's choice, never an agent's or a device's. */
export interface RemoteRelayApi {
  status(): RemoteRelayStatusView;
  enable(input: unknown): Promise<RemoteRelayStatusView>;
  disable(): Promise<RemoteRelayStatusView>;
  pushApprovals(deviceId: string): Promise<void>;
}

export function remoteRelayRoutes(service: RemoteRelayApi): Route[] {
  return [
    route("GET", "/api/remote-relay", () => service.status()),
    route("POST", "/api/remote-relay", async ({ body }) =>
      service.enable(expectObject(await body())),
    ),
    route("DELETE", "/api/remote-relay", () => service.disable()),
    route("POST", "/api/remote-relay/devices/:id/approvals", async ({ params }) => {
      const id = params.id ?? "";
      if (!/^dev_[0-9a-f]{12}$/.test(id))
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Not a device id");
      await service.pushApprovals(id);
      return { pushed: true };
    }),
  ];
}
