// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";
import type { CoreServices } from "./services";

export type LiveStepKind = "read" | "edit" | "run" | "other";

export interface LiveStepView {
  n: number;
  at: string;
  kind: LiveStepKind;
  tool: string;
  target: string;
}

export interface LiveFileView {
  path: string;
  added: number;
  removed: number;
  edits: number;
  last_at: string;
}

export interface LiveSessionView {
  id: string;
  agent: string;
  project: string;
  repository: string;
  first_seen: string;
  last_seen: string;
  active: boolean;
  step_count: number;
  dropped_steps: number;
  has_terminal: boolean;
}

export interface LiveSessionDetailView {
  id: string;
  /** `id`: the id is a live session's own; `folder+time`: a `ph-…` session and the live sessions in its folder while it ran. */
  matched_by: "id" | "folder+time";
  sessions: LiveSessionView[];
  steps: (LiveStepView & { session_id: string })[];
  files: (LiveFileView & { session_id: string })[];
  dropped_steps: number;
}

export interface LiveDiffLinkView {
  ref: string;
  repo: string;
  confidence: string;
  created_at: string;
  conclusion?: string;
}

export interface LiveDiffView {
  session_id: string;
  path: string;
  diff: string;
  truncated: boolean;
  /** Some text was masked as a probable secret. A heuristic: not a promise that none is left. */
  redacted: boolean;
  source: "git diff HEAD" | "untracked file";
  commits: LiveDiffLinkView[];
  ci_runs: LiveDiffLinkView[];
}

export interface LiveUsageView {
  agent: string;
  window: "5h" | "weekly";
  used_pct: number;
  resets_at: string;
  observed_at: string;
  level: "ok" | "warn" | "critical";
  stale: boolean;
  reset_credits?: number;
}

export interface LiveUsageSummaryView {
  usage: LiveUsageView[];
  thresholds: number[];
  unsupported: { agent: string; reason: string }[];
}

/**
 * Live coding-agent sessions (Phase 58): steps, changed files, on-demand diffs, jumping to the
 * agent's terminal window, plan usage, and a Markdown export. Reached only through session-token
 * routes (or the Phase 57 relay's `step`/`usage` ops); none of it is a capability command or tool.
 */
export interface AgentLiveApi {
  recordStep(body: unknown): { accepted: true; n: number };
  recordUsage(body: unknown): { accepted: number };
  setThresholds(body: unknown): { thresholds: number[] };
  sessions(): LiveSessionView[];
  session(id: string): Promise<LiveSessionDetailView>;
  diff(id: string, path: string): Promise<LiveDiffView>;
  /** Blocks until the user confirms, then brings the terminal window to the front. */
  focusTerminal(id: string): Promise<{ focused: true; method: string }>;
  exportMarkdown(id: string): Promise<string>;
  usage(): LiveUsageSummaryView;
}

export function agentLiveRoutes(s: CoreServices): Route[] {
  const live = () => {
    if (!s.agentLive)
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Agent sessions not found");
    return s.agentLive;
  };
  return [
    route("POST", "/api/agent/live/step", async ({ body }) => live().recordStep(await body())),
    route("POST", "/api/agent/live/usage", async ({ body }) => live().recordUsage(await body())),
    route("GET", "/api/agent/sessions", () => ({ sessions: live().sessions() })),
    route("GET", "/api/agent/sessions/:id", ({ params }) => live().session(params.id!)),
    route("GET", "/api/agent/sessions/:id/diff/:path", ({ params }) =>
      live().diff(params.id!, params.path!),
    ),
    // Whatever the caller sends is ignored: the target is the session's, never the request's.
    route("POST", "/api/agent/sessions/:id/focus-terminal", ({ params }) =>
      live().focusTerminal(params.id!),
    ),
    route("GET", "/api/agent/sessions/:id/export.md", async ({ params, res }) => {
      const markdown = await live().exportMarkdown(params.id!);
      res.writeHead(200, {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-disposition": 'attachment; filename="agent-session.md"',
      });
      res.end(markdown);
      return undefined;
    }),
    route("GET", "/api/agent/usage", () => live().usage()),
    route("POST", "/api/agent/usage/settings", async ({ body }) =>
      live().setThresholds(expectObject(await body())),
    ),
  ];
}
