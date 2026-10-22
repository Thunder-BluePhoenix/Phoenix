// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Pretend lights, event feed and Stream Deck. Nothing here opens a socket, USB device or plugin
// connection: a transport records what the capability asked it to send.
import type {
  DeckActions,
  DeckFace,
  DeckSurface,
  DeviceTransport,
  PendingApproval,
  StatusEvent,
  StatusFeed,
} from "../src";

export const HUE_RESOURCE = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

export type Sent =
  | { via: "request"; path: string; body: Readonly<Record<string, unknown>> }
  | { via: "report"; bytes: Uint8Array };

export class FakeTransport implements DeviceTransport {
  readonly sent: Sent[] = [];
  /** Calls that started but have not finished (a stuck device). */
  readonly hung: PromiseWithResolvers<void>[] = [];
  failNext = 0;
  hang = false;
  aborted = 0;

  async request(path: string, body: Readonly<Record<string, unknown>>, signal: AbortSignal) {
    await this.enter(signal);
    this.sent.push({ via: "request", path, body });
  }

  async report(bytes: Uint8Array, signal: AbortSignal) {
    await this.enter(signal);
    this.sent.push({ via: "report", bytes });
  }

  /** Every request body and report as one string, to look for leaked text. */
  dump(): string {
    return this.sent
      .map((s) => (s.via === "request" ? JSON.stringify(s) : [...s.bytes].join(",")))
      .join("\n");
  }

  private async enter(signal: AbortSignal): Promise<void> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("device unreachable: SECRET-LOOKING-DEVICE-TEXT");
    }
    if (!this.hang) return;
    const gate = Promise.withResolvers<void>();
    this.hung.push(gate);
    signal.addEventListener(
      "abort",
      () => {
        this.aborted++;
        gate.reject(new Error("aborted"));
      },
      { once: true },
    );
    await gate.promise;
  }
}

export class FakeFeed implements StatusFeed {
  readonly listeners = new Map<string, (event: StatusEvent) => void>();
  patterns: readonly string[] = [];

  subscribe(id: string, patterns: readonly string[], listener: (event: StatusEvent) => void) {
    if (this.listeners.has(id)) throw new Error("duplicate subscriber");
    this.listeners.set(id, listener);
    this.patterns = patterns;
    return () => void this.listeners.delete(id);
  }

  emit(event: StatusEvent): void {
    for (const listener of [...this.listeners.values()]) listener(event);
  }
}

export const agent = (type: string, payload: Record<string, unknown> = {}): StatusEvent => ({
  event_type: type,
  source: "agents",
  payload,
});
export const core = (type: string): StatusEvent => ({ event_type: type, source: "core" });

export class FakeDeck implements DeckSurface, DeckActions {
  readonly faces = new Map<number, DeckFace>();
  readonly resolved: { id: string; approved: boolean }[] = [];
  readonly calls: string[] = [];
  queue: PendingApproval[] = [];
  failRecording = false;
  private handler: ((key: number) => void) | undefined;

  setKey(key: number, face: DeckFace): void {
    this.faces.set(key, face);
  }
  onKeyDown(handler: (key: number) => void) {
    this.handler = handler;
    return () => {
      this.handler = undefined;
    };
  }
  press(key: number): void {
    this.handler?.(key);
  }
  get attached(): boolean {
    return this.handler !== undefined;
  }

  pending(): readonly PendingApproval[] {
    return this.queue;
  }
  resolve(id: string, approved: boolean): boolean {
    this.resolved.push({ id, approved });
    this.queue = this.queue.filter((p) => p.id !== id);
    return true;
  }
  requestRecording(): void {
    this.calls.push("recording");
    if (this.failRecording) throw new Error("panel unavailable");
  }
  keepAwake(minutes: number): void {
    this.calls.push(`awake:${minutes}`);
  }
}

export const approval = (patch: Partial<PendingApproval> = {}): PendingApproval => ({
  id: "conf_1",
  capabilityId: "git",
  command: "push",
  sideEffect: "execute",
  permissions: ["repository_access"],
  ...patch,
});
