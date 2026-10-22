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
    if (this.until !== null) this.schedule();
    this.notify();
  }

  stop(): void {
    this.cancelTimer();
    this.manual = false;
    this.until = null;
    this.flushIfInactive();
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
