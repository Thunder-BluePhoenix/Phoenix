// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeetingItem, MeetingItemStatus } from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { capability, doubleClick, expectInert, openAt, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const meeting = {
  id: "kage:1",
  capability_id: "kage",
  external_id: "1",
  title: "Design review",
  status: "ready",
  started_at: "2026-10-04T09:00:00Z",
  ended_at: null,
  duration_seconds: 1800,
  participants: [],
  recording: null,
  has_transcript: true,
  has_summary: false,
  archived_at: null,
  updated_at: "2026-10-04T09:40:00Z",
};

const item = (over: Partial<MeetingItem> = {}): MeetingItem => ({
  id: "mi_1",
  meeting_id: "kage:1",
  kind: "decision",
  text: "Use SQLite for the vector index",
  owner: null,
  due: null,
  status: "proposed",
  extracted_by: "ai:ollama/llama3.2",
  evidence: { source: "transcript", quote: "We decided to use SQLite for the index" },
  original: null,
  created_at: "2026-10-04T09:41:00Z",
  reviewed_at: null,
  reviewed_by: null,
  ...over,
});

const counts = (items: MeetingItem[]) => {
  const c: Record<MeetingItemStatus, number> = { proposed: 0, accepted: 0, edited: 0, rejected: 0 };
  for (const i of items) c[i.status]++;
  return c;
};

const aiStatus = (enabled: boolean) => ({
  enabled,
  preferred: null,
  cloud_opt_in: { public: false, internal: false, sensitive: false },
  external_processing_granted: false,
  providers: [],
});

const memorySettings = (allow: boolean) => ({
  retention_days: { working: 1, episodic: 30, project: null, preference: null },
  allow_sensitive_meetings: allow,
  doc_paths: [],
  capture_git: true,
});

/** A fake Core whose items change when a review action is posted, like the real one. */
function review(initial: MeetingItem[], opts: { ai?: boolean; allow?: boolean } = {}) {
  let items = initial;
  const result = (next: MeetingItem) => {
    items = items.map((i) => (i.id === next.id ? next : i));
    return { item: next, memory: { stored: next.status === "accepted" ? 1 : 0, refused: [] } };
  };
  const routes: Record<string, (body: unknown) => unknown> = {
    "GET /api/capabilities": () => ({ capabilities: [capability("kage", "enabled")] }),
    "GET /api/meetings/kage:1": () => meeting,
    "GET /api/meetings/kage:1/items": () => ({
      meeting_id: "kage:1",
      items,
      counts: counts(items),
    }),
    "GET /api/ai/status": () => aiStatus(opts.ai ?? false),
    "GET /api/memory/settings": () => memorySettings(opts.allow ?? true),
  };
  for (const i of initial) {
    const base = `POST /api/meeting-items/${i.id}`;
    const current = () => items.find((x) => x.id === i.id)!;
    routes[`${base}/accept`] = () =>
      result({ ...current(), status: "accepted", reviewed_by: "owner", reviewed_at: "now" });
    routes[`${base}/reject`] = () => result({ ...current(), status: "rejected" });
    routes[`${base}/reopen`] = () => result({ ...current(), status: "proposed" });
    routes[`${base}/edit`] = (body) => {
      const b = body as { text: string; owner?: string | null; due?: string | null };
      return result({
        ...current(),
        status: current().status === "accepted" ? "accepted" : "edited",
        text: b.text,
        owner: b.owner === undefined ? current().owner : b.owner,
        due: b.due === undefined ? current().due : b.due,
        original: { text: current().text, owner: null, due: null },
      });
    };
  }
  const m = openAt("#/meetings/kage%3A1", routes);
  return { ...m, items: () => items };
}

const card = async (text: string | RegExp) =>
  within((await screen.findByText(text)).closest("li") as HTMLElement);

describe("Decisions and action items of a meeting", () => {
  it("lists each item with kind, state in words, who found it, the quote and the meeting", async () => {
    review([
      item(),
      item({
        id: "mi_2",
        kind: "action_item",
        text: "Write the migration",
        owner: "Ben",
        due: "Friday",
        extracted_by: "kage",
        status: "accepted",
        evidence: null,
      }),
    ]);
    const first = await card("Use SQLite for the vector index");
    expect(first.getByText("Decision")).toBeTruthy();
    expect(first.getByText("Proposed: needs your review")).toBeTruthy();
    expect(first.getByText(/Suggested by AI \(ollama\/llama3.2\)/)).toBeTruthy();
    expect(first.getByText("We decided to use SQLite for the index")).toBeTruthy();
    expect(first.getByRole("link", { name: "kage:1" }).getAttribute("href")).toBe(
      "#/meetings/kage%3A1",
    );
    const second = await card("Write the migration");
    expect(second.getByText("Accepted")).toBeTruthy();
    expect(second.getByText(/Owner: Ben/)).toBeTruthy();
    expect(second.getByText(/Due: Friday/)).toBeTruthy();
    expect(second.getByText("No quote is stored for this item.")).toBeTruthy();
    expect(second.getByText(/Found by Kage/)).toBeTruthy();
    // The counts say how many are in each state.
    expect(screen.getByRole("button", { name: "Proposed (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accepted (1)" })).toBeTruthy();
  });

  it("only offers the actions the state table allows", async () => {
    review([
      item({ id: "mi_1", text: "proposed one" }),
      item({ id: "mi_2", text: "accepted one", status: "accepted" }),
      item({ id: "mi_3", text: "rejected one", status: "rejected" }),
    ]);
    const proposed = await card("proposed one");
    expect(proposed.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Accept",
      "Edit",
      "Reject",
    ]);
    const accepted = await card("accepted one");
    expect(accepted.getAllByRole("button").map((b) => b.textContent)).toEqual(["Edit", "Reject"]);
    const rejected = await card("rejected one");
    expect(rejected.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Reopen for review",
    ]);
  });

  it("accepts an item, says so, and keeps keyboard focus on the item", async () => {
    const { api } = review([item()]);
    const c = await card("Use SQLite for the vector index");
    fireEvent.click(c.getByRole("button", { name: /^Accept decision/ }));
    await waitFor(() => expect(api.posts("/api/meeting-items/mi_1/accept")).toHaveLength(1));
    expect(api.posts("/api/meeting-items/mi_1/accept")[0]?.body).toEqual({});
    expect(await screen.findByText(/Accepted the decision: Use SQLite/)).toBeTruthy();
    const after = (await screen.findByText("Accepted", { selector: "strong" })).closest("li")!;
    await waitFor(() => expect(document.activeElement).toBe(after));
  });

  it("a double click on Accept sends ONE request", async () => {
    const { api } = review([item()]);
    const c = await card("Use SQLite for the vector index");
    doubleClick(() => fireEvent.click(c.getByRole("button", { name: /^Accept decision/ })));
    await waitFor(() => expect(api.posts("/api/meeting-items/mi_1/accept")).toHaveLength(1));
    await screen.findByText("Accepted", { selector: "strong" });
    expect(api.posts("/api/meeting-items/mi_1/accept")).toHaveLength(1);
  });

  it("a double click on Reject sends ONE request", async () => {
    const { api } = review([item()]);
    const c = await card("Use SQLite for the vector index");
    doubleClick(() => fireEvent.click(c.getByRole("button", { name: /^Reject decision/ })));
    await waitFor(() => expect(api.posts("/api/meeting-items/mi_1/reject")).toHaveLength(1));
    await screen.findByText("Rejected", { selector: "strong" });
    expect(api.posts("/api/meeting-items/mi_1/reject")).toHaveLength(1);
  });

  it("rejected items can be reopened, never straight to accepted", async () => {
    const { api } = review([item({ status: "rejected" })]);
    const c = await card("Use SQLite for the vector index");
    fireEvent.click(c.getByRole("button", { name: /^Reopen/ }));
    await waitFor(() => expect(api.posts("/api/meeting-items/mi_1/reopen")).toHaveLength(1));
    expect(await screen.findByText("Proposed: needs your review")).toBeTruthy();
  });

  it("says when memory refused an accepted item", async () => {
    const { api } = review([item()]);
    api.set("POST /api/meeting-items/mi_1/accept", () => ({
      item: item({ status: "accepted" }),
      memory: {
        stored: 0,
        refused: ['sensitive meeting data from "meeting-review" needs explicit permission'],
      },
    }));
    const c = await card("Use SQLite for the vector index");
    fireEvent.click(c.getByRole("button", { name: /^Accept decision/ }));
    expect(await screen.findByText(/Not remembered yet: sensitive meeting data/)).toBeTruthy();
  });

  it("does not claim a rejected item was 'not remembered' when memory refuses to store nothing", async () => {
    const { api } = review([item()]);
    api.set("POST /api/meeting-items/mi_1/reject", () => ({
      item: item({ status: "rejected" }),
      memory: { stored: 0, refused: ["sensitive meeting data needs explicit permission"] },
    }));
    const c = await card("Use SQLite for the vector index");
    fireEvent.click(c.getByRole("button", { name: /^Reject decision/ }));
    expect(await screen.findByText(/Rejected the decision: Use SQLite/)).toBeTruthy();
    expect(screen.queryByText(/Not remembered yet/)).toBeNull();
  });

  it("shows an API failure next to the item", async () => {
    const { api } = review([item()]);
    api.set(
      "POST /api/meeting-items/mi_1/accept",
      () =>
        new Response(
          JSON.stringify({
            code: "INVALID_REQUEST",
            message: "A rejected item cannot become accepted",
          }),
          {
            status: 400,
          },
        ),
    );
    const c = await card("Use SQLite for the vector index");
    fireEvent.click(c.getByRole("button", { name: /^Accept decision/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("A rejected item cannot become accepted");
  });

  describe("edit form", () => {
    it("validates like the API: empty and over-long text, over-long owner and due", async () => {
      const { api } = review([
        item({ kind: "action_item", text: "Write the migration", owner: "Ben", due: "Friday" }),
      ]);
      const c = await card("Write the migration");
      fireEvent.click(c.getByRole("button", { name: /^Edit action item/ }));
      const text = screen.getByLabelText(/Wording/);
      fireEvent.change(text, { target: { value: "   " } });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      expect((await screen.findByRole("alert")).textContent).toBe("The text cannot be empty.");
      fireEvent.change(text, { target: { value: "x".repeat(501) } });
      fireEvent.change(screen.getByLabelText(/Owner/), { target: { value: "o".repeat(81) } });
      fireEvent.change(screen.getByLabelText(/Due/), { target: { value: "d".repeat(81) } });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(3));
      expect(screen.getByText(/The text is 501 characters; the most allowed is 500/)).toBeTruthy();
      expect(screen.getByText(/The owner is too long/)).toBeTruthy();
      expect(screen.getByText(/The due date is too long/)).toBeTruthy();
      expect(text.getAttribute("aria-invalid")).toBe("true");
      expect(api.posts("/api/meeting-items/mi_1/edit")).toHaveLength(0);
    });

    it("sends the edit with owner and due (blank clears) and shows the extracted wording", async () => {
      const { api } = review([
        item({ kind: "action_item", text: "Write the migration", owner: "Ben", due: "Friday" }),
      ]);
      const c = await card("Write the migration");
      fireEvent.click(c.getByRole("button", { name: /^Edit action item/ }));
      expect(document.activeElement).toBe(screen.getByLabelText(/Wording/));
      fireEvent.change(screen.getByLabelText(/Wording/), {
        target: { value: "  Write the database migration  " },
      });
      fireEvent.change(screen.getByLabelText(/Due/), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(api.posts("/api/meeting-items/mi_1/edit")).toHaveLength(1));
      expect(api.posts("/api/meeting-items/mi_1/edit")[0]?.body).toEqual({
        text: "Write the database migration",
        owner: "Ben",
        due: null,
      });
      expect(await screen.findByText("Extracted as: Write the migration")).toBeTruthy();
      expect(screen.getByText("Edited, not yet accepted")).toBeTruthy();
    });

    it("a decision has no owner or due fields, and its edit body has none", async () => {
      const { api } = review([item()]);
      const c = await card("Use SQLite for the vector index");
      fireEvent.click(c.getByRole("button", { name: /^Edit decision/ }));
      expect(screen.queryByLabelText(/Owner/)).toBeNull();
      expect(screen.queryByLabelText(/Due/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(api.posts("/api/meeting-items/mi_1/edit")).toHaveLength(1));
      expect(api.posts("/api/meeting-items/mi_1/edit")[0]?.body).toEqual({
        text: "Use SQLite for the vector index",
      });
    });

    it("Cancel leaves the item untouched", async () => {
      const { api } = review([item()]);
      const c = await card("Use SQLite for the vector index");
      fireEvent.click(c.getByRole("button", { name: /^Edit decision/ }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByLabelText(/Wording/)).toBeNull();
      expect(api.posts("/api/meeting-items/mi_1/edit")).toHaveLength(0);
    });
  });

  it("renders a hostile quote, item text and owner as text, never as HTML", async () => {
    const { container } = review([
      item({
        kind: "action_item",
        text: XSS,
        owner: XSS,
        evidence: { source: "transcript", quote: XSS },
      }),
    ]);
    await waitFor(() => expect(container.querySelector("blockquote")?.textContent).toBe(XSS));
    expectInert(container);
    expect(container.querySelectorAll("blockquote")).toHaveLength(1);
  });

  it("filters by state", async () => {
    review([
      item({ id: "mi_1", text: "proposed one" }),
      item({ id: "mi_2", text: "accepted one", status: "accepted" }),
    ]);
    await screen.findByText("proposed one");
    fireEvent.click(screen.getByRole("button", { name: "Accepted (1)" }));
    expect(screen.queryByText("proposed one")).toBeNull();
    expect(screen.getByText("accepted one")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accepted (1)" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Rejected (0)" }));
    expect(screen.getByText("No rejected items.")).toBeTruthy();
  });

  describe("empty and disabled states", () => {
    it("says plainly when there is nothing yet", async () => {
      review([]);
      expect(await screen.findByText(/No decisions or action items yet/)).toBeTruthy();
    });

    it("says AI is off, and disables the AI search with the reason", async () => {
      review([item()], { ai: false });
      expect(await screen.findByText("AI is off.")).toBeTruthy();
      const button = screen.getByRole("button", { name: "Look for more with AI" });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText(/Turn AI on in Settings/)).toBeTruthy();
    });

    it("says meeting content is not allowed in memory, and links to the setting", async () => {
      review([item()], { allow: false });
      const note = await screen.findByText("Meeting content is not allowed in memory.");
      expect(note.closest("p")?.textContent).toMatch(/accepted items are not remembered/);
      expect(
        within(note.closest("p") as HTMLElement)
          .getByRole("link", { name: "Settings" })
          .getAttribute("href"),
      ).toBe("#/settings");
    });

    it("does not show the AI-off or not-allowed notices when both are fine", async () => {
      review([item()], { ai: true, allow: true });
      await screen.findByText("Use SQLite for the vector index");
      expect(screen.queryByText("AI is off.")).toBeNull();
      expect(screen.queryByText("Meeting content is not allowed in memory.")).toBeNull();
    });

    it("shows an error when the items cannot be loaded", async () => {
      const m = review([item()]);
      m.api.set(
        "GET /api/meetings/kage:1/items",
        () =>
          new Response(JSON.stringify({ code: "RESOURCE_NOT_FOUND", message: "Not found" }), {
            status: 404,
          }),
      );
      // Force a reload through a Kage event.
      m.ws.message("event.created", {
        seq: 3,
        event: {
          event_id: "evt_3aaaaaa",
          event_type: "kage.summary.ready",
          source: "kage",
          severity: "info",
          timestamp: "",
          payload: {},
        },
      });
      expect(await screen.findAllByText("Not found")).toBeTruthy();
    });
  });

  describe("AI extraction", () => {
    it("reports in words what it found and what it discarded", async () => {
      const { api } = review([item()], { ai: true });
      api.set("POST /api/meetings/kage:1/items/extract", () => ({
        meeting_id: "kage:1",
        has_transcript: true,
        kage: { imported: 0, duplicates: 3, removed: 0 },
        ai: {
          stored: 2,
          unavailable: null,
          stats: { chars_skipped: 120, dropped: { quote_not_found: 1, no_quote: 2 } },
        },
        counts: { proposed: 3, accepted: 0, edited: 0, rejected: 0 },
      }));
      await screen.findByText("Use SQLite for the vector index");
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: "Look for more with AI" }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
      doubleClick(() =>
        fireEvent.click(screen.getByRole("button", { name: "Look for more with AI" })),
      );
      await waitFor(() =>
        expect(api.posts("/api/meetings/kage%3A1/items/extract")).toHaveLength(1),
      );
      expect(await screen.findByText(/AI added 2 proposed item/)).toBeTruthy();
      expect(
        screen.getByText(/Part of this transcript was not analysed \(120 characters\)/),
      ).toBeTruthy();
      expect(screen.getByText(/3 suggestion\(s\) were discarded/)).toBeTruthy();
      expect(api.posts("/api/meetings/kage%3A1/items/extract")).toHaveLength(1);
    });

    it("shows the reason when no model was used", async () => {
      const { api } = review([item()], { ai: true });
      api.set("POST /api/meetings/kage:1/items/extract", () => ({
        meeting_id: "kage:1",
        has_transcript: true,
        kage: { imported: 1, duplicates: 0, removed: 0 },
        ai: {
          stored: 0,
          unavailable: "No provider is allowed to read transcripts.",
          stats: { chars_skipped: 0, dropped: {} },
        },
        counts: { proposed: 1, accepted: 0, edited: 0, rejected: 0 },
      }));
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: "Look for more with AI" }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name: "Look for more with AI" }));
      expect(await screen.findByText("No provider is allowed to read transcripts.")).toBeTruthy();
    });
  });
});
