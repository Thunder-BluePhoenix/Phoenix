// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// LIFX discovery (https://lan.developer.lifx.com, "GetService - Packet 2"): one UDP broadcast of a
// GetService on port 56700, a bounded wait, StateService (3) answers parsed and collected, at most
// `maxDevices` of them. Discovery only LISTS candidates. It never provisions a light and never
// sends a state command: the owner picks the lights they want and adds them through the same
// provisioning call as a manually entered light, and consent is a separate setting.
//
// Only answers to our own datagram count (our source and sequence, exact length, UDP service),
// only from a private, link-local or loopback unicast IPv4, and a light that is not on port 56700
// is accepted only on loopback (for a fake light). The socket is injected so tests use a fake.
import { createSocket } from "node:dgram";
import {
  LIFX_PORT,
  LIFX_SOURCE,
  lifxGetService,
  parseLifxStateService,
} from "@phoenix/capability-status-lights";
import { isLocalIPv4, isLocalUnicastIPv4 } from "./lan-address";

export const LIFX_DISCOVERY_WAIT_MS = 2_000;
export const LIFX_DISCOVERY_MAX_WAIT_MS = 5_000;
export const LIFX_DISCOVERY_MAX_DEVICES = 16;
/** At most one discovery every this long, however often it is asked for. */
export const LIFX_DISCOVERY_COOLDOWN_MS = 5_000;
const LIMITED_BROADCAST = "255.255.255.255";

/** The part of a `dgram` socket discovery uses. */
export interface DiscoverySocket {
  bind(port: number, callback: () => void): void;
  setBroadcast(flag: boolean): void;
  send(
    message: Uint8Array,
    port: number,
    address: string,
    callback: (error: Error | null) => void,
  ): void;
  on(
    event: "message",
    listener: (message: Uint8Array, from: { address: string; port: number }) => void,
  ): this;
  on(event: "error", listener: (error: Error) => void): this;
  close(): void;
}

export interface LifxCandidate {
  /** The light's serial as 12 lower-case hex digits. */
  mac: string;
  address: string;
  port: number;
}

export interface LifxDiscoveryOptions {
  createSocket: () => DiscoverySocket;
  /** Where the broadcast goes: the limited broadcast, or the owner's own subnet broadcast. */
  broadcast?: string;
  /** The broadcast target's port; always 56700 on a real network. */
  port?: number;
  waitMs?: number;
  maxDevices?: number;
  signal?: AbortSignal;
}

/** The broadcast target is 255.255.255.255 or a private/link-local/loopback address the owner entered. */
export function validBroadcastTarget(address: unknown): address is string {
  return address === LIMITED_BROADCAST || (typeof address === "string" && isLocalIPv4(address));
}

export async function discoverLifx(options: LifxDiscoveryOptions): Promise<LifxCandidate[]> {
  const broadcast = options.broadcast ?? LIMITED_BROADCAST;
  if (!validBroadcastTarget(broadcast))
    throw new Error("The broadcast address must be on your own network");
  const targetPort = options.port ?? LIFX_PORT;
  const waitMs = Math.min(
    Math.max(options.waitMs ?? LIFX_DISCOVERY_WAIT_MS, 1),
    LIFX_DISCOVERY_MAX_WAIT_MS,
  );
  const max = Math.min(
    Math.max(options.maxDevices ?? LIFX_DISCOVERY_MAX_DEVICES, 1),
    LIFX_DISCOVERY_MAX_DEVICES,
  );
  const sequence = Math.floor(Math.random() * 256);
  const found = new Map<string, LifxCandidate>();
  const { promise, resolve, reject } = Promise.withResolvers<LifxCandidate[]>();
  const socket = options.createSocket();
  let finished = false;
  const finish = (error?: Error) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    socket.close();
    if (error) reject(error);
    else resolve([...found.values()]);
  };
  const onAbort = () => finish(new Error("LIFX discovery aborted"));
  const timer = setTimeout(() => finish(), waitMs);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  socket.on("error", (error) => finish(error));
  socket.on("message", (message, from) => {
    if (finished || found.size >= max || !isLocalUnicastIPv4(from.address)) return;
    const answer = parseLifxStateService(Uint8Array.from(message), {
      source: LIFX_SOURCE,
      sequence,
    });
    if (!answer || found.has(answer.mac)) return;
    if (answer.port !== LIFX_PORT && !from.address.startsWith("127.")) return;
    found.set(answer.mac, { mac: answer.mac, address: from.address, port: answer.port });
    if (found.size >= max) finish();
  });
  // Bound to an ephemeral port so answers come back to this socket and nowhere else.
  socket.bind(0, () => {
    try {
      socket.setBroadcast(true);
      socket.send(lifxGetService(sequence), targetPort, broadcast, (error) => {
        if (error) finish(error);
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error("LIFX discovery failed"));
    }
  });
  return promise;
}

/** The production socket: a plain UDP4 socket, which has exactly the methods discovery uses. */
export const nodeDiscoverySocket = (): DiscoverySocket => createSocket("udp4");
