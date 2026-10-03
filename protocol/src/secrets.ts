// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Object keys that must never appear in event payloads, metadata or logs. */
export const SECRET_KEY_PATTERN =
  /^(password|passwd|secret|client_secret|token|access_token|refresh_token|id_token|api_key|apikey|api_token|authorization|auth|cookie|set_cookie|private_key|credential|credentials|session_key)$/i;

/** Values that look like credentials regardless of key name. */
export const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

function normaliseKey(key: string): string {
  return key.replace(/[-\s]/g, "_").replace(/([a-z])([A-Z])/g, "$1_$2");
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(normaliseKey(key));
}

export function looksLikeSecretValue(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((re) => re.test(value));
}

/** Returns JSON paths of secret-looking keys or values inside `value`. */
export function findSecrets(value: unknown, path = "$"): string[] {
  const found: string[] = [];
  if (typeof value === "string") {
    if (looksLikeSecretValue(value)) found.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => found.push(...findSecrets(v, `${path}[${i}]`)));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const p = `${path}.${k}`;
      if (isSecretKey(k)) found.push(p);
      else found.push(...findSecrets(v, p));
    }
  }
  return found;
}
