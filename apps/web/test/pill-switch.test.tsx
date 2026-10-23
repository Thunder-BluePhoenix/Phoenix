// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseChord, type Chord } from "../src/commands/keys";
import { buildBindings, COMMANDS, type CommandContext } from "../src/commands/registry";
import {
  SWITCH_PILLS_EVENT,
  tauriShortcuts,
  type ShortcutReport,
  type ShortcutsShell,
} from "../src/commands/shortcuts-shell";
import { MAX_PILLS, visiblePills } from "../src/components/SourcePills";
import { nextPill, orderPills, type Pill, type PillDirection } from "../src/core/appearance";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import {
  PILLS_FALLBACK_ROUTE,
  pillSwitcherFor,
  routeForPill,
  switchPillsCommand,
} from "../src/core/pill-switch";
import { assistantFor } from "../src/core/voice-assistant";
import { FloatingApp } from "../src/floating/FloatingApp";
import type { DesktopShell } from "../src/floating/shell";
import { IslandApp } from "../src/island/IslandApp";
import type { IslandShell } from "../src/island/shell";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => {
  FakeWebSocket.reset();
  window.location.hash = "";
});
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const pill = (id: string): Pill => ({ id, label: id, colour: "#1c7ed6", glyph: "diamond" });
const ids = (pills: readonly { id: string }[]) => pills.map((p) => p.id);

describe("nextPill (pure)", () => {
  const sources = [pill("capability:git"), pill("agent:codex"), pill("agent:claude")];

  it("cycles through the sources in a stable order, whatever order they arrive in", () => {
    expect(ids(orderPills(sources))).toEqual(["agent:claude", "agent:codex", "capability:git"]);
    expect(ids(orderPills([...sources].reverse()))).toEqual(ids(orderPills(sources)));
    const walked: string[] = [];
    let current: string | null = null;
    for (let i = 0; i < 3; i++) {
      current = nextPill(current, sources, "next")!.id;
      walked.push(current);
    }
    expect(walked).toEqual(["agent:claude", "agent:codex", "capability:git"]);
  });

  it("wraps round at both ends", () => {
    expect(nextPill("capability:git", sources, "next")?.id).toBe("agent:claude");
    expect(nextPill("agent:claude", sources, "previous")?.id).toBe("capability:git");
  });

  it("moves backwards one step at a time", () => {
    expect(nextPill("capability:git", sources, "previous")?.id).toBe("agent:codex");
    expect(nextPill("agent:codex", sources, "previous")?.id).toBe("agent:claude");
    expect(nextPill("agent:codex", sources, "next")?.id).toBe("capability:git");
  });

  it("answers null for no pills at all", () => {
    for (const direction of ["next", "previous"] as const) {
      expect(nextPill(null, [], direction)).toBeNull();
      expect(nextPill("agent:codex", [], direction)).toBeNull();
    }
  });

  it("starts at the first (next) or last (previous) pill when current is unknown or null", () => {
    expect(nextPill(null, sources, "next")?.id).toBe("agent:claude");
    expect(nextPill(null, sources, "previous")?.id).toBe("capability:git");
    // The selected source went quiet or was hidden since.
    expect(nextPill("agent:gone", sources, "next")?.id).toBe("agent:claude");
    expect(nextPill("agent:gone", sources, "previous")?.id).toBe("capability:git");
    expect(nextPill("", sources, "next")?.id).toBe("agent:claude");
  });

  it("with a single pill stays on it, and ignores empty and repeated ids", () => {
    expect(nextPill("agent:codex", [pill("agent:codex")], "next")?.id).toBe("agent:codex");
    expect(nextPill("agent:codex", [pill("agent:codex")], "previous")?.id).toBe("agent:codex");
    expect(nextPill(null, [pill(""), pill("agent:codex"), pill("agent:codex")], "next")?.id).toBe(
      "agent:codex",
    );
    expect(orderPills([pill(""), pill("b"), pill("b"), pill("a")]).map((p) => p.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("never mutates the list it is given", () => {
    const input = [...sources];
    nextPill("agent:codex", input, "next");
    expect(ids(input)).toEqual(ids(sources));
  });

  it("keeps the selected pill in the drawn window when there are more pills than fit", () => {
    const many = Array.from({ length: MAX_PILLS + 3 }, (_, i) => pill(`agent:a${i}`));
    expect(ids(visiblePills(many, null))).toEqual(ids(many.slice(0, MAX_PILLS)));
    const last = many[many.length - 1]!.id;
    expect(visiblePills(many, last).map((p) => p.id)).toContain(last);
    expect(visiblePills(many, last)).toHaveLength(MAX_PILLS);
  });
});

describe("routes", () => {
  it("an agent pill opens the sessions, a capability the capabilities tab, the rest the feed", () => {
    expect(routeForPill("agent:codex")).toBe("/agents");
    expect(routeForPill("capability:git")).toBe("/panel/capabilities");
    expect(routeForPill("other:thing")).toBe(PILLS_FALLBACK_ROUTE);
  });
});

/** A desktop shell whose "switch pills" shortcut the test can press. */
function fakeShortcuts() {
  const listeners = new Set<(direction: PillDirection) => void>();
  const report: ShortcutReport = { enabled: true, muted: false, shortcuts: [] };
  const shell: ShortcutsShell = {
    list: async () => report,
    set: async () => report,
    reset: async () => report,
    setEnabled: async () => report,
    setMuted: async () => report,
    onMute: async () => () => {},
    onSwitchPills: async (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onStatus: async () => () => {},
  };
  return {
    shell,
    listeners,
    press: (direction: PillDirection = "next") =>
      act(() => listeners.forEach((listener) => listener(direction))),
  };
}

interface FakeDesktop extends DesktopShell {
  opened: string[];
}
function fakeDesktop(): FakeDesktop {
  const opened: string[] = [];
  return {
    opened,
    connection: async () => ({ base_url: "http://127.0.0.1:4870", token: "tok" }),
    moveBy: () => {},
    dragEnded: () => {},
    openInPhoenix: (route) => opened.push(route),
    showMenu: () => {},
  };
}

const session = (id: string, agent: string, active = true) => ({
  id,
  agent,
  project: "/p",
  repository: "p",
  first_seen: "",
  last_seen: "",
  active,
  step_count: 1,
  dropped_steps: 0,
  has_terminal: false,
});

function makeClient(agents: string[]) {
  const api = fakeApi({
    "GET /api/pet/settings": () => ({ reduced_motion: "off" }),
    "GET /api/agent/sessions": () => ({
      sessions: agents.map((agent, i) => session(`s${i}`, agent)),
    }),
  });
  return new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    minReconnectMs: 3_600_000,
    maxReconnectMs: 3_600_000,
    fetchImpl: api.fetchImpl,
  });
}

const selected = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".source-pill[data-selected='true']")).map(
    (el) => el.dataset.source,
  );

async function floating(agents: string[]) {
  const client = makeClient(agents);
  const desktop = fakeDesktop();
  const shortcuts = fakeShortcuts();
  render(
    <CoreProvider client={client}>
      <FloatingApp shell={desktop} shortcuts={shortcuts.shell} />
    </CoreProvider>,
  );
  const ws = FakeWebSocket.last;
  act(() => ws.open());
  if (agents.length > 0) {
    await waitFor(() =>
      expect(document.querySelectorAll(".source-pill").length).toBe(agents.length),
    );
  }
  await act(async () => {});
  return { client, desktop, shortcuts, ws };
}

describe("the switch_pills shortcut drives the pill command", () => {
  it("moves the selection through the pills and opens the page that shows each one", async () => {
    const { desktop, shortcuts } = await floating(["codex", "claude"]);
    await waitFor(() => expect(shortcuts.listeners.size).toBe(1));
    expect(selected()).toEqual([]);

    shortcuts.press();
    expect(selected()).toEqual(["agent:claude"]);
    shortcuts.press();
    expect(selected()).toEqual(["agent:codex"]);
    shortcuts.press(); // wraps
    expect(selected()).toEqual(["agent:claude"]);
    expect(desktop.opened).toEqual(["/agents", "/agents", "/agents"]);

    shortcuts.press("previous"); // back past the start wraps to the last
    expect(selected()).toEqual(["agent:codex"]);
    shortcuts.press("previous");
    expect(selected()).toEqual(["agent:claude"]);
    const current = document.querySelector(".source-pill[data-source='agent:claude']")!;
    expect(current.getAttribute("aria-current")).toBe("true");
  });

  it("with no active source it opens the activity feed (the old route cycle is gone)", async () => {
    const { desktop, shortcuts } = await floating([]);
    await waitFor(() => expect(shortcuts.listeners.size).toBe(1));
    shortcuts.press();
    shortcuts.press();
    expect(desktop.opened).toEqual([PILLS_FALLBACK_ROUTE, PILLS_FALLBACK_ROUTE]);
    expect(selected()).toEqual([]);
  });

  it("stops listening when the window goes away", async () => {
    const { shortcuts } = await floating(["codex"]);
    await waitFor(() => expect(shortcuts.listeners.size).toBe(1));
    cleanup();
    expect(shortcuts.listeners.size).toBe(0);
  });

  it("the island page listens too", async () => {
    const client = makeClient(["codex"]);
    const shortcuts = fakeShortcuts();
    const opened: string[] = [];
    const shell: IslandShell = {
      connection: async () => ({ base_url: "http://127.0.0.1:4870", token: "tok" }),
      frame: async () => null,
      onFrame: async () => () => {},
      send: () => {},
      openInPhoenix: (route) => opened.push(route),
      showMenu: () => {},
    };
    render(
      <CoreProvider client={client}>
        <IslandApp shell={shell} shortcuts={shortcuts.shell} />
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    await waitFor(() => expect(shortcuts.listeners.size).toBe(1));
    await act(async () => {});
    shortcuts.press();
    expect(opened).toEqual(["/agents"]);
    expect(pillSwitcherFor(client).selected()).toBe("agent:codex");
  });
});

describe("the voice request and the palette run the very same command", () => {
  it("shortcut, voice and palette share one selection and one order", async () => {
    const { client, desktop, shortcuts } = await floating(["codex", "claude", "gemini"]);
    await waitFor(() => expect(shortcuts.listeners.size).toBe(1));

    // The shortcut selects the first pill, the voice assistant the second, the palette command
    // the third, and a spoken "previous" steps back: one list, one cursor.
    shortcuts.press();
    expect(selected()).toEqual(["agent:claude"]);

    assistantFor(client).onAction({ type: "switch_pill", direction: "next" });
    await waitFor(() => expect(selected()).toEqual(["agent:codex"]));
    expect(window.location.hash).toBe("#/agents");

    const context = { switchPills: (d: PillDirection) => switchPillsCommand(client, d) };
    COMMANDS.find((c) => c.id === "pills.next")!.run(context as unknown as CommandContext);
    await waitFor(() => expect(selected()).toEqual(["agent:gemini"]));

    assistantFor(client).onAction({ type: "switch_pill", direction: "previous" });
    await waitFor(() => expect(selected()).toEqual(["agent:codex"]));
    COMMANDS.find((c) => c.id === "pills.previous")!.run(context as unknown as CommandContext);
    await waitFor(() => expect(selected()).toEqual(["agent:claude"]));
    expect(desktop.opened).toEqual(["/agents"]);
  });

  it("a voice action without a direction (an older Core) means next; any other value too", async () => {
    const { client } = await floating(["codex", "claude"]);
    const assistant = assistantFor(client);
    assistant.onAction({ type: "switch_pill" });
    await waitFor(() => expect(selected()).toEqual(["agent:claude"]));
    assistant.onAction({ type: "switch_pill", direction: "sideways" as unknown as "next" });
    await waitFor(() => expect(selected()).toEqual(["agent:codex"]));
  });

  it("the palette has a next and a previous pill command with no chord of their own", () => {
    const next = COMMANDS.find((c) => c.id === "pills.next");
    const previous = COMMANDS.find((c) => c.id === "pills.previous");
    expect(next?.defaultKeys).toBeUndefined();
    expect(previous?.defaultKeys).toBeUndefined();
    const run = vi.fn();
    const ctx = { switchPills: run } as unknown as CommandContext;
    next!.run(ctx);
    previous!.run(ctx);
    expect(run.mock.calls).toEqual([["next"], ["previous"]]);
    expect(() => buildBindings(COMMANDS, true)).not.toThrow();
    const bound: Chord[] = [...buildBindings(COMMANDS, true).byCommand.values()];
    expect(bound.length).toBeGreaterThan(0);
    expect(() => parseChord("Mod+K")).not.toThrow();
  });
});

describe("the shell bridge", () => {
  it("passes a well-formed switch_pills event on and drops a malformed one", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    const win = {
      __TAURI__: {
        core: { invoke: async () => ({}) },
        event: {
          listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
            handlers.set(name, handler);
            return () => handlers.delete(name);
          },
        },
      },
    } as unknown as Window;
    const shell = tauriShortcuts(win)!;
    const got: PillDirection[] = [];
    const off = await shell.onSwitchPills((d) => got.push(d));
    const send = handlers.get(SWITCH_PILLS_EVENT)!;
    expect(SWITCH_PILLS_EVENT).toBe("shortcuts://switch_pills");
    send({ payload: { direction: "next" } });
    send({ payload: { direction: "previous" } });
    send({ payload: { direction: "sideways" } });
    send({ payload: { direction: 1 } });
    send({ payload: null });
    send({ payload: "next" });
    expect(got).toEqual(["next", "previous"]);
    off();
    expect(handlers.has(SWITCH_PILLS_EVENT)).toBe(false);
  });
});

describe("a pill window that shows nothing", () => {
  it("still selects nothing and falls back when the list is empty", () => {
    const client = makeClient([]);
    const result = switchPillsCommand(client, "next", () => {});
    expect(result).toEqual({ pill: null, route: PILLS_FALLBACK_ROUTE });
    expect(screen.queryByRole("list")).toBeNull();
  });
});
