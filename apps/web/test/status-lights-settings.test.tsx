// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StatusLightsSection } from "../src/components/StatusLightsSettings";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { deviceText, formatFingerprint, validQuietHours } from "../src/core/status-lights";
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

// Built from parts so no credential-shaped literal sits in the source tree.
const STORED = ["stored", "value", "that", "must", "never", "render"].join("-");
const TYPED = ["typed", "luxafor", "value", "123456"].join("_");
const PRINT = "ab".repeat(32);
const PRINT_TEXT = formatFingerprint(PRINT);
const RESOURCE = "0a1b2c3d-0000-4000-8000-000000000001";
const BRIDGE = { id: "den", address: "192.168.1.2", port: 443, fingerprint: PRINT };

function mount(routes: Parameters<typeof fakeApi>[0]): FakeApi {
  const api = fakeApi({
    "GET /api/status-lights/devices": () => ({ lights: [] }),
    "GET /api/status-lights/hue/bridges": () => ({ bridges: [] }),
    "GET /api/capabilities": () => ({ capabilities: [capability("status-lights", "enabled", {})] }),
    ...routes,
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
        <StatusLightsSection />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return api;
}

const refusal = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ code, message }), { status });
const section = async () =>
  within((await screen.findByRole("heading", { name: "Status lights" })).closest("section")!);
/** The `lights` array of a PUT body the fake Core received. */
function sentLights(body: unknown): unknown[] {
  if (typeof body === "object" && body !== null && "lights" in body && Array.isArray(body.lights))
    return body.lights;
  return [];
}
const writes = (api: FakeApi) => api.calls.filter((c) => c.method !== "GET");

const INSPECT = {
  address: "192.168.1.2",
  port: 443,
  fingerprint: PRINT,
  common_name: "001788fffe123456",
};

async function inspect(s: Awaited<ReturnType<typeof section>>) {
  fireEvent.change(await s.findByLabelText("Name for this bridge"), { target: { value: "den" } });
  fireEvent.change(s.getByLabelText(/^Bridge address on your network/), {
    target: { value: "192.168.1.2" },
  });
  fireEvent.click(s.getByRole("button", { name: "Read the bridge certificate" }));
  await s.findByTestId("hue-fingerprint");
}

describe("Hue pairing", () => {
  it("shows the address and fingerprint as text and pins nothing until the confirm box is ticked", async () => {
    const api = mount({ "POST /api/status-lights/hue/inspect": () => INSPECT });
    const s = await section();
    await inspect(s);
    expect(s.getByTestId("hue-fingerprint").textContent).toBe(PRINT_TEXT);
    expect(s.getByText("A bridge answered at 192.168.1.2:443.")).toBeTruthy();
    expect(s.getByText(/Press the round link button on top of the bridge now/)).toBeTruthy();
    const pairButton = s.getByRole("button", {
      name: "Pair and pin this fingerprint",
    }) as HTMLButtonElement;
    expect(pairButton.disabled).toBe(true);
    fireEvent.click(pairButton);
    expect(api.posts("/api/status-lights/hue/bridges")).toEqual([]);
    // The inspect step sent nothing but the address.
    expect(api.posts("/api/status-lights/hue/inspect")[0]?.body).toEqual({
      address: "192.168.1.2",
    });
  });

  it("pairs with the exact fingerprint shown once the owner confirms", async () => {
    let bridges: unknown[] = [];
    const api = mount({
      "GET /api/status-lights/hue/bridges": () => ({ bridges }),
      "POST /api/status-lights/hue/inspect": () => INSPECT,
      "POST /api/status-lights/hue/bridges": () => {
        bridges = [BRIDGE];
        return { bridge: BRIDGE };
      },
    });
    const s = await section();
    await inspect(s);
    fireEvent.click(s.getByRole("checkbox", { name: /I compared this fingerprint/ }));
    fireEvent.click(s.getByRole("button", { name: "Pair and pin this fingerprint" }));
    await s.findByRole("button", { name: "Remove bridge den" });
    expect(api.posts("/api/status-lights/hue/bridges")[0]?.body).toEqual({
      id: "den",
      address: "192.168.1.2",
      port: 443,
      fingerprint: PRINT,
    });
    expect(s.getByText(PRINT_TEXT)).toBeTruthy();
    // The confirmation panel is gone and cannot be reused for another bridge.
    expect(s.queryByTestId("hue-fingerprint")).toBeNull();
  });

  it("drops the confirmation when the address changes, so an old fingerprint cannot be pinned for a new one", async () => {
    const api = mount({ "POST /api/status-lights/hue/inspect": () => INSPECT });
    const s = await section();
    await inspect(s);
    fireEvent.click(s.getByRole("checkbox", { name: /I compared this fingerprint/ }));
    fireEvent.change(s.getByLabelText(/^Bridge address on your network/), {
      target: { value: "192.168.1.9" },
    });
    expect(s.queryByTestId("hue-fingerprint")).toBeNull();
    expect(api.posts("/api/status-lights/hue/bridges")).toEqual([]);
  });

  it("explains a link-button failure with a fixed text, not Core's words", async () => {
    mount({
      "POST /api/status-lights/hue/inspect": () => INSPECT,
      "POST /api/status-lights/hue/bridges": () =>
        refusal(400, "INVALID_REQUEST", "Press the round link button <b>x</b> raw core text"),
    });
    const s = await section();
    await inspect(s);
    fireEvent.click(s.getByRole("checkbox", { name: /I compared this fingerprint/ }));
    fireEvent.click(s.getByRole("button", { name: "Pair and pin this fingerprint" }));
    expect((await s.findByRole("alert")).textContent).toBe(
      "Pairing failed. Press the round link button on the bridge, then try again.",
    );
  });

  it("refuses a bridge name Core would refuse, before asking the bridge anything", async () => {
    const api = mount({});
    const s = await section();
    fireEvent.change(await s.findByLabelText("Name for this bridge"), {
      target: { value: "bad name!" },
    });
    fireEvent.click(s.getByRole("button", { name: "Read the bridge certificate" }));
    expect((await s.findByRole("alert")).textContent).toMatch(/^Give the bridge a name/);
    expect(api.posts("/api/status-lights/hue/inspect")).toEqual([]);
  });

  it("lists paired bridges and removes one", async () => {
    let bridges: unknown[] = [BRIDGE];
    const api = mount({
      "GET /api/status-lights/hue/bridges": () => ({ bridges }),
      "DELETE /api/status-lights/hue/bridges/*": () => {
        bridges = [];
        return { removed: true };
      },
    });
    const s = await section();
    await s.findByText("den");
    expect(s.getByText(PRINT_TEXT)).toBeTruthy();
    fireEvent.click(s.getByRole("button", { name: "Remove bridge den" }));
    await s.findByText("No bridge paired.");
    expect(writes(api)).toEqual([
      { method: "DELETE", path: "/api/status-lights/hue/bridges/den", body: {} },
    ]);
  });

  it("shows a bridge's light names as inert text, stripped of control and bidi characters, and adds one explicitly", async () => {
    const hostile = "Lamp\u202e<img src=x onerror=alert(1)>\u0007\u200f";
    const api = mount({
      "GET /api/status-lights/hue/bridges": () => ({ bridges: [BRIDGE] }),
      "GET /api/status-lights/hue/bridges/*": () => ({}),
      "GET /api/status-lights/hue/bridges/den/lights": () => ({
        lights: [{ id: RESOURCE, name: hostile }],
      }),
      "PUT /api/status-lights/devices": (body) => body,
    });
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Show the lights on bridge den" }));
    const shown = "Lamp<img src=x onerror=alert(1)>";
    await s.findByText(shown);
    expect(document.querySelector("img")).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/[\u202e\u200f\u0007]/);
    // Nothing is provisioned until the owner presses Add.
    expect(writes(api)).toEqual([]);
    fireEvent.click(s.getByRole("button", { name: `Add Hue light ${shown}` }));
    await waitFor(() => expect(writes(api).length).toBe(1));
    expect(writes(api)[0]?.body).toEqual({
      lights: [{ id: "hue-den-0a1b2c3d", kind: "hue", bridge: "den", resource: RESOURCE }],
    });
  });
});

describe("Luxafor", () => {
  const LUX = { id: "desk", kind: "luxafor", address: "192.168.1.30", port: 5383 };

  it("sends the token write-only, clears the field at once and never renders a stored value", async () => {
    const api = mount({
      "GET /api/status-lights/devices": () => ({
        // A hostile or buggy Core that echoes a credential must not get it onto the page.
        lights: [{ ...LUX, token: STORED, secret: STORED, application_key: STORED }],
      }),
      "GET /api/status-lights/hue/bridges": () => ({
        bridges: [{ ...BRIDGE, application_key: STORED, username: STORED }],
      }),
      "PUT /api/status-lights/luxafor/desk/token": () => ({ stored: true, token: STORED }),
    });
    const s = await section();
    await s.findByText("desk");
    const field = s.getByLabelText("Webhook token for desk") as HTMLInputElement;
    expect(field.type).toBe("password");
    expect(field.value).toBe("");
    fireEvent.change(field, { target: { value: TYPED } });
    expect(field.value).toBe(TYPED);
    fireEvent.click(s.getByRole("button", { name: "Set or replace token" }));
    await s.findByText("Token saved.");
    expect(field.value).toBe("");
    expect(api.calls.filter((c) => c.method === "PUT" && c.path.endsWith("/token"))).toEqual([
      { method: "PUT", path: "/api/status-lights/luxafor/desk/token", body: { token: TYPED } },
    ]);
    expect(document.body.innerHTML).not.toContain(STORED);
    expect(document.body.innerHTML).not.toContain(TYPED);
    expect(document.body.textContent).not.toContain(STORED);
    for (const input of document.querySelectorAll("input")) {
      expect((input as HTMLInputElement).value).not.toContain(STORED);
      expect((input as HTMLInputElement).value).not.toContain(TYPED);
    }
  });

  it("clears the typed token even when Core refuses, and shows a fixed error", async () => {
    mount({
      "GET /api/status-lights/devices": () => ({ lights: [LUX] }),
      "PUT /api/status-lights/luxafor/desk/token": () =>
        refusal(400, "INVALID_REQUEST", `bad token ${TYPED}`),
    });
    const s = await section();
    await s.findByText("desk");
    const field = s.getByLabelText("Webhook token for desk") as HTMLInputElement;
    fireEvent.change(field, { target: { value: TYPED } });
    fireEvent.click(s.getByRole("button", { name: "Set or replace token" }));
    expect((await s.findByRole("alert")).textContent).toBe(
      "The token was not saved. It needs 1 to 128 printable characters without spaces.",
    );
    expect(field.value).toBe("");
    expect(document.body.innerHTML).not.toContain(TYPED);
  });

  it("says plainly when Core has no credential store", async () => {
    mount({
      "GET /api/status-lights/devices": () => ({ lights: [LUX] }),
      "PUT /api/status-lights/luxafor/desk/token": () =>
        refusal(503, "CAPABILITY_UNAVAILABLE", "raw core text"),
    });
    const s = await section();
    await s.findByText("desk");
    fireEvent.change(s.getByLabelText("Webhook token for desk"), { target: { value: TYPED } });
    fireEvent.click(s.getByRole("button", { name: "Set or replace token" }));
    expect((await s.findByRole("alert")).textContent).toBe(
      "This Phoenix Core has no OS credential store, so a credential cannot be kept.",
    );
  });

  it("adds a Luxafor light by replacing the list, and removing it is how the token is cleared", async () => {
    let lights: unknown[] = [];
    const api = mount({
      "GET /api/status-lights/devices": () => ({ lights }),
      "PUT /api/status-lights/devices": (body) => {
        lights = sentLights(body);
        return { lights };
      },
    });
    const s = await section();
    fireEvent.change(s.getByLabelText("Address of the computer running the Luxafor app"), {
      target: { value: "192.168.1.30" },
    });
    fireEvent.change(await s.findByLabelText("Name of this Luxafor light"), {
      target: { value: "desk" },
    });
    fireEvent.click(s.getByRole("button", { name: "Add Luxafor light" }));
    await s.findByLabelText("Webhook token for desk");
    expect(writes(api)[0]?.body).toEqual({
      lights: [{ id: "desk", kind: "luxafor", address: "192.168.1.30" }],
    });
    fireEvent.click(s.getByRole("button", { name: "Remove desk" }));
    await waitFor(() => expect(s.queryByLabelText("Webhook token for desk")).toBeNull());
    expect(writes(api)[1]?.body).toEqual({ lights: [] });
  });
});

describe("LIFX discovery", () => {
  const FOUND = { mac: "d073d5001122", address: "192.168.1.40", port: 56700, provisioned: false };

  it("discovers only on the button, lists lights as text and adds only the one enabled", async () => {
    let lights: unknown[] = [];
    const api = mount({
      "GET /api/status-lights/devices": () => ({ lights }),
      "POST /api/status-lights/lifx/discover": () => ({
        lights: [FOUND, { ...FOUND, mac: "d073d5003344", address: "192.168.1.41" }],
      }),
      "PUT /api/status-lights/devices": (body) => {
        lights = sentLights(body);
        return { lights };
      },
    });
    const s = await section();
    await s.findByRole("button", { name: "Find LIFX lights" });
    expect(api.posts("/api/status-lights/lifx/discover")).toEqual([]);
    fireEvent.click(s.getByRole("button", { name: "Find LIFX lights" }));
    await s.findByText("LIFX light d073d5001122 at 192.168.1.40");
    s.getByText("LIFX light d073d5003344 at 192.168.1.41");
    // Discovery alone provisioned nothing.
    expect(writes(api).map((c) => c.method + c.path)).toEqual([
      "POST/api/status-lights/lifx/discover",
    ]);
    fireEvent.click(s.getByRole("button", { name: "Add LIFX light d073d5001122" }));
    await waitFor(() => expect(writes(api).length).toBe(2));
    expect(writes(api)[1]?.body).toEqual({
      lights: [
        {
          id: "lifx-d073d5001122",
          kind: "lifx",
          address: "192.168.1.40",
          port: 56700,
          mac: "d073d5001122",
        },
      ],
    });
    // The other found light is still not added.
    expect(s.getByRole("button", { name: "Add LIFX light d073d5003344" })).toBeTruthy();
  });

  it("drops entries that are not shaped like a LIFX light and shows a fixed error on failure", async () => {
    mount({
      "POST /api/status-lights/lifx/discover": () => ({
        lights: [
          { ...FOUND, mac: "<script>x</script>" },
          { ...FOUND, port: 0 },
        ],
      }),
    });
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Find LIFX lights" }));
    await s.findByText("No LIFX light answered.");
    expect(document.body.innerHTML).not.toContain("<script>x");
  });

  it("shows a fixed text when discovery is refused", async () => {
    mount({
      "POST /api/status-lights/lifx/discover": () =>
        refusal(400, "INVALID_REQUEST", "Wait a few seconds between discoveries"),
    });
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Find LIFX lights" }));
    expect((await s.findByRole("alert")).textContent).toBe(
      "LIFX discovery did not finish. Wait a few seconds and try again.",
    );
  });
});

describe("quiet hours", () => {
  it("saves the hours into the capability config, keeping the other settings", async () => {
    const api = mount({
      "GET /api/capabilities": () => ({
        capabilities: [capability("status-lights", "enabled", { devices: ["desk"] })],
      }),
    });
    const s = await section();
    await s.findByText("Quiet hours are off.");
    fireEvent.change(s.getByLabelText("From"), { target: { value: "21:30" } });
    fireEvent.change(s.getByLabelText("Until"), { target: { value: "06:45" } });
    fireEvent.change(s.getByLabelText("Time zone"), { target: { value: "Europe/Paris" } });
    fireEvent.click(s.getByRole("button", { name: "Save quiet hours" }));
    await waitFor(() =>
      expect(api.posts("/api/capabilities/status-lights/config")[0]?.body).toEqual({
        config: {
          devices: ["desk"],
          quiet_hours: { timezone: "Europe/Paris", start: "21:30", end: "06:45" },
        },
      }),
    );
  });

  it("refuses an unknown time zone before sending anything", async () => {
    const api = mount({});
    const s = await section();
    await s.findByText("Quiet hours are off.");
    fireEvent.change(s.getByLabelText("Time zone"), { target: { value: "Mars/Olympus" } });
    fireEvent.click(s.getByRole("button", { name: "Save quiet hours" }));
    expect((await s.findByRole("alert")).textContent).toBe(
      "Enter two times and a real time zone, such as Europe/Paris.",
    );
    expect(api.posts("/api/capabilities/status-lights/config")).toEqual([]);
  });

  it("turns quiet hours off by removing only that setting", async () => {
    const hours = { timezone: "UTC", start: "22:00", end: "07:00" };
    const api = mount({
      "GET /api/capabilities": () => ({
        capabilities: [
          capability("status-lights", "enabled", { devices: ["desk"], quiet_hours: hours }),
        ],
      }),
    });
    const s = await section();
    await s.findByText("Lights are dark from 22:00 to 07:00 (UTC).");
    fireEvent.click(s.getByRole("button", { name: "Turn off quiet hours" }));
    await waitFor(() =>
      expect(api.posts("/api/capabilities/status-lights/config")[0]?.body).toEqual({
        config: { devices: ["desk"] },
      }),
    );
  });
});

describe("helpers", () => {
  it("strips control and bidi characters and bounds length", () => {
    expect(deviceText("a\u202eb\u0000c\u2066d\u200be")).toBe("abcde");
    expect(deviceText("x".repeat(100))).toBe(`${"x".repeat(64)}…`);
    expect(formatFingerprint("abcd")).toBe("AB:CD");
    expect(validQuietHours({ timezone: "UTC", start: "24:00", end: "01:00" })).toBe(false);
  });
});
