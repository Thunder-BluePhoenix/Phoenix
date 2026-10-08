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
  config?: Record<string, unknown>;
  config_schema?: JsonSchema;
  secrets?: { name: string; description?: string; set: boolean }[];
  lastError?: string;
  disabledReason?: string;
}

export type ConnectionStatus = "connecting" | "online" | "offline" | "unauthenticated";

/** GET /api/meetings/{id} (Phoenix's record of a Kage meeting). */
export interface Meeting {
  id: string;
  capability_id: string;
  external_id: string;
  title: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  participants: string[] | null;
  recording: { location: string; retention: string } | null;
  has_transcript: boolean;
  has_summary: boolean;
  archived_at: string | null;
  updated_at: string;
}

export interface Transcript {
  text: string;
  segments?: { start_ms: number; end_ms: number; speaker?: string | null; text: string }[];
}

export type ActionItem = string | { text: string; owner?: string | null; due?: string | null };

export interface Summary {
  text: string;
  generated_by?: "ai" | "extractive";
  topics?: string[];
  decisions?: string[];
  action_items?: ActionItem[];
  follow_up_questions?: string[];
}

/** The subset of JSON Schema the settings form understands. */
export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

export type MemorySensitivity = "public" | "internal" | "sensitive";

/** GET /api/memory item: what Core is willing to show about a stored memory (Phase 29). */
export interface MemoryItem {
  id: string;
  text: string;
  layer: string;
  domain: string;
  kind: "fact" | "interpretation";
  source: string;
  source_ref: string | null;
  scope: string;
  sensitivity: MemorySensitivity;
  observed_at: string;
  confidence: number;
  retention_days: number | null;
  expires_at: string | null;
  redacted: boolean;
}

export type MemorySearchHit = MemoryItem & { score: number };

export interface MemoryList {
  items: MemoryItem[];
  total: number;
  counts: Record<string, number>;
  ai: { enabled: boolean };
}

export const MEMORY_LAYERS = ["working", "episodic", "project", "preference"] as const;
export type MemoryLayer = (typeof MEMORY_LAYERS)[number];

/** GET/POST /api/memory/settings. */
export interface MemorySettings {
  retention_days: Record<MemoryLayer, number | null>;
  allow_sensitive_meetings: boolean;
  doc_paths: string[];
  capture_git: boolean;
}

export interface MemoryFact {
  id: string;
  text: string;
  domain: string;
  source: string;
  source_ref: string | null;
  observed_at: string;
  sensitivity: MemorySensitivity;
}

/** POST /api/memory/ask. `facts` are stored data; `interpretation` is generated and never a fact. */
export interface MemoryAnswer {
  facts: MemoryFact[];
  interpretation: string | null;
  processed_by: string | null;
  ai_used: boolean;
  note: string | null;
}

export interface AiProviderStatus {
  id: string;
  label: string;
  locality: "local" | "cloud";
  available: boolean;
  reason: string | null;
}

/** GET /api/ai/status. */
export interface AiStatus {
  enabled: boolean;
  preferred: string | null;
  cloud_opt_in: Record<MemorySensitivity, boolean>;
  external_processing_granted: boolean;
  providers: AiProviderStatus[];
}
