// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Handoff notes (Phase 79), Core side. A note is built from what an agent REPORTED about a session
// (steps, per-file counts, approvals) by the deterministic generator in ./generate.ts. A model
// summary is optional, on request, and local unless the user allowed cloud for handoffs
// (./summary.ts). Notes live as owner-only files under `<dataDir>/handoff` (./store.ts).
//
// Reached only through session-token routes (core/api/src/handoff-routes.ts); nothing here is a
// capability command or tool, so an agent cannot read, write, attach or delete a note.
//
// Attaching a note: preview, then a confirmation that must repeat the preview's hash.
//   commit message      the text is handed back to be copied; Phoenix never runs `git commit`.
//   pull request text   Phoenix has no command that edits a pull request, so: copy only.
//   task                an existing command: the github capability's `issue.create`, which asks for
//                       its own confirmation through the permission gateway and needs the user's
//                       write token. Nothing else writes anywhere.
import { join } from "node:path";
import type {
  AgentApprovalsApi,
  AgentLiveApi,
  HandoffApi,
  HandoffAttachAppliedView,
  HandoffAttachPreviewView,
  HandoffNoteDetailView,
  HandoffNoteView,
  HandoffSettingsView,
  HandoffTarget,
} from "@phoenix/api";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { AuditLog } from "@phoenix/permissions";
import type { SettingsStore } from "@phoenix/persistence";
import { createEvent, ErrorCode, PhoenixError, type PhoenixEvent } from "@phoenix/protocol";
import {
  assertNoSecret,
  attachHash,
  attachText,
  HANDOFF_TARGETS,
  issueKey,
  issueTitle,
  REPOSITORY,
} from "./attach";
import { buildNote, cleanLine, withText } from "./generate";
import { HandoffStore, NOTE_ID } from "./store";
import { summariseNote, type SummaryAi } from "./summary";

export const SETTINGS_KEY = "handoff.settings";
const DEFAULT_SETTINGS: HandoffSettingsView = { auto: true, allow_cloud: false };
/** Sessions whose first task title is remembered, so a note can name its goal. */
const MAX_GOALS = 200;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const AGENT_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const HISTORY_ROWS = 200;

/** What `issue.create` returns (capabilities/github/src/issues.ts IssueResult). */
export interface CreatedIssue {
  status: "created" | "existing";
  repository: string;
  number: number;
  url: string;
}

export interface HandoffDeps {
  dataDir: string;
  settings: SettingsStore;
  bus: EventBus;
  audit: AuditLog;
  logger: Logger;
  live: Pick<AgentLiveApi, "session">;
  approvals: Pick<AgentApprovalsApi, "list" | "history">;
  ai: SummaryAi;
  /** `github.issue.create` through the capability path (asks for its own confirmation). */
  createIssue(input: {
    repository: string;
    title: string;
    body: string;
    idempotency_key: string;
  }): Promise<CreatedIssue>;
  isKillSwitchEngaged: () => boolean;
  now?: () => number;
}

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);
const notFound = () => new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Handoff note not found");

function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw invalid("Body must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw invalid(`Unknown field "${key.slice(0, 40)}"`);
  }
  return value as Record<string, unknown>;
}

export class HandoffNotes implements HandoffApi {
  readonly store: HandoffStore;
  private readonly now: () => number;
  private readonly goals = new Map<string, string>();
  /** The step count a session's last automatic note covered, so an unchanged session is not noted twice. */
  private readonly autoDone = new Map<string, number>();
  private readonly unsubscribe: () => void;

  constructor(private readonly d: HandoffDeps) {
    this.now = d.now ?? Date.now;
    this.store = new HandoffStore(join(d.dataDir, "handoff"));
    this.unsubscribe = d.bus.subscribe("handoff-notes", "agent.*", (event) =>
      this.onAgentEvent(event),
    );
  }

  close(): void {
    this.unsubscribe();
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  settings(): HandoffSettingsView {
    const saved = this.d.settings.get<Partial<HandoffSettingsView>>(SETTINGS_KEY, {});
    return {
      auto: typeof saved.auto === "boolean" ? saved.auto : DEFAULT_SETTINGS.auto,
      allow_cloud:
        typeof saved.allow_cloud === "boolean" ? saved.allow_cloud : DEFAULT_SETTINGS.allow_cloud,
    };
  }

  setSettings(body: unknown): HandoffSettingsView {
    const input = object(body, ["auto", "allow_cloud"]);
    const next = this.settings();
    for (const key of ["auto", "allow_cloud"] as const) {
      const value = input[key];
      if (value === undefined) continue;
      if (typeof value !== "boolean") throw invalid(`"${key}" must be true or false`);
      next[key] = value;
    }
    this.d.settings.set(SETTINGS_KEY, next);
    this.d.audit.record({
      actor: "user",
      action: "handoff.settings.changed",
      capabilityId: "handoff",
      decision: "info",
      details: { ...next },
    });
    return next;
  }

  // ── Notes ─────────────────────────────────────────────────────────────────

  list(): HandoffNoteView[] {
    return this.store.list();
  }

  get(id: string): HandoffNoteDetailView {
    const note = this.store.get(id);
    if (!note) throw notFound();
    return withText(note);
  }

  remove(id: string): void {
    if (!this.store.remove(id)) throw notFound();
    this.publish("handoff.note.deleted", { id });
  }

  deleteAll(): { deleted: number } {
    const deleted = this.store.deleteAll();
    if (deleted > 0) this.publish("handoff.note.deleted", {});
    return { deleted };
  }

  async generate(body: unknown): Promise<HandoffNoteDetailView> {
    const input = object(body, ["session_id", "agent"]);
    const sessionId = input.session_id;
    if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId))
      throw invalid('"session_id" must be a session id');
    if (
      input.agent !== undefined &&
      (typeof input.agent !== "string" || !AGENT_SLUG.test(input.agent))
    )
      throw invalid('"agent" must be an agent name');
    if (this.d.isKillSwitchEngaged())
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");
    const note = await this.build(sessionId, "user", input.agent);
    if (!note) throw notFound();
    return withText(note);
  }

  /** Builds and stores a note for a live or `ph-` session; null when it has nothing to report. */
  private async build(
    sessionId: string,
    trigger: "auto" | "user",
    agentHint?: string,
  ): Promise<HandoffNoteView | null> {
    let detail;
    try {
      detail = await this.d.live.session(sessionId);
    } catch {
      return null;
    }
    const first = detail.sessions[0];
    const stepsTotal = detail.sessions.reduce((n, s) => n + s.step_count, 0);
    if (!first || (stepsTotal === 0 && detail.files.length === 0)) return null;
    const agent = agentHint ?? first.agent;
    const body = buildNote({
      agent,
      sessionId,
      project: first.project,
      trigger,
      goal: this.goals.get(`${agent}:${sessionId}`),
      detail,
      stepsTotal,
      firstSeenMs: Math.min(...detail.sessions.map((s) => Date.parse(s.first_seen))),
      lastSeenMs: Math.max(...detail.sessions.map((s) => Date.parse(s.last_seen))),
      pending: this.d.approvals.list(),
      history: this.d.approvals.history(HISTORY_ROWS),
    });
    const at = this.now();
    const note: HandoffNoteView = {
      id: this.store.newId(at),
      created_at: new Date(at).toISOString(),
      ...body,
      generated_by: "rules",
      summary: null,
    };
    this.store.put(note);
    this.d.audit.record({
      actor: trigger === "auto" ? "core" : "user",
      action: "handoff.note.created",
      capabilityId: "handoff",
      decision: "info",
      details: { id: note.id, trigger, agent: note.agent, files: note.files_total },
    });
    this.publish("handoff.note.created", { id: note.id });
    return note;
  }

  async summarize(id: string): Promise<HandoffNoteDetailView> {
    const note = this.store.get(id);
    if (!note) throw notFound();
    if (this.d.isKillSwitchEngaged())
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");
    const { allow_cloud } = this.settings();
    const summary = await summariseNote(this.d.ai, withText({ ...note, summary: null }).text, {
      allowCloud: allow_cloud,
      now: this.now,
    });
    const updated = { ...note, summary };
    this.store.put(updated);
    this.d.audit.record({
      actor: "user",
      action: "handoff.summary.created",
      capabilityId: "handoff",
      decision: "info",
      details: { id, provider: summary.provider, locality: summary.locality },
    });
    this.publish("handoff.note.updated", { id });
    return withText(updated);
  }

  // ── Attach ────────────────────────────────────────────────────────────────

  async attach(
    id: string,
    body: unknown,
  ): Promise<HandoffAttachPreviewView | HandoffAttachAppliedView> {
    const input = object(body, ["target", "repository", "confirm_hash"]);
    const note = this.store.get(id);
    if (!note) throw notFound();
    const target = input.target;
    if (typeof target !== "string" || !(HANDOFF_TARGETS as readonly string[]).includes(target))
      throw invalid(`"target" must be one of ${HANDOFF_TARGETS.join(", ")}`);
    const kind = target as HandoffTarget;
    let repository: string | undefined;
    if (kind === "task") {
      if (typeof input.repository !== "string" || !REPOSITORY.test(input.repository))
        throw invalid('"repository" must be "owner/name"');
      repository = input.repository;
    } else if (input.repository !== undefined) {
      throw invalid('"repository" is only for the task target');
    }
    const title = kind === "task" ? issueTitle(note) : undefined;
    const text = attachText(note, kind);
    assertNoSecret(text, title);
    const hash = attachHash({ noteId: id, target: kind, repository, title, text });

    if (input.confirm_hash === undefined) {
      return {
        mode: "preview",
        target: kind,
        delivery: kind === "task" ? "github_issue" : "copy",
        wired: kind === "task",
        ...(title === undefined ? {} : { title }),
        text,
        hash,
        notes: previewNotes(kind),
      };
    }
    if (typeof input.confirm_hash !== "string" || !/^[0-9a-f]{64}$/.test(input.confirm_hash))
      throw invalid('"confirm_hash" must be the hash from the preview');
    if (input.confirm_hash !== hash)
      throw new PhoenixError(
        ErrorCode.ACTION_REQUIRES_CONFIRMATION,
        "The note changed after the preview; preview it again",
      );
    if (this.d.isKillSwitchEngaged())
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");

    if (kind !== "task") {
      this.d.audit.record({
        actor: "user",
        action: "handoff.note.attached",
        capabilityId: "handoff",
        decision: "allowed",
        details: { id, target: kind, delivery: "copy" },
      });
      return { mode: "applied", target: kind, delivery: "copy", text, copy_only: true };
    }
    // The github capability asks for its own confirmation before it writes; a refusal throws.
    const issue = await this.d.createIssue({
      repository: repository!,
      title: title!,
      body: text,
      idempotency_key: issueKey(id),
    });
    this.d.audit.record({
      actor: "user",
      action: "handoff.note.attached",
      capabilityId: "handoff",
      decision: "allowed",
      details: { id, target: kind, delivery: "github_issue", repository, number: issue.number },
    });
    return {
      mode: "applied",
      target: kind,
      delivery: "github_issue",
      text,
      copy_only: false,
      issue: {
        repository: issue.repository,
        number: issue.number,
        url: issue.url,
        status: issue.status,
      },
    };
  }

  // ── Automatic notes ───────────────────────────────────────────────────────

  private onAgentEvent(event: PhoenixEvent): void {
    // Only the `agents` capability's own events name a session: anything else with the same
    // type and payload (another source) must not plant a goal that ends up in a note.
    if (event.source !== "agents") return;
    const payload = event.payload;
    const agent = payload.agent;
    const sessionId = payload.agent_id;
    if (typeof agent !== "string" || typeof sessionId !== "string") return;
    const key = `${agent}:${sessionId}`;
    const task = payload.task;
    if (typeof task === "string" && task !== "" && !this.goals.has(key)) {
      this.goals.set(key, cleanLine(task, 120));
      if (this.goals.size > MAX_GOALS) this.goals.delete(this.goals.keys().next().value!);
    }
    // The session is over when the agents capability says `ended` (an agent's SessionEnd, or the
    // capability expiring a silent session). `completed` is one turn, not the end of the work.
    if (event.event_type !== "agent.ended") return;
    if (!this.settings().auto || this.d.isKillSwitchEngaged()) return;
    void this.auto(sessionId, agent, key);
  }

  private async auto(sessionId: string, agent: string, key: string): Promise<void> {
    try {
      if (!SESSION_ID.test(sessionId)) return;
      const detail = await this.d.live.session(sessionId).catch(() => null);
      const steps = detail?.sessions.reduce((n, s) => n + s.step_count, 0) ?? 0;
      if (this.autoDone.get(key) === steps) return;
      const note = await this.build(sessionId, "auto", agent);
      if (note) {
        this.autoDone.set(key, steps);
        if (this.autoDone.size > MAX_GOALS)
          this.autoDone.delete(this.autoDone.keys().next().value!);
      }
    } catch (err) {
      this.d.logger.warn("handoff: could not write a note", {
        error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
    }
  }

  private publish(type: string, payload: Record<string, unknown>): void {
    const result = this.d.bus.publish(
      createEvent({ event_type: type, source: "core", severity: "info", payload }),
      { ephemeral: true },
    );
    if (!result.ok) this.d.logger.warn("handoff event rejected", { code: result.error.code });
  }
}

function previewNotes(target: HandoffTarget): string[] {
  if (target === "commit_message")
    return ["Phoenix never runs git commit for you. Confirming gives you this text to paste."];
  if (target === "pr_description")
    return [
      "Phoenix has no command that edits a pull request description yet. Confirming gives you this text to paste; nothing is written to GitHub.",
    ];
  return [
    "Phoenix creates one GitHub issue with the github capability. It asks you to confirm again, needs the capability's write token, and creating it twice returns the same issue.",
  ];
}

export { NOTE_ID };
