// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Slack (Phase 86). Inbound: every interactivity request is authenticated with Slack's own scheme
// (HMAC-SHA256 "v0" signature over `v0:<timestamp>:<raw body>` with the app's signing secret, a
// 5-minute timestamp window, constant-time compare) BEFORE anything in the body is read. Outbound:
// chat.postMessage with the bot token, through the injected transport. Secrets arrive as arguments
// (the caller reads them with ctx.secret); nothing here stores or logs them. Text goes out as
// plain_text blocks, so Slack never turns it into mentions, links or formatting.
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  cardFooter,
  cardText,
  confirmText,
  REFUSAL_TEXT,
  decidedText,
  cancelledText,
} from "./cards";
import { headerValue } from "./headers";
import {
  MAX_BODY_BYTES,
  ParseError,
  SIGNATURE_WINDOW_MS,
  SignatureError,
  TransportError,
  type CardView,
  type HttpTransport,
  type Interaction,
  type PressOutcome,
  type RawRequest,
} from "./types";

export const SLACK_POST_URL = "https://slack.com/api/chat.postMessage";
const SLACK_RESPONSE_HOST = "hooks.slack.com";
const SIGNATURE = /^v0=([0-9a-f]{64})$/;
const TIMESTAMP = /^\d{1,12}$/;
const SIGNATURE_VERSION = "v0";

/**
 * Throws SignatureError unless the request carries a valid, fresh Slack signature. Returns the
 * signature (hex) so the caller can refuse a replay of the very same signed request.
 */
export function verifySlackRequest(
  request: RawRequest,
  signingSecret: string,
  nowMs: number,
): string {
  if (request.body.length > MAX_BODY_BYTES) throw new SignatureError("too_large");
  const signature = headerValue(request, "x-slack-signature");
  const timestamp = headerValue(request, "x-slack-request-timestamp");
  if (signature === undefined || timestamp === undefined || signingSecret === "")
    throw new SignatureError("missing");
  const match = SIGNATURE.exec(signature);
  if (!match || !TIMESTAMP.test(timestamp)) throw new SignatureError("malformed");
  if (Math.abs(nowMs - Number(timestamp) * 1000) > SIGNATURE_WINDOW_MS)
    throw new SignatureError("stale");
  const expected = createHmac("sha256", signingSecret)
    .update(`${SIGNATURE_VERSION}:${timestamp}:`)
    .update(request.body)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(match[1]!, "hex")))
    throw new SignatureError("mismatch");
  return match[1]!;
}

export interface SlackPress {
  interaction: Interaction;
  /** Where to post the follow-up message; already checked to be a Slack response URL. */
  responseUrl: string | undefined;
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function slackResponseUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const ok =
      url.protocol === "https:" &&
      url.hostname === SLACK_RESPONSE_HOST &&
      url.username === "" &&
      url.password === "" &&
      url.port === "";
    return ok ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Parses an (already authenticated) interactivity request: one `payload=<json>` form field. */
export function parseSlackPress(body: Buffer): SlackPress {
  const form = new URLSearchParams(body.toString("utf8"));
  const raw = form.get("payload");
  if (raw === null) throw new ParseError("No payload");
  let payload: Record<string, unknown>;
  try {
    payload = object(JSON.parse(raw));
  } catch {
    throw new ParseError("Payload is not JSON");
  }
  if (payload.type !== "block_actions") throw new ParseError("Not a button press");
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  if (actions.length !== 1) throw new ParseError("Expected exactly one action");
  const action = object(actions[0]);
  const user = object(payload.user);
  const team = object(payload.team);
  const interaction: Interaction = {
    provider: "slack",
    workspace: text(team.id) || text(user.team_id),
    userId: text(user.id),
    channel: text(object(payload.channel).id),
    token: text(action.value),
  };
  if (interaction.userId === "" || interaction.token === "")
    throw new ParseError("Incomplete press");
  return { interaction, responseUrl: slackResponseUrl(payload.response_url) };
}

const plain = (value: string) => ({ type: "plain_text", text: value, emoji: false });

const button = (label: string, actionId: string, token: string, style?: "primary" | "danger") => ({
  type: "button",
  text: plain(label),
  action_id: actionId,
  value: token,
  ...(style ? { style } : {}),
});

function card(body: string, footer: string | undefined, buttons: unknown[]): unknown[] {
  return [
    { type: "section", text: plain(body) },
    ...(footer ? [{ type: "context", elements: [plain(footer)] }] : []),
    ...(buttons.length > 0 ? [{ type: "actions", elements: buttons }] : []),
  ];
}

/** The approval card: short sanitized title, Allow and Deny. Allow only leads to the confirm step. */
export function slackCardBlocks(view: CardView, allowToken: string, denyToken: string): unknown[] {
  return card(cardText(view), cardFooter(view), [
    button("Allow", "phx_allow", allowToken, "primary"),
    button("Deny", "phx_deny", denyToken, "danger"),
  ]);
}

/** The reply to a press: the message is replaced by the next step, or an ephemeral refusal. */
export function slackReply(outcome: PressOutcome, user: string): Record<string, unknown> {
  switch (outcome.kind) {
    case "confirm":
      return {
        replace_original: true,
        text: confirmText(outcome.view),
        blocks: card(confirmText(outcome.view), undefined, [
          button("Yes, allow", "phx_confirm", outcome.confirmToken, "primary"),
          button("Cancel", "phx_cancel", outcome.cancelToken),
        ]),
      };
    case "decided":
      return {
        replace_original: true,
        text: decidedText(outcome.decision, outcome.view, user),
        blocks: card(decidedText(outcome.decision, outcome.view, user), undefined, []),
      };
    case "cancelled":
      return {
        replace_original: true,
        text: cancelledText(outcome.view),
        blocks: card(cancelledText(outcome.view), undefined, []),
      };
    case "refused":
      return {
        response_type: "ephemeral",
        replace_original: false,
        text: REFUSAL_TEXT[outcome.reason],
      };
  }
}

export async function slackPost(
  transport: HttpTransport,
  botToken: string,
  channel: string,
  fallback: string,
  blocks: unknown[],
  signal?: AbortSignal,
): Promise<void> {
  const response = await transport({
    url: SLACK_POST_URL,
    method: "POST",
    headers: {
      authorization: `Bearer ${botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      // Slack parses &, < and > in the plain-text fallback even when blocks exist.
      text: fallback.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      blocks,
      mrkdwn: false,
      link_names: false,
      unfurl_links: false,
    }),
    ...(signal ? { signal } : {}),
  });
  let ok = false;
  try {
    ok = response.status === 200 && object(JSON.parse(response.body)).ok === true;
  } catch {
    ok = false;
  }
  if (!ok) throw new TransportError("Slack did not accept the message");
}

export async function slackRespond(
  transport: HttpTransport,
  responseUrl: string,
  reply: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const response = await transport({
    url: responseUrl,
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(reply),
    ...(signal ? { signal } : {}),
  });
  if (response.status !== 200) throw new TransportError("Slack did not accept the update");
}
