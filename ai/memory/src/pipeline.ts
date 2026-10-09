// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// capture → classify → permission-check → store → index, as separate typed stages.
//
// Decisions (see docs/phases/phase-28-context-engine-and-memory-store.md):
// - Secret-shaped text is REDACTED before storage (the rest of a commit message or a doc chunk is
//   still useful); private-key material is REJECTED because redacting the header would leave the
//   key body behind. Redaction only knows the patterns in @phoenix/protocol (tokens, API keys,
//   PEM headers); it cannot find a password written in prose.
// - Store and index are one atomic step (MemoryStore.insert writes the row and its index entry in
//   one transaction). Two separate steps could crash in between and leave a memory that can never
//   be found, or an index entry for text that was never stored.
import { redact } from "@phoenix/logging";
import type { PrivacyClass } from "@phoenix/ai-models";
import type { InsertResult, MemoryStore, StorableItem } from "./store";
import type { MemoryDomain, MemoryItem, MemoryKind, MemoryLayer, MemoryProvenance } from "./types";

/** What kind of thing a capture is. Classification is a pure function of this. */
export const CONTENT_TYPES = [
  "commit",
  "doc",
  "meeting_summary",
  "meeting_decision",
  "meeting_action_item",
  "transcript",
  "preference",
  "working",
  "note",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

interface Classification {
  layer: MemoryLayer;
  domain: MemoryDomain;
  sensitivity: PrivacyClass;
}

/**
 * Anything from a meeting (including its transcript) is sensitive unless the source states
 * otherwise; commit messages and docs are internal; anything unknown is internal too.
 */
export const CLASSIFICATION: Record<ContentType, Classification> = {
  commit: { layer: "episodic", domain: "git", sensitivity: "internal" },
  doc: { layer: "project", domain: "project", sensitivity: "internal" },
  meeting_summary: { layer: "episodic", domain: "meeting", sensitivity: "sensitive" },
  meeting_decision: { layer: "project", domain: "meeting", sensitivity: "sensitive" },
  meeting_action_item: { layer: "episodic", domain: "meeting", sensitivity: "sensitive" },
  transcript: { layer: "episodic", domain: "meeting", sensitivity: "sensitive" },
  preference: { layer: "preference", domain: "preference", sensitivity: "internal" },
  working: { layer: "working", domain: "general", sensitivity: "internal" },
  note: { layer: "episodic", domain: "general", sensitivity: "internal" },
};

/** Days a working-layer memory lives unless the caller says otherwise. */
export const WORKING_RETENTION_DAYS = 1;
/** Longest text kept per memory. Longer text is cut and marked in the provenance. */
export const MAX_MEMORY_CHARS = 4000;

/** Stage 1 input: what an ingestor hands over. */
export interface RawCapture {
  /** Capability or ingestor id: "git", "kage", "project-docs". */
  source: string;
  /** What inside the source it came from: meeting id, file path, repository. */
  sourceRef: string;
  scope: string;
  contentType: ContentType;
  /** Defaults to "fact". An "interpretation" must name its model and provider in `provenance`. */
  kind?: MemoryKind;
  text: string;
  /** When the thing happened. Any string Date can parse; stored as ISO. */
  observedAt: string;
  /** Stable identity of the source fact: capturing the same fact twice must produce the same key. */
  dedupeKey: string;
  provenance: MemoryProvenance;
  confidence?: number;
  /** Stated by the source; overrides the rule (for example a public repository). */
  sensitivity?: PrivacyClass;
  freshnessTtlDays?: number | null;
  retentionDays?: number | null;
}

export type RejectionReason =
  | "empty_text"
  | "invalid_observed_at"
  | "missing_dedupe_key"
  | "missing_scope"
  | "interpretation_without_model"
  | "contains_private_key";

/** Stage 1 output: validated, trimmed, observed time normalised. */
export interface Candidate extends RawCapture {
  kind: MemoryKind;
  observedAt: string;
}

export type StageResult<T> = { ok: true; value: T } | { ok: false; reason: RejectionReason };

export const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

export function captureStage(raw: RawCapture): StageResult<Candidate> {
  const text = raw.text.trim();
  if (text.length === 0) return { ok: false, reason: "empty_text" };
  if (raw.dedupeKey.trim().length === 0) return { ok: false, reason: "missing_dedupe_key" };
  if (raw.scope.trim().length === 0) return { ok: false, reason: "missing_scope" };
  const observed = new Date(raw.observedAt);
  if (Number.isNaN(observed.getTime())) return { ok: false, reason: "invalid_observed_at" };
  const kind = raw.kind ?? "fact";
  if (
    kind === "interpretation" &&
    (typeof raw.provenance.model !== "string" || typeof raw.provenance.provider !== "string")
  ) {
    return { ok: false, reason: "interpretation_without_model" };
  }
  return { ok: true, value: { ...raw, text, kind, observedAt: observed.toISOString() } };
}

/** Stage 2 context that is not part of the capture itself. */
export interface ClassifyContext {
  owner: string;
  /** Days to keep each layer; null keeps until deleted. Phase 29 makes these user settings. */
  retentionDays: Record<MemoryLayer, number | null>;
}

export const DEFAULT_RETENTION_DAYS: Record<MemoryLayer, number | null> = {
  working: WORKING_RETENTION_DAYS,
  episodic: null,
  project: null,
  preference: null,
};

export interface Classified {
  item: StorableItem;
  redactions: number;
}

/** Assigns layer, domain and sensitivity by rule, and removes secret-shaped text. */
export function classifyStage(c: Candidate, ctx: ClassifyContext): StageResult<Classified> {
  if (PRIVATE_KEY_PATTERN.test(c.text)) return { ok: false, reason: "contains_private_key" };
  const rule = CLASSIFICATION[c.contentType];
  const redactedText = redact(c.text) as string;
  const redactedProvenance = redact(c.provenance) as MemoryProvenance;
  const markers = (text: string) => text.match(/\[REDACTED\]/g)?.length ?? 0;
  const redactions = markers(redactedText) - markers(c.text);
  const truncated = redactedText.length > MAX_MEMORY_CHARS;
  const text = truncated ? `${redactedText.slice(0, MAX_MEMORY_CHARS - 1)}…` : redactedText;
  const stated = c.sensitivity ?? rule.sensitivity;
  // Text that held a secret is never public, even if the source said so.
  const sensitivity = redactions > 0 && stated === "public" ? "internal" : stated;
  const retentionDays =
    c.retentionDays === undefined ? ctx.retentionDays[rule.layer] : c.retentionDays;
  return {
    ok: true,
    value: {
      redactions,
      item: {
        dedupeKey: c.dedupeKey,
        source: c.source,
        sourceRef: c.sourceRef,
        owner: ctx.owner,
        scope: c.scope,
        layer: rule.layer,
        domain: rule.domain,
        kind: c.kind,
        text,
        observedAt: c.observedAt,
        freshnessTtlDays: c.freshnessTtlDays ?? null,
        sensitivity,
        provenance: {
          ...redactedProvenance,
          ...(redactions > 0 ? { redacted: true } : {}),
          ...(truncated ? { truncated: true } : {}),
        },
        confidence: c.confidence ?? (c.kind === "fact" ? 1 : 0.5),
        retentionDays,
      },
    },
  };
}

export type PolicyDecision = { ok: true } | { ok: false; reason: string };

/** Decides whether Phoenix may remember an item. Injected by the runtime. */
export interface MemoryPolicy {
  canStore(item: StorableItem): PolicyDecision;
}

export interface DefaultPolicyOptions {
  /** Is the capability (or ingestor) that produced the data enabled? */
  isSourceEnabled(source: string): boolean;
  /**
   * Has the user explicitly allowed sensitive data from this source into memory? Absent means no.
   * Phase 29 backs this with a setting.
   */
  allowSensitive?(source: string, domain: MemoryDomain): boolean;
}

/**
 * Public and internal data from enabled sources is allowed. Sensitive data needs an explicit
 * allow for that source and domain; unknown sources and disabled capabilities are refused.
 */
export function createDefaultPolicy(options: DefaultPolicyOptions): MemoryPolicy {
  return {
    canStore(item) {
      if (!options.isSourceEnabled(item.source)) {
        return { ok: false, reason: `source "${item.source}" is not enabled` };
      }
      if (
        item.sensitivity === "sensitive" &&
        options.allowSensitive?.(item.source, item.domain) !== true
      ) {
        return {
          ok: false,
          reason: `sensitive ${item.domain} data from "${item.source}" needs explicit permission`,
        };
      }
      return { ok: true };
    },
  };
}

export type CaptureOutcome =
  | { status: "stored"; item: MemoryItem }
  | { status: "duplicate"; item: MemoryItem }
  /** The user deleted this fact earlier; it is not captured again. */
  | { status: "tombstoned" }
  | { status: "refused"; reason: string }
  | { status: "rejected"; reason: RejectionReason };

export interface PipelineStats {
  stored: number;
  duplicate: number;
  tombstoned: number;
  /** Items that had secret-shaped text removed before storage. */
  redacted: number;
  /** Policy refusals, counted by the reason given. */
  refused: Record<string, number>;
  rejected: Partial<Record<RejectionReason, number>>;
}

export interface PipelineDeps {
  store: MemoryStore;
  policy: MemoryPolicy;
  owner: string;
  /**
   * Days to keep each layer. A function is read on every capture, so a retention change applies
   * to the next capture without rebuilding the pipeline.
   */
  retentionDays?: Record<MemoryLayer, number | null> | (() => Record<MemoryLayer, number | null>);
}

/** Runs captures through every stage and counts what happened. */
export class MemoryPipeline {
  private readonly counts: PipelineStats = {
    stored: 0,
    duplicate: 0,
    tombstoned: 0,
    redacted: 0,
    refused: {},
    rejected: {},
  };

  constructor(private readonly deps: PipelineDeps) {}

  capture(raw: RawCapture): CaptureOutcome {
    const candidate = captureStage(raw);
    if (!candidate.ok) return this.reject(candidate.reason);
    const classified = classifyStage(candidate.value, {
      owner: this.deps.owner,
      retentionDays: this.retentionDays(),
    });
    if (!classified.ok) return this.reject(classified.reason);
    const decision = this.deps.policy.canStore(classified.value.item);
    if (!decision.ok) {
      this.counts.refused[decision.reason] = (this.counts.refused[decision.reason] ?? 0) + 1;
      return { status: "refused", reason: decision.reason };
    }
    const result: InsertResult = this.deps.store.insert(classified.value.item);
    if (result.status === "stored") {
      this.counts.stored++;
      if (classified.value.redactions > 0) this.counts.redacted++;
    } else {
      this.counts[result.status]++;
    }
    return result;
  }

  private retentionDays(): Record<MemoryLayer, number | null> {
    const configured = this.deps.retentionDays;
    if (configured === undefined) return DEFAULT_RETENTION_DAYS;
    return typeof configured === "function" ? configured() : configured;
  }

  /** A copy of the counters since this pipeline was created. */
  stats(): PipelineStats {
    return {
      ...this.counts,
      refused: { ...this.counts.refused },
      rejected: { ...this.counts.rejected },
    };
  }

  private reject(reason: RejectionReason): CaptureOutcome {
    this.counts.rejected[reason] = (this.counts.rejected[reason] ?? 0) + 1;
    return { status: "rejected", reason };
  }
}
