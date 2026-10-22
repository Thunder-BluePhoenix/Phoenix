// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// Wire types of the agent-safety routes (see core/api/src/safety-routes.ts) and the hook the
// Agent safety section uses. Paths and file names inside previews are untrusted text: components
// show them as text only.
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./client";
import { useClient } from "./context";

export type SafetySkipReason =
  | "disabled"
  | "kill_switch"
  | "not_git"
  | "git_unavailable"
  | "too_many_files"
  | "too_large"
  | "throttled"
  | "snapshot_failed";

export interface SafetyCheckpoint {
  id: string;
  agent: string;
  session_id: string;
  repository: string;
  file_count: number;
  created_at: string;
  expires_at: string;
  rolled_back_at: string | null;
}

export interface SafetySkipped {
  agent: string;
  session_id: string;
  repository: string;
  reason: SafetySkipReason;
  at: string;
}

export interface SafetySettings {
  enabled: boolean;
  notify: boolean;
  retention_days: number;
  max_files: number;
  max_bytes: number;
  loop_threshold: number;
  waiting_min: number;
  idle_min: number;
}

export interface SafetyStatus {
  settings: SafetySettings;
  kill_switch: boolean;
  checkpoints: SafetyCheckpoint[];
  skipped: SafetySkipped[];
}

export type SafetyRefusal =
  "repository_missing" | "checkpoint_gone" | "head_moved" | "snapshot_failed";

export interface SafetyPreview {
  checkpoint: SafetyCheckpoint;
  refusal: SafetyRefusal | null;
  preview_hash: string | null;
  restore: { path: string; change: "modified" | "deleted" | "type_changed" }[];
  remove: string[];
  kept: {
    path: string;
    why: "tracked_by_head" | "ignored" | "submodule" | "unsafe_path" | "not_a_file";
  }[];
  counts: { restore: number; remove: number; kept: number };
  lists_truncated: boolean;
  diff: string;
  diff_truncated: boolean;
  diff_redacted: boolean;
}

export interface SafetyRollbackResult {
  checkpoint_id: string;
  restored: number;
  removed: number;
  kept: number;
  exact: boolean;
}

/** A loop or stall warning seen live while the section is open. */
export interface SafetyWarning {
  id: string;
  type: "loop" | "stall";
  agent: string;
  repository: string;
  reason: string;
  at: string;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** The status, kept fresh by the safety events, plus the warnings that arrived while it was open. */
export function useSafetyStatus() {
  const client = useClient();
  const [status, setStatus] = useState<SafetyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<SafetyWarning[]>([]);

  const reload = useCallback(async () => {
    try {
      setStatus(await client.request<SafetyStatus>("GET", "/api/agent-safety"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Phoenix Core is unreachable");
    }
  }, [client]);

  useEffect(() => {
    void reload();
    const offEvent = client.eventCreated.on(({ event }) => {
      if (event.source !== "core") return;
      if (event.event_type === "agent.safety.checkpoint") void reload();
      if (event.event_type === "agent.safety.loop" || event.event_type === "agent.safety.stall") {
        const p = event.payload;
        setWarnings((list) =>
          [
            {
              id: event.event_id,
              type:
                event.event_type === "agent.safety.loop" ? ("loop" as const) : ("stall" as const),
              agent: text(p.agent),
              repository: text(p.repository),
              reason: text(p.reason),
              at: event.timestamp,
            },
            ...list,
          ].slice(0, 10),
        );
      }
    });
    const offStatus = client.statusChanged.on((s) => s === "online" && void reload());
    return () => {
      offEvent();
      offStatus();
    };
  }, [client, reload]);

  return { status, error, reload, warnings };
}
