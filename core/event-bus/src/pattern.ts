// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * Subscription patterns:
 *   "*"            every event
 *   "kage.*"       any type starting with "kage."
 *   "build.failed" exactly that type
 */
export function matchesPattern(pattern: string, eventType: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return eventType.startsWith(pattern.slice(0, -1));
  return pattern === eventType;
}

export function isValidPattern(pattern: string): boolean {
  return pattern === "*" || /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*(\.\*)?$/.test(pattern);
}
