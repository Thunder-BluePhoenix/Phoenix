// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

import { describe, expect, it } from "vitest";
import { ConnectorPolicy, YouTubeMusicConnector, searchSite, searchUrl } from "../src/index.js";
import type { VisiblePlayerHost } from "../src/index.js";

const ID_A = "abcdefghijk";
const ID_B = "ABCDEFGHIJK";

class FakeHost implements VisiblePlayerHost {
  view = { visible: true, width: 640, height: 360 };
  calls: string[] = [];
  hideHooks: Array<() => Promise<void>> = [];
  viewport(): { visible: boolean; width: number; height: number } {
    return this.view;
  }
  async loadOfficialEmbed(videoId: string): Promise<void> {
    this.calls.push(`load:${videoId}`);
  }
  async play(): Promise<void> {
    this.calls.push("play");
  }
  async pause(): Promise<void> {
    this.calls.push("pause");
  }
  async openSearch(url: string): Promise<void> {
    this.calls.push(`search:${url}`);
  }
  beforeHide(callback: () => Promise<void>): () => void {
    this.hideHooks.push(callback);
    return () => {
      this.hideHooks = this.hideHooks.filter((hook) => hook !== callback);
    };
  }
  async hide(): Promise<void> {
    for (const hook of this.hideHooks) await hook();
    this.view = { visible: false, width: 0, height: 0 };
  }
}

function setup(enabled = true): {
  host: FakeHost;
  policy: ConnectorPolicy;
  yt: YouTubeMusicConnector;
} {
  const host = new FakeHost();
  const policy = new ConnectorPolicy(enabled ? ["youtube"] : []);
  return { host, policy, yt: new YouTubeMusicConnector(host, policy) };
}

describe("ConnectorPolicy", () => {
  it("is opt-in: nothing is enabled by default and nothing matches", () => {
    const policy = new ConnectorPolicy();
    expect(policy.describe("youtube").enabled).toBe(false);
    expect(policy.forUrl("https://www.youtube.com/watch?v=x")).toBeUndefined();
  });

  it("exempts YouTube ad blocking only while enabled, with a reason", () => {
    const policy = new ConnectorPolicy();
    expect(policy.describe("youtube").adBlocking).toBe("normal");
    policy.setEnabled("youtube", true);
    const youtube = policy.describe("youtube");
    expect(youtube.adBlocking).toBe("exempt");
    expect(youtube.reason).toContain("ads");
    policy.setEnabled("youtube", false);
    expect(policy.describe("youtube").adBlocking).toBe("normal");
  });

  it("never exempts other sites from blocking", () => {
    const policy = new ConnectorPolicy(["soundcloud", "bandcamp", "spotify-web"]);
    for (const site of ["soundcloud", "bandcamp", "spotify-web"] as const) {
      expect(policy.describe(site).adBlocking).toBe("normal");
    }
  });

  it("matches exact hosts only and rejects lookalikes, subdomains, http, credentials and ports", () => {
    const policy = new ConnectorPolicy(["youtube"]);
    expect(policy.forUrl("https://music.youtube.com/watch")?.site).toBe("youtube");
    expect(policy.forUrl("https://WWW.YOUTUBE.COM/")?.site).toBe("youtube");
    for (const bad of [
      "https://evil.youtube.com/",
      "https://youtube.com.evil.example/",
      "https://notyoutube.com/",
      "http://www.youtube.com/",
      "https://user:pw@www.youtube.com/",
      "https://www.youtube.com:8443/",
      "not a url",
    ]) {
      expect(policy.forUrl(bad), bad).toBeUndefined();
    }
  });

  it("scopes enablement per site and rejects unknown connectors", () => {
    const policy = new ConnectorPolicy(["bandcamp"]);
    expect(policy.forUrl("https://soundcloud.com/")).toBeUndefined();
    expect(policy.forUrl("https://bandcamp.com/")?.site).toBe("bandcamp");
    expect(() => policy.setEnabled("napster" as never, true)).toThrow("Unknown connector");
    expect(() => policy.describe("__proto__" as never)).toThrow("Unknown connector");
  });
});

describe("search", () => {
  it("builds encoded official search URLs and rejects empty or oversized queries", () => {
    expect(searchUrl("youtube", " lo-fi & chill ")).toBe(
      "https://www.youtube.com/results?search_query=lo-fi%20%26%20chill",
    );
    expect(searchUrl("spotify-web", "a")).toBe("https://open.spotify.com/search/a");
    expect(() => searchUrl("youtube", "   ")).toThrow("1–200");
    expect(() => searchUrl("youtube", "x".repeat(201))).toThrow("1–200");
  });

  it("opens search visibly only for enabled connectors and never selects a track", async () => {
    const opened: string[] = [];
    const policy = new ConnectorPolicy(["soundcloud"]);
    await searchSite("soundcloud", "ambient", policy, async (url) => void opened.push(url));
    expect(opened).toEqual(["https://soundcloud.com/search?q=ambient"]);
    await expect(
      searchSite("bandcamp", "x", policy, async (url) => void opened.push(url)),
    ).rejects.toThrow("disabled");
    expect(opened).toHaveLength(1);
  });

  it("YouTube search opens the results page without loading or playing anything", async () => {
    const { host, yt } = setup();
    await yt.search("lo-fi");
    expect(host.calls).toEqual(["search:https://www.youtube.com/results?search_query=lo-fi"]);
    expect(yt.snapshot().state).toBe("stopped");
    expect(yt.snapshot().current).toBeUndefined();
  });

  it("refuses to search while the connector is disabled", async () => {
    const { host, yt } = setup(false);
    await expect(yt.search("lo-fi")).rejects.toThrow("disabled");
    expect(host.calls).toEqual([]);
  });
});

describe("YouTubeMusicConnector playback", () => {
  it("selects, loads the official embed, plays and reports now playing", async () => {
    const { host, yt } = setup();
    await yt.select({ videoId: ID_A, title: "Track", artist: "Artist" });
    expect(host.calls).toEqual([`load:${ID_A}`, "play"]);
    expect(yt.snapshot()).toEqual({
      site: "youtube",
      state: "playing",
      current: { videoId: ID_A, title: "Track", artist: "Artist" },
      queued: [],
    });
  });

  it("refuses to start when the viewport is hidden or smaller than 200x200", async () => {
    for (const view of [
      { visible: false, width: 640, height: 360 },
      { visible: true, width: 199, height: 360 },
      { visible: true, width: 640, height: 199 },
    ]) {
      const { host, yt } = setup();
      host.view = view;
      await expect(yt.select({ videoId: ID_A })).rejects.toThrow("200");
      expect(host.calls).toEqual([]);
      expect(yt.snapshot().state).toBe("stopped");
    }
    const { host, yt } = setup();
    host.view = { visible: true, width: 200, height: 200 };
    await yt.select({ videoId: ID_A });
    expect(yt.snapshot().state).toBe("playing");
  });

  it("rejects invalid selections before touching the host", async () => {
    const { host, yt } = setup();
    for (const bad of [
      { videoId: "short" },
      { videoId: "abcdefghijk;" },
      { videoId: "../../etc/pa" },
      { videoId: ID_A, title: "  " },
      { videoId: ID_A, title: "t".repeat(301) },
      { videoId: ID_A, artist: "" },
    ]) {
      await expect(yt.select(bad)).rejects.toThrow();
      expect(() => yt.queue(bad)).toThrow();
    }
    expect(host.calls).toEqual([]);
    expect(yt.snapshot().queued).toEqual([]);
  });

  it("requires explicit selection before play, and pause is idempotent", async () => {
    const { host, yt } = setup();
    await expect(yt.play()).rejects.toThrow("Select a video first");
    await yt.pause();
    expect(host.calls).toEqual([]);
    await yt.select({ videoId: ID_A });
    await yt.pause();
    await yt.pause();
    expect(host.calls.filter((call) => call === "pause")).toHaveLength(1);
    expect(yt.snapshot().state).toBe("paused");
    await yt.play();
    expect(yt.snapshot().state).toBe("playing");
  });

  it("queues without playing and next() advances in order, then fails when empty", async () => {
    const { host, yt } = setup();
    yt.queue({ videoId: ID_A });
    yt.queue({ videoId: ID_B });
    expect(host.calls).toEqual([]);
    await yt.next();
    expect(yt.snapshot().current?.videoId).toBe(ID_A);
    expect(yt.snapshot().queued.map((item) => item.videoId)).toEqual([ID_B]);
    await yt.next();
    expect(yt.snapshot().current?.videoId).toBe(ID_B);
    await expect(yt.next()).rejects.toThrow("Queue is empty");
  });

  it("keeps the queued item when next() cannot start because the viewport is hidden", async () => {
    const { host, yt } = setup();
    yt.queue({ videoId: ID_A });
    host.view = { visible: false, width: 0, height: 0 };
    await expect(yt.next()).rejects.toThrow("200");
    expect(yt.snapshot().queued).toHaveLength(1);
  });

  it("snapshot copies do not alias internal queue state", () => {
    const { yt } = setup();
    yt.queue({ videoId: ID_A });
    const snapshot = yt.snapshot();
    (snapshot.queued as unknown[]).length = 0;
    expect(yt.snapshot().queued).toHaveLength(1);
  });

  it("disabled connector blocks every control", async () => {
    const { yt } = setup(false);
    await expect(yt.select({ videoId: ID_A })).rejects.toThrow("disabled");
    await expect(yt.play()).rejects.toThrow("disabled");
    await expect(yt.pause()).rejects.toThrow("disabled");
    await expect(yt.next()).rejects.toThrow("disabled");
    expect(() => yt.queue({ videoId: ID_A })).toThrow("disabled");
  });
});

describe("visibility and host events", () => {
  it("pauses before the host hides the viewport, so playback is never hidden", async () => {
    const { host, yt } = setup();
    await yt.select({ videoId: ID_A });
    await host.hide();
    expect(host.calls.at(-1)).toBe("pause");
    expect(yt.snapshot().state).toBe("paused");
    await expect(yt.play()).rejects.toThrow("200");
  });

  it("forces a pause if the player reports playing while hidden or disabled", async () => {
    const { host, policy, yt } = setup();
    await yt.select({ videoId: ID_A });
    host.view = { visible: false, width: 0, height: 0 };
    await yt.onPlayerState("playing");
    expect(yt.snapshot().state).toBe("paused");
    expect(host.calls.at(-1)).toBe("pause");

    host.view = { visible: true, width: 300, height: 300 };
    policy.setEnabled("youtube", false);
    await yt.onPlayerState("playing");
    expect(yt.snapshot().state).toBe("paused");
  });

  it("mirrors user pause, resume and end reported by the official player", async () => {
    const { yt } = setup();
    await yt.select({ videoId: ID_A });
    await yt.onPlayerState("paused");
    expect(yt.snapshot().state).toBe("paused");
    await yt.onPlayerState("playing");
    expect(yt.snapshot().state).toBe("playing");
    await yt.onPlayerState("ended");
    expect(yt.snapshot().state).toBe("stopped");
  });

  it("dispose pauses playback, clears state and detaches the hide hook", async () => {
    const { host, yt } = setup();
    await yt.select({ videoId: ID_A });
    yt.queue({ videoId: ID_B });
    await yt.dispose();
    expect(host.calls.at(-1)).toBe("pause");
    expect(host.hideHooks).toHaveLength(0);
    expect(yt.snapshot()).toEqual({ site: "youtube", state: "stopped", queued: [] });
  });

  it("dispose of an idle connector does not call the host player", async () => {
    const { host, yt } = setup();
    await yt.dispose();
    expect(host.calls).toEqual([]);
  });
});
