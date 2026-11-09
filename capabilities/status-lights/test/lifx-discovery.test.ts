// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The LIFX discovery frames against https://lan.developer.lifx.com (GetService 2, StateService 3,
// tagged broadcast with an all-zero target). Pure builders and parsers: no socket is opened here.
import { describe, expect, it } from "vitest";
import {
  LIFX_SOURCE,
  lifxCommandHeader,
  lifxGetService,
  lifxStateService,
  parseLifxStateService,
  readLifxHeader,
} from "../src";

const MAC = "d073d5012345";
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const want = { source: LIFX_SOURCE, sequence: 7 };

describe("LIFX GetService (2)", () => {
  it("is the documented 36 byte tagged broadcast with an all-zero target", () => {
    expect(hex(lifxGetService(7))).toBe(
      [
        "2400", // size 36
        "0034", // protocol 1024 | addressable | tagged (0x3400 LE)
        "58485000", // source
        "0000000000000000", // target: every device
        "000000000000", // reserved
        "00", // neither ack_required nor res_required
        "07", // sequence
        "0000000000000000", // reserved
        "0200", // type 2
        "0000",
      ].join(""),
    );
  });

  it("is never accepted as a state command", () => {
    expect(readLifxHeader(lifxGetService())).toMatchObject({ type: 2, tagged: true });
    expect(lifxCommandHeader(lifxGetService())).toBeNull();
  });

  it("refuses a sequence outside a byte", () => {
    expect(() => lifxGetService(256)).toThrow("sequence");
  });
});

describe("LIFX StateService (3)", () => {
  it("reads the serial and UDP port of an answer to our own GetService", () => {
    const answer = lifxStateService(MAC, 56_700, LIFX_SOURCE, 7);
    expect(answer).toHaveLength(41);
    expect(parseLifxStateService(answer, want)).toEqual({ mac: MAC, port: 56_700 });
  });

  it("refuses another source or sequence, a wrong length, a non-UDP service and a bad port", () => {
    const good = lifxStateService(MAC, 56_700, LIFX_SOURCE, 7);
    expect(parseLifxStateService(good, { ...want, sequence: 8 })).toBeNull();
    expect(parseLifxStateService(good, { ...want, source: 2 })).toBeNull();
    expect(parseLifxStateService(good.subarray(0, 40), want)).toBeNull();
    expect(parseLifxStateService(new Uint8Array(3), want)).toBeNull();
    const tcp = Uint8Array.from(good);
    tcp[36] = 2;
    expect(parseLifxStateService(tcp, want)).toBeNull();
    expect(parseLifxStateService(lifxStateService(MAC, 0, LIFX_SOURCE, 7), want)).toBeNull();
    expect(parseLifxStateService(lifxStateService(MAC, 70_000, LIFX_SOURCE, 7), want)).toBeNull();
    const broadcast = Uint8Array.from(good);
    broadcast.fill(0, 8, 14);
    expect(parseLifxStateService(broadcast, want)).toBeNull();
  });
});
