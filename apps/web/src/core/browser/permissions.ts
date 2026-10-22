// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { classifyHost } from "./network";

/** Mirrors `tauri::webview::PermissionKind` (display names), so the Rust host can map 1:1. */
export const PERMISSION_KINDS = [
  "microphone",
  "camera",
  "geolocation",
  "notifications",
  "clipboard-read",
  "display-capture",
  "midi",
  "sensors",
  "media-key-system-access",
  "local-fonts",
  "window-management",
  "pointer-lock",
  "automatic-downloads",
  "file-system-access",
  "autoplay",
  "other",
] as const;

export type SitePermission = (typeof PERMISSION_KINDS)[number];

export type PermissionVerdict = "allow" | "deny";

export type PermissionReason =
  | "default_deny"
  | "unknown_kind"
  | "insecure_origin"
  | "private_origin"
  | "cross_origin_frame"
  | "no_user_gesture"
  | "never_grantable"
  | "granted";

export interface PermissionDecision {
  verdict: PermissionVerdict;
  reason: PermissionReason;
}

/**
 * Kinds that no site can be granted in the mini browser. Screen capture and file-system access
 * hand a page the user's machine; automatic downloads would bypass "downloads ask first"; the
 * rest have no prompt UI here yet, and a permission with no prompt can only be silently on or off.
 */
const NEVER_GRANTABLE: Readonly<Partial<Record<SitePermission, true>>> = {
  "display-capture": true,
  "file-system-access": true,
  "automatic-downloads": true,
  "clipboard-read": true,
  "local-fonts": true,
  "window-management": true,
  "media-key-system-access": true,
  other: true,
};

export function isSitePermission(value: string): value is SitePermission {
  return (PERMISSION_KINDS as readonly string[]).includes(value);
}

export interface PermissionRequest {
  kind: string;
  /** Origin of the top-level document (`https://example.com`). */
  topOrigin: string;
  /** Origin of the frame that asked; a different origin than the top never inherits a grant. */
  frameOrigin: string;
}

/** A session-scoped grant. Nothing here is written to disk; closing the browser forgets it all. */
export interface PermissionGrant {
  origin: string;
  kind: SitePermission;
}

/**
 * Default-deny site permissions. A request is allowed only when the user has granted that exact
 * origin that exact kind during this session, the page is on a secure public origin, and the
 * asking frame is the top-level origin itself.
 */
export class SitePermissions {
  #grants = new Map<string, Set<SitePermission>>();

  decide(request: PermissionRequest): PermissionDecision {
    if (!isSitePermission(request.kind)) return { verdict: "deny", reason: "unknown_kind" };
    const kind = request.kind;
    let top: URL;
    try {
      top = new URL(request.topOrigin);
    } catch {
      return { verdict: "deny", reason: "insecure_origin" };
    }
    if (top.protocol !== "https:") return { verdict: "deny", reason: "insecure_origin" };
    if (classifyHost(top.hostname).kind === "private") {
      return { verdict: "deny", reason: "private_origin" };
    }
    if (request.frameOrigin !== request.topOrigin) {
      return { verdict: "deny", reason: "cross_origin_frame" };
    }
    if (Object.hasOwn(NEVER_GRANTABLE, kind)) return { verdict: "deny", reason: "never_grantable" };
    if (this.#grants.get(top.origin)?.has(kind)) return { verdict: "allow", reason: "granted" };
    return { verdict: "deny", reason: "default_deny" };
  }

  /**
   * Record a user's choice. Only call this from a handler of a real click on Phoenix's own prompt
   * UI (`userGesture` is that click's `isTrusted`), never from page content or from Fawkes: a page,
   * or text a page convinced a model to repeat, must not be able to grant itself access.
   */
  grant(origin: string, kind: string, userGesture: boolean): PermissionDecision {
    if (!userGesture) return { verdict: "deny", reason: "no_user_gesture" };
    if (!isSitePermission(kind)) return { verdict: "deny", reason: "unknown_kind" };
    if (Object.hasOwn(NEVER_GRANTABLE, kind)) return { verdict: "deny", reason: "never_grantable" };
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return { verdict: "deny", reason: "insecure_origin" };
    }
    if (parsed.protocol !== "https:") return { verdict: "deny", reason: "insecure_origin" };
    if (classifyHost(parsed.hostname).kind === "private") {
      return { verdict: "deny", reason: "private_origin" };
    }
    const kinds = this.#grants.get(parsed.origin) ?? new Set<SitePermission>();
    kinds.add(kind);
    this.#grants.set(parsed.origin, kinds);
    return { verdict: "allow", reason: "granted" };
  }

  revoke(origin: string, kind?: SitePermission): void {
    if (kind === undefined) this.#grants.delete(origin);
    else this.#grants.get(origin)?.delete(kind);
  }

  list(): PermissionGrant[] {
    return [...this.#grants].flatMap(([origin, kinds]) =>
      [...kinds].map((kind) => ({ origin, kind })),
    );
  }

  /** Forget every grant (closing the window or the private session). */
  clear(): void {
    this.#grants.clear();
  }
}
