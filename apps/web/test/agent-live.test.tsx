// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LiveDiff,
  LiveFileOf,
  LiveSessionDetail,
  LiveSessionView,
  LiveStepOf,
  UsageView,
} from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { capability, expectInert, openAt, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

const LIVE = "7f3a9c1e-1111-4222-8333-944455556666";
const PH = "ph-0123456789abcdef";
const AT = "2026-10-09T12:00:00Z";

const view = (over: Partial<LiveSessionView> = {}): LiveSessionView => ({
  id: LIVE,
  agent: "claude-code",
  project: "/work/phoenix",
  repository: "phoenix",
  first_seen: AT,
  last_seen: AT,
  active: true,
  step_count: 0,
  dropped_steps: 0,
  has_terminal: true,
  ...over,
});

const step = (n: number, over: Partial<LiveStepOf> = {}): LiveStepOf => ({
  session_id: LIVE,
  n,
  at: `2026-10-09T12:00:${String(n % 60).padStart(2, "0")}Z`,
  kind: "read",
  tool: "Read",
  target: `src/file-${n}.ts`,
  ...over,
});

const file = (path: string, over: Partial<LiveFileOf> = {}): LiveFileOf => ({
  session_id: LIVE,
  path,
  added: 3,
  removed: 1,
  edits: 2,
  last_at: AT,
  ...over,
});

const detail = (over: Partial<LiveSessionDetail> = {}): LiveSessionDetail => ({
  id: LIVE,
  matched_by: "id",
  sessions: [view()],
  steps: [step(1), step(2, { kind: "edit", tool: "Edit", target: "src/a.ts" })],
  files: [file("src/a.ts")],
  dropped_steps: 0,
  ...over,
});

const usage = (over: Partial<UsageView> = {}): UsageView => ({
  agent: "claude-code",
  window: "5h",
  used_pct: 82,
  resets_at: new Date(Date.now() + (2 * 60 + 10) * 60_000).toISOString(),
  observed_at: new Date().toISOString(),
  level: "ok",
  stale: false,
  ...over,
});

const diffOf = (over: Partial<LiveDiff> = {}): LiveDiff => ({
  session_id: LIVE,
  path: "src/a.ts",
  diff: "@@ -1 +1 @@\n-old\n+new",
  truncated: false,
  source: "git diff HEAD",
  commits: [],
  ci_runs: [],
  ...over,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Opens the live page for `id`; `routes` extend the fake Core. */
function openLive(id: string, routes: Record<string, () => unknown> = {}) {
  return openAt(`#/agents/${encodeURIComponent(id)}`, {
    [`GET /api/agent/sessions/${id}`]: () => detail(),
    ...routes,
  });
}

/** An ephemeral event: seq is null, as Core sends it. */
function pushEvent(
  ws: FakeWebSocket,
  event_type: string,
  payload: Record<string, unknown>,
  source = "core",
) {
  act(() =>
    ws.message("event.created", {
      seq: null,
      event: {
        event_id: `evt_${event_type}`,
        event_type,
        source,
        severity: "info",
        timestamp: AT,
        payload,
      },
    }),
  );
}

const pushStep = (ws: FakeWebSocket, s: LiveStepOf, extra: Record<string, unknown> = {}) =>
  pushEvent(ws, "agent.session.step", {
    agent: "claude-code",
    session_id: s.session_id,
    project: "/work/phoenix",
    n: s.n,
    kind: s.kind,
    tool: s.tool,
    target: s.target,
    at: s.at,
    ...extra,
  });

/** Lets any reload an event might have started reach the fake API (promise ticks only). */
async function flushPromises() {
  for (let i = 0; i < 10; i++) await act(async () => {});
}

const getsOf = (api: { calls: { method: string; path: string }[] }, path: string) =>
  api.calls.filter((c) => c.method === "GET" && c.path === path).length;

const logRows = () => within(screen.getByRole("log", { name: "Steps" })).getAllByRole("listitem");

describe("Live session page: steps", () => {
  it("works without the agents capability and shows the steps oldest first, newest last", async () => {
    openLive(LIVE, {
      "GET /api/capabilities": () => ({ capabilities: [capability("agents", "disabled")] }),
    });
    expect(await screen.findByRole("heading", { name: `Live session ${LIVE}` })).toBeTruthy();
    expect(screen.getByRole("link", { name: /All sessions/ }).getAttribute("href")).toBe(
      "#/agents",
    );
    const log = await screen.findByRole("log", { name: "Steps" });
    expect(log.getAttribute("aria-live")).toBe("off");
    expect(log.getAttribute("tabindex")).toBe("0");
    const rows = logRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Read");
    expect(rows[0]!.textContent).toContain("src/file-1.ts");
    expect(rows[1]!.textContent).toContain("Edit");
    expect(rows[1]!.querySelector("code")?.textContent).toBe("src/a.ts");
  });

  it("appends a pushed step last without fetching again", async () => {
    const { api, ws } = openLive(LIVE);
    await screen.findByRole("log", { name: "Steps" });
    const before = getsOf(api, `/api/agent/sessions/${LIVE}`);
    expect(before).toBe(1);

    pushStep(ws, step(3, { kind: "run", tool: "Bash", target: "pnpm test" }));
    await waitFor(() => expect(logRows()).toHaveLength(3));
    const last = logRows().at(-1)!;
    expect(last.textContent).toContain("Run");
    expect(last.textContent).toContain("Bash");
    expect(last.querySelector("code")?.textContent).toBe("pnpm test");
    expect(getsOf(api, `/api/agent/sessions/${LIVE}`)).toBe(before);
  });

  it("ignores an agent.session.step that does not come from core", async () => {
    const { api, ws } = openLive(LIVE);
    await screen.findByRole("log", { name: "Steps" });
    pushEvent(
      ws,
      "agent.session.step",
      {
        agent: "claude-code",
        session_id: LIVE,
        project: "/p",
        n: 3,
        kind: "run",
        tool: "Bash",
        target: "forged",
        at: AT,
      },
      "terminal",
    );
    pushEvent(
      ws,
      "agent.session.step",
      {
        agent: "claude-code",
        session_id: "someone-else",
        project: "/p",
        n: 1,
        kind: "run",
        tool: "Bash",
        target: "x",
        at: AT,
      },
      "terminal",
    );
    await flushPromises();
    expect(logRows()).toHaveLength(2);
    expect(screen.queryByText("forged")).toBeNull();
    expect(getsOf(api, `/api/agent/sessions/${LIVE}`)).toBe(1);
  });

  it("does not duplicate a step that arrives twice", async () => {
    const { ws } = openLive(LIVE);
    await screen.findByRole("log", { name: "Steps" });
    pushStep(ws, step(3));
    pushStep(ws, step(3));
    pushStep(ws, step(2));
    await waitFor(() => expect(logRows()).toHaveLength(3));
    expect(screen.getAllByText("src/file-3.ts")).toHaveLength(1);
  });

  it("shows only the last 100 steps and keeps 500 at most", async () => {
    const steps = Array.from({ length: 500 }, (_, i) => step(i + 1));
    const { ws } = openLive(LIVE, {
      [`GET /api/agent/sessions/${LIVE}`]: () => detail({ steps, files: [] }),
    });
    await screen.findByRole("log", { name: "Steps" });
    expect(logRows()).toHaveLength(100);
    expect(screen.getByText("Showing the last 100 of 500 steps.")).toBeTruthy();
    expect(logRows()[0]!.textContent).toContain("src/file-401.ts");

    pushStep(ws, step(501));
    await waitFor(() => expect(logRows().at(-1)!.textContent).toContain("src/file-501.ts"));
    expect(logRows()).toHaveLength(100);
    // 501 pushed onto 500 kept: the oldest one is gone, and the page says earlier steps are not kept.
    expect(screen.getByText("Showing the last 100 of 500 steps.")).toBeTruthy();
    expect(screen.getByText(/1 earlier step\(s\) are not kept/)).toBeTruthy();
  });

  it("says so when Core dropped steps", async () => {
    openLive(LIVE, {
      [`GET /api/agent/sessions/${LIVE}`]: () => detail({ dropped_steps: 12 }),
    });
    expect(await screen.findByText(/12 earlier step\(s\) are not kept/)).toBeTruthy();
  });

  it("shows an empty state instead of an error when nothing was seen", async () => {
    openLive(LIVE, {
      [`GET /api/agent/sessions/${LIVE}`]: () =>
        detail({ sessions: [], steps: [], files: [], matched_by: "id" }),
    });
    expect(await screen.findByText(/No live session matches this id/)).toBeTruthy();
    expect(screen.getByText(/No live agent session has been seen/)).toBeTruthy();
    expect(screen.getByText("No file change has been seen yet.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an unknown live id is an alert, not a crash", async () => {
    openLive(LIVE, {
      [`GET /api/agent/sessions/${LIVE}`]: () =>
        json({ code: "RESOURCE_NOT_FOUND", message: "No such live session" }, 404),
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No such live session");
    expect(screen.queryByRole("log")).toBeNull();
  });

  it("renders step text from the agent as inert text", async () => {
    const { container } = openLive(LIVE, {
      [`GET /api/agent/sessions/${LIVE}`]: () =>
        detail({ steps: [step(1, { target: XSS, tool: "Bash" })], files: [] }),
    });
    await screen.findByRole("log", { name: "Steps" });
    expectInert(container);
  });

  it("refetches once for a session it does not know yet, and again when the socket returns", async () => {
    const other = view({ id: "other-session" });
    let known = [view()];
    let steps = [step(1)];
    const { api, ws } = openLive(LIVE, {
      [`GET /api/agent/sessions/${LIVE}`]: () =>
        detail({ matched_by: "folder+time", sessions: known, steps, files: [] }),
    });
    await screen.findByRole("log", { name: "Steps" });
    expect(getsOf(api, `/api/agent/sessions/${LIVE}`)).toBe(1);

    known = [view(), other];
    steps = [step(1), step(1, { session_id: "other-session", target: "src/other.ts" })];
    pushStep(ws, steps[1]!);
    expect(await screen.findByText("src/other.ts")).toBeTruthy();
    expect(getsOf(api, `/api/agent/sessions/${LIVE}`)).toBe(2);
    // A second step of the now-known session is appended in place.
    pushStep(ws, step(2, { session_id: "other-session", target: "src/more.ts" }));
    expect(await screen.findByText("src/more.ts")).toBeTruthy();
    expect(getsOf(api, `/api/agent/sessions/${LIVE}`)).toBe(2);

    // A dropped socket that comes back may have missed steps: load once more.
    vi.useFakeTimers();
    try {
      act(() => ws.drop());
      act(() => {
        vi.advanceTimersByTime(500);
      });
    } finally {
      vi.useRealTimers();
    }
    act(() => FakeWebSocket.last.open());
    await waitFor(() => expect(getsOf(api, `/api/agent/sessions/${LIVE}`)).toBe(3));
  });
});

describe("Live session page: files and diff", () => {
  it("lists files with +N −M counts and updates them from step events", async () => {
    const { ws } = openLive(LIVE);
    const list = await screen.findByRole("list", { name: "Files changed" });
    const counts = within(list).getByLabelText("3 lines added, 1 removed");
    expect(counts.textContent).toBe("+3 −1");
    expect(counts.textContent).toContain("\u2212");

    pushStep(ws, step(3, { kind: "edit", tool: "Edit", target: "src/a.ts" }), {
      file: { path: "src/a.ts", added: 7, removed: 2, edits: 3 },
    });
    pushStep(ws, step(4, { kind: "edit", tool: "Write", target: "src/b.ts" }), {
      file: { path: "src/b.ts", added: 1, removed: 0, edits: 1 },
    });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    const rows = within(list).getAllByRole("listitem");
    // Newest first, and the old entry for src/a.ts was replaced, not added.
    expect(rows[0]!.textContent).toContain("src/b.ts");
    expect(rows[0]!.textContent).toContain("+1 −0");
    expect(rows[1]!.textContent).toContain("src/a.ts");
    expect(rows[1]!.textContent).toContain("+7 −2");
    expect(within(rows[0]!).getByLabelText("1 line added, 0 removed")).toBeTruthy();
  });

  it("opens a diff from the encoded URL, as inert text, with truncation and links", async () => {
    const path = "src/a b/ü.ts";
    const { api, container } = openLive(LIVE, {
      [`GET /api/agent/sessions/${LIVE}`]: () => detail({ files: [file(path)] }),
      [`GET /api/agent/sessions/${LIVE}/diff/${path}`]: () =>
        diffOf({
          path,
          diff: `@@ -1 +1 @@\n-x\n+${XSS}`,
          truncated: true,
          commits: [{ ref: "abc1234", repo: "phoenix", confidence: "time+path", created_at: AT }],
          ci_runs: [
            {
              ref: "run-9",
              repo: "phoenix",
              confidence: "time+path",
              created_at: AT,
              conclusion: "success",
            },
          ],
        }),
    });
    fireEvent.click(await screen.findByRole("button", { name: `Open diff of ${path}` }));

    const pre = await screen.findByLabelText(`Diff of ${path} (plain text, scrolls)`);
    expect(pre.tagName).toBe("PRE");
    expect(pre.getAttribute("tabindex")).toBe("0");
    expectInert(container);
    expect(
      api.calls.some(
        (c) =>
          c.method === "GET" &&
          c.path === `/api/agent/sessions/${LIVE}/diff/${encodeURIComponent(path)}`,
      ),
    ).toBe(true);
    expect(screen.getByText(/truncated/)).toBeTruthy();
    const where = screen.getByRole("list", { name: "Where this file appeared" });
    expect(where.textContent).toContain("Appeared in commit abc1234 in phoenix");
    expect(where.textContent).toContain("Appeared in CI run run-9 in phoenix (success)");
    expect(screen.getByText(/do not prove the agent made them/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByLabelText(`Diff of ${path} (plain text, scrolls)`)).toBeNull();
  });

  it("shows Core's message when the diff cannot be read", async () => {
    openLive(LIVE, {
      [`GET /api/agent/sessions/${LIVE}/diff/src/a.ts`]: () =>
        json({ code: "VALIDATION_FAILED", message: "That path is outside the project" }, 400),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Open diff of src/a.ts" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("That path is outside the project");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});

describe("Live session page: actions", () => {
  it("jumps to the terminal after approval, saying what it waits for", async () => {
    const gate = Promise.withResolvers<unknown>();
    const { api } = openLive(LIVE, {
      [`POST /api/agent/sessions/${LIVE}/focus-terminal`]: () => gate.promise,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Jump to terminal" }));
    expect(await screen.findByText("Waiting for your approval below.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Jump to terminal" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(api.posts(`/api/agent/sessions/${LIVE}/focus-terminal`)).toHaveLength(1);

    await act(async () => gate.resolve({ focused: true, method: "osascript" }));
    expect(await screen.findByText("Terminal window brought to the front.")).toBeTruthy();
    expect(screen.queryByText("Waiting for your approval below.")).toBeNull();
    expect(screen.getByRole("button", { name: "Jump to terminal" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("shows why the jump failed in an alert", async () => {
    openLive(LIVE, {
      [`POST /api/agent/sessions/${LIVE}/focus-terminal`]: () =>
        json({ code: "PERMISSION_DENIED", message: "You declined" }, 403),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Jump to terminal" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("You declined");
    expect(screen.queryByText("Terminal window brought to the front.")).toBeNull();
  });

  it("exports Markdown through a Blob download and revokes the URL", async () => {
    const markdown = `# Session\n\n- ran \`pnpm test\`\n- ${XSS}\n`;
    const blobs: Blob[] = [];
    const create = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:fake-export";
    });
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const downloads: { name: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ name: this.download, href: this.href });
    });
    const { api } = openLive(LIVE, {
      [`GET /api/agent/sessions/${LIVE}/export.md`]: () =>
        new Response(markdown, { status: 200, headers: { "content-type": "text/markdown" } }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Export Markdown" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:fake-export"));
    expect(
      api.calls.filter((c) => c.path === `/api/agent/sessions/${LIVE}/export.md`),
    ).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await blobs[0]!.text()).toBe(markdown);
    expect(downloads).toEqual([{ name: `session-${LIVE}.md`, href: "blob:fake-export" }]);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(await screen.findByText(/Markdown file was saved/)).toBeTruthy();
  });

  it("shows an export failure in an alert", async () => {
    const create = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    openLive(LIVE, {
      [`GET /api/agent/sessions/${LIVE}/export.md`]: () =>
        json({ code: "RESOURCE_NOT_FOUND", message: "Nothing to export" }, 404),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Export Markdown" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Nothing to export");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("Plan usage", () => {
  const usageRoute = (
    list: UsageView[],
    unsupported: { agent: string; reason: string }[] = [],
  ) => ({
    "GET /api/agent/usage": () => ({ usage: list, thresholds: [80, 95], unsupported }),
  });

  it("renders a labelled meter with the used share and the time to reset", async () => {
    openLive(LIVE, usageRoute([usage()]));
    const meter = await screen.findByRole("meter", { name: "Claude Code 5-hour plan usage" });
    expect(meter.getAttribute("aria-valuemin")).toBe("0");
    expect(meter.getAttribute("aria-valuemax")).toBe("100");
    expect(meter.getAttribute("aria-valuenow")).toBe("82");
    expect(screen.getByText(/82% of the 5-hour window used · resets in 2h 10m/)).toBeTruthy();
    expect(screen.queryByText("Approaching the limit")).toBeNull();
  });

  it("says warn and critical in words, shows stale, free resets and unsupported agents", async () => {
    openLive(
      LIVE,
      usageRoute(
        [
          usage({ level: "warn", used_pct: 85 }),
          usage({
            window: "weekly",
            level: "critical",
            used_pct: 97,
            stale: true,
            reset_credits: 2,
          }),
        ],
        [{ agent: "codex", reason: "Codex does not report plan usage" }],
      ),
    );
    expect(await screen.findByText("Approaching the limit")).toBeTruthy();
    expect(screen.getByText("Almost at the limit")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Claude Code weekly plan usage" })).toBeTruthy();
    expect(screen.getByText(/may be out of date/)).toBeTruthy();
    expect(screen.getByText("2 free resets left")).toBeTruthy();
    expect(screen.getByText("codex: Codex does not report plan usage")).toBeTruthy();
    expect(document.querySelectorAll(".usage-warn, .usage-critical")).toHaveLength(2);
  });

  it("updates from agent.usage.updated without a reload of the page", async () => {
    let current = [usage({ used_pct: 40 })];
    const { api, ws } = openLive(LIVE, {
      "GET /api/agent/usage": () => ({ usage: current, thresholds: [80, 95], unsupported: [] }),
    });
    expect(
      (await screen.findByRole("meter", { name: "Claude Code 5-hour plan usage" })).getAttribute(
        "aria-valuenow",
      ),
    ).toBe("40");

    current = [usage({ used_pct: 96, level: "critical" })];
    pushEvent(ws, "agent.usage.updated", {
      agent: "claude-code",
      window: "5h",
      used_pct: 96,
      resets_at: AT,
    });
    await waitFor(() =>
      expect(
        screen
          .getByRole("meter", { name: "Claude Code 5-hour plan usage" })
          .getAttribute("aria-valuenow"),
      ).toBe("96"),
    );
    expect(screen.getByText("Almost at the limit")).toBeTruthy();
    expect(getsOf(api, `/api/agent/sessions/${LIVE}`)).toBe(1);
  });

  it("ignores an agent.usage.updated that does not come from core", async () => {
    let current = [usage({ used_pct: 40 })];
    const { api, ws } = openLive(LIVE, {
      "GET /api/agent/usage": () => ({ usage: current, thresholds: [80, 95], unsupported: [] }),
    });
    await screen.findByRole("meter", { name: "Claude Code 5-hour plan usage" });
    const before = getsOf(api, "/api/agent/usage");
    current = [usage({ used_pct: 96, level: "critical" })];
    pushEvent(
      ws,
      "agent.usage.updated",
      { agent: "claude-code", window: "5h", used_pct: 96, resets_at: AT },
      "terminal",
    );
    await flushPromises();
    expect(getsOf(api, "/api/agent/usage")).toBe(before);
    expect(
      screen
        .getByRole("meter", { name: "Claude Code 5-hour plan usage" })
        .getAttribute("aria-valuenow"),
    ).toBe("40");
  });

  it("ignores an agent.usage.warning that does not come from core, and reacts to one from core", async () => {
    let current = [usage({ used_pct: 40 })];
    const { api, ws } = openLive(LIVE, {
      "GET /api/agent/usage": () => ({ usage: current, thresholds: [80, 95], unsupported: [] }),
    });
    await screen.findByRole("meter", { name: "Claude Code 5-hour plan usage" });
    const before = getsOf(api, "/api/agent/usage");
    current = [usage({ used_pct: 96, level: "critical" })];
    const warning = { agent: "claude-code", window: "5h", threshold: 95, used_pct: 96 };
    pushEvent(ws, "agent.usage.warning", warning, "terminal");
    await flushPromises();
    expect(getsOf(api, "/api/agent/usage")).toBe(before);
    pushEvent(ws, "agent.usage.warning", warning);
    await waitFor(() => expect(getsOf(api, "/api/agent/usage")).toBeGreaterThan(before));
  });

  it("is silent when Core has no usage route", async () => {
    openLive(LIVE, {
      "GET /api/agent/usage": () => json({ code: "RESOURCE_NOT_FOUND", message: "Not found" }, 404),
    });
    await screen.findByRole("log", { name: "Steps" });
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Sessions list and orchestrated page", () => {
  it("lists live sessions with links to their page, and hides the section when empty", async () => {
    openAt("#/agents", {
      "GET /api/agent/sessions": () => ({
        sessions: [view(), view({ id: "a/b c", agent: "codex", active: false })],
      }),
    });
    const list = await screen.findByRole("list", { name: "Live sessions" });
    const links = within(list).getAllByRole("link");
    expect(links[0]!.getAttribute("href")).toBe(`#/agents/${encodeURIComponent(LIVE)}`);
    expect(links[1]!.getAttribute("href")).toBe("#/agents/a%2Fb%20c");
    expect(screen.getByRole("heading", { name: "Live sessions" })).toBeTruthy();
  });

  it("shows no live section for an empty list or an error", async () => {
    openAt("#/agents");
    await screen.findByRole("heading", { name: "Coding agents" });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Live sessions" })).toBeNull(),
    );
    cleanup();
    FakeWebSocket.reset();
    openAt("#/agents", {
      "GET /api/agent/sessions": () => json({ code: "INTERNAL", message: "broken" }, 500),
    });
    await screen.findByRole("heading", { name: "Coding agents" });
    expect(screen.queryByRole("heading", { name: "Live sessions" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("merges live steps into the timeline of a Phoenix-started session, by time", async () => {
    const orchestrated = {
      session: null,
      links: [],
      ambiguous: [],
      timeline: [
        { at: "2026-10-09T12:00:00Z", kind: "session.started" },
        { at: "2026-10-09T12:05:00Z", kind: "session.stopped" },
      ],
    };
    const steps = [
      step(1, { at: "2026-10-09T12:01:00Z", kind: "edit", target: "src/a.ts" }),
      step(2, { at: "2026-10-09T12:02:00Z", kind: "run", target: "pnpm test" }),
    ];
    const { api } = openAt(`#/agents/${PH}`, {
      "GET /api/capabilities": () => ({ capabilities: [capability("agents", "enabled")] }),
      "POST /api/capabilities/agents/commands/launcher.list": () => ({ id: "op-l" }),
      "GET /api/operations/op-l": () => ({ status: "succeeded", result: { launchers: {} } }),
      "POST /api/capabilities/agents/commands/session.get": () => ({ id: "op-g" }),
      "GET /api/operations/op-g": () => ({ status: "succeeded", result: orchestrated }),
      [`GET /api/agent/sessions/${PH}`]: () =>
        detail({ id: PH, matched_by: "folder+time", steps, files: [file("src/a.ts")] }),
    });
    const timeline = await screen.findByRole("list", { name: "Timeline" });
    await waitFor(() => expect(within(timeline).getAllByRole("listitem")).toHaveLength(4));
    const kinds = within(timeline)
      .getAllByRole("listitem")
      .map((li) => /(session\.\w+|step\.\w+)/.exec(li.textContent ?? "")?.[1]);
    expect(kinds).toEqual(["session.started", "step.edit", "step.run", "session.stopped"]);
    // The live sections sit under the timeline of the same page.
    expect(screen.getByRole("log", { name: "Steps" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Files changed" })).toBeTruthy();
    expect(api.calls.some((c) => c.path === `/api/agent/sessions/${PH}`)).toBe(true);
  });

  it("limits the live rows merged into the timeline to the last 50", async () => {
    const steps = Array.from({ length: 80 }, (_, i) =>
      step(i + 1, {
        at: `2026-10-09T12:${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`,
      }),
    );
    openAt(`#/agents/${PH}`, {
      "GET /api/capabilities": () => ({ capabilities: [capability("agents", "enabled")] }),
      "POST /api/capabilities/agents/commands/launcher.list": () => ({ id: "op-l" }),
      "GET /api/operations/op-l": () => ({ status: "succeeded", result: { launchers: {} } }),
      "POST /api/capabilities/agents/commands/session.get": () => ({ id: "op-g" }),
      "GET /api/operations/op-g": () => ({
        status: "succeeded",
        result: {
          session: null,
          links: [],
          ambiguous: [],
          timeline: [{ at: AT, kind: "session.started" }],
        },
      }),
      [`GET /api/agent/sessions/${PH}`]: () =>
        detail({ id: PH, matched_by: "folder+time", steps, files: [] }),
    });
    const timeline = await screen.findByRole("list", { name: "Timeline" });
    await waitFor(() => expect(within(timeline).getAllByRole("listitem")).toHaveLength(51));
  });
});
