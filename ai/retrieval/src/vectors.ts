// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Vector index in plain SQLite (no extension). Vectors are L2-normalised Float32 little-endian
// blobs, so cosine similarity is a dot product. Search is a brute-force scan over a bounded
// candidate set.
//
// Practical ceiling: every query reads and scores each candidate vector. Measured numbers are in
// docs/phases/phase-37-hybrid-retrieval.md; the scan is capped at `maxScan` rows (default 50 000,
// newest first) and the result says when the cap cut candidates off. Past a few tens of thousands
// of memories an approximate index would be needed; that is deliberately not built.
//
// Deletion: a memory that is tombstoned, expired or hard-deleted loses its vector in the same
// transaction (triggers in migration 10). Search additionally joins live, unexpired items, so a
// vector that somehow outlived its memory is never returned either.
import type { MemoryDomain, MemoryItem } from "@phoenix/ai-memory";
import type { PrivacyClass } from "@phoenix/ai-models";
import type { Database } from "@phoenix/persistence";

/** Default cap on vectors scored per query. */
export const DEFAULT_MAX_SCAN = 50_000;

/** A vector is unusable: wrong length, not finite, or all zeros. */
export class VectorError extends Error {
  override name = "VectorError";
}

/** The vector's width differs from the width already stored for the model. */
export class VectorDimensionError extends VectorError {
  override name = "VectorDimensionError";
  constructor(
    readonly model: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Model ${model} stores ${expected}-dimensional vectors; got ${actual}`);
  }
}

/** L2-normalises a vector into Float32. Throws VectorError for empty, non-finite or zero vectors. */
export function normalize(vector: ArrayLike<number>): Float32Array {
  const out = new Float32Array(vector.length);
  if (out.length === 0) throw new VectorError("A vector must have at least one dimension");
  let sum = 0;
  for (let i = 0; i < out.length; i++) {
    const n = vector[i];
    if (typeof n !== "number" || !Number.isFinite(n)) {
      throw new VectorError("A vector may contain only finite numbers");
    }
    sum += n * n;
  }
  const norm = Math.sqrt(sum);
  if (norm === 0 || !Number.isFinite(norm)) throw new VectorError("A zero vector has no direction");
  for (let i = 0; i < out.length; i++) out[i] = (vector[i] ?? 0) / norm;
  return out;
}

export interface PendingItem {
  id: string;
  text: string;
  sensitivity: PrivacyClass;
}

export interface VectorFilter {
  domain?: MemoryDomain;
  /** Inclusive lower bound on observedAt (ISO). */
  observedFrom?: string;
  /** Exclusive upper bound on observedAt (ISO). */
  observedBefore?: string;
  /**
   * Row-level permission filter. It runs BEFORE a vector is scored, so an item the caller may not
   * see never takes part in ranking. It receives the item's scope, domain and sensitivity.
   */
  accept?: (item: Pick<MemoryItem, "scope" | "domain" | "sensitivity">) => boolean;
}

export interface VectorSearchOptions extends VectorFilter {
  limit: number;
  /** Most vectors scored. Default DEFAULT_MAX_SCAN. */
  maxScan?: number;
  /** Hits below this cosine similarity are dropped. Default: none. */
  minSimilarity?: number;
}

export interface VectorHit {
  memoryId: string;
  /** Cosine similarity, -1..1. */
  similarity: number;
}

export interface VectorSearchResult {
  hits: VectorHit[];
  /** Vectors scored (after the permission filter). */
  scanned: number;
  /** True when the scan stopped at `maxScan`: older candidates were not considered. */
  truncated: boolean;
}

export interface ModelVectorStats {
  model: string;
  dim: number;
  count: number;
}

export interface FailureRecord {
  memoryId: string;
  attempts: number;
  lastError: string;
  nextAttemptAt: string;
}

interface SearchRow {
  id: string;
  scope: string;
  domain: MemoryDomain;
  sensitivity: PrivacyClass;
  vector: Uint8Array;
}

interface CountRow {
  n: number;
}

export interface VectorStoreOptions {
  now?: () => Date;
}

export class VectorStore {
  private readonly now: () => Date;

  constructor(
    private readonly db: Database,
    options: VectorStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /** Width stored for a model, or null when it has no vectors. */
  dimOf(model: string): number | null {
    const r = this.db
      .prepare("SELECT dim FROM memory_vectors WHERE model = ? LIMIT 1")
      .get(model) as { dim: number } | undefined;
    return r?.dim ?? null;
  }

  /**
   * Stores vectors for items whose text is still what was embedded. An item that was forgotten,
   * expired or edited while the embedding was in flight is skipped, so a late write can never
   * resurrect a deleted memory's vector. Returns how many were stored; all-or-nothing on error.
   * Throws VectorDimensionError / VectorError before writing anything.
   */
  putMany(
    model: string,
    entries: readonly { id: string; text: string; vector: ArrayLike<number> }[],
  ): number {
    if (entries.length === 0) return 0;
    const prepared = entries.map((e) => ({ ...e, normalized: normalize(e.vector) }));
    const first = prepared[0]!.normalized.length;
    const known = this.dimOf(model);
    const expected = known ?? first;
    for (const p of prepared) {
      if (p.normalized.length !== expected) {
        throw new VectorDimensionError(model, expected, p.normalized.length);
      }
    }
    const stamp = this.now().toISOString();
    let stored = 0;
    this.db.exec("SAVEPOINT vectors_put");
    try {
      const insert = this.db.prepare(
        `INSERT OR REPLACE INTO memory_vectors (memory_id, model, dim, vector, created_at)
         SELECT m.id, ?, ?, ?, ? FROM memory_items m
          WHERE m.id = ? AND m.deleted_at IS NULL AND m.text = ?
            AND (m.expires_at IS NULL OR m.expires_at > ?)`,
      );
      const clear = this.db.prepare(
        "DELETE FROM memory_vector_failures WHERE memory_id = ? AND model = ?",
      );
      for (const p of prepared) {
        const r = insert.run(
          model,
          expected,
          new Uint8Array(p.normalized.buffer),
          stamp,
          p.id,
          p.text,
          stamp,
        );
        if (Number(r.changes) > 0) {
          stored++;
          clear.run(p.id, model);
        }
      }
      this.db.exec("RELEASE vectors_put");
    } catch (err) {
      this.db.exec("ROLLBACK TO vectors_put; RELEASE vectors_put");
      throw err;
    }
    return stored;
  }

  has(memoryId: string, model: string): boolean {
    return (
      this.db
        .prepare("SELECT 1 AS x FROM memory_vectors WHERE memory_id = ? AND model = ?")
        .get(memoryId, model) !== undefined
    );
  }

  count(model: string): number {
    return this.scalar("SELECT COUNT(*) AS n FROM memory_vectors WHERE model = ?", model);
  }

  /** Every model that has vectors, with its width and row count. */
  models(): ModelVectorStats[] {
    return this.db
      .prepare(
        "SELECT model, MIN(dim) AS dim, COUNT(*) AS count FROM memory_vectors GROUP BY model ORDER BY model",
      )
      .all() as unknown as ModelVectorStats[];
  }

  /** Deletes all vectors of a model that is no longer used. Returns how many. */
  dropModel(model: string): number {
    this.db.prepare("DELETE FROM memory_vector_failures WHERE model = ?").run(model);
    return Number(this.db.prepare("DELETE FROM memory_vectors WHERE model = ?").run(model).changes);
  }

  /** Vector rows whose memory is missing, deleted or expired. Zero unless something is badly wrong. */
  orphanCount(): number {
    return this.scalar(
      `SELECT COUNT(*) AS n FROM memory_vectors v
        WHERE NOT EXISTS (SELECT 1 FROM memory_items m WHERE m.id = v.memory_id AND m.deleted_at IS NULL)`,
    );
  }

  /** Total bytes of vector payload stored (all models). */
  payloadBytes(): number {
    return this.scalar("SELECT COALESCE(SUM(length(vector)), 0) AS n FROM memory_vectors");
  }

  /**
   * Live, unexpired items of one data class that have no vector for `model` and are not waiting
   * out a failure backoff (or parked after `maxAttempts`). Oldest first.
   */
  pending(
    model: string,
    sensitivity: PrivacyClass,
    limit: number,
    maxAttempts: number,
  ): PendingItem[] {
    const stamp = this.now().toISOString();
    return this.db
      .prepare(
        `SELECT m.id, m.text, m.sensitivity FROM memory_items m
          WHERE m.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > ?)
            AND m.sensitivity = ?
            AND NOT EXISTS (SELECT 1 FROM memory_vectors v WHERE v.memory_id = m.id AND v.model = ?)
            AND NOT EXISTS (SELECT 1 FROM memory_vector_failures f
                             WHERE f.memory_id = m.id AND f.model = ?
                               AND (f.attempts >= ? OR f.next_attempt_at > ?))
          ORDER BY m.seq LIMIT ?`,
      )
      .all(stamp, sensitivity, model, model, maxAttempts, stamp, limit) as unknown as PendingItem[];
  }

  /** Live, unexpired items without a vector for `model` (including ones parked after failures). */
  unembeddedCount(model: string): number {
    return this.scalar(
      `SELECT COUNT(*) AS n FROM memory_items m
        WHERE m.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > ?)
          AND NOT EXISTS (SELECT 1 FROM memory_vectors v WHERE v.memory_id = m.id AND v.model = ?)`,
      this.now().toISOString(),
      model,
    );
  }

  liveCount(): number {
    return this.scalar(
      `SELECT COUNT(*) AS n FROM memory_items
        WHERE deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
      this.now().toISOString(),
    );
  }

  /**
   * Notes that an item could not be embedded: it is retried after an exponentially growing delay
   * and parked once `attempts` reaches the caller's maximum. The item itself is never touched.
   */
  recordFailure(
    memoryId: string,
    model: string,
    error: string,
    backoff: (attempts: number) => number,
  ): FailureRecord {
    const prior = this.db
      .prepare("SELECT attempts FROM memory_vector_failures WHERE memory_id = ? AND model = ?")
      .get(memoryId, model) as { attempts: number } | undefined;
    const attempts = (prior?.attempts ?? 0) + 1;
    const next = new Date(this.now().getTime() + backoff(attempts)).toISOString();
    const lastError = error.slice(0, 300);
    this.db
      .prepare(
        `INSERT INTO memory_vector_failures (memory_id, model, attempts, last_error, next_attempt_at)
         SELECT m.id, ?, ?, ?, ? FROM memory_items m WHERE m.id = ? AND m.deleted_at IS NULL
         ON CONFLICT(memory_id, model) DO UPDATE SET attempts = excluded.attempts,
           last_error = excluded.last_error, next_attempt_at = excluded.next_attempt_at`,
      )
      .run(model, attempts, lastError, next, memoryId);
    return { memoryId, attempts, lastError, nextAttemptAt: next };
  }

  failures(model: string): FailureRecord[] {
    return this.db
      .prepare(
        `SELECT memory_id AS memoryId, attempts, last_error AS lastError, next_attempt_at AS nextAttemptAt
           FROM memory_vector_failures WHERE model = ? ORDER BY memory_id`,
      )
      .all(model) as unknown as FailureRecord[];
  }

  /** Makes parked and backed-off items eligible again. Returns how many. */
  clearFailures(model: string): number {
    return Number(
      this.db.prepare("DELETE FROM memory_vector_failures WHERE model = ?").run(model).changes,
    );
  }

  /**
   * Cosine top-k over live, unexpired, permitted items that have a vector for `model`, newest
   * first, scanning at most `maxScan`. A query whose width differs from the model's stored width
   * throws VectorDimensionError: vectors of different models are never compared.
   */
  search(
    model: string,
    query: ArrayLike<number>,
    options: VectorSearchOptions,
  ): VectorSearchResult {
    const q = normalize(query);
    const dim = this.dimOf(model);
    if (dim === null) return { hits: [], scanned: 0, truncated: false };
    if (dim !== q.length) throw new VectorDimensionError(model, dim, q.length);
    const limit = Math.max(0, Math.floor(options.limit));
    const maxScan = options.maxScan ?? DEFAULT_MAX_SCAN;
    const where = ["m.deleted_at IS NULL", "(m.expires_at IS NULL OR m.expires_at > ?)"];
    const params: string[] = [model, this.now().toISOString()];
    if (options.domain) {
      where.push("m.domain = ?");
      params.push(options.domain);
    }
    if (options.observedFrom) {
      where.push("m.observed_at >= ?");
      params.push(options.observedFrom);
    }
    if (options.observedBefore) {
      where.push("m.observed_at < ?");
      params.push(options.observedBefore);
    }
    // Newest-first order only matters when the cap can cut candidates off; sorting 20k rows costs
    // about a third of the scan, so it is skipped when every vector of the model fits under the cap.
    const ordered = this.count(model) > maxScan ? " ORDER BY m.seq DESC" : "";
    const rows = this.db
      .prepare(
        `SELECT m.id, m.scope, m.domain, m.sensitivity, v.vector
           FROM memory_items m JOIN memory_vectors v ON v.memory_id = m.id AND v.model = ?
          WHERE ${where.join(" AND ")}${ordered}`,
      )
      .iterate(...params) as Iterable<SearchRow>;

    // blobs are not guaranteed 4-byte aligned, so each is copied into one aligned scratch buffer.
    const scratch = new Float32Array(dim);
    const scratchBytes = new Uint8Array(scratch.buffer);
    const top: VectorHit[] = [];
    let scanned = 0;
    let truncated = false;
    for (const row of rows) {
      if (options.accept && !options.accept(row)) continue;
      if (scanned >= maxScan) {
        truncated = true;
        break;
      }
      scanned++;
      if (row.vector.byteLength !== scratchBytes.byteLength) continue;
      scratchBytes.set(row.vector);
      let dot = 0;
      for (let i = 0; i < dim; i++) dot += scratch[i]! * q[i]!;
      if (options.minSimilarity !== undefined && dot < options.minSimilarity) continue;
      insertTop(top, { memoryId: row.id, similarity: dot }, limit);
    }
    return { hits: top, scanned, truncated };
  }

  private scalar(sql: string, ...params: string[]): number {
    const row = this.db.prepare(sql).get(...params) as unknown as CountRow;
    return row.n;
  }
}

/** Keeps `top` sorted best-first and at most `limit` long. Ties keep the earlier (newer) entry first. */
function insertTop(top: VectorHit[], hit: VectorHit, limit: number): void {
  if (limit === 0) return;
  if (top.length === limit && hit.similarity <= (top[limit - 1]?.similarity ?? -Infinity)) return;
  let at = top.length;
  while (at > 0 && (top[at - 1]?.similarity ?? Infinity) < hit.similarity) at--;
  top.splice(at, 0, hit);
  if (top.length > limit) top.pop();
}
