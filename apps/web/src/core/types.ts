// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Mirrors core's StateSnapshot (GET /api/pet/state). */
export interface PetState {
  state: string;
  explanation: string;
  since: string;
  recording: boolean;
  sleeping: boolean;
  key?: string;
  source?: string;
  conditions?: unknown[];
}

export interface ActiveTask {
  key: string;
  state: string;
  title: string;
  source: string;
  since: string;
  updatedAt: string;
  progress?: number;
}

export interface PhoenixEvent {
  event_id: string;
  event_type: string;
  source: string;
  timestamp: string;
  severity: "info" | "success" | "warning" | "error";
  payload: Record<string, unknown>;
  subject?: string;
  correlation_id?: string;
  requires_action?: boolean;
}

export interface StoredEvent {
  seq: number;
  event: PhoenixEvent;
  /** Human sentence from core, same wording Fawkes uses. */
  description?: string;
}

export interface Notification {
  id: string;
  eventId: string | null;
  eventType: string | null;
  source: string | null;
  severity: PhoenixEvent["severity"];
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

export interface Confirmation {
  id: string;
  capabilityId: string;
  command: string;
  summary: string;
  sideEffect: string;
  permissions: string[];
  requestedAt: string;
  expiresAt: string;
}

export interface CapabilityView {
  id: string;
  name: string;
  version: string;
  description: string;
  kind: "builtin" | "external";
  status: "installed" | "enabled" | "disabled" | "failed" | "disconnected";
  health: { status: "unknown" | "healthy" | "degraded" | "unhealthy"; message?: string };
  permissions: { permission: string; description: string; granted: boolean }[];
  commands: { name: string; description: string; side_effect: string }[];
  data_categories: string[];
  lastError?: string;
  disabledReason?: string;
}

export type ConnectionStatus = "connecting" | "online" | "offline" | "unauthenticated";
