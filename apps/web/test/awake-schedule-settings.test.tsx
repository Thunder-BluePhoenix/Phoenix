// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScheduledAwakeSection } from "../src/components/ScheduledAwakeSettings";
import { StatusLightsSection } from "../src/components/StatusLightsSettings";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { I18nProvider } from "../src/i18n";
import { fakeApi, type FakeApi } from "./fake-api";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { capability } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
});

function mount(routes: Parameters<typeof fakeApi>[0]) {
  const api = fakeApi(routes);
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <I18nProvider forceLocale="en">
        <ScheduledAwakeSection />
        <StatusLightsSection />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return api;
}

const refusal = (status: number, message: string) =>
  new Response(JSON.stringify({ code: "INVALID_REQUEST", message }), { status });

const NIGHT = {
  id: "night",
  timeZone: "Europe/Paris",
  start: "22:00",
  end: "06:00",
  recurrence: { kind: "weekly", days: [1, 2] },
  wake: false,
  power: { requireCharger: false, minBatteryPercent: 20, allowLowPowerMode: false },
};

const view = (over: Record<string, unknown> = {}) => ({
  enabled: false,
  state: "off",
  waitingReason: null,
  holdEndsAt: null,
  schedules: [],
  upcoming: [],
  merged: [],
  skips: [],
  wakeAvailable: false,
  wakes: [],
  awakeAvailable: true,
  ...over,
});

const awakeSection = async () =>
  within(
    (await screen.findByRole("heading", { name: "Scheduled keep-awake" })).closest("section")!,
  );
const lightsSection = async () =>
  within((await screen.findByRole("heading", { name: "Status lights" })).closest("section")!);

const writes = (api: ReturnType<typeof fakeApi>) => api.calls.filter((c) => c.method !== "GET");

describe("scheduled keep-awake", () => {
  it("starts off, asks only after the box is ticked, and shows the wait for Approvals", async () => {
    const gate = Promise.withResolvers<unknown>();
    const api = mount({
      "GET /api/scheduled-awake": () => view(),
      "PUT /api/scheduled-awake": () => gate.promise,
    });
    const s = await awakeSection();
    await s.findByText("Scheduled keep-awake is off.");
    const box = s.getByRole("checkbox", {
      name: "Keep this computer awake during my saved windows",
const writes = (api: FakeApi) => api.calls.filter((c) => c.method !== "GET");
    expect(box.checked).toBe(false);
    expect(s.queryByText("Waiting for you to confirm in Approvals…")).toBeNull();
    expect(writes(api)).toEqual([]);

    fireEvent.click(box);
    await s.findByText("Waiting for you to confirm in Approvals…");
    expect(writes(api)).toEqual([
      { method: "PUT", path: "/api/scheduled-awake", body: { enabled: true } },
    ]);

    await act(async () => gate.resolve(view({ enabled: true, state: "idle" })));
    await s.findByText("Scheduled keep-awake is on. No window is running right now.");
    expect(s.queryByText("Waiting for you to confirm in Approvals…")).toBeNull();
    expect((s.getByRole("checkbox", { name: /Keep this computer awake/ }) as HTMLInputElement).checked)
      .toBe(true);
  });

  it("shows a refusal and stays off", async () => {
    mount({
      "GET /api/scheduled-awake": () => view(),
      "PUT /api/scheduled-awake": () => refusal(403, "The request was denied"),
    });
    const s = await awakeSection();
    const box = (await s.findByRole("checkbox", {
      name: /Keep this computer awake/,
    })) as HTMLInputElement;
    fireEvent.click(box);
    expect((await s.findByRole("alert")).textContent).toBe("The request was denied");
    expect(box.checked).toBe(false);
    expect(s.queryByText("Waiting for you to confirm in Approvals…")).toBeNull();
  });

  it("warns when the Keep awake capability is not enabled", async () => {
    mount({ "GET /api/scheduled-awake": () => view({ awakeAvailable: false }) });
    const s = await awakeSection();
    await s.findByText(/The Keep awake capability is not enabled/);
  });

  it("does not warn when it is enabled", async () => {
    mount({ "GET /api/scheduled-awake": () => view() });
    const s = await awakeSection();
    await s.findByText("Scheduled keep-awake is off.");
    expect(s.queryByText(/The Keep awake capability is not enabled/)).toBeNull();
  });

  it("says not available on a 404 and shows no controls", async () => {
    mount({});
    const s = await awakeSection();
    await s.findByText(/Scheduled keep-awake is not available/);
    expect(s.queryByRole("checkbox")).toBeNull();
    expect(s.queryByRole("button")).toBeNull();
  });

  it("saves a window with exactly the documented body", async () => {
    const api = mount({
      "GET /api/scheduled-awake": () => view(),
      "POST /api/scheduled-awake/schedules": () => view({ schedules: [NIGHT] }),
    });
    const s = await awakeSection();
    await s.findByText("Scheduled keep-awake is off.");
    fireEvent.change(s.getByLabelText(/^Name/), { target: { value: "night" } });
    fireEvent.change(s.getByLabelText(/^Label/), { target: { value: "Night shift" } });
    fireEvent.change(s.getByLabelText("Time zone"), { target: { value: "Europe/Paris" } });
    fireEvent.click(s.getByRole("checkbox", { name: "Wed" }));
    fireEvent.click(s.getByRole("checkbox", { name: "Mon" }));
    fireEvent.click(s.getByRole("checkbox", { name: "Only while plugged in" }));
    fireEvent.change(s.getByLabelText(/^Minimum battery/), { target: { value: "30" } });
    fireEvent.click(s.getByRole("button", { name: "Save window" }));

    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(writes(api)[0]).toEqual({
      method: "POST",
      path: "/api/scheduled-awake/schedules",
      body: {
        id: "night",
        label: "Night shift",
        timeZone: "Europe/Paris",
        start: "22:00",
        end: "06:00",
        days: [1, 3],
        requireCharger: true,
        minBatteryPercent: 30,
      },
    });
    expect("date" in (writes(api)[0]!.body as object)).toBe(false);
    await s.findByText(/Europe\/Paris/);
  });

  it("omits the label when it is empty, and shows Core's message for a rejected window", async () => {
    const api = mount({
      "GET /api/scheduled-awake": () => view(),
      "POST /api/scheduled-awake/schedules": () => refusal(400, "start and end must differ"),
    });
    const s = await awakeSection();
    await s.findByText("Scheduled keep-awake is off.");
    fireEvent.change(s.getByLabelText(/^Name/), { target: { value: "night" } });
    fireEvent.change(s.getByLabelText("Time zone"), { target: { value: "UTC" } });
    fireEvent.click(s.getByRole("checkbox", { name: "Sun" }));
    fireEvent.click(s.getByRole("button", { name: "Save window" }));
    expect((await s.findByRole("alert")).textContent).toBe("start and end must differ");
    expect(writes(api)[0]?.body).toEqual({
      id: "night",
      timeZone: "UTC",
      start: "22:00",
      end: "06:00",
      days: [0],
      requireCharger: false,
      minBatteryPercent: 20,
    });
    // The form keeps what was typed so it can be corrected.
    expect((s.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("night");
  });

  it("removes a window by its URL-safe id", async () => {
    const odd = { ...NIGHT, id: "a/b" };
    const api = mount({
      "GET /api/scheduled-awake": () => view({ schedules: [odd] }),
      "DELETE /api/scheduled-awake/schedules/a/b": () => view(),
    });
    const s = await awakeSection();
    fireEvent.click(await s.findByRole("button", { name: "Remove a/b" }));
    await s.findByText("No windows saved.");
    expect(writes(api)).toEqual([
      { method: "DELETE", path: "/api/scheduled-awake/schedules/a%2Fb", body: undefined },
    ]);
  });

  it("describes a window by label, days, times and zone", async () => {
    mount({
      "GET /api/scheduled-awake": () =>
        view({ schedules: [{ ...NIGHT, label: "Night shift" }] }),
    });
    const s = await awakeSection();
    await s.findByText("Night shift");
    expect(s.getByText("Mon, Tue, 22:00–06:00 (Europe/Paris)")).toBeTruthy();
  });

  it("says why a window waits, and falls back for a code it does not know", async () => {
    let reason = "needs_charger";
    mount({
      "GET /api/scheduled-awake": () =>
        view({ enabled: true, state: "waiting", waitingReason: reason }),
    });
    const s = await awakeSection();
    await s.findByText("A window is waiting to start because this computer is not plugged in.");
    cleanup();
    reason = "from_the_future";
    mount({
      "GET /api/scheduled-awake": () =>
        view({ enabled: true, state: "waiting", waitingReason: reason }),
    });
    const again = await awakeSection();
    await again.findByText(
      "A window is waiting to start because of a reason this version does not recognise.",
    );
  });

  it("offers to cancel only while holding", async () => {
    const holdEndsAt = Date.parse("2026-10-23T06:00:00Z");
    const api = mount({
      "GET /api/scheduled-awake": () => view({ enabled: true, state: "holding", holdEndsAt }),
      "POST /api/scheduled-awake/cancel-current": () => ({
        status: view({ enabled: true, state: "idle" }),
        skipped: ["night@2026-10-23"],
      }),
    });
    const s = await awakeSection();
    fireEvent.click(await s.findByRole("button", { name: "Cancel the current window" }));
    await waitFor(() => expect(s.queryByRole("button", { name: "Cancel the current window" })).toBeNull());
    expect(writes(api)[0]).toEqual({
      method: "POST",
      path: "/api/scheduled-awake/cancel-current",
      body: {},
    });
  });

  it("skips and unskips an upcoming window by its key", async () => {
    const key = "night@2026-10-24";
    let skipped = false;
    const upcoming = () => [
      {
        key,
        scheduleId: "night",
        startsAt: Date.parse("2026-10-24T20:00:00Z"),
        endsAt: Date.parse("2026-10-25T04:00:00Z"),
        skipped,
      },
    ];
    const api = mount({
      "GET /api/scheduled-awake": () => view({ schedules: [NIGHT], upcoming: upcoming() }),
      "POST /api/scheduled-awake/skips": () => {
        skipped = true;
        return view({ schedules: [NIGHT], upcoming: upcoming() });
      },
      [`DELETE /api/scheduled-awake/skips/${key}`]: () => {
        skipped = false;
        return view({ schedules: [NIGHT], upcoming: upcoming() });
      },
    });
    const s = await awakeSection();
    fireEvent.click(await s.findByRole("button", { name: /^Skip night/ }));
    const unskip = await s.findByRole("button", { name: /^Unskip night/ });
    fireEvent.click(unskip);
    await s.findByRole("button", { name: /^Skip night/ });
    expect(writes(api)).toEqual([
      { method: "POST", path: "/api/scheduled-awake/skips", body: { key } },
      { method: "DELETE", path: `/api/scheduled-awake/skips/${encodeURIComponent(key)}`, body: undefined },
    ]);
  });
});

describe("status lights", () => {
  const DESK = { id: "desk", kind: "key-light", address: "192.168.1.20", port: 9123 };

  function mountLights(config: Record<string, unknown>, extra: Parameters<typeof fakeApi>[0] = {}) {
    return mount({
      "GET /api/status-lights/devices": () => ({ lights: [DESK] }),
      "GET /api/capabilities": () => ({
        capabilities: [capability("status-lights", "enabled", config)],
      }),
      ...extra,
    });
  }

  it("adds a light by replacing the whole list, keeping the ones already there", async () => {
    const added = { id: "shelf", kind: "key-light", address: "10.0.0.5", port: 9123 };
    const api = mountLights(
      {},
      { "PUT /api/status-lights/devices": () => ({ lights: [DESK, added] }) },
    );
    const s = await lightsSection();
    await s.findByText("desk");
    fireEvent.change(s.getByLabelText("Name"), { target: { value: "shelf" } });
    fireEvent.change(s.getByLabelText(/^Address on your network/), {
      target: { value: "10.0.0.5" },
    });
    fireEvent.click(s.getByRole("button", { name: "Add light" }));
    await s.findByText("shelf");
    expect(writes(api)).toEqual([
      {
        method: "PUT",
        path: "/api/status-lights/devices",
        body: {
          lights: [
            { id: "desk", kind: "key-light", address: "192.168.1.20", port: 9123 },
            { id: "shelf", kind: "key-light", address: "10.0.0.5" },
          ],
        },
      },
    ]);
  });

  it("shows Core's message for an address that is not on the local network", async () => {
    mountLights(
      {},
      {
        "PUT /api/status-lights/devices": () =>
          refusal(400, "address must be an IPv4 address on your own network"),
      },
    );
    const s = await lightsSection();
    await s.findByText("desk");
    fireEvent.change(s.getByLabelText("Name"), { target: { value: "bad" } });
    fireEvent.change(s.getByLabelText(/^Address on your network/), {
      target: { value: "8.8.8.8" },
    });
    fireEvent.click(s.getByRole("button", { name: "Add light" }));
    expect((await s.findByRole("alert")).textContent).toBe(
      "address must be an IPv4 address on your own network",
    );
    expect(s.queryByText("bad")).toBeNull();
  });

  it("removes a light by sending the list without it", async () => {
    const api = mountLights({}, { "PUT /api/status-lights/devices": () => ({ lights: [] }) });
    const s = await lightsSection();
    fireEvent.click(await s.findByRole("button", { name: "Remove desk" }));
    await s.findByText("No lights added.");
    expect(writes(api)[0]?.body).toEqual({ lights: [] });
  });

  it("saves consent as the capability's device list, keeping the other ids", async () => {
    const api = mountLights({ devices: ["other"] });
    const s = await lightsSection();
    const box = (await s.findByRole("checkbox", {
      name: "Allow Fawkes to light desk",
    })) as HTMLInputElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() =>
      expect(api.posts("/api/capabilities/status-lights/config")).toEqual([
        {
          method: "POST",
          path: "/api/capabilities/status-lights/config",
          body: { config: { devices: ["other", "desk"] } },
        },
      ]),
    );
    // A running capability reads consent when it starts, so it is restarted.
    await waitFor(() =>
      expect(writes(api).map((c) => c.path)).toEqual([
        "/api/capabilities/status-lights/config",
        "/api/capabilities/status-lights/disable",
        "/api/capabilities/status-lights/enable",
      ]),
    );
  });

  it("removes consent for one light and leaves the rest", async () => {
    const api = mountLights({ devices: ["desk", "other"] });
    const s = await lightsSection();
    const box = (await s.findByRole("checkbox", {
      name: "Allow Fawkes to light desk",
    })) as HTMLInputElement;
    await waitFor(() => expect(box.checked).toBe(true));
    fireEvent.click(box);
    await waitFor(() =>
      expect(api.posts("/api/capabilities/status-lights/config")[0]?.body).toEqual({
        config: { devices: ["other"] },
      }),
    );
  });

  it("offers to enable the capability when it is off", async () => {
    const api = mount({
      "GET /api/status-lights/devices": () => ({ lights: [DESK] }),
      "GET /api/capabilities": () => ({
        capabilities: [capability("status-lights", "installed")],
      }),
    });
    const s = await lightsSection();
    await s.findByText(/The Status lights capability is not enabled/);
    fireEvent.click(s.getByRole("button", { name: "Enable" }));
    await waitFor(() =>
      expect(api.posts("/api/capabilities/status-lights/enable")).toEqual([
        { method: "POST", path: "/api/capabilities/status-lights/enable", body: {} },
      ]),
    );
  });

  it("says not available on a 404 and shows no controls", async () => {
    mount({});
    const s = await lightsSection();
    await s.findByText(/Status lights are not available/);
    expect(s.queryByRole("checkbox")).toBeNull();
    expect(s.queryByRole("button")).toBeNull();
  });

  it("states that only fixed colours are sent and only Key Light is supported", async () => {
    mountLights({});
    const s = await lightsSection();
    await s.findByText(/Only fixed colours are sent/);
    expect(s.getByText(/Only the Elgato Key Light is supported/)).toBeTruthy();
  });
});
