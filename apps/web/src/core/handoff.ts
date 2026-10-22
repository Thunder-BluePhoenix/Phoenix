// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// Wire types of the /api/handoff and /api/secret-guard routes (see core/api/src/handoff-routes.ts),
// the pure helpers the Settings section uses and the hooks that load them. Every body is read
// defensively: a Core version that omits a field, or an event that arrives early, never crashes the page.
import { useCallback, useEffect, useRef, useState } from "react";
import { useT, type MessageKey } from "../i18n";
import { ApiError } from "./client";
import { useClient } from "./context";

/** Where an attached note goes. Only `task` can be written by Phoenix (an existing GitHub command). */
export type HandoffTarget = "commit_message" | "pr_description" | "task";

export interface HandoffFileView {
  path: string;
  added: number;
  removed: number;
  edits: number;
}

export interface HandoffSummaryView {
  text: string;
  provider: string;
  model: string;
  locality: "local" | "cloud";
  processed_by: string;
  at: string;
}

export interface HandoffNoteView {
  id: string;
  created_at: string;
  agent: string;
  session_id: string;
  project: string;
  trigger: "auto" | "user";
  goal: string | null;
  files: HandoffFileView[];
  files_total: number;
  added: number;
  removed: number;
  commands: string[];
  commands_total: number;
  open_questions: string[];
  steps_total: number;
  dropped_steps: number;
  generated_by: "rules";
  summary: HandoffSummaryView | null;
}

export interface HandoffNoteDetailView extends HandoffNoteView {
  text: string;
}

export interface HandoffSettingsView {
  auto: boolean;
  allow_cloud: boolean;
}

export interface HandoffAttachPreviewView {
  mode: "preview";
  target: HandoffTarget;
  delivery: "copy" | "github_issue";
  wired: boolean;
  title?: string;
  text: string;
  hash: string;
  notes: string[];
}

export interface HandoffAttachAppliedView {
  mode: "applied";
  target: HandoffTarget;
  delivery: "copy" | "github_issue";
  text: string;
  copy_only: boolean;
  issue?: { repository: string; number: number; url: string; status: "created" | "existing" };
}

export interface SecretGuardFindingView {
  kind: string;
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
  allowed: number;
  blocked: number;
  overridden: number;
  since: string | null;
  recent: SecretGuardRecentView[];
}

/** The same shape Core accepts for the `task` target's `owner/name`. */
export const REPOSITORY_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

/** The targets a note can be attached to, in display order, with their label keys. */
export const HANDOFF_TARGETS = [
  ["commit_message", "handoff.attach.target.commit_message"],
  ["pr_description", "handoff.attach.target.pr_description"],
  ["task", "handoff.attach.target.task"],
] as const satisfies readonly (readonly [HandoffTarget, MessageKey])[];

export function outcomeKey(outcome: SecretGuardRecentView["outcome"]): MessageKey {
  return outcome === "overridden"
    ? "handoff.guard.outcome.overridden"
    : "handoff.guard.outcome.blocked";
}

/** The sentence that tells the user what confirming a preview will do. */
export function deliveryKey(preview: HandoffAttachPreviewView): MessageKey {
  if (preview.delivery === "github_issue" && preview.wired) return "handoff.attach.delivery.issue";
  return preview.target === "pr_description"
    ? "handoff.attach.delivery.copyPr"
    : "handoff.attach.delivery.copy";
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const records = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isRecord) : []);

const isTarget = (value: unknown): value is HandoffTarget =>
  value === "commit_message" || value === "pr_description" || value === "task";

function readSummary(raw: unknown): HandoffSummaryView | null {
  if (!isRecord(raw) || !str(raw.text)) return null;
  return {
    text: str(raw.text),
    provider: str(raw.provider),
    model: str(raw.model),
    locality: raw.locality === "cloud" ? "cloud" : "local",
    processed_by: str(raw.processed_by),
    at: str(raw.at),
  };
}

export function readNote(raw: unknown): HandoffNoteView | null {
  if (!isRecord(raw) || !str(raw.id)) return null;
  const files = records(raw.files).map((f) => ({
    path: str(f.path),
    added: num(f.added),
    removed: num(f.removed),
    edits: num(f.edits),
  }));
  const commands = strings(raw.commands);
  return {
    id: str(raw.id),
    created_at: str(raw.created_at),
    agent: str(raw.agent),
    session_id: str(raw.session_id),
    project: str(raw.project),
    trigger: raw.trigger === "user" ? "user" : "auto",
    goal: typeof raw.goal === "string" ? raw.goal : null,
    files,
    files_total: typeof raw.files_total === "number" ? num(raw.files_total) : files.length,
    added: num(raw.added),
    removed: num(raw.removed),
    commands,
    commands_total:
      typeof raw.commands_total === "number" ? num(raw.commands_total) : commands.length,
    open_questions: strings(raw.open_questions),
    steps_total: num(raw.steps_total),
    dropped_steps: num(raw.dropped_steps),
    generated_by: "rules",
    summary: readSummary(raw.summary),
  };
}

export function readNoteDetail(raw: unknown): HandoffNoteDetailView | null {
  const note = readNote(raw);
  return note && isRecord(raw) ? { ...note, text: str(raw.text) } : null;
}

export function readSettings(raw: unknown): HandoffSettingsView {
  const body = isRecord(raw) ? raw : {};
  return {
    auto: typeof body.auto === "boolean" ? body.auto : true,
    allow_cloud: body.allow_cloud === true,
  };
}

export function readPreview(raw: unknown): HandoffAttachPreviewView | null {
  if (!isRecord(raw) || raw.mode !== "preview" || !isTarget(raw.target) || !str(raw.hash)) {
    return null;
  }
  return {
    mode: "preview",
    target: raw.target,
    delivery: raw.delivery === "github_issue" ? "github_issue" : "copy",
    wired: raw.wired === true,
    ...(typeof raw.title === "string" ? { title: raw.title } : {}),
    text: str(raw.text),
    hash: str(raw.hash),
    notes: strings(raw.notes),
  };
}

export function readApplied(raw: unknown): HandoffAttachAppliedView | null {
  if (!isRecord(raw) || raw.mode !== "applied" || !isTarget(raw.target)) return null;
  const issue = isRecord(raw.issue)
    ? {
        repository: str(raw.issue.repository),
        number: num(raw.issue.number),
        url: str(raw.issue.url),
        status: raw.issue.status === "existing" ? ("existing" as const) : ("created" as const),
      }
    : undefined;
  return {
    mode: "applied",
    target: raw.target,
    delivery: raw.delivery === "github_issue" ? "github_issue" : "copy",
    text: str(raw.text),
    copy_only: raw.copy_only === true,
    ...(issue ? { issue } : {}),
  };
}

export function readGuard(raw: unknown): SecretGuardStatusView {
  const body = isRecord(raw) ? raw : {};
  return {
    allowed: num(body.allowed),
    blocked: num(body.blocked),
    overridden: num(body.overridden),
    since: typeof body.since === "string" ? body.since : null,
    recent: records(body.recent).map((r) => ({
      at: str(r.at),
      outcome: r.outcome === "overridden" ? "overridden" : "blocked",
      agent: str(r.agent),
      tool: str(r.tool),
      findings: records(r.findings).map((f) => ({ kind: str(f.kind), location: str(f.location) })),
    })),
  };
}

/** Loads `path`, and again when Core announces an event whose type starts with `prefix`. */
function useLiveView<T>(path: string, read: (json: unknown) => T, initial: T, prefix: string) {
  const client = useClient();
  const t = useT();
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const readRef = useRef(read);
  readRef.current = read;
  const tRef = useRef(t);
  tRef.current = t;

  const reload = useCallback(async () => {
    try {
      setData(readRef.current(await client.request<unknown>("GET", path)));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : tRef.current("common.error.coreUnreachable"),
      );
    }
  }, [client, path]);

  useEffect(() => {
    void reload();
    const offEvent = client.eventCreated.on(({ event }) => {
      if (event.event_type.startsWith(prefix)) void reload();
    });
    const offStatus = client.statusChanged.on((s) => s === "online" && void reload());
    return () => {
      offEvent();
      offStatus();
    };
  }, [client, reload, prefix]);

  return { data, error, reload, set: setData };
}

const NO_NOTES: HandoffNoteView[] = [];

const readNotes = (json: unknown): HandoffNoteView[] =>
  isRecord(json) && Array.isArray(json.notes)
    ? json.notes.flatMap((n) => readNote(n) ?? [])
    : NO_NOTES;

/** The saved handoff notes, newest first as Core lists them; re-read on `handoff.note.*` events. */
export function useHandoffNotes() {
  return useLiveView("/api/handoff/notes", readNotes, NO_NOTES, "handoff.note.");
}

/** The handoff settings; null until Core has answered. */
export function useHandoffSettings() {
  return useLiveView<HandoffSettingsView | null>(
    "/api/handoff/settings",
    readSettings,
    null,
    "handoff.settings.",
  );
}

/** The secret guard's counts and recent results; null until Core has answered. */
export function useSecretGuard() {
  return useLiveView<SecretGuardStatusView | null>(
    "/api/secret-guard",
    readGuard,
    null,
    "secret_guard.",
  );
}
