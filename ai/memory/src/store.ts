// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Database } from "@phoenix/persistence";
import type { PrivacyClass } from "@phoenix/ai-models";
import type { MemoryDomain, MemoryItem, MemoryKind, MemoryLayer, MemoryProvenance } from "./types";

/** An item ready to be stored. The store adds id, timestamps, expiry and the index entry. */
export type StorableItem = Pick<
  MemoryItem,
  | "dedupeKey"
  | "source"
  | "sourceRef"
  | "owner"
  | "scope"
  | "layer"
  | "domain"
  | "kind"
  | "text"
  | "observedAt"
  | "freshnessTtlDays"
  | "sensitivity"
  | "provenance"
  | "confidence"
  | "retentionDays"
>;

export type InsertResult =
  /** New item stored and indexed. */
  | { status: "stored"; item: MemoryItem }
  /** The same source fact is already stored; only its last-confirmed time moved. */
  | { status: "duplicate"; item: MemoryItem }
  /** The user deleted this fact before. It is not captured again. */
  | { status: "tombstoned" };

export interface SearchQuery {
  /** FTS5 MATCH expression; build it with buildMatchQuery(). */
  match: string;
  domain?: MemoryDomain;
  /** Inclusive lower bound on observedAt (ISO). */
  observedFrom?: string;
  /** Exclusive upper bound on observedAt (ISO). */
  observedBefore?: string;
  limit: number;
  /**
   * Row-level filter run before an item counts toward `limit`. This is where permission checks
   * go: an item the caller may not see must be dropped here, not after the limit.
   */
  accept?: (item: MemoryItem) => boolean;
}

export interface ScoredMemory {
  item: MemoryItem;
  /** Higher is better. Negated bm25, so only comparable within one query. */
  score: number;
}

/** Selects live items by where they came from. Unset fields match everything. */
export interface SourceFilter {
  source?: string;
  domain?: MemoryDomain;
  sourceRef?: string;
}

export interface PurgeFilter extends SourceFilter {
  keepKeys?: readonly string[];
  keepSourceRefs?: readonly string[];
}

export interface ListQuery {
  domain?: MemoryDomain;
  limit: number;
  offset?: number;
  includeDeleted?: boolean;
}

/** The fields a permission check looks at. A MemoryItem satisfies it. */
export type Viewable = Pick<MemoryItem, "scope" | "domain" | "sensitivity">;

export interface BrowseQuery {
  /** Page filter. */
  domain?: MemoryDomain;
  layer?: MemoryLayer;
  limit: number;
  offset: number;
  /**
   * Permission filter. It is applied to EVERY candidate before anything is counted, so `total`,
   * `counts` and the page never reflect an item the caller may not see.
   */
  accept: (item: Viewable) => boolean;
}

export interface BrowsePage {
  /** Newest observed first. */
  items: MemoryItem[];
  /** Visible live items matching `domain` and `layer`. */
  total: number;
  /** Visible live items per domain matching `layer` (ignores `domain`, so filter chips can show it). */
  counts: Record<string, number>;
}

interface Row {
  seq: number;
  id: string;
  dedupe_key: string;
  source: string;
  source_ref: string;
  owner: string;
  scope: string;
  layer: MemoryLayer;
  domain: MemoryDomain;
  kind: MemoryKind;
  text: string;
  created_at: string;
  observed_at: string;
  last_confirmed_at: string;
  freshness_ttl_days: number | null;
  sensitivity: PrivacyClass;
  provenance: string;
  confidence: number;
  retention_days: number | null;
  expires_at: string | null;
  deleted_at: string | null;
  rank?: number;
}

function toItem(r: Row): MemoryItem {
  return {
    id: r.id,
    dedupeKey: r.dedupe_key,
    source: r.source,
    sourceRef: r.source_ref,
    owner: r.owner,
    scope: r.scope,
    layer: r.layer,
    domain: r.domain,
    kind: r.kind,
    text: r.text,
    createdAt: r.created_at,
    observedAt: r.observed_at,
    lastConfirmedAt: r.last_confirmed_at,
    freshnessTtlDays: r.freshness_ttl_days,
    sensitivity: r.sensitivity,
    provenance: JSON.parse(r.provenance) as MemoryProvenance,
    confidence: r.confidence,
    retentionDays: r.retention_days,
    expiresAt: r.expires_at,
    deletedAt: r.deleted_at,
  };
}

export interface MemoryStoreOptions {
  now?: () => Date;
  newId?: () => string;
}

/**
 * Memory items plus their lexical (bm25) index. The index lives in the same database and is kept
 * in step by insert() (in one transaction) and by triggers on delete/tombstone, so a removed item
 * can never be found again.
 */
export class MemoryStore {
  private readonly now: () => Date;
  private readonly newId: () => string;
  private savepoints = 0;

  constructor(
    private readonly db: Database,
    options: MemoryStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => `mem_${crypto.randomUUID().replaceAll("-", "")}`);
  }

  /** Stores and indexes one item, or reports that it is already there. */
  insert(input: StorableItem): InsertResult {
    const existing = this.row("dedupe_key", input.dedupeKey);
    if (existing) {
      if (existing.deleted_at) return { status: "tombstoned" };
      this.db
        .prepare("UPDATE memory_items SET last_confirmed_at = ? WHERE seq = ?")
        .run(this.stamp(), existing.seq);
      return {
        status: "duplicate",
        item: toItem({ ...existing, last_confirmed_at: this.stamp() }),
      };
    }
    const createdAt = this.stamp();
    const expiresAt =
      input.retentionDays === null
        ? null
        : new Date(Date.parse(createdAt) + input.retentionDays * 86_400_000).toISOString();
    const item: MemoryItem = {
      ...input,
      id: this.newId(),
      createdAt,
      lastConfirmedAt: createdAt,
      expiresAt,
      deletedAt: null,
    };
    this.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO memory_items (id, dedupe_key, source, source_ref, owner, scope, layer, domain, kind,
             text, created_at, observed_at, last_confirmed_at, freshness_ttl_days, sensitivity, provenance,
             confidence, retention_days, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          item.id,
          item.dedupeKey,
          item.source,
          item.sourceRef,
          item.owner,
          item.scope,
          item.layer,
          item.domain,
          item.kind,
          item.text,
          item.createdAt,
          item.observedAt,
          item.lastConfirmedAt,
          item.freshnessTtlDays,
          item.sensitivity,
          JSON.stringify(item.provenance),
          item.confidence,
          item.retentionDays,
          item.expiresAt,
        );
      this.db
        .prepare("INSERT INTO memory_fts (rowid, text) VALUES (?, ?)")
        .run(result.lastInsertRowid, item.text);
    });
    return { status: "stored", item };
  }

  get(id: string): MemoryItem | null {
    const r = this.row("id", id);
    return r ? toItem(r) : null;
  }

  /** Lexical search, best match first. Deleted and expired items are never returned. */
  search(q: SearchQuery): ScoredMemory[] {
    const filter = this.windowFilter(q, ["memory_fts MATCH ?"], [q.match]);
    return this.collect(
      `SELECT m.*, bm25(memory_fts) AS rank FROM memory_fts
         JOIN memory_items m ON m.seq = memory_fts.rowid
        WHERE ${filter.where} ORDER BY rank, m.seq`,
      filter.params,
      q,
      (r) => -(r.rank ?? 0),
    );
  }

  /** Items observed inside a window, newest first. Used when a question has a time but no topic. */
  recent(q: Omit<SearchQuery, "match">): ScoredMemory[] {
    const filter = this.windowFilter(q, [], []);
    return this.collect(
      `SELECT m.* FROM memory_items m WHERE ${filter.where} ORDER BY m.observed_at DESC, m.seq DESC`,
      filter.params,
      q,
      () => 0,
    );
  }

  /** Newest first. For browsing; not permission-filtered, so callers must filter. */
  list(q: ListQuery): MemoryItem[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (!q.includeDeleted) where.push("deleted_at IS NULL");
    if (q.domain) {
      where.push("domain = ?");
      params.push(q.domain);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM memory_items ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY observed_at DESC, seq DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, q.limit, q.offset ?? 0) as unknown as Row[];
    return rows.map(toItem);
  }

  /**
   * A page of live, unexpired memories the caller may see, with the totals for it. The permission
   * filter runs over a narrow projection first (no text is read for items that are not on the
   * page), then only the page's rows are loaded in full.
   */
  browse(q: BrowseQuery): BrowsePage {
    const where = ["deleted_at IS NULL", "(expires_at IS NULL OR expires_at > ?)"];
    const params: string[] = [this.stamp()];
    if (q.layer) {
      where.push("layer = ?");
      params.push(q.layer);
    }
    const counts: Record<string, number> = {};
    const pageSeqs: number[] = [];
    let total = 0;
    const candidates = this.db
      .prepare(
        `SELECT seq, domain, scope, sensitivity FROM memory_items WHERE ${where.join(" AND ")}
         ORDER BY observed_at DESC, seq DESC`,
      )
      .iterate(...params) as Iterable<Pick<Row, "seq" | "domain" | "scope" | "sensitivity">>;
    for (const c of candidates) {
      if (!q.accept(c)) continue;
      counts[c.domain] = (counts[c.domain] ?? 0) + 1;
      if (q.domain && c.domain !== q.domain) continue;
      if (total >= q.offset && pageSeqs.length < q.limit) pageSeqs.push(c.seq);
      total++;
    }
    return { items: this.bySeq(pageSeqs), total, counts };
  }

  /**
   * Tombstones every live item the caller may see (optionally one domain), expired-but-not-yet-
   * tombstoned items included. Returns how many. Text, provenance and index entries go; the
   * dedupe keys stay, so deleted facts are not captured again.
   */
  forgetWhere(q: { domain?: MemoryDomain; accept: (item: Viewable) => boolean }): number {
    const rows = this.db
      .prepare(
        `SELECT seq, domain, scope, sensitivity FROM memory_items WHERE deleted_at IS NULL${q.domain ? " AND domain = ?" : ""}`,
      )
      .all(...(q.domain ? [q.domain] : [])) as unknown as Pick<
      Row,
      "seq" | "domain" | "scope" | "sensitivity"
    >[];
    const stamp = this.stamp();
    let forgotten = 0;
    this.transaction(() => {
      const update = this.db.prepare(
        "UPDATE memory_items SET text = '', provenance = '{}', deleted_at = ? WHERE seq = ? AND deleted_at IS NULL",
      );
      for (const r of rows) if (q.accept(r)) forgotten += Number(update.run(stamp, r.seq).changes);
    });
    return forgotten;
  }

  /**
   * Retention is a setting per memory layer: every live item of the layer now expires `days` after
   * it was stored (null = never). Items already past that point expire on the next `expire()`.
   */
  setLayerRetention(layer: MemoryLayer, days: number | null): void {
    this.db
      .prepare(
        `UPDATE memory_items SET retention_days = ?,
           expires_at = CASE WHEN ? IS NULL THEN NULL
                        ELSE strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+' || ? || ' days') END
         WHERE layer = ? AND deleted_at IS NULL`,
      )
      .run(days, days, days, layer);
  }

  /**
   * The user deletes one memory. The text, provenance and index entry are purged; a tombstone
   * keeps the dedupe key so the same fact is not captured again.
   */
  forget(id: string): boolean {
    return this.tombstone("id = ?", [id]) > 0;
  }

  /** Tombstones every item whose expiry has passed. Returns how many. */
  expire(): number {
    return this.tombstone("expires_at IS NOT NULL AND expires_at <= ?", [this.stamp()]);
  }

  /**
   * Hard-deletes live items that a source no longer backs (a file was removed, a meeting was
   * deleted, a summary was regenerated). `keepKeys` spares items whose dedupe key is listed;
   * `keepSourceRefs` spares items of those source references. Tombstones are left alone, so a
   * user's deletion still blocks re-capture. Returns how many items were removed.
   */
  purge(filter: PurgeFilter): number {
    const keepKeys = new Set(filter.keepKeys);
    const keepRefs = new Set(filter.keepSourceRefs);
    const victims = this.liveRows(filter).filter(
      (r) => !keepKeys.has(r.dedupe_key) && !keepRefs.has(r.source_ref),
    );
    this.transaction(() => {
      const del = this.db.prepare("DELETE FROM memory_items WHERE seq = ?");
      for (const v of victims) del.run(v.seq);
    });
    return victims.length;
  }

  /** The distinct source references of live items matching the filter, sorted. */
  sourceRefs(filter: SourceFilter): string[] {
    return [...new Set(this.liveRows(filter).map((r) => r.source_ref))].sort();
  }

  /** Marks a source's live items as still true as of now (their file or record is unchanged). */
  confirm(source: string, sourceRef: string): void {
    this.db
      .prepare(
        "UPDATE memory_items SET last_confirmed_at = ? WHERE source = ? AND source_ref = ? AND deleted_at IS NULL",
      )
      .run(this.stamp(), source, sourceRef);
  }

  /** Live items that have not passed their expiry: what the browser can show. */
  countUnexpired(): number {
    const stamp = this.stamp();
    const r = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM memory_items WHERE deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
      )
      .get(stamp) as unknown as { n: number };
    return r.n;
  }

  count(options: { includeDeleted?: boolean } = {}): number {
    const sql = `SELECT COUNT(*) AS n FROM memory_items${options.includeDeleted ? "" : " WHERE deleted_at IS NULL"}`;
    return this.scalar(sql);
  }

  /** Rows in the lexical index. Equals the number of live items when nothing is out of step. */
  indexedCount(): number {
    return this.scalar("SELECT COUNT(*) AS n FROM memory_fts_docsize");
  }

  sourceHash(sourceKey: string): string | null {
    const r = this.db
      .prepare("SELECT content_hash FROM memory_sources WHERE source_key = ?")
      .get(sourceKey) as { content_hash: string } | undefined;
    return r?.content_hash ?? null;
  }

  setSourceHash(sourceKey: string, kind: string, contentHash: string): void {
    this.db
      .prepare(
        `INSERT INTO memory_sources (source_key, kind, content_hash, ingested_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(source_key) DO UPDATE SET content_hash = excluded.content_hash, ingested_at = excluded.ingested_at`,
      )
      .run(sourceKey, kind, contentHash, this.stamp());
  }

  clearSourceHash(sourceKey: string): void {
    this.db.prepare("DELETE FROM memory_sources WHERE source_key = ?").run(sourceKey);
  }

  /** WHERE clause shared by search and recent: live, unexpired, in the domain and time window. */
  private windowFilter(
    q: Omit<SearchQuery, "match">,
    where: string[],
    params: (string | number)[],
  ): { where: string; params: (string | number)[] } {
    const clauses = [
      ...where,
      "m.deleted_at IS NULL",
      "(m.expires_at IS NULL OR m.expires_at > ?)",
    ];
    const args = [...params, this.stamp()];
    if (q.domain) {
      clauses.push("m.domain = ?");
      args.push(q.domain);
    }
    if (q.observedFrom) {
      clauses.push("m.observed_at >= ?");
      args.push(q.observedFrom);
    }
    if (q.observedBefore) {
      clauses.push("m.observed_at < ?");
      args.push(q.observedBefore);
    }
    return { where: clauses.join(" AND "), params: args };
  }

  /** Runs a ranked query and applies `accept` before `limit`, so filtered rows never use a slot. */
  private collect(
    sql: string,
    params: (string | number)[],
    q: Pick<SearchQuery, "limit" | "accept">,
    score: (row: Row) => number,
  ): ScoredMemory[] {
    const out: ScoredMemory[] = [];
    for (const r of this.db.prepare(sql).iterate(...params) as Iterable<Row>) {
      const item = toItem(r);
      if (q.accept && !q.accept(item)) continue;
      out.push({ item, score: score(r) });
      if (out.length >= q.limit) break;
    }
    return out;
  }

  /** Full rows for the given seqs, in the order given. */
  private bySeq(seqs: readonly number[]): MemoryItem[] {
    if (seqs.length === 0) return [];
    const rows = this.db
      .prepare(`SELECT * FROM memory_items WHERE seq IN (${seqs.map(() => "?").join(",")})`)
      .all(...seqs) as unknown as Row[];
    const bySeq: Record<number, Row> = {};
    for (const r of rows) bySeq[r.seq] = r;
    return seqs.flatMap((seq) => (bySeq[seq] ? [toItem(bySeq[seq])] : []));
  }

  private liveRows(filter: SourceFilter): Row[] {
    const where = ["deleted_at IS NULL"];
    const params: string[] = [];
    if (filter.source !== undefined) {
      where.push("source = ?");
      params.push(filter.source);
    }
    if (filter.domain !== undefined) {
      where.push("domain = ?");
      params.push(filter.domain);
    }
    if (filter.sourceRef !== undefined) {
      where.push("source_ref = ?");
      params.push(filter.sourceRef);
    }
    return this.db
      .prepare(`SELECT * FROM memory_items WHERE ${where.join(" AND ")}`)
      .all(...params) as unknown as Row[];
  }

  private tombstone(condition: string, params: string[]): number {
    const stamp = this.stamp();
    const r = this.db
      .prepare(
        `UPDATE memory_items SET text = '', provenance = '{}', deleted_at = ?
          WHERE deleted_at IS NULL AND ${condition}`,
      )
      .run(stamp, ...params);
    return Number(r.changes);
  }

  private scalar(sql: string): number {
    // node:sqlite types rows loosely; a COUNT(*) AS n query always yields {n: number}.
    const row = this.db.prepare(sql).get() as unknown as { n: number };
    return row.n;
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  private row(column: "id" | "dedupe_key", value: string): Row | undefined {
    return this.db.prepare(`SELECT * FROM memory_items WHERE ${column} = ?`).get(value) as
      Row | undefined;
  }

  /** Savepoints nest, so this is safe inside a caller's transaction. */
  private transaction(fn: () => void): void {
    const name = `memory_${this.savepoints++}`;
    this.db.exec(`SAVEPOINT ${name}`);
    try {
      fn();
      this.db.exec(`RELEASE ${name}`);
    } catch (err) {
      this.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
      throw err;
    }
  }
}
