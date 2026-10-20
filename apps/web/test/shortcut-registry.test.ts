// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceleratorFromEvent,
  ChordError,
  chordFromEvent,
  chordId,
  detectPlatform,
  formatChord,
  parseChord,
  type Platform,
} from "../src/commands/keys";
import {
  buildBindings,
  COMMANDS,
  PALETTE_COMMAND_ID,
  type Command,
  type CommandContext,
} from "../src/commands/registry";
import { commandFor, otherModalOpen } from "../src/commands/useShortcuts";
import { TABS } from "../src/components/PetPanel";

afterEach(() => {
  document.body.innerHTML = "";
});

const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  navigate: vi.fn(),
  openPanelTab: vi.fn(),
  openLanguageSettings: vi.fn(),
  togglePalette: vi.fn(),
  demo: null,
  mute: null,
  ...over,
});

/** What the dispatcher decides for a key pressed while `target` has focus. */
function decide(
  target: Element,
  init: KeyboardEventInit,
  platform: Platform = "other",
  context: CommandContext = ctx(),
  commands: readonly Command[] = COMMANDS,
): Command | null {
  let result: Command | null = null;
  const bindings = buildBindings(commands, true);
  const listener = (e: Event) => {
    result = commandFor(e as KeyboardEvent, bindings, platform, context);
  };
  target.addEventListener("keydown", listener);
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  target.removeEventListener("keydown", listener);
  return result;
}

const PALETTE_KEYS = { key: "k", code: "KeyK", ctrlKey: true } as const;
const NAV_MEETINGS = {
  key: "1",
  code: "Digit1",
  ctrlKey: true,
  altKey: true,
  shiftKey: true,
} as const;

describe("one registry feeds the palette and the in-app shortcuts", () => {
  it("has a command for every route, every Pet Panel tab, language, demo and mute", () => {
    const ids = COMMANDS.map((c) => c.id);
    for (const id of [
      "nav.home",
      "nav.meetings",
      "nav.provenance",
      "nav.agents",
      "nav.workflows",
      "nav.recap",
      "nav.settings",
      "settings.language",
      "demo.start",
      "demo.stop",
      "mute.toggle",
      PALETTE_COMMAND_ID,
    ]) {
      expect(ids).toContain(id);
    }
    for (const tab of TABS) expect(ids).toContain(`panel.${tab.id}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every shipped chord is valid, unique, and needs the platform modifier", () => {
    // strict: a conflict or a forbidden chord in the real registry throws here.
    const bindings = buildBindings(COMMANDS, true);
    expect(bindings.byChord.size).toBeGreaterThan(5);
    for (const chord of bindings.byCommand.values()) {
      expect(chord.mod).toBe(true);
      expect(chord.key).toMatch(/^[a-z0-9]$/);
      // Alt (Option) alone with a letter types symbols; it only ever comes with Shift as well.
      if (chord.alt) expect(chord.shift).toBe(true);
    }
  });

  it("runs the command the navigation chord names", () => {
    const context = ctx();
    const input = document.body.appendChild(document.createElement("div"));
    const command = decide(input, NAV_MEETINGS, "other", context);
    expect(command?.id).toBe("nav.meetings");
    command?.run(context);
    expect(context.navigate).toHaveBeenCalledWith("/meetings");
  });
});

describe("chord rules", () => {
  it("refuses a bare letter, a missing Mod, and Alt without Shift", () => {
    expect(() => parseChord("K")).toThrow(ChordError);
    expect(() => parseChord("Shift+K")).toThrow(ChordError);
    expect(() => parseChord("Alt+K")).toThrow(ChordError);
    // Ctrl+Alt is AltGr on Windows and Linux: it would swallow typed characters.
    expect(() => parseChord("Mod+Alt+K")).toThrow(ChordError);
    expect(() => parseChord("Mod+Enter")).toThrow(ChordError);
    expect(() => parseChord("Mod+Mod+K")).toThrow(ChordError);
    expect(chordId(parseChord("mod+k"))).toBe("Mod+K");
    expect(chordId(parseChord("Mod+Alt+Shift+1"))).toBe("Mod+Alt+Shift+1");
  });

  it("detects a conflicting binding: it throws in development and tests, and the second loses in production", () => {
    const run = vi.fn();
    const first: Command = {
      id: "a",
      labelKey: "shell.nav.home",
      keywords: [],
      defaultKeys: "Mod+J",
      run,
    };
    const second: Command = {
      id: "b",
      labelKey: "shell.nav.settings",
      keywords: [],
      defaultKeys: "mod+j",
      run,
    };
    expect(() => buildBindings([first, second], true)).toThrow(/both use Mod\+J/);
    const lenient = buildBindings([first, second], false);
    expect(lenient.byChord.get("Mod+J")?.id).toBe("a");
    expect(lenient.byCommand.has("b")).toBe(false);
    // A forbidden chord is dropped in production, not bound.
    const bare: Command = {
      id: "c",
      labelKey: "shell.nav.home",
      keywords: [],
      defaultKeys: "K",
      run,
    };
    expect(() => buildBindings([bare], true)).toThrow(ChordError);
    expect(buildBindings([bare], false).byChord.size).toBe(0);
  });

  it("formats Cmd and Option on macOS and Ctrl and Alt elsewhere", () => {
    const chord = parseChord("Mod+Alt+Shift+1");
    expect(formatChord(chord, "mac")).toBe("Cmd+Option+Shift+1");
    expect(formatChord(chord, "other")).toBe("Ctrl+Alt+Shift+1");
  });

  it("detects the platform without throwing when navigator is missing or partial", () => {
    expect(detectPlatform({ platform: "MacIntel" })).toBe("mac");
    expect(detectPlatform({ userAgentData: { platform: "macOS" }, platform: "" })).toBe("mac");
    expect(detectPlatform({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe("other");
    expect(detectPlatform({ platform: "Win32" })).toBe("other");
    expect(detectPlatform({})).toBe("other");
  });
});

describe("the dispatcher", () => {
  it("uses Cmd on macOS and Ctrl elsewhere, never the other one", () => {
    const body = document.body;
    expect(decide(body, PALETTE_KEYS, "other")?.id).toBe(PALETTE_COMMAND_ID);
    expect(decide(body, { key: "k", code: "KeyK", metaKey: true }, "mac")?.id).toBe(
      PALETTE_COMMAND_ID,
    );
    // Ctrl+K on a Mac is the emacs "kill line" key in text fields: not ours.
    expect(decide(body, PALETTE_KEYS, "mac")).toBeNull();
    expect(decide(body, { key: "k", code: "KeyK", metaKey: true }, "other")).toBeNull();
    // Both together is some other chord.
    expect(
      decide(body, { key: "k", code: "KeyK", ctrlKey: true, metaKey: true }, "other"),
    ).toBeNull();
  });

  it("matches by physical key, so Option on a Mac cannot hide the digit", () => {
    const body = document.body;
    const optionDigit = { key: "¡", code: "Digit1", metaKey: true, altKey: true, shiftKey: true };
    expect(decide(body, optionDigit, "mac")?.id).toBe("nav.meetings");
  });

  it("ignores a plain letter, and a chord for an unbound key", () => {
    expect(decide(document.body, { key: "k", code: "KeyK" })).toBeNull();
    expect(decide(document.body, { key: "z", code: "KeyZ", ctrlKey: true })).toBeNull();
    expect(decide(document.body, { key: "Enter", code: "Enter", ctrlKey: true })).toBeNull();
  });

  describe("typing guard", () => {
    const fields: [string, () => HTMLElement][] = [
      ["input", () => document.createElement("input")],
      ["textarea", () => document.createElement("textarea")],
      ["select", () => document.createElement("select")],
      [
        "contenteditable",
        () => {
          const div = document.createElement("div");
          div.setAttribute("contenteditable", "true");
          return div;
        },
      ],
      [
        "an element inside contenteditable",
        () => {
          const outer = document.createElement("div");
          outer.setAttribute("contenteditable", "true");
          const inner = outer.appendChild(document.createElement("span"));
          document.body.appendChild(outer);
          return inner;
        },
      ],
    ];

    it.each(fields)("ignores navigation chords while typing in %s", (_name, make) => {
      const field = make();
      if (!field.isConnected) document.body.appendChild(field);
      expect(decide(field, NAV_MEETINGS)).toBeNull();
      // The same chord elsewhere on the page does run.
      expect(decide(document.body, NAV_MEETINGS)?.id).toBe("nav.meetings");
    });

    it.each(fields)("still opens the palette from %s", (_name, make) => {
      const field = make();
      if (!field.isConnected) document.body.appendChild(field);
      expect(decide(field, PALETTE_KEYS)?.id).toBe(PALETTE_COMMAND_ID);
    });
  });

  describe("IME composition", () => {
    it("ignores keys while an input method is composing, by isComposing and by keyCode 229", () => {
      expect(decide(document.body, { ...PALETTE_KEYS, isComposing: true })).toBeNull();
      expect(decide(document.body, { ...PALETTE_KEYS, keyCode: 229 })).toBeNull();
      expect(decide(document.body, { ...NAV_MEETINGS, isComposing: true })).toBeNull();
      expect(decide(document.body, { ...NAV_MEETINGS, keyCode: 229 })).toBeNull();
      expect(decide(document.body, PALETTE_KEYS)?.id).toBe(PALETTE_COMMAND_ID);
    });
  });

  it("stays out of the way of another modal dialog, but not of the palette's own", () => {
    const other = document.body.appendChild(document.createElement("div"));
    other.setAttribute("role", "dialog");
    other.setAttribute("aria-modal", "true");
    expect(otherModalOpen()).toBe(true);
    expect(decide(document.body, NAV_MEETINGS)).toBeNull();
    expect(decide(document.body, PALETTE_KEYS)).toBeNull();
    other.remove();

    const palette = document.body.appendChild(document.createElement("div"));
    palette.setAttribute("role", "dialog");
    palette.setAttribute("aria-modal", "true");
    palette.setAttribute("data-command-palette", "");
    expect(otherModalOpen()).toBe(false);
    expect(decide(document.body, PALETTE_KEYS)?.id).toBe(PALETTE_COMMAND_ID);

    // A non-modal dialog (the Pet Panel) does not block shortcuts.
    palette.remove();
    const panel = document.body.appendChild(document.createElement("section"));
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    expect(decide(document.body, NAV_MEETINGS)?.id).toBe("nav.meetings");
  });

  it("does not run a command that is not offered now (mute in a browser, stop-demo while off)", () => {
    const mute = decide(
      document.body,
      { key: "9", code: "Digit9", ctrlKey: true, altKey: true, shiftKey: true },
      "other",
      ctx({ mute: null }),
    );
    expect(mute).toBeNull();
    const toggle = vi.fn();
    const withDesktop = decide(
      document.body,
      { key: "9", code: "Digit9", ctrlKey: true, altKey: true, shiftKey: true },
      "other",
      ctx({ mute: { muted: false, toggle } }),
    );
    expect(withDesktop?.id).toBe("mute.toggle");
  });
});

describe("chordFromEvent and acceleratorFromEvent", () => {
  it("reads the chord from the key's position", () => {
    const e = new KeyboardEvent("keydown", { key: "Dead", code: "KeyQ", ctrlKey: true });
    expect(chordFromEvent(e, "other")).toEqual({ mod: true, alt: false, shift: false, key: "q" });
  });

  it("turns a key press into the desktop's accelerator text, and waits on a lone modifier", () => {
    const press = (init: KeyboardEventInit) =>
      acceleratorFromEvent(new KeyboardEvent("keydown", init));
    expect(press({ key: "c", code: "KeyC", ctrlKey: true, altKey: true, shiftKey: true })).toEqual({
      kind: "accelerator",
      text: "Ctrl+Alt+Shift+C",
    });
    expect(press({ key: "Meta", code: "MetaLeft", metaKey: true })).toEqual({ kind: "pending" });
    expect(press({ key: "F5", code: "F5", metaKey: true, shiftKey: true })).toEqual({
      kind: "accelerator",
      text: "Shift+Cmd+F5",
    });
    expect(press({ key: ",", code: "Comma", ctrlKey: true })).toEqual({ kind: "unsupported" });
    // Option+C on a Mac types "ç": the position, not the typed character, names the key.
    expect(press({ key: "ç", code: "KeyC", altKey: true, ctrlKey: true, metaKey: true })).toEqual({
      kind: "accelerator",
      text: "Ctrl+Alt+Cmd+C",
    });
  });
});
