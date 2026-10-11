// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Workflow,
  WorkflowAuthorisation,
  WorkflowDetail,
  WorkflowRun,
  WorkflowRunSummary,
} from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { doubleClick, expectInert, openAt, sendEvent, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.location.hash = "";
});

const HASH = "c".repeat(64);
const HASH2 = "d".repeat(64);

const workflow = (over: Partial<Workflow> = {}): Workflow => ({
  id: "prod-rollback",
  name: "Roll back production",
  enabled: true,
  environment: "production",
  version: 1,
  hash: HASH,
  trigger: { event: "deploy.failed", where: 'event.payload.env == "prod"' },
  authorisation_reasons: ['environment is "production"', "deploys.rollback is a production action"],
  authorised: false,
  problems: [],
  ...over,
});

const definition = {
  id: "prod-rollback",
  name: "Roll back production",
  version: 1,
  environment: "production" as const,
  trigger: { event: "deploy.failed" },
  declares: { tools: ["deploys.logs", "deploys.rollback"], ai: false },
  steps: [
    { id: "logs", type: "action", tool: "deploys.logs" },
    { id: "gate", type: "approval", summary: "Roll back?" },
    {
      id: "rollback",
      type: "action",
      tool: "deploys.rollback",
      compensate: { tool: "deploys.undo_rollback" },
    },
  ],
};

const auth = (over: Partial<WorkflowAuthorisation> = {}): WorkflowAuthorisation => ({
  id: "wfa_1",
  workflow_id: "prod-rollback",
  definition_hash: HASH,
  authorised_by: "user:owner",
  authorised_at: "2026-10-09T12:00:00Z",
  expires_at: null,
  revoked_at: null,
  revoked_by: null,
  live: true,
  ...over,
});

const summary = (over: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary => ({
  id: "run_1",
  workflow_id: "prod-rollback",
  workflow_name: "Roll back production",
  status: "running",
  terminal: false,
  correlation_id: "workflow-run_1",
  trigger_event_id: "evt_1",
  chain_depth: 0,
  current_step: "gate",
  reason: null,
  created_at: new Date().toISOString(),
  started_at: null,
  finished_at: null,
  ...over,
});

const runDetail = (over: Partial<WorkflowRun> = {}): WorkflowRun => ({
  ...summary(),
  trigger: '{"event":"deploy.failed"}',
  steps: [
    {
      seq: 1,
      step_id: "logs",
      phase: "step",
      type: "action",
      status: "succeeded",
      attempts: 1,
      destructive: false,
      tool: "deploys.logs",
      input: "{}",
      output: '{"lines":["ok"]}',
      error: null,
      started_at: "t",
      finished_at: "t",
    },
    {
      seq: 2,
      step_id: "rollback",
      phase: "step",
      type: "action",
      status: "failed",
      attempts: 1,
      destructive: true,
      tool: "deploys.rollback",
      input: "{}",
      output: null,
      error: "boom",
      started_at: "t",
      finished_at: "t",
    },
  ],
  ...over,
});

/** A fake Core whose workflow follows what is posted. */
function rig(
  initial: Workflow = workflow(),
  extra: Record<string, (b: unknown) => unknown> = {},
  unreadable = false,
) {
  let current = initial;
  let auths: WorkflowAuthorisation[] = [];
  let runs: WorkflowRunSummary[] = [];
  let detailDefinition: WorkflowDetail["definition"] = unreadable ? null : definition;
  const detail = (): WorkflowDetail => ({
    workflow: current,
    definition: detailDefinition,
    authorisations: auths,
    created_by: "user:owner",
    created_at: "t",
    updated_by: "user:owner",
    updated_at: "t",
  });
  const set = (patch: Partial<Workflow>) => (current = { ...current, ...patch });
  const m = openAt("#/workflows/prod-rollback", {
    "GET /api/workflows": () => ({ workflows: [current] }),
    "GET /api/workflows/metrics": () => ({ metrics: {} }),
    "GET /api/workflows/runs": () => ({ runs }),
    "GET /api/workflows/prod-rollback": () => detail(),
    "POST /api/workflows/prod-rollback/enabled": (body) => {
      const change = body as { enabled: boolean };
      set({ enabled: change.enabled });
      return { workflow: current };
    },
    "POST /api/workflows/prod-rollback/authorise": (body) => {
      const b = body as { hash: string; expires_at?: string };
      if (b.hash !== current.hash) {
        return new Response(
          JSON.stringify({
            code: "INVALID_REQUEST",
            message: "The definition changed; review it again",
            details: ["HASH_MISMATCH"],
          }),
          { status: 400 },
        );
      }
      auths = [auth({ expires_at: b.expires_at ?? null })];
      set({ authorised: true });
      return { authorisation: auths[0], workflow: current };
    },
    "POST /api/workflows/prod-rollback/revoke": () => {
      auths = auths.map((a) => ({ ...a, live: false, revoked_at: "t" }));
      set({ authorised: false });
      return { revoked: 1, workflow: current };
    },
    "POST /api/workflows/prod-rollback/runs": () => {
      runs = [summary()];
      return { run: runs[0] };
    },
    ...extra,
  });
  return {
    ...m,
    current: () => current,
    set,
    setRuns: (r: WorkflowRunSummary[]) => (runs = r),
    setDefinition: (d: WorkflowDetail["definition"]) => (detailDefinition = d),
  };
}

const section = async (name: string) =>
  within((await screen.findByRole("heading", { name })).closest("section")!);

describe("Workflows list", () => {
  it("is in the navigation and lists state in words: enabled, environment, authorised", async () => {
    openAt("#/workflows", {
      "GET /api/workflows": () => ({
        workflows: [
          workflow(),
          workflow({
            id: "read-logs",
            name: "Read logs",
            environment: "local",
            authorisation_reasons: [],
            authorised: true,
            enabled: false,
          }),
          workflow({ id: "broken", name: "Broken", problems: ["deploys is disabled"] }),
        ],
      }),
      "GET /api/workflows/metrics": () => ({
        metrics: { "prod-rollback": { runs_started: 3, runs_succeeded: 2 } },
      }),
    });
    expect(screen.getByRole("link", { name: "Workflows" }).getAttribute("aria-current")).toBe(
      "page",
    );
    const list = await screen.findByRole("list", { name: "Workflows" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("Enabled");
    expect(items[0]!.textContent).toContain("PRODUCTION (changes live systems)");
    expect(items[0]!.textContent).toContain("NOT authorised: triggers are refused");
    expect(items[0]!.textContent).toContain("3 run(s), 2 succeeded");
    expect(items[1]!.textContent).toContain("Disabled");
    expect(items[1]!.textContent).toContain("No authorisation needed");
    expect(items[2]!.textContent).toContain("Cannot run: deploys is disabled");
    expect(
      within(items[0]!).getByRole("link", { name: "Roll back production" }).getAttribute("href"),
    ).toBe("#/workflows/prod-rollback");
  });

  it("says plainly when there are none, and shows an error", async () => {
    openAt("#/workflows", { "GET /api/workflows": () => ({ workflows: [] }) });
    expect(await screen.findByText(/No workflows yet/)).toBeTruthy();
    cleanup();
    openAt("#/workflows", {});
    expect((await screen.findByRole("alert")).textContent).toBe("Not found");
  });

  it("renders a hostile name as text", async () => {
    const { container } = openAt("#/workflows", {
      "GET /api/workflows": () => ({ workflows: [workflow({ name: XSS })] }),
    });
    await screen.findByRole("list", { name: "Workflows" });
    expectInert(container);
  });
});

describe("Workflow detail", () => {
  it("shows the definition as read-only text with its hash, the tools, and flags production steps", async () => {
    const { container } = rig();
    expect(await screen.findByRole("heading", { name: "Roll back production" })).toBeTruthy();
    const text = await screen.findByLabelText("Definition (read-only text, scrolls)");
    expect(text.tagName).toBe("PRE");
    expect(text.textContent).toBe(JSON.stringify(definition, null, 2));
    expect(screen.getAllByText(HASH).length).toBeGreaterThan(0);
    const tools = screen.getByRole("list", { name: "Tools" });
    expect(tools.textContent).toContain("deploys.rollback");
    expect(within(tools).getAllByText("Production or critical action")).toHaveLength(1);
    expect(screen.getByText(/This workflow can change live systems/)).toBeTruthy();
    expect(container.querySelector("textarea.wf-definition")).toBeNull();
  });

  it("renders a hostile definition as text", async () => {
    const m = rig();
    m.setDefinition({ ...definition, name: XSS, steps: [{ id: "x", type: "action", tool: XSS }] });
    m.set({ name: XSS });
    m.ws.message("event.created", {
      seq: 3,
      event: {
        event_id: "evt_3aaaaaa",
        event_type: "workflow.updated",
        source: "core",
        severity: "info",
        timestamp: "",
        payload: {},
      },
    });
    await waitFor(() => expect(m.container.textContent).toContain(XSS));
    expectInert(m.container);
  });

  it("says the stored definition cannot be read, and shows why it cannot run", async () => {
    rig(workflow({ problems: ["Definition is invalid"] }), {}, true);
    expect(await screen.findByText("It cannot run right now:")).toBeTruthy();
    expect(screen.getByText("Definition is invalid")).toBeTruthy();
    expect(screen.getByText("The stored definition could not be read.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Run now" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "Check the definition" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("enable and disable send one request", async () => {
    const m = rig();
    const button = await screen.findByRole("button", { name: "Disable" });
    doubleClick(() => fireEvent.click(button));
    expect(await screen.findByRole("button", { name: "Enable" })).toBeTruthy();
    expect(m.api.posts("/api/workflows/prod-rollback/enabled")).toHaveLength(1);
    expect(m.api.posts("/api/workflows/prod-rollback/enabled")[0]?.body).toEqual({
      enabled: false,
    });
  });

  describe("validate", () => {
    it("shows problems with their paths and does not store anything", async () => {
      const m = rig(workflow(), {
        "POST /api/workflows/validate": () => ({
          valid: false,
          problems: ["/steps/1/tool: deploys.nope is not an available tool"],
          hash: null,
          authorisation: null,
        }),
      });
      fireEvent.click(await screen.findByRole("button", { name: "Check the definition" }));
      const list = await screen.findByRole("list", { name: "Problems" });
      expect(list.textContent).toContain("/steps/1/tool");
      expect(m.api.posts("/api/workflows/validate")[0]?.body).toEqual({ definition });
      expect(m.api.posts("/api/workflows")).toHaveLength(0);
    });

    it("shows the hash and whether authorisation is needed when valid", async () => {
      rig(workflow(), {
        "POST /api/workflows/validate": () => ({
          valid: true,
          problems: [],
          hash: HASH,
          authorisation: { required: true, reasons: ["environment is production"] },
        }),
      });
      fireEvent.click(await screen.findByRole("button", { name: "Check the definition" }));
      expect(
        await screen.findByText(/Needs your authorisation: environment is production/),
      ).toBeTruthy();
    });
  });

  describe("authorise for production", () => {
    it("shows exactly what it will let run and the hash, then sends that hash", async () => {
      const m = rig();
      const s = await section("Authorise for production");
      expect(s.getByText('environment is "production"')).toBeTruthy();
      const allowed = s.getByRole("list", { name: "What would be allowed to run" });
      expect(allowed.textContent).toContain("deploys.logs");
      expect(allowed.textContent).toContain("deploys.rollback");
      expect(allowed.textContent).toContain("undo: deploys.undo_rollback");
      expect(s.getByText(HASH)).toBeTruthy();
      fireEvent.click(s.getByRole("button", { name: "Authorise exactly this definition" }));
      await waitFor(() =>
        expect(m.api.posts("/api/workflows/prod-rollback/authorise")).toHaveLength(1),
      );
      expect(m.api.posts("/api/workflows/prod-rollback/authorise")[0]?.body).toEqual({
        hash: HASH,
      });
      expect(await screen.findByText(/Authorised version 1/)).toBeTruthy();
      expect((await screen.findAllByText(/Authorised for production/)).length).toBeGreaterThan(0);
    });

    it("a double click sends ONE request", async () => {
      const m = rig();
      const s = await section("Authorise for production");
      doubleClick(() =>
        fireEvent.click(s.getByRole("button", { name: "Authorise exactly this definition" })),
      );
      await screen.findByText(/Authorised version 1/);
      expect(m.api.posts("/api/workflows/prod-rollback/authorise")).toHaveLength(1);
    });

    it("sends an expiry as an ISO time, and refuses a past or too-distant one before asking", async () => {
      const m = rig();
      const s = await section("Authorise for production");
      const field = s.getByLabelText(/^Expires/);
      fireEvent.change(field, { target: { value: "2020-01-01T10:00" } });
      fireEvent.click(s.getByRole("button", { name: "Authorise exactly this definition" }));
      expect((await screen.findByRole("alert")).textContent).toBe(
        "The expiry must be in the future.",
      );
      fireEvent.change(field, { target: { value: "2099-01-01T10:00" } });
      fireEvent.click(s.getByRole("button", { name: "Authorise exactly this definition" }));
      expect((await screen.findByRole("alert")).textContent).toMatch(/at most 90 days/);
      expect(m.api.posts("/api/workflows/prod-rollback/authorise")).toHaveLength(0);
      const soon = new Date(Date.now() + 5 * 86_400_000);
      const pad = (n: number) => String(n).padStart(2, "0");
      fireEvent.change(field, {
        target: {
          value: `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T10:00`,
        },
      });
      fireEvent.click(s.getByRole("button", { name: "Authorise exactly this definition" }));
      await waitFor(() =>
        expect(m.api.posts("/api/workflows/prod-rollback/authorise")).toHaveLength(1),
      );
      const body = m.api.posts("/api/workflows/prod-rollback/authorise")[0]?.body as {
        hash: string;
        expires_at: string;
      };
      expect(body.hash).toBe(HASH);
      expect(Date.parse(body.expires_at)).toBeGreaterThan(Date.now());
    });

    it("a definition that changed since the page loaded is refused, shown, and reloaded", async () => {
      const m = rig();
      const s = await section("Authorise for production");
      const button = s.getByRole("button", { name: "Authorise exactly this definition" });
      m.set({ hash: HASH2, version: 2, name: "Changed elsewhere" });
      fireEvent.click(button);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe("The definition changed; review it again");
      expect(m.api.posts("/api/workflows/prod-rollback/authorise")[0]?.body).toEqual({
        hash: HASH,
      });
      expect(await screen.findByRole("heading", { name: "Changed elsewhere" })).toBeTruthy();
      expect(screen.getAllByText(HASH2).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/NOT authorised/).length).toBeGreaterThan(0);
    });

    it("lists authorisations, marks a stale one as not in force, and revokes only after a second click", async () => {
      const m = rig(workflow({ authorised: true }));
      const first = await section("Authorisations");
      expect(await first.findByText("None yet.")).toBeTruthy();
      // Authorise, then revoke.
      const s = await section("Authorise for production");
      fireEvent.click(s.getByRole("button", { name: "Authorise exactly this definition" }));
      await screen.findByText("In force");
      fireEvent.click(screen.getByRole("button", { name: "Revoke authorisation…" }));
      expect(m.api.posts("/api/workflows/prod-rollback/revoke")).toHaveLength(0);
      doubleClick(() =>
        fireEvent.click(screen.getByRole("button", { name: "Confirm: revoke authorisation" })),
      );
      await screen.findByText("Revoked");
      expect(m.api.posts("/api/workflows/prod-rollback/revoke")).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Revoke authorisation…" })).toBeNull();
    });

    it("says no authorisation is needed for a local workflow", async () => {
      rig(workflow({ environment: "local", authorisation_reasons: [], authorised: true }));
      expect(await screen.findByText("This workflow does not need authorisation.")).toBeTruthy();
    });
  });

  describe("run now", () => {
    it("starts a run with the payload, and links to it", async () => {
      const m = rig();
      const s = await section("Run now");
      fireEvent.change(s.getByLabelText(/^Data the event would have carried/), {
        target: { value: '{"env":"prod"}' },
      });
      doubleClick(() => fireEvent.click(s.getByRole("button", { name: "Run now" })));
      await waitFor(() => expect(m.api.posts("/api/workflows/prod-rollback/runs")).toHaveLength(1));
      expect(m.api.posts("/api/workflows/prod-rollback/runs")[0]?.body).toEqual({
        payload: { env: "prod" },
      });
      expect((await s.findByRole("link", { name: "Follow the run" })).getAttribute("href")).toBe(
        "#/workflows/prod-rollback/runs/run_1",
      );
      expect(m.api.posts("/api/workflows/prod-rollback/runs")).toHaveLength(1);
    });

    it("refuses a payload that is not a JSON object before asking", async () => {
      const m = rig();
      const s = await section("Run now");
      fireEvent.change(s.getByLabelText(/^Data the event/), { target: { value: "[1]" } });
      fireEvent.click(s.getByRole("button", { name: "Run now" }));
      expect((await s.findByRole("alert")).textContent).toBe(
        "The payload must be a JSON object, like {}.",
      );
      fireEvent.change(s.getByLabelText(/^Data the event/), { target: { value: "{nope" } });
      fireEvent.click(s.getByRole("button", { name: "Run now" }));
      expect((await s.findByRole("alert")).textContent).toBe("The payload is not valid JSON.");
      expect(m.api.posts("/api/workflows/prod-rollback/runs")).toHaveLength(0);
    });

    it("a refused start (403 RUN_REFUSED) shows the reason and links to the refused run", async () => {
      rig(workflow(), {
        "POST /api/workflows/prod-rollback/runs": () =>
          new Response(
            JSON.stringify({
              code: "SECURITY_POLICY_BLOCKED",
              message: "The workflow did not start",
              details: [
                "RUN_REFUSED",
                "run_9",
                "Not authorised: the definition has no live authorisation",
              ],
            }),
            { status: 403 },
          ),
      });
      const s = await section("Run now");
      fireEvent.click(s.getByRole("button", { name: "Run now" }));
      const alert = await s.findByRole("alert");
      expect(alert.textContent).toContain("The start was refused.");
      expect(alert.textContent).toContain(
        "Not authorised: the definition has no live authorisation",
      );
      expect(
        within(alert).getByRole("link", { name: "See the refused run" }).getAttribute("href"),
      ).toBe("#/workflows/prod-rollback/runs/run_9");
    });

    it("is disabled for a disabled workflow, and says why", async () => {
      const m = rig(workflow({ enabled: false }));
      const s = await section("Run now");
      expect((s.getByRole("button", { name: "Run now" }) as HTMLButtonElement).disabled).toBe(true);
      expect(s.getByText("Enable the workflow to run it.")).toBeTruthy();
      expect(m.api.posts("/api/workflows/prod-rollback/runs")).toHaveLength(0);
    });

    it("shows other API errors (400 WORKFLOW_DISABLED)", async () => {
      rig(workflow(), {
        "POST /api/workflows/prod-rollback/runs": () =>
          new Response(
            JSON.stringify({
              code: "INVALID_REQUEST",
              message: "The workflow is disabled",
              details: ["WORKFLOW_DISABLED"],
            }),
            { status: 400 },
          ),
      });
      const s = await section("Run now");
      fireEvent.click(s.getByRole("button", { name: "Run now" }));
      expect((await s.findByRole("alert")).textContent).toBe("The workflow is disabled");
    });
  });

  it("lists recent runs with status in words; refused, failed and interrupted are not successes", async () => {
    const m = rig();
    m.setRuns([
      summary({ id: "r1", status: "succeeded", terminal: true, current_step: null }),
      summary({ id: "r2", status: "refused", terminal: true, reason: XSS }),
      summary({ id: "r3", status: "failed_needs_attention", terminal: true }),
      summary({ id: "r4", status: "interrupted", terminal: true }),
    ]);
    m.ws.message("event.created", {
      seq: 4,
      event: {
        event_id: "evt_4aaaaaa",
        event_type: "workflow.result",
        source: "core",
        severity: "info",
        timestamp: "",
        payload: {},
      },
    });
    const list = await screen.findByRole("list", { name: "Recent runs" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]!.textContent).toContain("Succeeded");
    expect(items[0]!.textContent).not.toContain("needs a look");
    expect(items[1]!.textContent).toContain("Refused: it was not allowed to run (needs a look)");
    expect(items[2]!.textContent).toContain("Failed: needs your attention (needs a look)");
    expect(items[3]!.textContent).toContain("Interrupted (Phoenix restarted) (needs a look)");
    expectInert(m.container);
  });

  it("shows numbers when there are some, and says so when there are none", async () => {
    openAt("#/workflows/prod-rollback", {
      "GET /api/workflows/prod-rollback": () => ({
        workflow: workflow(),
        definition,
        authorisations: [],
        created_by: null,
        created_at: null,
        updated_by: null,
        updated_at: null,
      }),
      "GET /api/workflows/runs": () => ({ runs: [] }),
      "GET /api/workflows/metrics": () => ({
        metrics: {
          "prod-rollback": {
            runs_started: 5,
            runs_succeeded: 3,
            runs_failed: 1,
            runs_cancelled: 0,
            runs_rejected: 0,
            runs_interrupted: 0,
            runs_refused: 1,
            runs_compensated: 0,
            runs_needing_attention: 1,
            steps_succeeded: 9,
            steps_failed: 2,
            step_failure_rate: 0.18,
            duration: { p50: 120, p90: 900, p99: 900, samples: 4 },
            approvals_waiting: 0,
            approvals_approved: 2,
            approvals_rejected: 1,
            approvals_expired: 0,
          },
        },
      }),
    });
    const s = await section("Numbers");
    expect(await s.findByText("5")).toBeTruthy();
    expect(s.getByText("2 (18% of steps)")).toBeTruthy();
    expect(s.getByText("120 ms / 900 ms over 4 runs")).toBeTruthy();
  });

  it("says a run-less workflow has no numbers", async () => {
    rig();
    const s = await section("Numbers");
    expect(await s.findByText(/has not run yet/)).toBeTruthy();
  });

  it("explains an unknown workflow", async () => {
    openAt("#/workflows/ghost", {});
    expect((await screen.findByRole("alert")).textContent).toContain("Not found");
  });
});

describe("Workflow run", () => {
  function runRig(run: WorkflowRun, extra: Record<string, (b: unknown) => unknown> = {}) {
    let current = run;
    const m = openAt("#/workflows/prod-rollback/runs/run_1", {
      "GET /api/workflows/runs/run_1": () => current,
      "GET /api/confirmations": () => ({ confirmations: [] }),
      "POST /api/workflows/runs/run_1/cancel": () => {
        current = { ...current, status: "cancelled", terminal: true };
        return { cancelled: true, status: "cancelling" };
      },
      ...extra,
    });
    return { ...m, set: (r: WorkflowRun) => (current = r) };
  }

  it("shows status, why, every step, and flags the steps that change state", async () => {
    const m = runRig(runDetail({ status: "failed", terminal: true, reason: "rollback failed" }));
    expect(await screen.findByText("Failed")).toBeTruthy();
    expect(screen.getByText("rollback failed")).toBeTruthy();
    const steps = screen.getByRole("list", { name: "Steps" });
    const items = within(steps).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Succeeded");
    expect(items[0]!.textContent).not.toContain("Changes state");
    expect(items[1]!.textContent).toContain("Changes state");
    expect(items[1]!.textContent).toContain("Failed");
    expect(items[1]!.textContent).toContain("boom");
    expect(screen.getByLabelText("Output of step logs (plain text, scrolls)").textContent).toBe(
      '{"lines":["ok"]}',
    );
    expect(m.api.posts("/api/workflows/runs/run_1/cancel")).toHaveLength(0);
  });

  it("a finished run has no cancel button", async () => {
    runRig(runDetail({ status: "succeeded", terminal: true }));
    await screen.findByText("Succeeded");
    expect(screen.queryByRole("button", { name: /Cancel this run/ })).toBeNull();
  });

  it("cancel needs a second click and sends one request", async () => {
    const m = runRig(runDetail());
    fireEvent.click(await screen.findByRole("button", { name: "Cancel this run…" }));
    expect(m.api.posts("/api/workflows/runs/run_1/cancel")).toHaveLength(0);
    doubleClick(() =>
      fireEvent.click(screen.getByRole("button", { name: "Confirm: cancel this run" })),
    );
    expect(await screen.findByText("Cancelled")).toBeTruthy();
    expect(m.api.posts("/api/workflows/runs/run_1/cancel")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Cancel this run/ })).toBeNull();
  });

  it("shows a refusal to cancel (400 RUN_NOT_ACTIVE)", async () => {
    runRig(runDetail(), {
      "POST /api/workflows/runs/run_1/cancel": () =>
        new Response(
          JSON.stringify({
            code: "INVALID_REQUEST",
            message: "The run is not active",
            details: ["RUN_NOT_ACTIVE"],
          }),
          { status: 400 },
        ),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel this run…" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm: cancel this run" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The run is not active");
  });

  it("a run waiting for approval shows the approval list; a running one is re-read while it is not finished", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answered = false;
    let polls = 0;
    const m = runRig(runDetail({ status: "waiting_approval" }), {
      "GET /api/workflows/runs/run_1": () => {
        polls++;
        return answered
          ? runDetail({ status: "succeeded", terminal: true })
          : runDetail({ status: "waiting_approval" });
      },
    });
    expect(await screen.findByText("Waiting for your approval")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Waiting for you" })).toBeTruthy();
    answered = true;
    await act(() => vi.advanceTimersByTimeAsync(3_500));
    expect(await screen.findByText("Succeeded")).toBeTruthy();
    const settled = polls;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(polls).toBe(settled);
    expect(m.api.calls.length).toBeGreaterThan(0);
    sendEvent(m.ws, 8, "workflow.result");
  });

  it("a running run whose tool call waits for a confirmation shows that question here", async () => {
    runRig(runDetail({ status: "running" }), {
      "GET /api/confirmations": () => ({
        confirmations: [
          {
            id: "conf_w1",
            capabilityId: "deploys",
            command: "logs",
            summary: "Policy approval: Read logs (high risk needs approval)",
            sideEffect: "read",
            permissions: [],
            requestedAt: "t",
            expiresAt: "t",
          },
        ],
      }),
    });
    expect(
      await screen.findByRole("button", { name: /^Approve: Policy approval: Read logs/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Waiting for you" })).toBeNull();
  });

  it("renders hostile step input, output, error, trigger and reason as text", async () => {
    const { container } = runRig(
      runDetail({
        trigger: XSS,
        reason: XSS,
        status: "failed",
        terminal: true,
        steps: [
          {
            seq: 1,
            step_id: "s",
            phase: "step",
            type: "action",
            status: "failed",
            attempts: 1,
            destructive: true,
            tool: "deploys.rollback",
            input: XSS,
            output: XSS,
            error: XSS,
            started_at: "t",
            finished_at: null,
          },
        ],
      }),
    );
    await screen.findByText("Failed");
    expectInert(container);
  });

  it("explains a missing run", async () => {
    openAt("#/workflows/prod-rollback/runs/nope", {});
    expect((await screen.findByRole("alert")).textContent).toContain("Not found");
  });
});
