// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Confirmation } from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { confirmation, mount, openPanel, sendEvent, TASK_ID, taskDetail } from "./harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => cleanup());

/** A queue the fake Core mutates when a decision is posted, like the real one. */
function queue(initial: Confirmation[], extra: Parameters<typeof mount>[0] = {}) {
  let pending = initial;
  const decisions: { id: string; approve: boolean }[] = [];
  const routes: Parameters<typeof mount>[0] = {
    ...extra,
    "GET /api/confirmations": () => ({ confirmations: pending }),
  };
  for (const c of initial) {
    routes[`POST /api/confirmations/${c.id}`] = (body) => {
      decisions.push({ id: c.id, approve: (body as { approve: boolean }).approve });
      pending = pending.filter((p) => p.id !== c.id);
      return { id: c.id, approved: (body as { approve: boolean }).approve };
    };
  }
  const m = mount(routes);
  openPanel();
  return { ...m, decisions, set: (next: Confirmation[]) => (pending = next) };
}

const card = (summary: string) => {
  const el = screen.getByRole("listitem", { name: summary });
  return within(el);
};

const full = confirmation({
  summary: "Mock: write a note",
  preview: "Writes the text “hello” to notes.txt",
  target: "repo:acme/app",
  risk: "medium",
  task_id: TASK_ID,
  evidence_ids: ["E1", "E2"],
});

describe("Approval cards", () => {
  it("explain what will happen before the buttons: action, preview, target, risk, effect, permissions, evidence", async () => {
    queue([full]);
    await screen.findByText("Mock: write a note");
    const c = card("Mock: write a note");
    expect(
      c.getByText(/Capability “mock” will run the command “write”. Effect: Changes data\./),
    ).toBeTruthy();
    expect(c.getByText("Writes the text “hello” to notes.txt")).toBeTruthy();
    expect(c.getByText("repo:acme/app")).toBeTruthy();
    expect(c.getByText(/^Medium/).textContent).toContain("Medium");
    expect(c.getByText("filesystem_write")).toBeTruthy();
    expect(c.getByText(/evidence held so far: E1, E2/)).toBeTruthy();
    expect(c.queryByText(/No preview was provided/)).toBeNull();
    expect(c.queryByText(/No target was provided/)).toBeNull();
    // The explanation comes before the decision buttons in reading order.
    const el = screen.getByRole("listitem", { name: "Mock: write a note" });
    const approve = c.getByRole("button", { name: "Approve: Mock: write a note" });
    expect(el.textContent!.indexOf("Writes the text")).toBeLessThan(
      el.textContent!.indexOf(approve.textContent!, el.textContent!.indexOf("Preview")),
    );
    expect(
      el.querySelector("dl")!.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("say so, in words, when the capability gave no preview, target or risk", async () => {
    queue([confirmation({ summary: "Old: do a thing" })]);
    await screen.findByText("Old: do a thing");
    const c = card("Old: do a thing");
    expect(c.getByText("No preview was provided by this capability.")).toBeTruthy();
    expect(c.getByText("No target was provided by this capability.")).toBeTruthy();
    expect(c.getByText("No risk level was provided.")).toBeTruthy();
  });

  it("show the risk tier as words for every tier", async () => {
    queue([
      confirmation({ id: "c_low", summary: "A", risk: "low" }),
      confirmation({ id: "c_med", summary: "B", risk: "medium" }),
      confirmation({ id: "c_high", summary: "C", risk: "high" }),
      confirmation({ id: "c_crit", summary: "D", risk: "critical" }),
    ]);
    await screen.findByText("A");
    expect(card("A").getByText(/^Low/)).toBeTruthy();
    expect(card("B").getByText(/^Medium/)).toBeTruthy();
    expect(card("C").getByText(/^High/)).toBeTruthy();
    expect(card("D").getByText(/^Critical/)).toBeTruthy();
  });

  it("approve a medium-risk request in one step and announce it", async () => {
    const { decisions } = queue([full]);
    fireEvent.click(await screen.findByRole("button", { name: "Approve: Mock: write a note" }));
    await waitFor(() => expect(decisions).toEqual([{ id: "conf_1", approve: true }]));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "" }).textContent).toContain(
        "Approved: Mock: write a note.",
      ),
    );
    expect(screen.queryByRole("listitem", { name: "Mock: write a note" })).toBeNull();
  });

  it("need a second, explicit step to approve a High or Critical request", async () => {
    const { decisions } = queue([
      confirmation({ id: "c_high", summary: "Deploy it", risk: "high", sideEffect: "production" }),
      confirmation({ id: "c_crit", summary: "Wipe it", risk: "critical", sideEffect: "write" }),
    ]);
    await screen.findByText("Deploy it");
    const approve = () =>
      screen.getByRole("button", { name: "Approve: Deploy it" }) as HTMLButtonElement;
    expect(approve().disabled).toBe(true);
    fireEvent.click(approve()); // a click on a disabled button does nothing
    expect(decisions).toEqual([]);

    fireEvent.click(card("Deploy it").getByLabelText("I understand this will change production"));
    expect(approve().disabled).toBe(false);
    fireEvent.click(card("Deploy it").getByLabelText("I understand this will change production"));
    expect(approve().disabled).toBe(true); // un-ticking disables again

    expect(
      (screen.getByRole("button", { name: "Approve: Wipe it" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(card("Wipe it").getByLabelText("I understand this will change data"));
    fireEvent.click(screen.getByRole("button", { name: "Approve: Wipe it" }));
    await waitFor(() => expect(decisions).toEqual([{ id: "c_crit", approve: true }]));
  });

  it("do not make a Low or Medium request wait behind a checkbox", async () => {
    queue([confirmation({ id: "c_low", summary: "A", risk: "low" })]);
    await screen.findByText("A");
    expect(card("A").queryByRole("checkbox")).toBeNull();
    expect((screen.getByRole("button", { name: "Approve: A" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("let you reject a High request without the extra step", async () => {
    const { decisions } = queue([confirmation({ summary: "Deploy it", risk: "high" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Reject: Deploy it" }));
    await waitFor(() => expect(decisions).toEqual([{ id: "conf_1", approve: false }]));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "" }).textContent).toContain(
        "Rejected: Deploy it.",
      ),
    );
  });

  it("show a failed decision as an alert and keep the request", async () => {
    mount({
      "GET /api/confirmations": () => ({ confirmations: [full] }),
      "POST /api/confirmations/conf_1": () =>
        new Response(
          JSON.stringify({ code: "RESOURCE_NOT_FOUND", message: "Confirmation not found" }),
          {
            status: 404,
          },
        ),
    });
    openPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Approve: Mock: write a note" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Confirmation not found");
    expect(screen.getByRole("listitem", { name: "Mock: write a note" })).toBeTruthy();
  });

  it("reload when a confirmation event arrives", async () => {
    const { ws, set } = queue([]);
    expect(screen.queryByText("Needs your approval")).toBeNull();
    set([full]);
    sendEvent(ws, 1, "security.confirmation.requested");
    expect(await screen.findByText("Mock: write a note")).toBeTruthy();
  });

  it("show the task behind a request, with its evidence, on demand", async () => {
    queue([full], {
      [`GET /api/agent/tasks/${TASK_ID}`]: () =>
        taskDetail("WAITING_APPROVAL", {
          evidence: [
            {
              id: "E1",
              kind: "log",
              source: "github",
              excerpt_hash: "h",
              excerpt: "boom",
              truncated: false,
            },
          ],
        }),
    });
    await screen.findByText("Mock: write a note");
    fireEvent.click(screen.getByRole("button", { name: "Show the task and its evidence" }));
    expect(await screen.findByText("Waiting for your approval")).toBeTruthy();
    expect(screen.getByLabelText("Evidence E1")).toBeTruthy();
  });
});

describe("Approval queue keyboard and focus", () => {
  const three = [
    confirmation({ id: "c1", summary: "First", risk: "low" }),
    confirmation({ id: "c2", summary: "Second", risk: "low" }),
    confirmation({ id: "c3", summary: "Third", risk: "low" }),
  ];

  it("moves between cards with Up and Down, and stops at the ends", async () => {
    queue(three);
    await screen.findByText("First");
    const el = (name: string) => screen.getByRole("listitem", { name });
    act(() => el("First").focus());
    fireEvent.keyDown(el("First"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(el("Second"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(el("Third"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(el("Third"));
    // From a button inside a card, too.
    const approve = within(el("Third")).getByRole("button", { name: "Approve: Third" });
    act(() => approve.focus());
    fireEvent.keyDown(approve, { key: "ArrowUp" });
    expect(document.activeElement).toBe(el("Second"));
  });

  it("has no global A or R shortcut: pressing them decides nothing", async () => {
    const { decisions } = queue(three);
    await screen.findByText("First");
    for (const key of ["a", "A", "r", "R", "Enter"]) {
      fireEvent.keyDown(document.body, { key });
      fireEvent.keyDown(screen.getByRole("listitem", { name: "First" }), { key });
    }
    expect(decisions).toEqual([]);
  });

  it("moves focus to the next card after a decision, then the previous, then the heading", async () => {
    queue(three);
    await screen.findByText("First");
    const el = (name: string) => screen.queryByRole("listitem", { name });

    fireEvent.click(screen.getByRole("button", { name: "Reject: Second" }));
    await waitFor(() => expect(el("Second")).toBeNull());
    expect(document.activeElement).toBe(el("Third"));

    fireEvent.click(screen.getByRole("button", { name: "Reject: Third" }));
    await waitFor(() => expect(el("Third")).toBeNull());
    expect(document.activeElement).toBe(el("First"));

    fireEvent.click(screen.getByRole("button", { name: "Reject: First" }));
    await waitFor(() => expect(el("First")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Approvals" }));
    expect(screen.getByText("Nothing is waiting for your approval.")).toBeTruthy();
  });

  it("announces results in a polite live region that exists before the result", async () => {
    queue(three);
    await screen.findByText("First");
    const region = screen.getByRole("status", { name: "" });
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Approve: First" }));
    await waitFor(() => expect(region.textContent).toBe("Approved: First."));
  });

  it("names every button so it can be told apart", async () => {
    queue(three);
    await screen.findByText("First");
    for (const n of ["First", "Second", "Third"]) {
      expect(screen.getByRole("button", { name: `Approve: ${n}` })).toBeTruthy();
      expect(screen.getByRole("button", { name: `Reject: ${n}` })).toBeTruthy();
    }
  });
});
