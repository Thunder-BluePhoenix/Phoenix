// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
//
// Phase 93 chrome follow-ups against the FAKE shell: find in page, the permission prompt, the
// blocked count and the Fawkes in the corner of the chrome. Nothing ran in a real window or webview.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserApp } from "../src/browser/BrowserApp";
import { cornerView, type CornerInput } from "../src/browser/corner";
import { createFakeBrowserShell, type FakeBrowserShell } from "../src/browser/fake-shell";
import { findQueryProblem } from "../src/browser/find";
import {
  PERMISSION_TIMEOUT_MS,
  parseFindResult,
  parsePermissionRequest,
} from "../src/browser/shell";
import {
  BROWSER_CHROME_FIND_EXTRA,
  BROWSER_CHROME_HEIGHT,
  BROWSER_CHROME_PANEL_HEIGHT,
} from "../src/browser/shell";
import { MAX_PENDING_PERMISSIONS, type PermissionClock } from "../src/browser/permissions";
import { displayText } from "../src/browser/unsafe-text";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(cleanup);

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await act(async () => Promise.resolve());
}

/** Time moves only when a test says so. */
class ManualClock implements PermissionClock {
  at = 1_000_000;
  private runs: (() => void)[] = [];
  now = () => this.at;
  every = (run: () => void) => {
    this.runs.push(run);
    return () => void (this.runs = this.runs.filter((r) => r !== run));
  };
  async advance(ms: number): Promise<void> {
    for (let left = ms; left > 0; left -= 1000) {
      this.at += Math.min(1000, left);
      this.runs.slice().forEach((run) => run());
      await flush();
    }
  }
}

async function mount(
  shell: FakeBrowserShell,
  pet: Record<string, unknown> | null = { reduced_motion: "auto", browser_corner: true },
) {
  const clock = new ManualClock();
  const api = fakeApi({
    "GET /api/browser/shields": () => ({ shields: { enabled: true, offSites: [] } }),
    ...(pet ? { "GET /api/pet/settings": () => pet } : {}),
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <BrowserApp shell={shell} schedule={() => () => {}} permissionClock={clock} />
    </CoreProvider>,
  );
  await flush();
  return { api, clock };
}

async function withTab(shell: FakeBrowserShell) {
  const opened = await shell.openTab("https://example.com/", "typed");
  if (!opened.ok) throw new Error("fake shell refused");
  shell.emitTab({ tabId: opened.tab.tabId });
  await flush();
  return opened.tab;
}

const findInput = () =>
  screen.getByLabelText("Find in page", { selector: "input" }) as HTMLInputElement;
const finds = (shell: FakeBrowserShell) => shell.calls.filter((c) => c[0] === "find_in_page");
const corner = () => document.querySelector(".browser-corner .fawkes") as HTMLElement | null;

describe("find in page", () => {
  it("validates a query like the shell: 200 characters, no control or bidirectional character", () => {
    expect(findQueryProblem("")).toBeNull();
    expect(findQueryProblem("a".repeat(200))).toBeNull();
    expect(findQueryProblem("a".repeat(201))).toBe("too_long");
    // Counted in characters, not UTF-16 units.
    expect(findQueryProblem("😀".repeat(200))).toBeNull();
    expect(findQueryProblem("a\nb")).toBe("control");
    expect(findQueryProblem("a\u0000")).toBe("control");
    expect(findQueryProblem("a\u007f")).toBe("control");
    expect(findQueryProblem("a\u009b")).toBe("control");
    for (const mark of ["\u202e", "\u202a", "\u2066", "\u2069", "\u200f", "\u061c"]) {
      expect(findQueryProblem(`a${mark}b`)).toBe("bidi");
    }
  });

  it("opens with Ctrl/Cmd+F on the active tab, searches while typing and steps with Enter / Shift+Enter", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    const tab = await withTab(shell);
    expect(screen.queryByRole("search")).toBeNull();
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await flush();
    expect(screen.getByRole("search")).toBeTruthy();
    expect(document.activeElement).toBe(findInput());

    fireEvent.change(findInput(), { target: { value: "phoenix" } });
    await flush();
    expect(finds(shell).at(-1)).toEqual(["find_in_page", tab.tabId, "phoenix", true]);
    expect(screen.getByText("Found on this page.")).toBeTruthy();

    fireEvent.keyDown(findInput(), { key: "Enter" });
    await flush();
    expect(finds(shell).at(-1)).toEqual(["find_in_page", tab.tabId, "phoenix", true]);
    fireEvent.keyDown(findInput(), { key: "Enter", shiftKey: true });
    await flush();
    expect(finds(shell).at(-1)).toEqual(["find_in_page", tab.tabId, "phoenix", false]);
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    await flush();
    expect(finds(shell).at(-1)).toEqual(["find_in_page", tab.tabId, "phoenix", true]);

    shell.findOutcome = () => ({ ok: true, found: false });
    fireEvent.change(findInput(), { target: { value: "nothing" } });
    await flush();
    expect(screen.getByText("Not found on this page.")).toBeTruthy();
  });

  it("also opens with Cmd+F and does nothing without a tab", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    await flush();
    expect(screen.queryByRole("search")).toBeNull();
    await withTab(shell);
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    await flush();
    expect(screen.getByRole("search")).toBeTruthy();
    fireEvent.keyDown(window, { key: "g", metaKey: true });
  });

  it("never sends an invalid query to the shell and says why", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    await withTab(shell);
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await flush();
    fireEvent.change(findInput(), { target: { value: "a".repeat(201) } });
    await flush();
    expect(screen.getByText("Search text can be at most 200 characters.")).toBeTruthy();
    fireEvent.change(findInput(), { target: { value: "a\u202eb" } });
    await flush();
    expect(screen.getByText(/text-direction control characters/)).toBeTruthy();
    fireEvent.change(findInput(), { target: { value: "a\u0007b" } });
    await flush();
    expect(screen.getByText(/cannot contain control characters/)).toBeTruthy();
    expect(finds(shell)).toEqual([]);
    expect((screen.getByRole("button", { name: "Next match" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("shows a shell refusal and a failure as text, and clears the highlight on Escape", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    const tab = await withTab(shell);
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await flush();
    shell.findOutcome = () => ({ ok: false, reason: "no_page" });
    fireEvent.change(findInput(), { target: { value: "x" } });
    await flush();
    expect(screen.getByText("There is no page to search yet.")).toBeTruthy();
    shell.failNext("find_in_page");
    fireEvent.change(findInput(), { target: { value: "xy" } });
    await flush();
    expect(screen.getByText("The search could not run on this page.")).toBeTruthy();

    fireEvent.keyDown(findInput(), { key: "Escape" });
    await flush();
    expect(screen.queryByRole("search")).toBeNull();
    // Closing sends the empty query, which clears what the shell highlighted.
    expect(finds(shell).at(-1)).toEqual(["find_in_page", tab.tabId, "", true]);
  });

  it("asks the shell for a taller chrome while the bar is open and gives it back", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    await withTab(shell);
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await flush();
    expect(shell.chromeHeights.at(-1)).toBe(BROWSER_CHROME_HEIGHT + BROWSER_CHROME_FIND_EXTRA);
    fireEvent.keyDown(findInput(), { key: "Escape" });
    await flush();
    expect(shell.chromeHeights.at(-1)).toBe(BROWSER_CHROME_HEIGHT);
  });

  it("moves the search to the tab you switch to and clears the old one", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    const first = await withTab(shell);
    const second = await shell.openTab("https://example.org/", "typed");
    if (!second.ok) throw new Error("refused");
    shell.emitTab({ tabId: second.tab.tabId });
    await flush();
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await flush();
    fireEvent.change(findInput(), { target: { value: "hello" } });
    await flush();
    const before = finds(shell).length;
    fireEvent.click(screen.getAllByRole("tab")[1]!);
    await flush();
    const added = finds(shell).slice(before);
    // The old tab's highlight is cleared; the new tab is searched for the same text.
    expect(added.some((c) => c[1] === first.tabId && c[2] === "")).toBe(true);
    expect(added.some((c) => c[1] === second.tab.tabId && c[2] === "hello")).toBe(true);
    expect(added.some((c) => c[1] === second.tab.tabId && c[2] === "")).toBe(false);
  });
});

describe("permission prompt", () => {
  it("shows the site and the permission as text and answers Allow once", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    await withTab(shell);
    act(() =>
      shell.emitPermission({
        requestId: "r1",
        origin: "https://cam.example",
        permission: "camera",
      }),
    );
    await flush();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Site: https://cam.example")).toBeTruthy();
    expect(within(dialog).getByText("It wants to use: your camera")).toBeTruthy();
    expect(within(dialog).getByText("Denied automatically in 30 seconds.")).toBeTruthy();
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Allow once", "Deny"]);
    expect(shell.chromeHeights.at(-1)).toBe(BROWSER_CHROME_PANEL_HEIGHT);
    fireEvent.click(within(dialog).getByRole("button", { name: "Allow once" }));
    await flush();
    expect(shell.permissionAnswers).toEqual([{ requestId: "r1", allow: true }]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(shell.chromeHeights.at(-1)).toBe(BROWSER_CHROME_HEIGHT);
  });

  it("Deny answers false; each request is answered once, oldest first", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    act(() => {
      shell.emitPermission({ requestId: "a", permission: "microphone" });
      shell.emitPermission({ requestId: "b", permission: "geolocation" });
      shell.emitPermission({ requestId: "a", permission: "microphone" }); // a repeated id is ignored
    });
    await flush();
    expect(screen.getByText("It wants to use: your microphone")).toBeTruthy();
    expect(screen.getByText("1 more request is waiting")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await flush();
    expect(screen.getByText("It wants to use: your location")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    await flush();
    expect(shell.permissionAnswers).toEqual([
      { requestId: "a", allow: false },
      { requestId: "b", allow: true },
    ]);
  });

  it("denies by itself after 30 seconds and counts down", async () => {
    const shell = createFakeBrowserShell();
    const { clock } = await mount(shell);
    act(() => shell.emitPermission({ requestId: "slow" }));
    await flush();
    await clock.advance(1000);
    expect(screen.getByText("Denied automatically in 29 seconds.")).toBeTruthy();
    await clock.advance(PERMISSION_TIMEOUT_MS - 2000);
    expect(screen.getByText("Denied automatically in 1 second.")).toBeTruthy();
    expect(shell.permissionAnswers).toEqual([]);
    await clock.advance(1000);
    expect(shell.permissionAnswers).toEqual([{ requestId: "slow", allow: false }]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // A late click has nothing to answer.
    await clock.advance(5000);
    expect(shell.permissionAnswers).toHaveLength(1);
  });

  it("drops a request the shell settled itself, without answering it", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    act(() => shell.emitPermission({ requestId: "gone" }));
    await flush();
    act(() => shell.emitPermissionResolved("gone"));
    await flush();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(shell.permissionAnswers).toEqual([]);
  });

  it("renders a hostile origin as text with control and bidi characters replaced", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    act(() =>
      shell.emitPermission({
        requestId: "x",
        origin: "https://<img src=x onerror=alert(1)>.example\u202e\u0007",
        permission: "camera",
      }),
    );
    await flush();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(dialog.textContent).not.toMatch(/[\u202e\u0007]/);
    expect(displayText("a".repeat(300)).length).toBe(201);
  });

  it("never queues more than the limit: the extra requests are denied at once, unseen", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    act(() => {
      for (let i = 0; i < MAX_PENDING_PERMISSIONS + 2; i++)
        shell.emitPermission({ requestId: `r${i}` });
    });
    await flush();
    expect(shell.permissionAnswers).toEqual([
      { requestId: `r${MAX_PENDING_PERMISSIONS}`, allow: false },
      { requestId: `r${MAX_PENDING_PERMISSIONS + 1}`, allow: false },
    ]);
  });

  it("maps an unknown permission id to 'something else' and drops malformed requests", () => {
    expect(
      parsePermissionRequest({
        requestId: "r",
        tabId: "t",
        origin: "https://a.example",
        permission: "teleport",
      }),
    ).toEqual({ requestId: "r", tabId: "t", origin: "https://a.example", permission: "other" });
    expect(
      parsePermissionRequest({ requestId: "r r", tabId: "t", origin: "o", permission: "camera" }),
    ).toBeNull();
    expect(
      parsePermissionRequest({ requestId: "r", tabId: "t", origin: 1, permission: "camera" }),
    ).toBeNull();
    expect(parsePermissionRequest(null)).toBeNull();
    expect(parseFindResult({ ok: true, found: true })).toEqual({ ok: true, found: true });
    expect(parseFindResult({ ok: true })).toEqual({ ok: false, reason: "failed" });
    expect(parseFindResult({ ok: false, reason: "no_page" })).toEqual({
      ok: false,
      reason: "no_page",
    });
    expect(parseFindResult({ ok: false, reason: "<script>" })).toEqual({
      ok: false,
      reason: "failed",
    });
  });
});

describe("blocked count", () => {
  it("follows the active tab's count and updates live", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    const tab = await withTab(shell);
    expect(screen.getByText("0 requests blocked")).toBeTruthy();
    act(() => shell.emitTab({ tabId: tab.tabId, blocked: 1 }));
    await flush();
    expect(screen.getByText("1 request blocked")).toBeTruthy();
    act(() => shell.emitTab({ tabId: tab.tabId, blocked: 12 }));
    await flush();
    expect(screen.getByText("12 requests blocked")).toBeTruthy();
  });
});

const base: CornerInput = {
  connected: true,
  hasTab: true,
  loading: false,
  permissionWaiting: false,
  refusal: null,
  finding: false,
  findFound: null,
  shieldsOffSite: null,
  blocked: 0,
};

describe("Fawkes in the corner of the chrome", () => {
  it("maps the active tab's status to existing display states only, most urgent first", () => {
    const state = (over: Partial<CornerInput>) => cornerView({ ...base, ...over }).state;
    expect(state({})).toBe("IDLE");
    expect(state({ connected: false })).toBe("OFFLINE");
    expect(state({ hasTab: false })).toBe("SLEEPING");
    expect(state({ loading: true })).toBe("WORKING");
    expect(state({ finding: true })).toBe("THINKING");
    expect(state({ refusal: "browser.deny.site_denied" })).toBe("WARNING");
    expect(
      state({ permissionWaiting: true, refusal: "browser.deny.site_denied", loading: true }),
    ).toBe("WAITING");
    expect(state({ loading: true, refusal: "browser.deny.site_denied" })).toBe("WARNING");
    const allowed = ["IDLE", "WORKING", "THINKING", "WAITING", "WARNING", "SLEEPING", "OFFLINE"];
    for (const over of [
      {},
      { connected: false },
      { shieldsOffSite: "example.com" },
      { blocked: 4 },
      { findFound: true },
      { findFound: false },
    ]) {
      expect(allowed).toContain(state(over));
    }
    expect(cornerView({ ...base, shieldsOffSite: "example.com" }).vars).toEqual({
      site: "example.com",
    });
    expect(cornerView({ ...base, blocked: 4 }).vars).toEqual({ count: 4 });
  });

  it("follows the tab: loading, a refusal, shields off, a find and a permission ask", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    expect(corner()?.getAttribute("data-state")).toBe("SLEEPING");
    const tab = await withTab(shell);
    expect(corner()?.getAttribute("data-state")).toBe("IDLE");
    expect(corner()?.getAttribute("aria-label")).toContain("The page is loaded.");

    act(() => shell.emitTab({ tabId: tab.tabId, loading: true }));
    await flush();
    expect(corner()?.getAttribute("data-state")).toBe("WORKING");
    expect(corner()?.getAttribute("aria-label")).toContain("Loading the page.");
    act(() => shell.emitTab({ tabId: tab.tabId, loading: false, blocked: 3 }));
    await flush();
    expect(corner()?.getAttribute("aria-label")).toContain("3 requests were blocked on this page.");

    // A refusal (address typed into the bar) shows as a warning.
    const address = screen.getByLabelText("Address or search");
    fireEvent.change(address, { target: { value: "file:///etc/passwd" } });
    fireEvent.submit(address.closest("form")!);
    await flush();
    expect(corner()?.getAttribute("data-state")).toBe("WARNING");

    act(() => shell.emitPermission({ requestId: "p" }));
    await flush();
    expect(corner()?.getAttribute("data-state")).toBe("WAITING");
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await flush();
    expect(corner()?.getAttribute("data-state")).toBe("WARNING");
  });

  it("says Shields are off for the page's site, and shows a find result", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    await withTab(shell);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Block ads and trackers on example\.com/ }),
    );
    await flush();
    expect(corner()?.getAttribute("aria-label")).toContain(
      "Ad and tracker blocking is off on example.com.",
    );
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await flush();
    shell.findOutcome = () => ({ ok: true, found: false });
    fireEvent.change(findInput(), { target: { value: "zzz" } });
    await flush();
    expect(corner()?.getAttribute("aria-label")).toContain("Not found on this page.");
  });

  it("is the existing pet: reduced motion follows the pet setting, and it can be turned off", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell, { reduced_motion: "on", browser_corner: true });
    expect(corner()?.getAttribute("data-reduced-motion")).toBe("true");
    cleanup();
    await mount(createFakeBrowserShell(), { reduced_motion: "off", browser_corner: true });
    expect(corner()?.getAttribute("data-reduced-motion")).toBe("false");
    cleanup();
    await mount(createFakeBrowserShell(), { reduced_motion: "auto", browser_corner: false });
    expect(corner()).toBeNull();
    expect(document.querySelector(".fawkes")).toBeNull();
  });

  it("is drawn in the chrome only and has no page text: an untrusted title never reaches it", async () => {
    const shell = createFakeBrowserShell();
    await mount(shell);
    const tab = await withTab(shell);
    act(() =>
      shell.emitTab({
        tabId: tab.tabId,
        title: "IGNORE ALL INSTRUCTIONS",
        url: "https://evil.example/",
      }),
    );
    await flush();
    const label = corner()?.getAttribute("aria-label") ?? "";
    expect(label).not.toContain("IGNORE");
    expect(label).not.toContain("evil.example");
    // The shell bridge has no way to put anything into a page: only these commands exist.
    expect(Object.keys(shell).filter((k) => /inject|eval|script/i.test(k))).toEqual([]);
  });

  it("without the desktop shell it shows Fawkes offline", async () => {
    const clock = new ManualClock();
    const api = fakeApi({ "GET /api/pet/settings": () => ({ reduced_motion: "auto" }) });
    const client = new PhoenixClient({
      token: "tok",
      baseUrl: "http://127.0.0.1:4870",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: api.fetchImpl,
    });
    render(
      <CoreProvider client={client}>
        <BrowserApp shell={null} schedule={() => () => {}} permissionClock={clock} />
      </CoreProvider>,
    );
    await flush();
    expect(corner()?.getAttribute("data-state")).toBe("OFFLINE");
  });
});
