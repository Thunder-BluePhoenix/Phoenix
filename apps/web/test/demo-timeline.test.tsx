// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { DemoHost } from "../src/components/Demo";
import { PhoenixClient } from "../src/core/client";
import { DEMO_UI_TEXT, type DemoSession } from "../src/core/demo";
import { DemoController, type DemoRouter } from "../src/core/demo-controller";
import {
  DEFAULT_STEP_INTERVAL_MS,
  DemoTimeline,
  type DemoTimelineTimers,
  type ReducedMotionSource,
} from "../src/core/demo-timeline";
import { en } from "../src/i18n/en";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.location.hash = "";
});

const DEMO_URL = "http://127.0.0.1:51234";
/** Built at run time: no credential-shaped literal in the source. */
const DEMO_TOKEN = ["demo", "token", "y".repeat(24)].join("-");

const STEPS = [
  {
    scenario: "build-pass",
    caption_id: "demo.build-pass",
    caption: "Build passes.",
    route: "/panel/overview",
  },
  {
    scenario: "build-fail",
    caption_id: "demo.build-fail",
    caption: "Build fails.",
    route: "/panel/activity",
  },
  { scenario: "tests", caption_id: "demo.tests", caption: "Tests run.", route: "/panel/overview" },
];

const session = (): DemoSession => ({ url: DEMO_URL, token: DEMO_TOKEN, steps: STEPS });

/** Timers the test moves by hand: nothing runs unless `advance` is called. */
class ManualTimers implements DemoTimelineTimers {
  private now = 0;
  private nextId = 1;
  private readonly pending = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.pending.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  get count(): number {
    return this.pending.size;
  }
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let due: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.pending) {
        if (entry[1].at <= end && (!due || entry[1].at < due[1].at)) due = entry;
      }
      if (!due) break;
      this.pending.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = end;
  }
}

class FakeMotion implements ReducedMotionSource {
  private listeners = new Set<() => void>();
  constructor(public reduced = false) {}
  matches = () => this.reduced;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  set(reduced: boolean) {
    this.reduced = reduced;
    for (const l of [...this.listeners]) l();
  }
  get subscribers() {
    return this.listeners.size;
  }
}

/** Lets fetches, Responses and React effects settle (real timers are in use for this). */
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const advance = async (timers: ManualTimers, ms: number) => {
  act(() => timers.advance(ms));
  await settle();
};

const simulated = (demo: FakeApi) =>
  demo
    .posts("/api/capabilities/mock/commands/simulate")
    .map((c) => (c.body as { input: { scenario: string } }).input.scenario);

interface Mounted {
  demo: FakeApi;
  timers: ManualTimers;
  motion: FakeMotion;
  unmount: () => void;
}

function mount(reduced = false): Mounted {
  window.location.hash = "#/settings";
  const real = fakeApi({ "POST /api/demo/start": () => session() });
  const demo = fakeApi();
  const timers = new ManualTimers();
  const motion = new FakeMotion(reduced);
  const realClient = new PhoenixClient({
    token: "real-token",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: real.fetchImpl,
  });
  const { unmount } = render(
    <DemoHost
      client={realClient}
      timeline={{ timers, reducedMotion: motion }}
      makeClient={(o) =>
        new PhoenixClient({
          ...o,
          WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
          fetchImpl: demo.fetchImpl,
        })
      }
    >
      <App />
    </DemoHost>,
  );
  act(() => FakeWebSocket.last.open());
  return { demo, timers, motion, unmount };
}

const button = (name: string) => screen.getByRole("button", { name });
const startDemo = async () => {
  fireEvent.click(await screen.findByRole("button", { name: DEMO_UI_TEXT.start }));
  await screen.findByRole("button", { name: en["services.demo.auto.play"] });
};
const playAuto = async () => {
  fireEvent.click(button(en["services.demo.auto.play"]));
  await settle();
};

describe("the timed demo walkthrough", () => {
  it("never starts by itself: a running demo with no press stays on its first screen", async () => {
    const m = mount();
    await startDemo();
    await advance(m.timers, 10 * DEFAULT_STEP_INTERVAL_MS);
    expect(simulated(m.demo)).toEqual([]);
    expect(m.timers.count).toBe(0);
  });

  it("play runs the first step at once, then one step per interval (6 s by default) and ends on the last", async () => {
    const m = mount();
    await startDemo();
    await playAuto();
    expect(DEFAULT_STEP_INTERVAL_MS).toBe(6000);
    expect(simulated(m.demo)).toEqual(["build-pass"]);
    expect(screen.getByText(STEPS[0]!.caption)).toBeTruthy();
    expect(button(en["services.demo.auto.pause"])).toBeTruthy();

    await advance(m.timers, 5999);
    expect(simulated(m.demo)).toEqual(["build-pass"]);
    await advance(m.timers, 1);
    expect(simulated(m.demo)).toEqual(["build-pass", "build-fail"]);
    expect(screen.getByText(STEPS[1]!.caption)).toBeTruthy();
    await advance(m.timers, 6000);
    expect(simulated(m.demo)).toEqual(["build-pass", "build-fail", "tests"]);

    // The last step has played: the run is over, nothing is left scheduled, the screen stays.
    expect(m.timers.count).toBe(0);
    expect(button(en["services.demo.auto.play"])).toBeTruthy();
    expect(screen.getByText(DEMO_UI_TEXT.finished)).toBeTruthy();
    await advance(m.timers, 60000);
    expect(simulated(m.demo)).toHaveLength(3);
  });

  it("pause stops the clock and keeps the step; resume goes on from it", async () => {
    const m = mount();
    await startDemo();
    await playAuto();
    await advance(m.timers, 6000);
    expect(simulated(m.demo)).toHaveLength(2);

    fireEvent.click(button(en["services.demo.auto.pause"]));
    await settle();
    expect(m.timers.count).toBe(0);
    await advance(m.timers, 120000);
    expect(simulated(m.demo)).toHaveLength(2);
    expect(screen.getByText(STEPS[1]!.caption)).toBeTruthy();
    expect(screen.getByText(en["services.demo.auto.paused"])).toBeTruthy();

    fireEvent.click(button(en["services.demo.auto.resume"]));
    await settle();
    await advance(m.timers, 5999);
    expect(simulated(m.demo)).toHaveLength(2);
    await advance(m.timers, 1);
    expect(simulated(m.demo)).toEqual(["build-pass", "build-fail", "tests"]);
  });

  it("stop ends the run and resets the walkthrough to its start", async () => {
    const m = mount();
    await startDemo();
    await playAuto();
    await advance(m.timers, 6000);
    expect(screen.getByText(STEPS[1]!.caption)).toBeTruthy();

    fireEvent.click(button(en["services.demo.auto.stop"]));
    await settle();
    expect(m.timers.count).toBe(0);
    expect(screen.queryByText(STEPS[1]!.caption)).toBeNull();
    expect(
      screen.getByText(en["services.demo.stepCount"].includes("plural") ? /3/ : "3"),
    ).toBeTruthy();
    await advance(m.timers, 60000);
    expect(simulated(m.demo)).toHaveLength(2);
    // Play after a stop starts over from the first step.
    await playAuto();
    expect(simulated(m.demo)).toEqual(["build-pass", "build-fail", "build-pass"]);
  });

  it("any manual step button stops it", async () => {
    const m = mount();
    await startDemo();
    await playAuto();
    await waitFor(() =>
      expect((button(DEMO_UI_TEXT.next) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(button(DEMO_UI_TEXT.next));
    await settle();
    expect(m.timers.count).toBe(0);
    expect(button(en["services.demo.auto.play"])).toBeTruthy();
    await advance(m.timers, 60000);
    expect(simulated(m.demo)).toEqual(["build-pass", "build-fail"]);
  });

  it("navigating by hand stops it, also while paused", async () => {
    const m = mount();
    await startDemo();
    await playAuto();
    expect(m.timers.count).toBe(1);
    act(() => {
      window.location.hash = "#/settings";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await settle();
    expect(m.timers.count).toBe(0);
    expect(button(en["services.demo.auto.play"])).toBeTruthy();
    await advance(m.timers, 60000);
    expect(simulated(m.demo)).toEqual(["build-pass"]);

    // Paused, then navigating: the run is over, not merely paused.
    await playAuto();
    fireEvent.click(button(en["services.demo.auto.pause"]));
    await settle();
    act(() => {
      window.location.hash = "#/meetings";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await settle();
    expect(screen.queryByRole("button", { name: en["services.demo.auto.resume"] })).toBeNull();
  });

  it("leaving demo mode stops it and leaves nothing scheduled", async () => {
    const m = mount();
    await startDemo();
    await playAuto();
    expect(m.timers.count).toBe(1);
    fireEvent.click(button(DEMO_UI_TEXT.stop));
    await waitFor(() => expect(screen.queryByText(DEMO_UI_TEXT.banner)).toBeNull());
    expect(m.timers.count).toBe(0);
    expect(m.motion.subscribers).toBe(0);
    await advance(m.timers, 60000);
    expect(simulated(m.demo)).toEqual(["build-pass"]);
  });

  it("unmounting clears the timer and the subscriptions", async () => {
    const m = mount();
    await startDemo();
    await playAuto();
    expect(m.timers.count).toBe(1);
    expect(m.motion.subscribers).toBe(1);
    m.unmount();
    expect(m.timers.count).toBe(0);
    expect(m.motion.subscribers).toBe(0);
    m.timers.advance(60000);
    expect(simulated(m.demo)).toEqual(["build-pass"]);
  });

  it("with reduced motion it still never starts by itself, says so, and only an explicit play advances it", async () => {
    const m = mount(true);
    await startDemo();
    expect(screen.getByText(en["services.demo.auto.reducedMotion"])).toBeTruthy();
    await advance(m.timers, 10 * DEFAULT_STEP_INTERVAL_MS);
    expect(simulated(m.demo)).toEqual([]);
    expect(m.timers.count).toBe(0);

    await playAuto();
    await advance(m.timers, 6000);
    expect(simulated(m.demo)).toEqual(["build-pass", "build-fail"]);
  });

  it("turning reduced motion on while it plays pauses it", async () => {
    const m = mount();
    await startDemo();
    await playAuto();
    act(() => m.motion.set(true));
    await settle();
    expect(m.timers.count).toBe(0);
    expect(screen.getByText(en["services.demo.auto.paused"])).toBeTruthy();
    await advance(m.timers, 60000);
    expect(simulated(m.demo)).toEqual(["build-pass"]);
  });
});

describe("DemoTimeline on its own", () => {
  const memoryRouter = (): DemoRouter => {
    let hash = "#/start";
    return { get: () => hash, set: (h) => void (hash = h) };
  };

  async function rig(simulate?: () => unknown) {
    const real = fakeApi({ "POST /api/demo/start": () => session() });
    const demo = fakeApi(
      simulate ? { "POST /api/capabilities/mock/commands/simulate": simulate } : {},
    );
    const router = memoryRouter();
    const controller = new DemoController(
      new PhoenixClient({
        token: "real-token",
        baseUrl: "http://127.0.0.1:4870",
        WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
        fetchImpl: real.fetchImpl,
      }),
      (o) =>
        new PhoenixClient({
          ...o,
          WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
          fetchImpl: demo.fetchImpl,
        }),
      router,
    );
    await controller.start();
    return { controller, demo, router };
  }

  it("uses the global timers with a 6 s default when none are injected (vitest fake timers)", async () => {
    const { controller, demo } = await rig();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const timeline = new DemoTimeline(controller, { reducedMotion: new FakeMotion() });
    const off = timeline.attach();
    timeline.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(simulated(demo)).toEqual(["build-pass"]);
    await vi.advanceTimersByTimeAsync(5999);
    expect(simulated(demo)).toEqual(["build-pass"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(simulated(demo)).toEqual(["build-pass", "build-fail"]);
    off();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(simulated(demo)).toHaveLength(2);
    expect(timeline.getSnapshot().status).toBe("idle");
  });

  it("honours a custom interval and rejects one that is not a positive finite number", async () => {
    const { controller, demo } = await rig();
    const timers = new ManualTimers();
    const timeline = new DemoTimeline(controller, {
      intervalMs: 1000,
      timers,
      reducedMotion: new FakeMotion(),
    });
    timeline.attach();
    timeline.play();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      timers.advance(1000);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(simulated(demo)).toEqual(["build-pass", "build-fail"]);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new DemoTimeline(controller, { intervalMs: bad })).toThrow(RangeError);
    }
  });

  it("ends when a step fails and shows the controller's error rather than going on", async () => {
    const { controller, demo } = await rig(() => new Response("{}", { status: 500 }));
    const timers = new ManualTimers();
    const timeline = new DemoTimeline(controller, { timers, reducedMotion: new FakeMotion() });
    timeline.attach();
    timeline.play();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(timeline.getSnapshot().status).toBe("idle");
    expect(timers.count).toBe(0);
    expect(controller.getSnapshot().error).toContain(DEMO_UI_TEXT.playFailed);
    timers.advance(60000);
    expect(simulated(demo)).toHaveLength(1);
  });

  it("does nothing before attach() or outside a running demo", async () => {
    const real = fakeApi();
    const controller = new DemoController(
      new PhoenixClient({
        token: "real-token",
        baseUrl: "http://127.0.0.1:4870",
        WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
        fetchImpl: real.fetchImpl,
      }),
    );
    const timers = new ManualTimers();
    const timeline = new DemoTimeline(controller, { timers, reducedMotion: new FakeMotion() });
    timeline.play();
    timeline.attach();
    timeline.play();
    expect(timeline.getSnapshot().status).toBe("idle");
    expect(timers.count).toBe(0);
  });
});
