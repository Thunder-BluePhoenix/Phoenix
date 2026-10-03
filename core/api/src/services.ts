// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { PhoenixConfig } from "@phoenix/config";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { PermissionGateway } from "@phoenix/permissions";
import type { EventStore } from "@phoenix/persistence";
import type { StateEngine } from "@phoenix/state-engine";

/** Capability registry surface used by the API (implemented in Phase 12). */
export interface CapabilityService {
  list(): unknown[];
  enable(id: string): Promise<unknown>;
  disable(id: string): Promise<unknown>;
}

/** Everything the API needs from Phoenix Core. */
export interface CoreServices {
  config: PhoenixConfig;
  logger: Logger;
  bus: EventBus;
  events: EventStore;
  state: StateEngine;
  permissions: PermissionGateway;
  capabilities?: CapabilityService;
  /** Persists the user's sleep preference. */
  setSleeping(sleeping: boolean): void;
  health(): Record<string, unknown>;
}
