// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type {
  AiStatus,
  MemoryAnswer,
  MemoryItem,
  MemorySearchHit,
  MemorySettings,
} from "../src/core/types";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const item = (id: string, over: Partial<MemoryItem> = {}): MemoryItem => ({
  id,
  text: `Memory text ${id}`,
  layer: "episodic",
  domain: "git",
  kind: "fact",
  source: "git",
  source_ref: `abc${id}`,
  scope: "user",
  sensitivity: "internal",
  observed_at: "2026-10-01T10:00:00Z",
  confidence: 1,
  retention_days: null,
  expires_at: null,
  redacted: false,
  ...over,
});

const ITEMS: MemoryItem[] = [
  item("m1", { confidence: 0.6, retention_days: 90, expires_at: "2027-01-01T00:00:00Z" }),
  item("m2", {
    domain: "meetings",
    source: "kage",
    source_ref: null,
    sensitivity: "sensitive",
    kind: "interpretation",
    text: "Meeting summary " + "x".repeat(400),
  }),
  item("m3", { domain: "docs", sensitivity: "public", source: "docs" }),
];

/** A Core that serves ITEMS honouring domain/limit/offset, like the real route. */
function memoryRoutes(all: MemoryItem[] = ITEMS) {
  const counts = (list: MemoryItem[]) => {
    const out: Record<string, number> = {};
    for (const i of list) out[i.domain] = (out[i.domain] ?? 0) + 1;
    return out;
  };
  return {
    "GET /api/memory": (_b: unknown, url: URL) => {
      const domain = url.searchParams.get("domain");
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const scoped = all.filter((i) => !domain || i.domain === domain);
      return {
        items: scoped.slice(offset, offset + limit),
        total: scoped.length,
        counts: counts(all),
        ai: { enabled: false },
      };
    },
  };
}

function setup(routes: Parameters<typeof fakeApi>[0] = memoryRoutes()) {
  const api = fakeApi(routes);
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <App />
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return api;
}

async function openMemory() {
  fireEvent.click(screen.getByRole("button", { name: /^Fawkes/ }));
  fireEvent.click(screen.getByRole("tab", { name: "Memory" }));
  return within(screen.getByRole("tabpanel"));
}

describe("Memory tab", () => {
  it("lists memories with kind, sensitivity, source, retention and confidence in words", async () => {
    setup();
    const panel = await openMemory();
    const list = await panel.findByRole("list", { name: "Memories" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);

    const first = within(within(list).getByText("Memory text m1").closest("li")!);
    expect(first.getByText("Stored fact")).toBeTruthy();
    expect(first.getByText("Internal")).toBeTruthy();
    expect(first.getByText(/from git \(abcm1\)/)).toBeTruthy();
    expect(first.getByText(/confidence 60%/)).toBeTruthy();
    expect(first.getByText(/Kept 90 days, expires/)).toBeTruthy();

    const meeting = within(
      within(list)
        .getByText(/^Meeting summary/)
        .closest("li")!,
    );
    expect(meeting.getByText("Generated interpretation")).toBeTruthy();
    expect(meeting.getByText("Sensitive")).toBeTruthy();
    expect(meeting.getByText("Kept until you delete it")).toBeTruthy();
    // No confidence shown at full confidence.
    expect(meeting.queryByText(/confidence/)).toBeNull();
  });

  it("truncates long text until expanded", async () => {
    setup();
    const panel = await openMemory();
    const row = within((await panel.findByText(/^Meeting summary/)).closest("li")!);
    expect(row.getByText(/^Meeting summary x+…$/)).toBeTruthy();
    fireEvent.click(row.getByRole("button", { name: "Show more" }));
    expect(row.queryByText(/^Meeting summary x+…$/)).toBeNull();
    expect(row.getByText(/^Meeting summary x{400}$/)).toBeTruthy();
    expect(row.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("filters by domain using the counts Core reports", async () => {
    const api = setup();
    const panel = await openMemory();
    await panel.findByText("Memory text m1");
    const chips = within(panel.getByRole("group", { name: "Memory domain" }));
    expect(chips.getByRole("button", { name: "All (3)" })).toBeTruthy();
    fireEvent.click(chips.getByRole("button", { name: "meetings (1)" }));
    await waitFor(() => expect(panel.queryByText("Memory text m1")).toBeNull());
    expect(panel.getByText(/^Meeting summary/)).toBeTruthy();
    expect(api.calls.some((c) => c.path.includes("domain=meetings"))).toBe(true);
    expect(chips.getByRole("button", { name: "meetings (1)" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("loads further pages on request", async () => {
    const many = Array.from({ length: 60 }, (_, n) => item(`p${n}`));
    const api = setup(memoryRoutes(many));
    const panel = await openMemory();
    await panel.findByText("Memory text p0");
    expect(panel.getAllByRole("listitem")).toHaveLength(50);
    fireEvent.click(panel.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(panel.getAllByRole("listitem")).toHaveLength(60));
    expect(api.calls.some((c) => c.path.includes("offset=50"))).toBe(true);
    expect(panel.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("searches only on submit and can return to the list", async () => {
    const hit: MemorySearchHit = { ...item("m3", { domain: "docs" }), score: 0.9 };
    const api = setup({
      ...memoryRoutes(),
      "GET /api/memory/search": () => ({ items: [hit] }),
    });
    const panel = await openMemory();
    await panel.findByText("Memory text m1");
    const box = panel.getByLabelText("Search memory");
    fireEvent.change(box, { target: { value: "release" } });
    expect(api.calls.some((c) => c.path.startsWith("/api/memory/search"))).toBe(false);

    fireEvent.submit(box.closest("form")!);
    const results = await panel.findByRole("list", { name: "Search results" });
    expect(within(results).getAllByRole("listitem")).toHaveLength(1);
    expect(panel.getByText(/1 result for/)).toBeTruthy();
    expect(api.calls.find((c) => c.path.startsWith("/api/memory/search"))?.path).toBe(
      "/api/memory/search?q=release&limit=20",
    );

    fireEvent.click(panel.getByRole("button", { name: "Clear search" }));
    expect(await panel.findByRole("list", { name: "Memories" })).toBeTruthy();
  });

  it("says when a search matches nothing", async () => {
    setup({ ...memoryRoutes(), "GET /api/memory/search": () => ({ items: [] }) });
    const panel = await openMemory();
    await panel.findByText("Memory text m1");
    const box = panel.getByLabelText("Search memory");
    fireEvent.change(box, { target: { value: "nothing" } });
    fireEvent.submit(box.closest("form")!);
    expect(await panel.findByText("Nothing in memory matches that search.")).toBeTruthy();
  });

  it("forgets one memory only after the second step, then removes it from view", async () => {
    const api = setup();
    const panel = await openMemory();
    const row = within((await panel.findByText("Memory text m1")).closest("li")!);
    fireEvent.click(row.getByRole("button", { name: "Forget…" }));
    expect(api.posts("/api/memory/m1/forget")).toHaveLength(0);
    fireEvent.click(row.getByRole("button", { name: "Confirm: forget this memory" }));
    await waitFor(() => expect(api.posts("/api/memory/m1/forget")[0]?.body).toEqual({}));
    await waitFor(() => expect(panel.queryByText("Memory text m1")).toBeNull());
    expect(panel.getByRole("button", { name: "All (2)" })).toBeTruthy();
  });

  it("cancelling the forget step sends nothing", async () => {
    const api = setup();
    const panel = await openMemory();
    const row = within((await panel.findByText("Memory text m1")).closest("li")!);
    fireEvent.click(row.getByRole("button", { name: "Forget…" }));
    fireEvent.click(row.getByRole("button", { name: "Cancel" }));
    expect(row.getByRole("button", { name: "Forget…" })).toBeTruthy();
    expect(api.posts("/api/memory/m1/forget")).toHaveLength(0);
  });

  it("shows an alert and keeps the memory when forgetting fails", async () => {
    setup({
      ...memoryRoutes(),
      "POST /api/memory/m1/forget": () =>
        new Response(JSON.stringify({ code: "RESOURCE_NOT_FOUND", message: "No such memory" }), {
          status: 404,
        }),
    });
    const panel = await openMemory();
    const row = within((await panel.findByText("Memory text m1")).closest("li")!);
    fireEvent.click(row.getByRole("button", { name: "Forget…" }));
    fireEvent.click(row.getByRole("button", { name: "Confirm: forget this memory" }));
    expect((await row.findByRole("alert")).textContent).toBe("No such memory");
    expect(panel.getByText("Memory text m1")).toBeTruthy();
  });

  it("shows an alert when the list cannot load", async () => {
    setup({
      "GET /api/memory": () =>
        new Response(JSON.stringify({ code: "INTERNAL_ERROR", message: "Memory is unavailable" }), {
          status: 500,
        }),
    });
    const panel = await openMemory();
    expect((await panel.findByRole("alert")).textContent).toBe("Memory is unavailable");
  });

  it("deletes everything only after the literal confirm, sending confirm: true", async () => {
    const api = setup({
      ...memoryRoutes(),
      "POST /api/memory/delete": () => ({ deleted: 3 }),
    });
    const panel = await openMemory();
    await panel.findByText("Memory text m1");
    fireEvent.click(panel.getByRole("button", { name: "Delete all memory…" }));
    expect(api.posts("/api/memory/delete")).toHaveLength(0);
    fireEvent.click(panel.getByRole("button", { name: "Confirm: delete all memory" }));
    await waitFor(() =>
      expect(api.posts("/api/memory/delete")[0]?.body).toEqual({ confirm: true }),
    );
    expect(await panel.findByText("Deleted 3 memories.")).toBeTruthy();
  });

  it("deletes one domain with that domain in the request", async () => {
    const api = setup({
      ...memoryRoutes(),
      "POST /api/memory/delete": () => ({ deleted: 1 }),
    });
    const panel = await openMemory();
    await panel.findByText("Memory text m1");
    fireEvent.click(panel.getByRole("button", { name: "meetings (1)" }));
    fireEvent.click(await panel.findByRole("button", { name: "Delete meetings memory…" }));
    fireEvent.click(panel.getByRole("button", { name: "Confirm: delete meetings memory" }));
    await waitFor(() =>
      expect(api.posts("/api/memory/delete")[0]?.body).toEqual({
        domain: "meetings",
        confirm: true,
      }),
    );
  });

  it("offers nothing to delete when memory is empty", async () => {
    setup(memoryRoutes([]));
    const panel = await openMemory();
    expect(await panel.findByText("Nothing is remembered yet.")).toBeTruthy();
    expect(
      (panel.getByRole("button", { name: "Delete all memory…" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("Ask Fawkes", () => {
  const fact = {
    id: "m1",
    text: "Released 0.3 on Friday",
    domain: "git",
    source: "git",
    source_ref: "abc123",
    observed_at: "2026-10-01T10:00:00Z",
    sensitivity: "internal" as const,
  };

  async function ask(answer: MemoryAnswer) {
    const api = setup({
      ...memoryRoutes(),
      "POST /api/memory/ask": () => answer,
    });
    const panel = await openMemory();
    await panel.findByText("Memory text m1");
    fireEvent.change(panel.getByLabelText("Ask Fawkes"), {
      target: { value: "  What shipped?  " },
    });
    fireEvent.click(panel.getByRole("button", { name: "Ask" }));
    return { api, panel };
  }

  it("lists stored facts with sources before a clearly labelled AI interpretation", async () => {
    const { api, panel } = await ask({
      facts: [fact],
      interpretation: "It looks like a release.",
      processed_by: "Ollama llama3.2 (on this device)",
      ai_used: true,
      note: null,
    });
    const interp = await panel.findByText("It looks like a release.");
    await waitFor(() =>
      expect(api.posts("/api/memory/ask")[0]?.body).toEqual({ question: "What shipped?" }),
    );
    const factEl = panel.getByText("Released 0.3 on Friday");
    expect(factEl.compareDocumentPosition(interp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.getByText(/from git \(abc123\)/)).toBeTruthy();
    expect(
      panel.getByText("Generated by Ollama llama3.2 (on this device), not a stored fact."),
    ).toBeTruthy();
    expect(panel.queryByText("No AI was used.")).toBeNull();
  });

  it("says no AI was used and shows the note when AI is off", async () => {
    const { panel } = await ask({
      facts: [fact],
      interpretation: null,
      processed_by: null,
      ai_used: false,
      note: "AI is off.",
    });
    expect(await panel.findByText("No AI was used.")).toBeTruthy();
    expect(panel.getByText("AI is off.")).toBeTruthy();
    expect(panel.getByText("Released 0.3 on Friday")).toBeTruthy();
    expect(panel.queryByText(/Generated by/)).toBeNull();
  });

  it("says so when nothing stored matched", async () => {
    const { panel } = await ask({
      facts: [],
      interpretation: null,
      processed_by: null,
      ai_used: false,
      note: null,
    });
    expect(await panel.findByText("No stored facts matched your question.")).toBeTruthy();
  });

  it("shows an alert when asking fails", async () => {
    setup({
      ...memoryRoutes(),
      "POST /api/memory/ask": () =>
        new Response(JSON.stringify({ code: "VALIDATION_ERROR", message: "Question too long" }), {
          status: 400,
        }),
    });
    const panel = await openMemory();
    await panel.findByText("Memory text m1");
    fireEvent.change(panel.getByLabelText("Ask Fawkes"), { target: { value: "q" } });
    fireEvent.click(panel.getByRole("button", { name: "Ask" }));
    expect((await panel.findByRole("alert")).textContent).toBe("Question too long");
  });
});

const memorySettings: MemorySettings = {
  retention_days: { working: 7, episodic: 90, project: null, preference: null },
  allow_sensitive_meetings: false,
  doc_paths: ["/home/me/notes.md"],
  capture_git: true,
};

const aiStatus: AiStatus = {
  enabled: false,
  preferred: null,
  cloud_opt_in: { public: false, internal: false, sensitive: false },
  external_processing_granted: false,
  providers: [
    { id: "ollama", label: "Ollama", locality: "local", available: true, reason: null },
    {
      id: "anthropic",
      label: "Anthropic Claude",
      locality: "cloud",
      available: false,
      reason: "No API key",
    },
  ],
};

function settingsSetup(extra: Parameters<typeof fakeApi>[0] = {}) {
  window.location.hash = "#/settings";
  const api = fakeApi({
    "GET /api/pet/settings": () => ({ reduced_motion: "auto" }),
    "GET /api/notifications/preferences": () => ({
      enabled: true,
      min_severity: "warning",
      muted_sources: [],
    }),
    "GET /api/privacy": () => ({
      location: "/home/me/.phoenix",
      data: [
        { id: "memory", description: "What Fawkes remembers.", count: 3, retention_days: null },
      ],
      audit_log: { description: "Security record.", count: 5 },
      credentials: [],
      telemetry: "none",
      external_ai: "AI is off; nothing is sent to AI providers.",
    }),
    "GET /api/memory/settings": () => memorySettings,
    "GET /api/ai/status": () => aiStatus,
    ...extra,
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <App />
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return api;
}

const section = async (name: string) =>
  within((await screen.findByRole("heading", { name, level: 2 })).closest("section")!);

describe("Memory settings", () => {
  it("shows Core's values and saves a retention change per layer", async () => {
    const api = settingsSetup();
    const memory = await section("Memory");
    const episodic = (await memory.findByLabelText(/^Events/)) as HTMLSelectElement;
    expect(episodic.value).toBe("90");
    expect((memory.getByLabelText(/^Project knowledge/) as HTMLSelectElement).value).toBe("");
    fireEvent.change(episodic, { target: { value: "30" } });
    await waitFor(() =>
      expect(api.posts("/api/memory/settings")[0]?.body).toEqual({
        retention_days: { working: 7, episodic: 30, project: null, preference: null },
      }),
    );
    fireEvent.change(memory.getByLabelText(/^Working notes/), { target: { value: "" } });
    await waitFor(() =>
      expect(api.posts("/api/memory/settings")[1]?.body).toEqual({
        retention_days: { working: null, episodic: 90, project: null, preference: null },
      }),
    );
  });

  it("toggles git learning and sensitive meetings (off by default) separately", async () => {
    const api = settingsSetup();
    const memory = await section("Memory");
    const git = (await memory.findByLabelText("Learn from my Git commits")) as HTMLInputElement;
    const meetings = memory.getByLabelText(
      "Include meeting summaries marked sensitive",
    ) as HTMLInputElement;
    expect(git.checked).toBe(true);
    expect(meetings.checked).toBe(false);
    fireEvent.click(meetings);
    await waitFor(() =>
      expect(api.posts("/api/memory/settings")[0]?.body).toEqual({
        allow_sensitive_meetings: true,
      }),
    );
    fireEvent.click(git);
    await waitFor(() =>
      expect(api.posts("/api/memory/settings")[1]?.body).toEqual({ capture_git: false }),
    );
  });

  it("saves doc paths, one per line, and rejects non-absolute or non-markdown lines locally", async () => {
    const api = settingsSetup();
    const memory = await section("Memory");
    const box = (await memory.findByLabelText(/Documents to learn from/)) as HTMLTextAreaElement;
    expect(box.value).toBe("/home/me/notes.md");

    fireEvent.change(box, { target: { value: "/a/b.md\nrelative/c.md" } });
    fireEvent.click(memory.getByRole("button", { name: "Save document list" }));
    expect((await memory.findByRole("alert")).textContent).toMatch(/relative\/c\.md/);
    expect(api.posts("/api/memory/settings")).toHaveLength(0);

    fireEvent.change(box, { target: { value: "  /a/b.md  \n\n/c/d.MD\n" } });
    fireEvent.click(memory.getByRole("button", { name: "Save document list" }));
    await waitFor(() =>
      expect(api.posts("/api/memory/settings")[0]?.body).toEqual({
        doc_paths: ["/a/b.md", "/c/d.MD"],
      }),
    );
  });

  it("shows Core's validation error as an alert", async () => {
    settingsSetup({
      "POST /api/memory/settings": () =>
        new Response(
          JSON.stringify({ code: "VALIDATION_ERROR", message: "Retention out of range" }),
          {
            status: 400,
          },
        ),
    });
    const memory = await section("Memory");
    fireEvent.click(await memory.findByLabelText("Learn from my Git commits"));
    expect((await memory.findByRole("alert")).textContent).toBe("Retention out of range");
  });

  it("lists memory in the privacy inventory", async () => {
    settingsSetup();
    const privacy = await section("Privacy and data");
    expect(await privacy.findByText("Memory", { selector: "strong" })).toBeTruthy();
  });
});

describe("AI settings", () => {
  it("is off by default and says nothing is sent", async () => {
    settingsSetup();
    const ai = await section("AI");
    expect(((await ai.findByLabelText("Turn on AI features")) as HTMLInputElement).checked).toBe(
      false,
    );
    expect(ai.getByText("AI is off. Nothing is sent to any AI model.")).toBeTruthy();
    expect(
      (ai.getByLabelText("Allow Phoenix to send data to external AI providers") as HTMLInputElement)
        .checked,
    ).toBe(false);
  });

  it("lists providers with locality and availability in words", async () => {
    settingsSetup();
    const ai = await section("AI");
    const list = within(await ai.findByRole("list", { name: "AI providers" }));
    const ollama = within(list.getByText("Ollama").closest("li")!);
    expect(ollama.getByText("On this device")).toBeTruthy();
    expect(ollama.getByText("Available")).toBeTruthy();
    const claude = within(list.getByText("Anthropic Claude").closest("li")!);
    expect(claude.getByText("Cloud (leaves this device)")).toBeTruthy();
    expect(claude.getByText("Not available: No API key")).toBeTruthy();
  });

  it("turns AI on and sets the preferred provider", async () => {
    const api = settingsSetup();
    const ai = await section("AI");
    fireEvent.click(await ai.findByLabelText("Turn on AI features"));
    await waitFor(() => expect(api.posts("/api/ai/settings")[0]?.body).toEqual({ enabled: true }));
    fireEvent.change(ai.getByLabelText("Preferred AI provider"), { target: { value: "ollama" } });
    await waitFor(() =>
      expect(api.posts("/api/ai/settings")[1]?.body).toEqual({ preferred: "ollama" }),
    );
    fireEvent.change(ai.getByLabelText("Preferred AI provider"), { target: { value: "" } });
    await waitFor(() =>
      expect(api.posts("/api/ai/settings")[2]?.body).toEqual({ preferred: null }),
    );
  });

  it("grants and withdraws external processing through its own route", async () => {
    const api = settingsSetup();
    const ai = await section("AI");
    fireEvent.click(
      await ai.findByLabelText("Allow Phoenix to send data to external AI providers"),
    );
    await waitFor(() =>
      expect(api.posts("/api/ai/external-processing")[0]?.body).toEqual({ granted: true }),
    );
  });

  it("sets public/internal opt-ins in one step", async () => {
    const api = settingsSetup();
    const ai = await section("AI");
    fireEvent.click(await ai.findByLabelText(/^Allow internal memories to be sent/));
    await waitFor(() =>
      expect(api.posts("/api/ai/settings")[0]?.body).toEqual({ cloud_opt_in: { internal: true } }),
    );
  });

  it("never enables sensitive opt-in without the extra explicit confirm", async () => {
    const api = settingsSetup();
    const ai = await section("AI");
    const box = (await ai.findByLabelText(/^Allow sensitive memories/)) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    // Nothing was sent, and the consequence is written out.
    expect(api.posts("/api/ai/settings")).toHaveLength(0);
    expect(
      ai.getByText(
        /Sensitive memories, including meeting summaries, may be sent to Anthropic Claude/,
      ),
    ).toBeTruthy();
    expect(box.checked).toBe(false);

    fireEvent.click(ai.getByRole("button", { name: "Cancel" }));
    expect(api.posts("/api/ai/settings")).toHaveLength(0);
    expect(ai.queryByText(/may be sent to Anthropic Claude/)).toBeNull();

    fireEvent.click(box);
    fireEvent.click(
      ai.getByRole("button", { name: "Confirm: allow sensitive memories to be sent" }),
    );
    await waitFor(() =>
      expect(api.posts("/api/ai/settings")[0]?.body).toEqual({ cloud_opt_in: { sensitive: true } }),
    );
  });

  it("turns the sensitive opt-in off without a confirm step", async () => {
    const api = settingsSetup({
      "GET /api/ai/status": () => ({
        ...aiStatus,
        enabled: true,
        cloud_opt_in: { public: false, internal: false, sensitive: true },
      }),
    });
    const ai = await section("AI");
    const box = (await ai.findByLabelText(/^Allow sensitive memories/)) as HTMLInputElement;
    await waitFor(() => expect(box.checked).toBe(true));
    fireEvent.click(box);
    await waitFor(() =>
      expect(api.posts("/api/ai/settings")[0]?.body).toEqual({
        cloud_opt_in: { sensitive: false },
      }),
    );
  });

  it("posts the Anthropic key once and never shows it again", async () => {
    const api = settingsSetup();
    const ai = await section("AI");
    const input = (await ai.findByLabelText(/^Anthropic API key/)) as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(
      (ai.getByRole("button", { name: "Save Anthropic key" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(input, { target: { value: "sk-ant-secret-123" } });
    fireEvent.click(ai.getByRole("button", { name: "Save Anthropic key" }));
    await waitFor(() =>
      expect(api.posts("/api/ai/secret")[0]?.body).toEqual({ value: "sk-ant-secret-123" }),
    );
    expect(await ai.findByText(/Key set\./)).toBeTruthy();
    expect(input.value).toBe("");
    expect(document.body.innerHTML).not.toContain("sk-ant-secret-123");
    expect(JSON.stringify(api.calls.filter((c) => c.method === "GET"))).not.toContain("sk-ant");
  });

  it("removes the key with DELETE", async () => {
    const api = settingsSetup({ "DELETE /api/ai/secret": () => ({}) });
    const ai = await section("AI");
    fireEvent.click(await ai.findByRole("button", { name: "Remove Anthropic key" }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.method === "DELETE" && c.path === "/api/ai/secret")).toBe(
        true,
      ),
    );
    expect(await ai.findByText("Key removed from your keychain.")).toBeTruthy();
  });

  it("shows API errors as alerts and keeps the typed key out of the DOM text", async () => {
    settingsSetup({
      "POST /api/ai/settings": () =>
        new Response(JSON.stringify({ code: "VALIDATION_ERROR", message: "Unknown provider" }), {
          status: 400,
        }),
    });
    const ai = await section("AI");
    fireEvent.click(await ai.findByLabelText("Turn on AI features"));
    expect((await ai.findByRole("alert")).textContent).toBe("Unknown provider");
  });
});
