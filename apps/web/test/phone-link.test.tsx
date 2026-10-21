// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  groupCode,
  groupFingerprint,
  hostPort,
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
      const patch = body as Partial<PhoneStatus>;
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
});
