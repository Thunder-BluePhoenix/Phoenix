// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What each kind of light is sent for each state. Simulated: a recording transport, no device.
import { describe, expect, it } from "vitest";
import {
  COLORS,
  hsbkFor,
  lifxSetColor,
  lifxSetLightPower,
  setDevice,
  type Device,
  type LightState,
} from "../src";
import { FakeTransport, HUE_RESOURCE } from "../testing/fakes";

const signal = new AbortController().signal;
const STATES = Object.keys(COLORS) as LightState[];

function make(kind: Device["kind"], resource?: string, mac?: string) {
  const transport = new FakeTransport();
  const device: Device = {
    id: "d",
    kind,
    transport,
    ...(resource ? { resource } : {}),
    ...(mac ? { mac } : {}),
  };
  return { transport, device };
}

describe("colour table", () => {
  it("red is reserved for ERROR and RECORDING; IDLE is dark; every state is distinct", () => {
    expect(COLORS.IDLE).toEqual([0, 0, 0]);
    expect(COLORS.RECORDING).toEqual([255, 0, 0]);
    expect(new Set(STATES.map((s) => COLORS[s].join(","))).size).toBe(STATES.length);
  });
});

describe("Philips Hue", () => {
  it("sets an xy colour at full brightness, addressed by the provisioned light resource", async () => {
    const { transport, device } = make("hue", HUE_RESOURCE);
    await setDevice(device, "RECORDING", signal);
    const sent = transport.sent[0];
    expect(sent).toMatchObject({
      via: "request",
      path: `/clip/v2/resource/light/${HUE_RESOURCE}`,
    });
    const body = sent?.via === "request" ? sent.body : {};
    expect(body).toMatchObject({ on: { on: true }, dimming: { brightness: 100 } });
    const xy = (body as { color: { xy: { x: number; y: number } } }).color.xy;
    expect(xy.x).toBeGreaterThan(0.6); // red corner of the gamut
    expect(xy.y).toBeLessThan(0.35);
  });

  it("turns off for IDLE instead of sending a black colour", async () => {
    const { transport, device } = make("hue", HUE_RESOURCE);
    await setDevice(device, "IDLE", signal);
    expect(transport.sent[0]).toMatchObject({ body: { on: { on: false } } });
  });

  it.each([undefined, "", "../../config", "not-a-uuid", `${HUE_RESOURCE}/../x`])(
    "refuses a light resource that is not a plain id (%s) and sends nothing",
    async (resource) => {
      const { transport, device } = make("hue", resource);
      await expect(setDevice(device, "WORKING", signal)).rejects.toThrow("Invalid Hue");
      expect(transport.sent).toEqual([]);
    },
  );
});

describe("Luxafor", () => {
  it.each(STATES)("writes the fixed colour report for %s", async (state) => {
    const { transport, device } = make("luxafor");
    await setDevice(device, state, signal);
    const sent = transport.sent[0];
    expect(sent?.via).toBe("report");
    expect([...(sent?.via === "report" ? sent.bytes : [])]).toEqual([
      1,
      0xff,
      ...COLORS[state],
      0,
      0,
      0,
    ]);
  });
});

describe("LIFX", () => {
  const mac = "d073d5012345";
  const types = (transport: FakeTransport) =>
    transport.sent.map((s) => {
      const bytes = s.via === "report" ? s.bytes : new Uint8Array(0);
      return new DataView(bytes.buffer, bytes.byteOffset).getUint16(32, true);
    });

  it("is sent through the report channel: colour (102), then power on (117)", async () => {
    const { transport, device } = make("lifx", undefined, mac);
    await setDevice(device, "ERROR", signal);
    expect(transport.sent.every((s) => s.via === "report")).toBe(true);
    expect(types(transport)).toEqual([102, 117]);
    const [colour, power] = transport.sent.map((s) => (s.via === "report" ? s.bytes : undefined));
    expect([...colour!]).toEqual([...lifxSetColor(mac, hsbkFor(COLORS.ERROR, 35))]);
    expect([...power!]).toEqual([...lifxSetLightPower(mac, true)]);
  });

  it("is only power off for IDLE", async () => {
    const { transport, device } = make("lifx", undefined, mac);
    await setDevice(device, "IDLE", signal);
    expect(types(transport)).toEqual([117]);
    const sent = transport.sent[0];
    expect([...(sent?.via === "report" ? sent.bytes : [])]).toEqual([
      ...lifxSetLightPower(mac, false),
    ]);
  });

  it("uses the Key Light brightness: dim for WORKING, full for RECORDING", async () => {
    const levels: number[] = [];
    for (const state of ["WORKING", "RECORDING"] as const) {
      const { transport, device } = make("lifx", undefined, mac);
      await setDevice(device, state, signal);
      const sent = transport.sent[0];
      const bytes = sent?.via === "report" ? sent.bytes : new Uint8Array(49);
      levels.push(new DataView(bytes.buffer, bytes.byteOffset).getUint16(41, true));
    }
    expect(levels).toEqual([Math.round(0.35 * 65535), 65535]);
  });

  it.each([undefined, "", "not-a-serial", "000000000000"])(
    "refuses a device serial that is not valid (%s) and sends nothing",
    async (badMac) => {
      const { transport, device } = make("lifx", undefined, badMac);
      await expect(setDevice(device, "ERROR", signal)).rejects.toThrow("serial");
      expect(transport.sent).toEqual([]);
    },
  );
});

describe("Elgato Key Light", () => {
  it("is white only: off when IDLE, dim when WORKING, bright when RECORDING", async () => {
    const levels: Record<string, { on: number; brightness: number }> = {};
    for (const state of ["IDLE", "WORKING", "RECORDING"] as const) {
      const { transport, device } = make("key-light");
      await setDevice(device, state, signal);
      const sent = transport.sent[0];
      expect(sent).toMatchObject({ via: "request", path: "/elgato/lights" });
      const lights = (sent?.via === "request" ? sent.body.lights : []) as {
        on: number;
        brightness: number;
        hue?: number;
      }[];
      expect(lights[0]).not.toHaveProperty("hue");
      levels[state] = lights[0]!;
    }
    expect(levels.IDLE?.on).toBe(0);
    expect(levels.WORKING).toMatchObject({ on: 1, brightness: 35 });
    expect(levels.RECORDING).toMatchObject({ on: 1, brightness: 100 });
  });
});
