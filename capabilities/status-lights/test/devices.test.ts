// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What each kind of light is sent for each state. Simulated: a recording transport, no device.
import { describe, expect, it } from "vitest";
import { COLORS, lifxSetColor, setDevice, type Device, type LightState } from "../src";
import { FakeTransport, HUE_RESOURCE } from "../testing/fakes";

const signal = new AbortController().signal;
const STATES = Object.keys(COLORS) as LightState[];

function make(kind: Device["kind"], resource?: string) {
  const transport = new FakeTransport();
  const device: Device = { id: "d", kind, transport, ...(resource ? { resource } : {}) };
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
  it("builds a 49 byte SetColor (102) frame whose size field matches", () => {
    const frame = lifxSetColor(COLORS.RECORDING);
    const view = new DataView(frame.buffer);
    expect(frame.length).toBe(49);
    expect(view.getUint16(0, true)).toBe(49);
    expect(view.getUint16(32, true)).toBe(102);
    expect(view.getUint16(37, true)).toBe(0); // hue: red
    expect(view.getUint16(39, true)).toBe(65535); // fully saturated
    expect(view.getUint16(41, true)).toBe(65535); // full brightness
  });

  it("maps blue to a blue hue and black to zero brightness", () => {
    const blue = new DataView(lifxSetColor(COLORS.WORKING).buffer);
    const hue = (blue.getUint16(37, true) / 65535) * 360;
    expect(hue).toBeGreaterThan(200);
    expect(hue).toBeLessThan(235);
    expect(new DataView(lifxSetColor(COLORS.IDLE).buffer).getUint16(41, true)).toBe(0);
  });

  it("is sent through the report channel", async () => {
    const { transport, device } = make("lifx");
    await setDevice(device, "ERROR", signal);
    expect(transport.sent[0]?.via).toBe("report");
  });
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
