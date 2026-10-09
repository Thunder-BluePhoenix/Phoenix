// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeWebSocket } from "./fake-ws";
import { doubleClick, expectInert, openAt, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const aiStatus = (enabled: boolean) => ({
  enabled,
  preferred: null,
  cloud_opt_in: { public: false, internal: false, sensitive: false },
  external_processing_granted: false,
  providers: [],
});

const settings = (allow: boolean) => ({
  retention_days: { working: 1, episodic: 30, project: null, preference: null },
  allow_sensitive_meetings: allow,
  doc_paths: [],
  capture_git: true,
});

const hit = (text: string) => ({
  meeting_id: "kage:7",
  item_id: "mi_1",
  memory_id: "mem_1",
  text,
  origin: "reviewed",
  part: "action_item",
  observed_at: "2026-10-04T09:00:00Z",
  freshness: "fresh",
  score: 1,
});

function open(
  extra: Record<string, () => unknown> = {},
  opts: { ai?: boolean; allow?: boolean } = {},
) {
  return openAt("#/meetings", {
    "GET /api/meetings": () => ({ meetings: [] }),
    "GET /api/ai/status": () => aiStatus(opts.ai ?? false),
    "GET /api/memory/settings": () => settings(opts.allow ?? true),
    ...extra,
  });
}

const searchFor = (q: string) => {
  fireEvent.change(screen.getByLabelText("Search meetings"), { target: { value: q } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
};

describe("Search across meetings", () => {
  it("shows hits with where they came from, link to the meeting and how they were found", async () => {
    const { api } = open({
      "GET /api/meetings/search": () => ({
        query: "migration",
        hits: [hit("Ben writes the migration")],
        total: 1,
        retrieval: { mode: "lexical", vector_skipped_reason: "ai_disabled" },
      }),
    });
    searchFor("migration");
    expect(await screen.findByText("Ben writes the migration")).toBeTruthy();
    expect(api.calls.find((c) => c.path.startsWith("/api/meetings/search"))?.path).toBe(
      "/api/meetings/search?q=migration&limit=20",
    );
    expect(screen.getByText(/Reviewed by you/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Meeting kage:7" }).getAttribute("href")).toBe(
      "#/meetings/kage%3A7",
    );
    expect(
      screen.getByText(/Found by keywords only\. Smart search was not used: AI is off/),
    ).toBeTruthy();
  });

  it("says plainly when nothing matched", async () => {
    open({
      "GET /api/meetings/search": () => ({
        query: "zzz",
        hits: [],
        total: 0,
        retrieval: { mode: "lexical" },
      }),
    });
    searchFor("zzz");
    expect(await screen.findByText(/No meeting matched “zzz”/)).toBeTruthy();
  });

  it("explains that meeting content is not allowed, before and after a search", async () => {
    open(
      {
        "GET /api/meetings/search": () => ({
          query: "x",
          hits: [],
          total: 0,
          retrieval: { mode: "lexical" },
        }),
      },
      { allow: false },
    );
    expect(await screen.findByText(/Meeting content is not allowed in memory,/)).toBeTruthy();
    searchFor("x");
    expect(
      await screen.findByText("No results: meeting content is not allowed in memory."),
    ).toBeTruthy();
  });

  it("shows an error from Core", async () => {
    open({
      "GET /api/meetings/search": () =>
        new Response(JSON.stringify({ code: "INVALID_REQUEST", message: "boom" }), { status: 400 }),
    });
    searchFor("x");
    expect((await screen.findByRole("alert")).textContent).toBe("boom");
  });

  it("renders a hostile hit as text", async () => {
    const { container } = open({
      "GET /api/meetings/search": () => ({
        query: "x",
        hits: [hit(XSS)],
        total: 1,
        retrieval: { mode: "hybrid" },
      }),
    });
    searchFor("x");
    await screen.findByText(/Found by keywords and by meaning/);
    expectInert(container);
  });

  it("a double click on Search sends ONE request", async () => {
    const { api } = open({
      "GET /api/meetings/search": () => ({
        query: "x",
        hits: [],
        total: 0,
        retrieval: { mode: "lexical" },
      }),
    });
    fireEvent.change(screen.getByLabelText("Search meetings"), { target: { value: "x" } });
    const button = screen.getByRole("button", { name: "Search" });
    doubleClick(() => fireEvent.click(button));
    await screen.findByText(/No meeting matched/);
    expect(api.calls.filter((c) => c.path.startsWith("/api/meetings/search"))).toHaveLength(1);
  });
});

describe("Ask across meetings", () => {
  const answer = (over: Record<string, unknown> = {}) => ({
    question: "who writes it?",
    facts: [
      {
        ref: "M1",
        text: XSS,
        meeting_id: "kage:7",
        item_id: "mi_1",
        memory_id: "mem_1",
        origin: "reviewed",
      },
    ],
    interpretation: null,
    processed_by: null,
    ai_used: false,
    note: "AI is off.",
    retrieval: { mode: "lexical" },
    ...over,
  });

  const ask = (q: string) => {
    fireEvent.change(screen.getByLabelText("Ask about your meetings"), { target: { value: q } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  };

  it("lists stored facts with their meeting, and says no AI was used when AI is off", async () => {
    const { api, container } = open({ "POST /api/meetings/ask": () => answer() });
    expect(screen.getByText("AI is off, so you get matching stored facts only.")).toBeTruthy();
    ask("who writes it?");
    expect(await screen.findByText("No AI was used.")).toBeTruthy();
    expect(api.posts("/api/meetings/ask")[0]?.body).toEqual({ question: "who writes it?" });
    expect(screen.getByRole("link", { name: "Meeting kage:7" })).toBeTruthy();
    expectInert(container);
  });

  it("labels a generated interpretation as not a stored fact", async () => {
    open(
      {
        "POST /api/meetings/ask": () =>
          answer({
            interpretation: "Probably Ben.",
            ai_used: true,
            processed_by: "ollama/llama3.2",
          }),
      },
      { ai: true },
    );
    ask("who writes it?");
    expect(
      await screen.findByText("Generated by ollama/llama3.2, not a stored fact."),
    ).toBeTruthy();
    expect(screen.getByText("Probably Ben.")).toBeTruthy();
  });

  it("says when no stored fact matched", async () => {
    open({ "POST /api/meetings/ask": () => answer({ facts: [] }) });
    ask("anything");
    expect(await screen.findByText("No stored meeting fact matched your question.")).toBeTruthy();
  });

  it("a double click on Ask sends ONE request", async () => {
    const { api } = open({ "POST /api/meetings/ask": () => answer() });
    fireEvent.change(screen.getByLabelText("Ask about your meetings"), { target: { value: "q" } });
    const button = screen.getByRole("button", { name: "Ask" });
    doubleClick(() => fireEvent.click(button));
    await waitFor(() => expect(screen.getByText("No AI was used.")).toBeTruthy());
    expect(api.posts("/api/meetings/ask")).toHaveLength(1);
  });
});
