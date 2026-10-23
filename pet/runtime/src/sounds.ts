// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  inspectWav,
  SOUND_EVENT_TABLE,
  synthesize,
  type SoundEvent,
  type SoundId,
} from "@phoenix/pet-assets";

/**
 * Sound policy (Phase 59). Sounds are OFF by default, and a sound plays only when a real event asks
 * for it, sounds are enabled and not muted, the volume is above zero, and quiet mode / quiet hours
 * are not in effect. Playing is delegated to an injected backend, so this file never touches audio
 * hardware.
 */

export interface SoundSettings {
  /** Master switch. Default false: Fawkes is silent until the user turns sounds on. */
  enabled: boolean;
  muted: boolean;
  /** 0..1 */
  volume: number;
}

export const DEFAULT_SOUND_SETTINGS: Readonly<SoundSettings> = {
  enabled: false,
  muted: false,
  volume: 0.6,
};

export type QuietHoursConfig = { timezone: string; start: string; end: string };

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Whether `nowMs` falls inside quiet hours (same semantics as the notification policy: the window
 * may wrap midnight; start == end is "never"). Invalid configuration is treated as quiet, so a
 * malformed setting can only make Fawkes quieter, never louder.
 */
export function inQuietHours(nowMs: number, hours: QuietHoursConfig | null): boolean {
  if (!hours) return false;
  const start = HH_MM.exec(hours.start);
  const end = HH_MM.exec(hours.end);
  if (!start || !end) return true;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: hours.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(nowMs);
  } catch {
    return true;
  }
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return true;
  const local = hour * 60 + minute;
  const from = Number(start[1]) * 60 + Number(start[2]);
  const to = Number(end[1]) * 60 + Number(end[2]);
  if (from === to) return false;
  return from < to ? local >= from && local < to : local >= from || local < to;
}

/**
 * Resolves a user's replacement for a built-in sound. The real folder access belongs to the desktop
 * shell, which implements this; the runtime only defines the contract. It must return the file's
 * bytes for `<soundId>.wav` in the user's sounds folder, or null when there is no override.
 */
export interface SoundOverrideResolver {
  resolve(id: SoundId): Promise<Uint8Array | null>;
}

/** Plays WAV bytes at a linear volume 0..1. Implemented by WebAudio in the browser (see below). */
export interface SoundBackend {
  play(wav: Uint8Array, volume: number): Promise<void>;
}

/**
 * `no-gesture` is never produced by `createSoundPlayer` itself: a host that must wait for a user
 * gesture (browser autoplay rules) answers it without calling the player.
 */
export type SoundOutcome =
  "played" | "disabled" | "muted" | "silent-volume" | "quiet" | "no-gesture" | "failed";

export interface SoundPlayerOptions {
  backend: SoundBackend;
  settings: () => SoundSettings;
  /** True while quiet mode or quiet hours are in effect (injected so tests need no real clock). */
  isQuiet: () => boolean;
  resolver?: SoundOverrideResolver;
}

export interface SoundPlayer {
  /** Plays the sound bound to a real event, if the policy allows. */
  trigger(event: SoundEvent): Promise<SoundOutcome>;
}

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

export function createSoundPlayer(options: SoundPlayerOptions): SoundPlayer {
  const cache: Partial<Record<SoundId, Uint8Array>> = {};
  const builtin = (id: SoundId) => (cache[id] ??= synthesize(id));

  return {
    async trigger(event) {
      const settings = options.settings();
      if (!settings.enabled) return "disabled";
      if (settings.muted) return "muted";
      const volume = clamp01(settings.volume);
      if (volume === 0) return "silent-volume";
      if (options.isQuiet()) return "quiet";
      const id = SOUND_EVENT_TABLE[event];
      try {
        let wav: Uint8Array | null = null;
        const override = await options.resolver?.resolve(id).catch(() => null);
        if (override && inspectWav(override)) wav = override;
        // Quiet mode could have started while the file was being read.
        if (options.isQuiet()) return "quiet";
        await options.backend.play(wav ?? builtin(id), volume);
        return "played";
      } catch {
        return "failed";
      }
    },
  };
}

/**
 * Minimal structural view of the WebAudio API, so the backend is testable without an audio device.
 */
export interface AudioContextLike {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  createBufferSource(): AudioBufferSourceLike;
  createGain(): GainLike;
  readonly destination: unknown;
  resume?(): Promise<void>;
}
export interface AudioBufferLike {
  readonly duration: number;
}
export interface AudioBufferSourceLike {
  buffer: AudioBufferLike | null;
  connect(node: unknown): unknown;
  start(when?: number): void;
  onended: (() => void) | null;
}
export interface GainLike {
  gain: { value: number };
  connect(node: unknown): unknown;
}

/** A WebAudio backend. Not exercised against real audio hardware in tests. */
export function webAudioBackend(context: () => AudioContextLike): SoundBackend {
  return {
    async play(wav, volume) {
      const ctx = context();
      await ctx.resume?.();
      const copy = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
      const buffer = await ctx.decodeAudioData(copy);
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = volume;
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(ctx.destination);
      const done = Promise.withResolvers<void>();
      source.onended = () => done.resolve();
      source.start();
      await done.promise;
    },
  };
}
