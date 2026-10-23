// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
//
// Phase 78 page against a fake Core: the board by state, filters and search, "unknown" cost shown
// as the word (never $0), the note about the provider's bill, budgets and prices, jump to the
// terminal or detail, and delete-all. Simulated: no real agent, provider or bill.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  distinct,
  filterSessions,
  NO_FILTER,
  type Mission,
  type MissionConfig,
  type MissionSession,
  type MissionTotals,
} from "../src/core/mission";
import { FakeWebSocket } from "./fake-ws";
import { openAt, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

/** The agent name on a session card (the same name also fills filter options and usage tables). */
const cardAgent = (name: string) => screen.findByText(name, { selector: ".mission-card strong" });

const NONE: MissionTotals = {
  input_tokens: 0,
  output_tokens: 0,
  tokens_reported: false,
  cost_usd: null,
  cost_partial: false,
};
const usage = (over: Partial<MissionTotals> = {}): MissionTotals => ({ ...NONE, ...over });

function session(over: Partial<MissionSession>): MissionSession {
  return {
    key: "claude-code:s1",
    id: "s1",
    agent: "claude-code",
    project: "alpha",
    state: "working",
    raw_state: "working",
    sources: ["report"],
    can_open: true,
    can_focus: false,
    usage: usage(),
    ...over,
  };
}

function mission(over: Partial<Mission> = {}): Mission {
  return {
    generated_at: "2026-10-20T10:00:00.000Z",
    days: ["2026-10-19", "2026-10-20"],
    stuck_after_min: 30,
    sources: { reported: true, orchestrated: true },
    sessions: [],
    totals: usage(),
    by_day: [],
    by_agent: [],
    by_project: [],
    by_session: [],
    unpriced_models: [],
    budgets: [],
    ingest: { day: "2026-10-20", clamped: 0, refused: 0, by_agent: [] },
    thresholds: [80, 95],
    ...over,
  };
}

const config = (over: Partial<MissionConfig> = {}): MissionConfig => ({
  budgets: [],
  prices: {},
  ai_price_models: [],
  stuck_after_min: 30,
  keep_days: 400,
  thresholds: [80, 95],
  ...over,
});

const BOARD = [
  session({ key: "claude-code:w", id: "w", state: "working", can_focus: true }),
  session({
    key: "gemini:g",
    id: "g",
    agent: "gemini",
    project: "beta",
    state: "waiting",
    reason: "permission",
  }),
  session({ key: "codex:f", id: "f", agent: "codex", project: "alpha", state: "finished" }),
  session({
    key: "claude-code:x",
    id: "x",
    project: "gamma",
    state: "stuck",
    stuck_reason: "safety_stall",
  }),
];

describe("pure filtering and search", () => {
  it("matches every word, case-insensitively, over agent, project and id", () => {
    expect(filterSessions(BOARD, { ...NO_FILTER, query: "CLAUDE alpha" }).map((s) => s.id)).toEqual(
      ["w"],
    );
    expect(filterSessions(BOARD, { ...NO_FILTER, query: "gem beta" }).map((s) => s.id)).toEqual([
      "g",
    ]);
    expect(filterSessions(BOARD, { ...NO_FILTER, query: "nothing" })).toEqual([]);
  });

  it("combines the agent, project and state filters", () => {
    expect(filterSessions(BOARD, { ...NO_FILTER, agent: "claude-code" }).map((s) => s.id)).toEqual([
      "w",
      "x",
    ]);
    expect(
      filterSessions(BOARD, { ...NO_FILTER, project: "alpha", state: "finished" }).map((s) => s.id),
    ).toEqual(["f"]);
    expect(filterSessions(BOARD, NO_FILTER)).toHaveLength(4);
  });

  it("a search is never a regular expression", () => {
    expect(filterSessions(BOARD, { ...NO_FILTER, query: ".*" })).toEqual([]);
  });

  it("distinct drops empty names and sorts", () => {
    expect(distinct(["b", "", "a", "b"])).toEqual(["a", "b"]);
  });
});

function open(m: Mission, c: MissionConfig = config(), extra: Parameters<typeof openAt>[1] = {}) {
  return openAt("#/mission", {
    "GET /api/mission": () => m,
    "GET /api/mission/config": () => c,
    ...extra,
  });
}

describe("mission control page", () => {
  it("shows every session in its column, with the note about the provider's bill", async () => {
    open(mission({ sessions: BOARD }));
    const heading = await screen.findByRole("heading", { name: /Waiting on you/ });
    const column = heading.closest("section")!;
    expect(within(column).getByText("gemini")).toBeTruthy();
    expect(within(column).getByText("Needs your permission")).toBeTruthy();
    const stuck = screen.getByRole("heading", { name: /Stuck/ }).closest("section")!;
    expect(within(stuck).getByText("Flagged as stalled by the safety net")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(
      /not verified against the provider's bill/,
    );
    expect(screen.getByRole("link", { name: "Mission" }).getAttribute("href")).toBe("#/mission");
  });

  it("an unknown cost reads 'Cost unknown', never $0; a known one is formatted; a partial one says 'or more'", async () => {
    open(
      mission({
        sessions: [
          session({
            key: "a:1",
            id: "1",
            agent: "unknown-cost",
            usage: usage({ input_tokens: 10, output_tokens: 5, tokens_reported: true }),
          }),
          session({
            key: "a:2",
            id: "2",
            agent: "known-cost",
            usage: usage({
              input_tokens: 10,
              output_tokens: 5,
              tokens_reported: true,
              cost_usd: 1.5,
            }),
          }),
          session({
            key: "a:3",
            id: "3",
            agent: "partial-cost",
            usage: usage({
              tokens_reported: true,
              input_tokens: 1,
              cost_usd: 2,
              cost_partial: true,
            }),
          }),
        ],
        totals: usage({ input_tokens: 21, output_tokens: 10, tokens_reported: true }),
        unpriced_models: ["m-9"],
      }),
    );
    const card = async (agent: string) => (await cardAgent(agent)).closest("li")!;
    expect(within(await card("unknown-cost")).getByText("Cost unknown")).toBeTruthy();
    expect(within(await card("known-cost")).getByText("Cost $1.50")).toBeTruthy();
    expect(within(await card("partial-cost")).getByText(/Cost \$2\.00 or more/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("$0.00");
    expect(screen.getByText(/No price is set for: m-9/)).toBeTruthy();
    const cost = screen.getByText("Cost", { selector: "dt" }).closest("div")!;
    expect(within(cost).getByText("unknown")).toBeTruthy();
  });

  it("a session that reported no tokens says so instead of showing 0 tokens", async () => {
    open(mission({ sessions: [session({})] }));
    expect(await screen.findByText("No token counts reported")).toBeTruthy();
  });

  it("filters by search text and by state, and can clear the filters", async () => {
    open(mission({ sessions: BOARD }));
    await cardAgent("gemini");
    const cards = () =>
      [...document.querySelectorAll(".mission-card strong")].map((e) => e.textContent);
    fireEvent.change(screen.getByLabelText("Search sessions"), { target: { value: "gamma" } });
    expect(cards()).toEqual(["claude-code"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(cards()).toHaveLength(4);
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "finished" } });
    expect(cards()).toEqual(["codex"]);
    fireEvent.change(screen.getByLabelText("Search sessions"), { target: { value: "zzz" } });
    expect(screen.getByText("No session matches the filters.")).toBeTruthy();
  });

  it("links to the session detail and focuses the terminal only where Core knows one", async () => {
    const { api } = open(mission({ sessions: BOARD }), config(), {
      "POST /api/agent/sessions/claude-code:w/focus-terminal": () => ({
        focused: true,
        method: "fake",
      }),
    });
    await cardAgent("gemini");
    expect(screen.getAllByRole("link", { name: "Details" })[0]!.getAttribute("href")).toMatch(
      /^#\/agents\//,
    );
    expect(screen.getAllByRole("button", { name: "Jump to terminal" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Jump to terminal" }));
    expect(await screen.findByText("The terminal window was brought to the front.")).toBeTruthy();
    expect(api.posts("/api/agent/sessions/claude-code%3Aw/focus-terminal")).toHaveLength(1);
  });

  it("shows an agent-supplied name as text, never as markup", async () => {
    const { container } = open(mission({ sessions: [session({ project: XSS, agent: "a" })] }));
    await screen.findByText(XSS, { selector: ".mission-card span" });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("warns when a source could not be read and shows the empty state", async () => {
    open(mission({ sources: { reported: false, orchestrated: true } }));
    expect(await screen.findByText(/could not be read right now/)).toBeTruthy();
    expect(screen.getByText("No agent sessions to show.")).toBeTruthy();
  });

  it("says when Core's limits cut or refused reports today, and is silent otherwise", async () => {
    open(
      mission({
        ingest: {
          day: "2026-10-20",
          clamped: 3,
          refused: 1,
          by_agent: [{ agent: "codex", clamped: 3, refused: 1 }],
        },
      }),
    );
    expect(await screen.findByText(/cut 3 reports to a limit and refused 1 report/)).toBeTruthy();
    expect(screen.getByText(/Agents: codex \(4\)/)).toBeTruthy();
  });

  it("shows no limit notice when nothing was cut", async () => {
    open(mission());
    await screen.findByText("No agent sessions to show.");
    expect(screen.queryByText(/to a limit and refused/)).toBeNull();
  });

  it("shows an error when Core cannot be read", async () => {
    openAt("#/mission", { "GET /api/mission": () => new Response("{}", { status: 500 }) });
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("budgets, prices and delete", () => {
  it("lists budget progress and says 'usage unknown' for an unknown cost", async () => {
    open(
      mission({
        budgets: [
          {
            id: "d",
            scope: "daily",
            metric: "tokens",
            limit: 1000,
            used: 850,
            pct: 85,
            unpriced_rows: 0,
          },
          {
            id: "u",
            scope: "daily",
            metric: "cost",
            limit: 10,
            used: null,
            pct: null,
            unpriced_rows: 2,
          },
          {
            id: "p",
            scope: "daily",
            metric: "cost",
            limit: 10,
            used: 4,
            pct: 40,
            unpriced_rows: 1,
          },
        ],
      }),
      config({
        budgets: [
          { id: "d", scope: "daily", metric: "tokens", limit: 1000 },
          { id: "u", scope: "daily", metric: "cost", limit: 10 },
          { id: "p", scope: "daily", metric: "cost", limit: 10 },
        ],
      }),
    );
    expect(await screen.findByText(/All of a day, Tokens: 850 of 1,000 \(85%\)/)).toBeTruthy();
    expect(screen.getByText(/usage unknown, limit \$10\.00/)).toBeTruthy();
    // Partly priced: "at least", never a bare figure that could pass for the whole.
    expect(screen.getByText(/at least \$4\.00 of \$10\.00 \(40%\)/)).toBeTruthy();
  });

  it("adds a budget (the existing ones are kept with their ids) and validates the limit", async () => {
    const { api } = open(
      mission(),
      config({ budgets: [{ id: "keep", scope: "session", metric: "tokens", limit: 5 }] }),
      {
        "POST /api/mission/config": (body) =>
          config({ budgets: (body as { budgets: never[] }).budgets }),
      },
    );
    await screen.findByText("Add budget");
    fireEvent.click(screen.getByRole("button", { name: "Add budget" }));
    expect(screen.getByText("Enter a limit above zero.")).toBeTruthy();
    expect(api.posts("/api/mission/config")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Limit"), { target: { value: "2500" } });
    fireEvent.change(screen.getByLabelText("Agent (optional)"), { target: { value: "codex" } });
    fireEvent.click(screen.getByRole("button", { name: "Add budget" }));
    await waitFor(() => expect(api.posts("/api/mission/config")).toHaveLength(1));
    expect(api.posts("/api/mission/config")[0]!.body).toEqual({
      budgets: [
        { id: "keep", scope: "session", metric: "tokens", limit: 5 },
        { scope: "daily", metric: "tokens", limit: 2500, agent: "codex" },
      ],
    });
  });

  it("saves a user price and says Phoenix has no built-in prices", async () => {
    const { api } = open(mission(), config(), {
      "POST /api/mission/config": () => config(),
    });
    expect(await screen.findByText(/Phoenix has no built-in prices/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save price" }));
    expect(screen.getByText("Enter a model name and two prices of zero or more.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "m-1" } });
    fireEvent.change(screen.getByLabelText("Input per million tokens"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Output per million tokens"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save price" }));
    await waitFor(() => expect(api.posts("/api/mission/config")).toHaveLength(1));
    expect(api.posts("/api/mission/config")[0]!.body).toEqual({
      prices: { "m-1": { input_per_mtok: 3, output_per_mtok: 0 } },
    });
  });

  it("saves how many days of usage are kept", async () => {
    const { api } = open(mission(), config(), {
      "POST /api/mission/config": () => config({ keep_days: 90 }),
    });
    const input = (await screen.findByLabelText(
      "Delete usage records older than this many days (7 to 3650)",
    )) as HTMLInputElement;
    expect(input.value).toBe("400");
    fireEvent.change(input, { target: { value: "90" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]!);
    await waitFor(() => expect(api.posts("/api/mission/config")).toHaveLength(1));
    expect(api.posts("/api/mission/config")[0]!.body).toEqual({ keep_days: 90 });
  });

  it("deletes all usage only after a second, explicit click", async () => {
    const { api } = open(mission(), config(), {
      "DELETE /api/mission/usage": () => ({ deleted: 3 }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Delete all agent usage" }));
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByText("3 records deleted")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([
      "/api/mission/usage?confirm=true",
    ]);
  });
});
