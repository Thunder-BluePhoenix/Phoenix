// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// LIFX discovery against a fake socket (no real network) and one real loopback UDP responder.
import { createSocket } from "node:dgram";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { LIFX_SOURCE, lifxStateService, readLifxHeader } from "@phoenix/capability-status-lights";
import { describe, expect, it } from "vitest";
import {
  discoverLifx,
  LIFX_DISCOVERY_MAX_DEVICES,
  validBroadcastTarget,
  type DiscoverySocket,
} from "../src/status-lights/lifx-discovery";

type Listener = (message: Uint8Array, from: { address: string; port: number }) => void;

class FakeSocket implements DiscoverySocket {
  sent: { message: Uint8Array; port: number; address: string }[] = [];
  broadcast = false;
  closed = 0;
  private message: Listener = () => {};
  private error: (e: Error) => void = () => {};
  /** Called after the broadcast went out: the lights "answer". */
  onSend: (reply: Listener, sentSequence: number) => void = () => {};
  bind(_port: number, callback: () => void) {
    queueMicrotask(callback);
  }
  setBroadcast(flag: boolean) {
    this.broadcast = flag;
  }
  send(
    message: Uint8Array,
    port: number,
    address: string,
    callback: (error: Error | null) => void,
  ) {
    this.sent.push({ message, port, address });
    callback(null);
    this.onSend(this.message, readLifxHeader(message)!.sequence);
  }
  on(event: "message" | "error", listener: any) {
    if (event === "message") this.message = listener;
    else this.error = listener;
    return this;
  }
  fail(e: Error) {
    this.error(e);
  }
  close() {
    this.closed++;
  }
}

const answer = (mac: string, seq: number, port = 56_700) =>
  lifxStateService(mac, port, LIFX_SOURCE, seq);

describe("LIFX discovery", () => {
  it("broadcasts one tagged GetService to port 56700 and collects StateService answers", async () => {
    const socket = new FakeSocket();
    socket.onSend = (reply, seq) => {
      reply(answer("d073d5000001", seq), { address: "192.168.1.20", port: 56_700 });
      reply(answer("d073d5000002", seq), { address: "192.168.1.21", port: 56_700 });
      // a duplicate answer, and an answer to somebody else's datagram
      reply(answer("d073d5000001", seq), { address: "192.168.1.20", port: 56_700 });
      reply(answer("d073d5000003", (seq + 1) & 255), { address: "192.168.1.22", port: 56_700 });
    };
    const found = await discoverLifx({ createSocket: () => socket, waitMs: 20 });
    expect(found).toEqual([
      { mac: "d073d5000001", address: "192.168.1.20", port: 56_700 },
      { mac: "d073d5000002", address: "192.168.1.21", port: 56_700 },
    ]);
    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]).toMatchObject({ port: 56_700, address: "255.255.255.255" });
    expect(readLifxHeader(socket.sent[0]!.message)).toMatchObject({ type: 2, tagged: true });
    expect(socket.broadcast).toBe(true);
    expect(socket.closed).toBe(1);
  });

  it("collects at most N devices and stops waiting once it has them", async () => {
    const socket = new FakeSocket();
    socket.onSend = (reply, seq) => {
      for (let i = 0; i < 40; i++)
        reply(answer(`d073d5${i.toString(16).padStart(6, "0")}`, seq), {
          address: `192.168.1.${10 + i}`,
          port: 56_700,
        });
    };
    const started = Date.now();
    const found = await discoverLifx({
      createSocket: () => socket,
      waitMs: 4_000,
      maxDevices: 3,
    });
    expect(found).toHaveLength(3);
    expect(Date.now() - started).toBeLessThan(1_000);
    const capped = new FakeSocket();
    capped.onSend = socket.onSend;
    expect(
      await discoverLifx({ createSocket: () => capped, waitMs: 20, maxDevices: 1_000 }),
    ).toHaveLength(LIFX_DISCOVERY_MAX_DEVICES);
  });

  it("ignores answers from outside the owner's network, broadcast sources and odd ports", async () => {
    const socket = new FakeSocket();
    socket.onSend = (reply, seq) => {
      reply(answer("d073d5000001", seq), { address: "8.8.8.8", port: 56_700 });
      reply(answer("d073d5000002", seq), { address: "192.168.1.255", port: 56_700 });
      reply(answer("d073d5000003", seq, 1234), { address: "192.168.1.30", port: 56_700 });
      reply(new Uint8Array(5), { address: "192.168.1.31", port: 56_700 });
      reply(answer("d073d5000004", seq), { address: "10.0.0.4", port: 56_700 });
    };
    expect(await discoverLifx({ createSocket: () => socket, waitMs: 20 })).toEqual([
      { mac: "d073d5000004", address: "10.0.0.4", port: 56_700 },
    ]);
  });

  it("waits for a bounded time and returns nothing when no light answers", async () => {
    const socket = new FakeSocket();
    const started = Date.now();
    expect(await discoverLifx({ createSocket: () => socket, waitMs: 30 })).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(socket.closed).toBe(1);
  });

  it("refuses a public broadcast target and sends nothing", async () => {
    const socket = new FakeSocket();
    await expect(
      discoverLifx({ createSocket: () => socket, broadcast: "8.8.8.8" }),
    ).rejects.toThrow("own network");
    expect(socket.sent).toEqual([]);
    expect(validBroadcastTarget("192.168.1.255")).toBe(true);
    expect(validBroadcastTarget("255.255.255.255")).toBe(true);
    expect(validBroadcastTarget("lifx.example.com")).toBe(false);
    expect(validBroadcastTarget("1.2.3.4")).toBe(false);
  });

  it("rejects and closes when the socket fails or the caller aborts", async () => {
    const socket = new FakeSocket();
    const pending = discoverLifx({ createSocket: () => socket, waitMs: 4_000 });
    socket.fail(new Error("boom"));
    await expect(pending).rejects.toThrow("boom");
    expect(socket.closed).toBe(1);
    const controller = new AbortController();
    const other = new FakeSocket();
    const aborted = discoverLifx({
      createSocket: () => other,
      waitMs: 4_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(aborted).rejects.toThrow("aborted");
  });

  it("works over a real UDP socket against a loopback responder", async () => {
    const light = createSocket("udp4");
    light.on("message", (message, from) => {
      const header = readLifxHeader(Uint8Array.from(message))!;
      light.send(
        answer("d073d5aabbcc", header.sequence, light.address().port),
        from.port,
        from.address,
      );
    });
    light.bind(0, "127.0.0.1");
    await once(light, "listening");
    try {
      const found = await discoverLifx({
        createSocket: () => createSocket("udp4"),
        broadcast: "127.0.0.1",
        port: (light.address() as AddressInfo).port,
        waitMs: 300,
      });
      expect(found).toEqual([
        { mac: "d073d5aabbcc", address: "127.0.0.1", port: (light.address() as AddressInfo).port },
      ]);
    } finally {
      light.close();
    }
  });
});
