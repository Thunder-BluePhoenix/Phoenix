// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RetrievalSettings, RetrievalStatus } from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { doubleClick, openAt } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const settings = (over: Partial<RetrievalSettings> = {}): RetrievalSettings => ({
  enabled: false,
  provider: "ollama",
  model: "nomic-embed-text",
  k: 20,
  vector_weight: 0.5,
  reranker: "feature",
  ...over,
});

const status = (over: Partial<RetrievalStatus> = {}): RetrievalStatus => ({
  enabled: false,
  active: false,
  inactive_reason: "retrieval_disabled",
  provider: "ollama",
  model: "nomic-embed-text",
  vector_space: "ollama/nomic-embed-text#prefixed",
  embedded: 0,
  total: 12,
  unembedded: 12,
  failures: 0,
  other_models: [],
  payload_bytes: 0,
  last_run: null,
  ...over,
});

/** A fake Core whose settings and status follow what is posted, like the real one. */
function open(initial: RetrievalSettings, st: Partial<RetrievalStatus> = {}) {
  let current = initial;
  let rebuilt: RetrievalStatus | null = null;
  return openAt("#/settings", {
    "GET /api/retrieval/settings": () => current,
    "POST /api/retrieval/settings": (body) => {
      current = { ...current, ...(body as Partial<RetrievalSettings>) };
      return current;
    },
    "GET /api/retrieval/status": () =>
      rebuilt ??
      status({
        enabled: current.enabled,
        active: current.enabled,
        inactive_reason: current.enabled ? null : "retrieval_disabled",
        ...st,
      }),
    "POST /api/retrieval/rebuild": () =>
      (rebuilt = status({
        enabled: true,
        active: true,
        inactive_reason: null,
        embedded: 10,
        unembedded: 2,
        failures: 1,
        last_run: {
          at: new Date().toISOString(),
          embedded: 10,
          failed: 1,
          remaining: 2,
          capped: true,
          degraded: ["provider timed out"],
        },
      })),
  });
}

const section = async () =>
  within((await screen.findByRole("heading", { name: "Smart search" })).closest("section")!);

describe("Smart search settings", () => {
  it("is off by default, says so, and shows the consent copy about sensitive local queries", async () => {
    open(settings());
    const s = await section();
    const box = await s.findByRole("checkbox", { name: "Smart search (keywords and meaning)" });
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(s.getByText(/Off by default/)).toBeTruthy();
    const copy = s.getByText(/Your search questions are embedded too/).textContent!;
    expect(copy).toContain("treated as sensitive");
    expect(copy).toContain("stay on this computer");
    expect(copy).toContain("never sent to a cloud service unless you yourself chose that");
    expect(await s.findByText(/Smart search is off\./)).toBeTruthy();
  });

  it("turning it on sends only {enabled:true} and says what happens", async () => {
    const { api } = open(settings());
    const s = await section();
    fireEvent.click(await s.findByRole("checkbox"));
    await waitFor(() => expect(api.posts("/api/retrieval/settings")).toHaveLength(1));
    expect(api.posts("/api/retrieval/settings")[0]?.body).toEqual({ enabled: true });
    expect(await s.findByText(/Smart search is on\. It builds its index/)).toBeTruthy();
    expect((s.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("a double click on the switch sends ONE request", async () => {
    const { api } = open(settings());
    const s = await section();
    const box = await s.findByRole("checkbox");
    doubleClick(() => fireEvent.click(box));
    await s.findByText(/Smart search is on\./);
    expect(api.posts("/api/retrieval/settings")).toHaveLength(1);
  });

  it("shows status: index size, last build and the fallback reason", async () => {
    open(settings({ enabled: true }), {
      embedded: 10,
      total: 12,
      unembedded: 2,
      failures: 1,
      payload_bytes: 30_720,
      last_run: {
        at: new Date(Date.now() - 5 * 60_000).toISOString(),
        embedded: 10,
        failed: 1,
        remaining: 2,
        capped: true,
        degraded: ["provider timed out"],
      },
    });
    const s = await section();
    const facts = (await s.findByText("Index size")).closest("dl")!;
    expect(facts.textContent).toContain("10 of 12 memories indexed (2 waiting, 1 failed) · 30 KB");
    expect(facts.textContent).toContain("5 min ago: 10 added, 1 failed, 2 left");
    expect(facts.textContent).toContain("stopped at its limit");
    expect(facts.textContent).toContain("Keywords only for some of it: provider timed out");
    expect(facts.textContent).toContain("ollama / nomic-embed-text");
  });

  it("says when it is on but AI is off, and when it has never been built", async () => {
    open(settings({ enabled: true }), {
      active: false,
      inactive_reason: "ai_disabled",
    });
    const s = await section();
    expect(await s.findByText(/Smart search is on, but AI is off/)).toBeTruthy();
    expect(s.getByText("Not built since Phoenix started.")).toBeTruthy();
    expect(s.getByText(/None: no fallback reason was reported/)).toBeTruthy();
    expect(
      (s.getByRole("button", { name: "Rebuild entire index" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(s.getByText(/Rebuild is available only when smart search and AI are on/)).toBeTruthy();
  });

  it("requires visible confirmation, posts only the explicit rebuild request, and shows bounded partial results", async () => {
    const { api } = open(settings({ enabled: true }));
    const s = await section();
    const start = await s.findByRole("button", { name: "Rebuild entire index" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    expect(api.posts("/api/retrieval/rebuild")).toHaveLength(0);
    expect(s.getByText(/Rebuild replaces every vector for the current model/)).toBeTruthy();
    expect(s.getByText(/Other models’ vectors are kept/)).toBeTruthy();
    fireEvent.click(s.getByRole("button", { name: "Cancel" }));
    expect(api.posts("/api/retrieval/rebuild")).toHaveLength(0);
    fireEvent.click(s.getByRole("button", { name: "Rebuild entire index" }));
    doubleClick(() => fireEvent.click(s.getByRole("button", { name: "Confirm full rebuild" })));
    expect((await s.findByRole("status")).textContent).toContain(
      "10 indexed, 1 failed, 2 waiting; stopped at its limit",
    );
    expect(s.getByRole("status").textContent).toContain(
      "Keywords only for some of it: provider timed out",
    );
    expect(s.getByText("Index size").nextElementSibling?.textContent).toContain(
      "10 of 12 memories indexed (2 waiting, 1 failed)",
    );
    expect(api.posts("/api/retrieval/rebuild").map((c) => c.body)).toEqual([{ confirm: true }]);
    expect(api.posts("/api/retrieval/settings")).toHaveLength(0);
  });

  it("disables rebuild when search is off or the emergency stop is engaged", async () => {
    const { api } = open(settings());
    const s = await section();
    expect(
      ((await s.findByRole("button", { name: "Rebuild entire index" })) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(s.getByRole("button", { name: "Rebuild entire index" }));
    expect(api.posts("/api/retrieval/rebuild")).toHaveLength(0);
    cleanup();
    open(settings({ enabled: true }), { active: false, inactive_reason: "kill_switch" });
    const stopped = await section();
    expect(await stopped.findByText(/paused by the emergency stop/)).toBeTruthy();
    expect(
      (stopped.getByRole("button", { name: "Rebuild entire index" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows a rebuild error without claiming success, and allows a retry", async () => {
    const { api } = open(settings({ enabled: true }));
    api.set(
      "POST /api/retrieval/rebuild",
      () =>
        new Response(
          JSON.stringify({ code: "CAPABILITY_DISABLED", message: "Emergency stop engaged" }),
          { status: 409 },
        ),
    );
    const s = await section();
    const start = await s.findByRole("button", { name: "Rebuild entire index" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    fireEvent.click(s.getByRole("button", { name: "Confirm full rebuild" }));
    expect((await s.findByRole("alert")).textContent).toBe("Emergency stop engaged");
    expect(s.queryByRole("status")).toBeNull();
    expect(
      (s.getByRole("button", { name: "Rebuild entire index" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("keeps confirmation controls and results accessible at 320px", async () => {
    const previous = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    try {
      open(settings({ enabled: true }));
      const s = await section();
      const start = await s.findByRole("button", { name: "Rebuild entire index" });
      await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(start);
      const group = s.getByRole("group", { name: "Confirm full index rebuild" });
      expect(group.classList.contains("wrap")).toBe(true);
      fireEvent.click(within(group).getByRole("button", { name: "Confirm full rebuild" }));
      expect((await s.findByRole("status")).textContent).toContain("2 waiting");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: previous });
    }
  });

  it("shows an error from Core next to the switch", async () => {
    const { api } = open(settings());
    api.set(
      "POST /api/retrieval/settings",
      () =>
        new Response(JSON.stringify({ code: "INVALID_REQUEST", message: "nope" }), { status: 400 }),
    );
    const s = await section();
    fireEvent.click(await s.findByRole("checkbox"));
    expect((await s.findByRole("alert")).textContent).toBe("nope");
  });

  it("shows an error when the settings cannot be read", async () => {
    openAt("#/settings", {});
    const s = await section();
    expect((await s.findByRole("alert")).textContent).toBe("Not found");
  });
});
