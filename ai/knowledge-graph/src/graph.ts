// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The property graph (ADR-0020): nodes, edges and provenance rows in the Phoenix SQLite database.
//
// Rules the rest of the package relies on:
//   - A node or edge has no content of its own. Everything descriptive, and everything a permission
//     check needs (scope, domain, sensitivity), is on its provenance rows. The schema's triggers
//     remove a node/edge with its last provenance row, so deleting a source deletes exactly what only
//     that source supported.
//   - Every read takes a Viewer. A provenance row the viewer cannot read does not exist for them: a
//     node or edge with no readable row is invisible, and so are its contributions to any count.
//   - AI-asserted rows never make a fact. An edge is `proposed` for a viewer until a readable row from
//     a rule, capability or user stands behind it.
import { createHash } from "node:crypto";
import type { StatementSync } from "node:sqlite";
import { PRIVACY_CLASSES, type PrivacyClass } from "@phoenix/ai-models";
import { MEMORY_DOMAINS, canView, type MemoryDomain, type Viewer } from "@phoenix/ai-memory";
import { redact } from "@phoenix/logging";
import type { Database } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import {
  ASSERTOR_PATTERN,
  RELATION_SCHEMA,
  SOURCE_KINDS,
  isNodeType,
  isRelation,
  type AssertionStatus,
  type Detail,
  type Assertor,
  type EdgeView,
  type NodeRef,
  type NodeType,
  type NodeView,
  type ProvenanceInput,
  type ProvenanceView,
  type Relation,
  type SourceKind,
} from "./types";

/** Longest natural key. Longer text is not an identity. */
export const MAX_KEY_CHARS = 300;
const MAX_DETAIL_CHARS = 2000;
const MAX_DETAIL_VALUE_CHARS = 300;
const CONTROL = /[\u0000-\u001f\u007f]/;
const EMAIL_LIKE = /\S+@\S+/;

interface NodeRow {
  id: string;
  type: NodeType;
  key: string;
}

interface EdgeRow {
  id: string;
  src: string;
  rel: Relation;
  dst: string;
}

interface ProvRow {
  source_kind: SourceKind;
  source_id: string;
  parent_key: string | null;
  capability: string;
  observed_at: string;
  recorded_at: string;
  confidence: number;
  asserted_by: string;
  scope: string;
  domain: string;
  sensitivity: PrivacyClass;
  detail: string;
}

interface CountRow {
  n: number;
}

interface PendingRow {
  subject_id: string;
  source_kind: SourceKind;
  source_id: string;
  parent_key: string | null;
  capability: string;
  observed_at: string;
  confidence: number;
  asserted_by: string;
  scope: string;
  domain: string;
  sensitivity: PrivacyClass;
  short: string;
}

/** A CI run whose commit was reported as a short hash. */
export interface PendingRunLink {
  /** `<repo>/run/<id>`, the run's natural key. */
  run: string;
  shortSha: string;
  provenance: ProvenanceInput;
}

interface Counts {
  nodes: number;
  edges: number;
  provenance: number;
}

/** What a removal took out of the graph. */
export interface RemovalReport {
  provenance: number;
  nodes: number;
  edges: number;
}

export interface GraphOptions {
  now?: () => Date;
}

export type EdgeDirection = "out" | "in" | "both";

export interface AdjacencyOptions {
  direction?: EdgeDirection;
  rel?: Relation;
  /** Proposed (AI-only) edges are left out unless this is true. */
  includeProposed?: boolean;
  /** Most visible edges to return. */
  limit: number;
}

export interface Adjacency {
  edges: EdgeView[];
  /** True when a further visible edge exists beyond `limit`. Counts only edges the viewer can see. */
  truncated: boolean;
}

/** Per-call memo of which nodes the viewer may see, so a traversal asks the database once per node. */
export type VisibilityMemo = Record<string, boolean>;

export function nodeId(ref: NodeRef): string {
  return `${ref.type}:${ref.key}`;
}

export function edgeId(src: string, rel: Relation, dst: string): string {
  return `${src}|${rel}|${dst}`;
}

/** Splits `Type:key` back into a ref. Null when the text is not a valid node id. */
export function parseNodeId(id: string): NodeRef | null {
  const at = id.indexOf(":");
  if (at <= 0) return null;
  const type = id.slice(0, at);
  const key = id.slice(at + 1);
  return isNodeType(type) && keyProblem(type, key) === null ? { type, key } : null;
}

/** Why a key cannot identify a node of this type, or null when it can. */
export function keyProblem(type: NodeType, key: string): string | null {
  if (key.length === 0 || key !== key.trim()) return "key must be non-empty and trimmed";
  if (key.length > MAX_KEY_CHARS) return `key is longer than ${MAX_KEY_CHARS} characters`;
  if (CONTROL.test(key)) return "key contains control characters";
  if (key.includes("|")) return "key contains the edge separator '|'";
  if (type === "Person" && EMAIL_LIKE.test(key))
    return "a Person is a name or login, never an email";
  return null;
}

/**
 * The identity of a person: their name or login, trimmed, single-spaced and lower-cased (the display
 * name travels in provenance detail). Null when the text cannot identify a person: empty, too long,
 * or email-shaped (emails are never stored).
 */
export function personKeyOf(name: string): string | null {
  const key = name.trim().replace(/\s+/g, " ").toLowerCase();
  return keyProblem("Person", key) === null ? key : null;
}

function invalid(message: string): PhoenixError {
  return new PhoenixError(ErrorCode.INVALID_REQUEST, message);
}

function toIso(value: string, what: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw invalid(`${what} is not a date`);
  return new Date(ms).toISOString();
}

function isDomain(value: string): value is MemoryDomain {
  return (MEMORY_DOMAINS as readonly string[]).includes(value);
}

function isPrivacy(value: string): value is PrivacyClass {
  return (PRIVACY_CLASSES as readonly string[]).includes(value);
}

/** Clips, secret-redacts and size-limits provenance detail. Throws on non-flat values. */
function cleanDetail(detail: Detail | undefined): string {
  const out: Detail = {};
  for (const [k, v] of Object.entries(detail ?? {})) {
    if (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
      throw invalid(`detail.${k} must be a string, number, boolean or null`);
    }
    const safe = typeof v === "string" ? redactText(v) : v;
    out[k] = typeof safe === "string" ? safe.slice(0, MAX_DETAIL_VALUE_CHARS) : safe;
  }
  const json = JSON.stringify(redact(out));
  if (json.length > MAX_DETAIL_CHARS) throw invalid("detail is too large");
  return json;
}

function redactText(text: string): string {
  const cleaned = redact(text);
  return typeof cleaned === "string" ? cleaned : "";
}

function parseDetail(json: string): Detail {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Detail = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function isAssertor(value: string): value is Assertor {
  return ASSERTOR_PATTERN.test(value);
}

function suppressionHash(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

function toView(r: ProvRow): ProvenanceView {
  return {
    sourceKind: r.source_kind,
    sourceId: r.source_id,
    capability: r.capability,
    observedAt: r.observed_at,
    recordedAt: r.recorded_at,
    confidence: r.confidence,
    assertedBy: r.asserted_by,
    scope: r.scope,
    domain: isDomain(r.domain) ? r.domain : "general",
    sensitivity: r.sensitivity,
    detail: parseDetail(r.detail),
  };
}

/** Oldest first, so that when details are merged the newest observation wins. */
function byObserved(a: ProvenanceView, b: ProvenanceView): number {
  return a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0;
}

function statusOf(rows: readonly ProvenanceView[]): AssertionStatus {
  return rows.some((r) => !r.assertedBy.startsWith("ai:")) ? "fact" : "proposed";
}

function labelOf(detail: Detail, key: string): string {
  for (const field of ["title", "name", "label"]) {
    const v = detail[field];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return key;
}

export class KnowledgeGraph {
  private readonly now: () => Date;
  private readonly statements: Record<string, StatementSync> = {};
  private savepoints = 0;

  constructor(
    private readonly db: Database,
    options: GraphOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  // ---------------------------------------------------------------- writes

  /** Creates the node if needed and records one provenance row. Null when the node may not exist. */
  upsertNode(ref: NodeRef, provenance: ProvenanceInput): string | null {
    let id: string | null = null;
    this.transaction(() => {
      id = this.ensureNode(ref, provenance);
      if (id !== null) this.addProvenance("node", id, provenance);
    });
    return id;
  }

  /**
   * Creates the edge (and its endpoints, with the same provenance but no detail) and records one
   * provenance row. Null when a suppressed person or a rejected AI proposal blocks it. Throws when
   * the relation does not join these node types.
   */
  assertEdge(
    src: NodeRef,
    rel: Relation,
    dst: NodeRef,
    provenance: ProvenanceInput,
  ): string | null {
    if (!isRelation(rel)) throw invalid(`unknown relation "${String(rel)}"`);
    const schema = RELATION_SCHEMA[rel];
    if (!schema.from.includes(src.type) || !schema.to.includes(dst.type)) {
      throw invalid(`${rel} does not join ${src.type} to ${dst.type}`);
    }
    const id = edgeId(nodeId(src), rel, nodeId(dst));
    this.validateProvenance(provenance);
    for (const ref of [src, dst]) {
      const problem = keyProblem(ref.type, ref.key);
      if (problem) throw invalid(`${ref.type}: ${problem}`);
    }
    if (this.isSuppressed(nodeId(src)) || this.isSuppressed(nodeId(dst))) return null;
    if (provenance.assertedBy.startsWith("ai:") && this.isRejected(id)) return null;
    let result: string | null = null;
    this.transaction(() => {
      const endpoint: ProvenanceInput = { ...provenance, detail: {} };
      this.upsertNode(src, endpoint);
      this.upsertNode(dst, endpoint);
      this.db
        .prepare(
          "INSERT OR IGNORE INTO kg_edges (id, src, rel, dst, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(id, nodeId(src), rel, nodeId(dst), this.stamp());
      this.addProvenance("edge", id, provenance);
      if (!provenance.assertedBy.startsWith("ai:")) {
        this.db.prepare("DELETE FROM kg_rejected WHERE edge_id = ?").run(id);
      }
      result = id;
    });
    return result;
  }

  /**
   * Withdraws what one capability said about an edge (an issue that is no longer assigned): its
   * provenance rows go, and the edge goes with its last row. Other sources keep it alive.
   */
  retractEdge(src: NodeRef, rel: Relation, dst: NodeRef, capability: string): number {
    const id = edgeId(nodeId(src), rel, nodeId(dst));
    return Number(
      this.db
        .prepare(
          "DELETE FROM kg_provenance WHERE subject_kind = 'edge' AND subject_id = ? AND capability = ?",
        )
        .run(id, capability).changes,
    );
  }

  /**
   * The user confirms a proposed edge: a `user` row is added next to the AI rows (the origin chain
   * keeps both), and the edge's AI-only endpoints are confirmed with it. False when the viewer
   * cannot see the edge or it has no AI row to confirm.
   */
  confirmEdge(viewer: Viewer, id: string, userId: string): boolean {
    const edge = this.edgeRow(id);
    if (!edge || userId.length === 0 || CONTROL.test(userId)) return false;
    const rows = this.visibleRows(viewer, "edge", id);
    const ai = rows.find((r) => r.asserted_by.startsWith("ai:"));
    if (!ai || rows.some((r) => !r.asserted_by.startsWith("ai:"))) return false;
    this.transaction(() => {
      for (const [kind, subject] of [
        ["edge", id],
        ["node", edge.src],
        ["node", edge.dst],
      ] as const) {
        const visible = this.visibleRows(viewer, kind, subject);
        if (visible.length === 0 || visible.some((r) => !r.asserted_by.startsWith("ai:"))) continue;
        this.addProvenance(kind, subject, {
          sourceKind: "user",
          sourceId: `confirm:${userId}`,
          ...(ai.parent_key ? { parentKey: ai.parent_key } : {}),
          capability: "user",
          observedAt: this.stamp(),
          confidence: 1,
          assertedBy: "user",
          scope: ai.scope,
          domain: isDomain(ai.domain) ? ai.domain : "general",
          sensitivity: ai.sensitivity,
          detail: {},
        });
      }
    });
    return true;
  }

  /** The user rejects a proposed edge. It is deleted and AI will not propose it again. */
  rejectEdge(viewer: Viewer, id: string): boolean {
    if (!this.edgeRow(id) || this.visibleRows(viewer, "edge", id).length === 0) return false;
    this.transaction(() => {
      this.db.prepare("DELETE FROM kg_edges WHERE id = ?").run(id);
      this.db
        .prepare("INSERT OR REPLACE INTO kg_rejected (edge_id, rejected_at) VALUES (?, ?)")
        .run(id, this.stamp());
    });
    return true;
  }

  /** Removes everything that only one source (one memory, one event, one meeting item) supported. */
  removeSource(kind: SourceKind, sourceId: string): RemovalReport {
    return this.removing(() =>
      this.db
        .prepare("DELETE FROM kg_provenance WHERE source_kind = ? AND source_id = ?")
        .run(kind, sourceId),
    );
  }

  /** Removes everything derived from a record, for example `meeting:<id>`. */
  removeParent(parentKey: string): RemovalReport {
    return this.removing(() =>
      this.db.prepare("DELETE FROM kg_provenance WHERE parent_key = ?").run(parentKey),
    );
  }

  /** Removes everything one capability (or one kind of source) supported. */
  removeWhere(filter: { capability?: string; sourceKind?: SourceKind }): RemovalReport {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.capability !== undefined) {
      where.push("capability = ?");
      params.push(filter.capability);
    }
    if (filter.sourceKind !== undefined) {
      where.push("source_kind = ?");
      params.push(filter.sourceKind);
    }
    if (where.length === 0)
      throw invalid("removeWhere needs a filter; use clear() to empty the graph");
    return this.removing(() =>
      this.db.prepare(`DELETE FROM kg_provenance WHERE ${where.join(" AND ")}`).run(...params),
    );
  }

  /** Empties the graph (nodes, edges, provenance). Rejections and suppressions are kept. */
  clear(): RemovalReport {
    return this.removing(() => this.db.prepare("DELETE FROM kg_provenance").run());
  }

  /**
   * "Forget this person": the node, its edges and all their provenance are deleted, and the name is
   * suppressed (as a hash, so the name is not kept) so ingestion does not bring the person back.
   */
  forgetPerson(name: string): RemovalReport {
    const key = personKeyOf(name);
    if (key === null) return { provenance: 0, nodes: 0, edges: 0 };
    const id = nodeId({ type: "Person", key });
    return this.removing(() => {
      this.db
        .prepare("INSERT OR REPLACE INTO kg_suppressed (id_hash, suppressed_at) VALUES (?, ?)")
        .run(suppressionHash(id), this.stamp());
      return this.db.prepare("DELETE FROM kg_nodes WHERE id = ?").run(id);
    });
  }

  /** Lifts a "forget this person" suppression, so the person can be ingested again. */
  allowPerson(name: string): boolean {
    const key = personKeyOf(name);
    if (key === null) return false;
    return (
      Number(
        this.db
          .prepare("DELETE FROM kg_suppressed WHERE id_hash = ?")
          .run(suppressionHash(nodeId({ type: "Person", key }))).changes,
      ) > 0
    );
  }

  /** Runs `fn` atomically. Safe inside another transaction. */
  transaction(fn: () => void): void {
    const name = `kg_${this.savepoints++}`;
    this.db.exec(`SAVEPOINT ${name}`);
    try {
      fn();
      this.db.exec(`RELEASE ${name}`);
    } catch (err) {
      this.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
      throw err;
    }
  }

  // ----------------------------------------------------------------- reads

  /** Row counts for the whole graph, unscoped. For tests and diagnostics, never for a viewer. */
  stats(): Counts {
    const n = (table: string): number => {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
        .get() as unknown as CountRow;
      return Number(row.n);
    };
    return { nodes: n("kg_nodes"), edges: n("kg_edges"), provenance: n("kg_provenance") };
  }

  /** The node as the viewer sees it, or null when it does not exist or nothing about it is readable. */
  node(viewer: Viewer, id: string, memo: VisibilityMemo = {}): NodeView | null {
    const row = this.nodeRow(id);
    if (!row) return null;
    const rows = this.visibleRows(viewer, "node", id).map(toView).sort(byObserved);
    memo[id] = rows.length > 0;
    if (rows.length === 0) return null;
    const detail: Detail = Object.assign({}, ...rows.map((r) => r.detail));
    return {
      id,
      type: row.type,
      key: row.key,
      label: labelOf(detail, row.key),
      status: statusOf(rows),
      detail,
      provenance: rows,
    };
  }

  /** Cheap visibility test for traversal; memoised in `memo`. */
  isNodeVisible(viewer: Viewer, id: string, memo: VisibilityMemo): boolean {
    const known = memo[id];
    if (known !== undefined) return known;
    const visible =
      this.nodeRow(id) !== undefined && this.visibleRows(viewer, "node", id).length > 0;
    memo[id] = visible;
    return visible;
  }

  /** The visible edges around a node. An edge is visible when a readable row backs it and both ends are visible. */
  adjacent(
    viewer: Viewer,
    id: string,
    options: AdjacencyOptions,
    memo: VisibilityMemo = {},
  ): Adjacency {
    const direction = options.direction ?? "both";
    const edges: EdgeView[] = [];
    let truncated = false;
    const scan = (column: "src" | "dst"): void => {
      if (truncated) return;
      const sql =
        `SELECT id, src, rel, dst FROM kg_edges WHERE ${column} = ?` +
        (options.rel ? " AND rel = ?" : "");
      const params = options.rel ? [id, options.rel] : [id];
      for (const row of this.prepare(sql).iterate(...params) as Iterable<EdgeRow>) {
        const view = this.visibleEdge(viewer, row, memo);
        if (!view || (view.status === "proposed" && options.includeProposed !== true)) continue;
        if (edges.length >= options.limit) {
          truncated = true;
          return;
        }
        edges.push(view);
      }
    };
    if (direction !== "in") scan("src");
    if (direction !== "out") scan("dst");
    return { edges, truncated };
  }

  /** One edge as the viewer sees it, or null. */
  edge(viewer: Viewer, id: string, memo: VisibilityMemo = {}): EdgeView | null {
    const row = this.edgeRow(id);
    return row ? this.visibleEdge(viewer, row, memo) : null;
  }

  /**
   * Visible nodes whose id, or key (any letter case), is exactly `text`. Exact only: no prefix, no
   * fuzzy match. At most `limit` are returned.
   */
  findExact(viewer: Viewer, text: string, limit: number): NodeView[] {
    const rows = this.prepare(
      "SELECT id FROM kg_nodes WHERE id = ? OR key_lc = ? ORDER BY id LIMIT ?",
    ).all(text, text.toLowerCase(), limit * 4) as unknown as { id: string }[];
    return this.firstVisible(
      viewer,
      rows.map((r) => r.id),
      limit,
    );
  }

  /** Visible nodes of one type whose key ends with `suffix` (a path, a run number), any letter case. */
  findBySuffix(viewer: Viewer, type: NodeType, suffix: string, limit: number): NodeView[] {
    const escaped = suffix.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = this.prepare(
      "SELECT id FROM kg_nodes WHERE type = ? AND key_lc LIKE ? ESCAPE '\\' ORDER BY id LIMIT ?",
    ).all(type, `%${escaped}`, limit * 4) as unknown as { id: string }[];
    return this.firstVisible(
      viewer,
      rows.map((r) => r.id),
      limit,
    );
  }

  /** Visible commits whose full hash starts with `prefix` (7+ hex digits). */
  findCommitsByHash(viewer: Viewer, prefix: string, limit: number): NodeView[] {
    if (!/^[0-9a-f]{7,40}$/i.test(prefix)) return [];
    const rows = this.prepare(
      "SELECT id FROM kg_nodes WHERE type = 'Commit' AND key_lc LIKE ? ESCAPE '\\' ORDER BY id LIMIT ?",
    ).all(`%@${prefix.toLowerCase()}%`, limit * 4) as unknown as { id: string }[];
    return this.firstVisible(
      viewer,
      rows.map((r) => r.id),
      limit,
    );
  }

  /** Visible nodes of one type, in id order. */
  listByType(viewer: Viewer, type: NodeType, limit: number, offset = 0): NodeView[] {
    const rows = this.prepare(
      "SELECT id FROM kg_nodes WHERE type = ? ORDER BY id LIMIT ? OFFSET ?",
    ).all(type, limit * 4, offset) as unknown as { id: string }[];
    return this.firstVisible(
      viewer,
      rows.map((r) => r.id),
      limit,
    );
  }

  /** The distinct project prefixes of issue keys already in the graph (`ENG` for `ENG-12`). */
  issuePrefixes(): string[] {
    const rows = this.db
      .prepare(
        "SELECT DISTINCT substr(key, 1, instr(key, '-') - 1) AS prefix FROM kg_nodes WHERE type = 'Issue' AND key GLOB '[A-Z]*-[0-9]*'",
      )
      .all() as unknown as { prefix: string }[];
    return rows.map((r) => r.prefix).filter((p) => /^[A-Z][A-Z0-9]{1,9}$/.test(p));
  }

  /**
   * Full hashes of the Commit nodes of `repo` that start with `prefix`, whoever may see them.
   * Ingestion only: it resolves a short hash a capability reported, and never reaches a reader.
   */
  commitsWithPrefix(repo: string, prefix: string, limit: number): string[] {
    if (!/^[0-9a-f]{7,40}$/i.test(prefix)) return [];
    const rows = this.prepare(
      "SELECT key FROM kg_nodes WHERE type = 'Commit' AND key_lc >= ? AND key_lc < ? LIMIT ?",
    ).all(
      `${repo.toLowerCase()}@${prefix.toLowerCase()}`,
      `${repo.toLowerCase()}@${prefix.toLowerCase()}\uffff`,
      limit,
    ) as unknown as { key: string }[];
    return rows.map((r) => r.key.slice(r.key.indexOf("@") + 1));
  }

  /**
   * CI runs that named a commit by a short hash (`detail.commit`) and could not be linked yet,
   * with the provenance row that said so. Ingestion only.
   */
  pendingRunLinks(repo: string, fullSha?: string): PendingRunLink[] {
    const rows = this.prepare(
      `SELECT subject_id, source_kind, source_id, parent_key, capability, observed_at, confidence,
              asserted_by, scope, domain, sensitivity, json_extract(detail, '$.commit') AS short
       FROM kg_provenance
       WHERE subject_kind = 'node' AND subject_id GLOB ? AND json_extract(detail, '$.commit') IS NOT NULL`,
    ).all(`CIRun:${repo.replace(/[[*?]/g, "[$&]")}/run/*`) as unknown as PendingRow[];
    return rows
      .filter((r) => fullSha === undefined || fullSha.startsWith(r.short))
      .map((r) => ({
        run: r.subject_id.slice("CIRun:".length),
        shortSha: r.short,
        provenance: {
          sourceKind: r.source_kind,
          sourceId: r.source_id,
          ...(r.parent_key ? { parentKey: r.parent_key } : {}),
          capability: r.capability,
          observedAt: r.observed_at,
          confidence: r.confidence,
          assertedBy: isAssertor(r.asserted_by) ? r.asserted_by : "capability",
          scope: r.scope,
          domain: isDomain(r.domain) ? r.domain : "general",
          sensitivity: r.sensitivity,
        },
      }));
  }

  /** Whether a node of this exact id exists, ignoring permissions. Used by ingestion only. */
  hasNode(id: string): boolean {
    return this.nodeRow(id) !== undefined;
  }

  // -------------------------------------------------------------- internals

  private firstVisible(viewer: Viewer, ids: readonly string[], limit: number): NodeView[] {
    const out: NodeView[] = [];
    for (const id of ids) {
      if (out.length >= limit) break;
      const view = this.node(viewer, id);
      if (view) out.push(view);
    }
    return out;
  }

  private prepare(sql: string): StatementSync {
    return (this.statements[sql] ??= this.db.prepare(sql));
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  private nodeRow(id: string): NodeRow | undefined {
    return this.prepare("SELECT id, type, key FROM kg_nodes WHERE id = ?").get(id) as
      NodeRow | undefined;
  }

  private edgeRow(id: string): EdgeRow | undefined {
    return this.prepare("SELECT id, src, rel, dst FROM kg_edges WHERE id = ?").get(id) as
      EdgeRow | undefined;
  }

  private isSuppressed(id: string): boolean {
    return (
      this.prepare("SELECT 1 AS x FROM kg_suppressed WHERE id_hash = ?").get(
        suppressionHash(id),
      ) !== undefined
    );
  }

  private isRejected(edge: string): boolean {
    return this.prepare("SELECT 1 AS x FROM kg_rejected WHERE edge_id = ?").get(edge) !== undefined;
  }

  private validateProvenance(p: ProvenanceInput): void {
    if (!(SOURCE_KINDS as readonly string[]).includes(p.sourceKind))
      throw invalid("unknown source kind");
    if (p.sourceId.length === 0 || p.sourceId.length > 300 || CONTROL.test(p.sourceId)) {
      throw invalid("sourceId must be 1-300 printable characters");
    }
    if (!ASSERTOR_PATTERN.test(p.assertedBy))
      throw invalid("assertedBy must be rule, capability, user or ai:<model>");
    if (p.confidence !== undefined && !(p.confidence >= 0 && p.confidence <= 1)) {
      throw invalid("confidence must be between 0 and 1");
    }
    if (!isPrivacy(p.sensitivity)) throw invalid("unknown sensitivity");
    if (!isDomain(p.domain)) throw invalid("unknown domain");
    if (p.scope.length === 0 || p.scope.length > 400)
      throw invalid("scope must be 1-400 characters");
    if (p.capability.length === 0 || p.capability.length > 100)
      throw invalid("capability must be 1-100 characters");
  }

  /** Creates the node row when needed. Null when the person was forgotten. */
  private ensureNode(ref: NodeRef, provenance: ProvenanceInput): string | null {
    if (!isNodeType(ref.type)) throw invalid(`unknown node type "${String(ref.type)}"`);
    const problem = keyProblem(ref.type, ref.key);
    if (problem) throw invalid(`${ref.type}: ${problem}`);
    this.validateProvenance(provenance);
    const id = nodeId(ref);
    if (this.isSuppressed(id)) return null;
    this.prepare(
      "INSERT OR IGNORE INTO kg_nodes (id, type, key, key_lc, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, ref.type, ref.key, ref.key.toLowerCase(), this.stamp());
    return id;
  }

  private addProvenance(kind: "node" | "edge", subject: string, p: ProvenanceInput): void {
    this.validateProvenance(p);
    this.prepare(
      `INSERT INTO kg_provenance (subject_kind, subject_id, source_kind, source_id, parent_key, capability,
         observed_at, recorded_at, confidence, asserted_by, scope, domain, sensitivity, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (subject_kind, subject_id, source_kind, source_id, asserted_by) DO UPDATE SET
         parent_key = excluded.parent_key, capability = excluded.capability,
         observed_at = excluded.observed_at, recorded_at = excluded.recorded_at,
         confidence = excluded.confidence, scope = excluded.scope, domain = excluded.domain,
         sensitivity = excluded.sensitivity,
         detail = CASE WHEN excluded.detail = '{}' THEN detail ELSE excluded.detail END`,
    ).run(
      kind,
      subject,
      p.sourceKind,
      p.sourceId,
      p.parentKey ?? null,
      p.capability,
      toIso(p.observedAt, "observedAt"),
      this.stamp(),
      p.confidence ?? 1,
      p.assertedBy,
      p.scope,
      p.domain,
      p.sensitivity,
      cleanDetail(p.detail),
    );
  }

  private visibleRows(viewer: Viewer, kind: "node" | "edge", subject: string): ProvRow[] {
    const rows = this.prepare(
      `SELECT source_kind, source_id, parent_key, capability, observed_at, recorded_at, confidence,
              asserted_by, scope, domain, sensitivity, detail
       FROM kg_provenance WHERE subject_kind = ? AND subject_id = ?`,
    ).all(kind, subject) as unknown as ProvRow[];
    return rows.filter((r) =>
      canView(viewer, {
        scope: r.scope,
        domain: isDomain(r.domain) ? r.domain : "general",
        sensitivity: r.sensitivity,
      }),
    );
  }

  private visibleEdge(viewer: Viewer, row: EdgeRow, memo: VisibilityMemo): EdgeView | null {
    const rows = this.visibleRows(viewer, "edge", row.id).map(toView).sort(byObserved);
    if (rows.length === 0) return null;
    if (!this.isNodeVisible(viewer, row.src, memo) || !this.isNodeVisible(viewer, row.dst, memo)) {
      return null;
    }
    return {
      id: row.id,
      src: row.src,
      rel: row.rel,
      dst: row.dst,
      status: statusOf(rows),
      provenance: rows,
    };
  }

  /** Runs a deleting statement and reports how much of the graph went with it. */
  private removing(run: () => unknown): RemovalReport {
    const before = this.stats();
    this.transaction(() => void run());
    const after = this.stats();
    return {
      provenance: before.provenance - after.provenance,
      nodes: before.nodes - after.nodes,
      edges: before.edges - after.edges,
    };
  }
}
