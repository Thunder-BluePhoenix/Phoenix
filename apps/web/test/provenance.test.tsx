// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, GraphProvenance } from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { doubleClick, expectInert, openAt, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const prov = (over: Partial<GraphProvenance> = {}): GraphProvenance => ({
  source_kind: "event",
  source_id: "evt_abc123",
  capability: "git",
  observed_at: "2026-10-04T09:00:00Z",
  recorded_at: "2026-10-04T09:00:01Z",
  confidence: 0.9,
  asserted_by: "capability",
  scope: "repo:Phoenix",
  domain: "git",
  sensitivity: "internal",
  detail: { title: "Add graph routes" },
  ...over,
});

const node = (
  id: string,
  type: string,
  label: string,
  over: Partial<GraphNode> = {},
): GraphNode => ({
  id,
  type,
  key: id.split(":").slice(1).join(":"),
  label,
  status: "fact",
  detail: {},
  provenance: [prov()],
  ...over,
});

const COMMIT = node("Commit:Phoenix@abc1234", "Commit", "abc1234 Add graph routes");
const MEETING = node("Meeting:kage:7", "Meeting", "Planning");
const DECISION = node("Decision:kage:7#aa", "Decision", "Ship the review panel");

const edge = (
  src: GraphNode,
  rel: string,
  dst: GraphNode,
  over: Partial<GraphEdge> = {},
): GraphEdge => ({
  id: `${src.id}|${rel}|${dst.id}`,
  src: src.id,
  rel,
  dst: dst.id,
  status: "fact",
  provenance: [prov({ confidence: 0.8 })],
  ...over,
});

const inspection = (n: GraphNode, origin: GraphProvenance[] = n.provenance) => ({
  node: n,
  origin,
  summary: {
    sources: origin.length,
    assertors: ["capability"],
    capabilities: ["git"],
    status: "fact",
  },
  visible_edges: 2,
});

const NODE_PATH = (n: GraphNode) => `GET /api/graph/nodes/${n.id}`;

function openNode(n: GraphNode, extra: Record<string, () => unknown> = {}) {
  return openAt(`#/provenance/${encodeURIComponent(n.id)}`, {
    [NODE_PATH(n)]: () => inspection(n),
    [`${NODE_PATH(n)}/neighbors`]: () => ({ center: n.id, nodes: [], edges: [], truncated: false }),
    ...extra,
  });
}

describe("Provenance page", () => {
  it("is in the main navigation and shows what the graph knows", async () => {
    openAt("#/provenance", {
      "GET /api/graph/status": () => ({
        nodes: 3,
        edges: 2,
        provenance: 5,
        visible_nodes_by_type: { Commit: 2, PullRequest: 1, Issue: 0 },
        commits_backfilled: 0,
        last_ingest: null,
      }),
    });
    expect(screen.getByRole("link", { name: "Provenance" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(await screen.findByText("Commit: 2")).toBeTruthy();
    expect(screen.getByText("Pull request: 1")).toBeTruthy();
    expect(screen.queryByText(/Issue: 0/)).toBeNull();
  });

  it("says the graph is empty", async () => {
    openAt("#/provenance", {
      "GET /api/graph/status": () => ({
        nodes: 0,
        edges: 0,
        provenance: 0,
        visible_nodes_by_type: {},
        commits_backfilled: 0,
        last_ingest: null,
      }),
    });
    expect(await screen.findByText(/The graph is empty/)).toBeTruthy();
  });

  it("shows an error when the graph is not available", async () => {
    openAt("#/provenance", {});
    expect((await screen.findByRole("alert")).textContent).toBe("Not found");
  });
});

describe("Finding an entity", () => {
  const found = (over: Record<string, unknown> = {}) => ({
    question: "why ADR-0020",
    seeds: [DECISION],
    answers: [
      {
        kind: "why",
        subject: DECISION,
        paths: [
          {
            nodes: [DECISION, MEETING],
            hops: [
              {
                from: DECISION.id,
                to: MEETING.id,
                direction: "forward",
                edge: edge(DECISION, "DECIDED_IN", MEETING),
              },
            ],
            text: "Decision “Ship the review panel” was decided in Meeting “Planning”",
          },
        ],
        truncated: { depth: true },
      },
    ],
    documents: [{ id: "d1", text: XSS, source: "docs", source_ref: "docs/a.md", score: 1 }],
    notes: [],
    retrieval: { mode: "lexical" },
    ...over,
  });

  const find = (q: string) => {
    fireEvent.change(screen.getByLabelText(/Name a commit/), { target: { value: q } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
  };

  it("lists matching entities as links and gives the chain as numbered text with confidence and relation", async () => {
    const { api, container } = openAt("#/provenance", { "POST /api/graph/ask": () => found() });
    find("why ADR-0020");
    const list = await screen.findByRole("list", { name: "Entities found" });
    const link = within(list).getByRole("link", { name: /Decision “Ship the review panel”/ });
    expect(link.getAttribute("href")).toBe(`#/provenance/${encodeURIComponent(DECISION.id)}`);
    expect(api.posts("/api/graph/ask")[0]?.body).toEqual({ question: "why ADR-0020" });
    const steps = screen.getByRole("list", { name: "Chain, step by step" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(1);
    expect(steps.textContent).toContain("Ship the review panel was decided in Planning");
    expect(steps.textContent).toContain("DECIDED_IN");
    expect(steps.textContent).toContain("confidence 80%");
    expect(
      screen.getByText(/This answer is incomplete: it stopped at the search depth/),
    ).toBeTruthy();
    // Retrieved text is data, kept apart from graph facts.
    expect(screen.getByText(/Related text \(retrieved, not graph facts\)/)).toBeTruthy();
    expectInert(container);
  });

  it("says when nothing matches exactly", async () => {
    openAt("#/provenance", {
      "POST /api/graph/ask": () =>
        found({
          seeds: [],
          answers: [],
          documents: [],
          notes: ["No entity in the question matches the graph exactly."],
        }),
    });
    find("hmm");
    expect(
      await screen.findByText("No entity in the question matches the graph exactly."),
    ).toBeTruthy();
  });

  it("shows errors, and a double click sends ONE request", async () => {
    const { api } = openAt("#/provenance", {
      "POST /api/graph/ask": () => found({ documents: [] }),
    });
    fireEvent.change(screen.getByLabelText(/Name a commit/), { target: { value: "q" } });
    doubleClick(() => fireEvent.click(screen.getByRole("button", { name: "Find" })));
    await screen.findByRole("list", { name: "Entities found" });
    expect(api.posts("/api/graph/ask")).toHaveLength(1);
  });

  it("shows the API error", async () => {
    openAt("#/provenance", {
      "POST /api/graph/ask": () =>
        new Response(JSON.stringify({ code: "INVALID_REQUEST", message: "bad question" }), {
          status: 400,
        }),
    });
    find("q");
    expect(await screen.findByText("bad question")).toBeTruthy();
  });
});

describe("Provenance of one entity", () => {
  it("shows what it is, whether it is a fact, and the origin summary", async () => {
    openNode(COMMIT);
    expect(await screen.findByRole("heading", { name: "abc1234 Add graph routes" })).toBeTruthy();
    expect(screen.getByText("Recorded fact")).toBeTruthy();
    expect(screen.getByText("Commit", { selector: ".mem-badge" })).toBeTruthy();
    expect(
      screen.getByText(/1 source\(s\) · recorded by a capability · 2 connection\(s\)/),
    ).toBeTruthy();
  });

  it("'Why do you think this?' lists evidence ids with the stored quote, as text", async () => {
    const hostile = prov({
      source_kind: "meeting_item",
      source_id: "mi_9",
      asserted_by: "user",
      sensitivity: "sensitive",
      detail: { text: XSS, state: "open" },
    });
    const { container } = openNode(COMMIT, {
      [NODE_PATH(COMMIT)]: () => inspection(COMMIT, [prov(), hostile]),
    });
    const button = await screen.findByRole("button", { name: /^Why do you think this\? abc1234/ });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Evidence id")).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("list", { name: /^Evidence for/ });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("event:evt_abc123");
    expect(rows[0]!.textContent).toContain("Add graph routes");
    expect(rows[0]!.textContent).toContain("confidence 90%");
    expect(rows[1]!.textContent).toContain("meeting_item:mi_9");
    expect(rows[1]!.textContent).toContain("confirmed by you");
    expect(rows[1]!.textContent).toContain("Sensitive");
    expect(rows[1]!.textContent).toContain("state: open");
    expect(container.querySelectorAll("blockquote")).toHaveLength(2);
    expectInert(container);
  });

  it("labels an AI-suggested node as not a fact", async () => {
    const proposed = node("Decision:kage:7#bb", "Decision", "Maybe", {
      status: "proposed",
      provenance: [prov({ asserted_by: "ai:ollama/llama3.2" })],
    });
    openNode(proposed);
    expect(
      await screen.findByText(/Suggested by AI, not confirmed: this is not a fact/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Why do you think this\? Maybe/ }));
    expect(screen.getByText(/suggested by AI \(ollama\/llama3.2\), not confirmed/)).toBeTruthy();
  });

  it("shows the chain as grouped text lists, with relation, direction, confidence and per-edge evidence", async () => {
    const e1 = edge(MEETING, "PARTICIPATED_IN", COMMIT, {
      provenance: [prov({ confidence: 0.5 })],
    });
    const e2 = edge(COMMIT, "TOUCHES", DECISION, { status: "proposed" });
    openNode(COMMIT, {
      [`${NODE_PATH(COMMIT)}/neighbors`]: () => ({
        center: COMMIT.id,
        nodes: [COMMIT, MEETING, DECISION],
        edges: [e1, e2],
        truncated: true,
      }),
    });
    const from = await screen.findByRole("list", { name: "Connections pointing at this" });
    expect(from.textContent).toContain("took part in");
    expect(from.textContent).toContain("Fact · confidence 50%");
    expect(
      within(from)
        .getByRole("link", { name: /Meeting “Planning”/ })
        .getAttribute("href"),
    ).toBe(`#/provenance/${encodeURIComponent(MEETING.id)}`);
    const to = screen.getByRole("list", { name: "Connections this points to" });
    expect(to.textContent).toContain("changed");
    expect(to.textContent).toContain("Suggested, not a fact");
    expect(screen.getByText("The list was cut short to stay readable.")).toBeTruthy();
    // The evidence of one edge is available too.
    fireEvent.click(within(from).getByRole("button", { name: /^Why do you think this\?/ }));
    expect(within(from).getByText("Evidence id")).toBeTruthy();
  });

  it("asks for two steps out when the user chooses it", async () => {
    const { api } = openNode(COMMIT);
    await screen.findByText("Nothing is connected to this yet.");
    fireEvent.click(screen.getByRole("button", { name: "Two steps out" }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.path.endsWith("/neighbors?depth=2"))).toBe(true),
    );
  });

  it("says an unknown or unreadable entity is unknown, without telling which", async () => {
    openAt(`#/provenance/${encodeURIComponent("Commit:nope")}`, {});
    expect(await screen.findByText(/no readable record of this entity/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to search" })).toBeTruthy();
  });

  it("renders a hostile label as text", async () => {
    const bad = node("Commit:x", "Commit", XSS);
    const { container } = openNode(bad);
    await screen.findByRole("heading", { level: 1 });
    expectInert(container);
  });
});
