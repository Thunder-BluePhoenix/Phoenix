// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { ScopedCaptureSession, type CaptureDriver } from "../src";

describe("scoped capture", () => {
  it("denies before opening hardware and fails without a capture driver", async () => {
    let starts = 0;
    const driver: CaptureDriver = {
      async start() {
        starts++;
        throw new Error("opened");
      },
    };
    const denied = new ScopedCaptureSession({
      capabilityId: "speech",
      agentId: "a",
      kind: "microphone",
      maxDurationMs: 1000,
      authorization: {
        async authorize() {
          return false;
        },
      },
      driver,
    });
    await expect(denied.start()).rejects.toThrow(/denied/);
    expect(starts).toBe(0);
    const absent = new ScopedCaptureSession({
      capabilityId: "vision",
      agentId: "a",
      kind: "screen",
      maxDurationMs: 1000,
      authorization: {
        async authorize() {
          return true;
        },
      },
    });
    await expect(absent.start()).rejects.toThrow(/unavailable/);
  });

  it("limits input to its agent, stops hardware and deletes bytes immediately", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    let stops = 0;
    const session = new ScopedCaptureSession({
      capabilityId: "vision",
      agentId: "one",
      kind: "screen",
      maxDurationMs: 1000,
      authorization: {
        async authorize(capability, agent, kind) {
          expect([capability, agent, kind]).toEqual(["vision", "one", "screen"]);
          return true;
        },
      },
      driver: {
        async start() {
          return {
            async read() {
              return bytes;
            },
            stop() {
              stops++;
            },
          };
        },
      },
    });
    await session.start();
    await expect(session.readFor("other")).rejects.toThrow(/another agent/);
    expect(await session.readFor("one")).toBe(bytes);
    session.stop();
    session.stop();
    expect(bytes).toEqual(new Uint8Array(3));
    expect(stops).toBe(1);
    await expect(session.readFor("one")).rejects.toThrow(/not active/);
  });

  it("stops a late device grant without activating capture", async () => {
    const gate = Promise.withResolvers<void>();
    let stops = 0;
    const session = new ScopedCaptureSession({
      capabilityId: "vision",
      agentId: "one",
      kind: "screen",
      maxDurationMs: 1000,
      authorization: {
        async authorize() {
          return true;
        },
      },
      driver: {
        async start() {
          await gate.promise;
          return {
            async read() {
              return new Uint8Array(0);
            },
            stop() {
              stops++;
            },
          };
        },
      },
    });
    const pending = session.start();
    await Promise.resolve();
    session.stop();
    gate.resolve();
    await expect(pending).rejects.toThrow(/stopped/);
    expect(stops).toBe(1);
  });
});
