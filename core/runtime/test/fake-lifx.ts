// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A pretend LIFX light: a real UDP socket bound to loopback that records each datagram it gets and
// answers with an Acknowledgement (45) the way the LAN protocol describes. No real light is involved.
import { createSocket, type Socket } from "node:dgram";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { lifxAcknowledgement, readLifxHeader } from "@phoenix/capability-status-lights";

export interface Received {
  bytes: Uint8Array;
  at: number;
  from: { address: string; port: number };
}

export type AckMode = "ack" | "silent" | "wrong-sequence" | "wrong-device" | "other-port";

export interface FakeLifx {
  port: number;
  mac: string;
  received: Received[];
  mode: AckMode;
  close(): Promise<void>;
}

export async function fakeLifx(mac = "d073d5012345"): Promise<FakeLifx> {
  const socket: Socket = createSocket("udp4");
  // Answers from a different source port than the one the transport was provisioned with.
  const rogue: Socket = createSocket("udp4");
  rogue.bind(0, "127.0.0.1");
  await once(rogue, "listening");
  const light: FakeLifx = {
    port: 0,
    mac,
    received: [],
    mode: "ack",
    async close() {
      const closed = [once(socket, "close"), once(rogue, "close")];
      socket.close();
      rogue.close();
      await Promise.all(closed);
    },
  };
  socket.on("message", (message, from) => {
    const bytes = Uint8Array.from(message);
    light.received.push({
      bytes,
      at: Date.now(),
      from: { address: from.address, port: from.port },
    });
    const header = readLifxHeader(bytes);
    if (!header || !header.ackRequired || light.mode === "silent") return;
    const ack = lifxAcknowledgement(
      light.mode === "wrong-device" ? "d073d5ffffee" : mac,
      header.source,
      light.mode === "wrong-sequence" ? (header.sequence + 1) & 0xff : header.sequence,
    );
    (light.mode === "other-port" ? rogue : socket).send(ack, from.port, from.address);
  });
  socket.bind(0, "127.0.0.1");
  await once(socket, "listening");
  light.port = (socket.address() as AddressInfo).port;
  return light;
}

/**
 * Polls until `done`. LIFX writes are paced by real time (the pacing is what is under test), so
 * there is no event to await across the whole chain of datagrams; the poll is bounded.
 */
export async function until(done: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  if (!done()) throw new Error("condition not reached in time");
}
