// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Microsoft Teams (Phase 86) is NOTIFY-ONLY, and this module says so in code: there is no inbound
// path and no Allow button. Teams authenticates button callbacks with a bearer JWT that must be
// validated against Microsoft's published signing keys (a network fetch of the OpenID metadata), which
// this offline build cannot do honestly; an unverified Teams callback would be a forged approval, so
// none is accepted. A Teams card carries a short sanitized title and an "Open in Phoenix" link. The
// link is signed by Core (HMAC-SHA256 under a Core-held key, constant-time compare) and bound to the
// exact request (source, id, request_hash, expiry), so Phoenix can show THAT request and nothing else.
// Opening it decides nothing: the person then confirms inside Phoenix, through the same audited
// desktop path, with their own actor. The webhook URL is a credential (anyone holding it can post to
// the channel), so it is read with ctx.secret and checked against Microsoft's webhook hosts.
import { createHmac, timingSafeEqual } from "node:crypto";
import { cardText, expiryLine, withoutMarkup } from "./cards";
import {
  ParseError,
  SignatureError,
  TransportError,
  type ApprovalSnapshot,
  type CardView,
  type HttpTransport,
} from "./types";

export const DEEP_LINK_BASE = "phoenix://approvals/open";
const LINK_VERSION = "phoenix-teams-link-v1";
const HASH = /^[0-9a-f]{64}$/;
const MAC = /^[0-9a-f]{64}$/;
const WEBHOOK_HOST_SUFFIXES = [".webhook.office.com", ".logic.azure.com", ".powerplatform.com"];

/** Accepts only an https URL on a Microsoft webhook host, without credentials or a custom port. */
export function teamsWebhookUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const ok =
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      WEBHOOK_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix));
    return ok ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export interface LinkBinding {
  source: "confirmation" | "agent";
  id: string;
  requestHash: string;
  /** Epoch ms after which the link is dead; never later than the request's own expiry. */
  expiresAt: number;
}

const macOf = (key: string, b: LinkBinding): Buffer =>
  createHmac("sha256", key)
    .update([LINK_VERSION, b.source, b.id, b.requestHash, String(b.expiresAt)].join("\n"))
    .digest();

/** A link for one request as it is now. */
export function signDeepLink(
  key: string,
  snapshot: ApprovalSnapshot,
  nowMs: number,
  ttlMs: number,
): string | undefined {
  const requestExpires = Date.parse(snapshot.expires_at);
  if (key === "" || !Number.isFinite(requestExpires)) return undefined;
  const binding: LinkBinding = {
    source: snapshot.source,
    id: snapshot.id,
    requestHash: snapshot.request_hash,
    expiresAt: Math.min(requestExpires, nowMs + ttlMs),
  };
  if (binding.expiresAt <= nowMs) return undefined;
  const query = new URLSearchParams({
    s: binding.source,
    i: binding.id,
    h: binding.requestHash,
    e: String(binding.expiresAt),
    m: macOf(key, binding).toString("hex"),
  });
  return `${DEEP_LINK_BASE}?${query.toString()}`;
}

/**
 * Checks a link Phoenix was opened with. Throws if it is malformed, not signed by this Core's key,
 * or past its expiry. The caller must still compare `requestHash` with the request as it is now
 * (see {@link linkMatches}) before showing it as "the request you were notified about".
 */
export function verifyDeepLink(link: string, key: string, nowMs: number): LinkBinding {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new ParseError("Not a link");
  }
  if (`${url.protocol}//${url.host}${url.pathname}` !== DEEP_LINK_BASE)
    throw new ParseError("Not an approval link");
  const source = url.searchParams.get("s");
  const id = url.searchParams.get("i") ?? "";
  const hash = url.searchParams.get("h") ?? "";
  const expiresText = url.searchParams.get("e") ?? "";
  const mac = url.searchParams.get("m") ?? "";
  if (
    (source !== "confirmation" && source !== "agent") ||
    id.length < 1 ||
    id.length > 120 ||
    !HASH.test(hash) ||
    !/^\d{1,16}$/.test(expiresText) ||
    !MAC.test(mac)
  )
    throw new SignatureError("malformed");
  const binding: LinkBinding = {
    source,
    id,
    requestHash: hash,
    expiresAt: Number(expiresText),
  };
  if (key === "") throw new SignatureError("missing");
  if (!timingSafeEqual(macOf(key, binding), Buffer.from(mac, "hex")))
    throw new SignatureError("mismatch");
  if (binding.expiresAt <= nowMs) throw new SignatureError("stale");
  return binding;
}

/** True only when the link was issued for exactly this request in its current state. */
export function linkMatches(binding: LinkBinding, current: ApprovalSnapshot): boolean {
  const a = Buffer.from(binding.requestHash, "utf8");
  const b = Buffer.from(current.request_hash, "utf8");
  return (
    binding.source === current.source &&
    binding.id === current.id &&
    a.length === b.length &&
    timingSafeEqual(a, b)
  );
}

/** Teams cards use Adaptive Card text blocks; markup characters are stripped from untrusted text. */
function adaptiveCard(body: unknown[], actions: unknown[]): Record<string, unknown> {
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body,
          actions,
        },
      },
    ],
  };
}

const block = (value: string, extra: Record<string, unknown> = {}) => ({
  type: "TextBlock",
  text: value,
  wrap: true,
  ...extra,
});

/** Notify-only card: sanitized title, expiry, and an Open in Phoenix link. No Allow, no Deny. */
export function teamsCard(view: CardView, link: string): Record<string, unknown> {
  return adaptiveCard(
    [
      block("Phoenix approval waiting", { weight: "Bolder" }),
      block(withoutMarkup(cardText(view))),
      block(expiryLine(view), { isSubtle: true }),
    ],
    [{ type: "Action.OpenUrl", title: "Open in Phoenix", url: link }],
  );
}

export function teamsNotice(message: string): Record<string, unknown> {
  return adaptiveCard([block(withoutMarkup(message))], []);
}

export async function teamsPost(
  transport: HttpTransport,
  webhook: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const url = teamsWebhookUrl(webhook);
  if (url === undefined)
    throw new TransportError("The Teams webhook is not a Microsoft webhook URL");
  const response = await transport({
    url,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (response.status < 200 || response.status >= 300)
    throw new TransportError("Teams did not accept the message");
}
