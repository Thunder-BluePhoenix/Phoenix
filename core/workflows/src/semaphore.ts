// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Counting semaphore with FIFO hand-off. `halt` releases every waiter so shutdown cannot hang. */
export class Semaphore {
  private free: number;
  private readonly waiters: (() => void)[] = [];
  private halted = false;

  constructor(size: number) {
    this.free = Math.max(1, Math.floor(size));
  }

  acquire(): Promise<void> {
    if (this.halted) return Promise.resolve();
    if (this.free > 0) {
      this.free--;
      return Promise.resolve();
    }
    const turn = Promise.withResolvers<void>();
    this.waiters.push(turn.resolve);
    return turn.promise;
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.free++;
  }

  halt(): void {
    this.halted = true;
    for (const w of this.waiters.splice(0)) w();
  }

  get waiting(): number {
    return this.waiters.length;
  }
}
