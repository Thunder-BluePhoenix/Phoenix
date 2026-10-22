// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { setDevice, type Device, type LightState } from "./devices";
import { SerialWriter } from "./serial";

export interface StatusEvent {
  event_type: string;
  source?: string;
  payload?: Readonly<Record<string, unknown>>;
}
export interface StatusFeed {
  subscribe(
    id: string,
    patterns: readonly string[],
    listener: (event: StatusEvent) => void,
  ): () => void;
}
export const STATUS_EVENTS = [
  "agent.working",
  "agent.waiting",
  "agent.failed",
  "agent.completed",
  "agent.ended",
  "agent.idle",
  "notetaker.recording",
  "notetaker.idle",
] as const;

/** Maps trusted envelope names only. Subjects, payloads and externally provided text never reach devices. */
export function mapEvent(event: StatusEvent): LightState | undefined {
  if (event.source === "agents") {
    switch (event.event_type) {
      case "agent.working":
        return "WORKING";
      case "agent.waiting":
        return "WAITING";
      case "agent.failed":
        return "ERROR";
      case "agent.completed":
      case "agent.ended":
      case "agent.idle":
        return "IDLE";
    }
  }
  // Only Core can publish `notetaker.*` (a reserved namespace); a capability faking it is ignored.
  if (event.source === "core") {
    if (event.event_type === "notetaker.recording") return "RECORDING";
    if (event.event_type === "notetaker.idle") return "IDLE";
  }
  return undefined;
}

export interface QuietHours {
  timezone: string;
  start: string;
  end: string;
}
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
function minutes(text: string): number {
  if (!HHMM.test(text)) throw new Error("Invalid quiet hours");
  return Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
}
/** Throws on a malformed time or an unknown time zone; callers treat that as quiet. */
export function isQuiet(now: number, hours: QuietHours | null): boolean {
  if (!hours) return false;
  const start = minutes(hours.start);
  const end = minutes(hours.end);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: hours.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const local =
    Number(parts.find((part) => part.type === "hour")?.value) * 60 +
    Number(parts.find((part) => part.type === "minute")?.value);
  if (start === end) return false;
  return start < end ? local >= start && local < end : local >= start || local < end;
}

export interface StatusPolicy {
  /** Fresh per-device authorization from trusted settings. An unknown device is never authorized. */
  permitted(deviceId: string): boolean;
  focusMode(): boolean;
  quietHours(): QuietHours | null;
}
export interface StatusOptions {
  devices: readonly Device[];
  feed: StatusFeed;
  policy: StatusPolicy;
  now?: () => number;
  /** Called with the device id only; never with the error text, which a device could influence. */
  onError?: (deviceId: string) => void;
  /** Called after a write to a device succeeded (the host uses it to report recovery). */
  onWritten?: (deviceId: string) => void;
  /** Called after state, policy or consent was re-evaluated (the Stream Deck redraws here). */
  onUpdate?: () => void;
}

export type Suppression = "focus" | "quiet" | null;
export interface StatusSnapshot {
  /** What Fawkes is doing, before focus mode / quiet hours. */
  state: LightState;
  /** What a consented light shows right now. */
  shown: LightState;
  suppressed: Suppression;
}

const RANK: Readonly<Record<LightState, number>> = {
  IDLE: 0,
  WORKING: 1,
  WAITING: 2,
  ERROR: 3,
  RECORDING: 4,
};
/** Agent ids are only map keys here (never sent anywhere); the table is bounded. */
const MAX_AGENTS = 64;
/** A stuck device must not hold up disabling the capability. */
const SHUTDOWN_WRITE_MS = 3000;
const DEVICE_ID = /^[a-zA-Z0-9_.:-]{1,160}$/;

/**
 * Turns the event stream into one colour per consented device. Only envelope names from trusted
 * sources choose the colour; no event text is ever put in a device command. Writes are serial per
 * device (newest wins), unconsented or revoked devices are never contacted, and a sync `stop()`
 * aborts what is in flight.
 */
export class StatusLightsController {
  private readonly devices: Map<string, Device>;
  /** Per-device serial writes; `writes.drained()` waits for in-flight ones (shutdown, tests). */
  readonly writes = new SerialWriter();
  private readonly revoked = new Set<string>();
  /** The last state successfully requested per device, so unchanged state is not re-sent. */
  private readonly sent = new Map<string, LightState>();
  private readonly agents = new Map<string, LightState>();
  private off: (() => void) | undefined;
  private recording = false;
  private active = false;

  constructor(private readonly options: StatusOptions) {
    this.devices = new Map(options.devices.map((d) => [d.id, d]));
    if (
      this.devices.size !== options.devices.length ||
      options.devices.some((d) => !DEVICE_ID.test(d.id))
    )
      throw new Error("Invalid or duplicate device id");
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.off = this.options.feed.subscribe("status-lights", STATUS_EVENTS, (event) =>
      this.handle(event),
    );
    this.refreshPolicy();
  }

  /** Synchronous: unsubscribes and aborts in-flight writes. Nothing is sent afterwards. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.off?.();
    this.off = undefined;
    this.writes.cancelAll();
    this.sent.clear();
  }

  /**
   * Controlled shutdown: switches every still-consented light to IDLE (off) so a disabled
   * capability does not leave a red light behind, then stops. Unconsented devices get nothing.
   */
  async shutdown(): Promise<void> {
    const targets = [...this.devices.values()].filter(
      (d) => this.active && !this.revoked.has(d.id) && this.options.policy.permitted(d.id),
    );
    this.stop();
    const signal = AbortSignal.timeout(SHUTDOWN_WRITE_MS);
    await Promise.all(
      targets.map(async (device) => {
        try {
          await setDevice(device, "IDLE", signal);
        } catch {
          this.options.onError?.(device.id);
        }
      }),
    );
  }

  revoke(deviceId: string): void {
    if (!this.devices.has(deviceId)) throw new Error("Unknown device");
    this.revoked.add(deviceId);
    this.writes.cancel(deviceId);
    this.sent.delete(deviceId);
    this.options.onUpdate?.();
  }

  /** Called only after a trusted settings change (an explicit fresh per-device opt-in or a revoke). */
  consentChanged(deviceId: string): void {
    if (!this.devices.has(deviceId)) throw new Error("Unknown device");
    if (!this.options.policy.permitted(deviceId)) this.revoke(deviceId);
    else {
      this.revoked.delete(deviceId);
      this.sent.delete(deviceId);
      this.updateDevice(deviceId);
    }
    this.options.onUpdate?.();
  }

  /** Re-evaluates focus mode, quiet hours and consent; the host calls it when any of them may have changed. */
  refreshPolicy(): void {
    for (const id of this.devices.keys()) this.updateDevice(id);
    this.options.onUpdate?.();
  }

  /** True while the device is consented and not revoked, i.e. it may be written to. */
  isLive(deviceId: string): boolean {
    return (
      this.devices.has(deviceId) &&
      !this.revoked.has(deviceId) &&
      this.options.policy.permitted(deviceId)
    );
  }

  snapshot(): StatusSnapshot {
    const state = this.current();
    const suppressed = this.suppression();
    return { state, shown: suppressed ? "IDLE" : state, suppressed };
  }

  handle(event: StatusEvent): void {
    if (!this.active) return;
    const next = mapEvent(event);
    if (!next) return;
    if (event.event_type === "notetaker.recording") this.recording = true;
    else if (event.event_type === "notetaker.idle") this.recording = false;
    else this.trackAgent(event, next);
    for (const id of this.devices.keys()) this.updateDevice(id);
    this.options.onUpdate?.();
  }

  private trackAgent(event: StatusEvent, state: LightState): void {
    const raw = event.payload?.agent_id;
    const key = typeof raw === "string" && raw.length > 0 ? raw.slice(0, 160) : "unknown";
    if (state === "IDLE") {
      this.agents.delete(key);
      return;
    }
    if (!this.agents.has(key) && this.agents.size >= MAX_AGENTS) {
      const oldest = this.agents.keys().next().value;
      if (oldest !== undefined) this.agents.delete(oldest);
    }
    this.agents.delete(key); // re-insert so the table stays ordered by recency
    this.agents.set(key, state);
  }

  private current(): LightState {
    if (this.recording) return "RECORDING";
    let best: LightState = "IDLE";
    for (const state of this.agents.values()) if (RANK[state] > RANK[best]) best = state;
    return best;
  }

  private suppression(): Suppression {
    try {
      if (isQuiet((this.options.now ?? Date.now)(), this.options.policy.quietHours()))
        return "quiet";
    } catch {
      return "quiet"; // invalid timezone/configuration fails dark
    }
    return this.options.policy.focusMode() ? "focus" : null;
  }

  private updateDevice(id: string): void {
    if (!this.active || this.revoked.has(id)) return;
    if (!this.options.policy.permitted(id)) {
      this.revoke(id);
      return;
    }
    const device = this.devices.get(id);
    if (!device) return;
    const { shown } = this.snapshot();
    if (this.sent.get(id) === shown) return;
    this.sent.set(id, shown);
    this.writes.schedule(id, async (signal) => {
      // Consent is re-read at write time: a revoke after queueing must win.
      if (!this.active || this.revoked.has(id) || !this.options.policy.permitted(id)) return;
      try {
        await setDevice(device, shown, signal);
        if (!signal.aborted) this.options.onWritten?.(id);
      } catch {
        if (signal.aborted) return;
        if (this.sent.get(id) === shown) this.sent.delete(id);
        this.options.onError?.(id);
      }
    });
  }
}
