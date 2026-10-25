// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PortRadar } from "../src/components/PortRadar";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import {
  ageParts,
  localhostUrl,
  phoenixBrowserLink,
  readPortsSnapshot,
  readRestartResult,
  readStopResult,
  type PhoenixLinkShell,
} from "../src/core/ports";
import { I18nProvider } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { XSS, capability, expectInert } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
});

const START = "Mon Oct 19 09:56:56 2026";
const COMMAND = "/Users/ada/.nvm/bin/node";

const port = (over: Record<string, unknown> = {}) => ({
  pid: 4242,
  port: 3000,
  exposure: "loopback",
  name: "node",
  command: COMMAND,
  uid: 501,
  start: START,
  age_seconds: 30 * 3600,
  project: "shop",
  cpu_percent: 1.5,
  rss_mb: 120,
  forgotten: true,
  heavy: false,
  stoppable: true,
  refusal: null,
  is_core: false,
  url: "http://127.0.0.1:3000/",
  ...over,
});

const snapshot = (ports: unknown[], over: Record<string, unknown> = {}) => ({
  platform: "darwin",
  collector: "lsof",
  scanned_at: "2026-10-20T12:00:00Z",
  process_table: true,
  ports,
  thresholds: { forgottenHours: 8, heavyCpuPercent: 80, heavyRssMb: 1024 },
  ...over,
});

interface Mounted {
  api: FakeApi;
  scans: () => number;
}

function mount(
  ports: unknown[],
  opts: {
    enabled?: boolean;
    over?: Record<string, unknown>;
    routes?: Parameters<typeof fakeApi>[0];
    linkShell?: PhoenixLinkShell;
  } = {},
): Mounted {
  const api = fakeApi({
    "GET /api/capabilities": () => ({
      capabilities: [capability("ports", opts.enabled === false ? "disabled" : "enabled")],
    }),
    "POST /api/capabilities/ports/commands/list": () => ({ id: "op-list" }),
    "GET /api/operations/op-list": () => ({
      status: "succeeded",
      result: snapshot(ports, opts.over),
    }),
    "POST /api/capabilities/ports/commands/stop_process": () => ({ id: "op-stop" }),
    "POST /api/capabilities/ports/commands/force_stop": () => ({ id: "op-force" }),
    ...opts.routes,
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
        <PortRadar {...(opts.linkShell ? { linkShell: opts.linkShell } : {})} />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return { api, scans: () => api.posts("/api/capabilities/ports/commands/list").length };
}

const scanNow = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Scan now" }));
  return await screen.findByRole("table");
};

describe("reading Core's answer", () => {
  it("accepts a real list and rejects shapes that would put a wrong row on screen", () => {
    expect(readPortsSnapshot(snapshot([port()]))?.ports[0]).toMatchObject({
      port: 3000,
      project: "shop",
      reachable: true,
    });
    expect(readPortsSnapshot(null)).toBeNull();
    expect(readPortsSnapshot(snapshot([port({ port: 70000 })]))).toBeNull();
    expect(readPortsSnapshot(snapshot([port({ pid: "4242" })]))).toBeNull();
    expect(readPortsSnapshot(snapshot([port({ exposure: "everywhere" })]))).toBeNull();
    expect(readPortsSnapshot(snapshot([port({ refusal: "because" })]))).toBeNull();
    expect(readPortsSnapshot(snapshot([port()], { platform: "plan9" }))).toBeNull();
    expect(
      readStopResult({
        pid: 1,
        port: 2,
        name: "n",
        signal: "SIGHUP",
        exited: true,
        can_force: false,
      }),
    ).toBeNull();
  });

  it("age is shown in the largest whole unit, unknown stays unknown", () => {
    expect(ageParts(59)).toEqual({ unit: "minutes", count: 0 });
    expect(ageParts(3600)).toEqual({ unit: "hours", count: 1 });
    expect(ageParts(30 * 3600)).toEqual({ unit: "days", count: 1 });
    expect(ageParts(null)).toBeNull();
    expect(ageParts(-5)).toBeNull();
  });
});

describe("parse warnings", () => {
  it("are shown when Core says lines of ps or ss output were dropped, and not otherwise", async () => {
    expect(readPortsSnapshot(snapshot([port()], { parse_warnings: 2 }))?.parse_warnings).toBe(2);
    expect(readPortsSnapshot(snapshot([port()]))?.parse_warnings).toBe(0);
    mount([port()], { over: { parse_warnings: 2 } });
    await scanNow();
    expect(screen.getByText(/were not understood and were left out/)).toBeTruthy();
  });

  it("show nothing when there were none", async () => {
    mount([port()], { over: { parse_warnings: 0 } });
    await scanNow();
    expect(screen.queryByText(/were not understood and were left out/)).toBeNull();
  });
});

describe("the open link rule", () => {
  it("is built from the port number only: always http://127.0.0.1:<port>/, never from anything Core sent", async () => {
    mount([
      port({ url: "https://evil.example/steal", name: "javascript:alert(1)", project: "//evil" }),
    ]);
    const table = await scanNow();
    const link = within(table).getByRole("link");
    expect(link.getAttribute("href")).toBe("http://127.0.0.1:3000/");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(localhostUrl(3000, true)).toBe("http://127.0.0.1:3000/");
    expect(localhostUrl(0, true)).toBeNull();
    expect(localhostUrl(65536, true)).toBeNull();
    expect(localhostUrl(3000, false)).toBeNull();
  });

  it("offers no link when 127.0.0.1 does not reach the socket, and says Phoenix has no browser yet", async () => {
    mount([port({ url: null, pid: 1, port: 5000 }), port({ port: 5001, pid: 2 })]);
    const table = await scanNow();
    const links = within(table).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["http://127.0.0.1:5001/"]);
    expect(within(table).getAllByRole("button", { name: /in the Phoenix browser/ })).toHaveLength(
      1,
    );
    expect(
      screen.getByText(/hands the same loopback address to the Phoenix desktop app/),
    ).toBeTruthy();
  });

  it("hands a phoenix://browser/open link to the shell, exactly as the Rust parser reads it", async () => {
    const opened: string[] = [];
    mount([port({ port: 3000 })], { linkShell: { open: (l) => void opened.push(l) } });
    const table = await scanNow();
    fireEvent.click(
      within(table).getByRole("button", { name: /Open node on port 3000 in the Phoenix browser/ }),
    );
    expect(opened).toEqual(["phoenix://browser/open?url=http%3A%2F%2F127.0.0.1%3A3000%2F"]);
    // Same shape browser_core::radar_link accepts: one `url` parameter, host `browser`, path `/open`.
    const parsed = new URL(opened[0]!);
    expect(parsed.host).toBe("browser");
    expect(parsed.pathname).toBe("/open");
    expect(parsed.hash).toBe("");
    expect([...parsed.searchParams.keys()]).toEqual(["url"]);
    expect(parsed.searchParams.get("url")).toBe("http://127.0.0.1:3000/");
    // The plain loopback link stays next to it as the fallback.
    expect(within(table).getByRole("link").getAttribute("href")).toBe("http://127.0.0.1:3000/");
  });

  it("offers no Phoenix browser button for Core itself, unreachable sockets or non-macOS scans", async () => {
    mount([port({ port: 4870, pid: 1, is_core: true }), port({ port: 5000, pid: 2, url: null })]);
    const table = await scanNow();
    expect(within(table).queryAllByRole("button", { name: /Phoenix browser/ })).toHaveLength(0);
    cleanup();
    mount([port()], { over: { platform: "linux" } });
    const linux = await scanNow();
    expect(within(linux).queryAllByRole("button", { name: /Phoenix browser/ })).toHaveLength(0);
    expect(within(linux).getAllByRole("link")).toHaveLength(1);
  });

  it("builds the link from the port number alone", () => {
    expect(phoenixBrowserLink(3000, true, false)).toBe(
      "phoenix://browser/open?url=http%3A%2F%2F127.0.0.1%3A3000%2F",
    );
    expect(phoenixBrowserLink(3000, true, true)).toBeNull();
    expect(phoenixBrowserLink(3000, false, false)).toBeNull();
    expect(phoenixBrowserLink(0, true, false)).toBeNull();
    expect(phoenixBrowserLink(65536, true, false)).toBeNull();
    expect(phoenixBrowserLink(3000.5, true, false)).toBeNull();
  });
});

describe("what a row shows", () => {
  it("shows the project folder name, age and flags; process text is inert", async () => {
    const { api } = mount([port({ name: XSS, heavy: true })]);
    const table = await scanNow();
    expect(within(table).getByText("shop")).toBeTruthy();
    expect(within(table).getByText("1 day")).toBeTruthy();
    expect(within(table).getByText("Maybe forgotten")).toBeTruthy();
    expect(within(table).getByText("Heavy")).toBeTruthy();
    expectInert(table.parentElement as HTMLElement);
    expect(api.calls.some((c) => c.method === "POST" && c.path.includes("stop"))).toBe(false);
  });

  it("a process that may not be stopped shows why and has no Stop button", async () => {
    mount([port({ stoppable: false, refusal: "system", forgotten: false })]);
    const table = await scanNow();
    expect(within(table).getByText("It is a system process.")).toBeTruthy();
    expect(within(table).queryByRole("button", { name: /Stop/ })).toBeNull();
  });

  it("Phoenix itself is labelled and cannot be stopped", async () => {
    mount([port({ stoppable: false, refusal: "self", is_core: true, forgotten: false })]);
    const table = await scanNow();
    expect(within(table).getByText("Phoenix itself")).toBeTruthy();
    expect(within(table).queryByRole("button", { name: /Stop/ })).toBeNull();
  });

  it("Windows says ages, projects and stopping are not available", async () => {
    mount(
      [
        port({
          age_seconds: null,
          project: null,
          start: null,
          stoppable: false,
          refusal: "unsupported",
        }),
      ],
      {
        over: { platform: "win32" },
      },
    );
    await scanNow();
    expect(
      screen.getByText(/On Windows the radar shows ports and program names only/),
    ).toBeTruthy();
  });

  it("an empty machine says so; an unreadable answer is an error, not an empty table", async () => {
    mount([]);
    fireEvent.click(await screen.findByRole("button", { name: "Scan now" }));
    expect(await screen.findByText("No program is listening on a port.")).toBeTruthy();
    cleanup();
    mount([port({ pid: "x" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Scan now" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("availability and scanning", () => {
  it("does not scan on its own; a disabled capability offers no scan; an absent one renders nothing", async () => {
    const m = mount([port()]);
    await screen.findByRole("button", { name: "Scan now" });
    expect(m.scans()).toBe(0);
    cleanup();
    mount([port()], { enabled: false });
    expect(await screen.findByText(/turned off/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Scan now" })).toBeNull();
    cleanup();
    FakeWebSocket.reset();
    const api = fakeApi({ "GET /api/capabilities": () => ({ capabilities: [] }) });
    const client = new PhoenixClient({
      token: "tok",
      baseUrl: "http://127.0.0.1:4870",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: api.fetchImpl,
    });
    const view = render(
      <CoreProvider client={client}>
        <I18nProvider forceLocale="en">
          <PortRadar />
        </I18nProvider>
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/capabilities")).toBe(true));
    expect(view.container.textContent).toBe("");
  });

  it("the background refresh switch is off by default and saves config only when the user flips it", async () => {
    const m = mount([port()], {
      routes: { "POST /api/capabilities/ports/config": () => ({}) },
    });
    const box = (await screen.findByRole("checkbox")) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(m.api.posts("/api/capabilities/ports/config")).toEqual([]);
    fireEvent.click(box);
    await waitFor(() =>
      expect(m.api.posts("/api/capabilities/ports/config").map((c) => c.body)).toEqual([
        { config: { watch: true } },
      ]),
    );
  });
});

describe("stopping", () => {
  const body = { pid: 4242, port: 3000, start: START, command: COMMAND, uid: 501 };
  const stopped = (over: Record<string, unknown> = {}) => ({
    pid: 4242,
    port: 3000,
    name: "node",
    signal: "SIGTERM",
    outcome: "sent",
    exited: true,
    can_force: false,
    ...over,
  });

  it("Stop asks first and sends nothing until the user confirms; Cancel sends nothing", async () => {
    const m = mount([port()]);
    const table = await scanNow();
    fireEvent.click(within(table).getByRole("button", { name: "Stop node on port 3000" }));
    const group = await screen.findByRole("group");
    expect(within(group).getByText("Stop node on port 3000?")).toBeTruthy();
    expect(m.api.posts("/api/capabilities/ports/commands/stop_process")).toEqual([]);
    fireEvent.click(within(group).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group")).toBeNull();
    expect(m.api.posts("/api/capabilities/ports/commands/stop_process")).toEqual([]);
  });

  it("confirming sends exactly the proof the user saw, then reports the result and rescans", async () => {
    const m = mount([port()], {
      routes: { "GET /api/operations/op-stop": () => ({ status: "succeeded", result: stopped() }) },
    });
    const table = await scanNow();
    fireEvent.click(within(table).getByRole("button", { name: "Stop node on port 3000" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ask to stop" }));
    await waitFor(() =>
      expect(
        m.api.posts("/api/capabilities/ports/commands/stop_process").map((c) => c.body),
      ).toEqual([{ input: body }]),
    );
    expect(await screen.findByText("node stopped.")).toBeTruthy();
    await waitFor(() => expect(m.scans()).toBe(2));
    expect(m.api.posts("/api/capabilities/ports/commands/force_stop")).toEqual([]);
  });

  it("a stop that did not end the process offers Force stop, which is a second request with its own confirmation", async () => {
    const m = mount([port()], {
      routes: {
        "GET /api/operations/op-stop": () => ({
          status: "succeeded",
          result: stopped({ exited: false, can_force: true }),
        }),
        "GET /api/operations/op-force": () => ({
          status: "succeeded",
          result: stopped({ signal: "SIGKILL", exited: true }),
        }),
      },
    });
    const table = await scanNow();
    fireEvent.click(within(table).getByRole("button", { name: "Stop node on port 3000" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ask to stop" }));
    // The list is read again after a stop, and the button is disabled until that is done.
    const force = await screen.findByRole("button", { name: "Force stop node on port 3000" });
    await waitFor(() => expect((force as HTMLButtonElement).disabled).toBe(false));
    expect(m.api.posts("/api/capabilities/ports/commands/force_stop")).toEqual([]);
    fireEvent.click(force);
    // Nothing is sent by that click: it only opens the confirmation.
    expect(m.api.posts("/api/capabilities/ports/commands/force_stop")).toEqual([]);
    const group = await screen.findByRole("group");
    fireEvent.click(within(group).getByRole("button", { name: "Force stop" }));
    await waitFor(() =>
      expect(m.api.posts("/api/capabilities/ports/commands/force_stop").map((c) => c.body)).toEqual(
        [{ input: body }],
      ),
    );
    expect(await screen.findByText("node stopped.")).toBeTruthy();
  });

  it("Force stop is disabled while the list is read again, and available once it is", async () => {
    const rescan = Promise.withResolvers<unknown>();
    let reads = 0;
    const m = mount([port()], {
      routes: {
        "GET /api/operations/op-list": async () => {
          reads += 1;
          // The first read is the user's scan; the read after the stop is held open.
          if (reads === 1) return { status: "succeeded", result: snapshot([port()]) };
          return await rescan.promise;
        },
        "GET /api/operations/op-stop": () => ({
          status: "succeeded",
          result: stopped({ exited: false, can_force: true }),
        }),
      },
    });
    const table = await scanNow();
    fireEvent.click(within(table).getByRole("button", { name: "Stop node on port 3000" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ask to stop" }));
    const force = (await screen.findByRole("button", {
      name: "Force stop node on port 3000",
    })) as HTMLButtonElement;
    expect(force.disabled).toBe(true);
    fireEvent.click(force);
    expect(screen.queryByRole("group")).toBeNull();
    expect(m.api.posts("/api/capabilities/ports/commands/force_stop")).toEqual([]);
    rescan.resolve({ status: "succeeded", result: snapshot([port()]) });
    await waitFor(() => expect(force.disabled).toBe(false));
  });

  it("a refusal from Core is shown and nothing claims success", async () => {
    mount([port()], {
      routes: {
        "GET /api/operations/op-stop": () => ({
          status: "failed",
          error: { message: "Phoenix will not stop that process" },
        }),
      },
    });
    const table = await scanNow();
    fireEvent.click(within(table).getByRole("button", { name: "Stop node on port 3000" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ask to stop" }));
    expect(await screen.findByText("Phoenix will not stop that process")).toBeTruthy();
    expect(screen.queryByText("node stopped.")).toBeNull();
  });

  it("offers no Restart button for a program without a recipe, and says when it is offered", async () => {
    mount([port()]);
    await screen.findByRole("button", { name: "Scan now" });
    expect(screen.getByText(/Restart is offered only for a program on a port/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /restart/i })).toBeNull();
  });
});

describe("restarting with an owner's recipe", () => {
  const ARGV = JSON.stringify(["/Users/ada/bin/serve", "--port", "3000"]);
  const offer = { recipe: "app", argv: ARGV, cwd: "/Users/ada/code/app" };
  const body = { pid: 4242, port: 3000, start: START, command: COMMAND, uid: 501, ...offer };
  const restarted = (over: Record<string, unknown> = {}) => ({
    pid: 4242,
    port: 3000,
    name: "node",
    recipe: "app",
    exited: true,
    started: true,
    new_pid: 9000,
    can_force: false,
    ...over,
  });
  const routes = (result: Record<string, unknown>) => ({
    "POST /api/capabilities/ports/commands/restart_process": () => ({ id: "op-restart" }),
    "GET /api/operations/op-restart": () => ({ status: "succeeded", result }),
  });

  it("Restart shows the recipe name, exact argument list and folder, and sends nothing until confirmed", async () => {
    const m = mount([port({ restart: offer })], { routes: routes(restarted()) });
    const table = await scanNow();
    fireEvent.click(within(table).getByRole("button", { name: "Restart node on port 3000" }));
    const group = await screen.findByRole("group");
    expect(within(group).getByText("app")).toBeTruthy();
    expect(within(group).getByText(ARGV)).toBeTruthy();
    expect(within(group).getByText("/Users/ada/code/app")).toBeTruthy();
    expect(m.api.posts("/api/capabilities/ports/commands/restart_process")).toEqual([]);
    fireEvent.click(within(group).getByRole("button", { name: "Cancel" }));
    expect(m.api.posts("/api/capabilities/ports/commands/restart_process")).toEqual([]);
  });

  it("confirming sends the proof and exactly the text shown, then reports that the recipe was started", async () => {
    const m = mount([port({ restart: offer })], { routes: routes(restarted()) });
    const table = await scanNow();
    fireEvent.click(within(table).getByRole("button", { name: "Restart node on port 3000" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ask to restart" }));
    await waitFor(() =>
      expect(
        m.api.posts("/api/capabilities/ports/commands/restart_process").map((c) => c.body),
      ).toEqual([{ input: body }]),
    );
    expect(await screen.findByText(/the recipe app was started \(process 9000\)/)).toBeTruthy();
    await waitFor(() => expect(m.scans()).toBe(2));
    expect(m.api.posts("/api/capabilities/ports/commands/stop_process")).toEqual([]);
    expect(m.api.posts("/api/capabilities/ports/commands/force_stop")).toEqual([]);
  });

  it("a program that did not exit is not claimed as restarted: it is shown still running with a separate Force stop", async () => {
    mount([port({ restart: offer })], {
      routes: routes(restarted({ exited: false, started: false, new_pid: null, can_force: true })),
    });
    const table = await scanNow();
    fireEvent.click(within(table).getByRole("button", { name: "Restart node on port 3000" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ask to restart" }));
    expect(await screen.findByText(/still running/)).toBeTruthy();
    expect(screen.queryByText(/was started/)).toBeNull();
  });

  it("a failed restart (for example the start failed after the stop) shows Core's words and reads the list again", async () => {
    const m = mount([port({ restart: offer })], {
      routes: {
        "POST /api/capabilities/ports/commands/restart_process": () => ({ id: "op-restart" }),
        "GET /api/operations/op-restart": () => ({
          status: "failed",
          error: { message: "The program was stopped, but the recipe could not be started." },
        }),
      },
    });
    const table = await scanNow();
    fireEvent.click(within(table).getByRole("button", { name: "Restart node on port 3000" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ask to restart" }));
    expect(await screen.findByText(/The program was stopped, but the recipe/)).toBeTruthy();
    expect(screen.queryByText(/was started/)).toBeNull();
    await waitFor(() => expect(m.scans()).toBe(2));
  });

  it("a process Phoenix would refuse to stop gets no Restart button even if a recipe is offered", async () => {
    mount([port({ restart: offer, stoppable: false, refusal: "system" })]);
    const table = await scanNow();
    expect(within(table).queryByRole("button", { name: /Restart/ })).toBeNull();
  });

  it("a malformed offer makes the whole list untrusted", () => {
    expect(readPortsSnapshot(snapshot([port({ restart: { recipe: 1 } })]))).toBeNull();
    expect(readPortsSnapshot(snapshot([port({ restart: offer })]))?.ports[0]?.restart).toEqual(
      offer,
    );
    expect(readRestartResult({ ...restarted(), started: "yes" })).toBeNull();
    expect(readRestartResult(restarted())?.new_pid).toBe(9000);
  });
});
