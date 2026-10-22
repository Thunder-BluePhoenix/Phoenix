// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  NO_CONSENT,
  TEAM_ITEM_KINDS,
  isTeamItemKind,
  minuteFloor,
  type TeamClock,
  type TeamConsent,
  type TeamItem,
  type TeamItemKind,
} from "./kinds";

/** The `SettingsStore` surface this module needs; it never stores secrets. */
export interface TeamSettings {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
}

export const TEAM_SHARING_KEY = "team-status.sharing";
/** A run is only "long" (and therefore only shareable) after this long. */
export const LONG_AGENT_RUN_MS = 10 * 60_000;
/** An activity whose end event never arrived stops being shared after this long. */
export const MAX_ACTIVE_MS = 6 * 60 * 60_000;
const MAX_TRACKED_PER_KIND = 64;

/** Event types that start / end each shareable state. Everything else is ignored. */
const STARTS: ReadonlyMap<string, TeamItemKind> = new Map([
  ["deploy.started", "deploying"],
  ["agent_run.started", "agent_run"],
  ["kage.meeting.started", "meeting"],
]);
const ENDS: ReadonlyMap<string, TeamItemKind> = new Map([
  ["deploy.succeeded", "deploying"],
  ["deploy.failed", "deploying"],
  ["agent_run.completed", "agent_run"],
  ["agent_run.failed", "agent_run"],
  ["agent_run.cancelled", "agent_run"],
  ["kage.meeting.ended", "meeting"],
  ["kage.meeting.archived", "meeting"],
  ["kage.meeting.failed", "meeting"],
]);

/** Only these envelope fields are read from an observed event; payloads are never looked at. */
export interface ObservedEvent {
  event_type: string;
  source: string;
  correlation_id?: string;
  subject?: string;
}

export interface TeamSharingConfig {
  /** Master switch. Off by default; nothing leaves this install while it is off. */
  enabled: boolean;
  /** Per-item consent. Every kind is off until the user turns it on. */
  consent: TeamConsent;
}

/** What would be (or is) sent to teammates right now. */
export interface TeamOutgoing {
  sharing: boolean;
  items: TeamItem[];
}

export interface TeamSharingView extends TeamSharingConfig {
  /** Exactly the frame body content a teammate would receive, so the user can see it first. */
  outgoing: TeamOutgoing;
}

function parseConfig(raw: unknown): TeamSharingConfig {
  const config: TeamSharingConfig = { enabled: false, consent: { ...NO_CONSENT } };
  if (raw === null || typeof raw !== "object") return config;
  const record = raw as Record<string, unknown>;
  config.enabled = record.enabled === true;
  const consent = record.consent;
  if (consent !== null && typeof consent === "object") {
    for (const kind of TEAM_ITEM_KINDS) {
      config.consent[kind] = (consent as Record<string, unknown>)[kind] === true;
    }
  }
  return config;
}

/**
 * The local half of team status: which of my states may be shared. Opt-in (off), per item, and
 * minimal by construction: a shared item is a kind and a minute-rounded start, never a name.
 */
export class TeamSharing {
  private config: TeamSharingConfig;
  private readonly active = new Map<TeamItemKind, Map<string, number>>(
    TEAM_ITEM_KINDS.map((kind) => [kind, new Map<string, number>()]),
  );
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly settings: TeamSettings,
    private readonly clock: TeamClock,
    private readonly longRunMs = LONG_AGENT_RUN_MS,
  ) {
    this.config = parseConfig(settings.get<unknown>(TEAM_SHARING_KEY, null));
  }

  /** Fires when what is shared may have changed (consent or an observed state). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  view(): TeamSharingView {
    return {
      enabled: this.config.enabled,
      consent: { ...this.config.consent },
      outgoing: this.outgoing(),
    };
  }

  /** Master opt-in / opt-out. Turning it off is immediate and keeps no consent for later items. */
  setEnabled(enabled: boolean): void {
    this.config = { ...this.config, enabled };
    this.persist();
  }

  /** Changes only the kinds named; unknown kinds are rejected so a typo cannot silently consent. */
  setConsent(change: Partial<Record<string, boolean>>): void {
    const consent = { ...this.config.consent };
    for (const [kind, value] of Object.entries(change)) {
      if (!isTeamItemKind(kind)) throw new RangeError(`Unknown team item kind: ${kind}`);
      if (typeof value !== "boolean") throw new RangeError(`Consent for ${kind} must be a boolean`);
      consent[kind] = value;
    }
    this.config = { ...this.config, consent };
    this.persist();
  }

  /** Records start/end of a shareable state. Reads the event type and keys only, never the payload. */
  observe(event: ObservedEvent): void {
    // Incoming webhooks are untrusted outsiders: a POST must not be able to tell the team I am deploying.
    if (event.source.startsWith("webhook-")) return;
    const started = STARTS.get(event.event_type);
    const ended = ENDS.get(event.event_type);
    const kind = started ?? ended;
    if (kind === undefined) return;
    const key = `${event.source}\n${event.correlation_id ?? event.subject ?? ""}`;
    const tracked = this.active.get(kind)!;
    if (started !== undefined) {
      tracked.delete(key);
      tracked.set(key, this.clock.now());
      while (tracked.size > MAX_TRACKED_PER_KIND) tracked.delete(tracked.keys().next().value!);
    } else if (!tracked.delete(key)) {
      return;
    }
    this.notify();
  }

  /** Items teammates may see: master switch on, kind consented, and (for runs) long enough. */
  outgoing(): TeamOutgoing {
    if (!this.config.enabled) return { sharing: false, items: [] };
    const now = this.clock.now();
    const items: TeamItem[] = [];
    for (const kind of TEAM_ITEM_KINDS) {
      if (!this.config.consent[kind]) continue;
      const tracked = this.active.get(kind)!;
      let earliest: number | undefined;
      for (const [key, since] of tracked) {
        if (now - since >= MAX_ACTIVE_MS) {
          tracked.delete(key);
          continue;
        }
        if (kind === "agent_run" && now - since < this.longRunMs) continue;
        if (earliest === undefined || since < earliest) earliest = since;
      }
      if (earliest !== undefined) items.push({ kind, since: minuteFloor(earliest) });
    }
    return { sharing: true, items };
  }

  private persist(): void {
    this.settings.set(TEAM_SHARING_KEY, this.config);
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
