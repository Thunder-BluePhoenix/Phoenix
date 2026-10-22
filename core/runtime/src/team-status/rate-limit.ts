// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

const OVERFLOW_KEY = "\u0000overflow";

export type RateDecision = { ok: true } | { ok: false; retryAfterMs: number };

/**
 * Token bucket per key with an injected clock. The key space is capped: once `maxKeys` buckets
 * exist, new keys share one overflow bucket, so a remote sender cannot grow the map.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly burst: number,
    private readonly perMinute: number,
    private readonly maxKeys = 1024,
  ) {
    if (!Number.isInteger(burst) || burst < 1) throw new RangeError("burst must be >= 1");
    if (!(perMinute > 0)) throw new RangeError("perMinute must be positive");
  }

  take(requested: string, now: number): RateDecision {
    const refillPerMs = this.perMinute / 60_000;
    const key = this.keyFor(requested, now, refillPerMs);
    const bucket = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    const elapsed = Math.max(0, now - bucket.at);
    bucket.tokens = Math.min(this.burst, bucket.tokens + elapsed * refillPerMs);
    bucket.at = now;
    this.buckets.set(key, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true };
    }
    return { ok: false, retryAfterMs: Math.ceil((1 - bucket.tokens) / refillPerMs) };
  }

  /** A new key beyond the cap shares one overflow bucket, so a flood of keys cannot grow memory. */
  private keyFor(key: string, now: number, refillPerMs: number): string {
    if (this.buckets.has(key) || this.buckets.size < this.maxKeys) return key;
    for (const [k, bucket] of this.buckets) {
      if (bucket.tokens + (now - bucket.at) * refillPerMs >= this.burst) this.buckets.delete(k);
    }
    return this.buckets.size < this.maxKeys ? key : OVERFLOW_KEY;
  }

  forget(key: string): void {
    this.buckets.delete(key);
  }
}
