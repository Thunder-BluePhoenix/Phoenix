// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { generateInsights, type ReviewedAction } from "@phoenix/ai-proactive";
import type { EventBus } from "@phoenix/event-bus";
import type {
  ProactivePreferences,
  NoiseMetrics,
  Notification,
  NotificationService,
} from "@phoenix/notifications";
import type { CapabilityManager } from "@phoenix/capability-manager";
import type { MeetingStore } from "@phoenix/persistence";
import type { MeetingReviewRuntime } from "./meeting-review";
import type { MemoryRuntime } from "./memory";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

const SOURCE = "kage";
type Evidence = {
  meeting_id: string;
  item_id: string;
  source: "transcript" | "summary";
  quote: string;
};
export interface ProactiveStatus {
  preferences: ProactivePreferences;
  source: { capability_id: "kage"; available: boolean; mode: "manual" };
  noise: NoiseMetrics;
}
export interface ProactiveCandidate {
  id: string;
  kind: "unassigned_action";
  capabilityId: "kage";
  title: string;
  body: string;
  evidenceIds: string[];
  subjectId: string;
  evidence: Evidence;
}

/** Only user-reviewed, still-grounded local meeting actions are a proactive source. */
export class ProactiveRuntime {
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private running = false;
  private generation = 0;

  constructor(
    private readonly d: {
      meetings: MeetingStore;
      review: MeetingReviewRuntime;
      memory: MemoryRuntime;
      capabilities: CapabilityManager;
      notifications: NotificationService;
      bus: EventBus;
      killSwitchEngaged: () => boolean;
    },
  ) {}
  /** No polling is armed until a persisted opt-in includes an explicit cadence. */
  startScheduler(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribe = this.d.bus.subscribe(
      "proactive-scheduler",
      [
        "security.kill_switch.engaged",
        "security.kill_switch.disengaged",
        "capability.disabled",
        "capability.enabled",
      ],
      (event) => {
        if (event.event_type === "security.kill_switch.engaged") this.clearTimer();
        else if (event.event_type === "security.kill_switch.disengaged") this.schedule();
        else if (event.subject === SOURCE) this.schedule();
      },
    );
    this.schedule();
  }

  stopScheduler(): void {
    this.running = false;
    this.clearTimer();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private clearTimer(): void {
    this.generation++;
    clearTimeout(this.timer ?? undefined);
    this.timer = null;
  }

  private schedule(): void {
    this.clearTimer();
    if (!this.running || this.d.killSwitchEngaged() || !this.sourceAvailable()) return;
    let prefs: ProactivePreferences;
    try {
      prefs = this.d.notifications.proactivePreferences(this.userId);
    } catch {
      return;
    }
    if (!prefs.enabled || !prefs.capabilities.includes(SOURCE)) return;
    const cadence = prefs.cadenceMinutes;
    if (cadence !== 15 && cadence !== 30 && cadence !== 60 && cadence !== 1440) return;
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.running || generation !== this.generation || this.d.killSwitchEngaged()) return;
      try {
        const current = this.d.notifications.proactivePreferences(this.userId);
        if (
          !current.enabled ||
          !current.capabilities.includes(SOURCE) ||
          current.cadenceMinutes !== cadence ||
          !this.sourceAvailable()
        )
          return;
        this.evaluate();
      } catch {
        // Unavailable source or revoked consent never produces a notification.
      } finally {
        if (this.running && generation === this.generation) this.schedule();
      }
    }, cadence * 60_000);
    this.timer.unref();
  }

  private get userId(): string {
    return this.d.memory.agentContext().viewer.id;
  }

  private sourceAvailable(): boolean {
    try {
      return this.d.capabilities.get(SOURCE).status === "enabled";
    } catch {
      return false;
    }
  }

  status(): ProactiveStatus {
    return {
      preferences: this.d.notifications.proactivePreferences(this.userId),
      source: { capability_id: SOURCE, available: this.sourceAvailable(), mode: "manual" },
      noise: this.d.notifications.noiseMetrics(this.userId),
    };
  }

  setPreferences(input: unknown): ProactiveStatus {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Preferences must be an object");
    const record = input as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!["enabled", "capabilities", "quietHours", "maxPerHour", "cadenceMinutes"].includes(key))
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, `Unknown preference field: ${key}`);
    }
    if (
      record.capabilities !== undefined &&
      (!Array.isArray(record.capabilities) || record.capabilities.some((c) => c !== SOURCE))
    )
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        "Only kage is a supported proactive source",
      );
    try {
      this.d.notifications.setProactivePreferences(
        this.userId,
        record as Partial<ProactivePreferences>,
      );
    } catch (error) {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        error instanceof Error ? error.message : "Invalid preferences",
      );
    }
    if (this.running) this.schedule();
    return this.status();
  }

  /** A retained review row alone is not proof the action remains in its source summary. */
  private evidence(
    meetingId: string,
    source: "transcript" | "summary",
    quote: string,
    text: string,
  ): boolean {
    if (!quote.trim()) return false;
    const inSummary =
      this.d.meetings.summary(meetingId)?.action_items?.some((raw) => {
        const value =
          typeof raw === "string"
            ? raw
            : raw && typeof raw === "object"
              ? ((raw as Record<string, unknown>).text ??
                (raw as Record<string, unknown>).task ??
                (raw as Record<string, unknown>).description)
              : null;
        return typeof value === "string" && value.trim().slice(0, 500) === text;
      }) === true;
    return (
      inSummary &&
      (source === "summary" || this.d.meetings.transcript(meetingId)?.text.includes(quote) === true)
    );
  }

  private current(candidate: ProactiveCandidate): boolean {
    if (
      !this.sourceAvailable() ||
      candidate.kind !== "unassigned_action" ||
      candidate.capabilityId !== SOURCE ||
      candidate.evidenceIds.length !== 1 ||
      candidate.evidenceIds[0] !== candidate.subjectId ||
      candidate.evidence.item_id !== candidate.subjectId
    )
      return false;
    const meeting = this.d.meetings.get(candidate.evidence.meeting_id);
    if (!meeting || meeting.capability_id !== SOURCE || meeting.archived_at !== null) return false;
    try {
      const item = this.d.review
        .list(meeting.id, { status: "accepted", kind: "action_item" })
        .items.find((i) => i.id === candidate.subjectId);
      return (
        !!item &&
        item.owner === null &&
        item.reviewed_by === this.userId &&
        item.extracted_by === "kage" &&
        (!item.original || item.original.text === item.text) &&
        item.evidence?.source === candidate.evidence.source &&
        item.evidence.quote === candidate.evidence.quote &&
        this.evidence(meeting.id, candidate.evidence.source, candidate.evidence.quote, item.text)
      );
    } catch {
      return false;
    }
  }

  preview(): { insights: ProactiveCandidate[] } {
    if (!this.sourceAvailable()) return { insights: [] };
    const actions: ReviewedAction[] = [];
    const evidence = new Map<string, Evidence>();
    for (const meeting of this.d.meetings.list({ limit: 500 })) {
      if (meeting.capability_id !== SOURCE || meeting.archived_at !== null) continue;
      let items;
      try {
        items = this.d.review.list(meeting.id, { status: "accepted", kind: "action_item" }).items;
      } catch {
        continue;
      }
      for (const item of items) {
        if (
          item.owner !== null ||
          item.reviewed_by !== this.userId ||
          item.extracted_by !== "kage" ||
          !item.evidence ||
          (item.original && item.original.text !== item.text) ||
          !this.evidence(meeting.id, item.evidence.source, item.evidence.quote, item.text)
        )
          continue;
        evidence.set(item.id, {
          meeting_id: meeting.id,
          item_id: item.id,
          source: item.evidence.source,
          quote: item.evidence.quote,
        });
        actions.push({
          id: item.id,
          capabilityId: SOURCE,
          evidenceId: item.id,
          status: "accepted",
          kind: "action_item",
          owner: null,
          current: true,
        });
      }
    }
    return {
      insights: generateInsights({ items: actions }).flatMap((insight) => {
        const source = evidence.get(insight.subjectId);
        return source && insight.kind === "unassigned_action" && insight.capabilityId === SOURCE
          ? [
              {
                ...insight,
                kind: "unassigned_action" as const,
                capabilityId: SOURCE,
                evidence: source,
              },
            ]
          : [];
      }),
    };
  }

  evaluate(): {
    delivered: { insight_id: string; notification: Notification }[];
    suppressed: number;
  } {
    const prefs = this.d.notifications.proactivePreferences(this.userId);
    if (this.d.killSwitchEngaged() || !prefs.enabled || !prefs.capabilities.includes(SOURCE))
      throw new PhoenixError(
        ErrorCode.SECURITY_POLICY_BLOCKED,
        "Proactive meeting notifications require opt-in",
      );
    const delivered: { insight_id: string; notification: Notification }[] = [];
    let suppressed = 0;
    for (const candidate of this.preview().insights) {
      if (this.d.killSwitchEngaged()) break;
      const notification = this.d.notifications.considerInsight(
        this.userId,
        candidate,
        () => !this.d.killSwitchEngaged() && this.current(candidate),
      );
      if (notification) delivered.push({ insight_id: candidate.id, notification });
      else suppressed++;
    }
    return { delivered, suppressed };
  }

  dismiss(id: string): { dismissed: string } {
    try {
      this.d.notifications.dismissInsight(this.userId, id);
    } catch (error) {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        error instanceof Error ? error.message : "Invalid insight id",
      );
    }
    return { dismissed: id };
  }

  noise(): NoiseMetrics {
    return this.d.notifications.noiseMetrics(this.userId);
  }
}
