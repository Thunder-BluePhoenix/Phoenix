// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import {
  browserSoundBackend,
  parseSoundPrefs,
  soundHostFor,
  type SoundHost,
} from "../src/core/sounds";
import { SoundSettingsSection } from "../src/components/SoundSettings";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const NOON = Date.parse("2026-10-24T12:00:00Z");
const LATE = Date.parse("2026-10-24T23:30:00Z");
const NIGHT_HOURS = { timezone: "UTC", start: "22:00", end: "07:00" };

interface World {
  sounds: { enabled: boolean; volume: number };
  notificationsEnabled: boolean;
  quietHours: typeof NIGHT_HOURS | null;
  killSwitch: boolean;
  /** 200 with the preferences, or the status the proactive route answers with. */
  proactive: "ok" | 404 | 500;
  notificationsFail: boolean;
  now: number;
}

const world = (patch: Partial<World> = {}): World => ({
  sounds: { enabled: true, volume: 40 },
  notificationsEnabled: true,
  quietHours: null,
  killSwitch: false,
  proactive: "ok",
  notificationsFail: false,
  now: NOON,
  ...patch,
});

function routes(w: World) {
  const error = (status: number) =>
    new Response(JSON.stringify({ code: "INTERNAL_ERROR", message: "no" }), { status });
  return {
    "GET /api/ui/sounds": () => w.sounds,
    "POST /api/ui/sounds": (body: unknown) => {
      w.sounds = { ...w.sounds, ...(body as object) };
      return w.sounds;
    },
    "GET /api/notifications/preferences": () =>
      w.notificationsFail
        ? error(500)
        : { enabled: w.notificationsEnabled, min_severity: "warning", muted_sources: [] },
    "GET /api/proactive": () =>
      w.proactive === "ok"
        ? {
            preferences: {
              enabled: false,
              capabilities: [],
              quietHours: w.quietHours,
              maxPerHour: 3,
              cadenceMinutes: null,
            },
            source: { capability_id: "kage", available: false, mode: "manual" },
            noise: { delivered: 0, dismissed: 0, suppressed: 0, dismissalRate: 0 },
          }
        : error(w.proactive),
    "GET /api/security/kill-switch": () => ({ engaged: w.killSwitch }),
  };
}

interface Played {
  bytes: number;
  volume: number;
}

function setup(
  patch: Partial<World> = {},
  options: { gesture?: boolean; backend?: "ok" | "throws" | "hangs"; maxAgeMs?: number } = {},
) {
  const w = world(patch);
  const api = fakeApi(routes(w));
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  const played: Played[] = [];
  let gesture = options.gesture ?? true;
  const host = soundHostFor(client, {
    backend: {
      play: async (wav, volume) => {
        if (options.backend === "throws") throw new Error("no audio device");
        if (options.backend === "hangs") return new Promise<void>(() => {});
        played.push({ bytes: wav.byteLength, volume });
      },
    },
    now: () => w.now,
    gesture: () => gesture,
    // Long by default so a test that moves the clock proves the window is checked at play time.
    maxAgeMs: options.maxAgeMs ?? 1e12,
    playTimeoutMs: 20,
  });
  return {
    w,
    api,
    client,
    host,
    played,
    setGesture: (value: boolean) => (gesture = value),
  };
}

/** A live event as the client's socket would deliver it. */
function emit(client: PhoenixClient, event_type: string, payload: Record<string, unknown>) {
  act(() =>
    client.eventCreated.emit({
      seq: 1,
      event: {
        event_id: "evt_1aaaaaaaaa",
        event_type,
        source: "core",
        severity: "info",
        timestamp: "2026-10-24T12:00:00Z",
        payload,
      },
    } as never),
  );
}

async function loaded(host: SoundHost) {
  await host.reload();
}

describe("the sound host: policy at play time", () => {
  it("is off by default and plays nothing, not even before the settings are known", async () => {
    const t = setup({ sounds: { enabled: false, volume: 60 } });
    expect(await t.host.player.trigger("poke")).toBe("disabled");
    await loaded(t.host);
    expect(await t.host.player.trigger("poke")).toBe("disabled");
    expect(t.played).toEqual([]);
    // Nothing needed to be asked of Core about quiet mode: it was off.
    expect(t.api.calls.map((c) => c.path)).toEqual(["/api/ui/sounds"]);
  });

  it("plays when on and not quiet, at the saved volume", async () => {
    const t = setup({ sounds: { enabled: true, volume: 35 } });
    await loaded(t.host);
    expect(await t.host.player.trigger("completion")).toBe("played");
    expect(t.played).toHaveLength(1);
    expect(t.played[0]!.bytes).toBeGreaterThan(44);
    expect(t.played[0]!.volume).toBeCloseTo(0.35, 5);
  });

  it("applies the volume: 0 is silent and 100 is full", async () => {
    const t = setup({ sounds: { enabled: true, volume: 0 } });
    await loaded(t.host);
    expect(await t.host.player.trigger("poke")).toBe("silent-volume");
    await t.host.save({ volume: 100 });
    expect(await t.host.player.trigger("poke")).toBe("played");
    expect(t.played.map((p) => p.volume)).toEqual([1]);
  });

  it("is silent in quiet mode (notifications switched off)", async () => {
    const t = setup({ notificationsEnabled: false });
    await loaded(t.host);
    expect(await t.host.player.trigger("failure")).toBe("quiet");
    expect(t.played).toEqual([]);
  });

  it("is silent in quiet hours, judged by the clock at play time, wrapping midnight", async () => {
    const t = setup({ quietHours: NIGHT_HOURS });
    await loaded(t.host);
    expect(await t.host.player.trigger("poke")).toBe("played");
    t.w.now = LATE; // Core's answer is still fresh; only the clock moved
    expect(await t.host.player.trigger("poke")).toBe("quiet");
    t.w.now = Date.parse("2026-10-25T06:59:00Z");
    expect(await t.host.player.trigger("poke")).toBe("quiet");
    t.w.now = Date.parse("2026-10-25T07:00:00Z");
    expect(await t.host.player.trigger("poke")).toBe("played");
    expect(t.played).toHaveLength(2);
  });

  it("reads quiet hours in their own time zone", async () => {
    const t = setup({ quietHours: { timezone: "Asia/Tokyo", start: "21:00", end: "06:00" } });
    await loaded(t.host);
    // 12:00 UTC is 21:00 in Tokyo.
    expect(await t.host.player.trigger("poke")).toBe("quiet");
  });

  it("treats a malformed quiet-hours window as quiet", async () => {
    const t = setup({ quietHours: { timezone: "Nowhere/Land", start: "22:00", end: "07:00" } });
    await loaded(t.host);
    expect(await t.host.player.trigger("poke")).toBe("quiet");
  });

  it("is silent while muted, and plays again when unmuted", async () => {
    const t = setup();
    await loaded(t.host);
    t.host.setMuted(true);
    expect(await t.host.player.trigger("poke")).toBe("muted");
    t.host.setMuted(false);
    expect(await t.host.player.trigger("poke")).toBe("played");
    expect(t.played).toHaveLength(1);
  });

  it("is silent under the emergency stop, and at once when it is engaged", async () => {
    const stopped = setup({ killSwitch: true });
    await loaded(stopped.host);
    expect(await stopped.host.player.trigger("poke")).toBe("quiet");

    const live = setup();
    await loaded(live.host);
    const off = live.host.attach();
    expect(await live.host.player.trigger("poke")).toBe("played");
    live.w.killSwitch = true;
    emit(live.client, "security.kill_switch.engaged", {});
    expect(live.host.isQuiet()).toBe(true);
    expect(await live.host.player.trigger("poke")).toBe("quiet");
    expect(live.played).toHaveLength(1);
    off();
  });

  it("is silent in the demo", async () => {
    const t = setup();
    await loaded(t.host);
    t.host.setDemo(true);
    expect(await t.host.player.trigger("poke")).toBe("quiet");
    expect(await t.host.preview("poke", 50)).toBe("quiet");
    t.host.setDemo(false);
    expect(await t.host.player.trigger("poke")).toBe("played");
    expect(t.played).toHaveLength(1);
  });

  it("fails silent when Core cannot say whether it is quiet", async () => {
    const down = setup({ notificationsFail: true });
    await loaded(down.host);
    expect(await down.host.player.trigger("poke")).toBe("quiet");
    const broken = setup({ proactive: 500 });
    await loaded(broken.host);
    expect(await broken.host.player.trigger("poke")).toBe("quiet");
    expect(down.played).toEqual([]);
    expect(broken.played).toEqual([]);
  });

  it("has no quiet hours to honour when this Core has no proactive service", async () => {
    const t = setup({ proactive: 404 });
    await loaded(t.host);
    expect(await t.host.player.trigger("poke")).toBe("played");
  });

  it("asks Core again once its answer is older than maxAgeMs", async () => {
    const t = setup({}, { maxAgeMs: 1_000 });
    await loaded(t.host);
    expect(await t.host.player.trigger("poke")).toBe("played");
    const asked = () => t.api.calls.filter((c) => c.path === "/api/notifications/preferences");
    expect(asked()).toHaveLength(1);
    await t.host.player.trigger("poke");
    expect(asked()).toHaveLength(1);
    t.w.notificationsEnabled = false; // the user turned on quiet mode meanwhile
    t.w.now += 2_000;
    expect(await t.host.player.trigger("poke")).toBe("quiet");
    expect(asked()).toHaveLength(2);
  });

  it("waits for a user gesture, and a script cannot fake one", async () => {
    const t = setup({}, { gesture: false });
    await loaded(t.host);
    expect(await t.host.player.trigger("poke")).toBe("no-gesture");
    t.setGesture(true);
    expect(await t.host.player.trigger("poke")).toBe("played");
    expect(t.played).toHaveLength(1);
  });

  it("does not count a synthetic event as a gesture, but a trusted one is not needed again after", async () => {
    const w = world();
    const api = fakeApi(routes(w));
    const client = new PhoenixClient({
      token: "tok",
      baseUrl: "http://127.0.0.1:4870",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: api.fetchImpl,
    });
    const played: Played[] = [];
    const host = soundHostFor(client, {
      backend: { play: async (wav, volume) => void played.push({ bytes: wav.byteLength, volume }) },
      now: () => w.now,
    });
    await host.reload();
    const off = host.attach();
    window.dispatchEvent(new Event("pointerdown")); // untrusted: made by a script
    expect(await host.player.trigger("poke")).toBe("no-gesture");
    expect(played).toEqual([]);
    off();
  });

  it("never throws: a failing or hanging backend is reported as failed", async () => {
    const throws = setup({}, { backend: "throws" });
    await loaded(throws.host);
    expect(await throws.host.player.trigger("poke")).toBe("failed");
    expect(await throws.host.preview("poke", 50)).toBe("failed");

    const hangs = setup({}, { backend: "hangs" });
    await loaded(hangs.host);
    expect(await hangs.host.player.trigger("poke")).toBe("failed");
  });

  it("stays silent when the saved settings cannot be read or are malformed", async () => {
    const t = setup();
    t.api.set("GET /api/ui/sounds", () => ({ enabled: "yes", volume: 500 }));
    await loaded(t.host);
    expect(t.host.getSnapshot().failed).toBe(true);
    expect(await t.host.player.trigger("poke")).toBe("disabled");
    t.api.set("GET /api/ui/sounds", () => {
      throw new Error("down");
    });
    await loaded(t.host);
    expect(await t.host.player.trigger("poke")).toBe("disabled");
    expect(t.played).toEqual([]);
  });

  it("the browser backend fails without Web Audio instead of throwing at load", async () => {
    const backend = browserSoundBackend(); // creating it touches no audio API
    await expect(backend.play(new Uint8Array(44), 0.5)).rejects.toThrow();
  });
});

describe("the sound host: settings", () => {
  it("saves the switch and volume in Core and follows a change from another window", async () => {
    const t = setup({ sounds: { enabled: false, volume: 60 } });
    const off = t.host.attach();
    await waitFor(() => expect(t.host.getSnapshot().prefs).toEqual({ enabled: false, volume: 60 }));
    expect(await t.host.save({ enabled: true })).toBe(true);
    expect(t.api.posts("/api/ui/sounds").map((c) => c.body)).toEqual([{ enabled: true }]);
    expect(t.host.getSnapshot().prefs).toEqual({ enabled: true, volume: 60 });
    emit(t.client, "ui.sounds.changed", { enabled: false, volume: 10 });
    expect(t.host.getSnapshot().prefs).toEqual({ enabled: false, volume: 10 });
    off();
  });

  it("keeps the old settings when Core refuses a save", async () => {
    const t = setup({ sounds: { enabled: false, volume: 60 } });
    await loaded(t.host);
    t.api.set(
      "POST /api/ui/sounds",
      () =>
        new Response(JSON.stringify({ code: "INVALID_REQUEST", message: "no" }), { status: 400 }),
    );
    expect(await t.host.save({ volume: 10 })).toBe(false);
    expect(t.host.getSnapshot().prefs).toEqual({ enabled: false, volume: 60 });
  });

  it("accepts only a boolean and a whole percent", () => {
    expect(parseSoundPrefs({ enabled: true, volume: 0 })).toEqual({ enabled: true, volume: 0 });
    for (const bad of [
      null,
      "x",
      {},
      { enabled: 1, volume: 5 },
      { enabled: true, volume: 101 },
      { enabled: true, volume: -1 },
      { enabled: true, volume: 1.5 },
      { enabled: true, volume: "5" },
    ])
      expect(parseSoundPrefs(bad)).toBeNull();
  });
});

describe("preview", () => {
  it("plays while sounds are off, at the volume given, and never changes the saved switch", async () => {
    const t = setup({ sounds: { enabled: false, volume: 60 } });
    await loaded(t.host);
    expect(await t.host.preview("dizzy", 25)).toBe("played");
    expect(t.played.map((p) => p.volume)).toEqual([0.25]);
    expect(t.host.getSnapshot().prefs?.enabled).toBe(false);
    expect(t.api.posts("/api/ui/sounds")).toEqual([]);
    // The real trigger is still off.
    expect(await t.host.player.trigger("dizzy")).toBe("disabled");
  });

  it("is silent when muted, at volume 0, in quiet mode, in quiet hours, under the stop or without a gesture", async () => {
    const muted = setup();
    await loaded(muted.host);
    muted.host.setMuted(true);
    expect(await muted.host.preview("poke", 50)).toBe("muted");

    const zero = setup();
    await loaded(zero.host);
    expect(await zero.host.preview("poke", 0)).toBe("silent-volume");

    const quiet = setup({ notificationsEnabled: false });
    await loaded(quiet.host);
    expect(await quiet.host.preview("poke", 50)).toBe("quiet");

    const hours = setup({ quietHours: NIGHT_HOURS, now: LATE });
    await loaded(hours.host);
    expect(await hours.host.preview("poke", 50)).toBe("quiet");

    const stopped = setup({ killSwitch: true });
    await loaded(stopped.host);
    expect(await stopped.host.preview("poke", 50)).toBe("quiet");

    const still = setup({}, { gesture: false });
    await loaded(still.host);
    expect(await still.host.preview("poke", 50)).toBe("no-gesture");

    for (const t of [muted, zero, quiet, hours, stopped, still]) expect(t.played).toEqual([]);
  });
});

function mountSection(t: ReturnType<typeof setup>) {
  render(
    <CoreProvider client={t.client}>
      <SoundSettingsSection />
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return screen.getByRole("heading", { name: "Fawkes sounds" }).closest("section")!;
}

describe("Settings > Fawkes sounds", () => {
  it("shows sounds off by default, saves the switch, and previews each event", async () => {
    const t = setup({ sounds: { enabled: false, volume: 60 } });
    const section = mountSection(t);
    const toggle = await within(section).findByRole("checkbox", { name: "Let Fawkes make sounds" });
    await waitFor(() => expect((toggle as HTMLInputElement).disabled).toBe(false));
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect((within(section).getByRole("slider") as HTMLInputElement).value).toBe("60");
    expect(within(section).getAllByRole("button")).toHaveLength(7);

    fireEvent.click(within(section).getByRole("button", { name: "Play: Poke" }));
    await waitFor(() => expect(t.played).toHaveLength(1));
    expect(t.played[0]!.volume).toBeCloseTo(0.6, 5);

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(t.api.posts("/api/ui/sounds").map((c) => c.body)).toEqual([{ enabled: true }]),
    );
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
  });

  it("saves the volume once, when the slider is released, and previews at the slider's value", async () => {
    const t = setup({ sounds: { enabled: true, volume: 60 } });
    const section = mountSection(t);
    const slider = (await within(section).findByRole("slider")) as HTMLInputElement;
    await waitFor(() => expect(slider.disabled).toBe(false));
    fireEvent.change(slider, { target: { value: "20" } });
    fireEvent.change(slider, { target: { value: "30" } });
    expect(t.api.posts("/api/ui/sounds")).toEqual([]);
    expect(slider.getAttribute("aria-valuetext")).toBe("30 percent");
    fireEvent.click(within(section).getByRole("button", { name: "Play: Needs you" }));
    await waitFor(() => expect(t.played).toHaveLength(1));
    expect(t.played[0]!.volume).toBeCloseTo(0.3, 5);
    fireEvent.blur(slider);
    await waitFor(() =>
      expect(t.api.posts("/api/ui/sounds").map((c) => c.body)).toEqual([{ volume: 30 }]),
    );
  });

  it("says why a preview was silent", async () => {
    const t = setup({ notificationsEnabled: false });
    const section = mountSection(t);
    await waitFor(() =>
      expect((within(section).getByRole("slider") as HTMLInputElement).disabled).toBe(false),
    );
    fireEvent.click(within(section).getByRole("button", { name: "Play: Hello" }));
    expect((await within(section).findByRole("status")).textContent).toMatch(/Quiet mode/);

    t.setGesture(false);
    t.w.notificationsEnabled = true;
    t.w.now += 1e13; // Core's answer is stale: read again
    fireEvent.click(within(section).getByRole("button", { name: "Play: Hello" }));
    await waitFor(() =>
      expect(within(section).getByRole("status").textContent).toMatch(/Click or press a key/),
    );
    expect(t.played).toEqual([]);
  });

  it("offers no controls and says so when the settings cannot be loaded", async () => {
    const t = setup();
    t.api.set("GET /api/ui/sounds", () => new Response("{}", { status: 500 }));
    const section = mountSection(t);
    expect((await within(section).findByRole("alert")).textContent).toBe(
      "Could not load the sound settings.",
    );
    expect(within(section).queryByRole("slider")).toBeNull();
  });
});

describe("the app host", () => {
  it("mounts the section in Settings and plays Fawkes' own sounds through the host", async () => {
    const t = setup({ sounds: { enabled: true, volume: 50 } });
    window.location.hash = "#/settings";
    render(
      <CoreProvider client={t.client}>
        <App />
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    expect(await screen.findByRole("heading", { name: "Fawkes sounds" })).toBeTruthy();
    await waitFor(() => expect(t.host.getSnapshot().prefs).toEqual({ enabled: true, volume: 50 }));

    // A click pokes the pet; its sound goes through the host's policy.
    const avatar = screen.getAllByRole("button", { name: /^Fawkes/ })[0]!;
    act(() => {
      avatar.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }),
      );
      avatar.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }),
      );
      avatar.click();
    });
    await waitFor(() => expect(t.played.length).toBeGreaterThan(0));
    expect(t.played.every((p) => p.volume === 0.5)).toBe(true);

    // Quiet mode turned on: the next sound is not played.
    const heard = t.played.length;
    t.w.notificationsEnabled = false;
    t.w.now += 1e13;
    for (let i = 0; i < 3; i++) {
      act(() => {
        avatar.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }),
        );
        avatar.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }),
        );
        avatar.click();
      });
      await act(async () => {});
    }
    expect(t.played.length).toBe(heard);
  });
});

export type { FakeApi };
