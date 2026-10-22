// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Core's owner of the Phase 94 per-site opt-in. It keeps which music sites the user allowed and
// builds a site's own search address on request. It never fetches, opens a page or plays anything:
// there is no browser surface yet, so playback control is not available through Core.
import {
  ConnectorPolicy,
  searchUrl,
  type Site,
  type SitePolicy,
} from "@phoenix/capability-youtube-music";
import type { AuditLog } from "@phoenix/permissions";
import type { SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

export const MUSIC_CONNECTORS_KEY = "music-connectors.enabled";

const KNOWN: Readonly<Record<Site, true>> = {
  youtube: true,
  soundcloud: true,
  bandcamp: true,
  "spotify-web": true,
};

function isSite(value: unknown): value is Site {
  return typeof value === "string" && Object.hasOwn(KNOWN, value);
}

export interface MusicConnectorsDependencies {
  settings: SettingsStore;
  audit: Pick<AuditLog, "record">;
}

export class MusicConnectorsService {
  constructor(private readonly d: MusicConnectorsDependencies) {}

  private policy(): ConnectorPolicy {
    const stored = this.d.settings.get<unknown>(MUSIC_CONNECTORS_KEY, []);
    return new ConnectorPolicy(Array.isArray(stored) ? stored.filter(isSite) : []);
  }

  /** Every site with its host list, whether the user allowed it and its ad-blocking stance. */
  sites(): SitePolicy[] {
    const policy = this.policy();
    return (Object.keys(KNOWN) as Site[]).map((site) => policy.describe(site));
  }

  enabledCount(): number {
    return this.sites().filter((site) => site.enabled).length;
  }

  setEnabled(site: string, input: unknown): SitePolicy[] {
    if (!isSite(site)) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Unknown music site");
    const enabled =
      input !== null && typeof input === "object" && "enabled" in input ? input.enabled : undefined;
    if (typeof enabled !== "boolean" || Object.keys(input as object).length !== 1)
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, 'Expected only a boolean "enabled"');
    const policy = this.policy();
    policy.setEnabled(site, enabled);
    this.d.settings.set(
      MUSIC_CONNECTORS_KEY,
      this.sites()
        .filter((s) => (s.site === site ? enabled : s.enabled))
        .map((s) => s.site),
    );
    this.d.audit.record({
      actor: "user",
      action: "music_connectors.changed",
      decision: "info",
      details: { site, enabled },
    });
    return this.sites();
  }

  /** The site's own search page. Only for a site the user allowed; the caller opens it visibly. */
  search(site: string, input: unknown): { url: string } {
    if (!isSite(site)) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Unknown music site");
    if (!this.policy().describe(site).enabled)
      throw new PhoenixError(ErrorCode.PERMISSION_DENIED, "That music site is not allowed");
    const query =
      input !== null && typeof input === "object" && "query" in input ? input.query : undefined;
    if (typeof query !== "string")
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"query" must be text');
    try {
      return { url: searchUrl(site, query) };
    } catch (error) {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        error instanceof Error ? error.message : "Invalid search",
      );
    }
  }
}
