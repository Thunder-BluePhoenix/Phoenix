// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// EXIT CRITERION, end to end and in process: meeting -> summary -> decision -> approved task.
//
// Real: a SQLite FILE (reopened between steps), MeetingStore, MeetingItemService, PlanService,
// ToolGateway, PolicyEngine, PermissionGateway, CapabilityManager, and the real kage, github and
// frappe capabilities. Mocked: Kage's backend, GitHub and Frappe, all as local servers on
// 127.0.0.1. NOTHING IN THIS FILE CAN REACH A REAL GITHUB OR FRAPPE SITE.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryPipeline, MemoryStore, createDefaultPolicy } from "@phoenix/ai-memory";
import { MeetingItemService } from "@phoenix/ai-meetings";
import {
  ToolGateway,
  ToolRegistry,
  approverFromPermissions,
  enabledManifests,
} from "@phoenix/ai-tool-gateway";
import { CapabilityManager } from "@phoenix/capability-manager";
import { PermissionGateway } from "@phoenix/permissions";
import {
  EventStore,
  MeetingStore,
  MemorySecretStore,
  openDatabase,
  type Database,
  type Summary,
  type Transcript,
} from "@phoenix/persistence";
import { PolicyAdmin, PolicyEngine, PolicyStore } from "@phoenix/policy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../../core/event-bus/src";
import { StateEngine } from "../../../core/state-engine/src";
import { createFrappeCapability } from "../../../capabilities/frappe/src";
import { startMockFrappe, type MockFrappe } from "../../../capabilities/frappe/testing/mock-frappe";
import { createGithubCapability } from "../../../capabilities/github/src";
import {
  MOCK_WRITE_TOKEN,
  startMockGithub,
  type MockGithub,
} from "../../../capabilities/github/testing/mock-github";
import { createKageCapability } from "../../../capabilities/kage/src";
import {
  MOCK_KAGE_KEY,
  startMockKage,
  type MockKage,
} from "../../../capabilities/kage/testing/mock-kage";
import { PlanService, PlanStore, type Destination } from "../src";

const FRAPPE_CREDENTIAL = ["e2ekey", "e2esecret"].join(":");
const SITE = "erp.localhost";
const REPO = "octo/phoenix";
const user = { id: "me" };

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

interface World {
  dbPath: string;
  db: Database;
  manager: CapabilityManager;
  permissions: PermissionGateway;
  meetings: MeetingStore;
  items: MeetingItemService;
  plans: PlanService;
  gateway: ToolGateway;
  kage: MockKage;
  github: MockGithub;
  frappe: MockFrappe;
}

const never = (_ms: number, signal: AbortSignal): Promise<void> => {
  const wait = Promise.withResolvers<void>();
  signal.addEventListener("abort", () => wait.resolve(), { once: true });
  return wait.promise;
};

async function boot(
  dbPath: string,
  mocks?: Pick<World, "kage" | "github" | "frappe">,
): Promise<World> {
  const kage = mocks?.kage ?? (await startMockKage());
  const github = mocks?.github ?? (await startMockGithub());
  const frappe = mocks?.frappe ?? (await startMockFrappe());
  frappe.expectedAuth = `token ${FRAPPE_CREDENTIAL}`;
  const db = openDatabase(dbPath);
  const store = new EventStore(db);
  const bus = new EventBus({ store, retryDelayMs: 0 });
  const permissions = new PermissionGateway({ db, publish: (e) => void bus.publish(e) });
  const manager = new CapabilityManager({
    db,
    bus,
    events: store,
    permissions,
    state: new StateEngine(),
    secrets: new MemorySecretStore(),
    defaultHealthIntervalMs: 3_600_000,
  });
  manager.registerBuiltin(createKageCapability());
  manager.registerBuiltin(createGithubCapability({ sleep: never }));
  manager.registerBuiltin(createFrappeCapability({ sleep: never }));
  manager.configure("kage", { base_url: kage.url, poll_ms: 60_000 });
  await manager.setSecret("kage", "api_key", MOCK_KAGE_KEY);
  manager.configure("github", { repositories: [], api_url: github.url });
  await manager.setSecret("github", "write_token", MOCK_WRITE_TOKEN);
  manager.configure("frappe", { api: { [SITE]: frappe.url } });
  await manager.setSecret("frappe", "write_token", FRAPPE_CREDENTIAL);
  for (const id of ["kage", "github", "frappe"]) await manager.enable(id);

  const registry = new ToolRegistry({ manifests: enabledManifests(manager, db) });
  const policy = new PolicyEngine({
    store: new PolicyStore(db),
    audit: permissions.audit,
    isKillSwitchEngaged: () => permissions.isKillSwitchEngaged(),
    isKnownTool: (t) => registry.has(t),
  });
  const gateway = new ToolGateway({
    host: manager,
    registry,
    policy,
    audit: permissions.audit,
    approver: approverFromPermissions(permissions),
  });
  const meetings = new MeetingStore(db);
  const memory = new MemoryStore(db);
  const items = new MeetingItemService({
    db,
    meetings,
    memory,
    pipeline: new MemoryPipeline({
      store: memory,
      owner: "me",
      policy: createDefaultPolicy({ isSourceEnabled: () => true, allowSensitive: () => true }),
    }),
    audit: (action, details) =>
      void permissions.audit.record({ actor: "meetings", action, decision: "info", details }),
  });
  const plans = new PlanService({
    db,
    items,
    meetings,
    gateway,
    audit: (action, details) =>
      void permissions.audit.record({ actor: "planning", action, decision: "info", details }),
  });
  cleanups.push(async () => {
    await manager.close();
    permissions.close();
    await bus.drain();
    db.close();
  });
  return {
    dbPath,
    db,
    manager,
    permissions,
    meetings,
    items,
    plans,
    gateway,
    kage,
    github,
    frappe,
  };
}

/** The user answering the capability manager's per-call confirmation prompt in the UI. */
async function answerPrompt(
  w: World,
  approve: boolean,
  during: Promise<unknown>,
): Promise<unknown> {
  await vi.waitFor(() => expect(w.permissions.pendingConfirmations().length).toBeGreaterThan(0));
  const [prompt] = w.permissions.pendingConfirmations();
  expect(prompt).toMatchObject({ sideEffect: "external" });
  w.permissions.resolveConfirmation(prompt!.id, approve);
  return during;
}

/** Kage uploaded a meeting and finished summarising it; Phoenix pulls the content through the capability. */
async function kageMeeting(w: World, title = "Procurement planning"): Promise<string> {
  const m = w.kage.upload(title);
  w.kage.advance(m.id, "summarized");
  const pull = async <T>(command: string): Promise<T> => {
    const op = await w.manager.invokeAndWait("kage", command, { meeting_id: String(m.id) }, "core");
    expect(op.status).toBe("succeeded");
    return op.result as T;
  };
  const meeting = w.meetings.upsert({
    capabilityId: "kage",
    externalId: String(m.id),
    status: "ready",
    title,
  });
  if (!meeting) throw new Error("meeting not stored");
  w.meetings.setTranscript(meeting.id, await pull<Transcript>("meeting.get_transcript"));
  w.meetings.setSummary(meeting.id, await pull<Summary>("meeting.get_summary"));
  return meeting.id;
}

async function approvedPlan(w: World, meetingId: string, destination: Destination, ref = false) {
  w.items.importKage(meetingId);
  const decision = w.items.list(meetingId).find((i) => i.kind === "decision");
  if (!decision) throw new Error("no decision imported");
  // The review step: a person accepts the decision.
  w.items.accept(decision.id, user);
  const { record } = await w.plans.generate(decision.id, destination, user);
  w.plans.propose(record.id, user);
  w.plans.approve(
    record.id,
    { hash: w.plans.get(record.id).contentHash, includeMeetingRef: ref },
    user,
  );
  return { decision, planId: record.id };
}

const auditText = (w: World) => JSON.stringify(w.db.prepare("SELECT * FROM audit_log").all());
const posts = (w: World) => w.github.writes.filter((x) => x.method === "POST");

describe("EXIT CRITERION: meeting -> summary -> decision -> approved GitHub issue (mock GitHub)", () => {
  it("creates exactly one issue, with the marker, linked to the meeting, with no secret anywhere", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-plan-e2e-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const w = await boot(join(dir, "phoenix.db"));
    cleanups.push(() => w.kage.close());
    cleanups.push(() => w.github.close());
    cleanups.push(() => w.frappe.close());

    const meetingId = await kageMeeting(w);
    const { decision, planId } = await approvedPlan(w, meetingId, {
      system: "github",
      repository: REPO,
    });

    // Nothing has been created yet: approval alone calls no capability.
    expect(w.github.requests).toEqual([]);
    expect(w.permissions.pendingConfirmations()).toEqual([]);

    // The user starts creation; the capability manager asks them to confirm the external write.
    const created = await answerPrompt(w, true, w.plans.create(planId, user));
    expect(created).toMatchObject({ failure: null, plan: { status: "created" } });

    // Exactly one POST for the one task, to the mock only.
    expect(posts(w)).toHaveLength(1);
    expect(w.github.issues).toHaveLength(1);
    const sent = posts(w)[0]!;
    expect(sent.path).toBe(`/repos/${REPO}/issues`);
    expect(sent.authorization).toBe(`Bearer ${MOCK_WRITE_TOKEN}`);
    const key = sentKey(sent.body);
    expect(w.github.issues[0]!.body).toContain(`<!-- phoenix-ref:${key} -->`);
    expect(key).toMatch(/^phx_[0-9a-f]{24}_0$/);
    // Privacy default: an opaque Phoenix id, not the meeting's title or id.
    expect(w.github.issues[0]!.body).toContain(`Phoenix plan ${planId}`);
    expect(w.github.issues[0]!.body).not.toContain("Procurement planning");
    expect(w.github.issues[0]!.body).not.toContain(meetingId);
    expect(w.github.issues[0]!.body).toMatch(/Not AI generated/);

    // The link is stored, and survives closing and reopening the database file.
    const link = w.plans.linksForMeeting(meetingId, user)[0]!;
    expect(link).toMatchObject({
      meetingId,
      itemId: decision.id,
      planId,
      system: "github",
      externalId: "1",
      url: `https://github.com/${REPO}/issues/1`,
      approvedBy: "me",
    });
    expect(w.plans.linksForTask("github", "1")[0]?.meetingId).toBe(meetingId);

    // The write token is in no audit row, no plan table, no event, no operation result.
    const plain = JSON.stringify([
      auditText(w),
      w.db.prepare("SELECT * FROM plans").all(),
      w.db.prepare("SELECT * FROM plan_links").all(),
      w.db.prepare("SELECT * FROM plan_task_runs").all(),
      w.db.prepare("SELECT * FROM events").all(),
      created,
    ]);
    expect(plain).not.toContain(MOCK_WRITE_TOKEN);
    expect(readFileSync(w.dbPath).includes(MOCK_WRITE_TOKEN)).toBe(false);

    // The audit trail shows the approval, the policy decision and the tool outcome.
    const actions = (
      w.db.prepare("SELECT action FROM audit_log").all() as { action: string }[]
    ).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "plan.generated",
        "plan.approved",
        "policy.decision",
        "confirmation.requested",
        "confirmation.approved",
        "tool.succeeded",
        "plan.task.created",
        "plan.created",
      ]),
    );

    // Calling create again does nothing more: the plan is final.
    await expect(w.plans.create(planId, user)).rejects.toThrow(/Only an approved plan/);
    expect(posts(w)).toHaveLength(1);

    // A second connection to the same file (as after a restart) sees the traceability record.
    const reopened = openDatabase(w.dbPath);
    try {
      expect(new PlanStore(reopened).linksForMeeting(meetingId)).toEqual([link]);
      expect(new PlanStore(reopened).get(planId)?.status).toBe("created");
    } finally {
      reopened.close();
    }
  });

  it("declining the per-call confirmation creates nothing; the plan is failed and retry is possible", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-plan-e2e-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const w = await boot(join(dir, "phoenix.db"));
    cleanups.push(() => w.kage.close());
    cleanups.push(() => w.github.close());
    cleanups.push(() => w.frappe.close());
    const meetingId = await kageMeeting(w);
    const { planId } = await approvedPlan(w, meetingId, { system: "github", repository: REPO });

    const declined = await answerPrompt(w, false, w.plans.create(planId, user));
    expect(declined).toMatchObject({ plan: { status: "failed" }, failure: { taskIndex: 0 } });
    expect(w.github.requests).toEqual([]);
    expect(w.plans.linksForMeeting(meetingId, user)).toEqual([]);

    // The user changes their mind: the retry, once confirmed, creates it.
    const retried = await answerPrompt(w, true, w.plans.create(planId, user));
    expect(retried).toMatchObject({ plan: { status: "created" }, failure: null });
    expect(posts(w)).toHaveLength(1);
  });

  it("an unknown outcome (issue stored, connection dropped) then a retry: still ONE issue", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-plan-e2e-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const w = await boot(join(dir, "phoenix.db"));
    cleanups.push(() => w.kage.close());
    cleanups.push(() => w.github.close());
    cleanups.push(() => w.frappe.close());
    const meetingId = await kageMeeting(w);
    const { planId } = await approvedPlan(w, meetingId, { system: "github", repository: REPO });

    w.github.writeMode.current = "store-then-drop";
    const first = (await answerPrompt(w, true, w.plans.create(planId, user))) as {
      plan: { status: string };
      failure: { message: string };
    };
    expect(first.plan.status).toBe("failed");
    expect(first.failure.message).toMatch(/may or may not have been created/);
    expect(w.github.issues).toHaveLength(1);

    w.github.writeMode.current = "ok";
    const second = await answerPrompt(w, true, w.plans.create(planId, user));
    expect(second).toMatchObject({ plan: { status: "created" }, links: [{ externalId: "1" }] });
    expect(w.github.issues).toHaveLength(1);
    expect(posts(w)).toHaveLength(1);
    expect(w.plans.runs(planId, user)[0]).toMatchObject({ status: "created", attempts: 2 });
  });

  it("the meeting is named in the issue ONLY when the user chose so at approval", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-plan-e2e-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const w = await boot(join(dir, "phoenix.db"));
    cleanups.push(() => w.kage.close());
    cleanups.push(() => w.github.close());
    cleanups.push(() => w.frappe.close());
    const meetingId = await kageMeeting(w);
    const { planId } = await approvedPlan(
      w,
      meetingId,
      { system: "github", repository: REPO },
      true,
    );
    await answerPrompt(w, true, w.plans.create(planId, user));
    expect(w.github.issues[0]!.body).toContain("Procurement planning");
    expect(w.github.issues[0]!.body).toContain(meetingId);
  });

  it("deleting the meeting removes the stored links and plans (the issue itself is left alone)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-plan-e2e-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const w = await boot(join(dir, "phoenix.db"));
    cleanups.push(() => w.kage.close());
    cleanups.push(() => w.github.close());
    cleanups.push(() => w.frappe.close());
    const meetingId = await kageMeeting(w);
    const { planId } = await approvedPlan(w, meetingId, { system: "github", repository: REPO });
    await answerPrompt(w, true, w.plans.create(planId, user));
    expect(w.plans.linksForTask("github", "1")).toHaveLength(1);
    w.meetings.delete(meetingId);
    expect(w.plans.linksForTask("github", "1")).toEqual([]);
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM plans").get()).toEqual({ n: 0 });
    expect(w.github.issues).toHaveLength(1);
  });
});

describe("the same flow for Frappe (mock Frappe)", () => {
  it("creates exactly one Task with the marker and links it to the meeting", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-plan-e2e-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const w = await boot(join(dir, "phoenix.db"));
    cleanups.push(() => w.kage.close());
    cleanups.push(() => w.github.close());
    cleanups.push(() => w.frappe.close());
    const meetingId = await kageMeeting(w);
    const { decision, planId } = await approvedPlan(w, meetingId, { system: "frappe", site: SITE });

    expect(w.frappe.writes).toEqual([]);
    const created = await answerPrompt(w, true, w.plans.create(planId, user));
    expect(created).toMatchObject({ failure: null, plan: { status: "created" } });

    const postsF = w.frappe.writes.filter((x) => x.method === "POST");
    expect(postsF).toHaveLength(1);
    expect(w.frappe.tasks).toHaveLength(1);
    const doc = w.frappe.tasks[0]!.doc;
    expect(doc.doctype).toBe("Task");
    expect(String(doc.description)).toMatch(/Phoenix ref: phx_[0-9a-f]{24}_0/);
    expect(String(doc.description)).toContain(`Phoenix plan ${planId}`);
    expect(String(doc.description)).not.toContain("Procurement planning");
    expect(postsF[0]!.authorization).toBe(`token ${FRAPPE_CREDENTIAL}`);
    expect(w.plans.linksForMeeting(meetingId, user)[0]).toMatchObject({
      system: "frappe",
      externalId: "TASK-00001",
      itemId: decision.id,
      approvedBy: "me",
    });
    expect(w.plans.linksForTask("frappe", "TASK-00001")[0]?.meetingId).toBe(meetingId);
    expect(auditText(w)).not.toContain(FRAPPE_CREDENTIAL);
    expect(JSON.stringify(w.db.prepare("SELECT * FROM plans").all())).not.toContain(
      FRAPPE_CREDENTIAL,
    );
  });
});

describe("policy and gates hold in the full stack", () => {
  it("a denying policy rule stops creation before the capability is reached", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-plan-e2e-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const w = await boot(join(dir, "phoenix.db"));
    cleanups.push(() => w.kage.close());
    cleanups.push(() => w.github.close());
    cleanups.push(() => w.frappe.close());
    new PolicyAdmin({ store: new PolicyStore(w.db), audit: w.permissions.audit }).addRule(
      { kind: "user", id: "me", trustedByUser: true },
      { id: "no-github-writes", effect: "deny", match: { tool: "github.issue.create" } },
    );
    const meetingId = await kageMeeting(w);
    const { planId } = await approvedPlan(w, meetingId, { system: "github", repository: REPO });
    const report = await w.plans.create(planId, user);
    expect(report.plan.status).toBe("failed");
    expect(report.failure?.message).toMatch(/Denied/);
    expect(w.permissions.pendingConfirmations()).toEqual([]);
    expect(w.github.requests).toEqual([]);
  });

  it("without the write token the creation fails with a clear error and sends nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-plan-e2e-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const w = await boot(join(dir, "phoenix.db"));
    cleanups.push(() => w.kage.close());
    cleanups.push(() => w.github.close());
    cleanups.push(() => w.frappe.close());
    await w.manager.deleteSecret("github", "write_token");
    await w.manager.setSecret("github", "token", "read-only-token-for-polling");
    const meetingId = await kageMeeting(w);
    const { planId } = await approvedPlan(w, meetingId, { system: "github", repository: REPO });
    const report = (await answerPrompt(w, true, w.plans.create(planId, user))) as {
      plan: { status: string };
      failure: { message: string };
    };
    expect(report.plan.status).toBe("failed");
    expect(report.failure.message).toMatch(/write_token/);
    expect(w.github.requests).toEqual([]);
  });
});

function sentKey(body: unknown): string {
  if (
    typeof body !== "object" ||
    body === null ||
    !("body" in body) ||
    typeof body.body !== "string"
  ) {
    throw new Error("no body sent");
  }
  const found = /phoenix-ref:(\S+) -->/.exec(body.body)?.[1];
  if (!found) throw new Error("no marker in the body");
  return found;
}
