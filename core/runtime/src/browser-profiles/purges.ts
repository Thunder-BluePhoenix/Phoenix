// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Durable queue of removed browser profiles whose saved web data (cookies, storage, cache) the
// host still has to delete. Core cannot reach a webview store, and the Settings page runs outside
// the Phoenix browser window, so Core only records the profile id. The browser window reads this
// queue, asks the shell to purge, then acknowledges with `done`. If that window is never opened the
// entry stays pending: nothing here claims the data is gone.
import type { SettingsStore } from "@phoenix/persistence";

export const PURGE_QUEUE_KEY = "browser.profile-purges.v1";
export const MAX_PENDING_PURGES = 2000;
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export function validPurgeId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

export class ProfilePurgeQueue {
  constructor(private readonly settings: Pick<SettingsStore, "get" | "set">) {}

  /** The pending ids, oldest first. A corrupt stored value reads as empty and is never thrown. */
  list(): string[] {
    let stored: unknown;
    try {
      stored = this.settings.get<unknown>(PURGE_QUEUE_KEY, []);
    } catch {
      return [];
    }
    if (!Array.isArray(stored)) return [];
    const seen = new Set<string>();
    for (const item of stored) {
      if (validPurgeId(item)) seen.add(item);
      if (seen.size >= MAX_PENDING_PURGES) break;
    }
    return [...seen];
  }

  has(id: string): boolean {
    return this.list().includes(id);
  }

  /** Idempotent. An invalid id is refused; a full queue drops the oldest entry, never the new one. */
  add(id: string): void {
    if (!validPurgeId(id)) throw new RangeError("Invalid profile id");
    const pending = this.list();
    if (pending.includes(id)) return;
    pending.push(id);
    this.settings.set(PURGE_QUEUE_KEY, pending.slice(-MAX_PENDING_PURGES));
  }

  /** Idempotent: acknowledging an id that is not pending changes nothing. */
  done(id: string): void {
    const pending = this.list();
    if (!pending.includes(id)) return;
    this.settings.set(
      PURGE_QUEUE_KEY,
      pending.filter((item) => item !== id),
    );
  }
}
