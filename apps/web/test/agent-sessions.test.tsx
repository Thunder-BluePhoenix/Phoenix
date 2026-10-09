// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentLink, OrchestratedSession } from "../src/core/types";
import { confirmation } from "./harness";
import { FakeWebSocket } from "./fake-ws";
import { capability, doubleClick, expectInert, openAt, sendEvent, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const SID = "ph-0123456789abcdef";
const OTHER = "ph-fedcba9876543210";

const LAUNCHERS = {
  launchers: {
    fake: {
      command: ["/opt/fake/agent", "--print"],
      cwd_roots: ["/work"],
      env_allow: ["SECRET_NAME"],
    },
  },
};

const session = (over: Partial<OrchestratedSession> = {}): OrchestratedSession => ({
  id: SID,
  launcher: "fake",
  workspace: "/work/phoenix",
  repository: "phoenix",
  state: "running",
  started_at: "2026-10-09T12:00:00Z",
  accepts_input: true,
  messages_sent: 0,
  ...over,
});

const link = (over: Partial<AgentLink> = {}): AgentLink => ({
  id: 1,
  session_id: SID,
  kind: "commit",
  ref: "abc1234",
  repo: "phoenix",
  confidence: "time+path",
  source: "git",
  why: { rule: "commit during the session in its folder" },
  created_at: "2026-10-09T12:01:00Z",
  ...over,
});

/** Fakes a capability command: POST starts operation `op-<command>`, GET reads it. */
function cmd(command: string, op: () => Record<string, unknown>) {
  return {
    [`POST /api/capabilities/agents/commands/${command}`]: () => ({ id: `op-${command}` }),
    [`GET /api/operations/op-${command}`]: op,
  };
}
const done = (result: unknown) => () => ({ status: "succeeded", result });

function open(
  hash: string,
  routes: Record<string, () => unknown> = {},
  config: Record<string, unknown> = LAUNCHERS,
) {
  return openAt(hash, {
    "GET /api/capabilities": () => ({ capabilities: [capability("agents", "enabled", config)] }),
    ...routes,
  });
}

const listRoutes = (sessions: OrchestratedSession[], ambiguous: AgentLink[] = []) =>
  cmd("session.list", done({ sessions, ambiguous_links: ambiguous }));

const detail = (over: Record<string, unknown> = {}) => ({
  session: session(),
  links: [link()],
  ambiguous: [],
  timeline: [
    { at: "2026-10-09T12:00:00Z", kind: "session.started" },
    {
      at: "2026-10-09T12:01:00Z",
      kind: "link.commit",
      detail: { ref: "abc1234", confidence: "time+path" },
    },
  ],
  output: { stdout: ["hello", "world"], stderr: [] },
  ...over,
});

const detailRoutes = (d: Record<string, unknown> = detail()) => cmd("session.get", done(d));

function fillStart(workspace = "/work/phoenix", prompt = "fix the bug") {
  fireEvent.change(screen.getByLabelText(/^Workspace/), { target: { value: workspace } });
  fireEvent.change(screen.getByLabelText(/^What should it do/), { target: { value: prompt } });
}

describe("Coding-agent sessions list", () => {
  it("is in the navigation and lists sessions with their state in words", async () => {
    open(
      "#/agents",
      listRoutes([
        session({ started_at: new Date().toISOString() }),
        session({ id: OTHER, state: "waiting" }),
        session({ id: "ph-1111111111111111", state: "failed" }),
      ]),
    );
    expect(screen.getByRole("link", { name: "Agents" }).getAttribute("aria-current")).toBe("page");
    await screen.findByText("Waiting for your input");
    const list = screen.getByRole("list", { name: "Sessions" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(list.textContent).toContain("Running");
    expect(list.textContent).toContain("Waiting for your input");
    expect(list.textContent).toContain("Failed");
    expect(list.textContent).not.toContain("just now ago");
    expect(list.textContent).toContain("started just now");
    expect(within(list).getAllByRole("link")[0]!.getAttribute("href")).toBe(`#/agents/${SID}`);
  });

  it("says plainly when there are no sessions, when the capability is off and when no launcher exists", async () => {
    open("#/agents", listRoutes([]));
    expect(await screen.findByText(/No session has been started/)).toBeTruthy();
    cleanup();
    openAt("#/agents", {
      "GET /api/capabilities": () => ({ capabilities: [capability("agents", "installed")] }),
    });
    expect(await screen.findByText(/capability is off/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Review before starting/ })).toBeNull();
    cleanup();
    open("#/agents", listRoutes([]), {});
    expect(await screen.findByText(/No launcher is set up/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Review before starting/ })).toBeNull();
  });

  it("makes no command call while the capability is off", async () => {
    const { api } = openAt("#/agents", {
      "GET /api/capabilities": () => ({ capabilities: [capability("agents", "installed")] }),
    });
    await screen.findByText(/capability is off/);
    expect(api.calls.some((c) => c.path.includes("/commands/"))).toBe(false);
  });

  it("shows an error when the list cannot be read", async () => {
    open(
      "#/agents",
      cmd("session.list", () => ({ status: "failed", error: { message: "NOT_CONNECTED" } })),
    );
    expect((await screen.findByRole("alert")).textContent).toBe("NOT_CONNECTED");
  });

  it("renders hostile launcher and repository names as text", async () => {
    const { container } = open(
      "#/agents",
      listRoutes([session({ launcher: XSS, repository: XSS })]),
    );
    await screen.findByRole("list", { name: "Sessions" });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });
});

describe("Starting a session", () => {
  it("validates the form like the command schema and sends nothing", async () => {
    const { api } = open("#/agents", listRoutes([]));
    await screen.findByText(/No session has been started/);
    fireEvent.click(screen.getByRole("button", { name: "Review before starting…" }));
    expect(await screen.findByText("Enter the folder the agent should work in.")).toBeTruthy();
    expect(screen.getByText("Write what the agent should do.")).toBeTruthy();
    fillStart("relative/path", "x".repeat(8001));
    fireEvent.click(screen.getByRole("button", { name: "Review before starting…" }));
    expect(await screen.findByText(/must be an absolute path/)).toBeTruthy();
    expect(screen.getByText(/the most allowed is 8000/)).toBeTruthy();
    expect(api.calls.some((c) => c.path.includes("session.start"))).toBe(false);
  });

  it("SHOWS launcher, command and workspace before anything is requested", async () => {
    const { api } = open("#/agents", listRoutes([]));
    await screen.findByText(/No session has been started/);
    fillStart("/work/phoenix", "fix the bug");
    fireEvent.click(screen.getByRole("button", { name: "Review before starting…" }));
    const preview = await screen.findByRole("group", { name: "Check this before you start" });
    expect(preview.textContent).toContain("fake");
    expect(preview.textContent).toContain("/opt/fake/agent --print");
    expect(preview.textContent).toContain("/work/phoenix");
    expect(preview.textContent).toContain("/work");
    expect(preview.textContent).toContain("11 characters");
    expect(preview.textContent).not.toContain("fix the bug");
    expect(preview.textContent).not.toContain("SECRET_NAME");
    // Looking is not starting.
    expect(api.posts("/api/capabilities/agents/commands/session.start")).toHaveLength(0);
    // Back returns to the form with what was typed.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByLabelText(/^Workspace/) as HTMLInputElement).value).toBe("/work/phoenix");
  });

  it("asks Core for approval, shows the approval, and reports the started session", async () => {
    let pending: unknown[] = [];
    let status = "pending";
    const { api, ws } = open("#/agents", {
      ...listRoutes([]),
      "POST /api/capabilities/agents/commands/session.start": () => {
        pending = [
          confirmation({
            id: "conf_s",
            capabilityId: "agents",
            command: "session.start",
            summary: "agents: Start a coding agent",
            sideEffect: "execute",
            permissions: ["shell_command"],
            risk: "medium",
          }),
        ];
        return { id: "op-start" };
      },
      "GET /api/operations/op-start": () =>
        status === "succeeded" ? { status, result: session() } : { status },
      "GET /api/confirmations": () => ({ confirmations: pending }),
      "POST /api/confirmations/conf_s": () => {
        pending = [];
        status = "succeeded";
        return {};
      },
    });
    await screen.findByText(/No session has been started/);
    fillStart();
    fireEvent.click(screen.getByRole("button", { name: "Review before starting…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start the session…" }));
    await waitFor(() =>
      expect(api.posts("/api/capabilities/agents/commands/session.start")[0]?.body).toEqual({
        input: { launcher: "fake", workspace: "/work/phoenix", prompt: "fix the bug" },
      }),
    );
    expect(await screen.findByText("Waiting for your approval below.")).toBeTruthy();
    sendEvent(ws, 5, "security.confirmation.requested");
    const approve = await screen.findByRole("button", { name: /^Approve:/ });
    fireEvent.click(approve);
    await waitFor(() =>
      expect(api.posts("/api/confirmations/conf_s")[0]?.body).toEqual({ approve: true }),
    );
    // Core announces the decision; that, not a timer, is what makes the page look again.
    sendEvent(ws, 6, "security.confirmation.approved");
    expect(await screen.findByText(`Started session ${SID}.`)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the session" }).getAttribute("href")).toBe(
      `#/agents/${SID}`,
    );
  });

  it("a double click on Start sends ONE request", async () => {
    const { api } = open("#/agents", {
      ...listRoutes([]),
      ...cmd("session.start", () => ({ status: "pending" })),
    });
    await screen.findByText(/No session has been started/);
    fillStart();
    fireEvent.click(screen.getByRole("button", { name: "Review before starting…" }));
    const start = await screen.findByRole("button", { name: "Start the session…" });
    doubleClick(() => fireEvent.click(start));
    await waitFor(() =>
      expect(api.posts("/api/capabilities/agents/commands/session.start")).toHaveLength(1),
    );
    // Still one while the approval is pending, and the button is disabled.
    await screen.findByText("Waiting for your approval below.");
    expect(
      (screen.getByRole("button", { name: "Start the session…" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(api.posts("/api/capabilities/agents/commands/session.start")).toHaveLength(1);
  });

  it("shows a refusal from Core (a rejected or failed start)", async () => {
    open("#/agents", {
      ...listRoutes([]),
      ...cmd("session.start", () => ({
        status: "failed",
        error: { message: "The workspace is outside the launcher's folders" },
      })),
    });
    await screen.findByText(/No session has been started/);
    fillStart("/elsewhere");
    fireEvent.click(screen.getByRole("button", { name: "Review before starting…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start the session…" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The workspace is outside the launcher's folders",
    );
  });

  it("shows an error when the request itself is refused", async () => {
    open("#/agents", {
      ...listRoutes([]),
      "POST /api/capabilities/agents/commands/session.start": () =>
        new Response(
          JSON.stringify({ code: "INVALID_REQUEST", message: "Invalid command input" }),
          { status: 400 },
        ),
    });
    await screen.findByText(/No session has been started/);
    fillStart();
    fireEvent.click(screen.getByRole("button", { name: "Review before starting…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start the session…" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Invalid command input");
    // After a failure the user can try again.
    expect(
      (screen.getByRole("button", { name: "Start the session…" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe("Session detail", () => {
  it("shows state, timeline, links with why, and the output as plain text", async () => {
    const { container } = open(`#/agents/${SID}`, detailRoutes());
    expect(await screen.findByText("Running")).toBeTruthy();
    const timeline = screen.getByRole("list", { name: "Timeline" });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(2);
    expect(timeline.textContent).toContain("link.commit");
    const links = screen.getByRole("list", { name: "Linked work" });
    expect(links.textContent).toContain("abc1234");
    expect(links.textContent).toContain("matched by time and folder");
    expect(links.textContent).toContain("rule: commit during the session in its folder");
    const out = screen.getByLabelText("Output (plain text, scrolls)");
    expect(out.tagName).toBe("PRE");
    expect(out.textContent).toBe("hello\nworld");
    expect(out.getAttribute("tabindex")).toBe("0");
    expect(container.querySelector("script")).toBeNull();
  });

  it("asks for the last 200 output lines", async () => {
    const { api } = open(`#/agents/${SID}`, detailRoutes());
    await screen.findByText("Running");
    expect(api.posts("/api/capabilities/agents/commands/session.get")[0]?.body).toEqual({
      input: { session_id: SID, output_lines: 200 },
    });
  });

  it("renders output with markup, escapes and fake events as inert text in a bounded region", async () => {
    const hostile = [XSS, '{"event_type":"agent.completed"}', "\u001b[31mred", "a".repeat(5000)];
    const { container } = open(
      `#/agents/${SID}`,
      detailRoutes(detail({ output: { stdout: hostile, stderr: [XSS] } })),
    );
    await screen.findByText("Running");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    const pres = container.querySelectorAll("pre.agent-output");
    expect(pres).toHaveLength(2);
    expect(pres[0]!.textContent).toBe(hostile.join("\n"));
    expect(pres[1]!.textContent).toBe(XSS);
    expect(pres[0]!.children).toHaveLength(0);
  });

  it("says when there is no output, no links and when the session is gone from memory", async () => {
    open(
      `#/agents/${SID}`,
      detailRoutes(detail({ session: null, links: [], timeline: [], output: undefined })),
    );
    expect(await screen.findByText(/no longer in memory/)).toBeTruthy();
    expect(screen.getByText("No commit, CI run or pull request is linked yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Stop the session/ })).toBeNull();
  });

  it("shows the error for an unknown session", async () => {
    open(
      `#/agents/${SID}`,
      cmd("session.get", () => ({ status: "failed", error: { message: "Unknown session" } })),
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Unknown session");
  });

  it("refreshes when an agent event arrives", async () => {
    let state: OrchestratedSession["state"] = "running";
    const { ws } = open(
      `#/agents/${SID}`,
      cmd("session.get", () => ({
        status: "succeeded",
        result: detail({ session: session({ state }) }),
      })),
    );
    await screen.findByText("Running");
    state = "completed";
    sendEvent(ws, 7, "agent.completed");
    expect(await screen.findByText("Finished")).toBeTruthy();
    expect(screen.getByText(/This session is over/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Stop the session…" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  describe("controls", () => {
    it("sends a message through the command route and waits for approval", async () => {
      const { api } = open(`#/agents/${SID}`, {
        ...detailRoutes(),
        ...cmd("session.send", done(session({ messages_sent: 1 }))),
      });
      await screen.findByText("Running");
      fireEvent.change(screen.getByLabelText(/^Message to the agent/), {
        target: { value: "keep going" },
      });
      const send = screen.getByRole("button", { name: "Send message…" });
      doubleClick(() => fireEvent.click(send));
      await waitFor(() =>
        expect(api.posts("/api/capabilities/agents/commands/session.send")).toHaveLength(1),
      );
      expect(api.posts("/api/capabilities/agents/commands/session.send")[0]?.body).toEqual({
        input: { session_id: SID, message: "keep going" },
      });
      expect(await screen.findByText("Message sent.")).toBeTruthy();
      await waitFor(() =>
        expect((screen.getByLabelText(/^Message to the agent/) as HTMLTextAreaElement).value).toBe(
          "",
        ),
      );
    });

    it("says when a session takes no messages", async () => {
      open(`#/agents/${SID}`, detailRoutes(detail({ session: session({ accepts_input: false }) })));
      expect(await screen.findByText(/does not take messages/)).toBeTruthy();
      expect(screen.queryByLabelText(/^Message to the agent/)).toBeNull();
    });

    it("stops a session only through the command (and says approval comes first)", async () => {
      const { api } = open(`#/agents/${SID}`, {
        ...detailRoutes(),
        ...cmd("session.stop", done(session({ state: "stopped" }))),
      });
      await screen.findByText("Running");
      expect(screen.getByText(/You are asked to approve first/)).toBeTruthy();
      const stop = screen.getByRole("button", { name: "Stop the session…" });
      doubleClick(() => fireEvent.click(stop));
      await waitFor(() =>
        expect(api.posts("/api/capabilities/agents/commands/session.stop")).toHaveLength(1),
      );
      expect(api.posts("/api/capabilities/agents/commands/session.stop")[0]?.body).toEqual({
        input: { session_id: SID },
      });
      expect(await screen.findByText("The session was stopped.")).toBeTruthy();
    });

    it("hands over context and reports how many notes were sent", async () => {
      const { api } = open(`#/agents/${SID}`, {
        ...detailRoutes(),
        ...cmd(
          "context.handoff",
          done({ sent: true, count: 2, chars: 100, item_ids: [], guard_dropped: 0 }),
        ),
      });
      await screen.findByText("Running");
      fireEvent.change(screen.getByLabelText(/Give the agent notes/), {
        target: { value: "migration plan" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Hand over notes…" }));
      await waitFor(() =>
        expect(api.posts("/api/capabilities/agents/commands/context.handoff")[0]?.body).toEqual({
          input: { session_id: SID, question: "migration plan" },
        }),
      );
      expect(await screen.findByText("Sent 2 note(s) to the agent.")).toBeTruthy();
    });
  });

  describe("ambiguous links", () => {
    const amb = link({
      id: 9,
      session_id: null,
      confidence: "ambiguous",
      candidates: [SID, OTHER],
    });

    it("offers each candidate, resolves through link.resolve, and refreshes", async () => {
      const { api } = open(`#/agents/${SID}`, {
        ...detailRoutes(detail({ ambiguous: [amb] })),
        ...cmd("link.resolve", done(link({ id: 9, confidence: "user" }))),
      });
      const section = (
        await screen.findByRole("heading", { name: /Waiting for you to choose \(1\)/ })
      ).closest("section")!;
      expect(within(section).getAllByRole("button")).toHaveLength(2);
      const pick = within(section).getByRole("button", {
        name: `Link Commit abc1234 to session ${OTHER}`,
      });
      doubleClick(() => fireEvent.click(pick));
      await waitFor(() =>
        expect(api.posts("/api/capabilities/agents/commands/link.resolve")).toHaveLength(1),
      );
      expect(api.posts("/api/capabilities/agents/commands/link.resolve")[0]?.body).toEqual({
        input: { link_id: 9, session_id: OTHER },
      });
      expect(await within(section).findByText("Link saved.")).toBeTruthy();
      await waitFor(() =>
        expect(api.posts("/api/capabilities/agents/commands/session.get").length).toBeGreaterThan(
          1,
        ),
      );
    });

    it("lists ambiguous links on the sessions page too", async () => {
      open("#/agents", listRoutes([session()], [amb]));
      expect(await screen.findByText(/more than one session fits/)).toBeTruthy();
    });
  });
});
