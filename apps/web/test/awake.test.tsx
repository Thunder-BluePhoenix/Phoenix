// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AwakeCountdown, AwakeGlance } from "../src/components/Awake";
import {
  HOLD_TO_END_MS,
  formatCountdown,
  parseMinutesInput,
  readAwakeStatus,
  secondsLeft,
  type AwakeUiClock,
  type HoldTimer,
} from "../src/core/awake";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { I18nProvider } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { capability } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
});

const T0 = Date.parse("2026-10-20T09:00:00Z");

/** A clock and a hold timer that move only when the test says so. */
class FakeUi implements AwakeUiClock, HoldTimer {
  time = T0;
  private ticks: (() => void)[] = [];
  private pending = new Map<number, { fn: () => void; at: number }>();
  private next = 1;
  now() {
    return this.time;
  }
  every(fn: () => void) {
    this.ticks.push(fn);
    return () => {
      this.ticks = this.ticks.filter((t) => t !== fn);
    };
  }
  set(fn: () => void, ms: number) {
    const id = this.next++;
    this.pending.set(id, { fn, at: this.time + ms });
    return id;
  }
  clear(handle: unknown) {
    if (typeof handle === "number") this.pending.delete(handle);
  }
  get holdTimers() {
    return this.pending.size;
  }
  /** Advances time one step; hold timers that come due fire. */
  advance(ms: number) {
    this.time += ms;
    act(() => {
      for (const [id, p] of [...this.pending]) {
        if (p.at <= this.time) {
          this.pending.delete(id);
          p.fn();
        }
      }
      for (const t of this.ticks) t();
    });
  }
}

const idle = {
  active: false,
  battery_floor_percent: 10,
  min_minutes: 1,
  max_minutes: 10080,
};
const running = (over: Record<string, unknown> = {}) => ({
  active: true,
  session: {
    id: "awk_1",
    mode: "timed",
    started_at: new Date(T0).toISOString(),
    ends_at: new Date(T0 + 90 * 60_000).toISOString(),
    remaining_seconds: 5400,
    ...over,
  },
  battery_floor_percent: 10,
  min_minutes: 1,
  max_minutes: 10080,
});

function mount(status: unknown, ui: FakeUi, enabled = true) {
  const api = fakeApi({
    "GET /api/capabilities": () => ({
      capabilities: [capability("awake", enabled ? "enabled" : "disabled")],
    }),
    "POST /api/capabilities/awake/commands/status": () => ({ id: "op-status" }),
    "GET /api/operations/op-status": () => ({ status: "succeeded", result: status }),
    "POST /api/capabilities/awake/commands/start": () => ({ id: "op-act" }),
    "POST /api/capabilities/awake/commands/extend": () => ({ id: "op-act" }),
    "POST /api/capabilities/awake/commands/end": () => ({ id: "op-act" }),
    "GET /api/operations/op-act": () => ({ status: "succeeded", result: {} }),
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <I18nProvider forceLocale="en">
        <AwakeGlance clock={ui} holdTimer={ui} />
        <AwakeCountdown clock={ui} />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return api;
}

const commandBody = (api: FakeApi, command: string) =>
  api.posts(`/api/capabilities/awake/commands/${command}`).map((c) => c.body);

describe("status parsing and countdown maths", () => {
  it("accepts a real status and rejects shapes that would make a wrong countdown", () => {
    expect(readAwakeStatus(running())?.session?.ends_at).toBe(
      new Date(T0 + 5_400_000).toISOString(),
    );
    expect(readAwakeStatus(idle)?.active).toBe(false);
    expect(readAwakeStatus(null)).toBeNull();
    expect(readAwakeStatus({ active: true, battery_floor_percent: 10 })).toBeNull();
    expect(readAwakeStatus({ ...idle, active: "yes" })).toBeNull();
    expect(readAwakeStatus(running({ mode: "forever" }))).toBeNull();
    expect(readAwakeStatus(running({ ends_at: 5 }))).toBeNull();
    expect(readAwakeStatus(running({ ends_at: null }))?.session?.ends_at).toBeNull();
  });
  it("counts down from ends_at, never below zero, null with no end or a bad date", () => {
    const end = new Date(T0 + 61_500).toISOString();
    expect(secondsLeft(end, T0)).toBe(62);
    expect(secondsLeft(end, T0 + 61_500)).toBe(0);
    expect(secondsLeft(end, T0 + 999_999)).toBe(0);
    expect(secondsLeft(null, T0)).toBeNull();
    expect(secondsLeft("soon", T0)).toBeNull();
  });
  it("formats h:mm:ss", () => {
    expect(formatCountdown(0)).toBe("0:00:00");
    expect(formatCountdown(65)).toBe("0:01:05");
    expect(formatCountdown(3 * 3600 + 5 * 60 + 9)).toBe("3:05:09");
    expect(formatCountdown(-4)).toBe("0:00:00");
  });
  it("accepts only whole digits inside the bounds", () => {
    expect(parseMinutesInput("90", 1, 10080)).toBe(90);
    expect(parseMinutesInput(" 7 ", 1, 10080)).toBe(7);
    for (const bad of ["", "0", "10081", "-5", "1.5", "1e3", "abc", "5 min", "０５", "9999999"]) {
      expect(parseMinutesInput(bad, 1, 10080), bad).toBeNull();
    }
  });
});

describe("Keep awake on the overview", () => {
  it("renders nothing when the capability is not installed", async () => {
    const api = fakeApi({ "GET /api/capabilities": () => ({ capabilities: [] }) });
    const client = new PhoenixClient({
      token: "tok",
      baseUrl: "http://127.0.0.1:4870",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: api.fetchImpl,
    });
    const { container } = render(
      <CoreProvider client={client}>
        <I18nProvider forceLocale="en">
          <AwakeGlance />
        </I18nProvider>
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/capabilities")).toBe(true));
    expect(container.querySelector(".awake")).toBeNull();
  });

  it("says it is off when the capability is disabled, and offers no start button", async () => {
    mount(idle, new FakeUi(), false);
    expect(await screen.findByText(/turned off/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "15 minutes" })).toBeNull();
  });

  it("presets start a timed session with the right minutes", async () => {
    const api = mount(idle, new FakeUi());
    for (const [name, minutes] of [
      ["15 minutes", 15],
      ["1 hour", 60],
      ["4 hours", 240],
      ["8 hours", 480],
    ] as const) {
      // A command in flight disables the buttons; wait for it to finish before the next click.
      await waitFor(() =>
        expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() => expect(commandBody(api, "start")).toContainEqual({ input: { minutes } }));
    }
  });

  it("custom minutes are validated before anything is sent, and a reason travels with the start", async () => {
    const api = mount(idle, new FakeUi());
    const minutes = await screen.findByLabelText("Minutes");
    fireEvent.change(minutes, { target: { value: "20000" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(commandBody(api, "start")).toEqual([]);

    fireEvent.change(minutes, { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: " release build " } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(commandBody(api, "start")).toEqual([
        { input: { minutes: 45, reason: "release build" } },
      ]),
    );
  });

  it("'While agents work' starts the agents_grace mode", async () => {
    const api = mount(idle, new FakeUi());
    fireEvent.click(await screen.findByRole("button", { name: "While agents work" }));
    await waitFor(() =>
      expect(commandBody(api, "start")).toEqual([{ input: { minutes: 10, mode: "agents_grace" } }]),
    );
  });

  it("counts down from ends_at as the clock moves", async () => {
    const ui = new FakeUi();
    mount(running(), ui);
    const timer = await screen.findByRole("timer");
    expect(timer.textContent).toBe("1:30:00");
    ui.advance(61_000);
    expect(screen.getByRole("timer").textContent).toBe("1:28:59");
    ui.advance(10 * 3600_000);
    expect(screen.getByRole("timer").textContent).toBe("0:00:00");
  });

  it("extend sends the minutes", async () => {
    const api = mount(running(), new FakeUi());
    fireEvent.click(await screen.findByRole("button", { name: "+1 hour" }));
    await waitFor(() => expect(commandBody(api, "extend")).toEqual([{ input: { minutes: 60 } }]));
  });

  it("agents_grace shows who is holding it, no extend, and the grace countdown when agents are done", async () => {
    const ui = new FakeUi();
    mount(
      running({
        mode: "agents_grace",
        ends_at: null,
        remaining_seconds: null,
        agents_working: 2,
        grace_minutes: 10,
      }),
      ui,
    );
    expect((await screen.findAllByText("2 agents working")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByRole("group", { name: "Add time" })).toBeNull();
  });

  it("shows the battery floor and that the lid still sleeps", async () => {
    mount(idle, new FakeUi());
    expect(await screen.findByText(/below 10%/)).toBeTruthy();
    expect(screen.getByText(/Closing the lid still puts the computer to sleep/)).toBeTruthy();
  });
});

describe("hold to end", () => {
  async function ready() {
    const ui = new FakeUi();
    const api = mount(running(), ui);
    const button = await screen.findByRole("button", { name: "Hold to end" });
    return { ui, api, button };
  }

  it("a quick click or a short press never ends the session", async () => {
    const { ui, api, button } = await ready();
    fireEvent.click(button);
    fireEvent.pointerDown(button);
    ui.advance(HOLD_TO_END_MS - 1);
    fireEvent.pointerUp(button);
    ui.advance(HOLD_TO_END_MS * 2);
    expect(commandBody(api, "end")).toEqual([]);
    expect(ui.holdTimers).toBe(0);
  });

  it("holding the full time ends it exactly once", async () => {
    const { ui, api, button } = await ready();
    fireEvent.pointerDown(button);
    fireEvent.pointerDown(button);
    expect(await screen.findByRole("button", { name: "Keep holding…" })).toBeTruthy();
    ui.advance(HOLD_TO_END_MS);
    await waitFor(() => expect(commandBody(api, "end")).toEqual([{ input: {} }]));
    fireEvent.pointerUp(button);
    ui.advance(HOLD_TO_END_MS);
    expect(commandBody(api, "end")).toHaveLength(1);
  });

  it("leaving the button or losing focus cancels the hold", async () => {
    const { ui, api, button } = await ready();
    fireEvent.pointerDown(button);
    fireEvent.pointerLeave(button);
    ui.advance(HOLD_TO_END_MS * 2);
    fireEvent.pointerDown(button);
    fireEvent.blur(button);
    ui.advance(HOLD_TO_END_MS * 2);
    expect(commandBody(api, "end")).toEqual([]);
  });

  it("the keyboard works: holding Space for the full time ends it, releasing early does not", async () => {
    const { ui, api, button } = await ready();
    fireEvent.keyDown(button, { key: " " });
    ui.advance(HOLD_TO_END_MS - 100);
    fireEvent.keyUp(button, { key: " " });
    ui.advance(HOLD_TO_END_MS);
    expect(commandBody(api, "end")).toEqual([]);

    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: "Enter", repeat: true });
    ui.advance(HOLD_TO_END_MS);
    await waitFor(() => expect(commandBody(api, "end")).toHaveLength(1));
  });

  it("tells the user how, in text, not only by the look of the button", async () => {
    await ready();
    expect(
      screen.getByText(/Hold the button for 1.5 seconds \(or hold Space or Enter\)/),
    ).toBeTruthy();
  });

  it("leaves no timer behind when the view goes away mid-hold", async () => {
    const { ui, button } = await ready();
    fireEvent.pointerDown(button);
    expect(ui.holdTimers).toBe(1);
    cleanup();
    expect(ui.holdTimers).toBe(0);
  });
});

describe("the island / floating countdown", () => {
  it("shows the time left while a session runs and nothing otherwise", async () => {
    const ui = new FakeUi();
    mount(running(), ui);
    const pills = await screen.findAllByText(/Awake 1:30:00/);
    expect(pills.length).toBeGreaterThan(0);
    ui.advance(30_000);
    expect(screen.getAllByText(/Awake 1:29:30/).length).toBeGreaterThan(0);
  });
  it("is absent when no session runs", async () => {
    mount(idle, new FakeUi());
    await screen.findByText(/sleeps as usual/);
    expect(screen.queryByText(/^Awake /)).toBeNull();
  });
});
