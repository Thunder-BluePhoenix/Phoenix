// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { PublishResult } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { CapabilityManifest, NewEvent, Permission } from "@phoenix/protocol";

export type HealthStatus = "unknown" | "healthy" | "degraded" | "unhealthy";

export interface HealthResult {
  status: Exclude<HealthStatus, "unknown">;
  message?: string;
}

/** An event emitted by a capability; `source` is filled in by Phoenix. */
export type CapabilityEventInput = Omit<NewEvent, "source">;

/** What Phoenix hands a builtin capability. */
export interface CapabilityContext {
  readonly id: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly logger: Logger;
  /** Aborted when the capability is disabled. */
  readonly signal: AbortSignal;
  /** Publishes an event as this capability. Only declared event types are accepted. */
  emit(event: CapabilityEventInput): PublishResult;
}

export type CommandHandler = (input: unknown, ctx: CapabilityContext) => unknown | Promise<unknown>;

/**
 * A first-party capability running inside Phoenix Core. Every call into it is
 * guarded (errors contained, timeouts enforced). Untrusted or third-party code
 * should run as an external capability in its own process.
 */
export interface CapabilityModule {
  manifest: CapabilityManifest;
  init?(ctx: CapabilityContext): void | Promise<void>;
  health?(ctx: CapabilityContext): HealthResult | Promise<HealthResult>;
  commands?: Record<string, CommandHandler>;
  shutdown?(ctx: CapabilityContext): void | Promise<void>;
}

export type CapabilityKind = "builtin" | "external";

/**
 * installed    – registered, never enabled (or permissions changed)
 * enabled      – running
 * disabled     – stopped by the user or the kill switch
 * failed       – init / enable failed
 * disconnected – external capability not currently registered with this core process
 */
export type CapabilityStatus = "installed" | "enabled" | "disabled" | "failed" | "disconnected";

export interface CapabilityView {
  id: string;
  name: string;
  version: string;
  description: string;
  license: string;
  kind: CapabilityKind;
  status: CapabilityStatus;
  health: { status: HealthStatus; message?: string; checkedAt?: string };
  permissions: { permission: Permission; description: string; granted: boolean }[];
  commands: { name: string; description: string; side_effect: string }[];
  events: string[];
  data_categories: string[];
  config: Record<string, unknown>;
  lastError?: string;
  disabledReason?: string;
}

export type OperationStatus = "pending" | "running" | "succeeded" | "failed";

export interface Operation {
  id: string;
  capabilityId: string;
  command: string;
  status: OperationStatus;
  createdAt: string;
  updatedAt: string;
  result?: unknown;
  error?: { code: string; message: string; details: readonly string[] };
}
