// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Discord (Phase 86). Inbound: every interaction is authenticated with Discord's own scheme, an
// Ed25519 signature over `<X-Signature-Timestamp><raw body>` verified with the application's public
// key, BEFORE the body is parsed. Discord publishes no clock window, so Core applies the same
// 5-minute one as for Slack. Outbound: a bot-token POST to the channel messages endpoint through the
// injected transport. Mentions are switched off (`allowed_mentions.parse = []`) and markup characters
// are stripped from untrusted text.
import { createPublicKey, verify } from "node:crypto";
import {
  cancelledText,
  cardFooter,
  cardText,
  confirmText,
  decidedText,
  REFUSAL_TEXT,
  withoutMarkup,
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

export const DISCORD_API = "https://discord.com/api/v10";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const SIGNATURE_HEX = /^[0-9a-f]{128}$/;
const PUBLIC_KEY_HEX = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{1,12}$/;

const PING = 1;
const MESSAGE_COMPONENT = 3;
const PONG_RESPONSE = 1;
const CHANNEL_MESSAGE_RESPONSE = 4;
const UPDATE_MESSAGE_RESPONSE = 7;
const EPHEMERAL_FLAG = 64;
const ACTION_ROW = 1;
const BUTTON = 2;
const STYLE_SECONDARY = 2;
const STYLE_SUCCESS = 3;
const STYLE_DANGER = 4;

/**
 * Throws SignatureError unless the request carries a valid, fresh Discord signature. Returns the
 * signature (hex) so the caller can refuse a replay of the very same signed request.
 */
export function verifyDiscordRequest(
  request: RawRequest,
  publicKeyHex: string,
  nowMs: number,
): string {
  if (request.body.length > MAX_BODY_BYTES) throw new SignatureError("too_large");
  const signature = headerValue(request, "x-signature-ed25519");
  const timestamp = headerValue(request, "x-signature-timestamp");
  if (signature === undefined || timestamp === undefined || publicKeyHex === "")
    throw new SignatureError("missing");
  const key = publicKeyHex.toLowerCase();
  if (!SIGNATURE_HEX.test(signature) || !TIMESTAMP.test(timestamp) || !PUBLIC_KEY_HEX.test(key))
    throw new SignatureError("malformed");
  if (Math.abs(nowMs - Number(timestamp) * 1000) > SIGNATURE_WINDOW_MS)
    throw new SignatureError("stale");
  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(key, "hex")]),
    format: "der",
    type: "spki",
  });
  const message = Buffer.concat([Buffer.from(timestamp, "utf8"), request.body]);
  // Ed25519 verification is a constant-time group operation; there is no byte compare to time.
  if (!verify(null, message, publicKey, Buffer.from(signature, "hex")))
    throw new SignatureError("mismatch");
  return signature;
}

export type DiscordInbound = { kind: "ping" } | { kind: "press"; interaction: Interaction };

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Parses an (already authenticated) interaction. Direct messages carry no guild and no member. */
export function parseDiscordInteraction(body: Buffer): DiscordInbound {
  let payload: Record<string, unknown>;
  try {
    payload = object(JSON.parse(body.toString("utf8")));
  } catch {
    throw new ParseError("Body is not JSON");
  }
  if (payload.type === PING) return { kind: "ping" };
  if (payload.type !== MESSAGE_COMPONENT) throw new ParseError("Not a button press");
  const userId = text(object(object(payload.member).user).id) || text(object(payload.user).id);
  const interaction: Interaction = {
    provider: "discord",
    workspace: text(payload.guild_id),
    userId,
    channel: text(payload.channel_id),
    token: text(object(payload.data).custom_id),
  };
  if (interaction.userId === "" || interaction.token === "")
    throw new ParseError("Incomplete press");
  return { kind: "press", interaction };
}

const NO_MENTIONS = { parse: [] as string[] };

const button = (label: string, token: string, style: number) => ({
  type: BUTTON,
  style,
  label,
  custom_id: token,
});

const row = (...buttons: unknown[]) => [{ type: ACTION_ROW, components: buttons }];

export function discordCardBody(view: CardView, allowToken: string, denyToken: string) {
  return {
    content: `${withoutMarkup(cardText(view))}\n${cardFooter(view)}`,
    allowed_mentions: NO_MENTIONS,
    components: row(
      button("Allow", allowToken, STYLE_SUCCESS),
      button("Deny", denyToken, STYLE_DANGER),
    ),
  };
}

/** The interaction response: the message is replaced by the next step, or an ephemeral refusal. */
export function discordReply(outcome: PressOutcome, user: string): Record<string, unknown> {
  switch (outcome.kind) {
    case "confirm":
      return {
        type: UPDATE_MESSAGE_RESPONSE,
        data: {
          content: withoutMarkup(confirmText(outcome.view)),
          allowed_mentions: NO_MENTIONS,
          components: row(
            button("Yes, allow", outcome.confirmToken, STYLE_SUCCESS),
            button("Cancel", outcome.cancelToken, STYLE_SECONDARY),
          ),
        },
      };
    case "decided":
      return {
        type: UPDATE_MESSAGE_RESPONSE,
        data: {
          content: withoutMarkup(decidedText(outcome.decision, outcome.view, user)),
          allowed_mentions: NO_MENTIONS,
          components: [],
        },
      };
    case "cancelled":
      return {
        type: UPDATE_MESSAGE_RESPONSE,
        data: {
          content: withoutMarkup(cancelledText(outcome.view)),
          allowed_mentions: NO_MENTIONS,
          components: [],
        },
      };
    case "refused":
      return {
        type: CHANNEL_MESSAGE_RESPONSE,
        data: {
          content: REFUSAL_TEXT[outcome.reason],
          flags: EPHEMERAL_FLAG,
          allowed_mentions: NO_MENTIONS,
        },
      };
  }
}

export const discordPong = (): Record<string, unknown> => ({ type: PONG_RESPONSE });

export async function discordPost(
  transport: HttpTransport,
  botToken: string,
  channel: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const response = await transport({
    url: `${DISCORD_API}/channels/${encodeURIComponent(channel)}/messages`,
    method: "POST",
    headers: {
      authorization: `Bot ${botToken}`,
      "content-type": "application/json",
      "user-agent": "Phoenix (https://github.com/Thunder-BluePhoenix/Phoenix, 0.1)",
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (response.status < 200 || response.status >= 300)
    throw new TransportError("Discord did not accept the message");
}
