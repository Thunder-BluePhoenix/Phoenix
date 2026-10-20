// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseReport,
  SHORTCUT_ACTIONS,
  ShortcutRefused,
  tauriShortcuts,
  type ShortcutAction,
  type ShortcutReport,
  type ShortcutsShell,
  type ShortcutState,
} from "../src/commands/shortcuts-shell";
import { ShortcutSettings } from "../src/components/ShortcutSettings";
import { I18nProvider } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

afterEach(() => {
  cleanup();
  resetActive();
  document.documentElement.dir = "ltr";
});

const DEFAULTS: Record<ShortcutAction, string> = {
  open_chat: "Ctrl+Alt+Shift+C",
  jump_to_alert: "Ctrl+Alt+Shift+A",
  jump_to_terminal: "Ctrl+Alt+Shift+T",
  switch_pills: "Ctrl+Alt+Shift+P",
  mute: "Ctrl+Alt+Shift+M",
  send_to_desktop: "Ctrl+Alt+Shift+D",
  wardrobe: "Ctrl+Alt+Shift+W",
};

function reportOf(
  over: Partial<Record<ShortcutAction, { accelerator?: string | null; state: ShortcutState }>> = {},
  flags: { enabled?: boolean; muted?: boolean } = {},
): ShortcutReport {
  const enabled = flags.enabled ?? false;
  return {
    enabled,
    muted: flags.muted ?? false,
    shortcuts: SHORTCUT_ACTIONS.map((action) => ({
      action,
      defaultAccelerator: DEFAULTS[action],
      accelerator:
        over[action]?.accelerator !== undefined ? over[action].accelerator : DEFAULTS[action],
      state: over[action]?.state ?? (enabled ? "active" : "off"),
    })),
  };
}

interface FakeShell extends ShortcutsShell {
  calls: [string, ...unknown[]][];
  report: ShortcutReport;
  /** The next `set` is refused with this code. */
  refuse: string | null;
  emitStatus(report: ShortcutReport): void;
}

function fakeShell(initial: ShortcutReport = reportOf()): FakeShell {
  const statusListeners = new Set<(r: ShortcutReport) => void>();
  const shell: FakeShell = {
    calls: [],
    report: initial,
    refuse: null,
    list: async () => {
      shell.calls.push(["list"]);
      return shell.report;
    },
    set: async (action, accelerator) => {
      shell.calls.push(["set", action, accelerator]);
      if (shell.refuse) {
        const code = shell.refuse;
        shell.refuse = null;
        throw new ShortcutRefused(code, "English text from the desktop that must not be shown");
      }
      shell.report = {
        ...shell.report,
        shortcuts: shell.report.shortcuts.map((s) =>
          s.action === action
            ? { ...s, accelerator, state: shell.report.enabled ? "active" : "off" }
            : s,
        ),
      };
      return shell.report;
    },
    reset: async (action) => {
      shell.calls.push(["reset", action]);
      shell.report = {
        ...shell.report,
        shortcuts: shell.report.shortcuts.map((s) =>
          !action || s.action === action ? { ...s, accelerator: s.defaultAccelerator } : s,
        ),
      };
      return shell.report;
    },
    setEnabled: async (enabled) => {
      shell.calls.push(["setEnabled", enabled]);
      shell.report = {
        ...shell.report,
        enabled,
        shortcuts: shell.report.shortcuts.map((s) => ({ ...s, state: enabled ? "active" : "off" })),
      };
      return shell.report;
    },
    setMuted: async (muted) => {
      shell.calls.push(["setMuted", muted]);
      shell.report = { ...shell.report, muted };
      return shell.report;
    },
    onMute: async () => () => {},
    onStatus: async (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    emitStatus: (r) => statusListeners.forEach((l) => l(r)),
  };
  return shell;
}

function mount(shell: ShortcutsShell | null, forceLocale?: "ar") {
  FakeWebSocket.reset();
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: fakeApi().fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <I18nProvider {...(forceLocale ? { forceLocale } : {})}>
        <ShortcutSettings shell={shell} />
      </I18nProvider>
    </CoreProvider>,
  );
}

const row = (name: string) => screen.getByText(name, { selector: "strong" }).closest("li")!;
const startEdit = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name: `Change the shortcut for ${name}` }));
const capture = (name: string) => screen.getByLabelText(`New key combination for ${name}`);
const press = (el: Element, init: KeyboardEventInit) => fireEvent.keyDown(el, init);
const CHORD_C = { key: "c", code: "KeyC", ctrlKey: true, altKey: true, shiftKey: true } as const;

describe("ShortcutSettings without a desktop", () => {
  it("shows only a note that global shortcuts are a desktop feature", () => {
    mount(null);
    expect(screen.getByRole("heading", { name: "Global shortcuts" })).toBeTruthy();
    expect(screen.getByText(/feature of the Phoenix desktop app/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("is absent from the real Tauri global check in a plain browser", () => {
    expect(tauriShortcuts({} as Window)).toBeNull();
    expect(
      tauriShortcuts({ __TAURI__: { core: { invoke: vi.fn() } } } as unknown as Window),
    ).toBeNull();
  });
});

describe("ShortcutSettings with the desktop", () => {
  it("lists the seven actions with their binding and state, off by default with a warning", async () => {
    mount(fakeShell());
    const list = await screen.findByRole("list", { name: "Shortcut actions" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    const chat = row("Open chat");
    expect(within(chat).getByText("Ctrl+Alt+Shift+C")).toBeTruthy();
    expect(within(chat).getByText("Not active: global shortcuts are turned off")).toBeTruthy();
    const enable = screen.getByRole("checkbox", {
      name: "Turn on global shortcuts",
    }) as HTMLInputElement;
    expect(enable.checked).toBe(false);
    // The plain-language warning is tied to the switch for assistive technology.
    const warning = document.getElementById(enable.getAttribute("aria-describedby")!)!;
    expect(warning.textContent).toMatch(/takes its key combination away from every other app/);
  });

  it("explains each state in words, including why an action is not active", async () => {
    mount(
      fakeShell(
        reportOf(
          {
            open_chat: { state: "active" },
            jump_to_alert: { state: "unbound", accelerator: null },
            jump_to_terminal: { state: "rejected", accelerator: null },
            switch_pills: { state: "unavailable" },
          },
          { enabled: true },
        ),
      ),
    );
    await screen.findByRole("list", { name: "Shortcut actions" });
    expect(within(row("Open chat")).getByText("Active")).toBeTruthy();
    expect(
      within(row("Jump to the alert")).getByText("Not active: no key combination is set"),
    ).toBeTruthy();
    expect(within(row("Jump to the alert")).getByText("Not set")).toBeTruthy();
    expect(
      within(row("Jump to the terminal")).getByText(/this key combination is not allowed/),
    ).toBeTruthy();
    expect(
      within(row("Switch pills")).getByText(/another app may already use this key combination/),
    ).toBeTruthy();
  });

  it("turns shortcuts on and off through the shell", async () => {
    const shell = fakeShell();
    mount(shell);
    const enable = (await screen.findByRole("checkbox", {
      name: "Turn on global shortcuts",
    })) as HTMLInputElement;
    fireEvent.click(enable);
    await waitFor(() => expect(enable.checked).toBe(true));
    expect(shell.calls).toContainEqual(["setEnabled", true]);
    expect(within(row("Open chat")).getByText("Active")).toBeTruthy();
    fireEvent.click(enable);
    await waitFor(() => expect(enable.checked).toBe(false));
    expect(shell.calls).toContainEqual(["setEnabled", false]);
  });

  it("toggles mute through the shell", async () => {
    const shell = fakeShell();
    mount(shell);
    const mute = (await screen.findByRole("checkbox", {
      name: "Mute sounds and notifications",
    })) as HTMLInputElement;
    fireEvent.click(mute);
    await waitFor(() => expect(mute.checked).toBe(true));
    expect(shell.calls).toContainEqual(["setMuted", true]);
  });

  it("captures the chord from a key press, shows the canonical text and moves focus back", async () => {
    const shell = fakeShell(reportOf({}, { enabled: true }));
    mount(shell);
    await screen.findByRole("list", { name: "Shortcut actions" });
    startEdit("Open chat");
    const field = capture("Open chat");
    expect(document.activeElement).toBe(field);
    // A modifier on its own waits for the main key.
    press(field, { key: "Control", code: "ControlLeft", ctrlKey: true });
    expect(shell.calls.find((c) => c[0] === "set")).toBeUndefined();
    press(field, { key: "j", code: "KeyJ", ctrlKey: true, altKey: true, shiftKey: true });
    await screen.findByText("The shortcut for Open chat is now Ctrl+Alt+Shift+J.");
    expect(shell.calls).toContainEqual(["set", "open_chat", "Ctrl+Alt+Shift+J"]);
    expect(within(row("Open chat")).getByText("Ctrl+Alt+Shift+J")).toBeTruthy();
    expect(screen.queryByLabelText("New key combination for Open chat")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Change the shortcut for Open chat" }),
      ),
    );
  });

  it("Escape cancels an edit without asking the shell", async () => {
    const shell = fakeShell();
    mount(shell);
    await screen.findByRole("list", { name: "Shortcut actions" });
    startEdit("Mute sounds and notifications");
    press(capture("Mute sounds and notifications"), { key: "Escape", code: "Escape" });
    expect(screen.queryByLabelText(/New key combination/)).toBeNull();
    expect(shell.calls.some((c) => c[0] === "set")).toBe(false);
  });

  it("ignores key presses during IME composition while capturing", async () => {
    const shell = fakeShell();
    mount(shell);
    await screen.findByRole("list", { name: "Shortcut actions" });
    startEdit("Open chat");
    press(capture("Open chat"), { ...CHORD_C, isComposing: true });
    press(capture("Open chat"), { ...CHORD_C, keyCode: 229 });
    expect(shell.calls.some((c) => c[0] === "set")).toBe(false);
  });

  it("says a key the shell has no name for cannot be used, without calling it", async () => {
    const shell = fakeShell();
    mount(shell);
    await screen.findByRole("list", { name: "Shortcut actions" });
    startEdit("Open chat");
    press(capture("Open chat"), { key: ",", code: "Comma", ctrlKey: true });
    expect((await screen.findByRole("alert")).textContent).toMatch(/That key cannot be used/);
    expect(shell.calls.some((c) => c[0] === "set")).toBe(false);
  });

  it.each([
    ["needs_modifiers", /at least two modifier keys/],
    ["needs_third_modifier", /Add a third modifier/],
    ["reserved", /The system already uses that key combination/],
    ["dictation_chord", /used by dictation/],
    ["conflict", /Another Phoenix shortcut already uses that key combination/],
    ["unavailable", /would not register that key combination/],
    ["invalid", /not a valid shortcut/],
    ["forbidden", /cannot change shortcuts/],
  ])(
    "shows the translated reason for the refusal code %s, not the desktop's English text",
    async (code, text) => {
      const shell = fakeShell();
      shell.refuse = code;
      mount(shell);
      await screen.findByRole("list", { name: "Shortcut actions" });
      startEdit("Open chat");
      press(capture("Open chat"), CHORD_C);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(text);
      expect(alert.textContent).not.toMatch(/English text from the desktop/);
      // A refusal changes nothing: the old binding stays and the field stays open for another try.
      expect(within(row("Open chat")).queryByText("Ctrl+Alt+Shift+J")).toBeNull();
      expect(capture("Open chat")).toBeTruthy();
    },
  );

  it("falls back to a general sentence for a refusal code this build does not know", async () => {
    const shell = fakeShell();
    shell.refuse = "from_the_future";
    mount(shell);
    await screen.findByRole("list", { name: "Shortcut actions" });
    startEdit("Open chat");
    press(capture("Open chat"), CHORD_C);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The shortcut could not be changed.",
    );
  });

  it("resets one action and all of them", async () => {
    const shell = fakeShell(
      reportOf({ open_chat: { accelerator: "Ctrl+Alt+Shift+J", state: "off" } }),
    );
    mount(shell);
    await screen.findByRole("list", { name: "Shortcut actions" });
    expect(within(row("Open chat")).getByText("Ctrl+Alt+Shift+J")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Reset the shortcut for Open chat to its default" }),
    );
    await screen.findByText("The shortcut for Open chat was reset.");
    expect(shell.calls).toContainEqual(["reset", "open_chat"]);
    expect(
      within(row("Open chat")).getByText("Ctrl+Alt+Shift+C", { selector: "kbd" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset all shortcuts" }));
    await screen.findByText("All shortcuts were reset.");
    expect(shell.calls).toContainEqual(["reset", undefined]);
  });

  it("follows the shell when it re-registers the bindings by itself", async () => {
    const shell = fakeShell(reportOf({}, { enabled: true }));
    mount(shell);
    await screen.findByRole("list", { name: "Shortcut actions" });
    expect(within(row("Switch pills")).getByText("Active")).toBeTruthy();
    act(() =>
      shell.emitStatus(reportOf({ switch_pills: { state: "unavailable" } }, { enabled: true })),
    );
    expect(within(row("Switch pills")).getByText(/another app may already use/)).toBeTruthy();
  });

  it("says so when the shell cannot be read", async () => {
    const shell = fakeShell();
    shell.list = async () => {
      throw new ShortcutRefused("forbidden", "no");
    };
    mount(shell);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The shortcuts could not be read from the desktop app.",
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("is translated: Arabic shows no raw keys and no English labels", async () => {
    mount(fakeShell(), "ar");
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    await screen.findByRole("list");
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/shell\.shortcuts\./);
    expect(text).not.toContain("Open chat");
    expect(text).not.toContain("Turn on global shortcuts");
  });
});

describe("tauriShortcuts maps the shell's commands, events and refusals", () => {
  const wire = {
    enabled: true,
    muted: false,
    shortcuts: [
      {
        action: "open_chat",
        label: "Open chat",
        default_accelerator: "Ctrl+Alt+Shift+C",
        accelerator: "Ctrl+Alt+Shift+C",
        state: "active",
        detail: null,
      },
      { action: "bogus", state: "active" },
      { action: "mute", state: "weird" },
    ],
  };

  function tauri(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    const listen = vi.fn(async (event: string, handler: (e: { payload: unknown }) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    });
    const shell = tauriShortcuts({
      __TAURI__: { core: { invoke }, event: { listen } },
    } as unknown as Window)!;
    return { shell, handlers };
  }

  it("calls the right commands with the right argument names and parses the report", async () => {
    const invoke = vi.fn(async () => wire);
    const { shell } = tauri(invoke);
    const report = await shell.list();
    expect(report).toEqual({
      enabled: true,
      muted: false,
      shortcuts: [
        {
          action: "open_chat",
          accelerator: "Ctrl+Alt+Shift+C",
          defaultAccelerator: "Ctrl+Alt+Shift+C",
          state: "active",
        },
      ],
    });
    await shell.set("mute", "Ctrl+Alt+Shift+9");
    await shell.reset("mute");
    await shell.reset();
    await shell.setEnabled(true);
    await shell.setMuted(true);
    expect(invoke.mock.calls).toEqual([
      ["shortcuts_list", undefined],
      ["shortcuts_set", { action: "mute", accelerator: "Ctrl+Alt+Shift+9" }],
      ["shortcuts_reset", { action: "mute" }],
      ["shortcuts_reset", {}],
      ["shortcuts_set_enabled", { enabled: true }],
      ["shortcuts_set_muted", { muted: true }],
    ]);
  });

  it("turns the shell's { code, message } rejection into a ShortcutRefused", async () => {
    const { shell } = tauri(async () => {
      throw { code: "conflict", message: "taken" };
    });
    await expect(shell.set("mute", "x")).rejects.toMatchObject({
      code: "conflict",
      message: "taken",
    });
    const { shell: odd } = tauri(async () => {
      throw new Error("ipc down");
    });
    await expect(odd.list()).rejects.toMatchObject({ code: "unknown" });
    const { shell: garbage } = tauri(async () => "not a report");
    await expect(garbage.list()).rejects.toMatchObject({ code: "unknown" });
  });

  it("delivers mute and status events, and drops malformed payloads", async () => {
    const { shell, handlers } = tauri(async () => wire);
    const muted: boolean[] = [];
    const statuses: ShortcutReport[] = [];
    await shell.onMute((m) => muted.push(m));
    await shell.onStatus((r) => statuses.push(r));
    handlers.get("shortcuts://mute")!({ payload: { muted: true } });
    handlers.get("shortcuts://mute")!({ payload: { muted: "yes" } });
    handlers.get("shortcuts://mute")!({ payload: null });
    handlers.get("shortcuts://status")!({ payload: wire });
    handlers.get("shortcuts://status")!({ payload: { enabled: 1 } });
    expect(muted).toEqual([true]);
    expect(statuses).toHaveLength(1);
    expect(parseReport(undefined)).toBeNull();
  });
});
