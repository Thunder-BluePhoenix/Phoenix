// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What Core lends the status-lights capability: the provisioned lights, the event bus the lights
// follow, and Focus mode (so a lit light goes dark while Focus is on and returns when it ends).
import type { StatusFeed, StatusLightsOptions } from "@phoenix/capability-status-lights";
import type { FocusController, FocusNotification } from "../focus";
import type { StatusLightProvisioning } from "./provision";

export interface StatusLightsRuntime {
  readonly statusLights: Pick<StatusLightProvisioning, "devices">;
  readonly bus: StatusFeed;
  readonly focus: Pick<FocusController<FocusNotification>, "snapshot" | "subscribe">;
}

/** Read at each use, so `runtime` may be assigned after the capabilities are built. */
export function statusLightsHost(runtime: () => StatusLightsRuntime): StatusLightsOptions {
  return {
    devices: () => runtime().statusLights.devices(),
    feed: () => runtime().bus,
    focusMode: () => runtime().focus.snapshot().active,
    focusChanges: (listener) => runtime().focus.subscribe(listener),
  };
}
