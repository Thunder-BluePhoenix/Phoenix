// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { BUILTIN_OUTFITS } from "@phoenix/pet-runtime";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SourcePills } from "../src/components/SourcePills";
import { pillContrast, Wardrobe } from "../src/components/Wardrobe";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { FloatingApp } from "../src/floating/FloatingApp";
import { IslandApp } from "../src/island/IslandApp";
import type { IslandFrame, IslandShell } from "../src/island/shell";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { mount, sendEvent } from "./harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const SCARF = BUILTIN_OUTFITS.find((o) => o.id === "ember-scarf")!;
const LANTERN = BUILTIN_OUTFITS.find((o) => o.id === "hearth-lantern")!;

interface AppearanceBody {
  outfit: string;
  hemisphere: "north" | "south";
  packs: unknown[];
  sources: Record<string, { colour: string; glyph: string; show: boolean }>;
  known: { id: string; label: string; kind: "agent" | "capability" }[];
}
type AppearanceResponse = AppearanceBody & {
  builtin: { id: string; name: string; season: string }[];
  glyphs: unknown[];
  limits: { packs: number; pack_bytes: number; sources: number };
};
const appearance = (over: Partial<AppearanceBody> = {}): AppearanceResponse => ({
  outfit: "none",
  hemisphere: "north",
  packs: [],
  sources: {},
  builtin: BUILTIN_OUTFITS.map((o) => ({ id: o.id, name: o.name, season: o.season ?? "any" })),
  known: [],
  glyphs: [],
  limits: { packs: 8, pack_bytes: 200_000, sources: 64 },
  ...over,
});

const reduced = (v: "auto" | "on" | "off") => ({
  "GET /api/pet/settings": () => ({ reduced_motion: v }),
});
const outfits = (root: ParentNode = document) => root.querySelectorAll("[data-outfit]");

function client(routes: Parameters<typeof fakeApi>[0]) {
  const api = fakeApi(routes);
  return {
    api,
    client: new PhoenixClient({
      token: "tok",
      baseUrl: "http://127.0.0.1:4870",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      minReconnectMs: 3_600_000,
      maxReconnectMs: 3_600_000,
      fetchImpl: api.fetchImpl,
    }),
  };
}

describe("outfits render in every Fawkes view", () => {
  const routes = (outfit = "ember-scarf", motion: "auto" | "on" | "off" = "off") => ({
    ...reduced(motion),
    "GET /api/fawkes/appearance": () => appearance({ outfit }),
  });

  it("navbar", async () => {
    mount(routes());
    await waitFor(() => expect(outfits().length).toBeGreaterThan(0));
    const navbar = document.querySelector(".navbar")!;
    expect(outfits(navbar).length).toBeGreaterThan(0);
    expect(navbar.querySelector("[data-outfit='ember-scarf']")).not.toBeNull();
  });

  it("Pet Panel (its Wardrobe tab previews the worn outfit)", async () => {
    mount(routes());
    window.location.hash = "#/panel/wardrobe";
    act(() => void window.dispatchEvent(new HashChangeEvent("hashchange")));
    const panel = await screen.findByRole("tabpanel");
    await waitFor(() => expect(panel.querySelector("[data-outfit='ember-scarf']")).not.toBeNull());
    expect(screen.getByRole("tab", { name: "Wardrobe" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(within(panel).getByText("Wearing: Ember Scarf")).toBeTruthy();
  });

  it("floating window", async () => {
    const { client: c } = client(routes());
    render(
      <CoreProvider client={c}>
        <FloatingApp shell={null} />
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    await waitFor(() => expect(outfits().length).toBeGreaterThan(0));
  });

  it("island", async () => {
    const { client: c } = client(routes());
    const frame: IslandFrame = {
      state: "small",
      pointer: "poll",
      layout: { rect: { x: 0, y: 0, w: 220, h: 34 }, notch_width: 0, has_notch: false },
    };
    const shell: IslandShell = {
      connection: async () => ({ base_url: "", token: "tok" }),
      frame: async () => frame,
      onFrame: async () => () => {},
      send: () => {},
      openInPhoenix: () => {},
      showMenu: () => {},
    };
    render(
      <CoreProvider client={c}>
        <IslandApp shell={shell} />
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    await waitFor(() => expect(outfits().length).toBeGreaterThan(0));
  });

  it("changes live when Core says fawkes.appearance.changed (no reload)", async () => {
    let outfit = "none";
    const { ws } = mount({
      ...reduced("off"),
      "GET /api/fawkes/appearance": () => appearance({ outfit }),
    });
    await screen.findByRole("button", { name: /^Fawkes/ });
    expect(outfits()).toHaveLength(0);
    outfit = "ember-scarf";
    sendEvent(ws, 1, "fawkes.appearance.changed", { changed: "settings" });
    await waitFor(() => expect(outfits().length).toBeGreaterThan(0));
    outfit = "none";
    sendEvent(ws, 2, "fawkes.appearance.changed", { changed: "settings" });
    await waitFor(() => expect(outfits()).toHaveLength(0));
  });

  it("an outfit never changes Fawkes' state, accessible name or live region", async () => {
    const bare = mount({ ...reduced("off"), "GET /api/fawkes/appearance": () => appearance() });
    const plainName = (await screen.findByRole("button", { name: /^Fawkes/ })).getAttribute(
      "aria-label",
    );
    const plainLive = document.querySelector(".fawkes-sr")!.textContent;
    cleanup();
    FakeWebSocket.reset();
    void bare;
    mount(routes());
    const dressed = await screen.findByRole("button", { name: /^Fawkes/ });
    await waitFor(() => expect(outfits().length).toBeGreaterThan(0));
    expect(dressed.getAttribute("aria-label")).toBe(plainName);
    expect(dressed.getAttribute("data-state")).toBe("IDLE");
    expect(document.querySelector(".fawkes-sr")!.textContent).toBe(plainLive);
  });

  it("with reduced motion on, only the still outfit renders and nothing animates", async () => {
    mount(routes("hearth-lantern", "on"));
    await waitFor(() => expect(outfits().length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^Fawkes/ }).getAttribute("data-reduced-motion"),
      ).toBe("true"),
    );
    expect(document.querySelectorAll("[data-outfit-animation]")).toHaveLength(0);
    expect(document.querySelector("[data-outfit-motion='still']")).not.toBeNull();
    expect(document.querySelector("[data-outfit-motion='animated']")).toBeNull();
  });

  it("with motion allowed, an animated layer carries a built-in animation name", async () => {
    mount(routes("hearth-lantern", "off"));
    await waitFor(() =>
      expect(document.querySelectorAll("[data-outfit-animation]").length).toBeGreaterThan(0),
    );
    expect(LANTERN.layers.some((l) => l.animation)).toBe(true);
  });

  it("a Core without the appearance routes leaves Fawkes undressed and working", async () => {
    mount(reduced("off"));
    expect(await screen.findByRole("button", { name: /^Fawkes/ })).toBeTruthy();
    expect(outfits()).toHaveLength(0);
  });
});

describe("Wardrobe entry point", () => {
  it("right-clicking Fawkes in the navbar opens the Wardrobe tab of the Pet Panel", async () => {
    mount({ ...reduced("off"), "GET /api/fawkes/appearance": () => appearance() });
    fireEvent.contextMenu(await screen.findByRole("button", { name: /^Fawkes/ }));
    expect(window.location.hash).toBe("#/panel/wardrobe");
    const tab = await screen.findByRole("tab", { name: "Wardrobe" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });
});

describe("source pills", () => {
  it("show a glyph and a text label, not colour alone", () => {
    render(
      <SourcePills
        pills={[
          { id: "agent:codex", label: "Codex", colour: "#1971c2", glyph: "ring" },
          { id: "capability:git", label: "Git", colour: "#1971c2", glyph: "square" },
        ]}
      />,
    );
    const pills = document.querySelectorAll(".source-pill");
    expect(pills).toHaveLength(2);
    for (const pill of pills) {
      expect(pill.querySelector("svg path, svg rect")).not.toBeNull();
      expect(pill.textContent!.trim().length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Codex")).toBeTruthy();
    // Same colour, still told apart: by shape and by name.
    expect(pills[0]!.getAttribute("data-glyph")).not.toBe(pills[1]!.getAttribute("data-glyph"));
    expect(screen.getByRole("list", { name: "Active sources" })).toBeTruthy();
  });

  it("count the pills beyond the cap in text instead of dropping them silently", () => {
    const pills = Array.from({ length: 6 }, (_, i) => ({
      id: `agent:a${i}`,
      label: `Agent ${i}`,
      colour: "#1971c2",
      glyph: "ring" as const,
    }));
    render(<SourcePills pills={pills} />);
    expect(document.querySelectorAll(".source-pill")).toHaveLength(5);
    expect(screen.getByText("+2 more")).toBeTruthy();
  });

  it("draws nothing without active sources", () => {
    render(<SourcePills pills={[]} />);
    expect(document.querySelector(".source-pills")).toBeNull();
  });

  const floating = async (appearanceBody: AppearanceResponse) => {
    const { client: c } = client({
      ...reduced("off"),
      "GET /api/fawkes/appearance": () => appearanceBody,
      "GET /api/agent/sessions": () => ({
        sessions: [
          {
            id: "s1",
            agent: "codex",
            project: "/p",
            repository: "p",
            first_seen: "",
            last_seen: "",
            active: true,
            step_count: 1,
            dropped_steps: 0,
            has_terminal: false,
          },
          {
            id: "s2",
            agent: "old-agent",
            project: "/p",
            repository: "p",
            first_seen: "",
            last_seen: "",
            active: false,
            step_count: 1,
            dropped_steps: 0,
            has_terminal: false,
          },
        ],
      }),
    });
    render(
      <CoreProvider client={c}>
        <FloatingApp shell={null} />
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    return FakeWebSocket.last;
  };

  it("the floating pet shows a pill for an active agent session, in the chosen colour", async () => {
    await floating(
      appearance({
        known: [{ id: "agent:codex", label: "Codex", kind: "agent" }],
        sources: { "agent:codex": { colour: "#c2255c", glyph: "diamond", show: true } },
      }),
    );
    const pill = await waitFor(() => {
      const p = document.querySelector<HTMLElement>(".source-pill[data-source='agent:codex']");
      expect(p).not.toBeNull();
      return p!;
    });
    expect(pill.textContent).toBe("Codex");
    expect(pill.style.getPropertyValue("--pill-colour")).toBe("#c2255c");
    expect(pill.dataset.glyph).toBe("diamond");
    // An idle (not active) session has no pill.
    expect(document.querySelector("[data-source='agent:old-agent']")).toBeNull();
  });

  it("'Show in Fawkes' off hides the source", async () => {
    await floating(
      appearance({
        known: [{ id: "agent:codex", label: "Codex", kind: "agent" }],
        sources: { "agent:codex": { colour: "#c2255c", glyph: "diamond", show: false } },
      }),
    );
    await screen.findByRole("button", { name: /^Fawkes/ });
    await act(async () => {});
    expect(document.querySelector(".source-pill")).toBeNull();
  });

  it("a capability with a running task gets a pill from the task list", async () => {
    const ws = await floating(
      appearance({ known: [{ id: "capability:git", label: "Git", kind: "capability" }] }),
    );
    act(() =>
      ws.message("task.updated", {
        tasks: [
          {
            key: "k",
            state: "WORKING",
            title: "Fetching",
            source: "git",
            since: "",
            updatedAt: "",
          },
        ],
      }),
    );
    expect((await screen.findByText("Git")).closest(".source-pill")).not.toBeNull();
  });
});

describe("Wardrobe", () => {
  function open(extra: Parameters<typeof fakeApi>[0] = {}, body = appearance()) {
    const { api, client: c } = client({
      ...reduced("off"),
      "GET /api/fawkes/appearance": () => body,
      ...extra,
    });
    render(
      <CoreProvider client={c}>
        <Wardrobe now={() => new Date(2026, 0, 10)} />
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    return api;
  }

  it("offers none, auto-season and every built-in outfit, and saves the choice", async () => {
    const api = open();
    expect(await screen.findByRole("radio", { name: /No outfit/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Follow the season/ })).toBeTruthy();
    for (const o of BUILTIN_OUTFITS)
      expect(screen.getByRole("radio", { name: new RegExp(o.name) })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Ember Scarf/ }));
    await waitFor(() =>
      expect(api.posts("/api/fawkes/appearance")[0]?.body).toEqual({ outfit: "ember-scarf" }),
    );
  });

  it("saves the hemisphere and previews the season's outfit for the injected date", async () => {
    const api = open({}, appearance({ outfit: "auto-season" }));
    expect(await screen.findByText("Wearing: Frostwool Beanie")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Hemisphere/), { target: { value: "south" } });
    await waitFor(() =>
      expect(api.posts("/api/fawkes/appearance")[0]?.body).toEqual({ hemisphere: "south" }),
    );
  });

  it("previews the outfit on a Fawkes with the outfit drawn", async () => {
    open({}, appearance({ outfit: "ember-scarf" }));
    await waitFor(() =>
      expect(document.querySelector("[data-outfit='ember-scarf']")).not.toBeNull(),
    );
    expect(SCARF.layers.length).toBeGreaterThan(0);
  });

  it("imports a pasted pack and shows Core's answer", async () => {
    const pack = JSON.stringify({
      format: "phoenix-outfit",
      version: 1,
      id: "mine",
      name: "Mine",
      author: "Me",
      license: "CC0-1.0",
      layers: [{ slot: "head", svg: '<circle cx="30" cy="20" r="4" fill="#ff0000"/>' }],
    });
    const api = open({ "POST /api/fawkes/packs": () => appearance() });
    const box = await screen.findByLabelText("Outfit pack (JSON)");
    const button = screen.getByRole("button", { name: "Import outfit" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(box, { target: { value: pack } });
    fireEvent.click(button);
    await screen.findByText("Outfit imported.");
    expect(api.posts("/api/fawkes/packs")[0]?.body).toMatchObject({ id: "mine" });
  });

  it.each([
    ["not JSON", "this is not json", /not valid JSON/],
    [
      "a script in a layer",
      JSON.stringify({
        format: "phoenix-outfit",
        version: 1,
        id: "evil",
        name: "E",
        author: "A",
        license: "L",
        layers: [{ slot: "head", svg: "<script>x</script>" }],
      }),
      /not allowed/,
    ],
  ])("refuses %s in the browser without calling Core", async (_n, text, message) => {
    const api = open();
    fireEvent.change(await screen.findByLabelText("Outfit pack (JSON)"), {
      target: { value: text },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import outfit" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(message);
    expect(api.posts("/api/fawkes/packs")).toHaveLength(0);
  });

  it("shows Core's refusal when Core rejects a pack", async () => {
    open({
      "POST /api/fawkes/packs": () =>
        new Response(
          JSON.stringify({
            code: "INVALID_REQUEST",
            message: "That id belongs to a built-in outfit",
          }),
          { status: 400 },
        ),
    });
    const pack = JSON.stringify({
      format: "phoenix-outfit",
      version: 1,
      id: "ember-scarf",
      name: "X",
      author: "A",
      license: "L",
      layers: [{ slot: "head", svg: '<circle cx="3" cy="3" r="1"/>' }],
    });
    fireEvent.change(await screen.findByLabelText("Outfit pack (JSON)"), {
      target: { value: pack },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import outfit" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/built-in outfit/);
  });

  it("deletes an imported pack", async () => {
    const mine = { ...SCARF, id: "mine", name: "Mine", author: "Me" };
    let packs: unknown[] = [mine];
    const api = open(
      {
        "GET /api/fawkes/appearance": () => appearance({ packs }),
        "DELETE /api/fawkes/packs/mine": () => {
          packs = [];
          return appearance();
        },
      },
      appearance({ packs }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete outfit Mine" }));
    await screen.findByText("Deleted Mine.");
    expect(
      api.calls.some((c) => c.method === "DELETE" && c.path === "/api/fawkes/packs/mine"),
    ).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Delete outfit Mine" })).toBeNull(),
    );
  });

  describe("per-source settings", () => {
    const known = [{ id: "agent:codex", label: "Codex", kind: "agent" as const }];
    const body = appearance({
      known,
      sources: { "agent:codex": { colour: "#1971c2", glyph: "ring", show: true } },
    });

    it("toggles 'show in Fawkes' per source", async () => {
      const api = open({}, body);
      fireEvent.click(await screen.findByRole("checkbox", { name: "Show Codex in Fawkes" }));
      await waitFor(() =>
        expect(api.posts("/api/fawkes/appearance")[0]?.body).toEqual({
          sources: { "agent:codex": { show: false } },
        }),
      );
    });

    it("changes the glyph with a labelled select", async () => {
      const api = open({}, body);
      fireEvent.change(await screen.findByLabelText("Shape for Codex"), {
        target: { value: "cross" },
      });
      await waitFor(() =>
        expect(api.posts("/api/fawkes/appearance")[0]?.body).toEqual({
          sources: { "agent:codex": { glyph: "cross" } },
        }),
      );
    });

    it("saves a colour on blur and says its contrast", async () => {
      const api = open({}, body);
      const colour = (await screen.findByLabelText("Colour for Codex")) as HTMLInputElement;
      fireEvent.change(colour, { target: { value: "#c2255c" } });
      fireEvent.blur(colour);
      await waitFor(() =>
        expect(api.posts("/api/fawkes/appearance")[0]?.body).toEqual({
          sources: { "agent:codex": { colour: "#c2255c" } },
        }),
      );
      expect(screen.getAllByText(/meets WCAG AA/).length).toBeGreaterThan(0);
    });

    it("warns, in text, when a colour is below WCAG AA on the pill background", async () => {
      open({}, body);
      const colour = (await screen.findByLabelText("Colour for Codex")) as HTMLInputElement;
      fireEvent.change(colour, { target: { value: "#ffe066" } });
      const note = await screen.findByText(/Warning: contrast .* below WCAG AA/);
      expect(note.getAttribute("role")).toBe("status");
      expect(pillContrast("#ffe066").ok).toBe(false);
      expect(pillContrast("#1971c2").ok).toBe(true);
    });

    it("every control has an accessible name and the sources sit in labelled groups", async () => {
      open({}, body);
      const group = await screen.findByRole("group", { name: "Codex" });
      for (const el of group.querySelectorAll("input, select")) {
        expect((el as HTMLInputElement).labels?.length ?? 0, el.outerHTML).toBeGreaterThan(0);
      }
    });
  });
});
