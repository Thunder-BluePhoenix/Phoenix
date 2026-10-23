// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The LIFX transport against a fake light on a real loopback UDP socket. No real LIFX hardware.
import { afterEach, describe, expect, it } from "vitest";
import {
  COLORS,
  hsbkFor,
  lifxSetColor,
  lifxSetLightPower,
  setDevice,
  type Device,
} from "@phoenix/capability-status-lights";
import { isLocalUnicastIPv4 } from "../src/status-lights/lan-address";
import { lifxTransport, LIFX_MIN_INTERVAL_MS } from "../src/status-lights/lifx-transport";
import { fakeLifx, until, type FakeLifx } from "./fake-lifx";

const lights: FakeLifx[] = [];
afterEach(async () => {
  for (const light of lights.splice(0)) await light.close();
});

async function light(): Promise<FakeLifx> {
  const l = await fakeLifx();
  lights.push(l);
  return l;
}

const signal = () => new AbortController().signal;
const target = (l: FakeLifx) => ({ address: "127.0.0.1", port: l.port, mac: l.mac });
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("LIFX transport against a fake light on loopback", () => {
  it("sends exactly one SetColor datagram with the documented bytes and resolves on the acknowledgement", async () => {
    const l = await light();
    const transport = lifxTransport(target(l), { minIntervalMs: 0 });
    const frame = lifxSetColor(l.mac, hsbkFor(COLORS.ERROR, 35));
    await transport.report(frame, signal());
    expect(l.received).toHaveLength(1);
    // The transport only stamps the sequence number (byte 23); everything else is the built frame.
    const expected = Uint8Array.from(frame);
    expected[23] = 0;
    expect(hex(l.received[0]!.bytes)).toBe(hex(expected));
    expect(l.received[0]!.bytes).toHaveLength(49);
    expect(l.received[0]!.bytes[22]).toBe(0b10); // ack_required only
    expect(l.received[0]!.bytes[3]! & 0x20).toBe(0); // not tagged: addressed to one device
  });

  it("sends SetLightPower the same way and advances the sequence, wrapping at 255", async () => {
    const l = await light();
    const transport = lifxTransport(target(l), { minIntervalMs: 0 });
    for (let i = 0; i < 258; i++)
      await transport.report(lifxSetLightPower(l.mac, i % 2 === 0), signal());
    expect(l.received).toHaveLength(258);
    expect(l.received.slice(0, 3).map((r) => r.bytes[23])).toEqual([0, 1, 2]);
    expect(l.received[255]!.bytes[23]).toBe(255);
    expect(l.received[256]!.bytes[23]).toBe(0);
    expect(new DataView(l.received[0]!.bytes.buffer).getUint16(32, true)).toBe(117);
  });

  it("is what setDevice sends for a state: colour then power on, or power off for IDLE", async () => {
    const l = await light();
    const device: Device = {
      id: "desk",
      kind: "lifx",
      mac: l.mac,
      transport: lifxTransport(target(l), { minIntervalMs: 0 }),
    };
    await setDevice(device, "WAITING", signal());
    await setDevice(device, "IDLE", signal());
    const types = l.received.map((r) => new DataView(r.bytes.buffer).getUint16(32, true));
    expect(types).toEqual([102, 117, 117]);
    expect(l.received.map((r) => r.bytes.length)).toEqual([49, 42, 42]);
    expect(l.received[1]!.bytes[36]).toBe(0xff); // power on
    expect(l.received[2]!.bytes[36]).toBe(0); // power off
  });

  it("fails when the light does not acknowledge, within the timeout, without retrying", async () => {
    const l = await light();
    l.mode = "silent";
    const transport = lifxTransport(target(l), { ackTimeoutMs: 150, minIntervalMs: 0 });
    const started = Date.now();
    await expect(transport.report(lifxSetLightPower(l.mac, true), signal())).rejects.toThrow(
      "did not acknowledge",
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    // A real UDP socket and an absence of traffic: there is no event to await, so wait a bounded 300 ms.
    await new Promise((r) => setTimeout(r, 300));
    expect(l.received).toHaveLength(1); // one datagram, never re-sent
  });

  it.each(["wrong-sequence", "wrong-device"] as const)(
    "does not accept %s as the acknowledgement",
    async (mode) => {
      const l = await light();
      l.mode = mode;
      const transport = lifxTransport(target(l), { ackTimeoutMs: 150, minIntervalMs: 0 });
      await expect(transport.report(lifxSetLightPower(l.mac, true), signal())).rejects.toThrow(
        "did not acknowledge",
      );
    },
  );

  it("ignores an acknowledgement that does not come from the provisioned address and port", async () => {
    const l = await light();
    l.mode = "other-port"; // a perfect ack, sent from a different socket
    const transport = lifxTransport(target(l), { ackTimeoutMs: 200, minIntervalMs: 0 });
    await expect(transport.report(lifxSetLightPower(l.mac, true), signal())).rejects.toThrow(
      "did not acknowledge",
    );
  });

  it("aborts at once when the controller cancels the write, and closes its socket", async () => {
    const l = await light();
    l.mode = "silent";
    const transport = lifxTransport(target(l), { ackTimeoutMs: 5_000, minIntervalMs: 0 });
    const ctrl = new AbortController();
    const pending = transport.report(lifxSetLightPower(l.mac, true), ctrl.signal);
    await until(() => l.received.length === 1);
    ctrl.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    const already = new AbortController();
    already.abort(new Error("gone"));
    await expect(transport.report(lifxSetLightPower(l.mac, true), already.signal)).rejects.toThrow(
      "gone",
    );
    expect(l.received).toHaveLength(1);
  });

  it("rate limits: datagrams to one light are at least the minimum interval apart", async () => {
    const l = await light();
    const transport = lifxTransport(target(l), { minIntervalMs: 120 });
    await Promise.all(
      [true, false, true, false].map((on) =>
        transport.report(lifxSetLightPower(l.mac, on), signal()),
      ),
    );
    const gaps = l.received.slice(1).map((r, i) => r.at - l.received[i]!.at);
    expect(l.received).toHaveLength(4);
    // 10 ms of slack for timer and scheduler jitter.
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(110);
  });

  it("the default pace keeps a light under three changes a second", () => {
    expect(LIFX_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(250);
  });

  it("refuses anything that is not a command Phoenix built for this very light", async () => {
    const l = await light();
    const transport = lifxTransport(target(l), { minIntervalMs: 0 });
    await expect(transport.report(new Uint8Array(49), signal())).rejects.toThrow("Not a LIFX");
    await expect(transport.report(Uint8Array.of(1, 2, 3), signal())).rejects.toThrow("Not a LIFX");
    await expect(
      transport.report(lifxSetLightPower("d073d5aabbcc", true), signal()),
    ).rejects.toThrow("Not a LIFX"); // another device's serial
    const tagged = Uint8Array.from(lifxSetLightPower(l.mac, true));
    tagged[3] = tagged[3]! | 0x20;
    await expect(transport.report(tagged, signal())).rejects.toThrow("Not a LIFX");
    await expect(transport.request("/x", {}, signal())).rejects.toThrow("not a request device");
    expect(l.received).toEqual([]);
  });

  it.each([
    "8.8.8.8",
    "192.169.1.1",
    "example.com",
    "localhost",
    "255.255.255.255",
    "192.168.1.255",
    "10.0.0.0",
    "10.255.255.255",
    "169.254.255.255",
    "224.0.0.1",
    "0.0.0.0",
    "::1",
    "127.0.0.1:56700",
    "",
  ])("is not built for the address %j", (address) => {
    expect(() => lifxTransport({ address, mac: "d073d5012345" })).toThrow("unicast IPv4");
  });

  it.each(["", "d073d501234", "ffffffffffff", "000000000000"])(
    "is not built for the serial %j",
    (mac) => {
      expect(() => lifxTransport({ address: "192.168.1.9", mac })).toThrow("serial");
    },
  );

  it.each([0, -1, 65_536, 1.5])("is not built for the port %j", (port) => {
    expect(() => lifxTransport({ address: "192.168.1.9", mac: "d073d5012345", port })).toThrow(
      "port",
    );
  });

  it("classifies unicast LAN addresses", () => {
    for (const a of ["10.0.0.1", "192.168.1.20", "172.16.5.4", "169.254.1.1", "127.0.0.1"])
      expect(isLocalUnicastIPv4(a)).toBe(true);
    for (const a of ["192.168.1.255", "10.0.0.0", "8.8.8.8", "255.255.255.255", "host"])
      expect(isLocalUnicastIPv4(a)).toBe(false);
  });
});
