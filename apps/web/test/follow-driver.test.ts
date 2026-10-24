// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  ARRIVE_PX,
  clampTo,
  FollowDriver,
  FRAME_MS,
  MAX_READ_FAILURES,
  OFFSET_CSS_PX,
  POLL_MS,
  SETTLE_POLLS,
  VISIBLE_MS,
  type FollowTimers,
} from "../src/floating/follow-driver";
import {
  parseArea,
  parsePoint,
  parseScale,
  parseSize,
  tauriFollowShell,
  type Area,
  type FollowShell,
  type PhysicalPoint,
  type WindowPlace,
} from "../src/floating/follow-shell";

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
  /** Moves time forward, firing each due timer in order and letting its async work finish. */
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.now = due[1].at;
      due[1].at += due[1].every;
      due[1].fn();
      await settle();
    }
    this.now = end;
  }
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const WINDOW = { width: 192, height: 220 };
const AREA: Area = { x: 0, y: 0, width: 3000, height: 2000 };

class FakeShell {
  cursorAt: PhysicalPoint | null = { x: 1000, y: 800 };
  placeAt: WindowPlace | null = { x: 100, y: 100, scale: 2, ...WINDOW };
  shown = true;
  area: Area | null = AREA;
  cursorReads = 0;
  windowReads = 0;
  visibleReads = 0;
  failCursor = false;
  cursor = async () => {
    this.cursorReads++;
    if (this.failCursor) throw new Error("no pointer");
    return this.cursorAt;
  };
  window = async () => {
    this.windowReads++;
    return this.placeAt;
  };
  visible = async () => {
    this.visibleReads++;
    return this.shown;
  };
  areaFor = async () => this.area;
}

function makeShell(): FollowShell & {
  s: FakeShell;
} {
  const s = new FakeShell();
  return {
    s,
    cursor: () => s.cursor(),
    window: () => s.window(),
    visible: () => s.visible(),
    area: () => s.areaFor(),
  };
}

interface Rig {
  driver: FollowDriver;
  timers: ManualTimers;
  shell: ReturnType<typeof makeShell>;
  moves: [number, number][];
  /** The window follows the commands the driver sends, as the real shell would. */
  position(): { x: number; y: number };
}

function rig(): Rig {
  const timers = new ManualTimers();
  const shell = makeShell();
  const moves: [number, number][] = [];
  const driver = new FollowDriver({
    shell,
    timers,
    moveBy: (dx, dy) => {
      moves.push([dx, dy]);
      const p = shell.s.placeAt;
      if (p)
        shell.s.placeAt = {
          ...p,
          x: p.x + Math.round(dx * p.scale),
          y: p.y + Math.round(dy * p.scale),
        };
    },
  });
  return { driver, timers, shell, moves, position: () => ({ ...shell.s.placeAt! }) };
}

/** Switches the feature on the way the page does: not quiet, opted in, then lets it settle. */
async function start(r: Rig, reduced = false): Promise<void> {
  r.driver.setReducedMotion(reduced);
  r.driver.setSuspended(false);
  r.driver.setEnabled(true);
  await settle();
}

describe("FollowDriver", () => {
  it("does nothing until it is switched on: no reads, no timers, no moves", async () => {
    const r = rig();
    await r.timers.advance(10_000);
    expect(r.shell.s.cursorReads + r.shell.s.windowReads + r.shell.s.visibleReads).toBe(0);
    expect(r.timers.active).toBe(0);
    expect(r.moves).toEqual([]);
  });

  it("does nothing when opted in while still suspended (quiet is unknown)", async () => {
    const r = rig();
    r.driver.setEnabled(true);
    await r.timers.advance(10_000);
    expect(r.driver.snapshot.phase).toBe("docked");
    expect(r.shell.s.cursorReads).toBe(0);
    expect(r.moves).toEqual([]);
  });

  it("jumps beside the pointer when following begins, then glides after it", async () => {
    const r = rig();
    await start(r);
    expect(r.driver.snapshot.phase).toBe("following");
    await r.timers.advance(POLL_MS);
    // Following begins with one instant move to where the pointer is (the machine's entry move).
    expect(r.moves).toHaveLength(1);
    expect(r.position()).toMatchObject({
      x: 1000 + OFFSET_CSS_PX * 2,
      y: 800 + OFFSET_CSS_PX * 2,
    });
    r.moves.length = 0;
    // The pointer goes elsewhere: Fawkes glides there in many shrinking steps and stops beside it.
    r.shell.s.cursorAt = { x: 2000, y: 1500 };
    await r.timers.advance(POLL_MS + 60 * FRAME_MS);
    expect(r.moves.length).toBeGreaterThan(5);
    const at = r.position();
    expect(Math.abs(at.x - (2000 + OFFSET_CSS_PX * 2))).toBeLessThanOrEqual(ARRIVE_PX);
    expect(Math.abs(at.y - (1500 + OFFSET_CSS_PX * 2))).toBeLessThanOrEqual(ARRIVE_PX);
    const lengths = r.moves.map(([x, y]) => Math.hypot(x, y));
    expect(lengths[0]!).toBeGreaterThan(lengths[lengths.length - 1]!);
  });

  it("follows the pointer again when it moves", async () => {
    const r = rig();
    await start(r);
    await r.timers.advance(POLL_MS + 60 * FRAME_MS);
    r.shell.s.cursorAt = { x: 400, y: 300 };
    await r.timers.advance(POLL_MS + 60 * FRAME_MS);
    const at = r.position();
    expect(Math.abs(at.x - (400 + OFFSET_CSS_PX * 2))).toBeLessThanOrEqual(ARRIVE_PX);
    expect(Math.abs(at.y - (300 + OFFSET_CSS_PX * 2))).toBeLessThanOrEqual(ARRIVE_PX);
  });

  it("never covers the pointer or leaves the screen: the target is clamped into the work area", async () => {
    const r = rig();
    r.shell.s.cursorAt = { x: 2990, y: 1990 };
    await start(r);
    await r.timers.advance(POLL_MS + 80 * FRAME_MS);
    const at = r.position();
    expect(at.x + WINDOW.width).toBeLessThanOrEqual(AREA.width);
    expect(at.y + WINDOW.height).toBeLessThanOrEqual(AREA.height);
    expect(at.x).toBe(AREA.width - WINDOW.width);
  });

  it("under reduced motion never glides: it jumps once the pointer has rested", async () => {
    const r = rig();
    await start(r, true);
    await r.timers.advance(POLL_MS);
    r.moves.length = 0;
    // The pointer keeps moving: no move (no continuous following).
    for (let i = 1; i <= 5; i++) {
      r.shell.s.cursorAt = { x: 1000 + i * 50, y: 800 };
      await r.timers.advance(POLL_MS);
    }
    expect(r.moves).toEqual([]);
    // It rests: one single jump to the target.
    await r.timers.advance(POLL_MS * (SETTLE_POLLS + 1));
    expect(r.moves).toHaveLength(1);
    expect(r.position()).toMatchObject({ x: 1250 + OFFSET_CSS_PX * 2, y: 800 + OFFSET_CSS_PX * 2 });
    // Resting longer does not move it again.
    await r.timers.advance(POLL_MS * 20);
    expect(r.moves).toHaveLength(1);
  });

  it("flies home on an alert and comes back to the pointer when it clears", async () => {
    const r = rig();
    await start(r);
    await r.timers.advance(POLL_MS + 60 * FRAME_MS);
    r.driver.setAlert(true);
    await r.timers.advance(60 * FRAME_MS);
    expect(r.driver.snapshot.phase).toBe("home-alert");
    // Home is where Fawkes was when following began.
    expect(r.position()).toMatchObject({ x: 100, y: 100 });
    // At home the pointer is no longer read.
    const reads = r.shell.s.cursorReads;
    await r.timers.advance(POLL_MS * 10);
    expect(r.shell.s.cursorReads).toBe(reads);
    r.driver.setAlert(false);
    await r.timers.advance(POLL_MS + 80 * FRAME_MS);
    expect(r.driver.snapshot.phase).toBe("following");
    expect(r.position().x).toBeGreaterThan(900);
  });

  it("reduced motion flies home in one instant move", async () => {
    const r = rig();
    await start(r, true);
    await r.timers.advance(POLL_MS * (SETTLE_POLLS + 2));
    r.moves.length = 0;
    r.driver.setAlert(true);
    await settle();
    expect(r.moves).toHaveLength(1);
    expect(r.position()).toMatchObject({ x: 100, y: 100 });
  });

  it("does not move a Fawkes that is being held, and resumes after the drop", async () => {
    const r = rig();
    await start(r);
    await r.timers.advance(POLL_MS);
    r.shell.s.cursorAt = { x: 2500, y: 1800 };
    await r.timers.advance(POLL_MS + 3 * FRAME_MS);
    r.driver.dragStarted();
    const frozen = r.moves.length;
    expect(frozen).toBeGreaterThan(1);
    r.shell.s.cursorAt = { x: 200, y: 200 };
    await r.timers.advance(POLL_MS * 10 + 30 * FRAME_MS);
    expect(r.moves.length).toBe(frozen);
    r.driver.dragEnded();
    await r.timers.advance(POLL_MS + 60 * FRAME_MS);
    expect(r.moves.length).toBeGreaterThan(frozen);
  });

  it("turning the setting off stops everything and sends Fawkes home", async () => {
    const r = rig();
    await start(r);
    await r.timers.advance(POLL_MS + 60 * FRAME_MS);
    r.driver.setEnabled(false);
    await settle();
    expect(r.driver.snapshot.phase).toBe("docked");
    expect(r.timers.active).toBe(0);
    expect(r.position()).toMatchObject({ x: 100, y: 100 });
    const reads = r.shell.s.cursorReads;
    const moves = r.moves.length;
    await r.timers.advance(10_000);
    expect(r.shell.s.cursorReads).toBe(reads);
    expect(r.moves.length).toBe(moves);
  });

  it.each([
    ["quiet mode, quiet hours or the emergency stop", (r: Rig) => r.driver.setSuspended(true)],
    ["the window being hidden", (r: Rig) => void (r.shell.s.shown = false)],
  ])("stops where it is, without a move, for %s", async (_name, stop) => {
    const r = rig();
    await start(r);
    await r.timers.advance(POLL_MS + 60 * FRAME_MS);
    const at = r.position();
    const moves = r.moves.length;
    stop(r);
    // A hidden window is noticed by the visibility probe.
    await r.timers.advance(VISIBLE_MS * 2);
    expect(r.driver.snapshot.followEnabled).toBe(false);
    r.shell.s.cursorAt = { x: 5, y: 5 };
    const reads = r.shell.s.cursorReads;
    await r.timers.advance(5_000);
    expect(r.shell.s.cursorReads).toBe(reads);
    expect(r.moves.length).toBe(moves);
    expect(r.position()).toEqual(at);
  });

  it("starts again when it is no longer quiet or the window is shown again", async () => {
    const r = rig();
    await start(r);
    r.driver.setSuspended(true);
    await settle();
    expect(r.driver.snapshot.followEnabled).toBe(false);
    r.driver.setSuspended(false);
    await r.timers.advance(VISIBLE_MS);
    expect(r.driver.snapshot.phase).toBe("following");
    r.shell.s.shown = false;
    await r.timers.advance(VISIBLE_MS * 2);
    expect(r.driver.snapshot.followEnabled).toBe(false);
    r.shell.s.shown = true;
    await r.timers.advance(VISIBLE_MS * 2);
    expect(r.driver.snapshot.phase).toBe("following");
  });

  it("never starts while the window is hidden", async () => {
    const r = rig();
    r.shell.s.shown = false;
    await start(r);
    await r.timers.advance(VISIBLE_MS * 3 + POLL_MS * 5);
    expect(r.driver.snapshot.phase).toBe("docked");
    expect(r.shell.s.cursorReads).toBe(0);
    expect(r.moves).toEqual([]);
  });

  it("gives up when the system will not report the pointer, and does not move", async () => {
    const r = rig();
    r.shell.s.failCursor = true;
    await start(r);
    await r.timers.advance(POLL_MS * (MAX_READ_FAILURES + 5));
    expect(r.driver.unavailable).toBe(true);
    expect(r.driver.snapshot.followEnabled).toBe(false);
    expect(r.moves).toEqual([]);
    const reads = r.shell.s.cursorReads;
    await r.timers.advance(POLL_MS * 20);
    expect(r.shell.s.cursorReads).toBe(reads);
  });

  it("does not start when the window's own place cannot be read", async () => {
    const r = rig();
    r.shell.s.placeAt = null;
    await start(r);
    await r.timers.advance(POLL_MS * 5 + FRAME_MS * 5);
    expect(r.moves).toEqual([]);
  });

  it("dispose stops every timer and leaves the window where it is", async () => {
    const r = rig();
    await start(r);
    await r.timers.advance(POLL_MS + 3 * FRAME_MS);
    const at = r.position();
    r.driver.dispose();
    expect(r.timers.active).toBe(0);
    await r.timers.advance(5_000);
    expect(r.position()).toEqual(at);
    r.driver.setEnabled(true);
    expect(r.timers.active).toBe(0);
  });
});

describe("clampTo", () => {
  it("keeps the whole window inside the area and handles a window larger than the area", () => {
    expect(clampTo({ x: -50, y: -50 }, WINDOW, AREA)).toEqual({ x: 0, y: 0 });
    expect(clampTo({ x: 5000, y: 5000 }, WINDOW, AREA)).toEqual({ x: 2808, y: 1780 });
    expect(clampTo({ x: 10, y: 10 }, WINDOW, AREA)).toEqual({ x: 10, y: 10 });
    expect(
      clampTo(
        { x: 10, y: 10 },
        { width: 400, height: 400 },
        { x: 5, y: 7, width: 100, height: 100 },
      ),
    ).toEqual({ x: 5, y: 7 });
  });
});

describe("follow shell parsing", () => {
  it("accepts only finite numbers", () => {
    expect(parsePoint({ x: 1.5, y: -2 })).toEqual({ x: 1.5, y: -2 });
    for (const bad of [
      null,
      undefined,
      3,
      "x",
      {},
      { x: 1 },
      { x: "1", y: 2 },
      { x: NaN, y: 1 },
      { x: 1, y: Infinity },
    ])
      expect(parsePoint(bad)).toBeNull();
    expect(parseScale(2)).toBe(2);
    for (const bad of [0, -1, NaN, Infinity, "2", null]) expect(parseScale(bad)).toBeNull();
    expect(parseSize({ width: 10, height: 20 })).toEqual({ width: 10, height: 20 });
    for (const bad of [{ width: 0, height: 1 }, { width: 1 }, null])
      expect(parseSize(bad)).toBeNull();
    expect(
      parseArea({ workArea: { position: { x: 1, y: 2 }, size: { width: 3, height: 4 } } }),
    ).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    for (const bad of [null, {}, { workArea: null }, { workArea: { position: { x: 1, y: 2 } } }])
      expect(parseArea(bad)).toBeNull();
  });
});

describe("tauriFollowShell", () => {
  it("is absent outside the desktop app", () => {
    expect(tauriFollowShell({} as Window)).toBeNull();
    expect(tauriFollowShell({ __TAURI__: {} } as unknown as Window)).toBeNull();
  });

  it("reads only through the core window commands, and any failure is a safe answer", async () => {
    const calls: [string, unknown][] = [];
    const answers: Record<string, unknown> = {
      "plugin:window|cursor_position": { x: 10, y: 20 },
      "plugin:window|outer_position": { x: 1, y: 2 },
      "plugin:window|outer_size": { width: 192, height: 220 },
      "plugin:window|scale_factor": 2,
      "plugin:window|is_visible": true,
      "plugin:window|monitor_from_point": {
        workArea: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 } },
      },
    };
    const invoke = async (command: string, args?: unknown) => {
      calls.push([command, args]);
      if (!(command in answers)) throw new Error("not allowed");
      return answers[command];
    };
    const shell = tauriFollowShell({ __TAURI__: { core: { invoke } } } as unknown as Window)!;
    expect(await shell.cursor()).toEqual({ x: 10, y: 20 });
    expect(await shell.window()).toEqual({ x: 1, y: 2, width: 192, height: 220, scale: 2 });
    expect(await shell.visible()).toBe(true);
    expect(await shell.area({ x: 10, y: 20 })).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(calls.every(([c]) => c.startsWith("plugin:window|"))).toBe(true);
    expect(calls.find(([c]) => c.endsWith("monitor_from_point"))![1]).toEqual({ x: 10, y: 20 });

    for (const key of Object.keys(answers)) delete answers[key];
    expect(await shell.cursor()).toBeNull();
    expect(await shell.window()).toBeNull();
    expect(await shell.visible()).toBe(false);
    expect(await shell.area({ x: 0, y: 0 })).toBeNull();
    answers["plugin:window|is_visible"] = "yes";
    expect(await shell.visible()).toBe(false);
  });
});
