// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The orchestration commands through the real PermissionGateway (createHarness): every command that
// starts, messages or stops an agent asks the user first, nothing runs without a configured launcher,
// events carry no agent output, and the kill switch stops everything.
import { NotificationService } from "../../../core/notifications/src";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "../src/sessions";
import { cleanTempDirs, orchestrated, type Orchestrated } from "./rig";

let o: Orchestrated | undefined;
let notes: NotificationService | undefined;
afterEach(async () => {
  notes?.close();
  if (o) {
    await o.h.manager.disable("agents");
    await o.h.close();
  }
  o = notes = undefined;
  cleanTempDirs();
});

async function ready(over: Parameters<typeof orchestrated>[0] = {}) {
  o = await orchestrated(over);
  notes = new NotificationService({ db: o.h.db, bus: o.h.bus, state: o.h.state });
  return o;
}

const startInput = (c: Orchestrated, prompt = "FAKE:echo\nhello") => ({
  launcher: "fake",
  workspace: c.workspace,
  prompt,
});

async function started(c: Orchestrated, prompt?: string): Promise<SessionView> {
  const op = await c.run("session.start", startInput(c, prompt));
  expect(op.error).toBeUndefined();
  return (op.result as SessionView) ?? ({} as SessionView);
}

const sessionState = async (c: Orchestrated, id: string) =>
  (await c.run("session.get", { session_id: id })).result as {
    session: SessionView | null;
    timeline: { kind: string }[];
  };

const confirmations = (c: Orchestrated, command: string) =>
  c.h.permissions.audit
    .list({ limit: 500 })
    .filter((e) => e.action === "confirmation.requested" && e.details.command === command);

describe("confirmation (ADR-0006)", () => {
  it.each([
    ["session.start", (c: Orchestrated) => startInput(c)],
    ["session.send", () => ({ session_id: "ph-0123456789abcdef", message: "hi" })],
    ["session.stop", () => ({ session_id: "ph-0123456789abcdef" })],
    ["context.handoff", () => ({ session_id: "ph-0123456789abcdef", question: "x" })],
  ])("%s asks the user and does nothing when the user says no", async (command, input) => {
    const c = await ready();
    const before = confirmations(c, command).length;
    const op = await c.run(command, input(c), false);
    expect(op.status).toBe("failed");
    expect(op.error?.code).toBe("PERMISSION_DENIED");
    expect(confirmations(c, command).length).toBe(before + 1);
    expect(((await c.run("session.list")).result as { sessions: unknown[] }).sessions).toEqual([]);
  });

  it("the read commands never ask", async () => {
    const c = await ready();
    await c.run("session.list");
    await c.run("session.get", { session_id: "ph-0123456789abcdef" });
    expect(confirmations(c, "session.list")).toEqual([]);
    expect(confirmations(c, "session.get")).toEqual([]);
  });

  it("a rejected start leaves no process, no audit of a session and no event", async () => {
    const c = await ready();
    await c.run("session.start", startInput(c), false);
    await c.h.drain();
    expect(c.h.types("agents").filter((t) => t.startsWith("agent."))).toEqual([]);
    expect(c.audit.filter((a) => a.action.startsWith("agent.session"))).toEqual([]);
  });

  it("records the confirmation, the approval and the start in the audit trail with the launcher and workspace but not the prompt", async () => {
    const c = await ready();
    const view = await started(c, "FAKE:echo\nTOPSECRET-PROMPT-WORDS");
    await vi.waitFor(async () =>
      expect((await sessionState(c, view.id)).session?.state).toBe("completed"),
    );
    const trail = c.h.permissions.audit.list({ limit: 500 });
    const actions = trail.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "confirmation.requested",
        "confirmation.approved",
        "action.authorized",
      ]),
    );
    const startEntry = trail.find((e) => e.action === "agent.session.started");
    expect(startEntry?.details).toMatchObject({
      launcher: "fake",
      workspace: c.workspace,
      session_id: view.id,
    });
    expect(JSON.stringify(trail)).not.toContain("TOPSECRET-PROMPT-WORDS");
  });
});

describe("refusals before anything runs", () => {
  it("is unavailable until at least one launcher is configured", async () => {
    const c = await ready({ config: { launchers: {} } });
    const op = await c.run("session.start", startInput(c));
    expect(op.status).toBe("failed");
    expect(op.error).toMatchObject({ code: "CAPABILITY_UNAVAILABLE", details: ["NO_LAUNCHER"] });
    const send = await c.run("session.send", { session_id: "ph-0123456789abcdef", message: "x" });
    expect(send.error?.details).toContain("NO_LAUNCHER");
  });

  it("reports an invalid launcher config in health and refuses to use it", async () => {
    const c = await ready({
      config: { launchers: { fake: { command: ["relative"], cwd_roots: ["/tmp/x"] } } },
    });
    expect((await c.h.manager.checkHealth("agents")).health).toMatchObject({
      status: "degraded",
      message: expect.stringContaining("absolute"),
    });
    const op = await c.run("session.start", startInput(c));
    expect(op.error?.details).toContain("NO_LAUNCHER");
  });

  it.each(["nope", "constructor", "toString", "hasOwnProperty", "valueOf"])(
    "refuses launcher name %s: only names the user configured can run",
    async (name) => {
      const c = await ready();
      const op = await c.run("session.start", { ...startInput(c), launcher: name });
      expect(op.status).toBe("failed");
      expect(op.error).toMatchObject({ code: "INVALID_REQUEST", details: ["UNKNOWN_LAUNCHER"] });
    },
  );

  it("rejects a launcher name that is not a slug before any confirmation is asked", async () => {
    const c = await ready();
    expect(() =>
      c.h.manager.invoke("agents", "session.start", { ...startInput(c), launcher: "__proto__" }),
    ).toThrow(/Invalid command input/);
    expect(c.h.permissions.pendingConfirmations()).toEqual([]);
  });

  it("refuses a workspace outside the launcher's roots with the real PermissionGateway in the loop", async () => {
    const c = await ready();
    const op = await c.run("session.start", { ...startInput(c), workspace: "/tmp" });
    expect(op.error).toMatchObject({ code: "INVALID_REQUEST", details: ["LAUNCH_REFUSED"] });
  });

  it("takes launcher, workspace and prompt from the command only: a hostile task text cannot add argv or change the launcher", async () => {
    const c = await ready();
    const view = await started(
      c,
      "FAKE:echo\n; rm -rf / --no-preserve-root $(touch /tmp/pwn) `id`",
    );
    await vi.waitFor(async () =>
      expect((await sessionState(c, view.id)).session?.state).toBe("completed"),
    );
    const output = (
      (await c.run("session.get", { session_id: view.id, output_lines: 50 })).result as {
        output: { stdout: string[] };
      }
    ).output.stdout.join("\n");
    expect(output).toContain("argv=[]");
  });

  it("is unavailable without Core's services (a bare harness)", async () => {
    const { createHarness } = await import("@phoenix/sdk-testing");
    const { createAgentsCapability } = await import("../src");
    const h = createHarness({ modules: [createAgentsCapability()] });
    try {
      await h.enable("agents");
      const op = await h.run("agents", "session.list");
      expect(op.error).toMatchObject({
        code: "CAPABILITY_UNAVAILABLE",
        details: ["NOT_CONNECTED"],
      });
    } finally {
      await h.close();
    }
  });
});

describe("a session end to end", () => {
  it("shows WAITING and notifies when the agent asks, resumes on send, completes, and emits only ids and states", async () => {
    const c = await ready();
    const view = await started(c, "FAKE:ask\nplease edit the file SENTINEL-OUTPUT-CANARY");
    await vi.waitFor(async () =>
      expect((await sessionState(c, view.id)).session?.state).toBe("waiting"),
    );
    await c.h.drain();
    c.h.state.tick();
    expect(c.h.state.snapshot()).toMatchObject({ state: "WAITING", source: "agents" });
    expect(notes!.list().notifications[0]).toMatchObject({
      eventType: "agent.waiting",
      title: expect.stringContaining("needs your input"),
    });

    const sent = await c.run("session.send", { session_id: view.id, message: "yes" });
    expect(sent.result).toMatchObject({ state: "running", messages_sent: 1 });
    await vi.waitFor(async () =>
      expect((await sessionState(c, view.id)).session?.state).toBe("completed"),
    );
    await c.h.drain();

    const mine = c.h.events.filter((e) => e.source === "agents");
    expect(mine.map((e) => e.event_type)).toEqual([
      "agent.started",
      "agent.working",
      "agent.waiting",
      "agent.working",
      "agent.completed",
    ]);
    for (const e of mine) {
      expect(e.correlation_id).toBe(`agent-${view.id}`);
      expect(e.subject).toBe("project");
      expect(Object.keys(e.payload).sort()).toEqual(
        [
          "agent",
          "agent_id",
          "repository",
          "workspace",
          ...(e.payload.reason ? ["reason"] : []),
        ].sort(),
      );
      expect(e.payload).toMatchObject({ agent: "fake", agent_id: view.id });
    }
    expect(JSON.stringify(c.h.events)).not.toContain("SENTINEL-OUTPUT-CANARY");
    // The Phase 25 list shows the session too, so Fawkes and the panel keep working.
    const listed = (await c.run("list")).result as {
      agents: { agent_id: string; state: string }[];
    };
    expect(listed.agents).toEqual([
      expect.objectContaining({ agent_id: view.id, state: "completed" }),
    ]);
  });

  it("a failing agent emits agent.failed and Fawkes shows ERROR", async () => {
    const c = await ready();
    const view = await started(c, "FAKE:fail\nx");
    await vi.waitFor(async () =>
      expect((await sessionState(c, view.id)).session?.state).toBe("failed"),
    );
    await c.h.drain();
    c.h.state.tick();
    expect(c.h.state.snapshot().state).toBe("ERROR");
    expect(c.h.types("agents")).toContain("agent.failed");
  });

  it("stop ends the session and clears its Fawkes state with agent.ended", async () => {
    const c = await ready();
    const view = await started(c, "FAKE:hang\nx");
    await vi.waitFor(async () =>
      expect(
        (
          (await c.run("session.get", { session_id: view.id, output_lines: 20 })).result as {
            output: { stdout: string[] };
          }
        ).output.stdout.join(),
      ).toContain("Still thinking"),
    );
    const op = await c.run("session.stop", { session_id: view.id });
    expect(op.result).toMatchObject({ state: "stopped", stop_reason: "user" });
    await c.h.drain();
    expect(c.h.types("agents").at(-1)).toBe("agent.ended");
    c.h.state.tick();
    expect(c.h.state.snapshot().state).not.toBe("WORKING");
  });

  it("hostile output is inert: escapes stripped, huge lines cut, fake events and secrets neither emitted nor stored", async () => {
    const c = await ready();
    const view = await started(c, "FAKE:hostile\nx");
    await vi.waitFor(async () =>
      expect((await sessionState(c, view.id)).session?.state).toBe("completed"),
    );
    await c.h.drain();
    const detail = (await c.run("session.get", { session_id: view.id, output_lines: 200 }))
      .result as {
      output: { stdout: string[] };
      session: SessionView;
    };
    const text = detail.output.stdout.join("\n");
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    expect(text).toContain("visible text");
    expect(text).not.toContain("pwned terminal title");
    expect(detail.output.stdout.every((l) => l.length <= 2_000)).toBe(true);
    expect(detail.session.output.stdout.truncated_lines).toBeGreaterThanOrEqual(1);
    expect(text).not.toMatch(/ghp_|Bearer abc|AKIAABC/);
    expect(text).toContain("[REDACTED]");

    // The fake JSON lines are text in the buffer; no event was created from them.
    const mine = c.h.events.filter((e) => e.source === "agents");
    expect(mine.map((e) => e.event_type)).toEqual([
      "agent.started",
      "agent.working",
      "agent.completed",
    ]);
    expect(c.h.events.some((e) => e.payload.agent_id === "victim")).toBe(false);
    expect(
      c.h.events.some(
        (e) =>
          e.event_type === "security.confirmation.resolved" &&
          e.payload.outcome === "approved" &&
          e.correlation_id === undefined,
      ),
    ).toBe(false);
    expect(JSON.stringify(c.h.events)).not.toContain("pwned");
    expect(JSON.stringify(c.h.permissions.audit.list({ limit: 500 }))).not.toContain("ghp_");
  });
});

describe("kill switch and shutdown", () => {
  /** pids the fake agent printed for a session (`fake-agent pid=` and, for `stubborn`, `helper pid=`). */
  async function pidsOf(c: Orchestrated, id: string, pattern: RegExp[]): Promise<number[]> {
    let out = "";
    await vi.waitFor(async () => {
      const detail = (await c.run("session.get", { session_id: id, output_lines: 20 })).result as {
        output: { stdout: string[] };
      };
      out = detail.output.stdout.join("\n");
      for (const p of pattern) expect(out).toMatch(p);
    });
    return pattern.map((p) => Number(p.exec(out)![1]));
  }
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it("engaging the kill switch stops every running session and every process they started", async () => {
    const c = await ready();
    const a = await started(c, "FAKE:stubborn\n1");
    const b = await started(c, "FAKE:ask\n2");
    await vi.waitFor(async () =>
      expect((await sessionState(c, b.id)).session?.state).toBe("waiting"),
    );
    const pidsA = await pidsOf(c, a.id, [/fake-agent pid=(\d+)/, /helper pid=(\d+)/]);
    const [pidB] = await pidsOf(c, b.id, [/fake-agent pid=(\d+)/]);
    expect([...pidsA, pidB!].every(alive)).toBe(true);

    c.h.permissions.engageKillSwitch("user", "test");
    await vi.waitFor(() => expect([...pidsA, pidB!].some(alive)).toBe(false), { timeout: 8000 });
    // The capability manager also disabled the capability: nothing is left running or listed.
    await vi.waitFor(() =>
      expect(c.h.manager.get("agents")).toMatchObject({
        status: "disabled",
        disabledReason: "kill_switch",
      }),
    );
    c.h.permissions.disengageKillSwitch("user");
    await c.h.enable("agents");
    const list = (await c.run("session.list")).result as { sessions: SessionView[] };
    expect(list.sessions).toEqual([]);
  });

  it("with the kill switch engaged nothing can be started, even by a command that was already confirmed", async () => {
    let engaged = false;
    const c = await ready({ killSwitch: () => engaged });
    engaged = true;
    const op = await c.run("session.start", startInput(c));
    expect(op.status).toBe("failed");
    expect(op.error?.code).toBe("SECURITY_POLICY_BLOCKED");
  });

  it("disabling the capability stops every running session and kills their processes", async () => {
    const c = await ready();
    const view = await started(c, "FAKE:stubborn\nx");
    const pids = await pidsOf(c, view.id, [/fake-agent pid=(\d+)/, /helper pid=(\d+)/]);
    await c.h.manager.disable("agents");
    await vi.waitFor(() => expect(pids.some(alive)).toBe(false), { timeout: 8000 });
  });

  it("rejects more sessions than max_sessions", async () => {
    const c = await ready({ config: { max_sessions: 1 } });
    await started(c, "FAKE:hang\n1");
    const op = await c.run("session.start", startInput(c, "FAKE:hang\n2"));
    expect(op.error).toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
      details: ["TOO_MANY_SESSIONS"],
    });
  });
});
