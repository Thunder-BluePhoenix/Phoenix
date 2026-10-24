// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
// The Settings "Remote relay" section against a fake Core. No relay, network, TLS, phone or hosted
// instance is involved: every answer below is written by the test.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteRelaySection } from "../src/components/RemoteRelay";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { PhoneDevice } from "../src/core/phone";
import { cleanRelayText, relayUrlProblem, type RemoteRelayStatus } from "../src/core/remote-relay";
import { I18nProvider } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { expectInert, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
  vi.useRealTimers();
});

const ROUTE = "0123456789abcdef0123456789abcdef";
const OTHER_ROUTE = "fedcba9876543210fedcba9876543210";
const CORE_KEY = ["MFkwEwYH", "KoZIzj0C", "AQYIKoZI", "zj0DAQcD", "QgAEfake"].join("");
const URL_OK = "https://relay.example.org";

const off = (patch: Partial<RemoteRelayStatus> = {}): RemoteRelayStatus => ({
  enabled: false,
  connected: false,
  url: null,
  route: null,
  core_public_key: null,
  last_error: null,
  ...patch,
});
const on = (patch: Partial<RemoteRelayStatus> = {}): RemoteRelayStatus => ({
  enabled: true,
  connected: true,
  url: URL_OK,
  route: ROUTE,
  core_public_key: CORE_KEY,
  last_error: null,
  ...patch,
});
const device = (patch: Partial<PhoneDevice> = {}): PhoneDevice => ({
  id: "dev_0123456789ab",
  name: "Ada's phone",
  key_fingerprint: "aabbccdd",
  created_at: "2026-10-01T09:00:00Z",
  last_seen_at: null,
  revoked_at: null,
  ...patch,
});

interface World {
  status: RemoteRelayStatus;
  devices: PhoneDevice[];
  api: FakeApi;
  container: HTMLElement;
}

/** A fake Core whose relay state the test can change between polls. */
function mount(
  initial: RemoteRelayStatus,
  devices: PhoneDevice[] = [],
  routes: Parameters<typeof fakeApi>[0] = {},
): World {
  const world: World = {
    status: initial,
    devices,
    api: fakeApi(),
    container: document.body,
  };
  world.api = fakeApi({
    "GET /api/remote-relay": () => world.status,
    "POST /api/remote-relay": (body) => {
      const url = body !== null && typeof body === "object" && "url" in body ? body.url : null;
      world.status = on({ url: typeof url === "string" ? url : null });
      return world.status;
    },
    "DELETE /api/remote-relay": () => {
      world.status = off();
      return world.status;
    },
    "GET /api/phone/devices": () => ({ devices: world.devices }),
    "POST /api/remote-relay/devices/dev_0123456789ab/approvals": () => ({ pushed: true }),
    ...routes,
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: world.api.fetchImpl,
  });
  const view = render(
    <CoreProvider client={client}>
      <I18nProvider forceLocale="en">
        <RemoteRelaySection />
      </I18nProvider>
    </CoreProvider>,
  );
  world.container = view.container;
  return world;
}

const section = async () =>
  within((await screen.findByRole("heading", { name: "Remote relay" })).closest("section")!);
const requests = (api: FakeApi, method: string, path: string) =>
  api.calls.filter((c) => c.method === method && c.path === path);

describe("remote relay: status", () => {
  it("is off by default: plain-language limits, an address field and no route details", async () => {
    mount(off());
    const s = await section();
    expect(await s.findByText("Off")).toBeTruthy();
    expect(s.getByText(/cannot read, change, forge or replay anything/)).toBeTruthy();
    expect(s.getByText(/end-to-end encrypted/)).toBeTruthy();
    expect(s.getByText(/size and time of each message/)).toBeTruthy();
    expect(s.getByLabelText(/Relay address/)).toBeTruthy();
    expect(s.queryByRole("button", { name: "Turn off" })).toBeNull();
    expect(s.queryByText(ROUTE)).toBeNull();
  });

  it("shows an enabled, connected relay with its address but not the route or the key", async () => {
    mount(on());
    const s = await section();
    expect(await s.findByText("On and connected to the relay")).toBeTruthy();
    expect(s.getByText(URL_OK).tagName).toBe("CODE");
    expect(s.queryByText(ROUTE)).toBeNull();
    expect(s.queryByText(CORE_KEY)).toBeNull();
  });

  it("says when it is on but not connected, with Core's last error as plain text", async () => {
    mount(on({ connected: false, last_error: "Relay refused the stream (503)" }));
    const s = await section();
    expect(await s.findByText("On, not connected to the relay right now")).toBeTruthy();
    expect(s.getByText("Last problem reported: Relay refused the stream (503)")).toBeTruthy();
  });

  it("renders hostile error text as inert text", async () => {
    const world = mount(on({ connected: false, last_error: XSS }));
    const s = await section();
    await s.findByText(/Last problem reported/);
    expectInert(world.container);
  });

  it("strips control and bidirectional characters from the error", async () => {
    mount(on({ last_error: "bad\u202e\u0000\nframe" }));
    const s = await section();
    expect(await s.findByText("Last problem reported: bad frame")).toBeTruthy();
  });

  it("handles Core without the route (404) by saying it is unavailable and offering nothing", async () => {
    const world = mount(off(), [], {
      "GET /api/remote-relay": () =>
        new Response(JSON.stringify({ code: "RESOURCE_NOT_FOUND", message: "Not found" }), {
          status: 404,
        }),
    });
    const s = await section();
    expect(await s.findByText(/no operating system secret store/)).toBeTruthy();
    expect(s.queryByRole("button")).toBeNull();
    expect(s.queryByRole("textbox")).toBeNull();
    expect(world.api.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("shows Core's words when the status cannot be loaded", async () => {
    mount(off(), [], {
      "GET /api/remote-relay": () =>
        new Response(JSON.stringify({ code: "INTERNAL_ERROR", message: "Relay store broke" }), {
          status: 500,
        }),
    });
    const s = await section();
    expect((await s.findByRole("alert")).textContent).toBe("Relay store broke");
  });

  it("re-reads the status while the relay is on so 'connected' stays current", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const world = mount(on({ connected: false }));
    const s = await section();
    await s.findByText("On, not connected to the relay right now");
    world.status = on({ connected: true });
    await act(() => vi.advanceTimersByTimeAsync(5_100));
    expect(await s.findByText("On and connected to the relay")).toBeTruthy();
  });
});

describe("remote relay: turning it on", () => {
  it("posts exactly {url} and shows what Core answers", async () => {
    const world = mount(off());
    const s = await section();
    fireEvent.change(await s.findByLabelText(/Relay address/), {
      target: { value: ` ${URL_OK} ` },
    });
    fireEvent.click(s.getByRole("button", { name: "Turn on" }));
    expect(await s.findByText("On and connected to the relay")).toBeTruthy();
    const posts = requests(world.api, "POST", "/api/remote-relay");
    expect(posts.length).toBe(1);
    expect(posts[0]!.body).toEqual({ url: URL_OK });
    expect(s.getByText("Remote relay turned on.")).toBeTruthy();
    expect(s.queryByLabelText(/Relay address/)).toBeNull();
  });

  it("accepts plain http only for this computer", async () => {
    const world = mount(off());
    const s = await section();
    const field = await s.findByLabelText(/Relay address/);
    fireEvent.change(field, { target: { value: "http://relay.example.org" } });
    expect(s.getByText("The relay address must start with https://.")).toBeTruthy();
    expect((s.getByRole("button", { name: "Turn on" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: "http://127.0.0.1:8787" } });
    expect(s.queryByText("The relay address must start with https://.")).toBeNull();
    fireEvent.click(s.getByRole("button", { name: "Turn on" }));
    await s.findByText("Remote relay turned on.");
    expect(requests(world.api, "POST", "/api/remote-relay")[0]!.body).toEqual({
      url: "http://127.0.0.1:8787",
    });
  });

  it("refuses credentials, a query, a fragment and non-URLs without calling Core", async () => {
    const world = mount(off());
    const s = await section();
    const field = await s.findByLabelText(/Relay address/);
    const turnOn = s.getByRole("button", { name: "Turn on" }) as HTMLButtonElement;
    for (const bad of [
      "https://user:pw@relay.example.org",
      "https://relay.example.org/?a=1",
      "https://relay.example.org/#x",
    ]) {
      fireEvent.change(field, { target: { value: bad } });
      expect(
        s.getByText(/cannot contain a user name, a password, a query or a fragment/),
      ).toBeTruthy();
      expect(turnOn.disabled).toBe(true);
    }
    fireEvent.change(field, { target: { value: "not a url" } });
    expect(s.getByText("That is not a web address.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "ftp://relay.example.org" } });
    expect(s.getByText("The relay address must start with https://.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "" } });
    expect(turnOn.disabled).toBe(true);
    fireEvent.click(turnOn);
    expect(requests(world.api, "POST", "/api/remote-relay").length).toBe(0);
  });

  it("shows Core's refusal as text and stays off", async () => {
    mount(off(), [], {
      "POST /api/remote-relay": () =>
        new Response(
          JSON.stringify({ code: "SECURITY_POLICY_BLOCKED", message: "Emergency stop is engaged" }),
          { status: 403 },
        ),
    });
    const s = await section();
    fireEvent.change(await s.findByLabelText(/Relay address/), { target: { value: URL_OK } });
    fireEvent.click(s.getByRole("button", { name: "Turn on" }));
    expect((await s.findByRole("alert")).textContent).toBe("Emergency stop is engaged");
    expect(s.getByText("Off")).toBeTruthy();
    expect(s.getByLabelText(/Relay address/)).toBeTruthy();
  });

  it("matches the checks Core makes on the address", () => {
    expect(relayUrlProblem("")).toBe("empty");
    expect(relayUrlProblem(`https://${"a".repeat(300)}.example`)).toBe("tooLong");
    expect(relayUrlProblem("nope")).toBe("notUrl");
    expect(relayUrlProblem("http://localhost:8787")).toBeNull();
    expect(relayUrlProblem("http://[::1]:8787")).toBeNull();
    expect(relayUrlProblem("http://example.org")).toBe("https");
    expect(relayUrlProblem("https://relay.example.org/path")).toBeNull();
    expect(relayUrlProblem("https://u@relay.example.org")).toBe("credentials");
    expect(cleanRelayText("a\u200eb  c\n")).toBe("a b c");
    expect(Array.from(cleanRelayText("x".repeat(500))).length).toBe(201);
  });
});

describe("remote relay: turning it off", () => {
  it("asks first and says the key is discarded; nothing is sent until confirmed", async () => {
    const world = mount(on());
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Turn off" }));
    expect(s.getByText(/discards the route and this computer's relay private key/)).toBeTruthy();
    expect(requests(world.api, "DELETE", "/api/remote-relay").length).toBe(0);
    fireEvent.click(s.getByRole("button", { name: "Keep it on" }));
    expect(s.getByRole("button", { name: "Turn off" })).toBeTruthy();
    expect(requests(world.api, "DELETE", "/api/remote-relay").length).toBe(0);
  });

  it("sends DELETE once on confirmation and then shows the relay off", async () => {
    const world = mount(on());
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Turn off" }));
    fireEvent.click(s.getByRole("button", { name: "Yes, turn off and discard" }));
    expect(await s.findByText("Off")).toBeTruthy();
    expect(requests(world.api, "DELETE", "/api/remote-relay").length).toBe(1);
    expect(s.getByText(/The route and the relay key were discarded/)).toBeTruthy();
    expect(s.getByLabelText(/Relay address/)).toBeTruthy();
  });

  it("keeps the confirmation and shows Core's error when the request fails", async () => {
    mount(on(), [], {
      "DELETE /api/remote-relay": () =>
        new Response(
          JSON.stringify({ code: "INTERNAL_ERROR", message: "Could not forget the key" }),
          {
            status: 500,
          },
        ),
    });
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Turn off" }));
    fireEvent.click(s.getByRole("button", { name: "Yes, turn off and discard" }));
    expect((await s.findByRole("alert")).textContent).toBe("Could not forget the key");
    expect(s.getByRole("button", { name: "Yes, turn off and discard" })).toBeTruthy();
  });
});

describe("remote relay: details for a device", () => {
  it("shows the route and Core's public key only while the panel is open", async () => {
    mount(on());
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Show the relay details for a device" }));
    expect(s.getByText(ROUTE).tagName).toBe("CODE");
    expect(s.getByText(CORE_KEY).tagName).toBe("CODE");
    expect(s.getByText(/not a password/)).toBeTruthy();
    expect(s.getByText(/no pairing code or link for the relay/)).toBeTruthy();
    fireEvent.click(s.getByRole("button", { name: "Hide the details" }));
    expect(s.queryByText(ROUTE)).toBeNull();
    expect(s.queryByText(CORE_KEY)).toBeNull();
  });

  it("clears them when the relay is turned off, and they do not come back on the next route", async () => {
    mount(on());
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Show the relay details for a device" }));
    await s.findByText(ROUTE);
    fireEvent.click(s.getByRole("button", { name: "Turn off" }));
    fireEvent.click(s.getByRole("button", { name: "Yes, turn off and discard" }));
    await s.findByText("Off");
    expect(s.queryByText(ROUTE)).toBeNull();
    expect(s.queryByText(CORE_KEY)).toBeNull();

    fireEvent.change(s.getByLabelText(/Relay address/), { target: { value: URL_OK } });
    fireEvent.click(s.getByRole("button", { name: "Turn on" }));
    await s.findByText("On and connected to the relay");
    expect(s.queryByText(ROUTE)).toBeNull();
    expect(s.queryByText(CORE_KEY)).toBeNull();
    expect(s.getByRole("button", { name: "Show the relay details for a device" })).toBeTruthy();
  });

  it("closes the panel when Core reports a different route", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const world = mount(on());
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Show the relay details for a device" }));
    await s.findByText(ROUTE);
    world.status = on({ route: OTHER_ROUTE });
    await act(() => vi.advanceTimersByTimeAsync(5_100));
    await waitFor(() => expect(s.queryByText(ROUTE)).toBeNull());
    expect(s.queryByText(OTHER_ROUTE)).toBeNull();
  });
});

describe("remote relay: paired devices", () => {
  it("lists devices with grouped fingerprints and none when empty", async () => {
    mount(on(), []);
    const empty = await section();
    expect(await empty.findByText(/No device is paired yet/)).toBeTruthy();
    cleanup();
    mount(on(), [
      device(),
      device({ id: "dev_ba9876543210", name: "Grace", key_fingerprint: "11:22" }),
    ]);
    const s = await section();
    expect(await s.findByText("Ada's phone")).toBeTruthy();
    expect(s.getByText("AA:BB:CC:DD").tagName).toBe("CODE");
    expect(s.getByText("Grace")).toBeTruthy();
    expect(s.getByText("11:22")).toBeTruthy();
  });

  it("sends a device its approvals through the device route, with the id encoded", async () => {
    const world = mount(on(), [device()]);
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Send approvals to Ada's phone" }));
    expect(await s.findByText("Sent the pending approvals to Ada's phone.")).toBeTruthy();
    expect(
      requests(world.api, "POST", "/api/remote-relay/devices/dev_0123456789ab/approvals").length,
    ).toBe(1);
  });

  it("shows a refusal from Core and offers nothing for a revoked device or while the relay is off", async () => {
    mount(
      on(),
      [
        device(),
        device({ id: "dev_ba9876543210", name: "Old", revoked_at: "2026-10-05T09:00:00Z" }),
      ],
      {
        "POST /api/remote-relay/devices/dev_0123456789ab/approvals": () =>
          new Response(
            JSON.stringify({ code: "CAPABILITY_UNAVAILABLE", message: "Relay is off" }),
            {
              status: 503,
            },
          ),
      },
    );
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Send approvals to Ada's phone" }));
    expect((await s.findByRole("alert")).textContent).toBe("Relay is off");
    expect(s.getAllByRole("button", { name: /Send approvals to/ }).length).toBe(1);
    expect(s.getByText(/Revoked/)).toBeTruthy();
    cleanup();

    mount(off(), [device()]);
    const offSection = await section();
    await offSection.findByText("Ada's phone");
    expect(offSection.queryByRole("button", { name: /Send approvals to/ })).toBeNull();
  });

  it("renders a hostile device name as inert text", async () => {
    const world = mount(on(), [device({ name: XSS })]);
    const s = await section();
    await s.findByRole("button", { name: /Send approvals to/ });
    expectInert(world.container);
  });

  it("says so when the device list cannot be loaded", async () => {
    mount(on(), [], {
      "GET /api/phone/devices": () =>
        new Response(JSON.stringify({ code: "INTERNAL_ERROR", message: "x" }), { status: 500 }),
    });
    const s = await section();
    expect(await s.findByText("The paired devices could not be loaded.")).toBeTruthy();
  });
});
