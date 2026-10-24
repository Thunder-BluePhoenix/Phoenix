// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Configuration for chat approvals. Everything defaults to OFF: no provider, no project, no
// notification. Config never holds a credential (the capability manager rejects secret-looking
// keys and values); bot tokens, signing secrets and the Teams webhook live in the secret store.
import {
  DEFAULT_DIGEST_INTERVAL_MINUTES,
  MAX_DIGEST_INTERVAL_MINUTES,
  MIN_DIGEST_INTERVAL_MINUTES,
  OFF_SCHEDULE,
  type DigestSchedule,
  type QuietHours,
} from "./digest";
import type { ApprovalSnapshot, Provider } from "./types";

export const DEFAULT_TOKEN_TTL_SECONDS = 300;
export const MIN_TOKEN_TTL_SECONDS = 30;
export const MAX_TOKEN_TTL_SECONDS = 900;
const MAX_APPROVERS = 20;
const MAX_PROJECTS = 200;

/** Provider user, workspace and channel ids are short alphanumerics; anything else is refused. */
export const PROVIDER_ID = /^[A-Za-z0-9]{1,24}$/;

export interface ChatProviderConfig {
  /** Master switch for this provider: cards and button presses. */
  enabled: boolean;
  /** Slack team id / Discord guild id the buttons may be pressed in. */
  workspace: string;
  channel: string;
  /** Provider user ids allowed to decide. Empty means nobody, so no card is ever generated. */
  approvers: string[];
  /** Opt-in: a one-line "approval waiting" notice (no title) for requests not switched on for chat. */
  notify: boolean;
  /** Opt-in: counts-only digest, posted only when asked. */
  digest: boolean;
}

export interface TeamsConfig {
  enabled: boolean;
  notify: boolean;
  digest: boolean;
}

export interface ChatConfig {
  /** Projects switched on for "approve from chat". Anything not listed is off. */
  projects: string[];
  /** Phoenix's own confirmations (no project). Off unless set. */
  phoenixConfirmations: boolean;
  ttlMs: number;
  slack: ChatProviderConfig;
  discord: ChatProviderConfig;
  teams: TeamsConfig;
  /** Opt-in scheduled digest (default off); each provider's own `digest` switch must also be on. */
  digestSchedule: DigestSchedule;
}

const bool = (value: unknown): boolean => value === true;

function ids(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && PROVIDER_ID.test(v))
    .slice(0, max);
}

const idOf = (value: unknown): string =>
  typeof value === "string" && PROVIDER_ID.test(value) ? value : "";

function provider(value: unknown): ChatProviderConfig {
  const o = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    enabled: bool(o.enabled),
    workspace: idOf(o.workspace),
    channel: idOf(o.channel),
    approvers: ids(o.approvers, MAX_APPROVERS),
    notify: bool(o.notify),
    digest: bool(o.digest),
  };
}

function quietHours(value: unknown): QuietHours | null {
  if (value === null || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (typeof o.timezone !== "string" || typeof o.start !== "string" || typeof o.end !== "string")
    return null;
  return { timezone: o.timezone.slice(0, 64), start: o.start, end: o.end };
}

function digestSchedule(value: unknown): DigestSchedule {
  if (value === null || typeof value !== "object") return OFF_SCHEDULE;
  const o = value as Record<string, unknown>;
  const minutes = Number.isInteger(o.interval_minutes)
    ? Math.min(
        MAX_DIGEST_INTERVAL_MINUTES,
        Math.max(MIN_DIGEST_INTERVAL_MINUTES, o.interval_minutes as number),
      )
    : DEFAULT_DIGEST_INTERVAL_MINUTES;
  return {
    enabled: bool(o.enabled),
    intervalMs: minutes * 60_000,
    quietHours: quietHours(o.quiet_hours),
  };
}

/** Never throws: a missing or malformed value falls back to OFF. */
export function parseConfig(raw: Readonly<Record<string, unknown>>): ChatConfig {
  const teams =
    raw.teams !== null && typeof raw.teams === "object"
      ? (raw.teams as Record<string, unknown>)
      : {};
  const ttl = Number.isInteger(raw.token_ttl_seconds)
    ? Math.min(
        MAX_TOKEN_TTL_SECONDS,
        Math.max(MIN_TOKEN_TTL_SECONDS, raw.token_ttl_seconds as number),
      )
    : DEFAULT_TOKEN_TTL_SECONDS;
  return {
    projects: Array.isArray(raw.projects)
      ? raw.projects
          .filter((p): p is string => typeof p === "string" && p.length > 0 && p.length <= 120)
          .slice(0, MAX_PROJECTS)
      : [],
    phoenixConfirmations: bool(raw.phoenix_confirmations),
    ttlMs: ttl * 1000,
    slack: provider(raw.slack),
    discord: provider(raw.discord),
    teams: { enabled: bool(teams.enabled), notify: bool(teams.notify), digest: bool(teams.digest) },
    digestSchedule: digestSchedule(raw.digest_schedule),
  };
}

/**
 * The per-project "approve from chat" switch. Checked before a card is generated AND again when a
 * button is pressed, against the request as it is now. Default OFF.
 */
export function chatAllowed(config: ChatConfig, snapshot: ApprovalSnapshot): boolean {
  if (snapshot.source === "confirmation") return config.phoenixConfirmations;
  return snapshot.project !== undefined && config.projects.includes(snapshot.project);
}

/** Can this provider generate a card or take a press at all? */
export function providerReady(config: ChatConfig, p: Provider): boolean {
  if (p === "teams") return config.teams.enabled;
  const c = config[p];
  return c.enabled && c.workspace !== "" && c.channel !== "" && c.approvers.length > 0;
}

export const CONFIG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    projects: {
      type: "array",
      maxItems: MAX_PROJECTS,
      items: { type: "string", minLength: 1, maxLength: 120 },
      description:
        "Projects whose agent approvals may be answered from chat. Empty (default): none.",
    },
    phoenix_confirmations: {
      type: "boolean",
      description:
        "Allow Phoenix's own confirmations (not tied to a project) to be answered from chat (default off)",
    },
    token_ttl_seconds: {
      type: "integer",
      minimum: MIN_TOKEN_TTL_SECONDS,
      maximum: MAX_TOKEN_TTL_SECONDS,
      description: `How long a button stays valid, never beyond the request itself (default ${DEFAULT_TOKEN_TTL_SECONDS})`,
    },
    digest_schedule: {
      type: "object",
      additionalProperties: false,
      description:
        "Opt-in scheduled approvals digest (default off). Counts and short approval ids and action names only, sent to providers whose own digest switch is on, at most once per interval, never in quiet hours, never when nothing happened.",
      properties: {
        enabled: { type: "boolean" },
        interval_minutes: {
          type: "integer",
          minimum: MIN_DIGEST_INTERVAL_MINUTES,
          maximum: MAX_DIGEST_INTERVAL_MINUTES,
          description: `Minutes between digests, at least ${MIN_DIGEST_INTERVAL_MINUTES} (default ${DEFAULT_DIGEST_INTERVAL_MINUTES})`,
        },
        quiet_hours: {
          type: "object",
          additionalProperties: false,
          properties: {
            timezone: { type: "string", minLength: 1, maxLength: 64 },
            start: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
            end: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
          },
        },
      },
    },
    slack: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        workspace: { type: "string", pattern: "^[A-Za-z0-9]{1,24}$", description: "Slack team id" },
        channel: {
          type: "string",
          pattern: "^[A-Za-z0-9]{1,24}$",
          description: "Slack channel id",
        },
        approvers: {
          type: "array",
          maxItems: MAX_APPROVERS,
          items: { type: "string", pattern: "^[A-Za-z0-9]{1,24}$" },
          description: "Slack user ids that may decide. Empty: nobody.",
        },
        notify: { type: "boolean" },
        digest: { type: "boolean" },
      },
    },
    discord: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        workspace: {
          type: "string",
          pattern: "^[A-Za-z0-9]{1,24}$",
          description: "Discord guild id",
        },
        channel: {
          type: "string",
          pattern: "^[A-Za-z0-9]{1,24}$",
          description: "Discord channel id",
        },
        approvers: {
          type: "array",
          maxItems: MAX_APPROVERS,
          items: { type: "string", pattern: "^[A-Za-z0-9]{1,24}$" },
          description: "Discord user ids that may decide. Empty: nobody.",
        },
        notify: { type: "boolean" },
        digest: { type: "boolean" },
      },
    },
    teams: {
      type: "object",
      additionalProperties: false,
      description:
        "Teams is notify-only: cards carry an Open in Phoenix link, never an Allow button.",
      properties: {
        enabled: { type: "boolean" },
        notify: { type: "boolean" },
        digest: { type: "boolean" },
      },
    },
  },
} as const;
