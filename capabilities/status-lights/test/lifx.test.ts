// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The LIFX LAN frames, byte for byte against the layout in https://lan.developer.lifx.com
// (packet-contents, changing-a-device). Pure builders: no socket is opened here.
import { describe, expect, it } from "vitest";
import {
  COLORS,
  LIFX_SOURCE,
  hsbkFor,
  isLifxAcknowledgement,
  lifxAcknowledgement,
  lifxCommandHeader,
  lifxSetColor,
  lifxSetLightPower,
  parseLifxMac,
  readLifxHeader,
} from "../src";

const MAC = "d073d5012345";
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("LIFX SetColor (102)", () => {
  it("is exactly the documented 49 byte little-endian layout", () => {
    const frame = lifxSetColor(
      MAC,
      { hue: 0x1234, saturation: 0xffff, brightness: 0x8000, kelvin: 3500 },
      0x100,
      7,
    );
    expect(hex(frame)).toBe(
      [
        "3100", // size 49
        "0014", // protocol 1024 | addressable, tagged 0, origin 0 (0x1400 LE)
        "58485000", // source
        "d073d5012345" + "0000", // target serial, then two zero bytes
        "000000000000", // reserved
        "02", // ack_required, res_required clear
        "07", // sequence
        "0000000000000000", // reserved
        "6600", // type 102
        "0000", // reserved
        "00", // payload reserved
        "3412", // hue
        "ffff", // saturation
        "0080", // brightness
        "ac0d", // kelvin 3500
        "00010000", // duration 256 ms
      ].join(""),
    );
  });

  it("defaults to an instant transition and sequence 0", () => {
    const frame = lifxSetColor(MAC, hsbkFor(COLORS.ERROR, 35));
    expect(frame).toHaveLength(49);
    expect(new DataView(frame.buffer).getUint32(45, true)).toBe(0);
    expect(frame[23]).toBe(0);
  });

  it("is a command the transport accepts, addressed to one device and never tagged", () => {
    expect(lifxCommandHeader(lifxSetColor(MAC, hsbkFor(COLORS.WORKING, 35)))).toEqual({
      type: 102,
      source: LIFX_SOURCE,
      sequence: 0,
      target: MAC,
      tagged: false,
      ackRequired: true,
    });
  });
});

describe("LIFX SetLightPower (117)", () => {
  it("is exactly the documented 42 byte layout, on and off", () => {
    expect(hex(lifxSetLightPower(MAC, true, 500, 255))).toBe(
      [
        "2a00",
        "0014",
        "58485000",
        "d073d5012345" + "0000",
        "000000000000",
        "02",
        "ff",
        "0000000000000000",
        "7500", // type 117
        "0000",
        "ffff", // level on
        "f4010000", // duration 500 ms
      ].join(""),
    );
    const off = lifxSetLightPower(MAC, false);
    expect(hex(off.subarray(36))).toBe("000000000000");
    expect(off).toHaveLength(42);
  });
});

describe("LIFX header checks", () => {
  it("refuses a bad serial or sequence instead of building a frame", () => {
    for (const mac of ["", "d073d501234", "d073d50123456", "zz73d5012345", "000000000000"])
      expect(() => lifxSetLightPower(mac, true)).toThrow("serial");
    expect(() => lifxSetLightPower(MAC, true, 0, 256)).toThrow("sequence");
    expect(() => lifxSetLightPower(MAC, true, 0, -1)).toThrow("sequence");
  });

  it("only passes the two commands Phoenix builds", () => {
    const good = lifxSetColor(MAC, hsbkFor(COLORS.WAITING, 35));
    expect(lifxCommandHeader(good)).not.toBeNull();
    const tagged = Uint8Array.from(good);
    tagged[3] = tagged[3]! | 0x20; // tagged: a broadcast-style frame
    const broadcast = Uint8Array.from(good);
    broadcast.fill(0, 8, 14); // target 0: every device
    const noAck = Uint8Array.from(good);
    noAck[22] = 0;
    const reserved = Uint8Array.from(good);
    reserved[30] = 1;
    const otherType = Uint8Array.from(good);
    otherType[32] = 21; // SetPower: not one we build
    const wrongSource = Uint8Array.from(good);
    wrongSource[4] = 1;
    const wrongSize = Uint8Array.from(good).subarray(0, 48);
    for (const bad of [tagged, broadcast, noAck, reserved, otherType, wrongSource, wrongSize])
      expect(lifxCommandHeader(bad)).toBeNull();
    expect(lifxCommandHeader(new Uint8Array(10))).toBeNull();
  });

  it("reads and matches an Acknowledgement (45) by source, sequence and device", () => {
    const ack = lifxAcknowledgement(MAC, LIFX_SOURCE, 9);
    expect(ack).toHaveLength(36);
    expect(readLifxHeader(ack)).toMatchObject({ type: 45, sequence: 9, target: MAC });
    const want = { source: LIFX_SOURCE, sequence: 9, target: MAC };
    expect(isLifxAcknowledgement(ack, want)).toBe(true);
    expect(isLifxAcknowledgement(ack, { ...want, sequence: 10 })).toBe(false);
    expect(isLifxAcknowledgement(ack, { ...want, source: 2 })).toBe(false);
    expect(isLifxAcknowledgement(ack, { ...want, target: "d073d5ffffff" })).toBe(false);
    expect(isLifxAcknowledgement(lifxSetLightPower(MAC, true, 0, 9), want)).toBe(false);
    expect(isLifxAcknowledgement(new Uint8Array(3), want)).toBe(false);
  });
});

describe("LIFX serial", () => {
  it("accepts 12 hex digits or colon pairs and normalises case", () => {
    expect(parseLifxMac("D0:73:D5:01:23:45")).toBe(MAC);
    expect(parseLifxMac("D073D5012345")).toBe(MAC);
  });

  it.each([
    undefined,
    42,
    "",
    "d073d501234",
    "d073d50123456",
    "d0:73:d5:01:23",
    "d0:73:d5:01:23:4",
    "d073d5-012345",
    "d073d5012345\n",
    "000000000000",
    "ffffffffffff",
    "00:00:00:00:00:00",
  ])("refuses %j", (value) => {
    expect(parseLifxMac(value)).toBeNull();
  });
});

describe("LIFX colour mapping", () => {
  it("uses the Key Light brightness: 35% lit, 100% while recording", () => {
    expect(hsbkFor(COLORS.WORKING, 35).brightness).toBe(Math.round(0.35 * 65535));
    expect(hsbkFor(COLORS.RECORDING, 100)).toEqual({
      hue: 0,
      saturation: 65535,
      brightness: 65535,
      kelvin: 3500,
    });
  });

  it("maps the states to their hues; black has no saturation", () => {
    const degrees = (rgb: readonly [number, number, number]) =>
      (hsbkFor(rgb, 100).hue / 65535) * 360;
    expect(degrees(COLORS.WORKING)).toBeGreaterThan(200);
    expect(degrees(COLORS.WORKING)).toBeLessThan(235);
    expect(degrees(COLORS.WAITING)).toBeGreaterThan(35);
    expect(degrees(COLORS.WAITING)).toBeLessThan(45);
    expect(degrees(COLORS.ERROR)).toBeLessThan(10);
    expect(hsbkFor(COLORS.IDLE, 35)).toMatchObject({ hue: 0, saturation: 0 });
  });
});
