// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { isAbsolute } from "node:path";
import {
  EngineeringSignals,
  createEngineeringDelivery,
  type AdvisoryProvider,
  type Clock,
  type EngineeringProviderAvailability,
  type Delivery,
  type EngineeringNotificationService,
  type EngineeringSignal,
  type HistorySource,
  type Timer,
} from "@phoenix/ai-proactive/engineering";
import type { EventBus } from "@phoenix/event-bus";
import type { SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

export const ENGINEERING_SIGNALS_ROOTS_KEY = "engineering-signals.watched-roots";
/** Notification-policy capability id a user must opt in to before anything is scheduled. */
export const ENGINEERING_SIGNALS_CAPABILITY = "engineering-signals";
export const MAX_WATCHED_ROOTS = 32;
const MAX_ROOT_LENGTH = 4096;
const CONSENT_EVENTS = [
  "security.kill_switch.engaged",
  "security.kill_switch.disengaged",
  "capability.disabled",
  "capability.enabled",
] as const;

export interface EngineeringSignalsSnapshot {
  watchedRoots: string[];
  signals: EngineeringSignal[];
  /** Latest scan only; `available: false` means unknown, never clean. */
  availability: EngineeringProviderAvailability;
}

export interface EngineeringSignalsDependencies {
  settings: SettingsStore;
  /** Same NotificationService the Phase 52 policy lives in (proactivePreferences / considerInsight). */
  notifications: EngineeringNotificationService & {
    proactivePreferences(userId: string): {
      cadenceMinutes: number | null;
      enabled: boolean;
      capabilities: string[];
    };
  };
  bus: EventBus;
  /** Resolved lazily, at each use, because the viewer is not known at construction. */
  userId(): string;
  killSwitchEngaged(): boolean;
  /** Capability-manager style gate for this source; consent alone is not enough. */
  capabilityEnabled(): boolean;
  /** Approved read-only provider; never contacted by the API except through an explicit scan. */
  advisories: AdvisoryProvider;
  /** Authorized terminal/CI history adapter. */
  history: HistorySource;
  clock?: Clock;
  /** Receives the user's selected cadence as `delayMs`; tests inject a fake instead of real timers. */
  timer?: Timer;
}

const systemTimer: Timer = {
  set(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    handle.unref();
    return handle;
  },
  clear(handle) {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

const validRoots = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= MAX_WATCHED_ROOTS &&
  value.every(
    (root) =>
      typeof root === "string" &&
      root.length > 0 &&
      root.length <= MAX_ROOT_LENGTH &&
      !root.includes("\0") &&
      isAbsolute(root),
  );

/**
 * Core owner of the Phase 82 signals: persisted watched roots, an opt-in scheduler and a read-only
 * manual scan. Nothing is scheduled unless notification consent, the capability gate and a
 * disengaged kill switch all hold; any of them going away stops the scheduler.
 */
export class EngineeringSignalsRuntime {
  private readonly source: EngineeringSignals;
  private active = false;
  private unsubscribe: (() => void) | null = null;
  private loaded: Promise<void> | null = null;
  private readonly delivery: Delivery;

  constructor(private readonly d: EngineeringSignalsDependencies) {
    this.delivery = {
      enabled: () => this.active && this.gate().enabled(),
      consider: (signal, isCurrent) => this.gate().consider(signal, isCurrent),
    };
    this.source = new EngineeringSignals({
      advisories: d.advisories,
      history: d.history,
      delivery: this.delivery,
      clock: d.clock ?? { now: () => Date.now() },
      // The collector enforces a minimum cadence; the real delay is the user's selected cadence.
      timer: {
        set: (callback, _delayMs) => (d.timer ?? systemTimer).set(callback, this.cadenceMs()),
        clear: (handle) => (d.timer ?? systemTimer).clear(handle),
      },
      cadenceMs: 60_000,
    });
  }

  private gate(): Delivery {
    return createEngineeringDelivery({
      notifications: this.d.notifications,
      userId: this.d.userId(),
      killSwitchEngaged: this.d.killSwitchEngaged,
      capabilityEnabled: this.d.capabilityEnabled,
    });
  }

  private cadenceMs(): number {
    const minutes = this.d.notifications.proactivePreferences(this.d.userId()).cadenceMinutes;
    return (minutes ?? 1440) * 60_000;
  }

  /** Restores only roots the user explicitly saved; a stale or invalid entry is skipped, never widened. */
  private load(): Promise<void> {
    this.loaded ??= (async () => {
      let stored: unknown;
      try {
        stored = this.d.settings.get<unknown>(ENGINEERING_SIGNALS_ROOTS_KEY, []);
      } catch {
        return;
      }
      if (!validRoots(stored)) return;
      const restored: string[] = [];
      for (const root of stored) {
        try {
          await this.source.setWatchedRoots([...restored, root]);
          restored.push(...this.source.watchedRoots().filter((r) => !restored.includes(r)));
        } catch {
          // Removed or replaced since it was saved.
        }
      }
    })();
    return this.loaded;
  }

  /** Arms the lifecycle; the first poll still waits for consent, capability and kill-switch checks. */
  async startScheduler(): Promise<void> {
    await this.load();
    if (this.active) return;
    this.active = true;
    this.unsubscribe = this.d.bus.subscribe(
      ENGINEERING_SIGNALS_CAPABILITY,
      CONSENT_EVENTS,
      (event) => {
        if (
          event.event_type.startsWith("security.kill_switch.") ||
          event.subject === ENGINEERING_SIGNALS_CAPABILITY
        )
          this.consentChanged();
      },
    );
    this.consentChanged();
  }

  /** Core shutdown. Safe to call repeatedly. */
  stopScheduler(): void {
    this.active = false;
    this.source.stop();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Re-evaluates consent. Call after proactive preferences change (opt-in/out, cadence). Stops
   * immediately on opt-out or kill switch; starts only when every gate is satisfied.
   */
  consentChanged(): void {
    this.source.stop();
    if (this.active) this.source.start();
  }

  /** Manual scan: read-only, needs no notification opt-in and never notifies. */
  async status(): Promise<EngineeringSignalsSnapshot> {
    await this.load();
    const signals = await this.source.scan();
    return {
      watchedRoots: [...this.source.watchedRoots()],
      signals,
      availability: this.source.providerAvailability(),
    };
  }

  /** Replaces the watched roots with validated, canonical directories and persists them. */
  async setWatchedRoots(roots: unknown): Promise<EngineeringSignalsSnapshot> {
    await this.load();
    if (!validRoots(roots))
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        `watchedRoots must be at most ${MAX_WATCHED_ROOTS} absolute paths`,
      );
    const previous = this.source.watchedRoots();
    try {
      await this.source.setWatchedRoots(roots);
    } catch {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        "Each watched root must be a real directory",
      );
    }
    try {
      this.d.settings.set(ENGINEERING_SIGNALS_ROOTS_KEY, this.source.watchedRoots());
    } catch (error) {
      await this.source.setWatchedRoots(previous);
      throw error;
    }
    return this.status();
  }
}
