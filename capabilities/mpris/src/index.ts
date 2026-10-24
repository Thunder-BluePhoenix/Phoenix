// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Linux media capability (Phase 68): shows what an MPRIS media player (Spotify, VLC, mpv, Firefox,
// Rhythmbox and others that follow the freedesktop MPRIS D-Bus interface) is playing and controls it
// through `playerctl`. No account, token, network or web API is involved.
// Safety: Phoenix runs only `playerctl` with an argument list (no shell); every argument is a fixed
// word, a whole number, or a player name that matched an allow-list pattern (so it can never look
// like an option); player text is cleaned and clipped; output is size-capped and every call has a
// timeout; a missing player is reported, never started. Every control asks for confirmation.
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";
import { realSleep, startPolling, type Sleep } from "@phoenix/service-kit";
import { PlayerError } from "./errors";
import { diffPlayback, NOTHING_OBSERVED, type Observed } from "./events";
import type { NowPlaying } from "./parse";
import { PLAYER_NAME_PATTERN, readNowPlaying, runControl } from "./player";
import { playerctlRunner, type PlayerctlRunner } from "./playerctl";

export * from "./errors";
export * from "./events";
export * from "./parse";
export * from "./player";
export * from "./playerctl";

export const DEFAULT_POLL_MS = 5_000;
export const MIN_POLL_MS = 2_000;
const FAILURE_POLL_MS = 30_000;

export interface MprisCapabilityOptions {
  /** Runs `playerctl`; tests pass a fake so no real player is touched. */
  run?: PlayerctlRunner;
  /** `process.platform` by default. */
  platform?: NodeJS.Platform;
  sleep?: Sleep;
}

function pollMs(ctx: CapabilityContext): number {
  const { poll_ms } = ctx.config;
  return typeof poll_ms === "number" ? Math.max(poll_ms, MIN_POLL_MS) : DEFAULT_POLL_MS;
}

/** The player the person chose in the settings, if any (re-checked by `validPlayer` on use). */
function configuredPlayer(ctx: CapabilityContext): string | undefined {
  const { player } = ctx.config;
  return typeof player === "string" ? player : undefined;
}

const WRITE = "Asks for your confirmation every time (side effect: write).";

const playerProperty = {
  type: "string",
  pattern: PLAYER_NAME_PATTERN,
  maxLength: 64,
  description:
    "Which player to use, as `playerctl --list-all` names it (for example spotify or vlc). Default: the player set in the settings, else the first one found.",
  // Shown in the approval prompt, so the person sees which player a control is for.
  "x-phoenix-confirm": true,
};

const optionalPlayer = {
  type: "object",
  additionalProperties: false,
  properties: { player: playerProperty },
};

/** A fresh capability instance (its own observation state); Phoenix Core uses one per runtime. */
export function createMprisCapability(options: MprisCapabilityOptions = {}) {
  const run = options.run ?? playerctlRunner;
  const platform = options.platform ?? process.platform;
  const sleep = options.sleep ?? realSleep;

  let observed: Observed = NOTHING_OBSERVED;
  let last: NowPlaying | undefined;
  let failure: PlayerError | undefined;

  async function observe(player: string | undefined): Promise<NowPlaying> {
    try {
      const now = await readNowPlaying(run, platform, player);
      failure = undefined;
      last = now;
      return now;
    } catch (err) {
      failure =
        err instanceof PlayerError ? err : new PlayerError("player", "The player did not answer");
      throw failure;
    }
  }

  function track(ctx: CapabilityContext, now: NowPlaying): void {
    const diff = diffPlayback(observed, now);
    observed = diff.observed;
    // Ephemeral: reaches live subscribers (the pet, the glance) but is not stored as history.
    for (const event of diff.events) void ctx.emit(event, { ephemeral: true });
  }

  const control = (name: string, input: unknown, ctx: CapabilityContext) =>
    runControl(run, platform, name, input, configuredPlayer(ctx)).then(() => ({ ok: true }));

  return defineCapability({
    manifest: {
      id: "mpris",
      name: "Linux media players (MPRIS)",
      version: "0.1.0",
      description:
        "What an MPRIS media player (Spotify, VLC, mpv, a browser and others) is playing, and play/pause, next, previous, seek, volume, shuffle and repeat, on Linux through playerctl. Controls local players only (no account or token). Never starts a player. Every control asks for your confirmation. Windows is not supported.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: ["mpris.track.*"],
      // shell_command: Phoenix runs the fixed `playerctl` helper. No network.
      permissions: ["shell_command"],
      data_categories: ["track title, artist and album", "playback state"],
      healthcheck: { interval_ms: 30_000 },
      commands: [
        {
          name: "now_playing",
          description:
            "The track, position, volume, shuffle and repeat of the running MPRIS player (no cover art). Reports not_running without starting a player.",
          side_effect: "read",
          permissions: ["shell_command"],
          input_schema: optionalPlayer,
        },
        {
          name: "play_pause",
          description: `Toggles playback. ${WRITE}`,
          side_effect: "write",
          permissions: ["shell_command"],
          input_schema: optionalPlayer,
        },
        {
          name: "next",
          description: `Skips to the next track. ${WRITE}`,
          side_effect: "write",
          permissions: ["shell_command"],
          input_schema: optionalPlayer,
        },
        {
          name: "previous",
          description: `Goes to the previous track. ${WRITE}`,
          side_effect: "write",
          permissions: ["shell_command"],
          input_schema: optionalPlayer,
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
            properties: {
              position_s: { type: "integer", minimum: 0, maximum: 86_400 },
              player: playerProperty,
            },
          },
        },
        {
          name: "set_volume",
          description: `Sets the player's volume (0-100). ${WRITE}`,
          side_effect: "write",
          permissions: ["shell_command"],
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["volume"],
            properties: {
              volume: { type: "integer", minimum: 0, maximum: 100 },
              player: playerProperty,
            },
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
            properties: { enabled: { type: "boolean" }, player: playerProperty },
          },
        },
        {
          name: "set_repeat",
          description: `Sets repeat to off, one (the current track) or all (the playlist). ${WRITE}`,
          side_effect: "write",
          permissions: ["shell_command"],
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["mode"],
            properties: { mode: { enum: ["off", "one", "all"] }, player: playerProperty },
          },
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          player: {
            type: "string",
            pattern: PLAYER_NAME_PATTERN,
            maxLength: 64,
            description:
              "Only use this player (as `playerctl --list-all` names it, for example spotify). Default: the first player found.",
          },
          poll_ms: {
            type: "integer",
            minimum: MIN_POLL_MS,
            maximum: 60_000,
            description: `Milliseconds between checks of the player while Phoenix is open (default ${DEFAULT_POLL_MS}).`,
          },
        },
      },
      // Fawkes' ten states are fixed (ADR-0019) and none means "enjoying music": no state_rules
      // (same decision as the Spotify and Apple Music capabilities, see README).
    },
    init(ctx) {
      observed = NOTHING_OBSERVED;
      last = undefined;
      failure = undefined;
      // Nothing to poll where playerctl does not apply; health says why.
      if (platform !== "linux") return;
      startPolling(
        ctx,
        async () => {
          try {
            track(ctx, await observe(configuredPlayer(ctx)));
            return pollMs(ctx);
          } catch {
            return FAILURE_POLL_MS;
          }
        },
        sleep,
      );
    },
    commands: {
      async now_playing(input, ctx) {
        const player = (input as { player?: unknown } | undefined)?.player;
        return observe((player ?? configuredPlayer(ctx)) as string | undefined);
      },
      play_pause: (input, ctx) => control("play_pause", input, ctx),
      next: (input, ctx) => control("next", input, ctx),
      previous: (input, ctx) => control("previous", input, ctx),
      seek: (input, ctx) => control("seek", input, ctx),
      set_volume: (input, ctx) => control("set_volume", input, ctx),
      set_shuffle: (input, ctx) => control("set_shuffle", input, ctx),
      set_repeat: (input, ctx) => control("set_repeat", input, ctx),
    },
    health(): HealthResult {
      if (platform !== "linux") {
        return {
          status: "degraded",
          message:
            "Unsupported: MPRIS control needs Linux (macOS uses Spotify and Apple Music; Windows is not implemented)",
        };
      }
      if (failure) return { status: "degraded", message: failure.message };
      if (!last) return { status: "healthy", message: "Waiting for the first check" };
      if (!last.running) return { status: "healthy", message: "No media player is running" };
      return { status: "healthy", message: `Media player is ${last.state}` };
    },
  });
}
