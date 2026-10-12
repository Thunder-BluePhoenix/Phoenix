// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Evidence } from "@phoenix/protocol";
import type { SpecialistContract } from "./specialists";

/** Caller requests can only narrow the trusted, inherited grant. */
export interface DelegationRequest {
  kind: string;
  input: Record<string, unknown>;
  tools?: readonly string[];
  context?: {
    scopes?: readonly string[];
    domains?: readonly string[];
    maxSensitivity?: SpecialistContract<unknown, unknown>["context"]["maxSensitivity"];
  };
}

export interface DelegationGrant {
  tools: string[];
  context: {
    scopes: string[];
    domains: string[];
    maxSensitivity: "public" | "internal" | "sensitive";
  };
}

export interface DelegationResult<Output = unknown> {
  taskId: string;
  runId: string;
  kind: string;
  output: Output;
  evidence: Evidence[];
  grant: DelegationGrant;
}

export interface DelegationLink {
  parentTaskId: string;
  parentRunId: string;
  childTaskId: string;
  childRunId: string;
  kind: string;
  grant: DelegationGrant;
  status: "running" | "completed" | "failed" | "cancelled";
}

/** Competing assertions are kept separate; a human, not the orchestrator, decides. */
export interface DelegationConflict {
  subject: string;
  children: [string, string];
  conclusions: [string, string];
  evidence: [string[], string[]];
}

export interface DelegationLimits {
  maxDepth: number;
  maxFanout: number;
}
