// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Memory inside Core (Phase 28 wiring, Phase 29 governance).
//
// What flows in: git commits (live events), curated GitHub PR/CI/deployment and issue-tracker
// event metadata, meeting summaries (after sync stores one), and user-listed markdown files.
// EVERY read goes through `canView` with the viewer this runtime was built with (the device owner
// unless a test or a future multi-user build says otherwise), so totals, counts and the page never
// reflect an item the viewer cannot see.
import { isAbsolute, resolve } from "node:path";
import {
  buildMatchQuery,
  canView,
  createDefaultPolicy,
  DEFAULT_RETENTION_DAYS,
  docPathProblem,
  ingestCommits,
  ingestEngineeringRecords,
  ingestDocs,
  ingestGitEvent,
  ingestMeetings,
  MEMORY_DOMAINS,
  MEMORY_LAYERS,
  MemoryPipeline,
  MemoryStore,
  nodeDocReader,
  ownerViewer,
  type EngineeringRecord,
  type IngestReport,
  type MemoryDomain,
  type MemoryItem,
  type MemoryLayer,
  type Viewer,
} from "@phoenix/ai-memory";
import { ask, ContextEngine, generateWith } from "@phoenix/ai-context";
import type { AiService } from "@phoenix/ai-models";
import type {
  MemoryAnswerView,
  MemoryApi,
  MemoryItemView,
  MemoryPageView,
  MemorySettingsView,
  RetrievalInfoView,
} from "@phoenix/api";
import type { CapabilityManager } from "@phoenix/capability-manager";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { AuditLog } from "@phoenix/permissions";
import type { Database, MeetingStore, SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError, type PhoenixEvent } from "@phoenix/protocol";
import type { RetrievalRuntime } from "./retrieval";

const SETTINGS_KEY = "memory.settings";
/** Longest memory text returned by a list, search or ask response. */
export const MAX_VIEW_TEXT = 2000;
const MAX_DOC_PATHS = 50;
const MAX_DOC_PATH_CHARS = 1024;
/** Capabilities whose meetings become memories. */
const MEETING_CAPABILITIES = ["kage"];
/** Facts and tokens one question may bring to a model. */
const ASK_LIMIT = 10;
const ASK_TOKEN_BUDGET = 3000;
const OWNER = "owner";

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

interface StoredMemorySettings {
  retention_days: Record<MemoryLayer, number | null>;
  allow_sensitive_meetings: boolean;
  doc_paths: string[];
  capture_git: boolean;
}

function defaults(): StoredMemorySettings {
  return {
    retention_days: { ...DEFAULT_RETENTION_DAYS },
    allow_sensitive_meetings: false,
    doc_paths: [],
    capture_git: true,
  };
}

const isDomain = (value: unknown): value is MemoryDomain =>
  (MEMORY_DOMAINS as readonly unknown[]).includes(value);
const isLayer = (value: unknown): value is MemoryLayer =>
  (MEMORY_LAYERS as readonly unknown[]).includes(value);

function cap(text: string): string {
  return text.length > MAX_VIEW_TEXT ? `${text.slice(0, MAX_VIEW_TEXT - 1)}…` : text;
}

/** The owner's view of one memory: no provenance internals, no dedupe key. */
function toView(item: MemoryItem): MemoryItemView {
  return {
    id: item.id,
    text: cap(item.text),
    layer: item.layer,
    domain: item.domain,
    kind: item.kind,
    source: item.source,
    source_ref: item.sourceRef,
    scope: item.scope,
    sensitivity: item.sensitivity,
    observed_at: item.observedAt,
    confidence: item.confidence,
    retention_days: item.retentionDays,
    expires_at: item.expiresAt,
    redacted: item.provenance.redacted === true,
  };
}

export interface MemoryRuntimeDeps {
  db: Database;
  settings: SettingsStore;
  bus: EventBus;
  meetings: MeetingStore;
  capabilities: CapabilityManager;
  audit: AuditLog;
  ai: AiService;
  logger: Logger;
  /** Who is looking. Defaults to the device owner. */
  viewer?: Viewer;
  now?: () => Date;
}

/** What other Phoenix parts must do when memory changes under them. Set once, by the runtime. */
export interface MemoryHooks {
  /** Reviewed facts were forgotten: their meeting items must not stay accepted. */
  rejectItems(itemIds: readonly string[]): void;
  /** Sensitive meetings were allowed again: re-derive facts and items from the meeting store. */
  meetingsAllowed(): void;
  /** Sensitive meetings were switched off: whatever was derived from meetings must go. */
  meetingsRevoked(): void;
}

const REVIEW_SOURCE = "meeting-review";

/** Do not allow an event payload to turn arbitrary text into a repository permission scope. */
const REPOSITORY =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9_])?$/;
// Issue tracker events carry provider-validated keys and normalized enum categories. Decision,
// architecture, infra, people, incident and Fawkes still lack trusted structured producers here.
const GITHUB_STATES = {
  "github.pr.opened": ["pr", "opened", "number", "PR"],
  "github.pr.merged": ["pr", "merged", "number", "PR"],
  "github.pr.closed": ["pr", "closed", "number", "PR"],
  "github.ci.started": ["repo", "started", "run_id", "CI"],
  "github.ci.passed": ["repo", "succeeded", "run_id", "CI"],
  "github.ci.failed": ["repo", "failed", "run_id", "CI"],
  "github.ci.cancelled": ["repo", "cancelled", "run_id", "CI"],
  "github.deploy.started": ["deployment", "started", "deployment_id", "Deployment"],
  "github.deploy.succeeded": ["deployment", "succeeded", "deployment_id", "Deployment"],
  "github.deploy.failed": ["deployment", "failed", "deployment_id", "Deployment"],
} as const;

function githubEngineeringRecord(event: PhoenixEvent): EngineeringRecord | null {
  if (event.source !== "github" || !Object.hasOwn(GITHUB_STATES, event.event_type)) return null;
  const [domain, state, key, label] = GITHUB_STATES[event.event_type as keyof typeof GITHUB_STATES];
  const repo = event.payload.repository;
  const id = event.payload[key];
  if (
    typeof repo !== "string" ||
    !REPOSITORY.test(repo) ||
    repo.includes("..") ||
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id <= 0
  )
    return null;
  const sourceRef = `${repo}/${key}/${id}`;
  return {
    domain,
    source: "github",
    sourceRef,
    recordId: event.event_id,
    scope: `repo:${repo}`,
    observedAt: event.timestamp,
    sensitivity: "internal",
    evidenceKind: "fact",
    subject: `${label}#${id}`,
    state,
    evidenceId: event.event_id,
    confidence: 1,
    freshnessTtlDays: 7,
    retentionDays: 90,
  };
}

const ISSUE_CATEGORIES = ["open", "in_progress", "done", "cancelled"] as const;
const ISSUE_KEYS = {
  linear: /^[A-Za-z][A-Za-z0-9]{0,15}-\d{1,9}$/,
  jira: /^[A-Z][A-Z0-9_]{0,49}-\d{1,9}$/,
} as const;

/** Project only validated identifiers and closed enums, never tracker-supplied free text. */
function issueEngineeringRecord(event: PhoenixEvent): EngineeringRecord | null {
  if (event.source !== "issues") return null;
  const type = event.event_type;
  if (
    type !== "issues.assigned" &&
    type !== "issues.unassigned" &&
    type !== "issues.status_changed"
  )
    return null;
  const { tracker, key, category } = event.payload;
  if (
    typeof tracker !== "string" ||
    typeof key !== "string" ||
    typeof category !== "string" ||
    !ISSUE_CATEGORIES.includes(category as (typeof ISSUE_CATEGORIES)[number])
  )
    return null;
  // A status-change event carries both normalized buckets; status names are untrusted prose.
  if (
    type === "issues.status_changed" &&
    (event.payload.to !== category ||
      typeof event.payload.from !== "string" ||
      !ISSUE_CATEGORIES.includes(event.payload.from as (typeof ISSUE_CATEGORIES)[number]))
  )
    return null;
  let scope: string;
  let subject: string;
  if (tracker === "github") {
    const match =
      /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9_])?)#([1-9]\d{0,15})$/.exec(
        key,
      );
    if (
      !match ||
      !REPOSITORY.test(match[1]!) ||
      match[1]!.includes("..") ||
      !Number.isSafeInteger(Number(match[2]))
    )
      return null;
    scope = `repo:${match[1]}`;
    subject = `Issue#${match[2]}`;
  } else if ((tracker === "linear" || tracker === "jira") && ISSUE_KEYS[tracker].test(key)) {
    scope = `issue:${tracker}:${key}`;
    subject = `Issue#${key}`;
  } else return null;
  const state =
    type === "issues.assigned"
      ? "assigned"
      : type === "issues.unassigned"
        ? "inactive"
        : (
            {
              open: "opened",
              in_progress: "started",
              done: "completed",
              cancelled: "cancelled",
            } as const
          )[category as (typeof ISSUE_CATEGORIES)[number]];
  return {
    domain: "issue",
    source: "issues",
    sourceRef: `${tracker}:${key}`,
    recordId: event.event_id,
    scope,
    observedAt: event.timestamp,
    sensitivity: "internal",
    evidenceKind: "fact",
    subject,
    state,
    evidenceId: event.event_id,
    confidence: 1,
    freshnessTtlDays: 7,
    retentionDays: 90,
  };
}

export class MemoryRuntime implements MemoryApi {
  readonly store: MemoryStore;
  readonly pipeline: MemoryPipeline;
  private readonly engine: ContextEngine;
  private readonly viewer: Viewer;
  private readonly unsubscribe: () => void;
  private readonly stopGithub: () => void;
  private readonly stopIssues: () => void;
  private readonly stopMeetingSync: () => void;
  private hooks: MemoryHooks | null = null;
  private retrieval: RetrievalRuntime | null = null;
  private docChain: Promise<unknown> = Promise.resolve();
  private meetingSyncQueued = false;
  private closed = false;

  constructor(private readonly d: MemoryRuntimeDeps) {
    const now = d.now ?? (() => new Date());
    this.viewer = d.viewer ?? ownerViewer(OWNER);
    this.store = new MemoryStore(d.db, { now });
    this.pipeline = new MemoryPipeline({
      store: this.store,
      owner: OWNER,
      // Read on every capture: a retention change applies to the next memory.
      retentionDays: () => this.current().retention_days,
      policy: createDefaultPolicy({
        isSourceEnabled: (source) => this.isSourceEnabled(source),
        allowSensitive: (_source, domain) =>
          domain === "meeting" && this.current().allow_sensitive_meetings,
      }),
    });
    this.engine = new ContextEngine({
      store: this.store,
      clock: { now, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
    this.unsubscribe = d.bus.subscribe("memory-git", "git.commit.created", (event) => {
      // Only the git capability's own events: any other source naming this type is not a commit.
      if (
        event.source !== "git" ||
        !this.current().capture_git ||
        !this.d.db.prepare("SELECT 1 FROM events WHERE event_id = ?").get(event.event_id)
      )
        return;
      ingestGitEvent(this.pipeline, event);
    });
    this.stopGithub = d.bus.subscribe(
      "memory-github-engineering",
      ["github.pr.*", "github.ci.*", "github.deploy.*"],
      (event) => {
        if (!this.isSourceEnabled("github")) return;
        if (!this.d.db.prepare("SELECT 1 FROM events WHERE event_id = ?").get(event.event_id))
          return;
        const record = githubEngineeringRecord(event);
        if (record) ingestEngineeringRecords(this.pipeline, [record]);
      },
    );
    this.stopIssues = d.bus.subscribe(
      "memory-issues-engineering",
      ["issues.assigned", "issues.unassigned", "issues.status_changed"],
      (event) => {
        if (!this.isSourceEnabled("issues")) return;
        if (
          !this.d.db
            .prepare("SELECT 1 FROM events WHERE event_id = ? AND source = 'issues'")
            .get(event.event_id)
        )
          return;
        const record = issueEngineeringRecord(event);
        if (record) ingestEngineeringRecords(this.pipeline, [record]);
      },
    );
    this.stopMeetingSync = d.meetings.onChange(() => this.scheduleMeetingSync());
  }

  /** Saved settings merged over the defaults; a damaged stored value reads as the default. */
  private current(): StoredMemorySettings {
    const stored = this.d.settings.get<Partial<StoredMemorySettings> | null>(SETTINGS_KEY, null);
    const base = defaults();
    if (!stored || typeof stored !== "object") return base;
    return {
      retention_days: { ...base.retention_days, ...stored.retention_days },
      allow_sensitive_meetings: stored.allow_sensitive_meetings === true,
      doc_paths: Array.isArray(stored.doc_paths)
        ? stored.doc_paths.filter((p): p is string => typeof p === "string")
        : [],
      capture_git: stored.capture_git !== false,
    };
  }

  private isSourceEnabled(source: string): boolean {
    if (source === "git") return this.current().capture_git;
    if (source === "project-docs") return true;
    // Facts made from items the user reviewed. Sensitive ones still need allow_sensitive_meetings.
    if (source === REVIEW_SOURCE) return true;
    try {
      return this.d.capabilities.get(source).status === "enabled";
    } catch {
      return false;
    }
  }

  private record(action: string, details: Record<string, unknown>): void {
    this.d.audit.record({ actor: "user", action, decision: "info", details });
  }

  // ── Startup and schedule ───────────────────────────────────────────────────

  /** Wires the parts that depend on memory (they are built after it). */
  attach(parts: { hooks: MemoryHooks; retrieval: RetrievalRuntime }): void {
    this.hooks = parts.hooks;
    this.retrieval = parts.retrieval;
  }

  /** Expiry, a docs refresh, then (when retrieval is on) embedding of what is new. */
  async maintain(): Promise<void> {
    this.expire();
    await this.syncDocs();
    await this.retrieval?.index();
  }

  /** Tombstones memories whose retention ran out. */
  expire(): number {
    if (this.closed) return 0;
    const count = this.store.expire();
    if (count > 0) this.record("memory.expired", { count });
    return count;
  }

  /** Resolves when every queued docs sync has finished. */
  settled(): Promise<void> {
    return this.docChain.then(() => undefined);
  }

  /** Brings doc memories in step with the listed files. Runs one at a time. */
  syncDocs(): Promise<IngestReport | null> {
    const run = this.docChain.then(async () => {
      if (this.closed) return null;
      try {
        return await ingestDocs({
          pipeline: this.pipeline,
          store: this.store,
          reader: nodeDocReader,
          paths: this.current().doc_paths,
        });
      } catch (err) {
        this.d.logger.warn("memory: docs sync failed", { error: (err as Error).message });
        return null;
      }
    });
    this.docChain = run;
    return run;
  }

  /** Meeting changes arrive in bursts (delete-all removes many); one sync covers the burst. */
  private scheduleMeetingSync(): void {
    if (this.meetingSyncQueued || this.closed) return;
    this.meetingSyncQueued = true;
    queueMicrotask(() => {
      this.meetingSyncQueued = false;
      this.syncMeetings();
    });
  }

  syncMeetings(): IngestReport | null {
    if (this.closed || !this.current().allow_sensitive_meetings) return null;
    try {
      return ingestMeetings({
        pipeline: this.pipeline,
        store: this.store,
        meetings: this.d.meetings,
        capabilities: MEETING_CAPABILITIES,
      });
    } catch (err) {
      this.d.logger.warn("memory: meeting sync failed", { error: (err as Error).message });
      return null;
    }
  }

  /** What the agent runtime retrieves context with: the same engine and viewer `ask` uses. */
  agentContext(): { engine: ContextEngine; viewer: Viewer } {
    return { engine: this.engine, viewer: this.viewer };
  }

  /** Backfill from commits already in a repository's history. Used by tools and tests. */
  captureCommits(commits: Parameters<typeof ingestCommits>[1]): IngestReport {
    return ingestCommits(this.pipeline, commits);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsubscribe();
    this.stopGithub();
    this.stopIssues();
    this.stopMeetingSync();
    await this.docChain.catch(() => undefined);
  }

  // ── Browse, search, delete ─────────────────────────────────────────────────

  private accept = (item: Pick<MemoryItem, "scope" | "domain" | "sensitivity">) =>
    canView(this.viewer, item);

  browse(query: {
    domain?: string;
    layer?: string;
    limit: number;
    offset: number;
  }): MemoryPageView {
    if (query.domain !== undefined && !isDomain(query.domain)) throw invalid("Unknown domain");
    if (query.layer !== undefined && !isLayer(query.layer)) throw invalid("Unknown layer");
    const page = this.store.browse({
      ...(query.domain ? { domain: query.domain } : {}),
      ...(query.layer ? { layer: query.layer } : {}),
      limit: query.limit,
      offset: query.offset,
      accept: this.accept,
    });
    return {
      items: page.items.map(toView),
      total: page.total,
      counts: page.counts,
      ai: { enabled: this.aiEnabled() },
    };
  }

  async search(query: { text: string; domain?: string; limit: number }): Promise<{
    items: (MemoryItemView & { score: number })[];
    retrieval: RetrievalInfoView;
  }> {
    if (query.domain !== undefined && !isDomain(query.domain)) throw invalid("Unknown domain");
    if (this.retrieval) {
      const hybrid = await this.retrieval.searchMemory({
        text: query.text,
        viewer: this.viewer,
        ...(query.domain ? { domain: query.domain } : {}),
        limit: query.limit,
      });
      if (hybrid.hits !== null) {
        return {
          items: hybrid.hits.map((h) => ({ ...toView(h.item), score: h.score })),
          retrieval: hybrid.info,
        };
      }
    }
    const info: RetrievalInfoView = this.retrieval?.lexicalInfo() ?? { mode: "lexical" };
    const match = buildMatchQuery(query.text);
    if (match === null) return { items: [], retrieval: info };
    const hits = this.store.search({
      match,
      ...(query.domain ? { domain: query.domain } : {}),
      limit: query.limit,
      accept: this.accept,
    });
    return { items: hits.map((h) => ({ ...toView(h.item), score: h.score })), retrieval: info };
  }

  /** Item ids behind the reviewed facts this viewer can see (optionally just one fact). */
  private reviewedItemIds(factId?: string): string[] {
    const ids: string[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = this.store.list({ domain: "meeting", limit: 500, offset });
      for (const f of page) {
        const itemId = f.provenance.item_id;
        if (f.source !== REVIEW_SOURCE || typeof itemId !== "string" || !canView(this.viewer, f)) {
          continue;
        }
        if (factId === undefined || f.id === factId) ids.push(itemId);
      }
      if (page.length < 500) break;
    }
    return ids;
  }

  forget(id: string): boolean {
    const item = this.store.get(id);
    // Not visible to this viewer = does not exist, as far as the caller can tell.
    if (!item || item.deletedAt || !canView(this.viewer, item)) return false;
    const reviewed = item.source === REVIEW_SOURCE ? this.reviewedItemIds(id) : [];
    const forgotten = this.store.forget(id);
    if (forgotten) {
      this.record("memory.forgotten", { count: 1 });
      this.hooks?.rejectItems(reviewed);
    }
    return forgotten;
  }

  deleteAll(domain?: string): number {
    if (domain !== undefined && !isDomain(domain)) throw invalid("Unknown domain");
    const reviewed = !domain || domain === "meeting" ? this.reviewedItemIds() : [];
    const deleted = this.store.forgetWhere({
      ...(domain ? { domain } : {}),
      accept: this.accept,
    });
    this.record("memory.deleted", { count: deleted, ...(domain ? { domain } : { all: true }) });
    this.hooks?.rejectItems(reviewed);
    return deleted;
  }

  /** Items the viewer can see: what the privacy inventory counts. */
  count(): number {
    return this.store.browse({ limit: 1, offset: 0, accept: this.accept }).total;
  }

  retentionByLayer(): Record<MemoryLayer, number | null> {
    return this.current().retention_days;
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  settings(): MemorySettingsView {
    const s = this.current();
    return {
      retention_days: s.retention_days,
      allow_sensitive_meetings: s.allow_sensitive_meetings,
      doc_paths: s.doc_paths,
      capture_git: s.capture_git,
    };
  }

  async setSettings(input: unknown): Promise<MemorySettingsView> {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw invalid("Memory settings must be an object");
    }
    const before = this.current();
    const next = this.validated(input, before);
    this.d.settings.set(SETTINGS_KEY, next);
    this.record("memory.settings.changed", {
      retention_days: next.retention_days,
      allow_sensitive_meetings: next.allow_sensitive_meetings,
      capture_git: next.capture_git,
      doc_paths: next.doc_paths.length,
    });
    this.apply(before, next);
    if (before.doc_paths.join("\n") !== next.doc_paths.join("\n")) await this.syncDocs();
    return this.settings();
  }

  private validated(input: object, before: StoredMemorySettings): StoredMemorySettings {
    const next: StoredMemorySettings = {
      ...before,
      retention_days: { ...before.retention_days },
    };
    for (const [key, value] of Object.entries(input)) {
      if (key === "retention_days") {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          throw invalid('"retention_days" must be an object');
        }
        for (const [layer, days] of Object.entries(value)) {
          if (!isLayer(layer)) throw invalid(`Unknown memory layer "${layer.slice(0, 40)}"`);
          if (days === null) next.retention_days[layer] = null;
          else if (
            typeof days === "number" &&
            Number.isInteger(days) &&
            days >= 1 &&
            days <= 3650
          ) {
            next.retention_days[layer] = days;
          } else throw invalid(`"${layer}" retention must be 1-3650 days or null`);
        }
      } else if (key === "allow_sensitive_meetings" || key === "capture_git") {
        if (typeof value !== "boolean") throw invalid(`"${key}" must be a boolean`);
        next[key] = value;
      } else if (key === "doc_paths") {
        next.doc_paths = this.validatedPaths(value);
      } else {
        throw invalid(`Unknown memory setting "${key.slice(0, 40)}"`);
      }
    }
    return next;
  }

  private validatedPaths(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > MAX_DOC_PATHS) {
      throw invalid(`"doc_paths" must be a list of at most ${MAX_DOC_PATHS} paths`);
    }
    const out: string[] = [];
    for (const raw of value) {
      if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_DOC_PATH_CHARS) {
        throw invalid(`Each doc path must be a string of 1-${MAX_DOC_PATH_CHARS} characters`);
      }
      if (raw.includes("\0")) throw invalid("A doc path contains an invalid character");
      if (!isAbsolute(raw)) throw invalid("Each doc path must be absolute");
      const path = resolve(raw);
      const problem = docPathProblem(path);
      if (problem) throw invalid(`Doc path: ${problem}`);
      if (!out.includes(path)) out.push(path);
    }
    return out;
  }

  /** Makes a settings change take effect on what is already stored. */
  private apply(before: StoredMemorySettings, next: StoredMemorySettings): void {
    for (const layer of MEMORY_LAYERS) {
      if (before.retention_days[layer] !== next.retention_days[layer]) {
        this.store.setLayerRetention(layer, next.retention_days[layer]);
      }
    }
    this.expire();
    if (before.allow_sensitive_meetings !== next.allow_sensitive_meetings) {
      if (next.allow_sensitive_meetings) {
        this.syncMeetings();
        this.hooks?.meetingsAllowed();
      } else {
        // Turning the permission off takes the meeting memories out, not just stops new ones.
        const removed = this.store.purge({ domain: "meeting" });
        this.record("memory.deleted", { count: removed, domain: "meeting", reason: "opt-out" });
        this.hooks?.meetingsRevoked();
      }
    }
  }

  // ── Ask ────────────────────────────────────────────────────────────────────

  private aiEnabled(): boolean {
    try {
      this.d.ai.plan({ kind: "generate", privacy: "public" });
      return true;
    } catch {
      return false;
    }
  }

  async ask(question: string): Promise<MemoryAnswerView> {
    const request = {
      question,
      viewer: this.viewer,
      limit: ASK_LIMIT,
      tokenBudget: ASK_TOKEN_BUDGET,
    };
    const prepared = this.retrieval ? await this.retrieval.preparedEngine(request) : null;
    const info: RetrievalInfoView = prepared?.info ?? { mode: "lexical" };
    const answer = await ask(request, {
      engine: prepared?.engine ?? this.engine,
      generate: generateWith(this.d.ai),
    });
    return {
      // Stored facts only: a model's earlier output (storedInterpretations) is never listed as one.
      facts: answer.facts.map((f) => ({
        id: f.id,
        text: cap(f.text),
        domain: f.domain,
        source: f.source,
        source_ref: f.sourceRef,
        observed_at: f.observedAt,
        sensitivity: f.sensitivity,
        classification: "stored_fact" as const,
        confidence: f.confidence ?? null,
        freshness: f.freshness,
      })),
      retrieved_evidence: (answer.retrievedEvidence ?? []).map((e) => ({
        id: e.id,
        text: cap(e.text),
        domain: e.domain,
        source: e.source,
        source_ref: e.sourceRef,
        observed_at: e.observedAt,
        sensitivity: e.sensitivity,
        classification: "retrieved_evidence" as const,
        confidence: e.confidence ?? null,
        freshness: e.freshness,
      })),
      stored_interpretations: answer.storedInterpretations.map((item) => ({
        id: item.id,
        text: cap(item.text),
        domain: item.domain,
        source: item.source,
        source_ref: item.sourceRef,
        observed_at: item.observedAt,
        sensitivity: item.sensitivity,
        classification: "stored_interpretation" as const,
        confidence: item.confidence ?? null,
        freshness: item.freshness,
      })),
      interpretation: answer.interpretation,
      interpretation_classification: answer.interpretation === null ? null : "hypothesis",
      processed_by: answer.model?.processedBy ?? null,
      ai_used: answer.interpretation !== null,
      note: answer.noInterpretationReason,
      retrieval: info,
    };
  }
}
