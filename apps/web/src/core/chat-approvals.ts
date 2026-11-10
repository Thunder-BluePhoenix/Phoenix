// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Chat approvals settings (Phase 86), web side. The form edits the `chat-approvals` capability's
// stored config (ids, approver list, project allow-list, digest schedule) and sends its six secrets
// to Core's write-only secret route. The checks below repeat the capability's own (config.ts and
// digest.ts) so a bad value is refused on this page with a fixed text; Core's schema still decides.
// Nothing here ever holds a stored credential: the only secret this code touches is the value being
// typed, which the caller drops from the page as soon as it is sent.
import { useCallback, useRef, useState } from "react";
import type { MessageKey } from "../i18n";
import { ApiError } from "./client";
import { useClient } from "./context";

export const CHAT_APPROVALS_PATH = "/api/capabilities/chat-approvals";
export const chatSecretPath = (name: string) => `${CHAT_APPROVALS_PATH}/secrets/${name}`;

/** Same pattern as the capability's PROVIDER_ID: user, workspace and channel ids. */
export const PROVIDER_ID = /^[A-Za-z0-9]{1,24}$/;
export const MAX_APPROVERS = 20;
export const MAX_PROJECTS = 200;
export const MAX_PROJECT_CHARS = 120;
/** The capability's digest bounds: at least one hour, at most a week, default a day. */
export const MIN_DIGEST_MINUTES = 60;
export const MAX_DIGEST_MINUTES = 7 * 24 * 60;
export const DEFAULT_DIGEST_MINUTES = 24 * 60;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Control, line-break and invisible format (bidi, zero-width) characters.
const HIDDEN =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/;

export type ChatProviderId = "slack" | "discord" | "teams";

export interface ChatProviderForm {
  enabled: boolean;
  notify: boolean;
  digest: boolean;
}

export interface ChatIdProviderForm extends ChatProviderForm {
  workspace: string;
  channel: string;
  /** Provider user ids, separated by spaces, commas or line breaks. */
  approvers: string;
}

export interface ChatApprovalsForm {
  slack: ChatIdProviderForm;
  discord: ChatIdProviderForm;
  teams: ChatProviderForm;
  /** Project names, one per line or separated by commas. */
  projects: string;
  digestEnabled: boolean;
  /** Minutes between digests, as typed. */
  digestMinutes: string;
}

const bool = (value: unknown): boolean => value === true;
const idText = (value: unknown): string =>
  typeof value === "string" && PROVIDER_ID.test(value) ? value : "";

function idProvider(value: unknown): ChatIdProviderForm {
  const o = isRecord(value) ? value : {};
  return {
    enabled: bool(o.enabled),
    notify: bool(o.notify),
    digest: bool(o.digest),
    workspace: idText(o.workspace),
    channel: idText(o.channel),
    approvers: Array.isArray(o.approvers)
      ? o.approvers
          .filter((v): v is string => typeof v === "string" && PROVIDER_ID.test(v))
          .slice(0, MAX_APPROVERS)
          .join("\n")
      : "",
  };
}

/** The capability's stored config as form state. Missing or malformed parts read as OFF/empty. */
export function readForm(config: Record<string, unknown> | undefined): ChatApprovalsForm {
  const c = config ?? {};
  const teams = isRecord(c.teams) ? c.teams : {};
  const schedule = isRecord(c.digest_schedule) ? c.digest_schedule : {};
  return {
    slack: idProvider(c.slack),
    discord: idProvider(c.discord),
    teams: { enabled: bool(teams.enabled), notify: bool(teams.notify), digest: bool(teams.digest) },
    projects: Array.isArray(c.projects)
      ? c.projects
          .filter(
            (p): p is string =>
              typeof p === "string" && p.length > 0 && p.length <= MAX_PROJECT_CHARS,
          )
          .slice(0, MAX_PROJECTS)
          .join("\n")
      : "",
    digestEnabled: bool(schedule.enabled),
    digestMinutes: String(
      Number.isInteger(schedule.interval_minutes)
        ? schedule.interval_minutes
        : DEFAULT_DIGEST_MINUTES,
    ),
  };
}

export type ChatErrorKey = Extract<MessageKey, `chatApprovals.error.${string}`>;

/** Splits on spaces, commas and line breaks; empty parts and repeats are dropped. */
export function splitIds(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter((part) => part !== ""))];
}

/** Project names are separated by commas or line breaks (a name may contain spaces). */
export function splitProjects(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]+/)
        .map((part) => part.trim())
        .filter((p) => p !== ""),
    ),
  ];
}

/** The digest interval in minutes, or null unless it is a whole number from one hour to a week. */
export function digestMinutes(text: string): number | null {
  if (!/^\d{1,6}$/.test(text.trim())) return null;
  const minutes = Number(text.trim());
  return minutes >= MIN_DIGEST_MINUTES && minutes <= MAX_DIGEST_MINUTES ? minutes : null;
}

/**
 * Checks the form the way the capability will and returns the config to store, or the fixed error
 * to show. Keys the form does not edit (`phoenix_confirmations`, `token_ttl_seconds`, quiet hours)
 * are carried over unchanged. An empty id or approver list is allowed (the provider is then simply
 * not ready: no card, no press), but a value that is present must be well formed.
 */
export function buildConfig(
  form: ChatApprovalsForm,
  existing: Record<string, unknown> | undefined,
): { config: Record<string, unknown> } | { error: ChatErrorKey } {
  const idProviders = {} as Record<"slack" | "discord", Record<string, unknown>>;
  for (const id of ["slack", "discord"] as const) {
    const f = form[id];
    const workspace = f.workspace.trim();
    const channel = f.channel.trim();
    if (
      (workspace !== "" && !PROVIDER_ID.test(workspace)) ||
      (channel !== "" && !PROVIDER_ID.test(channel))
    )
      return { error: "chatApprovals.error.ids" };
    const approvers = splitIds(f.approvers);
    if (approvers.length > MAX_APPROVERS || !approvers.every((a) => PROVIDER_ID.test(a)))
      return { error: "chatApprovals.error.approvers" };
    idProviders[id] = {
      enabled: f.enabled,
      workspace,
      channel,
      approvers,
      notify: f.notify,
      digest: f.digest,
    };
  }
  const projects = splitProjects(form.projects);
  if (
    projects.length > MAX_PROJECTS ||
    !projects.every((p) => p.length <= MAX_PROJECT_CHARS && !HIDDEN.test(p))
  )
    return { error: "chatApprovals.error.projects" };
  const minutes = digestMinutes(form.digestMinutes);
  if (minutes === null) return { error: "chatApprovals.error.interval" };
  const old = existing ?? {};
  const oldSchedule = isRecord(old.digest_schedule) ? old.digest_schedule : {};
  return {
    config: {
      ...old,
      projects,
      slack: idProviders.slack,
      discord: idProviders.discord,
      teams: { enabled: form.teams.enabled, notify: form.teams.notify, digest: form.teams.digest },
      digest_schedule: {
        ...(isRecord(oldSchedule.quiet_hours) ? { quiet_hours: oldSchedule.quiet_hours } : {}),
        enabled: form.digestEnabled,
        interval_minutes: minutes,
      },
    },
  };
}

/** Would this provider generate a card or take a press? Mirrors the capability's `providerReady`. */
export function providerReady(form: ChatApprovalsForm, id: ChatProviderId): boolean {
  if (id === "teams") return form.teams.enabled;
  const f = form[id];
  return (
    f.enabled &&
    PROVIDER_ID.test(f.workspace.trim()) &&
    PROVIDER_ID.test(f.channel.trim()) &&
    splitIds(f.approvers).length > 0
  );
}

// ── Secrets ──────────────────────────────────────────────────────────────────

export interface ChatSecretSpec {
  /** The capability's secret name (see SECRETS in the capability). */
  name: string;
  provider: ChatProviderId;
  label: MessageKey;
  /** Shape check on what is typed; the capability checks again when it uses the value. */
  shape: "any" | "hex64" | "https";
}

export const CHAT_SECRETS: readonly ChatSecretSpec[] = [
  {
    name: "slack_bot_token",
    provider: "slack",
    label: "chatApprovals.field.slackBot",
    shape: "any",
  },
  {
    name: "slack_signing_secret",
    provider: "slack",
    label: "chatApprovals.field.slackSigning",
    shape: "any",
  },
  {
    name: "discord_bot_token",
    provider: "discord",
    label: "chatApprovals.field.discordBot",
    shape: "any",
  },
  {
    name: "discord_public_key",
    provider: "discord",
    label: "chatApprovals.field.discordKey",
    shape: "hex64",
  },
  {
    name: "teams_webhook_url",
    provider: "teams",
    label: "chatApprovals.field.teamsWebhook",
    shape: "https",
  },
  {
    name: "teams_link_key",
    provider: "teams",
    label: "chatApprovals.field.teamsKey",
    shape: "any",
  },
];

/** True when the typed value has the right outline for its secret. Never echoes the value. */
export function secretShapeOk(spec: ChatSecretSpec, value: string): boolean {
  if (value.length < 1 || value.length > 8192 || /[\u0000-\u001f\u007f\s]/.test(value))
    return false;
  if (spec.shape === "hex64") return /^[0-9a-fA-F]{64}$/.test(value);
  if (spec.shape === "https") return value.startsWith("https://");
  return true;
}

/** Which of the capability's declared secrets Core reports as stored (names only, never values). */
export function storedSecrets(
  secrets: { name: string; set: boolean }[] | undefined,
): ReadonlySet<string> {
  return new Set((secrets ?? []).filter((s) => s.set).map((s) => s.name));
}

// ── One request at a time, fixed error texts ─────────────────────────────────

/**
 * Runs one Core request. On failure only the caller's fixed message key is kept (and "no OS
 * credential store" has its own): Core's error text can quote what was sent, so it is dropped.
 */
export function useChatAction() {
  const client = useClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ChatErrorKey | null>(null);
  const inFlight = useRef(false);
  const run = useCallback(
    async <T = unknown>(
      method: string,
      path: string,
      body: unknown,
      failKey: ChatErrorKey,
    ): Promise<T | undefined> => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        return await client.request<T>(method, path, method === "GET" ? undefined : body);
      } catch (err) {
        setError(
          err instanceof ApiError && err.code === "CAPABILITY_UNAVAILABLE"
            ? "chatApprovals.error.unavailable"
            : failKey,
        );
        return undefined;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [client],
  );
  const fail = useCallback((key: ChatErrorKey) => setError(key), []);
  const clear = useCallback(() => setError(null), []);
  return { run, busy, error, fail, clear };
}

export interface ChatAction {
  run<T = unknown>(
    method: string,
    path: string,
    body: unknown,
    failKey: ChatErrorKey,
  ): Promise<T | undefined>;
  busy: boolean;
  error: ChatErrorKey | null;
  fail(key: ChatErrorKey): void;
  clear(): void;
}
