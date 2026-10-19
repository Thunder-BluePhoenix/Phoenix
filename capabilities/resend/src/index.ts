// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Resend capability (Phase 67): watches the emails your Resend account has SENT and turns delivery
// outcomes into resend.email.* events. Strictly read-only: it uses ReadOnlyClient (GET only) and
// has no command that sends, so it cannot send an email or touch anything at Resend.
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";
import {
  nextDelay,
  realSleep,
  safeBaseUrl,
  ServiceError,
  startPolling,
  type ReadOnlyClient,
  type ServiceItem,
  type ServiceStatus,
  type Sleep,
} from "@phoenix/service-kit";
import { DEFAULT_BASE_URL, EMAILS_PATH, SECRET_NAME, resendClient } from "./client";
import { EmailDiff, emailUrl } from "./events";
import { parseEmails, type ResendEmail } from "./parse";

export * from "./client";
export * from "./events";
export * from "./parse";

export const DEFAULT_POLL_MS = 60_000;
export const MIN_POLL_MS = 10_000;
const MAX_ITEMS = 25;
const BASE_URL_PATTERN =
  "^(https://[^\\s]+|http://(127\\.0\\.0\\.1|localhost)(:[0-9]+)?(/[^\\s]*)?)$";
const NO_KEY_NOTE = "Add a Resend API key in the capability's secrets";

export interface ResendCapabilityOptions {
  /** Epoch ms clock; tests pin it. */
  now?: () => number;
  /** Waits between polls; resolves early when `signal` aborts. Tests control time with it. */
  sleep?: Sleep;
}

interface Settings {
  /** Undefined when `base_url` is set to something safeBaseUrl refuses. */
  baseUrl: string | undefined;
  pollMs: number;
}

function settings(ctx: CapabilityContext): Settings {
  const { base_url, poll_ms } = ctx.config;
  return {
    baseUrl: typeof base_url === "string" ? safeBaseUrl(base_url) : DEFAULT_BASE_URL,
    pollMs: typeof poll_ms === "number" ? Math.max(poll_ms, MIN_POLL_MS) : DEFAULT_POLL_MS,
  };
}

function toItem(email: ResendEmail): ServiceItem {
  return {
    id: email.id,
    title: email.subject,
    state: email.state,
    ...(email.toCount > 0
      ? {
          detail: `${email.toCount} recipient${email.toCount === 1 ? "" : "s"}: ${email.toDomains.join(", ")}`,
        }
      : {}),
    url: emailUrl(email.id),
    at: new Date(email.createdAt).toISOString(),
  };
}

/** A fresh capability instance (its own watcher state); Phoenix Core uses `createResendCapability()`. */
export function createResendCapability(options: ResendCapabilityOptions = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;

  let client: ReadOnlyClient | undefined;
  /** The capability's own lifetime: a command's short-lived signal must not end the shared client. */
  let lifetime: AbortSignal | undefined;
  let clientKey = "";
  let diff = new EmailDiff(0);
  let items: ServiceItem[] = [];
  let polled = false;
  let inflight: Promise<void> | null = null;
  let failure: ServiceError | undefined;
  let failures = 0;

  async function poll(ctx: CapabilityContext): Promise<void> {
    failure = undefined;
    const { baseUrl } = settings(ctx);
    const key = await ctx.secret(SECRET_NAME);
    // Without a key or a usable address nothing is sent anywhere.
    if (!key || !baseUrl) {
      items = [];
      polled = true;
      return;
    }
    if (!client || clientKey !== `${baseUrl}\n${key}`) {
      client = resendClient(baseUrl, key, lifetime ?? ctx.signal);
      clientKey = `${baseUrl}\n${key}`;
    }
    try {
      const emails = await client.get(EMAILS_PATH, parseEmails);
      items = emails.map(toItem).slice(0, MAX_ITEMS);
      for (const event of diff.update(emails)) void ctx.emit(event);
    } catch (err) {
      failure =
        err instanceof ServiceError
          ? err
          : new ServiceError("Resend", "invalid", "Unexpected error while reading Resend");
    }
    polled = true;
  }

  function pollOnce(ctx: CapabilityContext): Promise<void> {
    return (inflight ??= poll(ctx).finally(() => (inflight = null)));
  }

  return defineCapability({
    manifest: {
      id: "resend",
      name: "Resend",
      version: "0.1.0",
      description:
        "Delivery status of the emails your Resend account has sent: delivered, bounced and failed. Strictly read-only: it reads the list of sent emails (GET only) and has no way to send an email or change anything at Resend. Needs a Resend API key.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: ["resend.email.delivered", "resend.email.bounced", "resend.email.failed"],
      permissions: ["network", "external_api"],
      data_categories: [
        "email subjects",
        "recipient domains (not addresses)",
        "email delivery status",
      ],
      healthcheck: { interval_ms: 15_000 },
      secrets: [
        {
          name: SECRET_NAME,
          description:
            "Resend API key. Listing sent emails needs a key with full access, which Resend also allows to send mail: Phoenix only ever lists emails with it and never sends. Use a key you can revoke.",
        },
      ],
      commands: [
        {
          name: "status",
          description: "Recently sent emails and their delivery status",
          side_effect: "read",
          permissions: ["network", "external_api"],
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          base_url: {
            type: "string",
            pattern: BASE_URL_PATTERN,
            description: `API address (default ${DEFAULT_BASE_URL}). Plain http is only accepted for localhost.`,
          },
          poll_ms: {
            type: "integer",
            minimum: MIN_POLL_MS,
            maximum: 3_600_000,
            description: `Milliseconds between checks (default ${DEFAULT_POLL_MS}). Checks pause while nothing is watching Phoenix.`,
          },
        },
      },
      state_rules: [
        {
          match: "resend.email.delivered",
          effect: { state: "SUCCESS", explain: "Email delivered: {subject}", ttlMs: 4_000 },
        },
        {
          match: "resend.email.bounced",
          effect: { state: "WARNING", explain: "Email bounced: {subject}", ttlMs: 60_000 },
        },
        {
          match: "resend.email.failed",
          effect: { state: "ERROR", explain: "Email failed: {subject}" },
        },
      ],
    },
    init(ctx) {
      lifetime = ctx.signal;
      client = undefined;
      clientKey = "";
      items = [];
      polled = false;
      failure = undefined;
      failures = 0;
      // History rule: emails created before this moment are background, not news.
      diff = new EmailDiff(now());
      startPolling(
        ctx,
        async () => {
          await pollOnce(ctx);
          failures = failure ? failures + 1 : 0;
          return nextDelay(settings(ctx).pollMs, failures, failure);
        },
        sleep,
      );
    },
    commands: {
      async status(_input, ctx): Promise<ServiceStatus> {
        if (!(await ctx.secret(SECRET_NAME))) {
          return { configured: false, items: [], note: NO_KEY_NOTE };
        }
        if (!polled) await pollOnce(ctx);
        if (failure) throw failure;
        return { configured: true, items };
      },
    },
    async health(ctx): Promise<HealthResult> {
      if (settings(ctx).baseUrl === undefined) {
        return { status: "degraded", message: "base_url is not allowed (use https)" };
      }
      if (!(await ctx.secret(SECRET_NAME))) return { status: "degraded", message: NO_KEY_NOTE };
      if (!polled) return { status: "healthy", message: "Reading Resend…" };
      if (failure?.kind === "auth" || failure?.kind === "rate_limit") {
        return { status: "degraded", message: failure.message };
      }
      if (failure) return { status: "unhealthy", message: failure.message };
      return { status: "healthy", message: `Watching ${items.length} recent emails` };
    },
  });
}
