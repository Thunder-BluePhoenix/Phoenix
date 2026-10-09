// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RUN_STATE_TEXT } from "../src/core/agent";
import { AGENT_RUN_STATES, type AgentTaskDetail } from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { mount, openPanel, sendEvent, taskDetail, taskSummary, TASK_ID } from "./harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => cleanup());

const done: Partial<AgentTaskDetail> = {
  summary: "The lint step failed on commit abc1234.",
  steps: [
    {
      seq: 1,
      kind: "stage",
      name: "classify",
      status: "ok",
      detail: {},
      policy_audit_id: null,
      decision: null,
      risk: null,
      stage_audit_id: 3,
      started_at: "",
      finished_at: "",
    },
    {
      seq: 2,
      kind: "tool_call",
      name: "github.ci.failure_details",
      status: "ok",
      detail: {},
      policy_audit_id: 8,
      decision: "allow",
      risk: "low",
      stage_audit_id: null,
      started_at: "",
      finished_at: "",
    },
    {
      seq: 3,
      kind: "tool_call",
      name: "git.recent_commits",
      status: "denied",
      detail: {},
      policy_audit_id: 9,
      decision: "deny",
      risk: "medium",
      stage_audit_id: null,
      started_at: "",
      finished_at: "",
    },
  ],
  evidence: [
    {
      id: "E1",
      kind: "log",
      source: "github",
      excerpt_hash: "abc",
      excerpt: "lint: 3 errors",
      truncated: true,
    },
    {
      id: "E2",
      kind: "commit",
      source: "git",
      excerpt_hash: "def",
      excerpt: "abc1234 fix router",
      truncated: false,
    },
  ],
  diagnosis: {
    summary: "Lint failed.",
    evidence_coverage: 0.5,
    model_reported_confidence: "high",
    ai_used: true,
    claims: [
      {
        text: "The lint step failed.",
        evidence_ids: ["E1"],
        grounded: true,
        origin: "rule",
        note: null,
      },
      {
        text: "It was probably the router.",
        evidence_ids: ["E9"],
        grounded: false,
        origin: "model",
        note: "No cited evidence exists.",
      },
    ],
  },
  proposals: [
    {
      text: "Fix the lint errors in router.ts",
      rationale: "E1 lists them",
      evidence_ids: ["E1"],
      advisory: true,
      grounded: true,
    },
  ],
  verification: {
    passed: false,
    checks: [
      { name: "a failure was observed", passed: true, detail: "yes", required: true },
      { name: "citations were valid", passed: false, detail: "one removed", required: false },
    ],
  },
  ai_used: true,
  processed_by: "Ollama (this device) · llama3.2",
  audit_ids: [1, 2, 3],
};

function openOverview(detail: AgentTaskDetail, state = detail.run.state) {
  const m = mount({
    "GET /api/agent/tasks": () => ({ tasks: [taskSummary(state)] }),
    [`GET /api/agent/tasks/${TASK_ID}`]: () => detail,
  });
  openPanel();
  return m;
}

describe("Run states in plain language", () => {
  it("has words for every state Core can report", () => {
    for (const s of AGENT_RUN_STATES) expect(RUN_STATE_TEXT[s], s).toMatch(/\w{4,}/);
    expect(RUN_STATE_TEXT.WAITING_APPROVAL).toBe("Waiting for your approval");
  });
});

describe("Current task", () => {
  it("is quiet when nothing runs", async () => {
    mount({ "GET /api/agent/tasks": () => ({ tasks: [] }) });
    openPanel();
    expect(await screen.findByText("No agent task is running.")).toBeTruthy();
  });

  it("shows a running task in the Overview with its state in words, and Cancel", async () => {
    openOverview(taskDetail("WAITING_APPROVAL"));
    const task = await screen.findByRole("article", { name: "Agent task: CI failure in acme/app" });
    await within(task).findByText("Waiting for your approval");
    expect(
      within(task).getByRole("button", { name: "Cancel task: CI failure in acme/app" }),
    ).toBeTruthy();
  });

  it("shows steps with tool, status, risk and the policy decision", async () => {
    openOverview(taskDetail("RUNNING", done));
    const task = await screen.findByRole("article");
    const steps = await within(task).findAllByRole("listitem");
    const text = (name: string) =>
      steps.find((s) => s.textContent?.includes(name))?.textContent ?? "";
    expect(text("github.ci.failure_details")).toMatch(
      /tool call · done.*Risk: Low.*Policy: allowed by policy/,
    );
    expect(text("git.recent_commits")).toMatch(
      /denied by policy.*Risk: Medium.*Policy: denied by policy/,
    );
    expect(text("classify")).toMatch(/stage · done/);
    expect(text("classify")).not.toMatch(/Risk/);
  });

  it("shows evidence with excerpts and truncated markers", async () => {
    openOverview(taskDetail("COMPLETED", done), "COMPLETED");
    fireEvent.click(await screen.findByRole("button", { name: "Show details" }));
    const e1 = await screen.findByLabelText("Evidence E1");
    expect(within(e1).getByText("lint: 3 errors")).toBeTruthy();
    expect(within(e1).getByText(/Truncated: this is only the start/)).toBeTruthy();
    const e2 = screen.getByLabelText("Evidence E2");
    expect(within(e2).queryByText(/Truncated/)).toBeNull();
  });

  it("labels claims grounded/ungrounded and rule/model, and links evidence ids to the evidence", async () => {
    openOverview(taskDetail("COMPLETED", done), "COMPLETED");
    fireEvent.click(await screen.findByRole("button", { name: "Show details" }));
    const diagnosis = await screen.findByRole("region", { name: "Diagnosis" });
    const [grounded, ungrounded] = within(diagnosis).getAllByRole("listitem");
    expect(grounded!.textContent).toContain("Grounded in evidence");
    expect(grounded!.textContent).toContain("Written by a rule");
    expect(ungrounded!.textContent).toContain("Not grounded: no valid evidence");
    expect(ungrounded!.textContent).toContain("Written by an AI model");
    expect(ungrounded!.textContent).toContain("No cited evidence exists.");
    // E9 is not in this run's evidence: shown, but not a link.
    expect(within(ungrounded!).queryByRole("button", { name: "Show evidence E9" })).toBeNull();
    expect(within(ungrounded!).getByText("E9")).toBeTruthy();

    fireEvent.click(within(grounded!).getByRole("button", { name: "Show evidence E1" }));
    const e1 = screen.getByLabelText("Evidence E1");
    await waitFor(() => expect(document.activeElement).toBe(e1));
    expect(e1.className).toContain("is-cited");
    expect(within(e1).getByText(/selected/)).toBeTruthy();
    expect(e1.querySelector("details")?.open).toBe(true);
    expect(screen.getByLabelText("Evidence E2").className).not.toContain("is-cited");
  });

  it("states coverage as computed by Phoenix and never adopts the model's own confidence", async () => {
    openOverview(taskDetail("COMPLETED", done), "COMPLETED");
    fireEvent.click(await screen.findByRole("button", { name: "Show details" }));
    const diagnosis = await screen.findByRole("region", { name: "Diagnosis" });
    expect(diagnosis.textContent).toContain(
      "Evidence coverage: 50% of claims are grounded (computed by Phoenix",
    );
    expect(diagnosis.textContent).toContain("Phoenix did not verify or use that");
  });

  it("labels proposals as advisory and shows the verification checks", async () => {
    openOverview(taskDetail("COMPLETED", done), "COMPLETED");
    fireEvent.click(await screen.findByRole("button", { name: "Show details" }));
    const proposals = await screen.findByRole("region", { name: "Proposals" });
    expect(proposals.textContent).toContain("Advisory: nothing was changed");
    expect(proposals.textContent).toContain("Fix the lint errors in router.ts");
    const verification = screen.getByRole("region", { name: "Verification" });
    expect(verification.textContent).toContain("Checks did not pass.");
    expect(verification.textContent).toMatch(/Passed.*Required.*a failure was observed/);
    expect(verification.textContent).toMatch(/Failed.*Informational.*citations were valid/);
  });

  it("says whether the summary used AI", async () => {
    openOverview(taskDetail("COMPLETED", done), "COMPLETED");
    fireEvent.click(await screen.findByRole("button", { name: "Show details" }));
    expect(
      await screen.findByText(/written with AI: Ollama \(this device\) · llama3\.2/),
    ).toBeTruthy();
    cleanup();
    FakeWebSocket.reset();
    openOverview(
      taskDetail("COMPLETED", { ...done, ai_used: false, processed_by: null }),
      "COMPLETED",
    );
    fireEvent.click(await screen.findByRole("button", { name: "Show details" }));
    expect(await screen.findByText(/rule-based, no AI was used/)).toBeTruthy();
  });

  it("shows why a run failed, with no cancel button", async () => {
    openOverview(
      taskDetail("FAILED", {
        run: { ...taskDetail("FAILED").run, failure_reason: "No failed run was found" },
      }),
      "FAILED",
    );
    fireEvent.click(await screen.findByRole("button", { name: "Show details" }));
    expect(await screen.findByText("Why it failed: No failed run was found")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Cancel task/ })).toBeNull();
  });

  it("refreshes on agent_run and confirmation events, without polling", async () => {
    let state: "RUNNING" | "WAITING_APPROVAL" | "COMPLETED" = "RUNNING";
    const m = mount({
      "GET /api/agent/tasks": () => ({ tasks: [taskSummary(state)] }),
      [`GET /api/agent/tasks/${TASK_ID}`]: () => taskDetail(state),
    });
    openPanel();
    await screen.findByText("Running");
    const loads = () => m.api.calls.filter((c) => c.path === `/api/agent/tasks/${TASK_ID}`).length;
    const before = loads();

    state = "WAITING_APPROVAL";
    sendEvent(m.ws, 1, "agent_run.waiting", { task_id: TASK_ID });
    await screen.findByText("Waiting for your approval");

    state = "RUNNING";
    sendEvent(m.ws, 2, "security.confirmation.resolved");
    await screen.findByText("Running");

    state = "COMPLETED";
    sendEvent(m.ws, 3, "agent_run.completed", { task_id: TASK_ID });
    await waitFor(() => expect(screen.queryByText("No agent task is running.")).toBeTruthy());
    expect(loads()).toBeGreaterThan(before);

    // An unrelated event reloads nothing.
    const afterEvents = m.api.calls.length;
    sendEvent(m.ws, 4, "git.commit.created");
    await act(async () => {}); // let any (wrongly) triggered reload settle
    expect(m.api.calls.length).toBe(afterEvents);
  });

  it("reports a task that cannot be loaded instead of staying blank", async () => {
    mount({ "GET /api/agent/tasks": () => ({ tasks: [taskSummary("RUNNING")] }) });
    openPanel();
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load this task");
  });

  it("cancels from the Overview", async () => {
    const m = mount({
      "GET /api/agent/tasks": () => ({ tasks: [taskSummary("RUNNING")] }),
      [`GET /api/agent/tasks/${TASK_ID}`]: () => taskDetail("RUNNING"),
      [`POST /api/agent/tasks/${TASK_ID}/cancel`]: () => ({ cancelled: false, state: "COMPLETED" }),
    });
    openPanel();
    fireEvent.click(await screen.findByRole("button", { name: /^Cancel task/ }));
    expect(await screen.findByText(/already finished \(completed\)/)).toBeTruthy();
    expect(m.api.posts(`/api/agent/tasks/${TASK_ID}/cancel`)[0]?.body).toEqual({});
  });
});
