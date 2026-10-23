// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  groupCode,
  groupFingerprint,
  hostPort,
  parsePhonePort,
  safeDeviceName,
  type PhoneDevice,
  type PhonePairingCode,
  type PhoneStatus,
} from "../src/core/phone";
import type { FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { openAt } from "./views-harness";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const inSeconds = (s: number) => new Date(NOW + s * 1000).toISOString();
const FP = "AB:CD:EF:01:23:45:67:89";

beforeEach(() => {
  FakeWebSocket.reset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.location.hash = "";
});

const base = (patch: Partial<PhoneStatus> = {}): PhoneStatus => ({
  enabled: false,
  listening: false,
  address: null,
  port: null,
  configured_port: 47821,
  addresses: [],
  fingerprint: null,
  require_user_verification: true,
  kill_switch: false,
  pairing: null,
  pending_pair: null,
  locked_out_until: null,
  off_reason: null,
  devices: 0,
  ...patch,
});
const on = (patch: Partial<PhoneStatus> = {}) =>
  base({
    enabled: true,
    listening: true,
    address: "192.168.1.5",
    port: 4443,
    fingerprint: FP,
    ...patch,
  });
const device = (patch: Partial<PhoneDevice> = {}): PhoneDevice => ({
  id: "dev_1",
  name: "Ada's phone",
  key_fingerprint: "11:22:33:44",
  created_at: "2026-10-01T09:00:00Z",
  last_seen_at: null,
  revoked_at: null,
  ...patch,
});

interface World {
  status: PhoneStatus;
  devices: PhoneDevice[];
  issued: PhonePairingCode;
}

/** A fake Core whose phone state the test can change between polls. */
function open(initial: PhoneStatus, devices: PhoneDevice[] = []) {
  const world: World = {
    status: initial,
    devices,
    issued: {
      code: "ABCDEFGHJKLM",
      expires_at: inSeconds(120),
      fingerprint: FP,
      address: "192.168.1.5",
      port: 4443,
      uri: "phoenix-phone://pair?host=192.168.1.5",
    },
  };
  const view = openAt("#/settings", {
    "GET /api/phone/status": () => world.status,
    "GET /api/phone/devices": () => ({ devices: world.devices }),
    "POST /api/phone/settings": (body) => {
      const patch = body as Partial<PhoneStatus> & { port?: number };
      if (typeof patch.port === "number") {
        // Like Core: a new port reopens a running listener there and withdraws any code.
        world.status = {
          ...world.status,
          configured_port: patch.port,
          ...(world.status.listening ? { port: patch.port } : {}),
          pairing: null,
        };
        return world.status;
      }
      if (typeof patch.address === "string") {
        world.status = on({ address: patch.address, off_reason: null });
        return world.status;
      }
      world.status =
        patch.enabled === true
          ? on({ require_user_verification: world.status.require_user_verification, ...patch })
          : { ...world.status, ...patch, ...(patch.enabled === false ? { listening: false } : {}) };
      return world.status;
    },
    "POST /api/phone/pairing": () => {
      world.status = { ...world.status, pairing: { expires_at: world.issued.expires_at } };
      return world.issued;
    },
    "DELETE /api/phone/pairing": () => {
      world.status = { ...world.status, pairing: null };
      return { cancelled: true };
    },
    "DELETE /api/phone/devices/*": () => ({ id: "dev_1", revoked: true }),
    "POST /api/confirmations/*": () => ({ id: "cnf_1", approved: true }),
  });
  return { ...view, world };
}

const section = async () =>
  within((await screen.findByRole("heading", { name: "Phone link" })).closest("section")!);
const calls = (api: FakeApi, method: string, prefix: string) =>
  api.calls.filter((c) => c.method === method && c.path.startsWith(prefix));
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("phone link: off by default", () => {
  it("shows the LAN warning, an unchecked toggle and no pairing controls", async () => {
    open(base());
    const s = await section();
    expect(await s.findByText(/other devices on your local network/)).toBeTruthy();
    expect(s.getByText(/cannot check that a person is at this computer/)).toBeTruthy();
    const toggle = s.getByRole("checkbox", { name: /Allow phones on my local network/ });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(s.queryByRole("button", { name: "Show pairing code" })).toBeNull();
  });

  it("enabling posts enabled:true and then shows address and the grouped fingerprint", async () => {
    const { api } = open(base());
    const s = await section();
    fireEvent.click(await s.findByRole("checkbox", { name: /Allow phones on my local network/ }));
    expect(await s.findByText("192.168.1.5:4443")).toBeTruthy();
    expect(s.getByText(FP).tagName).toBe("CODE");
    expect(api.posts("/api/phone/settings")[0]!.body).toEqual({ enabled: true });
    expect(await s.findByRole("button", { name: "Show pairing code" })).toBeTruthy();
  });

  it("shows Core's message when it cannot enable (no LAN address)", async () => {
    const { api } = open(base());
    api.set(
      "POST /api/phone/settings",
      () =>
        new Response(JSON.stringify({ code: "UNAVAILABLE", message: "No LAN address found" }), {
          status: 503,
        }),
    );
    const s = await section();
    fireEvent.click(await s.findByRole("checkbox", { name: /Allow phones on my local network/ }));
    expect((await s.findByRole("alert")).textContent).toBe("No LAN address found");
  });
});

describe("phone link: pairing code", () => {
  it("shows the grouped code with fingerprint, counts down, and drops the code at expiry", async () => {
    const { api } = open(on());
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Show pairing code" }));
    expect(await s.findByText("ABCD-EFGH-JKLM")).toBeTruthy();
    expect(s.getByRole("timer").textContent).toBe("Expires in 2:00");
    expect(s.getAllByText(FP).length).toBe(2);
    expect(s.getByText("phoenix-phone://pair?host=192.168.1.5")).toBeTruthy();
    expect(calls(api, "POST", "/api/phone/pairing").length).toBe(1);

    await tick(30_000);
    expect(s.getByRole("timer").textContent).toBe("Expires in 1:30");

    await tick(95_000);
    await waitFor(() => expect(s.queryByText("ABCD-EFGH-JKLM")).toBeNull());
    expect(s.queryByRole("timer")).toBeNull();
    expect(s.getByText(/pairing code expired/)).toBeTruthy();
    expect(s.queryByText("phoenix-phone://pair?host=192.168.1.5")).toBeNull();
  });

  it("Cancel code sends DELETE and removes the code", async () => {
    const { api } = open(on());
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Show pairing code" }));
    await s.findByText("ABCD-EFGH-JKLM");
    fireEvent.click(s.getByRole("button", { name: "Cancel code" }));
    await waitFor(() => expect(s.queryByText("ABCD-EFGH-JKLM")).toBeNull());
    expect(calls(api, "DELETE", "/api/phone/pairing").length).toBe(1);
    expect(s.queryByRole("button", { name: "Cancel code" })).toBeNull();
  });

  it("a code that Core still lists as active after a reload is not shown again", async () => {
    open(on({ pairing: { expires_at: inSeconds(60) } }));
    const s = await section();
    expect(await s.findByText(/code is active until/)).toBeTruthy();
    expect(s.queryByText("ABCD-EFGH-JKLM")).toBeNull();
  });

  it("forgets the code when a phone asks to pair (the code is spent)", async () => {
    const { world } = open(on());
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Show pairing code" }));
    await s.findByText("ABCD-EFGH-JKLM");
    world.status = on({
      pairing: null,
      pending_pair: {
        name: "Ada",
        key_fingerprint: "AA:BB",
        requested_at: inSeconds(-1),
        expires_at: inSeconds(60),
        confirmation_id: "cnf_1",
      },
    });
    await tick(2_500);
    await s.findByText(/Pair "Ada"\?/);
    expect(s.queryByText("ABCD-EFGH-JKLM")).toBeNull();
  });

  it("does not offer a code while pairing is locked out, and says until when", async () => {
    open(on({ locked_out_until: inSeconds(300) }));
    const s = await section();
    expect(await s.findByText(/Pairing is locked until/)).toBeTruthy();
    expect(
      (s.getByRole("button", { name: "Show pairing code" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("says the chosen address is gone, rather than a generic 'not running yet'", async () => {
    open(base({ enabled: true, off_reason: "address_changed", addresses: ["10.0.0.9"] }));
    const s = await section();
    expect(await s.findByText(/network address you chose is no longer available/i)).toBeTruthy();
    expect(s.queryByText(/listener is not running yet/)).toBeNull();
  });
});

describe("phone link: address changed prompt", () => {
  const gone = (patch: Partial<PhoneStatus> = {}) =>
    base({
      enabled: true,
      off_reason: "address_changed",
      addresses: ["10.0.0.9", "192.168.1.7"],
      ...patch,
    });

  it("explains the paired phone may not reach this computer and offers the existing safe actions", async () => {
    const { api } = open(gone());
    const s = await section();
    const prompt = await s.findByRole("alert");
    expect(within(prompt).getByText("This computer's address changed")).toBeTruthy();
    expect(
      within(prompt).getByText(/may not be able to reach this computer any more/),
    ).toBeTruthy();
    expect(within(prompt).getByText(/Nothing was opened on another network/)).toBeTruthy();
    expect(within(prompt).getByText(/pair the phone again/)).toBeTruthy();
    const select = within(prompt).getByRole("combobox") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["10.0.0.9", "192.168.1.7"]);
    expect(s.queryByText(/listener is not running yet/)).toBeNull();
    // Choosing an address goes through the existing settings route, with just that field.
    fireEvent.change(select, { target: { value: "192.168.1.7" } });
    fireEvent.click(within(prompt).getByRole("button", { name: "Use this address" }));
    await waitFor(() => expect(api.posts("/api/phone/settings").length).toBe(1));
    expect(api.posts("/api/phone/settings")[0]!.body).toEqual({ address: "192.168.1.7" });
    await waitFor(() => expect(s.queryByText("This computer's address changed")).toBeNull());
    expect(await s.findByText("192.168.1.7:4443")).toBeTruthy();
  });

  it("Turn the phone link off posts enabled:false and the prompt goes away", async () => {
    const { api } = open(gone());
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Turn the phone link off" }));
    await waitFor(() => expect(api.posts("/api/phone/settings").length).toBe(1));
    expect(api.posts("/api/phone/settings")[0]!.body).toEqual({ enabled: false });
    await waitFor(() => expect(s.queryByRole("alert")).toBeNull());
  });

  it("says so, and offers no address to pick, when this computer has no private address right now", async () => {
    open(gone({ addresses: [] }));
    const s = await section();
    expect(await s.findByText(/No private local network address was found/)).toBeTruthy();
    expect(s.queryByRole("combobox")).toBeNull();
    expect(s.queryByRole("button", { name: "Use this address" })).toBeNull();
    expect(s.getByRole("button", { name: "Turn the phone link off" })).toBeTruthy();
  });

  it("does not appear for any other state", async () => {
    for (const state of [
      base(), // off
      base({ enabled: true }), // on but not listening, no reason
      on(), // listening
      gone({ kill_switch: true }), // the kill switch is the reason shown instead
      gone({ enabled: false }), // not enabled
      on({ off_reason: "address_changed" }), // listening: the reason cannot apply
    ]) {
      cleanup();
      open(state);
      const s = await section();
      await s.findByRole("checkbox", { name: /Allow phones on my local network/ });
      expect(s.queryByText("This computer's address changed")).toBeNull();
      expect(s.queryByRole("button", { name: "Turn the phone link off" })).toBeNull();
    }
  });
});

describe("phone link: pending pair", () => {
  const pending = (name: string, confirmation_id: string | null = "cnf_9") =>
    on({
      pending_pair: {
        name,
        key_fingerprint: "AA:BB:CC:DD",
        requested_at: inSeconds(-1),
        expires_at: inSeconds(60),
        confirmation_id,
      },
    });

  it("renders the phone's name as text, never as markup", async () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { container } = open(pending(hostile));
    const s = await section();
    await s.findByText(/Pair ".*"\?/);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(s.getByText(/Pair ".*alert\(1\).*"\?/)).toBeTruthy();
    expect(s.getByText("AA:BB:CC:DD")).toBeTruthy();
  });

  it("strips control and direction-override characters from the name", async () => {
    open(pending("Eve\u202Eevil\u0000\nphone"));
    const s = await section();
    expect(await s.findByText('Pair "Eve evil phone"?')).toBeTruthy();
  });

  it("Yes approves and No refuses through /api/confirmations/<id>", async () => {
    const { api, world } = open(pending("Ada"));
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Yes, pair this phone" }));
    await waitFor(() => expect(calls(api, "POST", "/api/confirmations/").length).toBe(1));
    expect(api.posts("/api/confirmations/cnf_9")[0]!.body).toEqual({ approve: true });

    world.status = pending("Ada");
    await tick(2_500);
    fireEvent.click(await s.findByRole("button", { name: "No, refuse" }));
    await waitFor(() => expect(calls(api, "POST", "/api/confirmations/").length).toBe(2));
    expect(api.posts("/api/confirmations/cnf_9")[1]!.body).toEqual({ approve: false });
  });

  it("has no Yes/No until Core has created the confirmation", async () => {
    open(pending("Ada", null));
    const s = await section();
    await s.findByText(/Pair "Ada"\?/);
    expect(s.queryByRole("button", { name: "Yes, pair this phone" })).toBeNull();
    expect(s.getByText(/Waiting for Phoenix/)).toBeTruthy();
  });

  it("announces the prompt in a live region", async () => {
    open(pending("Ada"));
    const s = await section();
    const prompt = await s.findByText(/Pair "Ada"\?/);
    expect(prompt.closest("[aria-live]")?.getAttribute("aria-live")).toBe("assertive");
  });
});

describe("phone link: devices", () => {
  it("lists devices; revoke asks first, then sends DELETE; revoked rows have no Revoke", async () => {
    const { api, world } = open(on({ devices: 2 }), [
      device(),
      device({ id: "dev_2", name: "Old", revoked_at: "2026-10-05T09:00:00Z" }),
    ]);
    const s = await section();
    await s.findByText("Ada's phone", { selector: "strong" });
    expect(s.getAllByText("11:22:33:44", { selector: "code" }).length).toBe(2);
    expect(s.getByText(/Revoked/)).toBeTruthy();
    expect(s.getAllByRole("button", { name: /^Revoke / }).length).toBe(1);

    fireEvent.click(s.getByRole("button", { name: "Revoke Ada's phone" }));
    expect(calls(api, "DELETE", "/api/phone/devices").length).toBe(0);
    expect(s.getByText(/It will no longer be able to approve anything/)).toBeTruthy();

    world.devices = [
      device({ revoked_at: "2026-10-20T12:00:00Z" }),
      device({ id: "dev_2", name: "Old", revoked_at: "2026-10-05T09:00:00Z" }),
    ];
    fireEvent.click(s.getByRole("button", { name: "Yes, revoke" }));
    await waitFor(() => expect(calls(api, "DELETE", "/api/phone/devices/dev_1").length).toBe(1));
    await waitFor(() => expect(s.queryByRole("button", { name: /^Revoke / })).toBeNull());
    expect(s.getAllByText(/Revoked/).length).toBe(2);
  });

  it("Keep it cancels the revoke without a request", async () => {
    const { api } = open(on({ devices: 1 }), [device()]);
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Revoke Ada's phone" }));
    fireEvent.click(s.getByRole("button", { name: "Keep it" }));
    expect(calls(api, "DELETE", "/api/phone/devices").length).toBe(0);
    expect(s.getByRole("button", { name: "Revoke Ada's phone" })).toBeTruthy();
  });

  it("shows a device name as text", async () => {
    const { container } = open(on({ devices: 1 }), [
      device({ name: "<img src=x onerror=alert(1)>" }),
    ]);
    const s = await section();
    await s.findByText(/<img src=x/, { selector: "strong" });
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("phone link: verification and safety states", () => {
  it("require-verification is on by default and posts the change", async () => {
    const { api } = open(on());
    const s = await section();
    const box = (await s.findByRole("checkbox", {
      name: /Require biometric or device verification/,
    })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(s.getByText(/Phoenix cannot check that report itself/)).toBeTruthy();
    fireEvent.click(box);
    await waitFor(() => expect(api.posts("/api/phone/settings").length).toBe(1));
    expect(api.posts("/api/phone/settings")[0]!.body).toEqual({ require_user_verification: false });
    await waitFor(() => expect(box.checked).toBe(false));
  });

  it("kill switch: says the listener is closed and offers no pairing", async () => {
    open(base({ enabled: true, kill_switch: true }));
    const s = await section();
    expect(await s.findByText(/kill switch is on/)).toBeTruthy();
    expect(s.queryByRole("button", { name: "Show pairing code" })).toBeNull();
  });
});

describe("phone link: QR code", () => {
  const qrName = "QR code with the pairing link";

  it("draws the pairing link as an inline QR image beside the text link, and removes both on cancel", async () => {
    const { container } = open(on());
    const s = await section();
    expect(s.queryByRole("img", { name: qrName })).toBeNull(); // nothing before a code is shown
    fireEvent.click(await s.findByRole("button", { name: "Show pairing code" }));
    const qr = await s.findByRole("img", { name: qrName });
    expect(qr.tagName.toLowerCase()).toBe("svg");
    const path = qr.querySelector("path")!.getAttribute("d")!;
    expect(path.length).toBeGreaterThan(100);
    // 4-module quiet zone: the first dark module (a finder corner) starts at 4,4.
    expect(path.startsWith("M4 4h7")).toBe(true);
    const box = qr.getAttribute("viewBox")!.split(" ").map(Number);
    expect(box[2]).toBe(box[3]); // square
    expect((box[2]! - 8 - 17) % 4).toBe(0); // 17 + 4 * version modules plus the quiet zone
    // The text fallback stays next to it, and the link is not inside the drawing's markup.
    expect(s.getByText("phoenix-phone://pair?host=192.168.1.5").tagName).toBe("CODE");
    expect(qr.outerHTML).not.toContain("phoenix-phone");
    expect(qr.outerHTML).not.toContain("ABCD");
    expect(container.querySelectorAll("svg[role=img]").length).toBe(1);
    expect(s.getByText(/show it only to your own phone/)).toBeTruthy();

    fireEvent.click(s.getByRole("button", { name: "Cancel code" }));
    await waitFor(() => expect(s.queryByRole("img", { name: qrName })).toBeNull());
    expect(s.queryByText("phoenix-phone://pair?host=192.168.1.5")).toBeNull();
  });

  it("is gone when the code expires", async () => {
    open(on());
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Show pairing code" }));
    await s.findByRole("img", { name: qrName });
    await tick(125_000);
    await waitFor(() => expect(s.queryByRole("img", { name: qrName })).toBeNull());
  });

  it("is gone when a phone asks to pair (the code is spent) and when the listener closes", async () => {
    const { world } = open(on());
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Show pairing code" }));
    await s.findByRole("img", { name: qrName });
    world.status = on({
      pending_pair: {
        name: "Ada",
        key_fingerprint: "AA:BB",
        requested_at: inSeconds(-1),
        expires_at: inSeconds(60),
        confirmation_id: "cnf_1",
      },
    });
    await tick(2_500);
    await s.findByText(/Pair "Ada"\?/);
    expect(s.queryByRole("img", { name: qrName })).toBeNull();
  });

  it("is not drawn again from a code Core only reports as active after a reload", async () => {
    open(on({ pairing: { expires_at: inSeconds(60) } }));
    const s = await section();
    await s.findByText(/code is active until/);
    expect(s.queryByRole("img", { name: qrName })).toBeNull();
  });

  it("falls back to the text link, saying so, when the link cannot be made into a QR code", async () => {
    const { world } = open(on());
    world.issued = { ...world.issued, uri: `phoenix-phone://pair?x=${"a".repeat(400)}` };
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Show pairing code" }));
    expect(await s.findByText(/A QR code could not be made for this link/)).toBeTruthy();
    expect(s.queryByRole("img", { name: qrName })).toBeNull();
    expect(s.getByText(world.issued.uri).tagName).toBe("CODE");
    expect(s.getByText("ABCD-EFGH-JKLM")).toBeTruthy();
  });

  it("never sends the link anywhere: showing the QR makes no request beyond the pairing call", async () => {
    const { api } = open(on());
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Show pairing code" }));
    await s.findByRole("img", { name: qrName });
    expect(calls(api, "POST", "/api/phone/pairing").length).toBe(1);
    expect(api.calls.filter((c) => !c.path.startsWith("/api/"))).toEqual([]);
  });
});

describe("phone link: port", () => {
  const portBox = async (s: Awaited<ReturnType<typeof section>>) =>
    (await s.findByRole("textbox", { name: "Port" })) as HTMLInputElement;

  it("shows the configured port with an honest note and saves a valid one through the settings route", async () => {
    const { api } = open(on());
    const s = await section();
    const box = await portBox(s);
    expect(box.value).toBe("47821");
    expect(s.getByText(/A new port takes effect when the link next opens/)).toBeTruthy();
    expect(s.getByText(/need to be paired again/)).toBeTruthy();
    const save = s.getByRole("button", { name: "Save port" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // unchanged
    fireEvent.change(box, { target: { value: " 50000 " } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(api.posts("/api/phone/settings").length).toBe(1));
    expect(api.posts("/api/phone/settings")[0]!.body).toEqual({ port: 50000 });
    expect(await s.findByText("Phone link port saved: 50000.")).toBeTruthy();
    expect(await s.findByText("192.168.1.5:50000")).toBeTruthy();
    expect(box.value).toBe("50000");
  });

  it("refuses a port that is not a whole number from 1024 to 65535 before sending anything", async () => {
    const { api } = open(base());
    const s = await section();
    const box = await portBox(s);
    const save = s.getByRole("button", { name: "Save port" }) as HTMLButtonElement;
    for (const bad of ["1023", "65536", "", "80", "4.5", "1e4", "-1", "abc", "0x4000", "123456"]) {
      fireEvent.change(box, { target: { value: bad } });
      expect(s.getByText("Enter a whole number from 1024 to 65535."), bad).toBeTruthy();
      expect(save.disabled, bad).toBe(true);
      expect(box.getAttribute("aria-invalid"), bad).toBe("true");
    }
    expect(api.posts("/api/phone/settings")).toEqual([]);
  });

  it("drops a pairing code shown for the old port when the port is saved", async () => {
    open(on());
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Show pairing code" }));
    await s.findByText("ABCD-EFGH-JKLM");
    fireEvent.change(await portBox(s), { target: { value: "51000" } });
    fireEvent.click(s.getByRole("button", { name: "Save port" }));
    await waitFor(() => expect(s.queryByText("ABCD-EFGH-JKLM")).toBeNull());
    expect(s.queryByRole("img", { name: "QR code with the pairing link" })).toBeNull();
  });

  it("shows Core's refusal (a port Core itself uses) and keeps the typed value", async () => {
    const { api } = open(base());
    api.set(
      "POST /api/phone/settings",
      () =>
        new Response(
          JSON.stringify({
            code: "INVALID_REQUEST",
            message: '"port" is already used by Phoenix itself',
          }),
          { status: 400 },
        ),
    );
    const s = await section();
    const box = await portBox(s);
    fireEvent.change(box, { target: { value: "4870" } });
    fireEvent.click(s.getByRole("button", { name: "Save port" }));
    expect((await s.findByRole("alert")).textContent).toContain("used by Phoenix itself");
    expect(box.value).toBe("4870");
  });
});

describe("phone helpers", () => {
  it("groups codes and fingerprints whatever separators Core used", () => {
    expect(groupCode("abcdefghjklm")).toBe("ABCD-EFGH-JKLM");
    expect(groupCode("ABCD-EFGH-JKLM")).toBe("ABCD-EFGH-JKLM");
    expect(groupFingerprint("abcdef01")).toBe("AB:CD:EF:01");
    expect(groupFingerprint("AB:CD:EF")).toBe("AB:CD:EF");
  });

  it("brackets an IPv6 host and omits a missing port", () => {
    expect(hostPort("192.168.1.5", 4443)).toBe("192.168.1.5:4443");
    expect(hostPort("fe80::1", 4443)).toBe("[fe80::1]:4443");
    expect(hostPort("10.0.0.2", null)).toBe("10.0.0.2");
  });

  it("cleans a hostile name and caps its length but keeps other scripts", () => {
    expect(safeDeviceName("  a\u202Eb\nc\t d ")).toBe("a b c d");
    expect(safeDeviceName("电话 телефон")).toBe("电话 телефон");
    const long = safeDeviceName("x".repeat(500));
    expect(Array.from(long).length).toBe(65);
    expect(long.endsWith("…")).toBe(true);
  });

  it("parses a typed port strictly", () => {
    expect(parsePhonePort("47821")).toBe(47821);
    expect(parsePhonePort(" 1024 ")).toBe(1024);
    expect(parsePhonePort("65535")).toBe(65535);
    for (const bad of ["1023", "65536", "", " ", "08", "1e4", "+5000", "5000.0", "٥٠٠٠", "99999"])
      expect(parsePhonePort(bad), bad).toBeNull();
  });
});
