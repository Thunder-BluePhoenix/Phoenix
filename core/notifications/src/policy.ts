// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { SettingsStore } from "@phoenix/persistence";

export interface ProactiveInsight {
  id: string;
  kind: "deploy_window_risk" | "related_incident" | "unassigned_action" | "dependency_update";
  capabilityId: string;
  title: string;
  body: string;
  evidenceIds: string[];
  subjectId: string;
}
export interface QuietHours {
  timezone: string;
  start: string;
  end: string;
}
export type ProactiveCadenceMinutes = 15 | 30 | 60 | 1440;
export interface ProactivePreferences {
  enabled: boolean;
  capabilities: string[];
  quietHours: QuietHours | null;
  maxPerHour: number;
  cadenceMinutes: ProactiveCadenceMinutes | null;
}
export interface NoiseMetrics {
  delivered: number;
  dismissed: number;
  suppressed: number;
  dismissalRate: number;
}
interface PolicyState {
  delivered: { key: string; at: number }[];
  dismissed: string[];
  deliveredCount: number;
  dismissedCount: number;
  suppressedCount: number;
}
const defaults: ProactivePreferences = {
  enabled: false,
  capabilities: [],
  quietHours: null,
  maxPerHour: 3,
  cadenceMinutes: null,
};
const empty = (): PolicyState => ({
  delivered: [],
  dismissed: [],
  deliveredCount: 0,
  dismissedCount: 0,
  suppressedCount: 0,
});
const key = (user: string) => `notifications.proactive.${user}`;
const stateKey = (user: string) => `notifications.proactive.state.${user}`;
const validId = (id: string) => typeof id === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(id);
const minute = (value: string): number => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new Error("quiet hours require HH:mm in 24-hour time");
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
};
function quiet(now: number, hours: QuietHours | null): boolean {
  if (!hours) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: hours.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const local =
    Number(parts.find((p) => p.type === "hour")!.value) * 60 +
    Number(parts.find((p) => p.type === "minute")!.value);
  const start = minute(hours.start),
    end = minute(hours.end);
  return start === end
    ? false
    : start < end
      ? local >= start && local < end
      : local >= start || local < end;
}
/** All decisions are local and persisted, including duplicate/rate state across restarts. */
export class ProactiveNotificationPolicy {
  constructor(
    private readonly settings: SettingsStore,
    private readonly now: () => number = Date.now,
  ) {}
  preferences(user: string): ProactivePreferences {
    if (!validId(user)) throw new Error("invalid user id");
    const stored = this.settings.get<Partial<ProactivePreferences>>(key(user), {});
    const prefs = { ...defaults, ...stored };
    if (
      prefs.enabled !== true ||
      !Array.isArray(prefs.capabilities) ||
      !prefs.capabilities.includes("kage") ||
      ![15, 30, 60, 1440].includes(prefs.cadenceMinutes as number)
    )
      prefs.cadenceMinutes = null;
    return prefs;
  }
  setPreferences(user: string, input: Partial<ProactivePreferences>): ProactivePreferences {
    const next = this.preferences(user);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("invalid proactive preferences");
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== "boolean") throw new Error("enabled must be boolean");
      next.enabled = input.enabled;
    }
    if (input.capabilities !== undefined) {
      if (!Array.isArray(input.capabilities) || !input.capabilities.every(validId))
        throw new Error("invalid capabilities");
      next.capabilities = [...new Set(input.capabilities)].slice(0, 100);
    }
    if (input.cadenceMinutes !== undefined) {
      if (input.cadenceMinutes !== null && ![15, 30, 60, 1440].includes(input.cadenceMinutes))
        throw new Error("invalid proactive cadence");
      next.cadenceMinutes = input.cadenceMinutes;
    }
    if (input.maxPerHour !== undefined) {
      if (!Number.isInteger(input.maxPerHour) || input.maxPerHour < 1 || input.maxPerHour > 20)
        throw new Error("invalid hourly limit");
      next.maxPerHour = input.maxPerHour;
    }
    if (input.quietHours !== undefined) {
      if (input.quietHours !== null) {
        const h = input.quietHours;
        if (typeof h !== "object" || typeof h.timezone !== "string")
          throw new Error("invalid quiet hours");
        minute(h.start);
        minute(h.end);
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: h.timezone });
        } catch {
          throw new Error("invalid time zone");
        }
        next.quietHours = { timezone: h.timezone, start: h.start, end: h.end };
      } else next.quietHours = null;
    }
    if (
      input.cadenceMinutes !== undefined &&
      input.cadenceMinutes !== null &&
      (!next.enabled || !next.capabilities.includes("kage"))
    )
      throw new Error("proactive cadence requires Kage opt-in");
    if (!next.enabled || !next.capabilities.includes("kage")) next.cadenceMinutes = null;
    else if (next.cadenceMinutes !== null && ![15, 30, 60, 1440].includes(next.cadenceMinutes))
      throw new Error("invalid proactive cadence");
    this.settings.set(key(user), next);
    return next;
  }
  /** Snapshot must be rechecked by caller against current source before delivery. */
  allow(user: string, insight: ProactiveInsight): boolean {
    const prefs = this.preferences(user);
    if (!prefs.enabled || !prefs.capabilities.includes(insight.capabilityId)) return false;
    if (
      !validId(insight.id) ||
      !validId(insight.subjectId) ||
      !validId(insight.capabilityId) ||
      !Array.isArray(insight.evidenceIds) ||
      insight.evidenceIds.length === 0 ||
      insight.evidenceIds.length > 4 ||
      !insight.evidenceIds.every(validId) ||
      typeof insight.title !== "string" ||
      !insight.title ||
      insight.title.length > 160 ||
      typeof insight.body !== "string" ||
      insight.body.length > 500
    )
      return false;
    const at = this.now();
    if (!Number.isFinite(at)) return false;
    const state = this.settings.get<PolicyState>(stateKey(user), empty());
    state.delivered = state.delivered.filter((d) => d.at <= at && at - d.at < 86_400_000);
    if (
      quiet(at, prefs.quietHours) ||
      state.dismissed.includes(insight.id) ||
      state.delivered.some((d) => d.key === insight.id) ||
      state.delivered.filter((d) => at - d.at < 3_600_000).length >= prefs.maxPerHour
    ) {
      state.suppressedCount++;
      this.settings.set(stateKey(user), state);
      return false;
    }
    state.delivered.push({ key: insight.id, at });
    if (state.delivered.length > 500) state.delivered.shift();
    state.deliveredCount++;
    this.settings.set(stateKey(user), state);
    return true;
  }
  dismiss(user: string, insightId: string): void {
    if (!validId(insightId)) throw new Error("invalid insight id");
    this.preferences(user);
    const state = this.settings.get<PolicyState>(stateKey(user), empty());
    if (!state.delivered.some((d) => d.key === insightId)) return;
    if (state.dismissed.includes(insightId)) return;
    state.dismissed.push(insightId);
    if (state.dismissed.length > 1000) state.dismissed.shift();
    state.dismissedCount++;
    this.settings.set(stateKey(user), state);
  }
  metrics(user: string): NoiseMetrics {
    this.preferences(user);
    const state = this.settings.get<PolicyState>(stateKey(user), empty());
    return {
      delivered: state.deliveredCount,
      dismissed: state.dismissedCount,
      suppressed: state.suppressedCount,
      dismissalRate: state.deliveredCount === 0 ? 0 : state.dismissedCount / state.deliveredCount,
    };
  }
}
