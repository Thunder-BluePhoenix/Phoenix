// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// LIFX LAN transport: one unicast UDP datagram per command to a provisioned light, then wait for
// that light's Acknowledgement (45) so a light that is off, moved or unreachable is a failure the
// capability can report. A fresh connected socket per command: it only ever exchanges datagrams with
// the one provisioned address. No retries (the controller's newest-wins writer sends the next state
// instead) and a pause between datagrams so a burst of state changes can never strobe the light.
import { createSocket } from "node:dgram";
import {
  isLifxAcknowledgement,
  LIFX_PORT,
  lifxCommandHeader,
  parseLifxMac,
  type DeviceTransport,
} from "@phoenix/capability-status-lights";
import { isLocalUnicastIPv4 } from "./lan-address";

/** How long a light has to acknowledge a command. */
export const LIFX_ACK_TIMEOUT_MS = 2_000;
/**
 * The least time between two datagrams to one light. A state change is two datagrams (colour, then
 * power), so a light changes at most twice a second: below the three-flashes-per-second limit.
 */
export const LIFX_MIN_INTERVAL_MS = 250;

export interface LifxTarget {
  /** An IPv4 literal on a private, link-local or loopback range, never a hostname or broadcast. */
  address: string;
  /** Always {@link LIFX_PORT} on a real light; configurable for a fake one on loopback. */
  port?: number;
  /** The light's serial: 12 hex digits (or colon pairs). */
  mac: string;
}

export interface LifxTransportOptions {
  ackTimeoutMs?: number;
  minIntervalMs?: number;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  if (signal.aborted) {
    reject(signal.reason);
    return promise;
  }
  const onAbort = () => {
    clearTimeout(timer);
    reject(signal.reason);
  };
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  signal.addEventListener("abort", onAbort, { once: true });
  return promise;
}

export function lifxTransport(
  target: LifxTarget,
  options: LifxTransportOptions = {},
): DeviceTransport {
  const mac = parseLifxMac(target.mac);
  const port = target.port ?? LIFX_PORT;
  if (!isLocalUnicastIPv4(target.address))
    throw new Error("A LIFX light needs a unicast IPv4 address on your own network");
  if (!mac) throw new Error("Invalid LIFX device serial");
  const serial: string = mac;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid LIFX port");
  const ackTimeoutMs = options.ackTimeoutMs ?? LIFX_ACK_TIMEOUT_MS;
  const minIntervalMs = options.minIntervalMs ?? LIFX_MIN_INTERVAL_MS;
  let sequence = 0;
  let nextSlot = 0;

  /** Claims the next send slot synchronously, so concurrent callers queue instead of bursting. */
  async function pace(signal: AbortSignal): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + minIntervalMs;
    if (at > now) await delay(at - now, signal);
  }

  function exchange(frame: Uint8Array, source: number, seq: number, signal: AbortSignal) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const socket = createSocket("udp4");
    let closed = false;
    const finish = (error?: unknown) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      socket.close();
      if (error === undefined) resolve();
      else reject(error instanceof Error ? error : new Error("LIFX command aborted"));
    };
    const onAbort = () => finish(signal.reason);
    const timer = setTimeout(
      () => finish(new Error("LIFX light did not acknowledge")),
      ackTimeoutMs,
    );
    signal.addEventListener("abort", onAbort, { once: true });
    socket.on("error", (error) => finish(error));
    socket.on("message", (message, from) => {
      if (
        from.address === target.address &&
        from.port === port &&
        isLifxAcknowledgement(message, { source, sequence: seq, target: serial })
      )
        finish();
    });
    // A connected UDP socket sends to, and hears from, only this one address.
    socket.connect(port, target.address, () => {
      socket.send(frame, (error) => {
        if (error) finish(error);
      });
    });
    return promise;
  }

  return {
    request() {
      return Promise.reject(new Error("A LIFX light is not a request device"));
    },
    async report(bytes, signal) {
      const header = lifxCommandHeader(bytes);
      if (!header || header.target !== mac) throw new Error("Not a LIFX command for this light");
      signal.throwIfAborted();
      await pace(signal);
      signal.throwIfAborted();
      const frame = Uint8Array.from(bytes);
      const seq = sequence;
      sequence = (sequence + 1) & 0xff;
      frame[23] = seq;
      await exchange(frame, header.source, seq, signal);
    },
  };
}
