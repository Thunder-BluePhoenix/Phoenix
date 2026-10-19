// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutomationSettings } from "../src/components/AutomationSettings";
import { PlanPage } from "../src/components/Plans";
import { ProactiveSettingsSection } from "../src/components/ProactiveSettings";
import { RegistrySettingsSection } from "../src/components/RegistrySettings";
import { SyncSettingsSection } from "../src/components/SyncSettings";
import { WorkflowDetailPage, WorkflowRunPage, WorkflowsPage } from "../src/components/Workflows";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { Plan, PlanDetail, Workflow, WorkflowDetail, WorkflowRun } from "../src/core/types";
import { I18nProvider, type ActiveLocale } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

const HASH = "c".repeat(64);

const WORKFLOW: Workflow = {
  id: "prod-rollback",
  name: "Roll back production",
  enabled: true,
  environment: "production",
  version: 1,
  hash: HASH,
  trigger: { event: "deploy.failed", where: 'event.payload.env == "prod"' },
  authorisation_reasons: ['environment is "production"'],
  authorised: false,
  problems: [],
};

const WORKFLOW_DETAIL: WorkflowDetail = {
  workflow: WORKFLOW,
  definition: {
    id: "prod-rollback",
    name: "Roll back production",
    version: 1,
    environment: "production",
    trigger: { event: "deploy.failed" },
    declares: { tools: ["deploys.rollback"], ai: false },
    steps: [
      {
        id: "rollback",
        type: "action",
        tool: "deploys.rollback",
        compensate: { tool: "deploys.undo_rollback" },
      },
    ],
  },
  authorisations: [
    {
      id: "wfa_1",
      workflow_id: "prod-rollback",
      definition_hash: HASH,
      authorised_by: "user:owner",
      authorised_at: "2026-10-09T12:00:00Z",
      expires_at: "2026-10-20T12:00:00Z",
      revoked_at: null,
      revoked_by: null,
      live: true,
    },
  ],
  created_by: null,
  created_at: null,
  updated_by: null,
  updated_at: null,
};

const RUN: WorkflowRun = {
  id: "run_1",
  workflow_id: "prod-rollback",
  workflow_name: "Roll back production",
  status: "failed_needs_attention",
  terminal: false,
  correlation_id: "workflow-run_1",
  trigger_event_id: "evt_1",
  chain_depth: 2,
  current_step: "rollback",
  reason: null,
  created_at: "2026-10-09T12:00:00Z",
  started_at: null,
  finished_at: null,
  trigger: '{"event":"deploy.failed"}',
  steps: [
    {
      seq: 1,
      step_id: "rollback",
      phase: "compensation",
      type: "action",
      status: "timed_out",
      attempts: 3,
      destructive: true,
      tool: "deploys.rollback",
      input: "{}",
      output: null,
      error: "boom",
      started_at: "t",
      finished_at: "t",
    },
  ],
};

const PLAN: Plan = {
  id: "plan_1",
  meeting_id: "kage:7",
  item_id: "mi_1",
  target: "frappe",
  destination: { system: "frappe", site: "erp.localhost" },
  status: "approved",
  content_hash: "a".repeat(64),
  approved: { hash: "a".repeat(64), by: "owner", at: "2026-10-09T12:05:00Z" },
  include_meeting_ref: true,
  title: "Vendor approval flow",
  generated_by: "ai:ollama/llama3.2",
  not_ai_generated: false,
  summary: { text: "Build the flow.", basis: "meeting", quote: "we need a vendor approval flow" },
  acceptance_criteria: [{ text: "Purchasing can approve", basis: "suggested" }],
  risks: [{ text: "Scope creep", basis: "user" }],
  open_questions: ["Who owns it?"],
  tasks: [
    { title: "Design the flow", body: "Sketch it.", labels: ["design"], basis: "suggested" },
    { title: "Build it", body: "Write code.", labels: [], basis: "user" },
  ],
  frappe: {
    doctype: "Vendor Approval",
    fields: [{ label: "Vendor", fieldtype: "Link", required: true }],
    workflow_states: ["Draft", "Approved"],
    permissions: [{ role: "Purchase User", read: true, write: true, create: false }],
  },
  source: {
    item_id: "mi_1",
    meeting_id: "kage:7",
    kind: "action_item",
    item_text: "We need a vendor approval flow",
    owner: "Sam",
    due: "2026-11-01",
    quote: null,
  },
  created_at: "2026-10-09T12:00:00Z",
  updated_at: "2026-10-09T12:00:00Z",
};

const PLAN_DETAIL: PlanDetail = {
  plan: PLAN,
  runs: [
    {
      task_index: 0,
      idempotency_key: "key-1",
      updated_at: "2026-10-09T12:06:00Z",
      status: "failed",
      attempts: 2,
      external_id: null,
      url: null,
      error: "denied",
    },
  ],
  links: [],
};

const PROVENANCE = {
  signer_key_id: "testkey",
  signature: "signature-value",
  signature_status: "verified" as const,
  index_sha256: "b".repeat(64),
  artifact_verification: "not_verified" as const,
};

const SYNC = {
  enabled: true,
  identity: "device-one",
  endpoint: "https://relay.example",
  excluded_projects: ["alpha"],
  excluded_classes: [],
  pending: 3,
  conflicts: 1,
  items: [
    {
      id: "record-1",
      owner: "device-one",
      scope: "project",
      project: "alpha",
      data_class: "context",
      value: null,
      revision: "rev-1",
      updated_at: "2026-10-09T12:00:00Z",
      deleted: false,
      pending: true,
      base_revision: null,
      conflict: "remote_missing",
    },
  ],
  adapter_keys: ["pet.settings.reduced_motion"],
  adapter_sources: [],
};

function screenIn(locale: ActiveLocale) {
  const api = fakeApi({
    "GET /api/workflows": () => ({ workflows: [WORKFLOW] }),
    "GET /api/workflows/metrics": () => ({
      metrics: {
        "prod-rollback": {
          runs_started: 5,
          runs_succeeded: 2,
          runs_failed: 1,
          runs_cancelled: 0,
          runs_rejected: 0,
          runs_interrupted: 0,
          runs_refused: 0,
          runs_compensated: 0,
          runs_needing_attention: 1,
          steps_succeeded: 8,
          steps_failed: 2,
          step_failure_rate: 0.18,
          duration: { p50: 120, p90: 900, p99: 900, samples: 4 },
          approvals_waiting: 0,
          approvals_approved: 1,
          approvals_rejected: 0,
          approvals_expired: 0,
        },
      },
    }),
    "GET /api/workflows/runs": () => ({ runs: [] }),
    "GET /api/workflows/prod-rollback": () => WORKFLOW_DETAIL,
    "GET /api/workflows/runs/run_1": () => RUN,
    "GET /api/plans/status": () => ({
      enabled: true,
      ai_enabled: true,
      reasons: [],
      destinations: {
        github: { capability_enabled: true, write_token_set: true },
        frappe: { capability_enabled: true, write_token_set: true, sites: [] },
      },
    }),
    "GET /api/plans/plan_1": () => PLAN_DETAIL,
    "GET /api/plans/plan_1/preview": () => ({
      plan_id: "plan_1",
      tasks: [
        {
          task_index: 0,
          tool: "frappe.task.create",
          input: { title: "Design the flow" },
          decision: { effect: "confirm", risk: "medium", reasons: [], matched: [] },
        },
      ],
    }),
    "GET /api/confirmations": () => ({ confirmations: [] }),
    "GET /api/agent/settings": () => ({
      enabled: true,
      kinds: ["ci_failure"],
      limits: { max_steps: 8, max_tool_calls: 12, max_wall_ms: 600000, max_active_runs: 4 },
      active_runs: 1,
    }),
    "GET /api/proactive": () => ({
      preferences: {
        enabled: true,
        capabilities: ["kage"],
        quietHours: { timezone: "UTC", start: "22:00", end: "08:00" },
        maxPerHour: 3,
        cadenceMinutes: 30,
      },
      source: { capability_id: "kage", available: true, mode: "manual" },
      noise: { delivered: 4, dismissed: 1, suppressed: 2, dismissalRate: 0.25 },
    }),
    "GET /api/registry": () => ({
      configured: true,
      sandbox_status: "unavailable",
      provenance: PROVENANCE,
      entries: [{ id: "sample", version: "1.2.3", name: "Sample capability", description: "Meta" }],
    }),
    "GET /api/sync": () => SYNC,
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <I18nProvider forceLocale={locale}>
        <WorkflowsPage />
        <WorkflowDetailPage workflowId="prod-rollback" />
        <WorkflowRunPage workflowId="prod-rollback" runId="run_1" />
        <PlanPage planId="plan_1" />
        <AutomationSettings />
        <ProactiveSettingsSection />
        <RegistrySettingsSection />
        <SyncSettingsSection />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
}

/** Phrases of the converted strings that must not be on screen in another language. */
const ENGLISH = [
  "A workflow reacts to an event",
  "Create workflow",
  "Check draft",
  "Tools it can call",
  "Authorise for production",
  "Why it needs your authorisation",
  "Run now",
  "Recent runs",
  "Runs started",
  "Needing your attention",
  "What started it",
  "Stop this run",
  "chain depth",
  "Changes state",
  "Exactly what would be sent",
  "Task by task",
  "Acceptance criteria",
  "Open questions",
  "Proposed Frappe DocType",
  "Approve this exact plan",
  "I understand this creates",
  "Create the remaining tasks",
  "Allow Fawkes to run tasks I start",
  "Proactive suggestions",
  "Automatic evaluation cadence",
  "Quiet hours",
  "Dismissal rate",
  "Capability registry",
  "Loading verified preview",
  "Preview Sample capability",
  "Encrypted sync",
  "Exclude data classes",
  "Sync now",
  "Synced items",
  "Review keeping local",
  "Configure encrypted sync",
  "Refresh sync status",
  "Loading…",
];

const DATA = [
  "Roll back production",
  "deploys.rollback",
  "deploy.failed",
  "Vendor approval flow",
  "We need a vendor approval flow",
  "Vendor Approval",
  "erp.localhost",
  "Purchase User",
  "record-1",
  "testkey",
  "signature-value",
];

async function loaded() {
  await screen.findByText("Vendor Approval");
  await screen.findByText("signature-value");
  await screen.findByText("record-1");
  await screen.findByText("testkey");
  await screen.findAllByText(/deploys\.rollback/);
}

describe("the automation screens in Arabic", () => {
  it("are right-to-left, Arabic, and show no message id", async () => {
    screenIn("ar");
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    await loaded();
    await waitFor(() => expect(screen.queryByText("Quiet hours")).toBeNull());
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/\p{Script=Arabic}/u);
    expect(text).not.toMatch(/\bautomation\.[a-zA-Z]+\.[a-zA-Z.]+/);
    expect(text).not.toMatch(/\bcommon\.[a-zA-Z]+\.[a-zA-Z.]+/);
    for (const english of ENGLISH) expect(text, english).not.toContain(english);
    for (const data of DATA) expect(text, data).toContain(data);
    expect(screen.getAllByRole("button", { name: /\p{Script=Arabic}/u }).length).toBeGreaterThan(5);
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
  });
});

describe("the automation screens in the pseudo-locale en-XA", () => {
  it("leave no English in the strings that were converted", async () => {
    screenIn("en-XA");
    await loaded();
    await waitFor(() => expect(screen.queryByText("Quiet hours")).toBeNull());
    const text = document.body.textContent ?? "";
    for (const english of ENGLISH) expect(text, english).not.toContain(english);
    for (const data of DATA) expect(text, data).toContain(data);
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^\[/ }).length).toBeGreaterThan(5);
  });
});
