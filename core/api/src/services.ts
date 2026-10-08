// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { PhoenixConfig } from "@phoenix/config";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { PermissionGateway } from "@phoenix/permissions";
import type { EventStore, MeetingStore } from "@phoenix/persistence";
import type { StateEngine } from "@phoenix/state-engine";

/** Capability registry surface used by the API (implemented by @phoenix/capability-manager). */
export interface CapabilityService {
  list(): unknown[];
  get(id: string): unknown;
  enable(id: string): Promise<unknown>;
  disable(id: string): Promise<unknown>;
  configure(id: string, config: unknown): unknown;
  setSecret(id: string, name: string, value: string): Promise<unknown>;
  deleteSecret(id: string, name: string): Promise<unknown>;
  uninstall(id: string, options: { retainData?: boolean }): Promise<void>;
  invoke(id: string, command: string, input: unknown, actor?: string): unknown;
  operation(id: string): unknown;
  registerExternal(
    manifest: unknown,
    endpoint: string,
    callbackSecret?: string,
  ): Promise<{ capability: unknown; token: string }>;
  ingest(
    id: string,
    token: string | undefined,
    event: unknown,
  ): { ok: true; event: { event_id: string }; seq: number | null } | { ok: false; error: Error };
}

/** Notification surface used by the API (implemented by @phoenix/notifications). */
export interface NotificationsService {
  list(options: { unreadOnly?: boolean; limit?: number }): {
    notifications: unknown[];
    unread: number;
  };
  markRead(id: string): unknown;
  markAllRead(): number;
  preferences(): unknown;
  setPreferences(input: unknown): unknown;
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
  notifications?: NotificationsService;
  meetings?: MeetingStore;
  privacy?: {
    inventory(): unknown;
    retention(): unknown;
    setRetention(input: unknown): unknown;
    deleteAll(kind: unknown, confirm: unknown): unknown;
  };
  petSettings?(): unknown;
  setPetSettings?(input: unknown): unknown;
  /** Persists the user's sleep preference. */
  setSleeping(sleeping: boolean): void;
  health(): Record<string, unknown>;
  /** Support report with no secrets and no meeting content (GET /api/diagnostics). */
  diagnostics?(): unknown;
}
