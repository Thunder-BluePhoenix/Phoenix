// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContinuityGlance, ContinuitySettings } from "../src/components/Continuity";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import {
  checkEntry,
  configFromDraft,
  draftFromConfig,
  draftProblems,
  readContinuityStatus,
  readOutcome,
  readThrottleStatus,
  validSsid,
} from "../src/core/continuity";
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

type Routes = Parameters<typeof fakeApi>[0];

const CONFIG_PATH = "/api/capabilities/awake/config";
const cmd = (name: string) => `/api/capabilities/awake/commands/${name}`;

const BROWSERS = {
  enabled: true,
  supported: true,
  browsers: [
    { bundle_id: "com.google.Chrome", name: "Google Chrome", running: true, throttled: true },
    { bundle_id: "com.brave.Browser", name: "Brave Browser", running: true, throttled: false },
    { bundle_id: "company.thebrowser.Browser", name: "Arc", running: false, throttled: false },
  ],
};

function statusResult(over: Record<string, unknown> = {}) {
  return {
    network_watch: { enabled: true, hosts: 1, down: false },
    hotspot: {
      enabled: true,
      ssid_set: true,
      password_saved: false,
      previous_network_saved: false,
    },
    last_outage: null,
    ...over,
  };
}

interface MountOptions {
  config?: Record<string, unknown>;
  enabled?: boolean;
  status?: unknown;
  throttle?: unknown;
  routes?: Routes;
}

function mount(options: MountOptions = {}): FakeApi {
  const api = fakeApi({
    "GET /api/capabilities": () => ({
      capabilities: [
        capability(
          "awake",
          options.enabled === false ? "disabled" : "enabled",
          options.config ?? {},
        ),
      ],
    }),
    [`POST ${cmd("continuity.status")}`]: () => ({ id: "op-status" }),
    "GET /api/operations/op-status": () => ({
      status: "succeeded",
      result: options.status ?? statusResult(),
    }),
    [`POST ${cmd("throttle.status")}`]: () => ({ id: "op-throttle" }),
    "GET /api/operations/op-throttle": () => ({
      status: "succeeded",
      result: options.throttle ?? BROWSERS,
    }),
    [`POST ${cmd("throttle.relaunch")}`]: () => ({ id: "op-relaunch" }),
    "GET /api/operations/op-relaunch": () => ({
      status: "succeeded",
      result: { relaunched: true, bundle_id: "com.google.Chrome" },
    }),
    [`POST ${cmd("hotspot.join_now")}`]: () => ({ id: "op-join" }),
    [`POST ${cmd("hotspot.rejoin_previous")}`]: () => ({ id: "op-join" }),
    "GET /api/operations/op-join": () => ({
      status: "succeeded",
      result: { joined: false, reason: "no_wifi_device" },
    }),
    ...options.routes,
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
        <ContinuitySettings />
        <ContinuityGlance />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return api;
}

const heading = () => screen.findByRole("heading", { name: "Agent continuity" });

async function fieldset(name: string): Promise<HTMLElement> {
  await heading();
  const legend = (await screen.findAllByText(name)).find((e) => e.tagName === "LEGEND");
  if (!legend?.parentElement) throw new Error(`no fieldset ${name}`);
  return legend.parentElement;
}

const toggle = (box: HTMLElement, name: string) => within(box).getByRole("checkbox", { name });

describe("pure helpers", () => {
  it("validates list entries the way the capability does", () => {
    expect(checkEntry("panes", " %12 ", [])).toEqual({ ok: true, value: "%12" });
    for (const bad of ["%1; rm", "$(x)", "%1 2", "", "%", "%1234567", "12"]) {
      expect(checkEntry("panes", bad, [])).toEqual({ ok: false, problem: "invalid" });
    }
    expect(checkEntry("panes", "%1", ["%1"])).toEqual({ ok: false, problem: "duplicate" });
    expect(checkEntry("hosts", "example.test:8080", [])).toMatchObject({ ok: true });
    expect(checkEntry("hosts", "example.test:70000", [])).toEqual({
      ok: false,
      problem: "invalid",
    });
    expect(checkEntry("hosts", "a b", [])).toEqual({ ok: false, problem: "invalid" });
    expect(checkEntry("sessions", "ph-0123456789abcdef", [])).toMatchObject({ ok: true });
    expect(checkEntry("sessions", "ph-xyz", [])).toEqual({ ok: false, problem: "invalid" });
    expect(checkEntry("commands", "claude", [])).toMatchObject({ ok: true });
    expect(checkEntry("commands", "rm -rf", [])).toEqual({ ok: false, problem: "invalid" });
    const full = ["a.test", "b.test", "c.test", "d.test", "e.test"];
    expect(checkEntry("hosts", "f.test", full)).toEqual({ ok: false, problem: "full" });
  });

  it("rejects SSIDs that start with a hyphen, hide characters or are too long", () => {
    expect(validSsid("Pocket Net")).toBe(true);
    for (const bad of ["", "-x", "a\u202eb", "x".repeat(33)]) expect(validSsid(bad)).toBe(false);
  });

  it("an empty config is a fully-off draft", () => {
    expect(draftFromConfig({})).toMatchObject({
      networkOn: false,
      hosts: [],
      hotspotOn: false,
      allowPasswordArgv: false,
      nudgeOn: false,
      panes: [],
      commands: [],
      enter: false,
      throttleOn: false,
      afterSeconds: "90",
    });
    expect(draftProblems(draftFromConfig({}))).toEqual([]);
    expect(draftProblems({ ...draftFromConfig({}), afterSeconds: "29" })).toEqual(["seconds"]);
    expect(draftProblems({ ...draftFromConfig({}), afterSeconds: "30" })).toEqual([]);
  });

  it("saving keeps config keys this form does not own", () => {
    const config = configFromDraft(
      { battery_floor_percent: 15 },
      { ...draftFromConfig({}), throttleOn: true },
    );
    expect(config.battery_floor_percent).toBe(15);
    expect(config.continuity).toMatchObject({
      throttle_check: { enabled: true },
      nudge: { enabled: false, enter: false },
    });
  });

  it("reads status answers defensively", () => {
    expect(readContinuityStatus(null)).toBeNull();
    expect(
      readContinuityStatus(statusResult({ last_outage: { started_at: "bad" } }))?.lastOutage,
    ).toBeNull();
    expect(
      readThrottleStatus({
        enabled: true,
        browsers: [{ bundle_id: 5 }, { bundle_id: "a", name: "A" }],
      })?.browsers,
    ).toHaveLength(1);
    expect(readThrottleStatus("x")).toBeNull();
    expect(readOutcome({ joined: false, reason: "made_up" }, "joined")).toEqual({
      done: false,
      reason: "power.continuity.reason.other",
    });
    expect(readOutcome({ relaunched: true }, "relaunched")).toEqual({ done: true });
  });
});

describe("Continuity settings", () => {
  it("shows every extra OFF by default, each as its own toggle with a plain description", async () => {
    mount();
    for (const name of [
      "Network watch",
      "Hotspot failover",
      "Nudge agents",
      "Browser throttling check",
    ]) {
      const box = await fieldset(name);
      expect((toggle(box, name) as HTMLInputElement).checked).toBe(false);
    }
    expect(
      (screen.getByRole("checkbox", { name: "Also press Enter" }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByRole("checkbox", { name: /use the saved hotspot password/ }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(screen.getByText(/Checks every few seconds that a computer you name/)).toBeTruthy();
  });

  it("turning one on and saving sends only that switch and keeps the others off and Enter off", async () => {
    const api = mount({ config: { battery_floor_percent: 15 } });
    const box = await fieldset("Browser throttling check");
    fireEvent.click(toggle(box, "Browser throttling check"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Saved\./);
    const body = api.posts(CONFIG_PATH)[0]?.body as { config: Record<string, unknown> };
    expect(body.config.battery_floor_percent).toBe(15);
    expect(body.config.continuity).toMatchObject({
      network_watch: { enabled: false, hosts: [] },
      hotspot: { enabled: false, allow_password_argv: false },
      nudge: { enabled: false, enter: false, panes: [], allowed_commands: [] },
      throttle_check: { enabled: true },
    });
  });

  it("shows the hotspot disclosure when enabling, and never a password field", async () => {
    mount();
    const box = await fieldset("Hotspot failover");
    expect(screen.queryByText(/every program on this Mac can read it/)).toBeNull();
    fireEvent.click(toggle(box, "Hotspot failover"));
    expect(screen.getByRole("note").textContent).toMatch(
      /every program on this Mac can read it on that command line/,
    );
    expect(screen.getByRole("note").textContent).toMatch(/Decline if that is not acceptable/);
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("opting in to the password tells the user whether one is saved", async () => {
    mount({ status: statusResult({ hotspot: { password_saved: false } }) });
    const box = await fieldset("Hotspot failover");
    fireEvent.click(screen.getByRole("checkbox", { name: /use the saved hotspot password/ }));
    expect(await within(box).findByText(/No hotspot password is saved/)).toBeTruthy();
  });

  it("validates pane ids in the list editor and refuses injection text", async () => {
    const api = mount();
    const box = await fieldset("Nudge agents");
    const input = within(box).getByLabelText("tmux panes (for example %12)");
    const add = (value: string) => {
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: "Enter" });
    };
    for (const bad of ["%1; rm -rf /", "$(x)", "%", ""]) {
      add(bad);
      expect((await within(box).findByRole("alert")).textContent).toMatch(
        /tmux pane id such as %12/,
      );
    }
    expect(within(box).queryByText("%1; rm -rf /")).toBeNull();
    add("%12");
    expect(within(box).getByText("%12")).toBeTruthy();
    add("%12");
    expect((await within(box).findByRole("alert")).textContent).toMatch(/already in the list/);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.posts(CONFIG_PATH)).toHaveLength(1));
    expect(
      (
        api.posts(CONFIG_PATH)[0]?.body as {
          config: { continuity: { nudge: { panes: string[] } } };
        }
      ).config.continuity.nudge.panes,
    ).toEqual(["%12"]);
    fireEvent.click(within(box).getByRole("button", { name: "Remove %12" }));
    expect(within(box).queryByText("%12")).toBeNull();
  });

  it("refuses to save a nudge delay under 30 seconds and a bad SSID", async () => {
    const api = mount();
    const box = await fieldset("Nudge agents");
    fireEvent.change(within(box).getByLabelText(/Seconds without network/), {
      target: { value: "10" },
    });
    expect(within(box).getByRole("alert").textContent).toMatch(/from 30 to 3600/);
    const hotspot = await fieldset("Hotspot failover");
    fireEvent.change(within(hotspot).getByLabelText("Hotspot name (SSID)"), {
      target: { value: "-evil" },
    });
    expect(within(hotspot).getByRole("alert").textContent).toMatch(/does not start with a hyphen/);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.posts(CONFIG_PATH)).toHaveLength(0);
  });

  it("tells the user session targets cannot be nudged yet", async () => {
    mount();
    const box = await fieldset("Nudge agents");
    expect(
      within(box).getByText(/Phoenix has no safe way to type into a tracked session/),
    ).toBeTruthy();
  });
});

describe("Throttle list", () => {
  const withThrottle = { continuity: { throttle_check: { enabled: true } } };

  it("lists browsers, offers Relaunch only for the running throttled one, and sends nothing until confirmed", async () => {
    const api = mount({ config: withThrottle });
    const box = await fieldset("Browser throttling check");
    expect(await within(box).findByText("Google Chrome")).toBeTruthy();
    expect(within(box).getAllByRole("button", { name: /Relaunch/ })).toHaveLength(1);
    fireEvent.click(
      within(box).getByRole("button", { name: "Relaunch Google Chrome unthrottled" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/tabs will reload/);
    expect(dialog.textContent).toMatch(/refused during a meeting or dictation/);
    expect(api.posts(cmd("throttle.relaunch"))).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.posts(cmd("throttle.relaunch"))).toHaveLength(0);
  });

  it("confirming sends the bundle id of that browser and nothing else", async () => {
    const api = mount({ config: withThrottle });
    const box = await fieldset("Browser throttling check");
    fireEvent.click(
      await within(box).findByRole("button", { name: "Relaunch Google Chrome unthrottled" }),
    );
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Quit and relaunch",
      }),
    );
    await waitFor(() => expect(api.posts(cmd("throttle.relaunch"))).toHaveLength(1));
    expect(api.posts(cmd("throttle.relaunch"))[0]?.body).toEqual({
      input: { bundle_id: "com.google.Chrome" },
    });
  });

  it("shows why a relaunch was refused", async () => {
    mount({
      config: withThrottle,
      routes: {
        "GET /api/operations/op-relaunch": () => ({
          status: "succeeded",
          result: { relaunched: false, reason: "protected" },
        }),
      },
    });
    const box = await fieldset("Browser throttling check");
    fireEvent.click(
      await within(box).findByRole("button", { name: "Relaunch Google Chrome unthrottled" }),
    );
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Quit and relaunch",
      }),
    );
    expect((await within(box).findByRole("alert")).textContent).toMatch(
      /meeting or dictation is in progress/,
    );
  });

  it("asks for nothing while the check is off", async () => {
    const api = mount();
    await fieldset("Browser throttling check");
    expect(api.posts(cmd("throttle.status"))).toHaveLength(0);
  });
});

describe("Outage status and hotspot buttons", () => {
  it("shows the last outage with the hotspot result and how many terminals were nudged", async () => {
    mount({
      status: statusResult({
        last_outage: {
          started_at: "2026-10-20T09:00:00Z",
          ended_at: "2026-10-20T09:10:00Z",
          hotspot: "joined",
          nudged: 2,
        },
      }),
    });
    await heading();
    expect((await screen.findAllByText(/Hotspot joined/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 terminals nudged/).length).toBeGreaterThan(0);
  });

  it("an open outage is flagged on the Overview glance", async () => {
    mount({
      status: statusResult({
        last_outage: {
          started_at: "2026-10-20T09:00:00Z",
          ended_at: null,
          hotspot: "skipped",
          nudged: 0,
        },
      }),
    });
    await waitFor(() => expect(document.querySelector(".continuity-glance")).not.toBeNull());
    const glance = document.querySelector<HTMLElement>(".continuity-glance");
    expect(within(glance as HTMLElement).getByRole("status").textContent).toMatch(
      /network is down since/,
    );
  });

  it("the Join button needs the SAVED setting on, asks Core (which confirms) and reports a refusal", async () => {
    const api = mount({
      config: { continuity: { hotspot: { enabled: true, ssid: "Pocket Net" } } },
    });
    const box = await fieldset("Hotspot failover");
    const join = within(box).getByRole("button", { name: "Join hotspot now" });
    await waitFor(() => expect((join as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(join);
    await waitFor(() => expect(api.posts(cmd("hotspot.join_now"))).toHaveLength(1));
    expect((await within(box).findByRole("alert")).textContent).toMatch(
      /could not find this Mac’s Wi-Fi device/,
    );
  });

  it("the Join button is disabled while hotspot failover is off", async () => {
    mount();
    const box = await fieldset("Hotspot failover");
    expect(
      (within(box).getByRole("button", { name: "Join hotspot now" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows nothing at all while the Keep awake capability is off (glance)", async () => {
    const api = mount({ enabled: false });
    await heading();
    expect(document.querySelector(".continuity-glance")).toBeNull();
    expect(api.posts(cmd("continuity.status"))).toHaveLength(0);
    expect(
      screen.getByText(/take effect only while the Keep awake capability is enabled/),
    ).toBeTruthy();
  });
});
