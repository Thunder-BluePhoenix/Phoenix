// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Apple Music capability (Phase 68): shows what the LOCAL Music app is playing and controls it
// through macOS AppleScript. No Apple account, token or web API is involved.
// The cover is read from the Music app as raw data and re-checked (size, PNG/JPEG bytes) before it
// is shown as an inline image; see cover.ts.
// Safety: every script is a constant (scripts.ts); input only ever travels as `osascript`
// arguments after validation; a closed app is reported, never launched.
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";
import { realSleep, startPolling, type Sleep } from "@phoenix/service-kit";
import { readCover } from "./cover";
import { PlayerError } from "./errors";
import { diffPlayback, NOTHING_OBSERVED, type Observed } from "./events";
import { osascriptRunner, type OsaRunner } from "./osascript";
import type { NowPlaying } from "./parse";
import { readNowPlaying, runControl } from "./player";

export * from "./cover";
export * from "./errors";
export * from "./events";
export * from "./osascript";
export * from "./parse";
export * from "./player";
export * from "./scripts";

export const DEFAULT_POLL_MS = 5_000;
export const MIN_POLL_MS = 2_000;
const FAILURE_POLL_MS = 30_000;

export interface AppleMusicCapabilityOptions {
  /** Runs a fixed AppleScript; tests pass a fake so no real player is touched. */
  run?: OsaRunner;
  /** `process.platform` by default. */
  platform?: NodeJS.Platform;
  sleep?: Sleep;
}

function pollMs(ctx: CapabilityContext): number {
  const { poll_ms } = ctx.config;
  return typeof poll_ms === "number" ? Math.max(poll_ms, MIN_POLL_MS) : DEFAULT_POLL_MS;
}

const WRITE = "Asks for your confirmation every time (side effect: write).";

const noInput = { type: "object", additionalProperties: false, properties: {} };

/** A fresh capability instance (its own observation state); Phoenix Core uses one per runtime. */
export function createAppleMusicCapability(options: AppleMusicCapabilityOptions = {}) {
  const run = options.run ?? osascriptRunner;
  const platform = options.platform ?? process.platform;
  const sleep = options.sleep ?? realSleep;

  let observed: Observed = NOTHING_OBSERVED;
  let last: NowPlaying | undefined;
  let failure: PlayerError | undefined;
  let coverCache: { key: string; cover: string | undefined } | undefined;

  async function observe(): Promise<NowPlaying> {
    try {
      const now = await readNowPlaying(run, platform);
      failure = undefined;
      last = now;
      return now;
    } catch (err) {
      failure =
        err instanceof PlayerError ? err : new PlayerError("player", "The player did not answer");
      throw failure;
    }
  }

  /**
   * Adds the cover of the track that is playing. Music is asked once per track (keyed by its
   * title, artist, album and length); a failed or refused read leaves `cover` out and is retried
   * on the next call, so a hiccup does not hide the cover for the whole track.
   */
  async function withCover(now: NowPlaying, signal: AbortSignal): Promise<NowPlaying> {
    if (!now.running || now.title === undefined) return now;
    const key = JSON.stringify([now.title, now.artist, now.album, now.duration_s]);
    if (coverCache?.key !== key) {
      const read = await readCover(run, platform, signal);
      if (read.failed) return now;
      coverCache = { key, cover: read.cover };
    }
    return coverCache.cover ? { ...now, cover: coverCache.cover } : now;
  }

  function track(ctx: CapabilityContext, now: NowPlaying): void {
    const diff = diffPlayback(observed, now);
    observed = diff.observed;
    // Ephemeral: reaches live subscribers (the pet, the glance) but is not stored as history.
    for (const event of diff.events) void ctx.emit(event, { ephemeral: true });
  }

  return defineCapability({
    manifest: {
      id: "apple-music",
      name: "Apple Music",
      version: "0.1.0",
      description:
        "What the Music app (Apple Music) is playing (with its cover), and play/pause, next, previous, seek, volume, shuffle and repeat, on macOS. Controls the local app only (no account or token). Never launches Music. Every control asks for your confirmation.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: ["apple_music.track.*"],
      // shell_command: Phoenix runs the fixed `osascript` helper. No network.
      permissions: ["shell_command"],
      data_categories: ["track title, artist and album", "playback state"],
      healthcheck: { interval_ms: 30_000 },
      commands: [
        {
          name: "now_playing",
          description:
            "The track, position, volume, shuffle and repeat of the running Music app, plus its cover as an inline PNG/JPEG image (400 KB max, checked by its first bytes; absent when there is none). Reports not_running without launching the app.",
          side_effect: "read",
          permissions: ["shell_command"],
          input_schema: noInput,
        },
        {
          name: "play_pause",
          description: `Toggles playback. ${WRITE}`,
          side_effect: "write",
          permissions: ["shell_command"],
          input_schema: noInput,
        },
        {
          name: "next",
          description: `Skips to the next track. ${WRITE}`,
          side_effect: "write",
          permissions: ["shell_command"],
          input_schema: noInput,
        },
        {
          name: "previous",
          description: `Goes to the previous track. ${WRITE}`,
          side_effect: "write",
          permissions: ["shell_command"],
          input_schema: noInput,
        },
        {
          name: "seek",
          description: `Moves to a position in the current track. ${WRITE}`,
          side_effect: "write",
          permissions: ["shell_command"],
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["position_s"],
            properties: { position_s: { type: "integer", minimum: 0, maximum: 86_400 } },
          },
        },
        {
          name: "set_volume",
          description: `Sets the Music app's volume (0-100). ${WRITE}`,
          side_effect: "write",
          permissions: ["shell_command"],
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["volume"],
            properties: { volume: { type: "integer", minimum: 0, maximum: 100 } },
          },
        },
        {
          name: "set_shuffle",
          description: `Turns shuffle on or off. ${WRITE}`,
          side_effect: "write",
          permissions: ["shell_command"],
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["enabled"],
            properties: { enabled: { type: "boolean" } },
          },
        },
        {
          name: "set_repeat",
          description: `Sets repeat to off, one (the current song) or all. ${WRITE}`,
          side_effect: "write",
          permissions: ["shell_command"],
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["mode"],
            properties: { mode: { enum: ["off", "one", "all"] } },
          },
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          poll_ms: {
            type: "integer",
            minimum: MIN_POLL_MS,
            maximum: 60_000,
            description: `Milliseconds between checks of the player while Phoenix is open (default ${DEFAULT_POLL_MS}).`,
          },
        },
      },
      // Fawkes' ten states are fixed (ADR-0019) and none means "enjoying music": mapping playback to
      // WORKING or SUCCESS would misreport that Phoenix is busy. So no state_rules (see README).
    },
    init(ctx) {
      observed = NOTHING_OBSERVED;
      last = undefined;
      failure = undefined;
      coverCache = undefined;
      // Nothing to poll where AppleScript does not exist; health says why.
      if (platform !== "darwin") return;
      startPolling(
        ctx,
        async () => {
          try {
            track(ctx, await observe());
            return pollMs(ctx);
          } catch {
            return FAILURE_POLL_MS;
          }
        },
        sleep,
      );
    },
    commands: {
      async now_playing(_input, ctx) {
        return withCover(await observe(), ctx.signal);
      },
      async play_pause(input) {
        await runControl(run, platform, "play_pause", input);
        return { ok: true };
      },
      async next(input) {
        await runControl(run, platform, "next", input);
        return { ok: true };
      },
      async previous(input) {
        await runControl(run, platform, "previous", input);
        return { ok: true };
      },
      async seek(input) {
        await runControl(run, platform, "seek", input);
        return { ok: true };
      },
      async set_volume(input) {
        await runControl(run, platform, "set_volume", input);
        return { ok: true };
      },
      async set_shuffle(input) {
        await runControl(run, platform, "set_shuffle", input);
        return { ok: true };
      },
      async set_repeat(input) {
        await runControl(run, platform, "set_repeat", input);
        return { ok: true };
      },
    },
    health(): HealthResult {
      if (platform !== "darwin") {
        return {
          status: "degraded",
          message:
            "Unsupported: Apple Music control needs macOS (Linux and Windows are not implemented)",
        };
      }
      if (failure?.kind === "permission") return { status: "degraded", message: failure.message };
      if (failure) return { status: "degraded", message: failure.message };
      if (!last) return { status: "healthy", message: "Waiting for the first check" };
      if (!last.running) return { status: "healthy", message: "Apple Music is not running" };
      return { status: "healthy", message: `Apple Music is ${last.state}` };
    },
  });
}
