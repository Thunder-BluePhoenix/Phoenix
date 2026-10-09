// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { NotificationService } from "../../../core/notifications/src";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentsCapability, createAgentsCapability } from "../src";

const T0 = Date.parse("2026-05-01T09:00:00Z");
const MIN = 60_000;

let h: Harness | undefined;
let notes: NotificationService | undefined;

beforeEach(() => {
  // Only Date is faked: the harness polls with real timers. Both the state engine and the
  // capability read the clock when constructed, so install the fake first.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(async () => {
  notes?.close();
  await h?.close();
  h = notes = undefined;
  vi.useRealTimers();
});

const at = (minutes: number) => vi.setSystemTime(T0 + minutes * MIN);

async function ready(config: Record<string, unknown> = {}) {
  h = createHarness({ modules: [createAgentsCapability({ now: () => Date.now() })] });
  notes = new NotificationService({ db: h.db, bus: h.bus, state: h.state });
  if (Object.keys(config).length > 0) h.manager.configure("agents", config);
  await h.enable("agents");
  return h;
}

const session = { agent: "claude-code", agent_id: "s-1", workspace: "/home/me/projects/phoenix" };
async function report(input: Record<string, unknown>) {
  const op = await h!.run("agents", "report", { ...session, ...input });
  return op;
}
const fawkes = () => {
  h!.state.tick();
  return h!.state.snapshot();
};
const listed = async () =>
  ((await h!.run("agents", "list")).result as { agents: { agent_id: string; state: string }[] })
    .agents;

describe("manifest", () => {
  it("keeps the observe-only commands free of permissions and side effects (Phase 25 contract)", () => {
    const m = agentsCapability.manifest;
    const byName = Object.fromEntries(m.commands.map((c) => [c.name, c]));
    expect([byName.report?.side_effect, byName.report?.permissions ?? []]).toEqual(["none", []]);
    expect([byName.list?.side_effect, byName.list?.permissions ?? []]).toEqual(["read", []]);
  });

  it("declares every command that starts, messages or stops an agent as side effect execute with shell_command (Phase 34)", () => {
    const m = agentsCapability.manifest;
    const execute = m.commands.filter((c) => c.side_effect === "execute").map((c) => c.name);
    expect(execute.sort()).toEqual([
      "context.handoff",
      "session.send",
      "session.start",
      "session.stop",
    ]);
    for (const c of m.commands.filter((c) => c.side_effect === "execute")) {
      expect(c.permissions).toEqual(["shell_command"]);
    }
    expect(m.commands.filter((c) => c.side_effect === "none").map((c) => c.name)).toEqual([
      "report",
    ]);
  });
});

describe("waiting for input (Phase 25 exit criterion)", () => {
  it("shows WAITING with the agent and repository, and raises an 'input required' notification", async () => {
    await ready();
    await report({ state: "working" });
    expect(fawkes()).toMatchObject({ state: "WORKING" });

    const op = await report({ state: "waiting", reason: "permission" });
    expect(op.status).toBe("succeeded");

    expect(fawkes()).toMatchObject({
      state: "WAITING",
      explanation: "claude-code needs your input (phoenix)",
      source: "agents",
    });
    const { notifications, unread } = notes!.list();
    expect(unread).toBe(1);
    expect(notifications[0]).toMatchObject({
      eventType: "agent.waiting",
      source: "agents",
      title: "claude-code needs your input (phoenix)",
    });
    const event = h!.events.find((e) => e.event_type === "agent.waiting")!;
    expect(event).toMatchObject({
      source: "agents",
      requires_action: true,
      correlation_id: "agent-s-1",
      subject: "phoenix",
      payload: { agent: "claude-code", repository: "phoenix", reason: "permission" },
    });
  });

  it("resuming work (you answered) replaces WAITING with WORKING", async () => {
    await ready();
    await report({ state: "waiting", reason: "input" });
    expect(fawkes().state).toBe("WAITING");
    await report({ state: "working" });
    expect(fawkes().state).toBe("WORKING");
  });

  it("an idle prompt is listed as waiting but neither raises WAITING nor notifies", async () => {
    await ready();
    await report({ state: "completed" });
    at(1);
    await report({ state: "waiting", reason: "idle" });
    expect(fawkes().state).not.toBe("WAITING");
    expect(notes!.list().unread).toBe(0);
    expect(await listed()).toMatchObject([{ agent_id: "s-1", state: "waiting" }]);
  });
});

describe("lifecycle", () => {
  it("completed shows SUCCESS, then settles to IDLE", async () => {
    await ready();
    await report({ state: "working" });
    await report({ state: "completed" });
    expect(fawkes()).toMatchObject({
      state: "SUCCESS",
      explanation: "claude-code finished (phoenix)",
    });
    at(0.1);
    expect(fawkes().state).toBe("IDLE");
  });

  it("failed shows ERROR with the agent name", async () => {
    await ready();
    await report({ agent: "codex", agent_id: "c-1", state: "failed" });
    expect(fawkes()).toMatchObject({ state: "ERROR", explanation: "codex failed (phoenix)" });
  });

  it("started lists the session without changing Fawkes", async () => {
    await ready();
    await report({ state: "started" });
    expect(fawkes().state).toBe("IDLE");
    expect(await listed()).toMatchObject([{ state: "started" }]);
  });

  it("ended removes the session and clears its state", async () => {
    await ready();
    await report({ state: "waiting", reason: "input" });
    await report({ state: "ended" });
    expect(fawkes().state).toBe("IDLE");
    expect(await listed()).toEqual([]);
  });

  it("two sessions are tracked independently", async () => {
    await ready();
    await report({ agent_id: "a", state: "waiting", reason: "input" });
    await report({ agent_id: "b", workspace: "/home/me/other", state: "working" });
    await report({ agent_id: "b", workspace: "/home/me/other", state: "completed" });
    expect(fawkes()).toMatchObject({ state: "WAITING" });
    expect((await listed()).map((a) => a.agent_id).sort()).toEqual(["a", "b"]);
  });

  it("repeated working reports keep a long run alive without flooding the history", async () => {
    await ready();
    await report({ state: "working" });
    for (let minute = 50; minute <= 150; minute += 50) {
      at(minute);
      await report({ state: "working" });
    }
    // 150 minutes in, far past the 60-minute stall timeout, but the agent kept reporting.
    expect(fawkes().state).toBe("WORKING");
    expect(h!.types("agents").filter((t) => t === "agent.working")).toHaveLength(1);
  });

  it("a working agent that goes quiet becomes a 'No progress' warning", async () => {
    await ready({ silent_after_min: 1_000 });
    await report({ state: "working" });
    at(61);
    expect(fawkes()).toMatchObject({ state: "WARNING" });
    expect(fawkes().explanation).toMatch(/^No progress: claude-code is working/);
  });
});

describe("active agents list", () => {
  it("reports agent, workspace, repository, state and since", async () => {
    await ready();
    await report({ state: "working" });
    at(5);
    await report({ state: "waiting", reason: "permission" });
    const [only] = ((await h!.run("agents", "list")).result as { agents: object[] }).agents;
    expect(only).toEqual({
      agent: "claude-code",
      agent_id: "s-1",
      workspace: "/home/me/projects/phoenix",
      repository: "phoenix",
      state: "waiting",
      reason: "permission",
      since: new Date(T0 + 5 * MIN).toISOString(),
      updated_at: new Date(T0 + 5 * MIN).toISOString(),
    });
  });

  it("keeps 'since' while the state stays the same", async () => {
    await ready();
    await report({ state: "working" });
    at(10);
    await report({ state: "working" });
    const [only] = ((await h!.run("agents", "list")).result as { agents: { since: string }[] })
      .agents;
    expect(only!.since).toBe(new Date(T0).toISOString());
  });

  it("drops a silent session after silent_after_min and clears its Fawkes state", async () => {
    await ready({ silent_after_min: 30 });
    await report({ state: "waiting", reason: "input" });
    at(29);
    expect(await listed()).toHaveLength(1);
    expect(fawkes().state).toBe("WAITING");
    at(31);
    expect(await listed()).toEqual([]);
    expect(fawkes().state).toBe("IDLE");
    const ended = h!.events.find((e) => e.event_type === "agent.ended")!;
    expect(ended.payload).toMatchObject({ agent: "claude-code", expired: true });
  });

  it("a report from a session that was dropped starts it again", async () => {
    await ready({ silent_after_min: 30 });
    await report({ state: "working" });
    at(40);
    await report({ state: "working" });
    expect(await listed()).toHaveLength(1);
  });

  it("is bounded: the least recently heard session is dropped past 200", async () => {
    await ready();
    for (let i = 0; i < 201; i++) {
      at(i / 10);
      await report({ agent_id: `s-${i}`, state: "started" });
    }
    const ids = (await listed()).map((a) => a.agent_id);
    expect(ids).toHaveLength(200);
    expect(ids).not.toContain("s-0");
    expect(ids).toContain("s-200");
  });
});

describe("prompt titles", () => {
  it("are dropped by default", async () => {
    await ready();
    await report({ state: "working", task: "Rewrite the billing module" });
    expect(h!.events.find((e) => e.event_type === "agent.working")!.payload).not.toHaveProperty(
      "task",
    );
  });

  it("with include_prompt_title they are normalised and kept for later reports", async () => {
    await ready({ include_prompt_title: true });
    await report({ state: "working", task: "  deploy   the    app " });
    await report({ state: "waiting", reason: "input" });
    const waiting = h!.events.find((e) => e.event_type === "agent.waiting")!;
    expect(waiting.payload.task).toBe("deploy the app");
    expect((await listed())[0]).toMatchObject({ state: "waiting" });
  });

  it("a restarted session does not inherit the previous task", async () => {
    await ready({ include_prompt_title: true });
    await report({ state: "working", task: "old task" });
    await report({ state: "started" });
    expect(
      h!.events.filter((e) => e.event_type === "agent.started")[0]!.payload,
    ).not.toHaveProperty("task");
  });
});

describe("hostile reports", () => {
  it.each([
    ["relative workspace", { workspace: "relative/dir" }],
    ["control characters", { workspace: "/home/me/\u001b]0;pwned\u0007" }],
    ["unknown state", { state: "controlling" }],
    ["unknown field (no way to pass commands)", { command: "rm -rf /" }],
    ["oversized task", { task: "x".repeat(121) }],
    [
      "secret in a field (Core refuses it before the capability sees it)",
      { task: "Bearer abcdefghijklmnop" },
    ],
    ["reason on the wrong state", { state: "working", reason: "input" }],
  ])("rejects %s without emitting anything", async (_name, patch) => {
    await ready();
    // Core's schema check throws up front; the capability's own validator fails the operation.
    const outcome = await report({ state: "working", ...patch }).then(
      (op) => op.status,
      () => "refused",
    );
    expect(["failed", "refused"]).toContain(outcome);
    expect(h!.types("agents")).toEqual([]);
    expect(await listed()).toEqual([]);
  });

  it("disabled capability accepts nothing", async () => {
    await ready();
    await h!.manager.disable("agents");
    await expect(report({ state: "working" })).rejects.toThrow();
    expect(h!.types("agents")).toEqual([]);
  });
});
