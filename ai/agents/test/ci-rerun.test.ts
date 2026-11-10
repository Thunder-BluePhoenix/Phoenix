// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The CI re-run agent (Phase 31): approve -> execute -> verify through the REAL permission gateway,
// tool gateway and github capability, with the write sent to a FAKE fetch standing in for
// api.github.com (reads go to the local mock). No real repository, token or network was used.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCiRerunAgent, parseCiRerunTaskInput, CI_RERUN_KIND } from "../src";
import { makeRig, REPO, RUN_ID, type Rig } from "./rig";

const CI_TOKEN = ["gh", "p_", "AGENTCIWRITEAGENTCIWRITE0123456789"].join("");
const realFetch = globalThis.fetch;

interface Posted {
  url: string;
  authorization: string | undefined;
}
let posted: Posted[] = [];
let rig: Rig | undefined;

function stubGithubWrite(status = 201) {
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      // Only the write is recorded; the capability's own read-back of the run is answered empty.
      if (new URL(url).origin === "https://api.github.com") {
        if (init?.method !== "POST") return new Response("{}", { status: 200 });
        const headers = (init?.headers ?? {}) as Record<string, string>;
        posted.push({ url, authorization: headers.authorization });
        return new Response(status === 201 ? "" : `{"message":"${CI_TOKEN}"}`, { status });
      }
      return realFetch(input, init);
    }),
  );
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await rig?.close();
  rig = undefined;
});

async function start(secret: string | null = CI_TOKEN) {
  rig = await makeRig({ withRerun: true });
  if (secret) await rig.manager.setSecret("github", "ci_write_token", secret);
  return rig;
}

const submit = (r: Rig, input: Record<string, unknown> = { repository: REPO, run_id: RUN_ID }) =>
  r.orchestrator.submit({ kind: CI_RERUN_KIND, input, requestedBy: "user" });

const waitForConfirmation = (r: Rig) =>
  vi.waitFor(() => {
    const first = r.permissions.pendingConfirmations()[0];
    if (!first) throw new Error("no pending confirmation yet");
    return first;
  });

describe("input", () => {
  it.each([
    [{ repository: REPO, run_id: 5 }, true],
    [{ repository: REPO }, false],
    [{ repository: "../x", run_id: 5 }, false],
    [{ repository: REPO, run_id: 0 }, false],
    [{ repository: REPO, run_id: 5, tool: "git.status" }, false],
    [null, false],
  ])("%j is %s", (input, ok) => {
    expect(typeof parseCiRerunTaskInput(input) !== "string").toBe(ok);
  });

  it("a task without run_id is refused at submit and nothing is stored or sent", async () => {
    stubGithubWrite();
    const r = await start();
    expect(() => submit(r, { repository: REPO })).toThrow(/run_id/);
    expect(posted).toHaveLength(0);
  });
});

describe("agent definition", () => {
  it("may call only the re-run command and the read command of the github capability", () => {
    const def = createCiRerunAgent();
    expect(def.allowedCapabilities).toEqual(["github"]);
    expect([...def.allowedTools].sort()).toEqual([
      "github.ci.failure_details",
      "github.ci.rerun_failed",
    ]);
  });
});

describe("approve -> execute -> verify", () => {
  it("waits for approval, sends nothing before it, then re-runs once and verifies by re-reading the run", async () => {
    stubGithubWrite();
    const r = await start();
    const task = submit(r);
    const confirmation = await waitForConfirmation(r);
    await vi.waitFor(() =>
      expect(r.orchestrator.trace(task.id)!.run.state).toBe("WAITING_APPROVAL"),
    );
    expect(posted).toHaveLength(0);
    expect(confirmation.sideEffect).toBe("external");
    expect(confirmation.summary).toContain(`repository: ${REPO}`);
    expect(confirmation.summary).toContain(`run_id: ${RUN_ID}`);
    const preview = r.orchestrator.describeConfirmation(confirmation.id);
    expect(preview).toMatchObject({ task_id: task.id, risk: "high", target: `repo:${REPO}` });

    r.permissions.resolveConfirmation(confirmation.id, true);
    await r.orchestrator.settled(task.id);
    const trace = r.orchestrator.trace(task.id)!;
    expect(trace.run.state).toBe("COMPLETED");
    expect(posted).toEqual([
      {
        url: `https://api.github.com/repos/${REPO}/actions/runs/${RUN_ID}/rerun-failed-jobs`,
        authorization: `Bearer ${CI_TOKEN}`,
      },
    ]);
    expect(trace.verification?.passed).toBe(true);
    const checks = trace.verification!.checks.map((c) => [c.name, c.passed]);
    expect(checks[0]).toEqual(["rerun_requested", true]);
    // The mock still shows the old failed run as completed: observed=false is informational only.
    expect(checks[1]).toEqual(["run_restarted_observed", false]);
    // ...and is declared informational so it can never decide the run's outcome.
    expect(trace.verification!.checks[1]!.required).toBe(false);
    expect(trace.conclusion?.summary).toMatch(/requested after your approval/);
    expect(trace.conclusion?.summary).toMatch(/run status after the request: completed/);
    const calls = trace.steps.filter((s) => s.kind === "tool_call");
    expect(calls.map((c) => [c.name, c.status, c.decision, c.risk])).toEqual([
      ["github.ci.rerun_failed", "ok", "require_approval", "high"],
      ["github.ci.failure_details", "ok", "allow", "low"],
    ]);
    // Audit: Core recorded the policy decision of each call.
    for (const c of calls) expect(c.policyAuditId).toBeTruthy();
    expect(trace.conclusion?.aiUsed).toBe(false);
    expect(trace.conclusion?.modelCalls).toBe(0);
  });

  it("reject: nothing is sent and the run FAILS", async () => {
    stubGithubWrite();
    const r = await start();
    const task = submit(r);
    const confirmation = await waitForConfirmation(r);
    r.permissions.resolveConfirmation(confirmation.id, false);
    await r.orchestrator.settled(task.id);
    expect(r.orchestrator.trace(task.id)!.run.state).toBe("FAILED");
    expect(posted).toHaveLength(0);
  });

  it("GitHub refusing (403) fails the run with the fixed message and no secret anywhere", async () => {
    stubGithubWrite(403);
    const r = await start();
    const task = submit(r);
    const confirmation = await waitForConfirmation(r);
    r.permissions.resolveConfirmation(confirmation.id, true);
    await r.orchestrator.settled(task.id);
    const trace = r.orchestrator.trace(task.id)!;
    expect(trace.run.state).toBe("FAILED");
    expect(posted).toHaveLength(1);
    const dump = JSON.stringify({
      trace,
      audit: r.db.prepare("SELECT * FROM audit_log").all(),
      steps: r.db.prepare("SELECT * FROM agent_steps").all(),
      evidence: r.db.prepare("SELECT * FROM agent_evidence").all(),
    });
    expect(dump).not.toContain(CI_TOKEN);
  });

  it("without a ci_write_token the approved call fails before any request", async () => {
    stubGithubWrite();
    const r = await start(null);
    const task = submit(r);
    const confirmation = await waitForConfirmation(r);
    r.permissions.resolveConfirmation(confirmation.id, true);
    await r.orchestrator.settled(task.id);
    expect(r.orchestrator.trace(task.id)!.run.state).toBe("FAILED");
    expect(posted).toHaveLength(0);
  });

  it("automation off or kill switch: a task is refused and nothing is sent", async () => {
    stubGithubWrite();
    const r = await start();
    r.settings.enabled = false;
    expect(() => submit(r)).toThrow();
    r.settings.enabled = true;
    r.permissions.engageKillSwitch();
    expect(() => submit(r)).toThrow();
    expect(posted).toHaveLength(0);
  });

  it("the CI-failure agent never creates a re-run: a full diagnosis run sends no write", async () => {
    stubGithubWrite();
    const r = await start();
    const task = r.orchestrator.submit({
      kind: "ci_failure",
      input: { repository: REPO, run_id: RUN_ID },
      requestedBy: "user",
    });
    await r.orchestrator.settled(task.id);
    expect(r.orchestrator.trace(task.id)!.run.state).toBe("COMPLETED");
    expect(r.permissions.pendingConfirmations()).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });
});

describe("result checking", () => {
  const step = { index: 0, tool: "github.ci.rerun_failed", input: {}, purpose: "p" };
  const rc = (runId: number) =>
    ({
      runId: "run_1",
      task: { input: { repository: REPO, run_id: runId } },
      evidence: { add: () => ({ id: "E1" }) },
    }) as never;
  it.each([
    [{ status: "requested", repository: REPO, run_id: 9 }],
    [{ status: "requested", repository: "other/repo", run_id: RUN_ID }],
    [{ status: "failed", repository: REPO, run_id: RUN_ID }],
    ["requested"],
    [null],
  ])("an unreadable or mismatched re-run result %j fails the step", (output) => {
    expect(() => createCiRerunAgent().afterTool!(rc(RUN_ID), step, output)).toThrow(/mismatched/);
  });
});
