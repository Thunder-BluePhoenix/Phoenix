// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 59: the sound player of the web app host. One `SoundHost` per Core client creates the pet's
// `SoundPlayer` (pet/runtime) and answers its `isQuiet()` from Phoenix's real quiet settings:
//   - quiet mode: the notification switch off (Settings > Notifications, `enabled: false`);
//   - quiet hours: the Proactive quiet-hours window (`GET /api/proactive` preferences);
//   - the emergency stop (kill switch) and the demo, which are quiet too.
// Everything is read from Core at play time (the clock is evaluated at play time and Core's answers
// are never older than `maxAgeMs`). If any answer is missing the host is quiet: it can only fail
// silent. The switch and volume live in Core (`ui.sounds`), so every window shows the same ones.
// Sounds are Phoenix's own procedural tones (pet/assets); no audio file is read or shipped.
import {
  createSoundPlayer,
  DEFAULT_SOUND_SETTINGS,
  inQuietHours,
  webAudioBackend,
  type AudioContextLike,
  type QuietHoursConfig,
  type SoundBackend,
  type SoundEvent,
  type SoundOutcome,
  type SoundPlayer,
} from "@phoenix/pet-runtime";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useOptionalDemo } from "../components/Demo";
import { ApiError, type PhoenixClient } from "./client";
import { useClient } from "./context";

export const SOUNDS_PATH = "/api/ui/sounds";
export const SOUNDS_EVENT = "ui.sounds.changed";
const NOTIFICATIONS_PATH = "/api/notifications/preferences";
const QUIET_HOURS_PATH = "/api/proactive";
const KILL_SWITCH_PATH = "/api/security/kill-switch";
const KILL_SWITCH_EVENT_PREFIX = "security.kill_switch.";

/** GET/POST /api/ui/sounds: the switch (off by default) and the volume in whole percent. */
export interface SoundPrefs {
  enabled: boolean;
  volume: number;
}

/** A value from Core or an event as sound settings, or null when it is not exactly that. */
export function parseSoundPrefs(raw: unknown): SoundPrefs | null {
  if (raw === null || typeof raw !== "object") return null;
  const { enabled, volume } = raw as Record<string, unknown>;
  if (typeof enabled !== "boolean") return null;
  if (typeof volume !== "number" || !Number.isInteger(volume) || volume < 0 || volume > 100)
    return null;
  return { enabled, volume };
}

/** Everything `isQuiet()` needs from Core. */
interface QuietInputs {
  /** False is quiet mode (Settings > Notifications). */
  notificationsEnabled: boolean;
  hours: QuietHoursConfig | null;
  killSwitch: boolean;
}

function parseHours(raw: unknown): QuietHoursConfig | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== "object") return undefined;
  const { timezone, start, end } = raw as Record<string, unknown>;
  return typeof timezone === "string" && typeof start === "string" && typeof end === "string"
    ? { timezone, start, end }
    : undefined;
}

function parseQuietInputs(
  notifications: PromiseSettledResult<unknown>,
  proactive: PromiseSettledResult<unknown>,
  killSwitch: PromiseSettledResult<unknown>,
): QuietInputs | null {
  if (notifications.status !== "fulfilled" || killSwitch.status !== "fulfilled") return null;
  const enabled = (notifications.value as { enabled?: unknown } | null)?.enabled;
  const engaged = (killSwitch.value as { engaged?: unknown } | null)?.engaged;
  if (typeof enabled !== "boolean" || typeof engaged !== "boolean") return null;
  let hours: QuietHoursConfig | null | undefined;
  if (proactive.status === "fulfilled") {
    hours = parseHours(
      (proactive.value as { preferences?: { quietHours?: unknown } } | null)?.preferences
        ?.quietHours,
    );
  } else if (proactive.reason instanceof ApiError && proactive.reason.status === 404) {
    // A Core without the proactive service has no quiet hours to honour.
    hours = null;
  }
  if (hours === undefined) return null;
  return { notificationsEnabled: enabled, hours, killSwitch: engaged };
}

export interface SoundHostOptions {
  /** Plays WAV bytes. Default: Web Audio on a lazily created `AudioContext`. */
  backend?: SoundBackend;
  now?: () => number;
  /** Whether the user has interacted with the page (browser autoplay rules). Default: observed. */
  gesture?: () => boolean;
  /** How old Core's quiet answers may be when a sound is about to play. */
  maxAgeMs?: number;
  /** A sound that has not finished after this long counts as failed (a suspended audio context). */
  playTimeoutMs?: number;
}

const MAX_AGE_MS = 5_000;
const PLAY_TIMEOUT_MS = 10_000;
const GESTURE_EVENTS = ["pointerdown", "keydown", "touchstart", "click"] as const;

function createAudioContext(): AudioContextLike {
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Context = g.AudioContext ?? g.webkitAudioContext;
  if (!Context) throw new Error("Web Audio is not available");
  return new Context();
}

/** Web Audio, created on the first sound (which is always after a gesture), never at load. */
export function browserSoundBackend(): SoundBackend {
  let context: AudioContextLike | null = null;
  return webAudioBackend(() => (context ??= createAudioContext()));
}

/** Rejects when `backend` has not finished playing after `ms`. */
function withTimeout(backend: SoundBackend, ms: number): SoundBackend {
  return {
    async play(wav, volume) {
      const timeout = Promise.withResolvers<never>();
      const timer = setTimeout(() => timeout.reject(new Error("sound did not finish")), ms);
      try {
        await Promise.race([backend.play(wav, volume), timeout.promise]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export class SoundHost {
  /** The pet's player: off by default, gesture-gated, quiet-aware. Never throws. */
  readonly player: SoundPlayer;

  private prefs: SoundPrefs | null = null;
  private loadFailed = false;
  private muted = false;
  private demo = false;
  private quiet: QuietInputs | null = null;
  private quietAt: number | null = null;
  private refreshing: Promise<void> | null = null;
  private gestureSeen = false;
  private attached = 0;
  private detach: (() => void) | null = null;
  /** Counts the user's own saves: a read that started before one is out of date. */
  private saves = 0;
  private previewVolume = DEFAULT_SOUND_SETTINGS.volume;
  private snapshot = { prefs: null as SoundPrefs | null, failed: false };
  private readonly listeners = new Set<() => void>();
  private readonly inner: SoundPlayer;
  private readonly previewer: SoundPlayer;
  private readonly now: () => number;
  private readonly maxAgeMs: number;

  constructor(
    private readonly client: PhoenixClient,
    private readonly options: SoundHostOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.maxAgeMs = options.maxAgeMs ?? MAX_AGE_MS;
    const backend = withTimeout(
      options.backend ?? browserSoundBackend(),
      options.playTimeoutMs ?? PLAY_TIMEOUT_MS,
    );
    const isQuiet = () => this.isQuiet();
    this.inner = createSoundPlayer({
      backend,
      isQuiet,
      settings: () => ({
        enabled: this.prefs?.enabled === true,
        muted: this.muted,
        volume: (this.prefs?.volume ?? 0) / 100,
      }),
    });
    // A preview ignores only the master switch: it is how a person hears a sound before turning
    // sounds on. Volume, mute and every quiet rule still apply.
    this.previewer = createSoundPlayer({
      backend,
      isQuiet,
      settings: () => ({ enabled: true, muted: this.muted, volume: this.previewVolume / 100 }),
    });
    this.player = {
      trigger: async (event) => {
        try {
          if (this.prefs?.enabled !== true) return "disabled";
          if (this.demo) return "quiet";
          if (this.muted) return "muted";
          if (!this.hasGesture()) return "no-gesture";
          await this.refreshQuiet();
          return await this.inner.trigger(event);
        } catch {
          return "failed";
        }
      },
    };
  }

  /** True while quiet mode, quiet hours, the emergency stop or the demo is on, or Core could not say. */
  isQuiet(): boolean {
    if (this.demo) return true;
    const q = this.quiet;
    if (!q || q.killSwitch || !q.notificationsEnabled) return true;
    return inQuietHours(this.now(), q.hours);
  }

  /**
   * Whether quiet mode, quiet hours, the emergency stop or the demo is on right now, after
   * refreshing Core's answers when they are older than `maxAgeMs`. Missing answers are quiet. Other
   * features that must stay still when Phoenix is quiet (the desktop follow-the-pointer) ask this.
   */
  async quietNow(): Promise<boolean> {
    try {
      await this.refreshQuiet();
    } catch {
      return true;
    }
    return this.isQuiet();
  }

  /** The desktop's mute flag (unknown counts as muted: see `MuteState`). */
  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** The demo never makes a sound. */
  setDemo(active: boolean): void {
    this.demo = active;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The saved settings (null until known) and whether the last read failed. */
  readonly getSnapshot = () => this.snapshot;

  private publish(): void {
    this.snapshot = { prefs: this.prefs, failed: this.loadFailed };
    for (const listener of [...this.listeners]) listener();
  }

  private hasGesture(): boolean {
    if (this.options.gesture) return this.options.gesture();
    if (this.gestureSeen) return true;
    return (
      (globalThis.navigator as { userActivation?: { hasBeenActive?: boolean } } | undefined)
        ?.userActivation?.hasBeenActive === true
    );
  }

  /** Reads the saved switch and volume from Core. */
  async reload(): Promise<void> {
    const startedAt = this.saves;
    try {
      const prefs = parseSoundPrefs(await this.client.request("GET", SOUNDS_PATH));
      if (startedAt !== this.saves) return;
      this.loadFailed = prefs === null;
      this.prefs = prefs;
    } catch {
      if (startedAt !== this.saves) return;
      // Unknown settings mean no sound.
      this.loadFailed = true;
      this.prefs = null;
    }
    this.publish();
  }

  /** Saves a change in Core. False when Core refused or could not be reached. */
  async save(change: Partial<SoundPrefs>): Promise<boolean> {
    try {
      const next = parseSoundPrefs(await this.client.request("POST", SOUNDS_PATH, change));
      if (!next) return false;
      this.saves += 1;
      this.prefs = next;
      this.loadFailed = false;
      this.publish();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Plays one sound for the Settings preview button. Allowed while sounds are off; silent when
   * muted, at volume 0, in quiet mode or quiet hours, under the emergency stop, in the demo, or
   * when Core's answers are missing. `volume` is the slider's current whole-percent value.
   */
  async preview(event: SoundEvent, volume?: number): Promise<SoundOutcome> {
    try {
      if (this.demo) return "quiet";
      if (this.muted) return "muted";
      if (!this.hasGesture()) return "no-gesture";
      this.previewVolume = volume ?? this.prefs?.volume ?? DEFAULT_SOUND_SETTINGS.volume * 100;
      await this.refreshQuiet();
      return await this.previewer.trigger(event);
    } catch {
      return "failed";
    }
  }

  private refreshQuiet(): Promise<void> {
    if (this.quiet && this.quietAt !== null && this.now() - this.quietAt < this.maxAgeMs)
      return Promise.resolve();
    this.refreshing ??= this.fetchQuiet().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async fetchQuiet(): Promise<void> {
    const [notifications, proactive, killSwitch] = await Promise.allSettled([
      this.client.request("GET", NOTIFICATIONS_PATH),
      this.client.request("GET", QUIET_HOURS_PATH),
      this.client.request("GET", KILL_SWITCH_PATH),
    ]);
    this.quiet = parseQuietInputs(notifications, proactive, killSwitch);
    this.quietAt = this.quiet ? this.now() : null;
  }

  /** Starts following Core (reference counted: the page, Settings and the pet windows share one host). */
  attach(): () => void {
    this.attached += 1;
    if (this.attached === 1) this.detach = this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.attached -= 1;
      if (this.attached === 0) {
        this.detach?.();
        this.detach = null;
      }
    };
  }

  private start(): () => void {
    void this.reload();
    const offEvent = this.client.eventCreated.on(({ event }) => {
      if (event.event_type === SOUNDS_EVENT) {
        const next = parseSoundPrefs(event.payload);
        if (next) {
          this.saves += 1;
          this.prefs = next;
          this.loadFailed = false;
          this.publish();
        } else void this.reload();
      } else if (event.event_type.startsWith(KILL_SWITCH_EVENT_PREFIX)) {
        // Whatever Core said a moment ago is out of date: the next sound asks again, and until
        // then the host is quiet.
        this.quiet = null;
        this.quietAt = null;
      }
    });
    const offStatus = this.client.statusChanged.on((status) => {
      if (status !== "online") return;
      this.quietAt = null;
      void this.reload();
    });
    const mark = (event: Event) => {
      if (event.isTrusted) this.gestureSeen = true;
    };
    if (typeof window !== "undefined")
      for (const name of GESTURE_EVENTS) window.addEventListener(name, mark, true);
    return () => {
      offEvent();
      offStatus();
      if (typeof window !== "undefined")
        for (const name of GESTURE_EVENTS) window.removeEventListener(name, mark, true);
    };
  }
}

const hosts = new WeakMap<PhoenixClient, SoundHost>();

/** The one sound host of this client (tests pass a fake backend, clock and gesture the first time). */
export function soundHostFor(client: PhoenixClient, options?: SoundHostOptions): SoundHost {
  let host = hosts.get(client);
  if (!host) {
    host = new SoundHost(client, options);
    hosts.set(client, host);
  }
  return host;
}

/** The sound host of the page's Core: follows Core while mounted and is silent during the demo. */
export function useSoundHost(): SoundHost {
  const client = useClient();
  const host = useMemo(() => soundHostFor(client), [client]);
  const demoPhase = useOptionalDemo()?.state.phase;
  const demoOn = demoPhase !== undefined && demoPhase !== "off";
  // Plain assignments, set during render so a child's first effect already sees them.
  host.setDemo(demoOn);
  useEffect(() => host.attach(), [host]);
  return host;
}

/** The saved switch and volume, kept live. */
export function useSoundPrefs(host: SoundHost) {
  return useSyncExternalStore(host.subscribe, host.getSnapshot);
}
