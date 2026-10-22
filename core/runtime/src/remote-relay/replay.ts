// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** A signed message is accepted for 60 s either side of the receiver's clock (docs/phone-link.md). */
export const SIGNATURE_WINDOW_MS = 60_000;
/** Remembered for the whole span in which its timestamp could still pass the window. */
const REMEMBER_MS = SIGNATURE_WINDOW_MS * 2;

/**
 * Remembers nonces so one signed message can be accepted once. A nonce is kept for twice the
 * signature window: a message stamped at the far edge of the future side of the window is still
 * acceptable until `stamp + window`, which is `first seen + 2 × window` at the latest, and the entry
 * is dropped only strictly after that.
 */
export class ReplayWindow {
  private readonly seen = new Map<string, { scope: string; until: number }>();
  private readonly perScope = new Map<string, number>();

  constructor(
    private readonly maxTotal = 4096,
    private readonly maxPerScope = 200,
  ) {}

  /** Records `scope:nonce`, or throws if it was seen already or the scope/table is full. */
  claim(scope: string, nonce: string, now: number): void {
    for (const [key, entry] of this.seen) {
      if (entry.until >= now) continue;
      this.seen.delete(key);
      this.perScope.set(entry.scope, (this.perScope.get(entry.scope) ?? 1) - 1);
    }
    const key = `${scope}\n${nonce}`;
    if (this.seen.has(key)) throw new Error("Replayed message");
    if (this.seen.size >= this.maxTotal || (this.perScope.get(scope) ?? 0) >= this.maxPerScope)
      throw new Error("Nonce capacity exceeded");
    this.seen.set(key, { scope, until: now + REMEMBER_MS });
    this.perScope.set(scope, (this.perScope.get(scope) ?? 0) + 1);
  }

  /** Forget everything for one peer (it was revoked or unpaired). */
  forget(scope: string): void {
    for (const [key, entry] of this.seen) if (entry.scope === scope) this.seen.delete(key);
    this.perScope.delete(scope);
  }

  get size(): number {
    return this.seen.size;
  }
}
