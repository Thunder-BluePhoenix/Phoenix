// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LidActionsGlance, LidActionsSettings } from "../src/components/LidActions";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import {
  checkLidEntry,
  lidConfigFromDraft,
  lidDraftFromConfig,
  readLidStatus,
  reasonKey,
} from "../src/core/lid";
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

function action(id: string, enabled: boolean, extra: Record<string, unknown> = {}) {
  return { id, enabled, ...(enabled ? { supported: true } : {}), ...extra };
}

function statusResult(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    closed: false,
    actions: [
      action("app_nap", false),
      action("freeze_apps", true),
      action("docker_freeze", false),
      action("mute", true, { limits: ["default_output_only"] }),
      action("low_power", true, { supported: false, reason: "helper_unavailable" }),
      action("display", true, {
        limits: ["keyboard_backlight_unsupported", "brightness_tool_missing"],
      }),
    ],
    protected: { built_in: ["Phoenix", "Terminal", "Visual Studio Code", "claude"], extra: [] },
    last: null,
    ...over,
  };
}

interface MountOptions {
  config?: Record<string, unknown>;
  enabled?: boolean;
  status?: unknown;
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
    [`POST ${cmd("lid_actions.status")}`]: () => ({ id: "op-lid" }),
    "GET /api/operations/op-lid": () => ({
      status: "succeeded",
      result: options.status ?? statusResult(),
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
        <LidActionsSettings />
        <LidActionsGlance />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return api;
}

const heading = () => screen.findByRole("heading", { name: "Lid-close actions" });

async function fieldset(name: string): Promise<HTMLElement> {
  await heading();
  const legend = (await screen.findAllByText(name)).find((e) => e.tagName === "LEGEND");
  if (!legend?.parentElement) throw new Error(`no fieldset ${name}`);
  return legend.parentElement;
}

const savedConfig = (api: FakeApi) =>
  (api.posts(CONFIG_PATH)[0]?.body as { config: { lid_actions: Record<string, unknown> } }).config
    .lid_actions;

describe("pure helpers", () => {
  it("an empty config is the capability's defaults: Docker and App Nap off, the rest on, three apps", () => {
    expect(lidDraftFromConfig({})).toEqual({
      enabled: true,
      display: true,
      freezeApps: true,
      freezeList: ["slack", "whatsapp", "discord"],
      mute: true,
      lowPower: true,
      dockerFreeze: false,
      appNap: false,
      appNapList: [],
      protectedExtra: [],
    });
  });

  it("wrong-typed stored values fall back to the defaults, and unknown app keys are dropped", () => {
    const draft = lidDraftFromConfig({
      lid_actions: { display: "no", docker_freeze: 1, freeze_apps_list: ["slack", "Terminal"] },
    });
    expect(draft.display).toBe(true);
    expect(draft.dockerFreeze).toBe(false);
    expect(draft.freezeList).toEqual(["slack"]);
  });

  it("validates entries the way the capability does", () => {
    expect(checkLidEntry("napApps", " com.example.App ", [])).toEqual({
      ok: true,
      value: "com.example.App",
    });
    for (const bad of ["", "single", "-x.y", "a b.c", "a.b;rm -rf /", "$(x).y"]) {
      expect(checkLidEntry("napApps", bad, []), bad).toEqual({ ok: false, problem: "invalid" });
    }
    expect(checkLidEntry("napApps", "com.a.B", ["com.a.B"])).toEqual({
      ok: false,
      problem: "duplicate",
    });
    expect(checkLidEntry("protectedExtra", "My Tool", [])).toEqual({ ok: true, value: "My Tool" });
    expect(checkLidEntry("protectedExtra", "my tool", ["My Tool"])).toEqual({
      ok: false,
      problem: "duplicate",
    });
    for (const bad of ["../etc", "a;b", "/bin/sh", ""]) {
      expect(checkLidEntry("protectedExtra", bad, []), bad).toEqual({
        ok: false,
        problem: "invalid",
      });
    }
    const full = Array.from({ length: 16 }, (_, i) => `com.a.B${i}`);
    expect(checkLidEntry("napApps", "com.a.Z", full)).toEqual({ ok: false, problem: "full" });
  });

  it("saving keeps config keys this form does not own", () => {
    const config = lidConfigFromDraft(
      { battery_floor_percent: 15, continuity: { x: 1 } },
      { ...lidDraftFromConfig({}), dockerFreeze: true },
    );
    expect(config.battery_floor_percent).toBe(15);
    expect(config.continuity).toEqual({ x: 1 });
    expect(config.lid_actions).toMatchObject({
      docker_freeze: true,
      freeze_apps_list: ["slack", "whatsapp", "discord"],
    });
  });

  it("reads status answers defensively and maps unknown reason codes to a generic text", () => {
    expect(readLidStatus(null)).toBeNull();
    expect(readLidStatus({ actions: "x" })).toBeNull();
    const view = readLidStatus(
      statusResult({
        last: {
          event: "opened",
          at: 5,
          results: [
            { action: "mute", outcome: "undone", count: 2 },
            { action: "bogus", outcome: "undone" },
            { action: "mute", outcome: "weird" },
          ],
        },
      }),
    );
    expect(view?.last?.results).toHaveLength(1);
    expect(view?.actions.find((a) => a.id === "docker_freeze")).toMatchObject({
      enabled: false,
      supported: undefined,
    });
    expect(reasonKey("made_up")).toBe("power.lid.reason.other");
    expect(reasonKey(undefined)).toBe("power.lid.reason.other");
    expect(reasonKey("helper_unavailable")).toBe("power.lid.reason.helper_unavailable");
    expect(reasonKey("constructor")).toBe("power.lid.reason.other");
  });
});

describe("Lid actions settings", () => {
  it("shows every action as its own toggle with a plain description; Docker and App Nap are off by default", async () => {
    mount();
    for (const [name, on] of [
      ["Turn the display off", true],
      ["Freeze chat apps", true],
      ["Mute the sound", true],
      ["Low Power Mode", true],
      ["Freeze Docker Desktop", false],
      ["Keep agent apps out of App Nap", false],
    ] as const) {
      const box = await fieldset(name);
      expect((within(box).getByRole("checkbox", { name }) as HTMLInputElement).checked, name).toBe(
        on,
      );
    }
    expect(screen.getByText(/Pauses the chosen chat apps so they stop using power/)).toBeTruthy();
    expect(
      screen.getByText(/Never when a container runs or Docker's state is unknown/),
    ).toBeTruthy();
  });

  it("turning Docker on and saving sends only that change and keeps the other keys", async () => {
    const api = mount({ config: { battery_floor_percent: 15 } });
    const box = await fieldset("Freeze Docker Desktop");
    fireEvent.click(within(box).getByRole("checkbox", { name: "Freeze Docker Desktop" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Saved\./);
    const body = api.posts(CONFIG_PATH)[0]?.body as { config: Record<string, unknown> };
    expect(body.config.battery_floor_percent).toBe(15);
    expect(savedConfig(api)).toMatchObject({
      docker_freeze: true,
      app_nap: false,
      display: true,
      freeze_apps_list: ["slack", "whatsapp", "discord"],
    });
  });

  it("the master switch off disables the per-action switches and saves enabled: false", async () => {
    const api = mount();
    await heading();
    fireEvent.click(screen.getByRole("checkbox", { name: "Run actions when the lid closes" }));
    const box = await fieldset("Mute the sound");
    expect((box as HTMLFieldSetElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.posts(CONFIG_PATH)).toHaveLength(1));
    expect(savedConfig(api)).toMatchObject({ enabled: false });
  });

  it("choosing which chat apps to freeze is saved as the list", async () => {
    const api = mount();
    const box = await fieldset("Freeze chat apps");
    fireEvent.click(within(box).getByRole("checkbox", { name: "Discord" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.posts(CONFIG_PATH)).toHaveLength(1));
    expect(savedConfig(api).freeze_apps_list).toEqual(["slack", "whatsapp"]);
  });

  it("validates bundle ids for App Nap and refuses injection text", async () => {
    const api = mount({ config: { lid_actions: { app_nap: true } } });
    const box = await fieldset("Keep agent apps out of App Nap");
    const input = within(box).getByLabelText(/Apps \(bundle ids/);
    const add = (value: string) => {
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: "Enter" });
    };
    for (const bad of ["x; rm -rf ~", "$(x).y", "single", ""]) {
      add(bad);
      expect((await within(box).findByRole("alert")).textContent).toMatch(
        /bundle id such as com\.example\.App/,
      );
    }
    add("com.example.Agent");
    expect(within(box).getByText("com.example.Agent")).toBeTruthy();
    add("com.example.Agent");
    expect((await within(box).findByRole("alert")).textContent).toMatch(/already in the list/);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.posts(CONFIG_PATH)).toHaveLength(1));
    expect(savedConfig(api).app_nap_apps).toEqual(["com.example.Agent"]);
  });

  it("shows the built-in protected list read-only and lets the user ADD names (validated); built-ins have no remove button", async () => {
    const api = mount();
    const box = await fieldset("Never frozen");
    const builtIn = await within(box).findByRole("list", { name: "Built in" });
    expect(within(builtIn).getByText("Terminal")).toBeTruthy();
    expect(within(builtIn).getByText("claude")).toBeTruthy();
    expect(within(builtIn).queryAllByRole("button")).toHaveLength(0);
    const input = within(box).getByLabelText("Add a program or app name");
    fireEvent.change(input, { target: { value: "../etc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((await within(box).findByRole("alert")).textContent).toMatch(
      /plain program or app name/,
    );
    fireEvent.change(input, { target: { value: "My Tool" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(within(box).getByText("My Tool")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.posts(CONFIG_PATH)).toHaveLength(1));
    expect(savedConfig(api).protected_extra).toEqual(["My Tool"]);
  });

  it("tells the user when an enabled action is unsupported here, and what only partly works", async () => {
    mount();
    const lowPower = await fieldset("Low Power Mode");
    expect((await within(lowPower).findByRole("note")).textContent).toMatch(
      /Not available here: The privileged helper is not installed/,
    );
    const display = await fieldset("Turn the display off");
    expect(
      (await within(display).findByText(/keyboard light cannot be controlled/)).textContent,
    ).toMatch(/free brightness tool is not installed/);
    expect(screen.getByText(/Some of these only partly work on this computer/)).toBeTruthy();
  });

  it("shows the last lid event with each action's result and flags a process that no longer matched", async () => {
    mount({
      status: statusResult({
        last: {
          event: "opened",
          at: Date.parse("2026-10-20T09:10:00Z"),
          results: [
            { action: "freeze_apps", outcome: "undone", count: 3, mismatched: 1 },
            { action: "mute", outcome: "undo_failed", reason: "undo_failed" },
            { action: "low_power", outcome: "skipped", reason: "helper_unavailable" },
          ],
        },
      }),
    });
    await heading();
    expect(await screen.findByText(/The lid opened at/)).toBeTruthy();
    const items = document.querySelectorAll(".lid-results li");
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toMatch(
      /Freeze chat apps: Undone.*1 process was not resumed because it no longer matched/,
    );
    expect(items[1]?.textContent).toMatch(
      /Mute the sound: Could not be undone.*The change could not be undone/,
    );
    expect(items[2]?.textContent).toMatch(
      /Low Power Mode: Skipped.*The privileged helper is not installed/,
    );
  });

  it("shows the security-review codes in plain text: output changed, restarted app, not Phoenix's, unknown output name", async () => {
    mount({
      status: statusResult({
        last: {
          event: "opened",
          at: Date.parse("2026-10-20T09:10:00Z"),
          results: [
            { action: "mute", outcome: "undo_failed", reason: "output_changed" },
            { action: "freeze_apps", outcome: "undo_failed", reason: "retry_or_alert" },
            { action: "docker_freeze", outcome: "undone", count: 1, notOurs: 2 },
            { action: "display", outcome: "skipped", reason: "assertions_unknown" },
            { action: "app_nap", outcome: "applied", count: 1, notes: ["output_identity_unknown"] },
          ],
        },
      }),
    });
    await heading();
    await screen.findByText(/The lid opened at/);
    const items = [...document.querySelectorAll(".lid-results li")].map((li) => li.textContent);
    expect(items[0]).toMatch(/Mute the sound: Could not be undone.*left the new output alone/);
    expect(items[1]).toMatch(/Freeze chat apps: Could not be undone.*was restarted/);
    expect(items[2]).toMatch(/Freeze Docker Desktop: Undone.*not Phoenix's to control/);
    expect(items[3]).toMatch(/Turn the display off: Skipped.*whether an app is in a call/);
    expect(items[4]).toMatch(/cannot read the name of the sound output/);
  });

  it("says so when nothing has happened, and asks nothing while Keep awake is off", async () => {
    const api = mount({ enabled: false });
    await heading();
    expect(screen.getByText("Nothing has happened yet.")).toBeTruthy();
    expect(screen.getByText(/only run while the Keep awake capability is enabled/)).toBeTruthy();
    expect(api.posts(cmd("lid_actions.status"))).toHaveLength(0);
  });
});

describe("Overview glance", () => {
  it("is empty while the lid is open and nothing failed", async () => {
    mount();
    await heading();
    await waitFor(() => expect(screen.getByText("Nothing has happened yet.")).toBeTruthy());
    expect(document.querySelector(".lid-glance")).toBeNull();
  });

  it("flags a closed lid and an undo that failed", async () => {
    mount({ status: statusResult({ closed: true }) });
    await waitFor(() => expect(document.querySelector(".lid-glance")).not.toBeNull());
    expect(
      within(document.querySelector<HTMLElement>(".lid-glance") as HTMLElement).getByRole("status")
        .textContent,
    ).toMatch(/lid-close actions are applied/);
    cleanup();
    FakeWebSocket.reset();
    mount({
      status: statusResult({
        last: { event: "opened", at: 1, results: [{ action: "mute", outcome: "undo_failed" }] },
      }),
    });
    await waitFor(() => expect(document.querySelector(".lid-glance")).not.toBeNull());
    expect(document.querySelector(".lid-glance")?.textContent).toMatch(/could not be undone/);
  });
});
