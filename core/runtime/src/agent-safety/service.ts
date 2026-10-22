// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The agent safety net (Phase 77), Core side. It listens to the events Core already publishes:
//   agent.session.step                  -> first edit of a session => checkpoint; every step => loop detectors
//   agent.approval.requested / resolved -> the agent waits on the user / is moving again
//   agent.waiting / working / completed / failed / ended (from the `agents` capability)
// and raises `agent.safety.loop` / `agent.safety.stall` WARNING events. Rollback goes through the
// permission gateway as an `execute` action; docs/agent-safety-net.md is the contract.
//
// WHEN a checkpoint is taken: a Claude Code step is reported by its PostToolUse hook, i.e. AFTER the
// tool ran (capabilities/agents/src/claude-hook.ts maps PostToolUse; PreToolUse is only used for
// AskUserQuestion approvals). So the snapshot is "taken at the first report of an edit" and the
// first edit itself is normally already in it. Rolling back to it undoes everything the agent did
// AFTER its first edit, not the first edit.
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import type {
  SafetyApi,
  SafetyCheckpointView,
  SafetyPreviewView,
  SafetyRollbackView,
  SafetySettingsView,
  SafetySkippedView,
  SafetyStatusView,
} from "@phoenix/api";
import { redactSecrets } from "@phoenix/capability-agents";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { NotificationService } from "@phoenix/notifications";
import type { PermissionGateway } from "@phoenix/permissions";
import {
  CheckpointStore,
  type CheckpointRow,
  type Database,
  type SettingsStore,
} from "@phoenix/persistence";
import { createEvent, ErrorCode, PhoenixError, type PhoenixEvent } from "@phoenix/protocol";
import type { MappingRule } from "@phoenix/state-engine";
import {
  CHECKPOINT_ID_PATTERN,
  createCheckpoint,
  deleteCheckpointRef,
  findRoot,
  refOf,
  type CheckpointLimits,
  type SkipReason,
} from "./checkpoints";
import { FileDeltas, SafetyDetectors, type Finding, type StepObservation } from "./detectors";
import { safetyGit, type SafetyGit } from "./git";
import {
  applyRollback,
  diffPreview,
  listed,
  planRollback,
  type PlanRefusal,
  type RollbackPlan,
} from "./rollback";
import {
  applySettings,
  detectorSettings,
  readSettings,
  SAFETY_SETTINGS_KEY,
  SAFETY_SOURCE,
  type SafetySettings,
} from "./settings";

export const SAFETY_CAPABILITY = "agent-safety";
export const ROLLBACK_COMMAND = "checkpoint.rollback";
const ORPHANS_KEY = "agents.safety.orphans";
const MAX_ORPHANS = 500;
const MAX_SKIPPED = 50;
const MAX_META = 200;
const MAX_DECIDED = 1_000;
const CHECK_EVERY_MS = 15_000;
const PREVIEW_HASH = /^[0-9a-f]{64}$/;
/** Checkpoints kept at once (oldest pruned first) and the shortest gap between two in one project. */
export const DEFAULT_MAX_CHECKPOINTS = 50;
export const CHECKPOINT_MIN_GAP_MS = 60_000;
const MAX_THROTTLE_KEYS = 500;

/** Event types this service reads. Listed exactly, so it never sees `agent.usage.*` or others. */
const WATCHED = [
  "agent.session.step",
  "agent.approval.requested",
  "agent.approval.resolved",
  "agent.waiting",
  "agent.working",
  "agent.completed",
  "agent.failed",
  "agent.ended",
] as const;

/** Wording of the pet's state and of the notification (the reason is already plain language). */
export const SAFETY_STATE_RULES: readonly MappingRule[] = [
  {
    match: "agent.safety.loop",
    group: "agent.safety",
    effect: { state: "WARNING", explain: "{payload.reason}", ttlMs: 10 * 60_000 },
  },
  {
    match: "agent.safety.stall",
    group: "agent.safety",
    effect: { state: "WARNING", explain: "{payload.reason}", ttlMs: 10 * 60_000 },
  },
];

export interface AgentSafetyDeps {
  db: Database;
  settings: SettingsStore;
  bus: EventBus;
  permissions: Pick<PermissionGateway, "authorize" | "recordOutcome" | "isKillSwitchEngaged">;
  notifications: Pick<NotificationService, "preferences" | "setPreferences">;
  state: { addRules(rules: readonly MappingRule[]): void };
  logger: Logger;
  now?: () => number;
  /** Tests inject a fake; the default runs the real `git` with the hardened settings. */
  git?: SafetyGit;
  tmpDir?: string;
  /** The user's global ignore file. Default: ~/.config/git/ignore if it exists; null = none. */
  excludesFile?: string | null;
  /** Rows kept before the oldest checkpoint is pruned. Default 50. */
  maxCheckpoints?: number;
}

interface SessionMeta {
  agent: string;
  sessionId: string;
  /** The agent's own working directory, as reported (its first report). */
  project: string;
  deltas: FileDeltas;
}

interface OrphanRef {
  project: string;
  ref: string;
}

const invalid = (message: string, reason?: string) =>
  new PhoenixError(ErrorCode.INVALID_REQUEST, message, reason ? [reason] : []);
const keyOf = (agent: string, sessionId: string) => `${agent}\u0000${sessionId}`;

function defaultExcludes(): string | null {
  const home = homedir();
  const base = process.env.XDG_CONFIG_HOME || join(home, ".config");
  const file = join(base, "git", "ignore");
  return existsSync(file) ? file : null;
}

/**
 * Text from git or from an agent's project path as shown to a person: control, format (bidi
 * overrides such as U+202E, zero-width) and line/paragraph separator characters become "?".
 */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const showPath = (path: string): string => path.replace(HIDDEN, "?");
/** The folder name of a project, cleaned the same way. */
const repoName = (project: string): string => showPath(basename(project)) || "project";

const REFUSAL_MESSAGE: Record<
  PlanRefusal | "preview_stale" | "nothing_to_roll_back" | "apply_failed",
  string
> = {
  repository_missing: "The project is no longer a git repository on this computer",
  checkpoint_gone: "The checkpoint's snapshot is no longer in the repository",
  head_moved:
    "The repository's HEAD is not the commit the checkpoint was taken on (a commit or a branch switch happened); nothing was changed",
  snapshot_failed: "Git could not read the working tree; nothing was changed",
  preview_stale: "The working tree changed since the preview; preview it again",
  nothing_to_roll_back: "The working tree already matches the checkpoint",
  apply_failed: "Git could not restore the files; the working tree may be partly restored",
};

export class AgentSafety implements SafetyApi {
  readonly store: CheckpointStore;
  private readonly detectors: SafetyDetectors;
  private readonly now: () => number;
  private readonly git: SafetyGit;
  private readonly tmp: string;
  private readonly excludes: string | null;
  private config: SafetySettings;
  private readonly meta = new Map<string, SessionMeta>();
  private readonly decided = new Set<string>();
  private readonly inFlight = new Set<string>();
  private readonly skipped: SafetySkippedView[] = [];
  /** approval id -> the session it made wait */
  private readonly approvals = new Map<string, string>();
  private readonly rolling = new Set<string>();
  /** project -> time of its last checkpoint attempt */
  private readonly lastAttempt = new Map<string, number>();
  private readonly maxCheckpoints: number;
  private readonly unsubscribe: () => void;
  private lastCheck = 0;
  private cleanup: Promise<void> = Promise.resolve();

  constructor(private readonly d: AgentSafetyDeps) {
    this.store = new CheckpointStore(d.db);
    this.now = d.now ?? Date.now;
    this.git = d.git ?? safetyGit;
    this.tmp = d.tmpDir ?? tmpdir();
    this.maxCheckpoints = Math.max(1, Math.floor(d.maxCheckpoints ?? DEFAULT_MAX_CHECKPOINTS));
    this.excludes = d.excludesFile === undefined ? defaultExcludes() : d.excludesFile;
    this.config = readSettings(d.settings.get<unknown>(SAFETY_SETTINGS_KEY, null));
    this.detectors = new SafetyDetectors(detectorSettings(this.config));
    d.state.addRules(SAFETY_STATE_RULES);
    this.unsubscribe = d.bus.subscribe("agent-safety", WATCHED, (event) => this.onEvent(event));
  }

  close(): void {
    this.unsubscribe();
  }

  /** Resolves when background ref deletions (after delete-all or pruning) have finished. */
  settled(): Promise<void> {
    return this.cleanup;
  }

  // ── Events ────────────────────────────────────────────────────────────────

  private async onEvent(event: PhoenixEvent): Promise<void> {
    // Steps and approvals are Core's own events; the session states come from the `agents`
    // capability. A look-alike from any other source is ignored.
    const fromCore =
      event.event_type.startsWith("agent.session.") ||
      event.event_type.startsWith("agent.approval.");
    if (event.source !== (fromCore ? "core" : "agents")) return;
    try {
      const p = event.payload;
      const at = this.now();
      switch (event.event_type) {
        case "agent.session.step":
          await this.onStep(p, at);
          break;
        case "agent.approval.requested":
          this.onApprovalRequested(p, at);
          break;
        case "agent.approval.resolved":
          this.onApprovalResolved(p, at);
          break;
        case "agent.waiting":
          this.onAgentState("waiting", p, at);
          break;
        case "agent.working":
          this.onAgentState("working", p, at);
          break;
        default:
          this.onAgentState("finished", p, at);
      }
    } catch (err) {
      this.d.logger.warn("agent safety: could not handle an event", {
        type: event.event_type,
        error: (err as Error).message,
      });
    }
  }

  private async onStep(p: Record<string, unknown>, at: number): Promise<void> {
    const { agent, session_id: sessionId, project, kind, target, file } = p;
    if (
      typeof agent !== "string" ||
      typeof sessionId !== "string" ||
      typeof project !== "string" ||
      typeof kind !== "string"
    )
      return;
    const meta = this.metaOf(agent, sessionId, project);
    const observation: StepObservation = {
      agent,
      sessionId,
      kind: kind === "edit" || kind === "run" || kind === "read" ? kind : "other",
      target: typeof target === "string" ? target : "",
    };
    if (file && typeof file === "object") {
      const f = new Map(Object.entries(file));
      const path = f.get("path");
      const added = f.get("added");
      const removed = f.get("removed");
      const edits = f.get("edits");
      if (
        typeof path === "string" &&
        typeof added === "number" &&
        typeof removed === "number" &&
        typeof edits === "number"
      ) {
        const delta = meta.deltas.delta({ path, added, removed, edits });
        if (delta) observation.file = delta;
      }
    }
    for (const finding of this.detectors.step(observation, at)) this.raise(finding);
    if (kind === "edit") await this.maybeCheckpoint(meta);
  }

  private metaOf(agent: string, sessionId: string, project: string): SessionMeta {
    const key = keyOf(agent, sessionId);
    let m = this.meta.get(key);
    if (!m) {
      m = { agent, sessionId, project, deltas: new FileDeltas() };
      this.meta.set(key, m);
      if (this.meta.size > MAX_META) this.meta.delete(this.meta.keys().next().value!);
    }
    return m;
  }

  private onApprovalRequested(p: Record<string, unknown>, at: number): void {
    const { id, agent, project } = p;
    if (typeof id !== "string" || typeof agent !== "string" || typeof project !== "string") return;
    // The event names no session: the most recent one of that agent in that project is the asker.
    const asker = [...this.meta.values()]
      .reverse()
      .find((m) => m.agent === agent && m.project === project);
    if (!asker) return;
    this.detectors.waiting(asker.agent, asker.sessionId, at);
    this.approvals.set(id, keyOf(asker.agent, asker.sessionId));
    if (this.approvals.size > MAX_META) this.approvals.delete(this.approvals.keys().next().value!);
  }

  private onApprovalResolved(p: Record<string, unknown>, at: number): void {
    const { id } = p;
    if (typeof id !== "string") return;
    const key = this.approvals.get(id);
    this.approvals.delete(id);
    const m = key ? this.meta.get(key) : undefined;
    if (m) this.detectors.resumed(m.agent, m.sessionId, at);
  }

  private onAgentState(
    state: "waiting" | "working" | "finished",
    p: Record<string, unknown>,
    at: number,
  ): void {
    const { agent, agent_id: sessionId } = p;
    if (typeof agent !== "string" || typeof sessionId !== "string") return;
    if (state === "waiting") this.detectors.waiting(agent, sessionId, at);
    else if (state === "working") this.detectors.resumed(agent, sessionId, at);
    else this.detectors.finished(agent, sessionId, at);
  }

  // ── Detectors ─────────────────────────────────────────────────────────────

  /** Called often (the runtime's 1 s ticker); looks at time-based stalls at most every 15 s. */
  tick(): void {
    const at = this.now();
    if (at - this.lastCheck < CHECK_EVERY_MS) return;
    this.lastCheck = at;
    for (const finding of this.detectors.check(at)) this.raise(finding);
  }

  private raise(finding: Finding): void {
    const m = this.meta.get(keyOf(finding.agent, finding.sessionId));
    const repository = m ? repoName(m.project) : "project";
    const result = this.d.bus.publish(
      createEvent({
        event_type: finding.type === "loop" ? "agent.safety.loop" : "agent.safety.stall",
        source: "core",
        severity: "warning",
        subject: SAFETY_SOURCE,
        correlation_id: `agent-safety-${finding.agent}-${finding.sessionId}-${finding.kind}`.slice(
          0,
          200,
        ),
        payload: {
          agent: finding.agent,
          session_id: finding.sessionId,
          kind: finding.kind,
          reason: redactSecrets(finding.reason),
          repository,
        },
      }),
    );
    if (!result.ok)
      this.d.logger.warn("agent safety: warning event rejected", { code: result.error.code });
  }

  // ── Checkpoints ───────────────────────────────────────────────────────────

  private limits(): CheckpointLimits {
    return { maxFiles: this.config.max_files, maxBytes: this.config.max_bytes };
  }

  private skip(meta: SessionMeta, reason: SkipReason): void {
    this.skipped.unshift({
      agent: meta.agent,
      session_id: meta.sessionId,
      repository: repoName(meta.project),
      reason,
      at: new Date(this.now()).toISOString(),
    });
    this.skipped.length = Math.min(this.skipped.length, MAX_SKIPPED);
    this.announce(meta, { taken: false, reason });
  }

  /** Tells open screens that a checkpoint was taken or skipped (info; names only, no paths). */
  private announce(meta: SessionMeta, payload: Record<string, unknown>): void {
    const result = this.d.bus.publish(
      createEvent({
        event_type: "agent.safety.checkpoint",
        source: "core",
        severity: "info",
        subject: SAFETY_SOURCE,
        payload: {
          agent: meta.agent,
          session_id: meta.sessionId,
          repository: repoName(meta.project),
          ...payload,
        },
      }),
    );
    if (!result.ok)
      this.d.logger.warn("agent safety: checkpoint event rejected", { code: result.error.code });
  }

  /** The first edit step of a session takes the one checkpoint it will ever get. */
  private async maybeCheckpoint(meta: SessionMeta): Promise<void> {
    const key = keyOf(meta.agent, meta.sessionId);
    if (this.decided.has(key) || this.inFlight.has(key)) return;
    this.inFlight.add(key);
    try {
      this.decided.add(key);
      if (this.decided.size > MAX_DECIDED) this.decided.delete(this.decided.values().next().value!);
      if (this.store.hasSession(meta.agent, meta.sessionId)) return;
      if (!this.config.enabled) return this.skip(meta, "disabled");
      if (this.d.permissions.isKillSwitchEngaged()) return this.skip(meta, "kill_switch");
      const nowMs = this.now();
      // One checkpoint per project per minute: sessions are cheap to start and a snapshot costs a
      // full `git add -A` of the tree, so the gap is enforced before any git work.
      const last = this.lastAttempt.get(meta.project);
      if (last !== undefined && nowMs - last < CHECKPOINT_MIN_GAP_MS)
        return this.skip(meta, "throttled");
      this.lastAttempt.set(meta.project, nowMs);
      if (this.lastAttempt.size > MAX_THROTTLE_KEYS)
        this.lastAttempt.delete(this.lastAttempt.keys().next().value!);
      const id = `cp_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
      const made = await createCheckpoint(this.git, {
        id,
        project: meta.project,
        now: new Date(nowMs),
        limits: this.limits(),
        excludes: this.excludes,
        tmpDir: this.tmp,
      });
      if (!made.ok) return this.skip(meta, made.reason);
      this.store.insert({
        id,
        sessionId: meta.sessionId,
        agent: meta.agent,
        project: made.root,
        ref: made.ref,
        commitId: made.commitId,
        headId: made.headId,
        fileCount: made.fileCount,
        createdAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + this.config.retention_days * 86_400_000).toISOString(),
        rolledBackAt: null,
      });
      this.announce(meta, { taken: true, checkpoint_id: id, file_count: made.fileCount });
      this.cleanup = this.cleanup.then(() => this.maintain());
    } catch (err) {
      this.skip(meta, "snapshot_failed");
      this.d.logger.warn("agent safety: checkpoint failed", { error: (err as Error).message });
    } finally {
      this.inFlight.delete(key);
    }
  }

  // ── Retention and deletion ────────────────────────────────────────────────

  /**
   * Deletes checkpoints past their expiry: the ref first, then the row. Only refs of the exact
   * shape refs/phoenix/checkpoints/cp_<16 hex> that also match the row's own id are ever deleted.
   */
  async prune(): Promise<number> {
    const expired = this.store.expired(new Date(this.now()).toISOString());
    let removed = 0;
    for (const row of expired) {
      if (await this.dropRef(row)) {
        this.store.delete(row.id);
        removed++;
      }
    }
    await this.retryOrphans();
    return removed;
  }

  /**
   * Keeps at most `maxCheckpoints` rows: the oldest go first, ref before row, and only refs of the
   * exact checkpoint shape are ever deleted (`dropRef`).
   */
  async enforceCap(): Promise<number> {
    const all = this.store.every();
    let removed = 0;
    for (const row of all.slice(0, Math.max(0, all.length - this.maxCheckpoints))) {
      if (await this.dropRef(row)) {
        this.store.delete(row.id);
        removed++;
      }
    }
    return removed;
  }

  /** True when the ref is gone (deleted, or its repository no longer exists); false = try again later. */
  private async dropRef(row: Pick<CheckpointRow, "id" | "ref" | "project">): Promise<boolean> {
    if (row.ref !== refOf(row.id) || !CHECKPOINT_ID_PATTERN.test(row.id)) return true;
    const found = await findRoot(this.git, row.project);
    if (!found.ok) return found.reason === "not_git";
    return deleteCheckpointRef(this.git, found.root, row.ref);
  }

  /** Hourly (runtime maintenance) and at start. */
  async maintain(): Promise<void> {
    try {
      await this.prune();
      await this.enforceCap();
    } catch (err) {
      this.d.logger.warn("agent safety: pruning failed", { error: (err as Error).message });
    }
  }

  /**
   * Privacy "Delete all" for `agent_checkpoints`: the rows go now. The refs they named are removed in
   * the background; those that cannot be removed yet are written to a retry list that `maintain`
   * works through, so a crash or an absent git does not leave refs nobody knows about.
   */
  deleteAll(): { deleted: number } {
    const rows = this.store.every();
    const orphans: OrphanRef[] = rows
      .filter((r) => r.ref === refOf(r.id))
      .map((r) => ({ project: r.project, ref: r.ref }));
    const queued = this.orphans();
    this.d.settings.set(ORPHANS_KEY, [...queued, ...orphans].slice(-MAX_ORPHANS));
    const deleted = this.store.deleteAll();
    this.cleanup = this.cleanup.then(() => this.retryOrphans());
    return { deleted };
  }

  private orphans(): OrphanRef[] {
    const raw = this.d.settings.get<unknown>(ORPHANS_KEY, []);
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item: unknown) => {
      if (item === null || typeof item !== "object") return [];
      const e = new Map(Object.entries(item));
      const project = e.get("project");
      const ref = e.get("ref");
      return typeof project === "string" && typeof ref === "string" ? [{ project, ref }] : [];
    });
  }

  private async retryOrphans(): Promise<void> {
    const left: OrphanRef[] = [];
    for (const o of this.orphans()) {
      const found = await findRoot(this.git, o.project);
      if (!found.ok) {
        if (found.reason === "git_unavailable") left.push(o);
        continue;
      }
      if (!(await deleteCheckpointRef(this.git, found.root, o.ref))) left.push(o);
    }
    this.d.settings.set(ORPHANS_KEY, left);
  }

  // ── API ───────────────────────────────────────────────────────────────────

  private view(row: CheckpointRow): SafetyCheckpointView {
    return {
      id: row.id,
      agent: row.agent,
      session_id: row.sessionId,
      repository: repoName(row.project),
      file_count: row.fileCount,
      created_at: row.createdAt,
      expires_at: row.expiresAt,
      rolled_back_at: row.rolledBackAt,
    };
  }

  private settingsView(): SafetySettingsView {
    return {
      ...this.config,
      notify: !this.d.notifications.preferences().muted_sources.includes(SAFETY_SOURCE),
    };
  }

  async status(): Promise<SafetyStatusView> {
    return {
      settings: this.settingsView(),
      kill_switch: this.d.permissions.isKillSwitchEngaged(),
      checkpoints: this.store.list(100).map((row) => this.view(row)),
      skipped: [...this.skipped],
    };
  }

  configure(body: unknown): SafetyStatusView {
    const { settings, notify } = applySettings(this.config, body);
    this.config = settings;
    this.d.settings.set(SAFETY_SETTINGS_KEY, settings);
    this.detectors.configure(detectorSettings(settings));
    if (notify !== undefined) {
      const muted = new Set(this.d.notifications.preferences().muted_sources);
      if (notify) muted.delete(SAFETY_SOURCE);
      else muted.add(SAFETY_SOURCE);
      this.d.notifications.setPreferences({ muted_sources: [...muted] });
    }
    return {
      settings: this.settingsView(),
      kill_switch: this.d.permissions.isKillSwitchEngaged(),
      checkpoints: this.store.list(100).map((row) => this.view(row)),
      skipped: [...this.skipped],
    };
  }

  private rowOf(id: string): CheckpointRow {
    const row = CHECKPOINT_ID_PATTERN.test(id) ? this.store.get(id) : undefined;
    if (!row) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Checkpoint not found");
    return row;
  }

  private base() {
    return { git: this.git, excludes: this.excludes, tmpDir: this.tmp };
  }

  async preview(id: string): Promise<SafetyPreviewView> {
    const row = this.rowOf(id);
    const planned = await planRollback(this.base(), row);
    const checkpoint = this.view(row);
    const empty = { restore: 0, remove: 0, kept: 0 };
    if (!planned.ok)
      return {
        checkpoint,
        refusal: planned.reason,
        preview_hash: null,
        restore: [],
        remove: [],
        kept: [],
        counts: empty,
        lists_truncated: false,
        diff: "",
        diff_truncated: false,
        diff_redacted: false,
      };
    const { plan, ctx } = planned;
    const diff = await diffPreview(ctx, plan);
    const restore = listed(plan.restore);
    const remove = listed(plan.remove);
    const kept = listed(plan.kept);
    return {
      checkpoint,
      refusal: null,
      preview_hash: plan.hash,
      restore: restore.items.map((r) => ({ path: showPath(r.path), change: r.change })),
      remove: remove.items.map(showPath),
      kept: kept.items.map((k) => ({ path: showPath(k.path), why: k.why })),
      counts: { restore: plan.restore.length, remove: plan.remove.length, kept: plan.kept.length },
      lists_truncated: restore.truncated || remove.truncated || kept.truncated,
      diff: diff.diff,
      diff_truncated: diff.truncated,
      diff_redacted: diff.redacted,
    };
  }

  /**
   * Rolls the working tree back to a checkpoint. `body.preview_hash` is the hash of the preview the
   * owner looked at. The plan is recomputed before asking and again after the approval; a different
   * tree, or a HEAD that moved, refuses the rollback and nothing is changed.
   */
  async rollback(id: string, body: unknown): Promise<SafetyRollbackView> {
    const hash = this.hashOf(body);
    const row = this.rowOf(id);
    if (this.rolling.has(row.project))
      throw invalid("A rollback of this project is already running");
    this.rolling.add(row.project);
    try {
      const planned = await planRollback(this.base(), row);
      if (!planned.ok) throw this.refuse(planned.reason);
      const plan = planned.plan;
      if (plan.hash !== hash) throw this.refuse("preview_stale");
      if (plan.restore.length === 0 && plan.remove.length === 0)
        throw this.refuse("nothing_to_roll_back");
      const action = await this.d.permissions.authorize({
        capabilityId: SAFETY_CAPABILITY,
        command: ROLLBACK_COMMAND,
        permissions: [],
        sideEffect: "execute",
        summary: this.summaryOf(row, plan),
        details: { checkpoint: row.id, preview_hash: plan.hash },
      });
      const done = await applyRollback(this.base(), row, hash);
      if (!done.ok) {
        this.d.permissions.recordOutcome(action, "failed", {
          checkpoint_id: row.id,
          reason: done.reason,
        });
        throw this.refuse(done.reason);
      }
      this.store.markRolledBack(row.id, new Date(this.now()).toISOString());
      this.d.permissions.recordOutcome(action, "succeeded", {
        checkpoint_id: row.id,
        preview_hash: plan.hash,
        restored: done.restored,
        removed: done.removed,
        kept: done.kept,
        exact: done.exact,
      });
      return {
        checkpoint_id: row.id,
        restored: done.restored,
        removed: done.removed,
        kept: done.kept,
        exact: done.exact,
      };
    } finally {
      this.rolling.delete(row.project);
    }
  }

  private hashOf(body: unknown): string {
    const given = body !== null && typeof body === "object" ? new Map(Object.entries(body)) : null;
    if (!given || [...given.keys()].some((k) => k !== "preview_hash"))
      throw invalid('Body must be {"preview_hash": "<hash of the preview you reviewed>"}');
    const hash = given.get("preview_hash");
    if (typeof hash !== "string" || !PREVIEW_HASH.test(hash))
      throw invalid('"preview_hash" must be the 64-character hash from the preview');
    return hash;
  }

  private summaryOf(row: CheckpointRow, plan: RollbackPlan): string {
    const repo = repoName(row.project);
    return (
      `Agent safety: roll back ${repo} to the checkpoint taken ${row.createdAt}: ` +
      `restore ${plan.restore.length} file(s) and delete ${plan.remove.length} new file(s) ` +
      `(preview ${plan.hash.slice(0, 12)}). Git history, branches and stashes are not touched.`
    );
  }

  private refuse(reason: PlanRefusal | "preview_stale" | "nothing_to_roll_back" | "apply_failed") {
    const code =
      reason === "repository_missing" || reason === "checkpoint_gone"
        ? ErrorCode.RESOURCE_NOT_FOUND
        : reason === "apply_failed" || reason === "snapshot_failed"
          ? ErrorCode.INTERNAL_ERROR
          : ErrorCode.INVALID_REQUEST;
    return new PhoenixError(code, REFUSAL_MESSAGE[reason], [reason]);
  }
}
