// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * Remembers ids for a fixed time so a signed message can be accepted once. Fails closed: when the
 * table (or one scope's share of it) is full of unexpired ids, new ids are refused rather than an
 * old one being evicted, because an evicted id inside the replay window could be replayed.
 */
export class DedupeWindow {
  private readonly seen = new Map<string, { scope: string; until: number }>();
  private readonly perScope = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxTotal = 8192,
    private readonly maxPerScope = 1024,
  ) {}

  claim(scope: string, id: string, now: number): "claimed" | "duplicate" | "full" {
    for (const [key, entry] of this.seen) {
      if (entry.until >= now) continue;
      this.drop(key, entry.scope);
    }
    const key = `${scope}\n${id}`;
    if (this.seen.has(key)) return "duplicate";
    if (this.seen.size >= this.maxTotal || (this.perScope.get(scope) ?? 0) >= this.maxPerScope)
      return "full";
    this.seen.set(key, { scope, until: now + this.ttlMs });
    this.perScope.set(scope, (this.perScope.get(scope) ?? 0) + 1);
    return "claimed";
  }

  /** Gives an id back after the message was not actually processed, so a retry is not a "replay". */
  release(scope: string, id: string): void {
    const key = `${scope}\n${id}`;
    if (this.seen.has(key)) this.drop(key, scope);
  }

  forget(scope: string): void {
    for (const [key, entry] of this.seen) if (entry.scope === scope) this.seen.delete(key);
    this.perScope.delete(scope);
  }

  get size(): number {
    return this.seen.size;
  }

  private drop(key: string, scope: string): void {
    this.seen.delete(key);
    const left = (this.perScope.get(scope) ?? 1) - 1;
    if (left > 0) this.perScope.set(scope, left);
    else this.perScope.delete(scope);
  }
}
