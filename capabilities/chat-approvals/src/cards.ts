// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What a chat message may say about an approval. A card carries a SHORT SANITIZED TITLE, the tool
// name, the project and the expiry, and nothing else: never the preview, never the command's
// arguments, never a hash. Everything shown is untrusted text and is cleaned here once, so the
// provider modules only decide how to lay it out.
import type { ApprovalSnapshot, CardView, RefusalReason } from "./types";

/**
 * Control, format (bidi, zero-width, soft hyphen, tags), line and paragraph separators. This is the
 * same pattern as `HIDDEN_TEXT_CHARS` in core/runtime/src/agent-approvals.ts (the package must not
 * depend on core/runtime); test/cards.test.ts pins the two together.
 */
export const HIDDEN_TEXT_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const HIDDEN_TEXT_GLOBAL = new RegExp(HIDDEN_TEXT_CHARS.source, "gu");
/** Long unbroken runs look like keys and tokens; a title never needs them. */
const LONG_OPAQUE_RUN = /[A-Za-z0-9+/_=-]{24,}/g;
const BEARER = /\bBearer\s+\S+/gi;

export const TITLE_CHARS = 80;
export const TOOL_CHARS = 60;
export const PROJECT_CHARS = 60;
const FALLBACK_TITLE = "Approval request";

/**
 * Plain, single-line, clipped text. Hidden characters become spaces (so they cannot glue two words
 * into a look-alike), whitespace collapses, key-shaped runs are replaced, and the result is clipped
 * by code point. Best effort for the secret rule: the title is not where secrets are expected, this
 * only makes sure a long opaque string never rides along.
 */
export function sanitizeText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const flat = value
    .replace(HIDDEN_TEXT_GLOBAL, " ")
    .replace(BEARER, "…")
    .replace(LONG_OPAQUE_RUN, "…")
    .replace(/\s+/g, " ")
    .trim();
  const points = Array.from(flat);
  return points.length > max ? `${points.slice(0, max - 1).join("")}…` : flat;
}

/** Markdown, markup and mention characters that Discord's and Teams' text renderers would interpret. */
const MARKUP_CHARS = /[[\]()*_`~<>|\\#@]/g;

/** For renderers (Discord, Teams) that interpret markup in plain text: replace the characters, never escape them. */
export const withoutMarkup = (text: string): string =>
  text.replace(MARKUP_CHARS, " ").replace(/\s+/g, " ").trim();

export function cardView(snapshot: ApprovalSnapshot): CardView {
  const expires = Date.parse(snapshot.expires_at);
  const project = sanitizeText(snapshot.project, PROJECT_CHARS);
  return {
    title: sanitizeText(snapshot.title, TITLE_CHARS) || FALLBACK_TITLE,
    tool: sanitizeText(snapshot.tool, TOOL_CHARS) || "unknown",
    project: project || undefined,
    expires: Number.isFinite(expires) ? new Date(expires).toISOString() : "unknown",
  };
}

/** The one-line summary every provider shows above its buttons. */
export function cardText(view: CardView): string {
  const where = view.project ? ` in ${view.project}` : "";
  return `${view.tool}${where}: ${view.title}`;
}

export const expiryLine = (view: CardView): string => `Expires ${view.expires}.`;

export const cardFooter = (view: CardView): string =>
  `${expiryLine(view)} Allow asks once more before anything happens.`;

export const confirmText = (view: CardView): string =>
  `Allow this? ${cardText(view)}\nThis is the last step: pressing Yes approves exactly this request.`;

export const REFUSAL_TEXT: Readonly<Record<RefusalReason, string>> = {
  provider_off: "Approving from this chat is turned off.",
  wrong_workspace: "This workspace is not connected to Phoenix.",
  unknown_user: "You are not on Phoenix's approver list for this chat.",
  unknown_token: "This button was already used or is not valid.",
  wrong_provider: "This button does not belong to this chat app.",
  wrong_channel: "This button was not posted in this channel.",
  wrong_user: "Only the person who pressed Allow can confirm.",
  expired: "This request or button has expired.",
  not_pending: "This request is no longer waiting.",
  project_off: "Approving this project from chat is turned off.",
  request_changed: "The request changed after this card was posted. Open Phoenix to review it.",
  host_refused: "Phoenix refused the decision. Open Phoenix to review the request.",
};

export const decidedText = (decision: "approve" | "deny", view: CardView, user: string): string =>
  `${decision === "approve" ? "Allowed" : "Denied"} by ${user}: ${cardText(view)}`;

export const cancelledText = (view: CardView): string =>
  `Not approved. Nothing happened: ${cardText(view)}`;

export interface DigestInput {
  pending: readonly ApprovalSnapshot[];
  /** Requests whose project is switched on for chat; the others are counted but never named. */
  allowed: (snapshot: ApprovalSnapshot) => boolean;
}

const MAX_DIGEST_PROJECTS = 5;

/** Counts only: no titles, no commands, no previews. Project names only for projects switched on. */
export function digestText({ pending, allowed }: DigestInput): string {
  if (pending.length === 0) return "Phoenix: nothing is waiting for approval.";
  const named = new Map<string, number>();
  let unnamed = 0;
  for (const p of pending) {
    const name = allowed(p) ? sanitizeText(p.project, PROJECT_CHARS) : "";
    if (name) named.set(name, (named.get(name) ?? 0) + 1);
    else unnamed += 1;
  }
  const parts = [...named]
    .slice(0, MAX_DIGEST_PROJECTS)
    .map(([name, count]) => `${count} in ${name}`);
  const hidden = named.size - parts.length;
  if (hidden > 0) parts.push(`${hidden} more project${hidden === 1 ? "" : "s"}`);
  if (unnamed > 0) parts.push(`${unnamed} other`);
  return `Phoenix: ${pending.length} approval${pending.length === 1 ? "" : "s"} waiting (${parts.join(", ")}). Open Phoenix to review.`;
}
