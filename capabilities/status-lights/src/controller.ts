// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { setDevice, type Device, type LightState } from "./devices";

export interface StatusEvent {
  event_type: string;
  source?: string;
  payload?: Readonly<Record<string, unknown>>;
}
export interface StatusFeed {
  subscribe(id: string, patterns: readonly string[], listener: (event: StatusEvent) => void): () => void;
}
export const STATUS_EVENTS = [
  "agent.working", "agent.waiting", "agent.failed", "agent.completed", "agent.ended", "agent.idle",
  "notetaker.recording", "notetaker.idle",
] as const;

/** Maps trusted envelope names only. Subjects, payloads and externally provided text never reach devices. */
export function mapEvent(event: StatusEvent): LightState | undefined {
  if (event.source === "agents") {
    switch (event.event_type) {
      case "agent.working": return "WORKING";
      case "agent.waiting": return "WAITING";
      case "agent.failed": return "ERROR";
      case "agent.completed": case "agent.ended": case "agent.idle": return "IDLE";
    }
  }
  if (event.source === "core") {
    if (event.event_type === "notetaker.recording") return "RECORDING";
    if (event.event_type === "notetaker.idle") return "IDLE";
  }
  return undefined;
}

export interface QuietHours { timezone: string; start: string; end: string }
function minutes(text: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error("Invalid quiet hours");
  return Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
}
export function isQuiet(now: number, hours: QuietHours | null): boolean {
  if (!hours) return false;
  const start = minutes(hours.start), end = minutes(hours.end);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: hours.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const local = Number(parts.find((part) => part.type === "hour")?.value) * 60 + Number(parts.find((part) => part.type === "minute")?.value);
  return start === end ? false : start < end ? local >= start && local < end : local >= start || local < end;
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
  onError?: (deviceId: string) => void;
}

/** Synchronous stop aborts active writes; serial per-device queues guard against late event delivery. */
export class StatusLightsController {
  private readonly devices: Map<string, Device>;
  private readonly queues = new Map<string, Promise<void>>();
  private readonly pending = new Set<Promise<void>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly revoked = new Set<string>();
  private off?: () => void;
  private state: LightState = "IDLE";
  private recording = false;
  private active = false;
  private generation = 0;
  constructor(private readonly options: StatusOptions) {
    this.devices = new Map(options.devices.map((d) => [d.id, d]));
    if (this.devices.size !== options.devices.length || options.devices.some((d) => !/^[a-zA-Z0-9_.:-]{1,160}$/.test(d.id)))
      throw new Error("Invalid or duplicate device id");
  }
  start(): void {
    if (this.active) return;
    this.active = true;
    this.off = this.options.feed.subscribe("status-lights", STATUS_EVENTS, (event) => this.handle(event));
  }
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.generation++;
    this.off?.();
    this.off = undefined;
    for (const ctrl of this.controllers.values()) ctrl.abort();
    this.controllers.clear();
    this.queues.clear();
  }
  revoke(deviceId: string): void {
    if (!this.devices.has(deviceId)) throw new Error("Unknown device");
    this.revoked.add(deviceId);
    this.controllers.get(deviceId)?.abort();
    this.controllers.delete(deviceId);
    this.queues.delete(deviceId);
  }
  /** Called only by a trusted settings change after an explicit fresh per-device opt-in. */
  consentChanged(deviceId: string): void {
    if (!this.devices.has(deviceId)) throw new Error("Unknown device");
    if (!this.options.policy.permitted(deviceId)) this.revoke(deviceId);
    else { this.revoked.delete(deviceId); this.updateDevice(deviceId); }
  }
  refreshPolicy(): void {
    for (const id of this.devices.keys()) this.updateDevice(id);
  }
  handle(event: StatusEvent): void {
    if (!this.active) return;
    const next = mapEvent(event);
    if (!next) return;
    if (event.event_type === "notetaker.recording") this.recording = true;
    else if (event.event_type === "notetaker.idle") this.recording = false;
    else this.state = next;
    for (const id of this.devices.keys()) this.updateDevice(id);
  }
  private updateDevice(id: string): void {
    if (!this.active || this.revoked.has(id)) return;
    if (!this.options.policy.permitted(id)) { this.revoke(id); return; }
    let quiet: boolean;
    try { quiet = isQuiet((this.options.now ?? Date.now)(), this.options.policy.quietHours()); }
    catch { quiet = true; } // invalid timezone/configuration fails dark
    const state = quiet || this.options.policy.focusMode() ? "IDLE" : this.recording ? "RECORDING" : this.state;
    const device = this.devices.get(id);
    if (!device) return;
    const generation = this.generation;
    const previous = this.queues.get(id);
    const ctrl = new AbortController();
    this.controllers.get(id)?.abort();
    this.controllers.set(id, ctrl);
    const run = async () => {
      await previous?.catch(() => undefined);
      if (!this.active || generation !== this.generation || ctrl.signal.aborted || this.revoked.has(id) || !this.options.policy.permitted(id)) return;
      try { await setDevice(device, state, ctrl.signal); }
      catch { if (!ctrl.signal.aborted) this.options.onError?.(id); }
      finally { if (this.controllers.get(id) === ctrl) this.controllers.delete(id); }
    };
    const job = run();
    this.queues.set(id, job);
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
  }
  /** Waits for in-flight writes (useful on controlled shutdown and in tests). */
  async drained(): Promise<void> { await Promise.all([...this.pending]); }
}
