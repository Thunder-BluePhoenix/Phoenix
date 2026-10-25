// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 94: the mini player for YouTube's OFFICIAL embedded player (IFrame Player API), as a pure
// model. It owns the rules and nothing else:
//   - the video id is 11 characters of [A-Za-z0-9_-] and comes from a search result the person
//     picked with a real (trusted) user event, never from page text;
//   - the video surface is never smaller than 200 x 200 CSS px and is hidden, not shrunk, when the
//     space left is smaller;
//   - audio is never separated from video: the player is paused BEFORE it is hidden, and a
//     "playing" report while hidden is paused again at once;
//   - play needs a recent user gesture; Fawkes, voice and the queue can search and select but a
//     person's click starts the sound;
//   - nothing blocks YouTube's ads: the embed is the stock iframe (the host exempts youtube.com
//     only while the YouTube connector is on, see capabilities/youtube-music).
// It runs against an injected `YtApi` (the shape of the IFrame API's `YT` global). NOTHING HERE
// LOADS THAT API OR FRAMES ANYTHING: no host surface in Phoenix can do so without weakening content
// isolation, see docs/youtube-music.md "Hosting the embed". No track ever played through this code.
import {
  MIN_PLAYER_EDGE,
  isVideoId,
  type MediaSelection,
  type MediaSnapshot,
  type VisiblePlayerHost,
  type YouTubeMusicConnector,
} from "../../../../capabilities/youtube-music/src/index";
import type { NowPlaying } from "./media";

export { MIN_PLAYER_EDGE, isVideoId };

/** The only embed origin Phoenix ever frames. */
export const EMBED_ORIGIN = "https://www.youtube.com";
/** What the surface starts at: 16:9 at the minimum height. */
export const DEFAULT_PLAYER_SIZE: Size = { width: 356, height: MIN_PLAYER_EDGE };
export const MAX_PLAYER_EDGE = 4096;
/** How long a click keeps allowing `play()`. */
export const GESTURE_WINDOW_MS = 10_000;
const MAX_TEXT = 300;

export interface Size {
  width: number;
  height: number;
}

export type PlayerErrorCode =
  | "invalid_video_id"
  | "gesture_required"
  | "not_visible"
  | "bad_embed"
  | "embed_error"
  | "no_player"
  | "bad_search_url"
  | "disposed";

export class PlayerError extends Error {
  constructor(
    readonly code: PlayerErrorCode,
    message: string,
    /** The IFrame API's own error number for `embed_error`. */
    readonly detail?: number,
  ) {
    super(message);
    this.name = "PlayerError";
  }
}

// ---------------------------------------------------------------------------------------------
// Size rule
// ---------------------------------------------------------------------------------------------

const edge = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_PLAYER_EDGE, Math.max(MIN_PLAYER_EDGE, Math.round(value)));
};

/** A requested size, never below 200 x 200: too small is raised, garbage becomes the default. */
export function enforceMinSize(size: Partial<Size> | null | undefined): Size {
  return {
    width: edge(size?.width, DEFAULT_PLAYER_SIZE.width),
    height: edge(size?.height, DEFAULT_PLAYER_SIZE.height),
  };
}

/** True when `space` can hold the player at all. Below this the surface is hidden, not shrunk. */
export function spaceFits(space: Partial<Size> | null | undefined): space is Size {
  return (
    typeof space?.width === "number" &&
    typeof space.height === "number" &&
    Number.isFinite(space.width) &&
    Number.isFinite(space.height) &&
    space.width >= MIN_PLAYER_EDGE &&
    space.height >= MIN_PLAYER_EDGE
  );
}

// ---------------------------------------------------------------------------------------------
// The embed address and where a video id comes from
// ---------------------------------------------------------------------------------------------

/**
 * `https://www.youtube.com/embed/<videoId>` with the IFrame API switched on. There is no
 * `autoplay`. `origin` (the embedding page's own origin) is added only when it is a plain
 * http(s) origin. Throws `invalid_video_id` unless the id is exactly 11 safe characters.
 */
export function embedUrl(videoId: string, pageOrigin?: string): string {
  if (!isVideoId(videoId)) throw new PlayerError("invalid_video_id", "Invalid YouTube video ID");
  const url = new URL(`${EMBED_ORIGIN}/embed/${videoId}`);
  url.searchParams.set("enablejsapi", "1");
  url.searchParams.set("playsinline", "1");
  url.searchParams.set("rel", "0");
  if (pageOrigin !== undefined) {
    try {
      const origin = new URL(pageOrigin);
      if (
        (origin.protocol === "https:" || origin.protocol === "http:") &&
        origin.origin === pageOrigin
      ) {
        url.searchParams.set("origin", origin.origin);
      }
    } catch {
      // No origin parameter for something that is not an origin.
    }
  }
  return url.toString();
}

/** True only for exactly `https://www.youtube.com/embed/<valid id>` (query allowed, nothing else). */
export function isEmbedAddress(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (url.origin !== EMBED_ORIGIN || url.username || url.password || url.hash) return false;
  const match = /^\/embed\/([^/]+)$/.exec(url.pathname);
  return match !== null && isVideoId(match[1]);
}

/** A search result as a structured provider returned it. Text fields are data, never instructions. */
export interface SearchResult {
  videoId: string;
  title: string;
  channel?: string;
}

const clean = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  // Control and bidi/format characters out, then trimmed and cut: titles are shown as text only.
  const text = value
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT)
    .trim();
  return text === "" ? undefined : text;
};

/** One provider row checked field by field; null when its id is not a valid video id. */
export function readSearchResult(raw: unknown): SearchResult | null {
  if (raw === null || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (!isVideoId(row.videoId)) return null;
  const title = clean(row.title);
  if (title === undefined) return null;
  const channel = clean(row.channel);
  return { videoId: row.videoId, title, ...(channel !== undefined ? { channel } : {}) };
}

const TRUSTED_GESTURES: ReadonlySet<string> = new Set([
  "click",
  "keydown",
  "pointerup",
  "touchend",
]);

/**
 * Proof that a person acted: made only from a real, browser-generated event (`isTrusted`). A script
 * that dispatches a synthetic click, a page's text and an agent request cannot make one.
 */
export class UserGesture {
  private constructor() {}

  static fromEvent(
    event: { isTrusted: boolean; type: string } | null | undefined,
  ): UserGesture | null {
    if (!event || event.isTrusted !== true || !TRUSTED_GESTURES.has(event.type)) return null;
    return new UserGesture();
  }
}

/**
 * The selection for the result the person picked. Needs a trusted gesture and the index of a row
 * that is on screen; the id is checked again and the selection is built fresh from validated fields,
 * so nothing from the row but a valid id and cleaned text reaches the player.
 */
export function pickResult(
  results: readonly SearchResult[],
  index: number,
  gesture: UserGesture | null,
): MediaSelection {
  if (!(gesture instanceof UserGesture))
    throw new PlayerError("gesture_required", "A person must pick the result");
  const row = Number.isInteger(index) ? results[index] : undefined;
  const checked = row ? readSearchResult(row) : null;
  if (!checked) throw new PlayerError("invalid_video_id", "That result cannot be played");
  return {
    videoId: checked.videoId,
    title: checked.title,
    ...(checked.channel !== undefined ? { artist: checked.channel } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// The IFrame API seam (the part of YouTube's `YT` global the player uses)
// ---------------------------------------------------------------------------------------------

/** YT.PlayerState numbers. */
export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

export interface YtPlayerOptions {
  width: number;
  height: number;
  videoId: string;
  playerVars: {
    autoplay: 0;
    enablejsapi: 1;
    playsinline: 1;
    rel: 0;
    origin?: string;
  };
  events: {
    onReady: () => void;
    onStateChange: (event: { data: number }) => void;
    onError: (event: { data: number }) => void;
  };
}

export interface YtPlayerLike {
  playVideo(): void;
  pauseVideo(): void;
  /** Cues without playing. */
  cueVideoById(videoId: string): void;
  getPlayerState(): number;
  setSize(width: number, height: number): void;
  getIframe?(): { src: string };
  destroy(): void;
}

export interface YtApi {
  Player: new (mount: unknown, options: YtPlayerOptions) => YtPlayerLike;
}

/** The `YT` global, when the page has the IFrame API loaded. Loading it is the host's decision. */
export function ytFromGlobal(win: object): YtApi | null {
  if (!("YT" in win) || win.YT === null || typeof win.YT !== "object") return null;
  const yt: object = win.YT;
  if (!("Player" in yt) || typeof yt.Player !== "function") return null;
  // `Player` is a function; its construct signature is the IFrame API's, which cannot be checked here.
  const Player = yt.Player as YtApi["Player"];
  return { Player };
}

// ---------------------------------------------------------------------------------------------
// The player
// ---------------------------------------------------------------------------------------------

export type ReportedState = "playing" | "paused" | "ended";

export interface MiniPlayerOptions {
  api: YtApi;
  /** Where the iframe goes. Opaque here (a DOM element in a real host). */
  mount: unknown;
  /** The embedding page's own origin, passed to the embed as `origin`. */
  origin?: string;
  size?: Partial<Size>;
  now?: () => number;
  /** Shows YouTube's own search page in a visible page. Absent: `openSearch` refuses. */
  openSearchPage?: (url: string) => Promise<void>;
}

/**
 * The `VisiblePlayerHost` for `YouTubeMusicConnector`, over the IFrame API. Starts hidden; only
 * `fit()` with room for 200 x 200 makes it visible.
 */
export class MiniPlayer implements VisiblePlayerHost {
  private player: YtPlayerLike | undefined;
  private ready: Promise<void> | undefined;
  private visible = false;
  private desired: Size;
  private applied: Size;
  private gestureAt = Number.NEGATIVE_INFINITY;
  private disposed = false;
  private lastError: number | undefined;
  private readonly hooks = new Set<() => Promise<void>>();
  private readonly listeners = new Set<(state: ReportedState) => void>();
  private readonly now: () => number;

  constructor(private readonly options: MiniPlayerOptions) {
    this.desired = enforceMinSize(options.size);
    this.applied = this.desired;
    this.now = options.now ?? (() => Date.now());
  }

  // --- the surface -----------------------------------------------------------------------

  viewport(): { visible: boolean; width: number; height: number } {
    return this.visible
      ? { visible: true, ...this.applied }
      : { visible: false, width: 0, height: 0 };
  }

  /** The size the person asked for (never below 200 x 200). Applies at once. */
  resize(size: Partial<Size>): Size {
    this.desired = enforceMinSize(size);
    this.applied = this.desired;
    this.player?.setSize(this.applied.width, this.applied.height);
    return this.applied;
  }

  /**
   * Lays the player out in `space`. With room for 200 x 200 it is shown at the wanted size, reduced
   * only down to the space (never below the minimum). With less room it is HIDDEN, after the pause
   * hooks ran: it is never drawn smaller than 200 x 200.
   */
  async fit(space: Partial<Size>): Promise<boolean> {
    this.assertLive();
    if (!spaceFits(space)) {
      await this.hide();
      return false;
    }
    this.applied = {
      width: Math.min(this.desired.width, space.width),
      height: Math.min(this.desired.height, space.height),
    };
    this.visible = true;
    this.player?.setSize(this.applied.width, this.applied.height);
    return true;
  }

  /** Pauses (hooks first, then the player itself as a backstop), then hides. Never hides a playing video. */
  async hide(): Promise<void> {
    for (const hook of [...this.hooks]) {
      try {
        await hook();
      } catch {
        // A failing hook must not leave a hidden player making sound: paused below regardless.
      }
    }
    if (this.player && this.player.getPlayerState() === YT_STATE.PLAYING) this.player.pauseVideo();
    this.visible = false;
  }

  beforeHide(callback: () => Promise<void>): () => void {
    this.hooks.add(callback);
    return () => void this.hooks.delete(callback);
  }

  // --- gestures --------------------------------------------------------------------------

  /** Records a person's click or key press. Only a `UserGesture` counts. */
  noteGesture(gesture: UserGesture | null): void {
    this.assertLive();
    if (!(gesture instanceof UserGesture))
      throw new PlayerError("gesture_required", "Not a user gesture");
    this.gestureAt = this.now();
  }

  private gestureFresh(): boolean {
    return this.now() - this.gestureAt <= GESTURE_WINDOW_MS;
  }

  // --- VisiblePlayerHost -----------------------------------------------------------------

  async loadOfficialEmbed(videoId: string): Promise<void> {
    this.assertLive();
    if (!isVideoId(videoId)) throw new PlayerError("invalid_video_id", "Invalid YouTube video ID");
    this.requireVisible();
    this.lastError = undefined;
    if (this.player) {
      await this.ready;
      this.player.cueVideoById(videoId);
      return;
    }
    await this.create(videoId);
  }

  async play(): Promise<void> {
    this.assertLive();
    this.requireVisible();
    if (!this.gestureFresh())
      throw new PlayerError("gesture_required", "A person must press play first");
    if (!this.player) throw new PlayerError("no_player", "Select a video first");
    await this.ready;
    this.player.playVideo();
  }

  async pause(): Promise<void> {
    this.player?.pauseVideo();
  }

  async openSearch(url: string): Promise<void> {
    this.assertLive();
    let address: URL;
    try {
      address = new URL(url);
    } catch {
      throw new PlayerError("bad_search_url", "Not a YouTube search address");
    }
    if (
      address.origin !== EMBED_ORIGIN ||
      address.pathname !== "/results" ||
      address.username ||
      address.password ||
      !this.options.openSearchPage
    ) {
      throw new PlayerError("bad_search_url", "Not a YouTube search address");
    }
    await this.options.openSearchPage(address.toString());
  }

  // --- reports back ----------------------------------------------------------------------

  /** Calls back with what the iframe reports (including its own controls). Returns the unsubscribe. */
  onState(listener: (state: ReportedState) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** The IFrame API's last error number (2, 5, 100, 101, 150), cleared by the next load. */
  error(): number | undefined {
    return this.lastError;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.hide();
    this.disposed = true;
    this.listeners.clear();
    this.hooks.clear();
    this.player?.destroy();
    this.player = undefined;
    this.ready = undefined;
  }

  // --- internals -------------------------------------------------------------------------

  private create(videoId: string): Promise<void> {
    const options = this.options;
    const ready = new Promise<void>((resolve, reject) => {
      let settled = false;
      const player = new options.api.Player(options.mount, {
        width: this.applied.width,
        height: this.applied.height,
        videoId,
        playerVars: {
          autoplay: 0,
          enablejsapi: 1,
          playsinline: 1,
          rel: 0,
          ...(options.origin !== undefined && this.originOk(options.origin)
            ? { origin: options.origin }
            : {}),
        },
        events: {
          onReady: () => {
            settled = true;
            resolve();
          },
          onStateChange: (event) => this.handleState(event.data),
          onError: (event) => {
            this.lastError = event.data;
            if (!settled) {
              settled = true;
              reject(new PlayerError("embed_error", "YouTube refused the embed", event.data));
            } else {
              this.emit("paused");
            }
          },
        },
      });
      this.player = player;
    });
    this.ready = ready;
    return ready.then(
      () => {
        // The iframe is made by YouTube's API from the id; check what it really points at.
        const src = this.player?.getIframe?.().src;
        if (src !== undefined && !isEmbedAddress(src)) {
          this.player?.destroy();
          this.player = undefined;
          this.ready = undefined;
          throw new PlayerError("bad_embed", "The player frame is not the YouTube embed");
        }
      },
      (error: unknown) => {
        this.player?.destroy();
        this.player = undefined;
        this.ready = undefined;
        throw error;
      },
    );
  }

  private originOk(value: string): boolean {
    return embedUrl("aaaaaaaaaaa", value).includes("origin=");
  }

  private handleState(code: number): void {
    let state: ReportedState | null =
      code === YT_STATE.PLAYING
        ? "playing"
        : code === YT_STATE.PAUSED
          ? "paused"
          : code === YT_STATE.ENDED
            ? "ended"
            : null;
    if (state === null) return;
    if (state === "playing" && !this.isVisible()) {
      // Sound without a visible video is never allowed, whatever started it.
      this.player?.pauseVideo();
      state = "paused";
    }
    this.emit(state);
  }

  private emit(state: ReportedState): void {
    for (const listener of [...this.listeners]) listener(state);
  }

  private isVisible(): boolean {
    return (
      this.visible &&
      this.applied.width >= MIN_PLAYER_EDGE &&
      this.applied.height >= MIN_PLAYER_EDGE
    );
  }

  private requireVisible(): void {
    if (!this.isVisible())
      throw new PlayerError("not_visible", "The player must be visible at 200 × 200 or larger");
  }

  private assertLive(): void {
    if (this.disposed) throw new PlayerError("disposed", "The player was closed");
  }
}

/** Forwards the iframe's reports to the connector (its own controls, end of video, forced pauses). */
export function bindConnector(
  player: MiniPlayer,
  connector: Pick<YouTubeMusicConnector, "onPlayerState">,
  onError: (error: unknown) => void = () => {},
): () => void {
  return player.onState((state) => {
    connector.onPlayerState(state).catch(onError);
  });
}

/** The connector's snapshot in the shape the Now playing glance already shows (`core/media.ts`). */
export function nowPlayingOf(snapshot: MediaSnapshot): NowPlaying {
  const current = snapshot.current;
  if (!current) return { running: false, state: "not_running" };
  return {
    running: true,
    state: snapshot.state,
    title: current.title ?? "YouTube",
    ...(current.artist !== undefined ? { artist: current.artist } : {}),
  };
}
