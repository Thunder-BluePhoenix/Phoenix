// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";
import type { CoreServices } from "./services";

export type SafetySkipReason =
  | "disabled"
  | "kill_switch"
  | "not_git"
  | "git_unavailable"
  | "too_many_files"
  | "too_large"
  | "throttled"
  | "snapshot_failed";

export interface SafetyCheckpointView {
  id: string;
  agent: string;
  session_id: string;
  /** The project's folder name, never its path. */
  repository: string;
  file_count: number;
  created_at: string;
  expires_at: string;
  rolled_back_at: string | null;
}

/** A session in which an edit was seen but no checkpoint could be taken. */
export interface SafetySkippedView {
  agent: string;
  session_id: string;
  repository: string;
  reason: SafetySkipReason;
  at: string;
}

export interface SafetySettingsView {
  enabled: boolean;
  /** Notify when Fawkes warns about a loop or a stall (the warning itself is always raised). */
  notify: boolean;
  retention_days: number;
  max_files: number;
  max_bytes: number;
  loop_threshold: number;
  waiting_min: number;
  idle_min: number;
}

export interface SafetyStatusView {
  settings: SafetySettingsView;
  kill_switch: boolean;
  checkpoints: SafetyCheckpointView[];
  skipped: SafetySkippedView[];
}

export type SafetyRefusal =
  "repository_missing" | "checkpoint_gone" | "head_moved" | "snapshot_failed";

export interface SafetyRestoreView {
  path: string;
  change: "modified" | "deleted" | "type_changed";
}
export interface SafetyKeptView {
  path: string;
  why: "tracked_by_head" | "ignored" | "submodule" | "unsafe_path" | "not_a_file";
}

/** What a rollback would do right now. `refusal` set = it would be refused and nothing is offered. */
export interface SafetyPreviewView {
  checkpoint: SafetyCheckpointView;
  refusal: SafetyRefusal | null;
  /** Bound into the approval: the rollback refuses unless the tree still produces this hash. */
  preview_hash: string | null;
  restore: SafetyRestoreView[];
  /** New files (untracked, not ignored) that the rollback would delete. */
  remove: string[];
  /** Differences the rollback leaves alone, with the reason. */
  kept: SafetyKeptView[];
  counts: { restore: number; remove: number; kept: number };
  /** Lists are cut at this many entries; counts stay exact. */
  lists_truncated: boolean;
  diff: string;
  diff_truncated: boolean;
  /** Something in the diff text was masked as a probable secret. */
  diff_redacted: boolean;
}

export interface SafetyRollbackView {
  checkpoint_id: string;
  restored: number;
  removed: number;
  kept: number;
  /** After the rollback the tree equals the checkpoint's. */
  exact: boolean;
}

/** Agent safety net (Phase 77): checkpoints, rollback with approval, loop and stall settings. */
export interface SafetyApi {
  status(): Promise<SafetyStatusView>;
  configure(body: unknown): SafetyStatusView;
  preview(id: string): Promise<SafetyPreviewView>;
  rollback(id: string, body: unknown): Promise<SafetyRollbackView>;
}

export function safetyRoutes(s: CoreServices): Route[] {
  const safety = () => {
    if (!s.agentSafety)
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "The agent safety net is unavailable",
      );
    return s.agentSafety;
  };
  return [
    route("GET", "/api/agent-safety", () => safety().status()),
    route("POST", "/api/agent-safety/settings", async ({ body }) =>
      safety().configure(expectObject(await body())),
    ),
    route("GET", "/api/agent-safety/checkpoints/:id/preview", ({ params }) =>
      safety().preview(params.id!),
    ),
    // Waits for the owner's approval (the confirmation card), like other approved actions.
    route("POST", "/api/agent-safety/checkpoints/:id/rollback", async ({ params, body }) =>
      safety().rollback(params.id!, expectObject(await body())),
    ),
  ];
}
