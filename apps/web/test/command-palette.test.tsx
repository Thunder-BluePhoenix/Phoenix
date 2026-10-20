// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { COMMANDS, type Command } from "../src/commands/registry";
import { filterCommands } from "../src/components/CommandPalette";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { I18nProvider, type ActiveLocale } from "../src/i18n";
import { en } from "../src/i18n/en";
import { resetActive } from "../src/i18n/store";
import { LOCALE_CODES } from "../src/i18n/supported";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
  window.location.hash = "";
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
  Object.defineProperty(navigator, "platform", { value: "Linux x86_64", configurable: true });
});

function setPlatform(platform: string) {
  Object.defineProperty(navigator, "platform", { value: platform, configurable: true });
}

function mount(hash = "#/", locale?: ActiveLocale) {
  window.location.hash = hash;
  const api = fakeApi({
    "GET /api/ui/settings": () => ({ locale: "en", supported: LOCALE_CODES }),
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  const view = render(
    <CoreProvider client={client}>
      <I18nProvider {...(locale ? { forceLocale: locale } : {})}>
        <App />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return view;
}

/** Ctrl+K (or Cmd+K) on the element that has focus, like a real key press. */
function pressPaletteKey(init: KeyboardEventInit = { ctrlKey: true }) {
  const target = document.activeElement ?? document.body;
  fireEvent.keyDown(target, { key: "k", code: "KeyK", ...init });
}

const dialog = () => screen.queryByRole("dialog", { name: "Command palette" });
const paletteEl = () => document.querySelector<HTMLElement>("[data-command-palette]")!;
const box = () => within(paletteEl()).getByRole("combobox");
const options = () => within(screen.getByRole("listbox")).getAllByRole("option");
const activeOption = () => {
  const id = box().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
};
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

describe("command palette", () => {
  it("opens with Ctrl+K as a labelled modal combobox with the input focused", () => {
    mount();
    expect(dialog()).toBeNull();
    pressPaletteKey();
    const d = dialog()!;
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(box());
    expect(box().getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
    expect(box().getAttribute("aria-expanded")).toBe("true");
    // The palette's own opener is not a list entry; every other command is.
    expect(options().length).toBe(COMMANDS.filter((c) => c.inPalette !== false && !c.when).length);
    expect(box().getAttribute("aria-label")).toBe("Search commands");
  });

  it("filters by the label and by keywords, ignoring case", () => {
    mount();
    pressPaletteKey();
    type("MEETINGS");
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining("Go to Meetings"),
    ]);
    type("outfit"); // a keyword of the wardrobe command, not in any label
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining("Open the Wardrobe"),
    ]);
    type("zzzzqqq");
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getAllByText("No command matches “zzzzqqq”.").length).toBeGreaterThan(0);
    expect(box().hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("moves with the arrow keys, Home and End, wraps, and runs the highlighted command on Enter", () => {
    mount();
    pressPaletteKey();
    type("go to");
    const labels = options().map((o) => o.textContent ?? "");
    expect(labels.length).toBeGreaterThan(3);
    expect(activeOption()).toBe(options()[0]);
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(activeOption()).toBe(options()[1]);
    fireEvent.keyDown(box(), { key: "End" });
    expect(activeOption()).toBe(options()[labels.length - 1]);
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(activeOption()).toBe(options()[0]);
    fireEvent.keyDown(box(), { key: "ArrowUp" });
    expect(activeOption()).toBe(options()[labels.length - 1]);
    fireEvent.keyDown(box(), { key: "Home" });
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");

    type("go to recap");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(window.location.hash).toBe("#/recap");
    expect(dialog()).toBeNull();
  });

  it("runs a command when its row is clicked", () => {
    mount();
    pressPaletteKey();
    type("provenance");
    fireEvent.click(options()[0]!);
    expect(window.location.hash).toBe("#/provenance");
    expect(dialog()).toBeNull();
  });

  it("opens a Pet Panel tab and Settings > Language from the palette", async () => {
    mount();
    pressPaletteKey();
    type("wardrobe");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(window.location.hash).toBe("#/panel/wardrobe");
    expect(await screen.findByRole("tab", { name: "Wardrobe", selected: true })).toBeTruthy();

    pressPaletteKey();
    type("language");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(window.location.hash).toBe("#/settings");
    const picker = await screen.findByRole("combobox", { name: "Interface language" });
    await waitFor(() => expect(document.activeElement).toBe(picker));
  });

  it("closes on Escape and gives focus back to what had it", () => {
    mount();
    const fawkes = screen.getByRole("button", { name: /^Fawkes/ });
    fawkes.focus();
    pressPaletteKey();
    expect(document.activeElement).toBe(box());
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(fawkes);
  });

  it("one Escape closes only the palette, not the Pet Panel behind it", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Fawkes/ }));
    await screen.findByRole("tab", { name: "Overview" });
    pressPaletteKey();
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy();
  });

  it("closes on a click outside, and when the route changes", () => {
    mount();
    pressPaletteKey();
    fireEvent.mouseDown(document.querySelector(".palette-backdrop")!);
    expect(dialog()).toBeNull();

    pressPaletteKey();
    expect(dialog()).not.toBeNull();
    act(() => {
      window.location.hash = "#/meetings";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(dialog()).toBeNull();
  });

  it("toggles with the same chord, even while typing in the search box", () => {
    mount();
    pressPaletteKey();
    expect(dialog()).not.toBeNull();
    pressPaletteKey();
    expect(dialog()).toBeNull();
  });

  it("traps Tab inside the dialog", () => {
    mount();
    pressPaletteKey();
    const input = box();
    // The palette's focusable controls are only the input: Tab and Shift+Tab stay on it.
    fireEvent.keyDown(input, { key: "Tab" });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(input);
    // Focus that escaped (a click on the backdrop-less page) comes back on the next Tab.
    (screen.getByRole("link", { name: "Skip to content" }) as HTMLElement).focus();
    fireEvent.keyDown(dialog()!, { key: "Tab" });
    expect(document.activeElement).toBe(input);
  });

  describe("IME composition", () => {
    it("does not run the highlighted command when Enter confirms an input-method candidate", () => {
      mount();
      pressPaletteKey();
      type("go to recap");
      fireEvent.keyDown(box(), { key: "Enter", isComposing: true });
      fireEvent.keyDown(box(), { key: "Enter", keyCode: 229 });
      expect(dialog()).not.toBeNull();
      expect(window.location.hash).toBe("#/");
      fireEvent.keyDown(box(), { key: "ArrowDown", isComposing: true });
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(window.location.hash).toBe("#/recap");
    });

    it("does not open from a chord pressed during composition", () => {
      mount();
      pressPaletteKey({ ctrlKey: true, isComposing: true });
      pressPaletteKey({ ctrlKey: true, keyCode: 229 });
      expect(dialog()).toBeNull();
    });
  });

  describe("typing guard in the app", () => {
    it("does not navigate on a navigation chord typed into a text field, but does elsewhere", async () => {
      mount("#/settings");
      const field = (await screen.findAllByRole("textbox"))[0]!;
      field.focus();
      fireEvent.keyDown(field, {
        key: "1",
        code: "Digit1",
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
      });
      expect(window.location.hash).toBe("#/settings");
      fireEvent.keyDown(document.body, {
        key: "1",
        code: "Digit1",
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
      });
      expect(window.location.hash).toBe("#/meetings");
    });
  });

  describe("shortcut hints follow the platform", () => {
    it("shows Ctrl and Alt on Linux and Windows", () => {
      setPlatform("Win32");
      mount();
      pressPaletteKey();
      type("meetings");
      expect(within(options()[0]!).getByText("Ctrl+Alt+Shift+1")).toBeTruthy();
    });

    it("shows Cmd and Option on macOS, and opens with Cmd+K", () => {
      setPlatform("MacIntel");
      mount();
      pressPaletteKey({ ctrlKey: true });
      expect(dialog()).toBeNull();
      pressPaletteKey({ metaKey: true });
      type("meetings");
      expect(within(options()[0]!).getByText("Cmd+Option+Shift+1")).toBeTruthy();
    });

    it("offers commands without a chord with no hint", () => {
      mount();
      pressPaletteKey();
      type("language");
      expect(options()[0]!.querySelector("kbd")).toBeNull();
    });
  });

  it("does not offer the demo or mute commands where they cannot work", () => {
    mount();
    pressPaletteKey();
    const labels = options().map((o) => o.textContent ?? "");
    expect(labels.some((l) => /demo/i.test(l))).toBe(false);
    expect(labels.some((l) => /mute/i.test(l))).toBe(false);
  });
});

describe("filtering across scripts", () => {
  const entry = (id: string, label: string, keywords: string[] = []) => ({
    command: { id, labelKey: "shell.nav.home", keywords, run: () => {} } satisfies Command,
    label,
  });

  it("ignores accents, case and Unicode form", () => {
    const entries = [entry("a", "Réglages"), entry("b", "Réunions")];
    expect(filterCommands(entries, "reglages", "fr").map((e) => e.command.id)).toEqual(["a"]);
    expect(filterCommands(entries, "RÉU", "fr").map((e) => e.command.id)).toEqual(["b"]);
    // "é" as e + combining accent finds the same entry.
    expect(filterCommands(entries, "re\u0301glages", "fr").map((e) => e.command.id)).toEqual(["a"]);
  });

  it("finds Arabic with or without vowel marks", () => {
    const entries = [entry("a", "الإعدادات"), entry("b", "الاجتماعاتُ")];
    expect(filterCommands(entries, "الاعدادات", "ar").map((e) => e.command.id)).toEqual(["a"]);
    expect(filterCommands(entries, "الاجتماعات", "ar").map((e) => e.command.id)).toEqual(["b"]);
    expect(filterCommands(entries, "الاجتماعاتُ", "ar").map((e) => e.command.id)).toEqual(["b"]);
  });

  it("matches inside Chinese text without word breaks", () => {
    const entries = [entry("a", "前往会议"), entry("b", "前往设置")];
    expect(filterCommands(entries, "设置", "zh").map((e) => e.command.id)).toEqual(["b"]);
    expect(filterCommands(entries, "前往", "zh")).toHaveLength(2);
  });

  it("needs every word, ranks a label that starts with the query first, and keeps order otherwise", () => {
    const entries = [
      entry("kw", "Open", ["recap"]),
      entry("contains", "Go to Recap"),
      entry("starts", "Recap now"),
    ];
    expect(filterCommands(entries, "recap", "en").map((e) => e.command.id)).toEqual([
      "starts",
      "contains",
      "kw",
    ]);
    expect(filterCommands(entries, "go recap", "en").map((e) => e.command.id)).toEqual([
      "contains",
    ]);
    expect(filterCommands(entries, "   ", "en")).toHaveLength(3);
  });
});

describe("right-to-left", () => {
  it("renders the palette in Arabic with dir=rtl and no raw message keys", async () => {
    mount("#/", "ar");
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Skip to content" })).toBeNull());
    pressPaletteKey();
    const d = paletteEl();
    expect(d.textContent).not.toMatch(/shell\.(palette|cmd)\./);
    const name = d.getAttribute("aria-labelledby")!;
    expect(document.getElementById(name)!.textContent).not.toBe(en["shell.palette.title"]);
    expect(options().length).toBeGreaterThan(5);
    for (const o of options()) expect(o.textContent).not.toMatch(/shell\./);
    // Every option's label is translated: none is the English text.
    const englishLabels = new Set(COMMANDS.map((c) => en[c.labelKey]));
    for (const o of options()) {
      const label = o.querySelector(".palette-label")!.textContent!;
      expect(englishLabels.has(label as never)).toBe(false);
    }
    // Typing an Arabic word finds its command.
    type("الاعدادات");
    expect(options().length).toBeGreaterThan(0);
  });
});
