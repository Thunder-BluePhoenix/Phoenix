// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// User-triggered daily-digest delivery is deliberately separate from Phase 86's
// counts-only approval digest. It reuses only the guarded Slack transport and the
// Slack credentials/configuration the owner already set there.
import {
  parseConfig,
  providerReady,
  SECRETS,
  slackPost,
  type HttpTransport,
} from "@phoenix/capability-chat-approvals";
import type { AuditLog, PermissionGateway } from "@phoenix/permissions";
import type { SecretStore, SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { cleanTitle, type DailyDigest, type DigestLine } from "./index";
import type { DailyDigestService } from "./service";

export const DAILY_DIGEST_SLACK_SETTINGS_KEY = "daily-digest.slack";
const CHAT_APPROVALS_CAPABILITY = "chat-approvals";
const SLACK_BOT_TOKEN_REF = `capability.${CHAT_APPROVALS_CAPABILITY}.${SECRETS.slackBotToken}`;
const MAX_PREVIEW_CHARS = 1_200;
const MAX_SECTION_LINES = 30;
const MAX_BLOCK_CHARS = 2_800;

type Section = "yesterday" | "today" | "blockers" | "endOfDay";

export interface DailyDigestSlackStatus {
  enabled: boolean;
  available: boolean;
  reason:
    | "ready"
    | "disabled"
    | "chat_unavailable"
    | "slack_unconfigured"
    | "missing_token"
    | "emergency_stop";
}

export interface DailyDigestSlackResult {
  ok: true;
  day: string;
  cited_sources: number;
}

export interface DailyDigestSlackDependencies {
  digest: Pick<DailyDigestService, "generate">;
  permissions: Pick<PermissionGateway, "authorize" | "recordOutcome" | "isKillSwitchEngaged">;
  audit: Pick<AuditLog, "record">;
  settings: Pick<SettingsStore, "get" | "set">;
  secrets: Pick<SecretStore, "get">;
  transport: HttpTransport;
  /** Live Phase 86 configuration; this has no daily-digest switch. */
  chatConfig: () => Readonly<Record<string, unknown>>;
  chatEnabled: () => boolean;
}

const sections: readonly { key: Section; label: string }[] = [
  { key: "yesterday", label: "Yesterday" },
  { key: "today", label: "Today (confirmed plans)" },
  { key: "blockers", label: "Blockers" },
  { key: "endOfDay", label: "End of day" },
];

function enabled(value: unknown): boolean {
  return (
    value !== null && typeof value === "object" && "enabled" in value && value.enabled === true
  );
}

function validToken(value: string | undefined): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 8192 && !/[\r\n\0]/.test(value)
  );
}

/** Slack mrkdwn treats angle brackets as special link/entity syntax. */
function mrkdwn(value: string): string {
  return cleanTitle(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function lines(values: readonly DigestLine[]): string[] {
  return values
    .slice(0, MAX_SECTION_LINES)
    .map((line) => `• ${mrkdwn(line.text)} (${line.source.href})`);
}

function bounded(value: string): string {
  return Array.from(value).slice(0, MAX_BLOCK_CHARS).join("");
}

function formatted(digest: DailyDigest): {
  fallback: string;
  blocks: unknown[];
  citedSources: number;
} {
  const rows = sections.map(({ key, label }) => ({ label, lines: lines(digest[key]) }));
  const citedSources = rows.reduce((count, section) => count + section.lines.length, 0);
  const fallback = [
    `Daily digest — ${digest.day}`,
    ...rows.flatMap(({ label, lines: entries }) => [
      label,
      ...(entries.length ? entries : ["• No linked activity"]),
    ]),
  ].join("\n");
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Daily digest — ${digest.day}`, emoji: false },
    },
  ];
  for (const { label, lines: entries } of rows) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: bounded(`*${label}*\n${entries.length ? entries.join("\n") : "No linked activity"}`),
      },
    });
  }
  if (digest.unavailable.length || digest.partial.length || digest.unattributed.length) {
    const notices = [
      ...(digest.unavailable.length
        ? [`Unavailable sources: ${digest.unavailable.join(", ")}`]
        : []),
      ...(digest.partial.length ? [`Partial sources: ${digest.partial.join(", ")}`] : []),
      ...(digest.unattributed.length
        ? [`Unattributed sources: ${digest.unattributed.join(", ")}`]
        : []),
    ];
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: bounded(notices.join(" · ")) }],
    });
  }
  return { fallback: bounded(fallback), blocks, citedSources };
}

/** The only Core path that can disclose a generated daily digest to Slack. */
export class DailyDigestSlackService {
  constructor(private readonly d: DailyDigestSlackDependencies) {}

  private chat(): { channel: string } | null {
    if (!this.d.chatEnabled()) return null;
    const config = parseConfig(this.d.chatConfig());
    return providerReady(config, "slack") ? { channel: config.slack.channel } : null;
  }

  private audit(
    action: string,
    decision: "info" | "blocked",
    details: Record<string, unknown> = {},
  ): void {
    this.d.audit.record({
      actor: "user",
      action,
      capabilityId: CHAT_APPROVALS_CAPABILITY,
      decision,
      details,
    });
  }

  async status(): Promise<DailyDigestSlackStatus> {
    if (!enabled(this.d.settings.get<unknown>(DAILY_DIGEST_SLACK_SETTINGS_KEY, null)))
      return { enabled: false, available: false, reason: "disabled" };
    if (this.d.permissions.isKillSwitchEngaged())
      return { enabled: true, available: false, reason: "emergency_stop" };
    if (!this.d.chatEnabled())
      return { enabled: true, available: false, reason: "chat_unavailable" };
    if (!this.chat()) return { enabled: true, available: false, reason: "slack_unconfigured" };
    if (!validToken(await this.d.secrets.get(SLACK_BOT_TOKEN_REF)))
      return { enabled: true, available: false, reason: "missing_token" };
    return { enabled: true, available: true, reason: "ready" };
  }

  async setEnabled(value: boolean): Promise<DailyDigestSlackStatus> {
    this.d.settings.set(DAILY_DIGEST_SLACK_SETTINGS_KEY, { enabled: value });
    this.audit("daily_digest.slack.setting", "info", { enabled: value });
    return this.status();
  }

  async send(day?: string): Promise<DailyDigestSlackResult> {
    if (this.d.permissions.isKillSwitchEngaged())
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");
    const status = await this.status();
    if (!status.enabled)
      throw new PhoenixError(
        ErrorCode.PERMISSION_DENIED,
        "Daily digest Slack delivery is disabled",
      );
    if (!status.available)
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "Slack daily digest delivery is unavailable",
      );
    const chat = this.chat();
    const token = await this.d.secrets.get(SLACK_BOT_TOKEN_REF);
    if (!chat || !validToken(token))
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "Slack daily digest delivery is unavailable",
      );

    // Generate on Core, immediately before asking. The request never supplies text or destination.
    const digest = await this.d.digest.generate(day);
    const message = formatted(digest);
    let action;
    try {
      action = await this.d.permissions.authorize({
        capabilityId: CHAT_APPROVALS_CAPABILITY,
        command: "post_daily_digest",
        permissions: ["network", "external_api"],
        sideEffect: "external",
        summary: `Send the ${digest.day} daily digest to configured Slack channel ${chat.channel}`,
        details: {
          digest_preview: message.fallback.replace(/[\r\n]+/g, " ").slice(0, MAX_PREVIEW_CHARS),
          cited_source_count: message.citedSources,
        },
      });
      // The kill switch may have been engaged while the confirmation was pending.
      if (this.d.permissions.isKillSwitchEngaged())
        throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");
      await slackPost(this.d.transport, token, chat.channel, message.fallback, message.blocks);
    } catch (error) {
      if (action) this.d.permissions.recordOutcome(action, "failed", { day: digest.day });
      else this.audit("daily_digest.slack.failed", "blocked", { day: digest.day });
      throw error;
    }
    this.d.permissions.recordOutcome(action, "succeeded", {
      day: digest.day,
      cited_source_count: message.citedSources,
    });
    return { ok: true, day: digest.day, cited_sources: message.citedSources };
  }
}
