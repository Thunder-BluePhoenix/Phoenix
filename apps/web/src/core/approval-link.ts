// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * What the desktop shell hands the web app for a `phoenix://approvals/…` link: the route
 * `#/approvals?id=<id>` or, for a Teams card, `#/approvals?s=…&i=…&h=…&e=…&m=…`. The shell has
 * already checked the shape; the page checks it again because the hash is just text anyone can type.
 * A link only NAMES an approval. Whether it exists and is pending is Core's answer, never the link's.
 */
export type ApprovalLink = { kind: "id"; id: string } | { kind: "teams"; query: string };

export const TEAMS_VERIFY_PATH = "/api/chat-approvals/teams/verify-link";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const EXPIRY = /^\d{1,16}$/;
const TEAMS_KEYS = ["s", "i", "h", "e", "m"];

export const isApprovalId = (value: unknown): value is string =>
  typeof value === "string" && ID.test(value);

/** The link in a hash route such as "/approvals?id=apr_1", or null when it is not exactly one of the two forms. */
export function parseApprovalLink(route: string): ApprovalLink | null {
  const at = route.indexOf("?");
  if (at < 0 || route.slice(0, at) !== "/approvals") return null;
  const params = new URLSearchParams(route.slice(at + 1));
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return null;
  if (keys.length === 1 && keys[0] === "id") {
    const id = params.get("id");
    return isApprovalId(id) ? { kind: "id", id } : null;
  }
  if (keys.length !== TEAMS_KEYS.length || !TEAMS_KEYS.every((k) => params.has(k))) return null;
  const [s, i, h, e, m] = TEAMS_KEYS.map((k) => params.get(k) ?? "");
  if (
    (s !== "agent" && s !== "confirmation") ||
    !ID.test(i!) ||
    !HEX64.test(h!) ||
    !EXPIRY.test(e!) ||
    !HEX64.test(m!)
  )
    return null;
  return { kind: "teams", query: `s=${s}&i=${i}&h=${h}&e=${e}&m=${m}` };
}
