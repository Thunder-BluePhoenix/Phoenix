// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";
import type { CoreServices } from "./services";

/** Where an attached note goes. Only `task` can be written by Phoenix (an existing GitHub command). */
export type HandoffTarget = "commit_message" | "pr_description" | "task";

export interface HandoffFileView {
  /** Relative to the project when inside it; otherwise only the file name. */
  path: string;
  added: number;
  removed: number;
  edits: number;
}

/** A model-written summary of a note. Only ever added when the user asks for it. */
export interface HandoffSummaryView {
  text: string;
  provider: string;
  model: string;
  locality: "local" | "cloud";
  /** "Ollama · llama3.2 · on this device" style label. */
  processed_by: string;
  at: string;
}

/** One handoff note without its rendered text (the list form). */
export interface HandoffNoteView {
  id: string;
  created_at: string;
  agent: string;
  session_id: string;
  /** The project's folder name; a path is never sent. */
  project: string;
  /** `auto`: raised when the agents capability reported the session over; `user`: asked for. */
  trigger: "auto" | "user";
  /** The first task title the agent reported (only when the user allows prompt titles), else null. */
  goal: string | null;
  files: HandoffFileView[];
  files_total: number;
  added: number;
  removed: number;
  /** Redacted, bounded, most recent last. */
  commands: string[];
  commands_total: number;
  open_questions: string[];
  steps_total: number;
  dropped_steps: number;
  generated_by: "rules";
  summary: HandoffSummaryView | null;
}

/** A note with its Markdown text (what is copied and attached). */
export interface HandoffNoteDetailView extends HandoffNoteView {
  text: string;
}

export interface HandoffSettingsView {
  /** Write a deterministic note when a session ends. Default on. */
  auto: boolean;
  /** Allow a model summary to use a cloud provider (still needs the AI settings' own grants). Default off. */
  allow_cloud: boolean;
}

export interface HandoffAttachPreviewView {
  mode: "preview";
  target: HandoffTarget;
  /** `github_issue`: Phoenix writes through the github capability after a second confirmation. `copy`: you paste it yourself. */
  delivery: "copy" | "github_issue";
  /** False when Phoenix has no write command for the target (copy only). */
  wired: boolean;
  /** Issue title; only for the `task` target. */
  title?: string;
  /** Exactly what will be attached or copied. */
  text: string;
  /** SHA-256 the confirmation must repeat. */
  hash: string;
  notes: string[];
}

export interface HandoffAttachAppliedView {
  mode: "applied";
  target: HandoffTarget;
  delivery: "copy" | "github_issue";
  text: string;
  /** The text is for you to paste; Phoenix wrote it nowhere. */
  copy_only: boolean;
  issue?: { repository: string; number: number; url: string; status: "created" | "existing" };
}

/** Handoff notes (Phase 79). Reached only through session-token routes; no capability or tool can call it. */
export interface HandoffApi {
  list(): HandoffNoteView[];
  get(id: string): HandoffNoteDetailView;
  /** Writes a deterministic note for a session Core knows (a live session id or a `ph-` id). */
  generate(body: unknown): Promise<HandoffNoteDetailView>;
  /** Adds a model summary: a local provider only, unless the user allowed cloud for handoffs. */
  summarize(id: string): Promise<HandoffNoteDetailView>;
  /** Without `confirm_hash`: a preview. With it: that exact text, after the user's confirmation. */
  attach(id: string, body: unknown): Promise<HandoffAttachPreviewView | HandoffAttachAppliedView>;
  remove(id: string): void;
  settings(): HandoffSettingsView;
  setSettings(body: unknown): HandoffSettingsView;
}

export interface SecretGuardFindingView {
  /** The pattern kind (for example `github_token`); never the matched text. */
  kind: string;
  /** Where it was found (for example `tool_input.command line 1`); never the matched text. */
  location: string;
}

export interface SecretGuardRecentView {
  at: string;
  outcome: "blocked" | "overridden";
  agent: string;
  tool: string;
  findings: SecretGuardFindingView[];
}

export interface SecretGuardStatusView {
  /**
   * Counted from the audit log: calls the hook let through after scanning a `git commit`/`git push`
   * diff, calls it blocked, and calls it let through after your approval. Ordinary clean tool calls
   * are not reported (that would add a request to every tool call).
   */
  allowed: number;
  blocked: number;
  overridden: number;
  /** The time of the oldest guard record, or null when there is none. */
  since: string | null;
  recent: SecretGuardRecentView[];
}

/** The secret guard's results (Phase 79): counts and kinds only, never content. */
export interface SecretGuardApi {
  status(): SecretGuardStatusView;
  /** What the guard hook reports (`POST /api/secret-guard/result`). Rejects any payload that holds a secret. */
  record(body: unknown): { recorded: true };
}

export function handoffRoutes(s: CoreServices): Route[] {
  const notes = () => {
    if (!s.handoff) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Handoff notes not found");
    return s.handoff;
  };
  const guard = () => {
    if (!s.secretGuard)
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Secret guard not found");
    return s.secretGuard;
  };
  return [
    route("GET", "/api/handoff/notes", () => ({ notes: notes().list() })),
    route("POST", "/api/handoff/notes", async ({ res, body }) => {
      const made = await notes().generate(await body());
      res.statusCode = 201;
      return made;
    }),
    route("GET", "/api/handoff/notes/:id", ({ params }) => notes().get(params.id!)),
    // Whatever a caller sends here is ignored: the only thing it can start is a summary of THIS note.
    route("POST", "/api/handoff/notes/:id/summary", ({ params }) => notes().summarize(params.id!)),
    route("POST", "/api/handoff/notes/:id/attach", async ({ params, body }) =>
      notes().attach(params.id!, await body()),
    ),
    route("DELETE", "/api/handoff/notes/:id", ({ params }) => {
      notes().remove(params.id!);
      return { id: params.id, deleted: true };
    }),
    route("GET", "/api/handoff/settings", () => notes().settings()),
    route("POST", "/api/handoff/settings", async ({ body }) =>
      notes().setSettings(expectObject(await body())),
    ),
    route("GET", "/api/secret-guard", () => guard().status()),
    route("POST", "/api/secret-guard/result", async ({ body }) => guard().record(await body())),
  ];
}
