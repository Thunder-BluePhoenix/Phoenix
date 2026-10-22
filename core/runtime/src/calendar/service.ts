// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash } from "node:crypto";
import {
  prepareMeeting,
  safeEvent,
  safeLink,
  type CalendarEvent,
  type MeetingPrep,
  type MeetingPrepQuery,
} from "@phoenix/capability-calendar";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { FREEZE_FEED_MAX_AGE_MS, type FreezeSnapshot } from "./freeze";

const CAPABILITY_ID = "calendar";
/** Prep reads local meeting metadata per event, so it is bounded to the soonest meetings. */
const PREP_EVENT_LIMIT = 50;

/** The slice of the capability manager the calendar service needs. */
export interface CalendarCapabilityHost {
  get(id: string): { status: string; config?: Record<string, unknown> };
  invokeAndWait(
    id: string,
    command: string,
    input?: unknown,
    actor?: string,
  ): Promise<{ status: string; result?: unknown }>;
}

/**
 * `ready`: a fresh feed was read. `unconfigured`: calendar is enabled but no provider is on.
 * `unavailable`: the last provider read failed or the capability command failed.
 * `stale`: the last successful read is too old (or dated in the future) to be trusted.
 * In every state except `ready` no events are returned, so an old feed is never shown as current.
 */
export type CalendarFeedStatus = "ready" | "unconfigured" | "unavailable" | "stale";

export interface CalendarEventView {
  id: string;
  title: string;
  start: string;
  end: string;
  timezone: string;
  url?: string;
  private: boolean;
  deployFreeze?: boolean;
}

export interface CalendarPrepView {
  decisions: MeetingPrep["decisions"];
  actionItems: MeetingPrep["actionItems"];
}

export interface CalendarUpcomingView {
  /** Calendar capability is enabled. When false nothing else is read and no provider is contacted. */
  enabled: boolean;
  events: CalendarEventView[];
  prep: Record<string, CalendarPrepView>;
  status: CalendarFeedStatus;
  /** Epoch ms of the feed read the events came from; null when there is none. */
  checkedAt: number | null;
  /** Events beyond the prep limit have no prep computed. */
  prepComplete: boolean;
}

export interface CalendarServiceOptions {
  capabilities: CalendarCapabilityHost;
  prep: MeetingPrepQuery;
  now?: () => number;
}

interface UpcomingResult {
  configured?: unknown;
  events?: unknown;
  checkedAt?: unknown;
  error?: unknown;
}

interface Feed {
  status: CalendarFeedStatus;
  checkedAt: number | null;
  events: CalendarEvent[];
}

function isEventLike(value: unknown): value is CalendarEvent {
  return (
    value !== null &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    "title" in value &&
    typeof value.title === "string" &&
    "start" in value &&
    typeof value.start === "string" &&
    "end" in value &&
    typeof value.end === "string" &&
    "timezone" in value &&
    typeof value.timezone === "string" &&
    "private" in value &&
    typeof value.private === "boolean" &&
    "attendees" in value &&
    Array.isArray(value.attendees) &&
    value.attendees.every((a: unknown) => typeof a === "string") &&
    (!("url" in value) || value.url === undefined || typeof value.url === "string") &&
    (!("project" in value) || value.project === undefined || typeof value.project === "string")
  );
}

/**
 * Read-only owner view over the calendar capability's `upcoming` command. It adds no data of its
 * own: nothing is returned unless the capability is enabled and its feed is fresh.
 */
export class CalendarService {
  private readonly now: () => number;

  constructor(private readonly options: CalendarServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  /** `GET /api/calendar/upcoming`. */
  async upcoming(): Promise<CalendarUpcomingView> {
    const feed = await this.feed();
    if (!feed)
      return {
        enabled: false,
        events: [],
        prep: {},
        status: "unconfigured",
        checkedAt: null,
        prepComplete: true,
      };
    const events = feed.events.filter((event) => !event.cancelled);
    const prep: Record<string, CalendarPrepView> = {};
    let prepComplete = true;
    let prepared = 0;
    for (const event of events) {
      if (event.private) continue;
      if (prepared >= PREP_EVENT_LIMIT) {
        prepComplete = false;
        break;
      }
      prepared += 1;
      let result: MeetingPrep;
      try {
        result = await prepareMeeting(event, this.options.prep);
      } catch {
        prepComplete = false;
        continue;
      }
      if (result.decisions.length || result.actionItems.length)
        prep[event.id] = { decisions: result.decisions, actionItems: result.actionItems };
    }
    return {
      enabled: true,
      events: events.map(toView),
      prep,
      status: feed.status,
      checkedAt: feed.checkedAt,
      prepComplete,
    };
  }

  private freezeEnabled(): boolean {
    try {
      const calendar = this.options.capabilities.get(CAPABILITY_ID);
      return calendar.status === "enabled" && calendar.config?.freeze === true;
    } catch {
      return false;
    }
  }

  /**
   * Snapshot for `assertDeployAllowed`, read fresh for each call. Freeze off (the default): no hold.
   * Freeze on but the feed unreadable, stale or unconfigured: `enabled: true` with no events, which
   * blocks the deployment.
   */
  async freezeSnapshot(): Promise<FreezeSnapshot> {
    // The freeze is the owner's explicit choice (calendar config `freeze`); the default is no hold.
    if (!this.freezeEnabled()) return { enabled: false, checkedAt: this.now() };
    // A cached feed up to a minute old is not good enough right before a deployment.
    const feed = await this.feed(true);
    if (!feed || feed.status === "unconfigured")
      return { enabled: true, checkedAt: feed?.checkedAt ?? Number.NaN };
    return {
      enabled: true,
      checkedAt: feed.checkedAt ?? Number.NaN,
      ...(feed.status === "ready" ? { events: feed.events } : {}),
    };
  }
  /** `undefined` when the capability is not enabled; the command is then never invoked. */
  private async feed(refresh = false): Promise<Feed | undefined> {
    if (!this.isEnabled()) return undefined;
    let op: { status: string; result?: unknown };
    try {
      op = await this.options.capabilities.invokeAndWait(
        CAPABILITY_ID,
        "upcoming",
        refresh ? { refresh: true } : {},
        "user",
      );
    } catch (error) {
      // Disabled between the status check and the invocation.
      if (error instanceof PhoenixError && error.code === ErrorCode.CAPABILITY_DISABLED)
        return undefined;
      return { status: "unavailable", checkedAt: null, events: [] };
    }
    const result = op.status === "succeeded" ? op.result : undefined;
    if (result === null || typeof result !== "object")
      return { status: "unavailable", checkedAt: null, events: [] };
    // Shape of the capability's `upcoming` result; each field is still checked before use.
    const feed = result as UpcomingResult;
    if (!Array.isArray(feed.events)) return { status: "unavailable", checkedAt: null, events: [] };
    const checkedAt =
      typeof feed.checkedAt === "number" && Number.isFinite(feed.checkedAt) ? feed.checkedAt : null;
    if (feed.configured === false && feed.error == null)
      return { status: "unconfigured", checkedAt, events: [] };
    if (feed.error != null || checkedAt === null)
      return { status: "unavailable", checkedAt, events: [] };
    const age = this.now() - checkedAt;
    if (age < 0 || age > FREEZE_FEED_MAX_AGE_MS) return { status: "stale", checkedAt, events: [] };
    const events: CalendarEvent[] = [];
    for (const raw of feed.events as unknown[]) {
      const safe = isEventLike(raw) ? safeEvent(raw) : null;
      // A dropped event could be a freeze window, so the feed is not complete.
      if (!safe) return { status: "unavailable", checkedAt, events: [] };
      events.push(safe);
    }
    return { status: "ready", checkedAt, events };
  }

  private isEnabled(): boolean {
    try {
      return this.options.capabilities.get(CAPABILITY_ID).status === "enabled";
    } catch (error) {
      if (error instanceof PhoenixError && error.code === ErrorCode.RESOURCE_NOT_FOUND)
        return false;
      throw error;
    }
  }
}

/** Private events are reduced to times only; attendees, project and prep are never exposed. */
function toView(event: CalendarEvent): CalendarEventView {
  const base = {
    id: event.private ? createHash("sha256").update(event.id).digest("hex") : event.id,
    start: event.start,
    end: event.end,
    timezone: event.timezone,
  };
  if (event.private) return { ...base, title: "Busy", private: true };
  const url = safeLink(event.url);
  return {
    ...base,
    title: event.title,
    ...(url ? { url } : {}),
    private: false,
    ...(event.deployFreeze ? { deployFreeze: true } : {}),
  };
}
