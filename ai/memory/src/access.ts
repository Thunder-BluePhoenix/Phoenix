// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { PRIVACY_CLASSES, type PrivacyClass } from "@phoenix/ai-models";
import type { MemoryItem } from "./types";

/**
 * What a viewer may read. `scope` is exact, `*` (everything) or a prefix ending in `*`
 * (`repo:*`, `path:/Users/me/proj/*`). Memory is readable only through a grant: no grant, no read.
 */
export interface ScopeGrant {
  scope: string;
  /** Highest sensitivity this grant covers. `internal` does not cover `sensitive` items. */
  maxSensitivity: PrivacyClass;
  /** Restrict the grant to these domains. Absent = every domain. */
  domains?: readonly string[];
}

export interface Viewer {
  id: string;
  grants: readonly ScopeGrant[];
}

export function scopeMatches(pattern: string, scope: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return scope.startsWith(pattern.slice(0, -1));
  return pattern === scope;
}

/** True when some grant covers the item's scope, domain and sensitivity. */
export function canView(
  viewer: Viewer,
  item: Pick<MemoryItem, "scope" | "domain" | "sensitivity">,
): boolean {
  return viewer.grants.some(
    (g) =>
      scopeMatches(g.scope, item.scope) &&
      PRIVACY_CLASSES.indexOf(item.sensitivity) <= PRIVACY_CLASSES.indexOf(g.maxSensitivity) &&
      (g.domains === undefined || g.domains.includes(item.domain)),
  );
}

/** The device owner: every scope, every sensitivity. */
export function ownerViewer(id: string): Viewer {
  return { id, grants: [{ scope: "*", maxSensitivity: "sensitive" }] };
}
