// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The "every Monday" recap notice (Phase 69), Core side. A second proactive source that is
// deliberately NOT part of the Kage `ProactiveRuntime`: its own opt-in (off by default), its own
// persisted last-sent ISO week, no model call, no network, and a fixed template with counts only
// (see recap-notice.ts). It reuses, and never loosens, three existing gates: the Proactive quiet
// hours, notification quiet mode (and muted sources) and the emergency stop.
import type { RecapNoticeApi, RecapNoticeView, RecapView } from "@phoenix/api";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { NotificationService, QuietHours } from "@phoenix/notifications";
import type { SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { addDays, dayKeyOf, weekStartOf } from "./recap-calendar";
import {
  decideRecapNotice,
  hasActivity,
  isoWeekOf,
  localInstant,
  RECAP_NOTICE_MINUTE_OF_DAY,
  RECAP_NOTICE_ENABLED_KEY,
  RECAP_NOTICE_EVENT,
  RECAP_NOTICE_LAST_WEEK_KEY,
  RECAP_NOTICE_SOURCE,
  recapNoticeText,
  sleepMs,
  type RecapNoticeCounts,
} from "./recap-notice";

const GATE_EVENTS = ["security.kill_switch.engaged", "security.kill_switch.disengaged"];
const BLOCKED_RECHECK_MS = 60 * 60_000;
const ISO_WEEK = /^\d{4}-W\d{2}$/;

export interface RecapNoticeDeps {
  settings: SettingsStore;
  notifications: Pick<NotificationService, "deliverLocal" | "proactivePreferences">;
  recap: { recap(week: string | undefined): RecapView };
  bus: EventBus;
  logger: Logger;
  /** Injected clock (ms since the epoch). */
  now: () => number;
  /** IANA zone that defines "Monday 09:00 local". */
  timeZone: string;
  userId: () => string;
  locale: () => string;
  killSwitchEngaged: () => boolean;
}

export class RecapNoticeRuntime implements RecapNoticeApi {
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private running = false;
  private generation = 0;

  constructor(private readonly d: RecapNoticeDeps) {}

  /** Arms the scheduler. Nothing is armed unless the person turned the notice on. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribe = this.d.bus.subscribe("recap-notice", GATE_EVENTS, () => this.schedule());
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  status(): RecapNoticeView {
    return {
      enabled: this.enabled(),
      last_week: this.lastWeek(),
      time_zone: this.d.timeZone,
    };
  }

  setEnabled(input: unknown): RecapNoticeView {
    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      !("enabled" in input) ||
      typeof input.enabled !== "boolean"
    )
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, 'Expected {"enabled": boolean}');
    // Turning it on mid-week must not fire at once for a Monday that already passed: the first
    // notice is the next Monday 09:00 (catch-up is only for a Core that was off while enabled).
    if (input.enabled && !this.enabled()) {
      const now = this.d.now();
      const today = dayKeyOf(now, this.d.timeZone);
      const dueAt = localInstant(weekStartOf(today), RECAP_NOTICE_MINUTE_OF_DAY, this.d.timeZone);
      if (now >= dueAt) this.d.settings.set(RECAP_NOTICE_LAST_WEEK_KEY, isoWeekOf(today));
    }
    this.d.settings.set(RECAP_NOTICE_ENABLED_KEY, input.enabled);
    this.schedule();
    return this.status();
  }

  /** Re-reads quiet hours after the Proactive preferences changed. */
  preferencesChanged(): void {
    this.schedule();
  }

  private enabled(): boolean {
    return this.d.settings.get<unknown>(RECAP_NOTICE_ENABLED_KEY, false) === true;
  }

  private lastWeek(): string | null {
    const stored = this.d.settings.get<unknown>(RECAP_NOTICE_LAST_WEEK_KEY, null);
    return typeof stored === "string" && ISO_WEEK.test(stored) ? stored : null;
  }

  private clearTimer(): void {
    this.generation++;
    clearTimeout(this.timer ?? undefined);
    this.timer = null;
  }

  private schedule(overrideMs?: number): void {
    this.clearTimer();
    if (!this.running || !this.enabled() || this.d.killSwitchEngaged()) return;
    const generation = this.generation;
    const delay = overrideMs ?? this.nextDelayMs();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.running || generation !== this.generation) return;
      let retry: number | undefined;
      try {
        if (this.attempt() === "blocked") retry = BLOCKED_RECHECK_MS;
      } catch (error) {
        retry = BLOCKED_RECHECK_MS;
        this.d.logger.warn("Recap notice check failed", { error: String(error) });
      } finally {
        if (this.running && generation === this.generation) this.schedule(retry);
      }
    }, delay);
    this.timer.unref();
  }

  private quietHours(): QuietHours | null | undefined {
    try {
      return this.d.notifications.proactivePreferences(this.d.userId()).quietHours;
    } catch {
      return undefined; // quiet hours unreadable: send nothing
    }
  }

  private nextDelayMs(): number {
    const now = this.d.now();
    const quiet = this.quietHours();
    if (quiet === undefined) return BLOCKED_RECHECK_MS;
    const decision = decideRecapNotice({
      now,
      timeZone: this.d.timeZone,
      lastWeek: this.lastWeek(),
      quietHours: quiet,
    });
    return decision.action === "send" ? 0 : sleepMs(now, decision.at);
  }

  /** One check at the injected clock's now; true when a notice was stored. */
  tick(): boolean {
    return this.attempt() === "sent";
  }

  /**
   * Delivers at most once per ISO week and re-checks every gate at the moment of delivery, not at
   * scheduling time. `blocked` means due but held back by a gate (try again later, week unmarked).
   */
  private attempt(): "sent" | "handled" | "idle" | "blocked" {
    if (!this.enabled() || this.d.killSwitchEngaged()) return "idle";
    const quiet = this.quietHours();
    if (quiet === undefined) return "blocked";
    const now = this.d.now();
    const decision = decideRecapNotice({
      now,
      timeZone: this.d.timeZone,
      lastWeek: this.lastWeek(),
      quietHours: quiet,
    });
    if (decision.action !== "send") return "idle";
    const counts = this.countsForPreviousWeek(now);
    // An empty week has nothing to tell: it is handled without a notice.
    const send = hasActivity(counts);
    if (send) {
      const text = recapNoticeText(this.d.locale(), counts);
      const stored = this.d.notifications.deliverLocal({
        source: RECAP_NOTICE_SOURCE,
        eventType: RECAP_NOTICE_EVENT,
        title: text.title,
        body: text.body,
        at: now,
      });
      // Notification quiet mode or a muted source: nothing stored, the week stays unmarked and is retried.
      if (!stored) return "blocked";
    }
    this.d.settings.set(RECAP_NOTICE_LAST_WEEK_KEY, decision.week);
    return send ? "sent" : "handled";
  }

  private countsForPreviousWeek(now: number): RecapNoticeCounts {
    const previous = addDays(weekStartOf(dayKeyOf(now, this.d.timeZone)), -7);
    const view = this.d.recap.recap(previous);
    return {
      sessions: view.coding.sessions,
      steps: view.coding.steps,
      commits: view.commits,
      granted: view.permissions.granted,
      denied: view.permissions.denied,
    };
  }
}
