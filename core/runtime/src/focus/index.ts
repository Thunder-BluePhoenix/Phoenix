// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** The host owns notification delivery; this controller only decides whether to defer it. */
export interface FocusNotification {
  id: string;
  severity: "info" | "success" | "warning" | "error";
  requiresAction?: boolean;
}

export interface FocusClock {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface FocusDndReader {
  /** null means the host cannot determine the OS status; never writes OS settings. */
  read(): Promise<boolean | null>;
}

export interface FocusSnapshot {
  manual: boolean;
  osDnd: boolean | null;
  active: boolean;
  remainingMs: number | null;
  held: number;
}

/** Settings key under which Core keeps the active session; absent when focus is off. */
export const FOCUS_SESSION_KEY = "focus.session";

/** The longest a timed session can last (the Pomodoro bound in `start`). */
const MAX_SESSION_MS = 24 * 60 * 60_000;

/** What survives a restart: the mode and the absolute end instant (null: until stopped). */
export interface PersistedFocus {
  v: 1;
  mode: "manual" | "pomodoro";
  endsAt: number | null;
}

/** Durable home of the active session. `read` returns whatever is stored (unvalidated). */
export interface FocusStore {
  read(): unknown;
  /** null clears the stored session. */
  write(session: PersistedFocus | null): void;
}

/**
 * Strict check of a stored session: exactly the known fields, an untimed session with no end, a
 * Pomodoro whose end is still in the future and within the 24 hour session bound. Otherwise null.
 */
export function parsePersistedFocus(value: unknown, now: number): PersistedFocus | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !keys.includes("v") ||
    !keys.includes("mode") ||
    !keys.includes("endsAt")
  ) {
    return null;
  }
  const { v, mode, endsAt } = value as Record<string, unknown>;
  if (v !== 1) return null;
  if (mode === "manual") return endsAt === null ? { v: 1, mode, endsAt: null } : null;
  if (
    mode === "pomodoro" &&
    typeof endsAt === "number" &&
    Number.isFinite(endsAt) &&
    endsAt > now &&
    endsAt <= now + MAX_SESSION_MS
  ) {
    return { v: 1, mode, endsAt };
  }
  return null;
}

/** A focus session can be timed, or last until explicitly stopped. No timer or OS calls at import. */
export class FocusController<T extends FocusNotification> {
  private manual = false;
  private osDnd: boolean | null = null;
  private lastKnownDnd: boolean | null = null;
  private until: number | null = null;
  private timeout: unknown = null;
  private readonly held: T[] = [];
  private readonly heldIds = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private dndRead = 0;
  private disposed = false;

  constructor(
    private readonly clock: FocusClock,
    private readonly dnd: FocusDndReader,
    private readonly deliver: (notification: T) => void,
    private readonly store?: FocusStore,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): FocusSnapshot {
    this.expire();
    return {
      manual: this.manual,
      osDnd: this.osDnd,
      active: this.manual || this.dndBlocking(),
      remainingMs: this.until === null ? null : Math.max(0, this.until - this.clock.now()),
      held: this.held.length,
    };
  }

  /** A failed OS read is unknown, not an assertion that DND is off. */
  async refreshDnd(): Promise<void> {
    const read = ++this.dndRead;
    let value: boolean | null;
    try {
      value = await this.dnd.read();
    } catch {
      value = null;
    }
    if (this.disposed || read !== this.dndRead) return;
    if (value !== null) this.lastKnownDnd = value;
    this.osDnd = value;
    this.flushIfInactive();
    this.notify();
  }

  start(minutes?: number): void {
    if (minutes !== undefined && (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60)) {
      throw new RangeError("Focus duration must be between 0 and 1440 minutes");
    }
    this.cancelTimer();
    this.manual = true;
    this.until = minutes === undefined ? null : this.clock.now() + minutes * 60_000;
    this.persist();
    if (this.until !== null) this.schedule();
    this.notify();
  }

  stop(): void {
    this.cancelTimer();
    this.manual = false;
    this.until = null;
    this.store?.write(null);
    this.flushIfInactive();
    this.notify();
  }

  /**
   * Resumes the session a previous process left in the store, from its absolute end instant (never
   * a fresh full duration). Anything that is missing its shape, expired, or ends further away than
   * a session can last is ignored and cleared. Held notifications are not restored; they are already
   * in durable history. Call once when Core starts.
   */
  restore(): void {
    if (!this.store || this.disposed || this.manual) return;
    let raw: unknown = null;
    let unreadable = false;
    try {
      raw = this.store.read();
    } catch {
      unreadable = true;
    }
    if (!unreadable && raw === null) return;
    const session = unreadable ? null : parsePersistedFocus(raw, this.clock.now());
    if (session === null) {
      this.store.write(null);
      return;
    }
    this.manual = true;
    this.until = session.endsAt;
    this.schedule();
    this.notify();
  }

  /** Approval and error notifications always pass, including while OS DND is enabled. */
  receive(notification: T): "delivered" | "held" {
    this.expire();
    if (
      (!this.manual && !this.dndBlocking()) ||
      notification.requiresAction ||
      notification.severity === "error"
    ) {
      if (this.heldIds.delete(notification.id)) {
        const index = this.held.findIndex((held) => held.id === notification.id);
        if (index !== -1) this.held.splice(index, 1);
        this.notify();
      }
      this.deliver(notification);
      return "delivered";
    }
    if (!this.heldIds.has(notification.id)) {
      this.held.push(notification);
      this.heldIds.add(notification.id);
      this.notify();
    }
    return "held";
  }

  dispose(): void {
    this.disposed = true;
    this.dndRead++;
    this.cancelTimer();
    this.listeners.clear();
    this.held.length = 0;
    this.heldIds.clear();
  }

  private persist(): void {
    this.store?.write({
      v: 1,
      mode: this.until === null ? "manual" : "pomodoro",
      endsAt: this.until,
    });
  }

  private cancelTimer(): void {
    if (this.timeout !== null) this.clock.clearTimeout(this.timeout);
    this.timeout = null;
  }

  private schedule(): void {
    if (this.until === null) return;
    this.timeout = this.clock.setTimeout(
      () => {
        this.timeout = null;
        this.expire();
        this.notify();
      },
      Math.max(0, this.until - this.clock.now()),
    );
  }

  private expire(): void {
    if (this.until === null || this.clock.now() < this.until) return;
    this.cancelTimer();
    this.until = null;
    this.manual = false;
    this.store?.write(null);
    this.flushIfInactive();
  }

  private flushIfInactive(): void {
    if (this.manual || this.dndBlocking()) return;
    const pending = this.held.splice(0);
    this.heldIds.clear();
    for (const notification of pending) this.deliver(notification);
  }

  /** OS DND is on, or became unreadable after it was last seen on: stay quiet until it reads off. */
  private dndBlocking(): boolean {
    return this.osDnd === true || (this.osDnd === null && this.lastKnownDnd === true);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
