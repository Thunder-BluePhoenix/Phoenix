// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
//
// The Phoenix browser's chrome (tabs, address bar, shields, port-radar prompt) against a fake
// shell. Nothing ran in a real window or webview: no page was loaded and no request was made.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserApp, nextZoom } from "../src/browser/BrowserApp";
import { classifyAddress, classifyPortRadarUrl } from "../src/browser/address";
import { createFakeBrowserShell, type FakeBrowserShell } from "../src/browser/fake-shell";
import {
  BROWSER_CHROME_HEIGHT,
  BROWSER_CHROME_PANEL_HEIGHT,
  parseOpenResult,
  parseTab,
  tauriBrowserShell,
  type TabInfo,
} from "../src/browser/shell";
import { INITIAL_STATE, MAX_TABS, activeTab, addressText, reduce } from "../src/browser/state";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(cleanup);

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await act(async () => Promise.resolve());
}

async function mount(shell: FakeBrowserShell | null, initialOpen: string | null = null) {
  const api = fakeApi({
    "GET /api/browser/shields": () => ({ shields: { enabled: true, offSites: [] } }),
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <BrowserApp shell={shell} initialOpen={initialOpen} />
    </CoreProvider>,
  );
  await flush();
  return api;
}

const address = () => screen.getByLabelText("Address or search") as HTMLInputElement;

async function type(text: string) {
  fireEvent.change(address(), { target: { value: text } });
  fireEvent.submit(address().closest("form")!);
  await flush();
}

const click = async (element: HTMLElement) => {
  fireEvent.click(element);
  await flush();
};

const tab = (over: Partial<TabInfo> = {}): TabInfo => ({
  tabId: "t1",
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  zoom: 1,
  blocked: 0,
  ...over,
});

describe("classifyAddress", () => {
  it("makes host-like text an https page and other text a DuckDuckGo search", () => {
    expect(classifyAddress("example.com/a")).toEqual({
      kind: "open",
      url: "https://example.com/a",
      search: false,
      upgraded: false,
    });
    const search = classifyAddress("cats & dogs");
    expect(search).toMatchObject({ kind: "open", search: true });
    expect(search.kind === "open" && search.url).toBe(
      "https://duckduckgo.com/?q=cats%20%26%20dogs",
    );
  });

  it("upgrades http and refuses everything the navigation policy refuses", () => {
    expect(classifyAddress("http://example.com/")).toMatchObject({
      kind: "open",
      url: "https://example.com/",
      upgraded: true,
    });
    const reasons = (text: string) => {
      const v = classifyAddress(text);
      return v.kind === "blocked" ? v.reason : v.kind;
    };
    expect(reasons("file:///etc/passwd")).toBe("file_blocked");
    expect(reasons("javascript:alert(1)")).toBe("dangerous_scheme");
    expect(reasons("ftp://example.com/")).toBe("scheme_not_allowed");
    expect(reasons("https://user:pw@example.com/")).toBe("credentials_in_url");
    expect(reasons("localhost:3000")).toBe("private_network");
    expect(reasons("192.168.1.1")).toBe("private_network");
    expect(reasons("example.com:6667")).toBe("bad_port");
    expect(classifyAddress("   ")).toEqual({ kind: "empty" });
  });
});

describe("classifyPortRadarUrl", () => {
  it("accepts only a plain loopback page and rebuilds the address from the port", () => {
    expect(classifyPortRadarUrl("http://127.0.0.1:5173/")).toEqual({
      ok: true,
      url: "http://127.0.0.1:5173/",
      port: 5173,
    });
    expect(classifyPortRadarUrl("http://localhost:3000/x?y=1#z")).toEqual({
      ok: true,
      url: "http://127.0.0.1:3000/",
      port: 3000,
    });
  });

  it("ignores anything else", () => {
    for (const bad of [
      "https://127.0.0.1:5173/",
      "http://192.168.1.5:3000/",
      "http://example.com:3000/",
      "http://127.0.0.1/",
      "http://127.0.0.1:0/",
      "http://127.0.0.1:70000/",
      "http://127.0.0.1:6667/",
      "http://user@127.0.0.1:3000/",
      "http://127.0.0.1.example.com:3000/",
      "javascript:1",
      "",
    ]) {
      expect(classifyPortRadarUrl(bad), bad).toEqual({ ok: false });
    }
  });
});

describe("chrome state machine", () => {
  it("adds tabs, activates on request and picks a neighbour when the active tab closes", () => {
    let s = reduce(INITIAL_STATE, { type: "tab", tab: tab({ tabId: "a" }) });
    expect(s.activeId).toBe("a");
    s = reduce(s, { type: "tab", tab: tab({ tabId: "b" }), activate: true });
    s = reduce(s, { type: "tab", tab: tab({ tabId: "c" }) });
    expect(s.tabs.map((t) => t.tabId)).toEqual(["a", "b", "c"]);
    expect(s.activeId).toBe("b");
    s = reduce(s, { type: "tabClosed", tabId: "b" });
    expect(s.activeId).toBe("c");
    s = reduce(s, { type: "tabClosed", tabId: "c" });
    expect(s.activeId).toBe("a");
    s = reduce(s, { type: "tabClosed", tabId: "a" });
    expect(s).toMatchObject({ tabs: [], activeId: null });
    expect(reduce(s, { type: "tabClosed", tabId: "zz" })).toBe(s);
  });

  it("updates a tab in place and keeps what is being typed when a background page changes", () => {
    let s = reduce(INITIAL_STATE, { type: "tab", tab: tab(), activate: true });
    s = reduce(s, { type: "edit", text: "exam" });
    s = reduce(s, { type: "tab", tab: tab({ title: "Changed", loading: true }) });
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]!.title).toBe("Changed");
    expect(addressText(s)).toBe("exam");
    s = reduce(s, { type: "tab", tab: tab({ url: "https://example.org/" }), activate: true });
    expect(addressText(s)).toBe("https://example.org/");
    expect(activeTab(s)?.url).toBe("https://example.org/");
  });

  it("shows a refusal until the person types again, and caps the tab count", () => {
    let s = reduce(INITIAL_STATE, {
      type: "refused",
      error: { reason: "file_blocked", text: "file:///x" },
    });
    expect(s.error?.reason).toBe("file_blocked");
    s = reduce(s, { type: "edit", text: "a" });
    expect(s.error).toBeNull();
    for (let i = 0; i < MAX_TABS + 5; i++)
      s = reduce(s, { type: "tab", tab: tab({ tabId: `t${i}` }) });
    expect(s.tabs).toHaveLength(MAX_TABS);
  });
});

describe("shell payloads", () => {
  it("accepts a well-formed tab and drops anything else", () => {
    expect(parseTab(tab())).toEqual(tab());
    expect(parseTab({ ...tab(), blocked: -1 })).toBeNull();
    expect(parseTab({ ...tab(), tabId: "" })).toBeNull();
    expect(parseTab({ ...tab(), loading: "yes" })).toBeNull();
    expect(parseTab(null)).toBeNull();
    expect(parseTab({ ...tab(), title: "x".repeat(1000) })!.title).toHaveLength(300);
  });

  it("reads open results and turns garbage into a refusal", () => {
    expect(parseOpenResult({ ok: true, tab: tab() })).toEqual({ ok: true, tab: tab() });
    expect(parseOpenResult({ ok: false, reason: "bad_port" })).toEqual({
      ok: false,
      reason: "bad_port",
    });
    expect(parseOpenResult({ ok: true })).toEqual({ ok: false, reason: "unparseable" });
    expect(parseOpenResult("nope")).toEqual({ ok: false, reason: "unparseable" });
  });

  it("calls the agreed Tauri commands with the agreed arguments", async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const invoke = async (command: string, args?: Record<string, unknown>) => {
      calls.push([command, args]);
      if (command === "open_tab" || command === "navigate") return { ok: true, tab: tab() };
      if (["back", "forward", "reload"].includes(command)) return tab();
      if (command === "zoom") return 1.25;
      return undefined;
    };
    const win = {
      __TAURI__: { core: { invoke }, event: { listen: async () => () => {} } },
    } as unknown as Window;
    const shell = tauriBrowserShell(win)!;
    await shell.openTab("https://example.com/", "typed");
    await shell.navigate("t1", "https://example.org/");
    await shell.back("t1");
    await shell.forward("t1");
    await shell.reload("t1");
    expect(await shell.zoom("t1", 1.25)).toBe(1.25);
    await shell.closeTab("t1");
    await shell.activateTab("t1");
    await shell.setSiteShields("example.com", false);
    await shell.setChromeHeight(220);
    expect(calls).toEqual([
      ["open_tab", { url: "https://example.com/", intent: "typed" }],
      ["navigate", { tabId: "t1", url: "https://example.org/", intent: "typed" }],
      ["back", { tabId: "t1" }],
      ["forward", { tabId: "t1" }],
      ["reload", { tabId: "t1" }],
      ["zoom", { tabId: "t1", factor: 1.25 }],
      ["close_tab", { tabId: "t1" }],
      ["activate_tab", { tabId: "t1" }],
      ["set_site_shields", { site: "example.com", blocking: false }],
      ["set_chrome_height", { height: 220 }],
    ]);
    expect(tauriBrowserShell({} as Window)).toBeNull();
  });
});

describe("BrowserApp", () => {
  it("opens a typed address in a new tab, then navigates that tab, and shows the title as text", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    expect(screen.getByText("No tab is open. Type an address or a search above.")).toBeTruthy();
    await type("example.com");
    expect(shell.calls[0]).toEqual(["open_tab", "https://example.com/", "typed"]);
    const tabs = screen.getByRole("tablist");
    expect(within(tabs).getByRole("tab", { name: "Page at example.com" })).toBeTruthy();
    expect(address().value).toBe("https://example.com/");
    await type("example.org/docs");
    expect(shell.calls[1]).toEqual(["navigate", "tab-1", "https://example.org/docs"]);
    expect(shell.tabs).toHaveLength(1);
  });

  it("opens a second tab from the plus button and switches tabs", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    await type("example.com");
    await click(screen.getByRole("button", { name: "New tab" }));
    expect(address().value).toBe("");
    await type("example.org");
    expect(shell.tabs.map((t) => t.tabId)).toEqual(["tab-1", "tab-2"]);
    const tabButtons = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabButtons[1]!.getAttribute("aria-selected")).toBe("true");
    await click(tabButtons[0]!);
    expect(shell.calls.at(-1)).toEqual(["activate_tab", "tab-1"]);
    expect(address().value).toBe("https://example.com/");
    await click(screen.getByRole("button", { name: "Close tab Page at example.com" }));
    expect(shell.calls.at(-1)).toEqual(["close_tab", "tab-1"]);
    expect(within(screen.getByRole("tablist")).getAllByRole("tab")).toHaveLength(1);
    expect(address().value).toBe("https://example.org/");
  });

  it("never sends a refused address to the shell and shows it as text", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    await type("javascript:alert(1)");
    expect(shell.calls).toEqual([]);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "Addresses that run code or hold the page itself cannot be opened.",
    );
    expect(alert.textContent).toContain("Not opened: javascript:alert(1)");
    // Text, never markup or a link.
    expect(alert.querySelector("a")).toBeNull();
    await type("javascript:<img src=x onerror=alert(1)>");
    expect(screen.getByRole("alert").querySelector("img")).toBeNull();
  });

  it("shows the shell's own refusal (a name that resolves to a private address) as text", async () => {
    const shell = createFakeBrowserShell();
    shell.openTab = async () => ({ ok: false, reason: "dns_private" });
    await mount(shell);
    await type("sneaky.example.com");
    expect(screen.getByRole("alert").textContent).toContain(
      "That name points to an address on this computer or your local network.",
    );
  });

  it("reports an internal shell error instead of failing silently", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    shell.failNext("open_tab");
    await type("example.com");
    expect(screen.getByRole("alert").textContent).toContain("The browser could not do that.");
  });

  it("goes back, forward and reload through the shell, and disables what cannot be done", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    await type("example.com");
    await type("example.org");
    const back = screen.getByRole("button", { name: "Back" }) as HTMLButtonElement;
    expect(back.disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Forward" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await click(back);
    expect(shell.calls.at(-1)).toEqual(["back", "tab-1"]);
    await click(screen.getByRole("button", { name: "Forward" }));
    expect(shell.calls.at(-1)).toEqual(["forward", "tab-1"]);
    await click(screen.getByRole("button", { name: "Reload" }));
    expect(shell.calls.at(-1)).toEqual(["reload", "tab-1"]);
  });

  it("zooms in steps, clamped, and resets", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    await type("example.com");
    await click(screen.getByRole("button", { name: "Zoom in" }));
    expect(shell.calls.at(-1)).toEqual(["zoom", "tab-1", 1.1]);
    expect(screen.getByRole("button", { name: /Reset zoom/ }).textContent).toBe("110%");
    await click(screen.getByRole("button", { name: "Zoom out" }));
    await click(screen.getByRole("button", { name: "Zoom out" }));
    expect(shell.calls.at(-1)).toEqual(["zoom", "tab-1", 0.9]);
    await click(screen.getByRole("button", { name: /Reset zoom/ }));
    expect(shell.calls.at(-1)).toEqual(["zoom", "tab-1", 1]);
    expect(nextZoom(3, 1)).toBe(3);
    expect(nextZoom(0.5, -1)).toBe(0.5);
    expect(nextZoom(1, 1)).toBe(1.1);
  });

  it("toggles Shields for the page's site, tells the shell, saves it in Core and shows the blocked count", async () => {
    const shell = createFakeBrowserShell();
    const api: FakeApi = await mount(shell);
    await type("www.news.example.co.uk");
    shell.emitTab({ tabId: "tab-1", blocked: 3 });
    await flush();
    expect(screen.getByRole("status", { name: "" }).textContent).toBe("3 requests blocked");
    const toggle = screen.getByLabelText(
      "Block ads and trackers on example.co.uk",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await click(toggle);
    expect(shell.siteShields).toEqual([{ site: "example.co.uk", blocking: false }]);
    expect(api.calls.filter((c) => c.method === "PUT").map((c) => [c.path, c.body])).toEqual([
      ["/api/browser/shields/sites/example.co.uk", { blocking: false }],
    ]);
    expect(toggle.checked).toBe(false);
    await click(toggle);
    expect(shell.siteShields.at(-1)).toEqual({ site: "example.co.uk", blocking: true });
    expect(toggle.checked).toBe(true);
  });

  it("puts a tab's live updates (title, blocked count, closing) into the strip", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    await type("example.com");
    shell.emitTab({ tabId: "tab-1", title: "Renamed <b>page</b>" });
    await flush();
    const entry = within(screen.getByRole("tablist")).getByRole("tab", {
      name: "Renamed <b>page</b>",
    });
    expect(entry.querySelector("b")).toBeNull();
    shell.emitClosed("tab-1");
    await flush();
    expect(within(screen.getByRole("tablist")).queryAllByRole("tab")).toHaveLength(0);
  });

  it("asks before opening a loopback page from the port radar, and opens nothing until yes", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    await act(async () => shell.emitOpenRequest("http://127.0.0.1:5173/"));
    await flush();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Open a program from this computer?")).toBeTruthy();
    expect(within(dialog).getByText("Address: http://127.0.0.1:5173/")).toBeTruthy();
    expect(shell.tabs).toHaveLength(0);
    expect(shell.calls.filter((c) => c[0] === "open_tab")).toEqual([]);
    expect(shell.chromeHeights).toEqual([BROWSER_CHROME_PANEL_HEIGHT]);
    await click(within(dialog).getByRole("button", { name: "Open it" }));
    expect(shell.calls.find((c) => c[0] === "open_tab")).toEqual([
      "open_tab",
      "http://127.0.0.1:5173/",
      "port_radar",
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shell.chromeHeights.at(-1)).toBe(BROWSER_CHROME_HEIGHT);
    expect(shell.tabs).toHaveLength(1);
  });

  it("opens nothing when the confirmation is cancelled", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    await act(async () => shell.emitOpenRequest("http://localhost:3000/"));
    await flush();
    await click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shell.calls.filter((c) => c[0] === "open_tab")).toEqual([]);
    expect(shell.chromeHeights.at(-1)).toBe(BROWSER_CHROME_HEIGHT);
  });

  it("rebuilds the address it opens and ignores a port-radar request for any other host", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    await act(async () => shell.emitOpenRequest("http://169.254.169.254/latest/meta-data"));
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "was not a plain page on this computer",
    );
    await act(async () => shell.emitOpenRequest("http://localhost:3000/secret?x=1"));
    await flush();
    expect(screen.getByText("Address: http://127.0.0.1:3000/")).toBeTruthy();
  });

  it("confirms a loopback address given when the window opens", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell, "http://127.0.0.1:8080/");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(shell.tabs).toHaveLength(0);
  });

  it("cannot open a loopback address by typing it, even after the panel was shown", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    await type("http://127.0.0.1:4870/");
    expect(shell.calls).toEqual([]);
    expect(screen.getByRole("alert").textContent).toContain("cannot be typed here");
  });

  it("does nothing without a desktop shell and says why", async () => {
    await mount(null);
    expect(address().disabled).toBe(true);
    expect(screen.getByText(/only works inside the Phoenix desktop app/)).toBeTruthy();
  });
});
