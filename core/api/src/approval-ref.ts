// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash, timingSafeEqual } from "node:crypto";

/** A full SHA-256 digest makes accidental or chosen collisions impractical for a decision binding. */
export const APPROVAL_REF_LENGTH = 64;

const DOMAIN = "phoenix-approval-ref-v1\n";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

/**
 * Binds a CLI decision to exactly the redacted, user-visible record Core returned. The value is not
 * an authenticator: the session token still authorizes the request. It prevents a CLI list/decide
 * race from silently deciding a different record with the same id.
 */
export function approvalRef(source: "confirmation" | "agent", view: object): string {
  return createHash("sha256")
    .update(DOMAIN)
    .update(canonicalJson({ source, ...view }))
    .digest("hex");
}

export function validApprovalRef(value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${APPROVAL_REF_LENGTH}}$`).test(value);
}

/** Compares valid fixed-length hex digests without leaking a matching prefix through timing. */
export function sameApprovalRef(expected: string, supplied: unknown): boolean {
  return (
    validApprovalRef(supplied) &&
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"))
  );
}
