// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

const MAX_KEYS = 1000;

/** A sliding window of hits per key. Time is passed in, so tests drive it by hand. */
export class RateWindow {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  private live(key: string, now: number): number[] {
    const kept = (this.hits.get(key) ?? []).filter((at) => at > now - this.windowMs);
    if (kept.length === 0) this.hits.delete(key);
    else this.hits.set(key, kept);
    return kept;
  }

  /** Counts one hit and returns true, or returns false (counting nothing) when the key is over its limit. */
  take(key: string, now: number): boolean {
    const kept = this.live(key, now);
    if (kept.length >= this.limit) return false;
    if (this.hits.size >= MAX_KEYS && !this.hits.has(key)) {
      for (const k of [...this.hits.keys()]) this.live(k, now);
      if (this.hits.size >= MAX_KEYS) this.hits.delete(this.hits.keys().next().value!);
    }
    kept.push(now);
    this.hits.set(key, kept);
    return true;
  }

  /** Seconds until `key` may take another hit; 0 when it may now. */
  retryAfterSeconds(key: string, now: number): number {
    const kept = this.live(key, now);
    if (kept.length < this.limit) return 0;
    return Math.max(1, Math.ceil((kept[0]! + this.windowMs - now) / 1000));
  }

  clear(): void {
    this.hits.clear();
  }
}
