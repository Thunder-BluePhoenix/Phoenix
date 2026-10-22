// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** The browser owns all webviews, navigation, playback and network access. This module never fetches. */
export type Site = "youtube" | "soundcloud" | "bandcamp" | "spotify-web";

export interface SitePolicy {
  readonly site: Site;
  readonly hosts: readonly string[];
  readonly enabled: boolean;
  readonly adBlocking: "normal" | "exempt";
  readonly reason: string;
}

const SITES: Readonly<Record<Site, readonly string[]>> = {
  youtube: ["youtube.com", "www.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"],
  soundcloud: ["soundcloud.com", "www.soundcloud.com", "w.soundcloud.com"],
  bandcamp: ["bandcamp.com", "www.bandcamp.com"],
  "spotify-web": ["open.spotify.com"],
};

/** Site permissions are opt-in and scoped to exact hosts; subdomains are NOT implicitly trusted. */
export class ConnectorPolicy {
  private readonly enabled = new Set<Site>();

  constructor(initial: readonly Site[] = []) {
    for (const site of initial) this.setEnabled(site, true);
  }

  setEnabled(site: Site, enabled: boolean): void {
    if (!Object.hasOwn(SITES, site)) throw new Error("Unknown connector");
    if (enabled) this.enabled.add(site);
    else this.enabled.delete(site);
  }

  describe(site: Site): SitePolicy {
    if (!Object.hasOwn(SITES, site)) throw new Error("Unknown connector");
    return {
      site,
      hosts: SITES[site],
      enabled: this.enabled.has(site),
      adBlocking: site === "youtube" && this.enabled.has(site) ? "exempt" : "normal",
      reason: site === "youtube"
        ? "YouTube's own ads must not be blocked in its official embedded player. The exemption applies only while this connector is enabled."
        : "Normal browser blocking remains enabled.",
    };
  }

  /** Returns undefined for non-HTTPS, credentials, unusual ports, or unrelated origins. */
  forUrl(value: string): SitePolicy | undefined {
    let url: URL;
    try { url = new URL(value); } catch { return undefined; }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
    for (const site of Object.keys(SITES) as Site[]) {
      if (this.enabled.has(site) && SITES[site].includes(url.hostname.toLowerCase())) {
        return this.describe(site);
      }
    }
    return undefined;
  }
}

/** Supplied by the visible browser surface; no hidden/background player implementation is provided. */
export interface VisiblePlayerHost {
  /** True only while the actual video viewport is onscreen, unoccluded, and at least 200x200 CSS px. */
  viewport(): { visible: boolean; width: number; height: number };
  /** Official YouTube iframe player, with video and audio inseparable. No audio-only extraction. */
  loadOfficialEmbed(videoId: string): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  /** Open official site search visibly; host MUST NOT autoplay a result or scrape the page. */
  openSearch(url: string): Promise<void>;
/** Opens a site's own search in a visible browser surface; never scrapes, autoplays or fetches. */
export async function searchSite(
  site: Site,
  query: string,
  policy: ConnectorPolicy,
  openVisiblePage: (url: string) => Promise<void>,
): Promise<void> {
  if (!policy.describe(site).enabled) throw new Error(`${site} connector is disabled`);
  const normalized = query.trim();
  if (!normalized || normalized.length > 200) throw new Error("Search must be 1–200 characters");
  const text = encodeURIComponent(normalized);
  const urls: Record<Site, string> = {
    youtube: `https://www.youtube.com/results?search_query=${text}`,
    soundcloud: `https://soundcloud.com/search?q=${text}`,
    bandcamp: `https://bandcamp.com/search?q=${text}`,
    "spotify-web": `https://open.spotify.com/search/${text}`,
  };
  await openVisiblePage(urls[site]);
}

  /** Host MUST await callback before hiding/minimizing/detaching the playback viewport. */
  beforeHide(callback: () => Promise<void>): () => void;
}

export interface MediaSelection {
  readonly videoId: string;
  readonly title?: string;
  readonly artist?: string;
}

export interface MediaSnapshot {
  readonly site: "youtube";
  readonly state: "stopped" | "playing" | "paused";
  readonly current?: MediaSelection;
  readonly queued: readonly MediaSelection[];
}

/** Controls operate on explicit selections from the user; searching never silently selects a track. */
export class YouTubeMusicConnector {
  private current?: MediaSelection;
  private readonly upcoming: MediaSelection[] = [];
  private state: MediaSnapshot["state"] = "stopped";
  private readonly unsubscribe: () => void;

  constructor(private readonly host: VisiblePlayerHost, private readonly policy: ConnectorPolicy) {
    this.unsubscribe = host.beforeHide(async () => {
      if (this.state === "playing") {
        await host.pause();
        this.state = "paused";
      }
    });
  }

  snapshot(): MediaSnapshot {
    return { site: "youtube", state: this.state, ...(this.current ? { current: this.current } : {}), queued: [...this.upcoming] };
  }

  async search(query: string): Promise<void> {
    this.requireEnabled();
    const normalized = query.trim();
    if (!normalized || normalized.length > 200) throw new Error("Search must be 1–200 characters");
    await this.host.openSearch(`https://www.youtube.com/results?search_query=${encodeURIComponent(normalized)}`);
  }

  /** A person selects a concrete video ID from the visible official site/player. */
  async select(selection: MediaSelection): Promise<void> {
    this.requireEnabled();
    validateSelection(selection);
    this.requireVisible();
    if (this.state === "playing") await this.host.pause();
    this.state = "stopped";
    this.current = undefined;
    await this.host.loadOfficialEmbed(selection.videoId);
    this.current = { ...selection };
    await this.play();
  }

  queue(selection: MediaSelection): void {
    this.requireEnabled();
    validateSelection(selection);
    this.upcoming.push({ ...selection });
  }

  async play(): Promise<void> {
    this.requireEnabled();
    this.requireVisible();
    if (!this.current) throw new Error("Select a video first");
    await this.host.play();
    this.state = "playing";
  }

  async pause(): Promise<void> {
    this.requireEnabled();
    if (this.state !== "playing") return;
    await this.host.pause();
    this.state = "paused";
  }

  async next(): Promise<void> {
    this.requireEnabled();
    const next = this.upcoming[0];
    if (!next) throw new Error("Queue is empty");
    await this.select(next);
    this.upcoming.shift();
  }

  /** Host calls this when the official iframe reports playback state, including user controls and end. */
  onPlayerState(state: "playing" | "paused" | "ended"): void {
    if (state === "playing" && (!this.policy.describe("youtube").enabled || !this.isVisible())) {
      void this.host.pause();
      this.state = "paused";
      return;
    }
    this.state = state === "ended" ? "stopped" : state;
  }

  dispose(): void {
    this.unsubscribe();
    if (this.state === "playing") void this.host.pause();
    this.state = "stopped";
    this.current = undefined;
    this.upcoming.length = 0;
  }

  private requireEnabled(): void {
    if (!this.policy.describe("youtube").enabled) throw new Error("YouTube connector is disabled");
  }

  private isVisible(): boolean {
    const view = this.host.viewport();
    return view.visible && view.width >= 200 && view.height >= 200;
  }

  private requireVisible(): void {
    if (!this.isVisible()) throw new Error("Visible video viewport of at least 200 × 200 CSS pixels required");
  }
}

function validateSelection(selection: MediaSelection): void {
  if (!/^[A-Za-z0-9_-]{11}$/.test(selection.videoId)) throw new Error("Invalid YouTube video ID");
  if (selection.title !== undefined && (selection.title.length > 300 || !selection.title.trim())) throw new Error("Invalid title");
  if (selection.artist !== undefined && (selection.artist.length > 300 || !selection.artist.trim())) throw new Error("Invalid artist");
}
