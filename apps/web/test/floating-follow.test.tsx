// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { POLL_MS, FRAME_MS, type FollowTimers } from "../src/floating/follow-driver";
import { FloatingApp } from "../src/floating/FloatingApp";
import type { FollowShell, PhysicalPoint, WindowPlace } from "../src/floating/follow-shell";
import type { DesktopShell } from "../src/floating/shell";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => cleanup());

/** Timers that fire only when the test advances the clock. */
class ManualTimers implements FollowTimers {
  private next = 1;
  private timers = new Map<number, { every: number; at: number; fn: () => void }>();
  private now = 0;
  setInterval(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.set(id, { every: ms, at: this.now + ms, fn });
    return id;
  }
  clearInterval(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  get active(): number {
    return this.timers.size;
  }
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.timers.values()]
        .filter((t) => t.at <= end)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.now = due.at;
      due.at += due.every;
      due.fn();
      await act(async () => {
        for (let i = 0; i < 20; i++) await Promise.resolve();
      });
    }
    this.now = end;
  }
}

interface World {
  followCursor: boolean;
  reducedMotion: "auto" | "on" | "off";
  quietMode: boolean;
  killSwitch: boolean;
}

function setup(world: Partial<World> = {}, withFollow = true) {
  const w: World = {
    followCursor: false,
    reducedMotion: "off",
    quietMode: false,
    killSwitch: false,
    ...world,
  };
  const timers = new ManualTimers();
  const place: { at: WindowPlace } = { at: { x: 100, y: 100, width: 192, height: 220, scale: 1 } };
  const reads = { cursor: 0, window: 0 };
  const cursor: { at: PhysicalPoint | null } = { at: { x: 900, y: 700 } };
  const moves: [number, number][] = [];
  const follow: FollowShell = {
    cursor: async () => {
      reads.cursor++;
      return cursor.at;
    },
    window: async () => {
      reads.window++;
      return place.at;
    },
    visible: async () => true,
    area: async () => ({ x: 0, y: 0, width: 3000, height: 2000 }),
  };
  const shell: DesktopShell = {
    connection: async () => ({ base_url: "http://127.0.0.1:4870", token: "tok" }),
    moveBy: (dx, dy) => {
      moves.push([dx, dy]);
      place.at = { ...place.at, x: place.at.x + Math.round(dx), y: place.at.y + Math.round(dy) };
    },
    dragEnded: () => {},
    openInPhoenix: () => {},
    showMenu: () => {},
  };
  const api = fakeApi({
    "GET /api/pet/settings": () => ({
      reduced_motion: w.reducedMotion,
      follow_cursor: w.followCursor,
    }),
    "GET /api/notifications/preferences": () => ({
      enabled: !w.quietMode,
      min_severity: "warning",
      muted_sources: [],
    }),
    "GET /api/proactive": () => ({
      preferences: { enabled: false, capabilities: [], quietHours: null },
    }),
    "GET /api/security/kill-switch": () => ({ engaged: w.killSwitch }),
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <FloatingApp shell={shell} follow={withFollow ? follow : null} followTimers={timers} />
    </CoreProvider>,
  );
  const ws = FakeWebSocket.last;
  act(() => ws.open());
  const state = (s: object) =>
    act(() => ws.message("state.changed", { recording: false, since: "", ...s }));
  const event = (seq: number, type: string, payload: object) =>
    act(() =>
      ws.message("event.created", {
        seq,
        event: {
          event_id: `evt_${seq}aaaaaa`,
          event_type: type,
          source: "core",
          severity: "info",
          timestamp: "2026-10-09T12:00:00Z",
          payload,
        },
      }),
    );
  return { w, timers, place, reads, cursor, moves, ws, state, event };
}

const settleFor = (ms: number) =>
  act(async () => void (await new Promise((r) => setTimeout(r, ms))));

describe("floating Fawkes follows the pointer (Phase 59)", () => {
  it("does nothing by default: no pointer reads, no timers, no moves", async () => {
    const t = setup();
    await settleFor(60);
    await t.timers.advance(5_000);
    expect(t.reads).toEqual({ cursor: 0, window: 0 });
    expect(t.timers.active).toBe(0);
    expect(t.moves).toEqual([]);
  });

  it("follows the pointer once the user has opted in", async () => {
    const t = setup({ followCursor: true });
    await waitFor(() => expect(t.timers.active).toBeGreaterThan(0));
    await t.timers.advance(POLL_MS * 3 + FRAME_MS * 5);
    await waitFor(() => expect(t.moves.length).toBeGreaterThan(0));
    expect(t.place.at.x).toBeGreaterThan(800);
  });

  it("is stationary in a browser (no desktop shell to read the pointer from)", async () => {
    const t = setup({ followCursor: true }, false);
    await settleFor(60);
    await t.timers.advance(5_000);
    expect(t.moves).toEqual([]);
    expect(t.reads).toEqual({ cursor: 0, window: 0 });
  });

  it.each([
    ["quiet mode", { quietMode: true }],
    ["the emergency stop", { killSwitch: true }],
  ])("stays where it is during %s", async (_name, world) => {
    const t = setup({ followCursor: true, ...world });
    await settleFor(80);
    await t.timers.advance(POLL_MS * 20 + FRAME_MS * 20);
    expect(t.moves).toEqual([]);
    expect(t.reads.cursor).toBe(0);
  });

  it("stops at once when the emergency stop is engaged while following", async () => {
    const t = setup({ followCursor: true });
    await waitFor(() => expect(t.timers.active).toBeGreaterThan(0));
    await t.timers.advance(POLL_MS * 3 + FRAME_MS * 3);
    await waitFor(() => expect(t.moves.length).toBeGreaterThan(0));
    t.w.killSwitch = true;
    t.event(1, "security.kill_switch.engaged", {});
    await settleFor(80);
    await t.timers.advance(POLL_MS);
    const moves = t.moves.length;
    const reads = t.reads.cursor;
    await t.timers.advance(POLL_MS * 10 + FRAME_MS * 10);
    expect(t.moves.length).toBe(moves);
    expect(t.reads.cursor).toBe(reads);
  });

  it("flies home when an urgent state shows", async () => {
    const t = setup({ followCursor: true });
    await waitFor(() => expect(t.timers.active).toBeGreaterThan(0));
    await t.timers.advance(POLL_MS * 3 + FRAME_MS * 40);
    await waitFor(() => expect(t.place.at.x).toBeGreaterThan(800));
    t.state({ state: "ERROR", explanation: "Build failed" });
    await t.timers.advance(FRAME_MS * 60);
    await waitFor(() => expect(t.place.at).toMatchObject({ x: 100, y: 100 }));
    expect(screen.getByRole("button", { name: /^Fawkes/ }).getAttribute("data-state")).toBe(
      "ERROR",
    );
  });

  it("jumps instead of gliding under reduced motion", async () => {
    const t = setup({ followCursor: true, reducedMotion: "on" });
    await waitFor(() => expect(t.timers.active).toBeGreaterThan(0));
    await t.timers.advance(POLL_MS * 8);
    await waitFor(() => expect(t.moves.length).toBeGreaterThan(0));
    // Only instant moves: the one entry jump, never a run of small steps.
    expect(t.moves.length).toBeLessThanOrEqual(2);
  });
});
