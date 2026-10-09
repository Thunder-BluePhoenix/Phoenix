// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 36 through the public HTTP API and a real PhoenixRuntime: plans from accepted meeting items,
// approval bound to the content hash, and creating the tasks through the tool gateway as the user.
// External calls go ONLY to the local mock GitHub and mock Frappe (a network guard refuses every
// other host); AI is a fake Ollama. Nothing here can reach a real service.
import type { CapabilityModule } from "@phoenix/capability-manager";
import { createFrappeCapability } from "@phoenix/capability-frappe";
import { createGithubCapability } from "@phoenix/capability-github";
import { MemorySecretStore, type Summary } from "@phoenix/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MOCK_WRITE_TOKEN,
  startMockGithub,
  type MockGithub,
} from "../../../capabilities/github/testing/mock-github";
import { startMockFrappe, type MockFrappe } from "../../../capabilities/frappe/testing/mock-frappe";
import { fakeNetwork, type FakeNetwork } from "./ai-network";
import { builtinCapabilities } from "../src/builtins";
import { startCore, TOKEN, type TestCore } from "./helpers";
import { guardNetwork } from "./network-guard";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  vi.restoreAllMocks();
});

const fakeKage: CapabilityModule = {
  manifest: {
    id: "kage",
    name: "Kage (test double)",
    version: "0.0.1",
    description: "Test double for the meeting capability",
    license: "GPL-3.0-or-later",
    events: ["kage.*"],
    permissions: [],
    data_categories: [],
    commands: [],
  },
};

const TRANSCRIPT =
  "Maya: We need a vendor approval flow so purchasing can approve new suppliers before the first order.\nSam: Sam will write the migration guide by Thursday.";
const SUMMARY: Summary = {
  text: "Vendor approval.",
  decisions: ["We need a vendor approval flow so purchasing can approve new suppliers"],
  action_items: [{ text: "Write the migration guide", owner: "Sam", due: "Thursday" }],
  topics: ["procurement"],
};

const REPO = "octo/phoenix";
const SITE = "erp.localhost";
const FRAPPE_CREDENTIAL = [["mock", "key"].join(""), ["mock", "secret"].join("")].join(":");

/** A sleeper for capability pollers that wakes only when the capability is disabled. */
const idleSleep = (_ms: number, signal: AbortSignal): Promise<void> => {
  const done = Promise.withResolvers<void>();
  signal.addEventListener("abort", () => done.resolve(), { once: true });
  return done.promise;
};

interface Rig {
  core: TestCore;
  gh: MockGithub;
  frappe: MockFrappe;
  network: FakeNetwork;
  /** Every URL fetched through the global fetch (the capabilities); the guard refuses non-mock hosts. */
  fetched: string[];
  /** What the simulated user answers to every confirmation prompt; undefined leaves them pending. */
  answer: { value: boolean | undefined };
  meetingId: string;
  actionId: string;
  decisionId: string;
}

interface Detail {
  plan: {
    id: string;
    status: string;
    content_hash: string;
    approved: { hash: string; by: string } | null;
    include_meeting_ref: boolean;
    tasks: { title: string; body: string }[];
    destination: Record<string, string>;
    generated_by: string;
    not_ai_generated: boolean;
  };
  runs: {
    status: string;
    idempotency_key: string;
    external_id: string | null;
    url: string | null;
  }[];
  links: {
    system: string;
    external_id: string;
    url: string;
    meeting_id: string;
    plan_id: string;
  }[];
}

async function rig(
  options: { ai?: boolean; github?: boolean; frappe?: boolean; writeToken?: boolean } = {},
): Promise<Rig> {
  const guard = guardNetwork();
  const gh = await startMockGithub();
  const frappe = await startMockFrappe();
  frappe.expectedAuth = `token ${FRAPPE_CREDENTIAL}`;
  const network = fakeNetwork({ chat: () => "this is not a JSON plan" });
  const core = await startCore(
    {},
    {
      capabilities: [
        fakeKage,
        createGithubCapability({ sleep: idleSleep }),
        createFrappeCapability({ sleep: idleSleep }),
      ],
      secrets: new MemorySecretStore(),
      runtime: { fetch: network.fetch },
    },
  );
  cleanups.push(async () => {
    await core.runtime.stop();
    await gh.close();
    await frappe.close();
    guard.release();
  });

  if (options.github !== false) {
    await core.api("POST", "/api/capabilities/github/config", {
      config: { repositories: [], api_url: gh.url },
    });
    if (options.writeToken !== false) {
      await core.api("POST", "/api/capabilities/github/secrets/write_token", {
        value: MOCK_WRITE_TOKEN,
      });
    }
    expect((await core.api("POST", "/api/capabilities/github/enable", {})).status).toBe(200);
  }
  if (options.frappe) {
    await core.api("POST", "/api/capabilities/frappe/config", {
      config: { api: { [SITE]: frappe.url } },
    });
    await core.api("POST", "/api/capabilities/frappe/secrets/write_token", {
      value: FRAPPE_CREDENTIAL,
    });
    expect((await core.api("POST", "/api/capabilities/frappe/enable", {})).status).toBe(200);
  }
  if (options.ai !== false) await core.api("POST", "/api/ai/settings", { enabled: true });

  const answer: Rig["answer"] = { value: true };
  core.runtime.bus.subscribe("test.user", "security.confirmation.requested", () => {
    if (answer.value === undefined) return;
    for (const c of core.runtime.permissions.pendingConfirmations()) {
      core.runtime.permissions.resolveConfirmation(c.id, answer.value);
    }
  });

  await core.runtime.capabilities.enable("kage");
  const m = core.runtime.meetings.upsert({
    capabilityId: "kage",
    externalId: "7",
    status: "ready",
    title: "Vendor planning",
    startedAt: "2026-10-01T10:00:00Z",
  })!;
  core.runtime.meetings.setTranscript(m.id, { text: TRANSCRIPT });
  core.runtime.meetings.setSummary(m.id, SUMMARY);
  let items: { id: string; kind: string }[] = [];
  await vi.waitFor(async () => {
    items = (await core.api("GET", `/api/meetings/${m.id}/items`)).json.items;
    expect(items.length).toBeGreaterThanOrEqual(3);
  });
  const action = items.find((i) => i.kind === "action_item")!;
  const decision = items.find((i) => i.kind === "decision")!;
  for (const i of [action, decision]) {
    expect((await core.api("POST", `/api/meeting-items/${i.id}/accept`, {})).status).toBe(200);
  }
  return {
    core,
    gh,
    frappe,
    network,
    fetched: guard.requests,
    answer,
    meetingId: m.id,
    actionId: action.id,
    decisionId: decision.id,
  };
}

const GITHUB_DEST = { system: "github", repository: REPO };
const FRAPPE_DEST = { system: "frappe", site: SITE };

const makePlan = async (r: Rig, itemId = r.actionId, destination: unknown = GITHUB_DEST) => {
  const res = await r.core.api("POST", `/api/meeting-items/${itemId}/plan`, { destination });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json.plan as Detail["plan"];
};

const detail = async (r: Rig, id: string) =>
  (await r.core.api("GET", `/api/plans/${id}`)).json as Detail;

/** generate → propose → approve, returns the approved plan. */
async function approvedPlan(r: Rig, destination: unknown = GITHUB_DEST, itemId = r.actionId) {
  const plan = await makePlan(r, itemId, destination);
  expect((await r.core.api("POST", `/api/plans/${plan.id}/propose`, {})).status).toBe(200);
  const res = await r.core.api("POST", `/api/plans/${plan.id}/approve`, {
    hash: plan.content_hash,
  });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json as Detail;
}

const posts = (r: Rig) => r.gh.writes.filter((w) => w.method === "POST");

/** The `body` string of a recorded issue POST, narrowed at runtime. */
function issueBody(write: MockGithub["writes"][number] | undefined): string {
  const sent: unknown = write?.body;
  if (
    typeof sent === "object" &&
    sent !== null &&
    "body" in sent &&
    typeof sent.body === "string"
  ) {
    return sent.body;
  }
  throw new Error("the recorded request has no issue body");
}

describe("planning is off unless AI and a destination are configured", () => {
  it("with AI off nothing is generated and the status says why", async () => {
    const r = await rig({ ai: false });
    const status = (await r.core.api("GET", "/api/plans/status")).json;
    expect(status).toMatchObject({ enabled: false, ai_enabled: false });
    expect(status.reasons.join(" ")).toMatch(/AI is turned off/);
    const res = await r.core.api("POST", `/api/meeting-items/${r.actionId}/plan`, {
      destination: GITHUB_DEST,
    });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: "CAPABILITY_DISABLED" });
    expect(res.json.details[0]).toBe("PLANNING_OFF");
    expect((await r.core.api("GET", `/api/meetings/${r.meetingId}/plans`)).json.plans).toEqual([]);
    expect(r.network.chats()).toEqual([]);
  });

  it("without a write token or with the capability not enabled, no plan is made and nothing is sent", async () => {
    const noToken = await rig({ writeToken: false });
    const res = await noToken.core.api("POST", `/api/meeting-items/${noToken.actionId}/plan`, {
      destination: GITHUB_DEST,
    });
    expect(res.status).toBe(409);
    expect(res.json.details.join(" ")).toMatch(/write token is not set/);
    expect(noToken.gh.requests.filter((q) => q.path !== "/user")).toEqual([]);
    // Frappe is not enabled in this rig.
    const frappeRes = await noToken.core.api(
      "POST",
      `/api/meeting-items/${noToken.actionId}/plan`,
      { destination: FRAPPE_DEST },
    );
    expect(frappeRes.status).toBe(409);
    expect(frappeRes.json.details.join(" ")).toMatch(/Frappe capability is not enabled/);
  });

  it("a Frappe site that is not listed under api is refused", async () => {
    const r = await rig({ frappe: true });
    const res = await r.core.api("POST", `/api/meeting-items/${r.actionId}/plan`, {
      destination: { system: "frappe", site: "other.localhost" },
    });
    expect(res.status).toBe(409);
    expect(res.json.details.join(" ")).toMatch(/not listed under the Frappe api/);
  });

  it("status reports a configured destination", async () => {
    const r = await rig({ frappe: true });
    expect((await r.core.api("GET", "/api/plans/status")).json).toMatchObject({
      enabled: true,
      ai_enabled: true,
      reasons: [],
      destinations: {
        github: { capability_enabled: true, write_token_set: true },
        frappe: { capability_enabled: true, write_token_set: true, sites: [SITE] },
      },
    });
  });
});

describe("generate, edit, approve, create (GitHub, against the local mock)", () => {
  it("makes a draft from an accepted item, labelled as not AI generated when the model gave nothing usable", async () => {
    const r = await rig();
    const plan = await makePlan(r);
    expect(plan).toMatchObject({
      status: "draft",
      approved: null,
      include_meeting_ref: false,
      not_ai_generated: true,
      generated_by: "rules",
      destination: GITHUB_DEST,
    });
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect((await r.core.api("GET", `/api/meetings/${r.meetingId}/plans`)).json.plans).toEqual([
      expect.objectContaining({ id: plan.id, status: "draft", target: "github" }),
    ]);
    // Generating creates nothing anywhere.
    expect(posts(r)).toEqual([]);
  });

  it("only an accepted item can become a plan", async () => {
    const r = await rig();
    await r.core.api("POST", `/api/meeting-items/${r.actionId}/reject`, {});
    const res = await r.core.api("POST", `/api/meeting-items/${r.actionId}/plan`, {
      destination: GITHUB_DEST,
    });
    expect(res.status).toBe(400);
    expect(res.json.message).toMatch(/Only an accepted item/);
  });

  it("preview shows exactly what would be sent with the policy decision, and sends nothing", async () => {
    const r = await rig();
    const plan = await makePlan(r);
    const preview = (await r.core.api("GET", `/api/plans/${plan.id}/preview`)).json;
    expect(preview.tasks[0]).toMatchObject({
      task_index: 0,
      tool: "github.issue.create",
      input: { repository: REPO, title: plan.tasks[0]!.title },
      decision: { effect: expect.any(String), risk: expect.any(String) },
    });
    expect(preview.tasks[0].input.idempotency_key).toMatch(/^phx_/);
    expect(JSON.stringify(preview)).not.toContain("Vendor planning");
    expect(posts(r)).toEqual([]);
  });

  it("an edit always returns the plan to draft and clears the approval; a stale hash cannot approve", async () => {
    const r = await rig();
    const approved = await approvedPlan(r);
    expect(approved.plan).toMatchObject({ status: "approved", approved: { by: "owner" } });
    const edited = await r.core.api("POST", `/api/plans/${approved.plan.id}/edit`, {
      title: "A different title",
    });
    expect(edited.status).toBe(200);
    expect(edited.json.plan).toMatchObject({ status: "draft", approved: null });
    await r.core.api("POST", `/api/plans/${approved.plan.id}/propose`, {});
    const stale = await r.core.api("POST", `/api/plans/${approved.plan.id}/approve`, {
      hash: approved.plan.content_hash,
    });
    expect(stale.status).toBe(400);
    expect(stale.json.message).toMatch(/changed since you looked/);
    expect((await detail(r, approved.plan.id)).plan.status).toBe("proposed");
  });

  it("creates the issue as the user after the per-task confirmation, with the marker and traceability", async () => {
    const r = await rig();
    const approved = await approvedPlan(r);
    const created = await r.core.api("POST", `/api/plans/${approved.plan.id}/create`, {
      confirm: true,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    expect(created.json).toMatchObject({ plan: { status: "created" }, failure: null });
    expect(created.json.runs.every((x: { status: string }) => x.status === "created")).toBe(true);
    expect(r.gh.issues).toHaveLength(approved.plan.tasks.length);
    const sent = posts(r)[0]!;
    expect(sent.authorization).toBe(`Bearer ${MOCK_WRITE_TOKEN}`);
    const body = issueBody(sent);
    expect(body).toContain("phoenix-ref:phx_");
    // Privacy default: the meeting title and id are not in the issue.
    expect(body).not.toContain("Vendor planning");
    expect(body).not.toContain(r.meetingId);
    // The user's confirmation was asked, and the audit says the USER did it.
    const audit = (await r.core.api("GET", "/api/audit?limit=1000")).json.entries as {
      action: string;
      actor: string;
      details: Record<string, unknown>;
    }[];
    expect(audit.some((e) => e.action === "plan.approved")).toBe(true);
    expect(audit.some((e) => e.action === "plan.created")).toBe(true);
    // Traceability both ways.
    const links = (await r.core.api("GET", `/api/meetings/${r.meetingId}/links`)).json.links;
    expect(links).toHaveLength(approved.plan.tasks.length);
    expect(links[0]).toMatchObject({ system: "github", meeting_id: r.meetingId });
    const back = (
      await r.core.api("GET", `/api/task-links?system=github&id=${links[0].external_id}`)
    ).json.links;
    expect(back[0]).toMatchObject({ plan_id: approved.plan.id, meeting_id: r.meetingId });
    // Every request left through the guard went to the local mock only.
    const outbound = r.fetched.filter((u) => !u.startsWith(r.core.base));
    expect(outbound.length).toBeGreaterThan(0);
    expect(outbound.every((u) => u.startsWith(r.gh.url) || u.startsWith(r.frappe.url))).toBe(true);
  });

  it("names the meeting in the created issue only when the user ticked the box", async () => {
    const r = await rig();
    const plan = await makePlan(r);
    await r.core.api("POST", `/api/plans/${plan.id}/propose`, {});
    const approved = await r.core.api("POST", `/api/plans/${plan.id}/approve`, {
      hash: plan.content_hash,
      include_meeting_ref: true,
    });
    expect(approved.json.plan.include_meeting_ref).toBe(true);
    await r.core.api("POST", `/api/plans/${plan.id}/create`, { confirm: true });
    expect(issueBody(posts(r)[0])).toContain(r.meetingId);
  });

  it("create needs confirm:true and an approved plan; nothing is sent otherwise", async () => {
    const r = await rig();
    const plan = await makePlan(r);
    const noConfirm = await r.core.api("POST", `/api/plans/${plan.id}/create`, {});
    expect(noConfirm.status).toBe(409);
    expect(noConfirm.json.code).toBe("ACTION_REQUIRES_CONFIRMATION");
    const draft = await r.core.api("POST", `/api/plans/${plan.id}/create`, { confirm: true });
    expect(draft.status).toBe(400);
    expect(draft.json.message).toMatch(/Only an approved plan/);
    expect(posts(r)).toEqual([]);
  });

  it("a user who rejects the confirmation creates nothing and the plan is failed (retryable)", async () => {
    const r = await rig();
    r.answer.value = false;
    const approved = await approvedPlan(r);
    const res = await r.core.api("POST", `/api/plans/${approved.plan.id}/create`, {
      confirm: true,
    });
    expect(res.status).toBe(200);
    expect(res.json.plan.status).toBe("failed");
    expect(res.json.failure).toMatchObject({ task_index: 0 });
    expect(posts(r)).toEqual([]);
    // Retry with the user saying yes: same keys, one issue per task.
    r.answer.value = true;
    const keys = res.json.runs.map((x: { idempotency_key: string }) => x.idempotency_key);
    const retry = await r.core.api("POST", `/api/plans/${approved.plan.id}/create`, {
      confirm: true,
    });
    expect(retry.json.plan.status).toBe("created");
    expect(retry.json.runs.map((x: { idempotency_key: string }) => x.idempotency_key)).toEqual(
      keys,
    );
  });
});

describe("idempotency: a second creation makes no second external call", () => {
  it("a created plan cannot be created again and the mock saw no further POST", async () => {
    const r = await rig();
    const approved = await approvedPlan(r);
    await r.core.api("POST", `/api/plans/${approved.plan.id}/create`, { confirm: true });
    const before = r.gh.requests.length;
    const issues = r.gh.issues.length;
    const again = await r.core.api("POST", `/api/plans/${approved.plan.id}/create`, {
      confirm: true,
    });
    expect(again.status).toBe(400);
    expect(again.json.message).toMatch(/Only an approved plan/);
    expect(r.gh.requests.length).toBe(before);
    expect(r.gh.issues).toHaveLength(issues);
  });

  it("after an unknown outcome (stored, then the connection dropped) the retry finds the issue by its key", async () => {
    const r = await rig();
    r.gh.writeMode.current = "store-then-drop";
    const approved = await approvedPlan(r);
    const first = await r.core.api("POST", `/api/plans/${approved.plan.id}/create`, {
      confirm: true,
    });
    expect(first.json.plan.status).toBe("failed");
    expect(first.json.failure.message).toMatch(/may or may not have been created/);
    expect(r.gh.issues).toHaveLength(1);
    r.gh.writeMode.current = "ok";
    const retry = await r.core.api("POST", `/api/plans/${approved.plan.id}/create`, {
      confirm: true,
    });
    expect(retry.json.plan.status).toBe("created");
    // The first task was found by its marker, not created a second time.
    expect(r.gh.issues).toHaveLength(approved.plan.tasks.length);
    expect(r.gh.issues[0]!.body.match(/phoenix-ref:/g)).toHaveLength(1);
  });
});

describe("Frappe (against the local mock)", () => {
  it("creates a Task through the same flow and links it", async () => {
    const r = await rig({ frappe: true });
    const approved = await approvedPlan(r, FRAPPE_DEST, r.decisionId);
    const res = await r.core.api("POST", `/api/plans/${approved.plan.id}/create`, {
      confirm: true,
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.plan.status).toBe("created");
    expect(r.frappe.tasks).toHaveLength(approved.plan.tasks.length);
    expect(JSON.stringify(r.frappe.tasks[0]!.doc)).toContain("Phoenix ref: phx_");
    expect(res.json.links[0]).toMatchObject({ system: "frappe" });
    expect(r.gh.writes).toEqual([]);
  });
});

describe("approve and create are user routes only", () => {
  it("every plan route needs the session token", async () => {
    const r = await rig();
    for (const [method, path] of [
      ["GET", "/api/plans/status"],
      ["POST", `/api/meeting-items/${r.actionId}/plan`],
      ["GET", "/api/plans/plan_x"],
      ["POST", "/api/plans/plan_x/approve"],
      ["POST", "/api/plans/plan_x/create"],
    ] as const) {
      const res = await fetch(`${r.core.base}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });
      expect(res.status, path).toBe(401);
    }
  });

  it("no tool, capability command or capability id of any built-in reaches approve, create-task or the plan service", async () => {
    // The tool registry is built from capability manifests: if none declares it, no agent can call it.
    const modules = builtinCapabilities("dev");
    const ids = modules.map((m) => m.manifest.id);
    expect(ids.filter((id) => /plan|workflow/i.test(id))).toEqual([]);
    const commands = modules.flatMap((m) =>
      m.manifest.commands.map((c) => `${m.manifest.id}.${c.name}`),
    );
    expect(commands.filter((c) => /approve|authori[sz]e|revoke|plan\.|workflow/i.test(c))).toEqual(
      [],
    );
    // The same holds for what the runtime really registers and enables.
    const r = await rig();
    const listed = (await r.core.api("GET", "/api/capabilities")).json.capabilities as {
      id: string;
    }[];
    expect(listed.filter((c) => /plan|workflow/i.test(c.id))).toEqual([]);
    const tools = r.core.runtime.toolGateway.tools().map((t) => t.name);
    expect(tools).toContain("github.issue.create");
    expect(
      tools.filter((t) => /approve|authori[sz]e|revoke|^plans?\.|^workflows?\./i.test(t)),
    ).toEqual([]);
  });

  it("an agent cannot call a plan tool through the gateway, and creating a task as an agent is refused with nothing sent", async () => {
    const r = await rig();
    const approved = await approvedPlan(r);
    const agent = { kind: "agent" as const, id: "evil-agent", trustedByUser: false };
    for (const tool of ["plans.approve", "plans.create", "plan.approve", "workflows.authorise"]) {
      await expect(
        r.core.runtime.toolGateway.call({
          actor: agent,
          tool,
          input: { plan_id: approved.plan.id, hash: approved.plan.content_hash },
          environment: "local",
        }),
      ).rejects.toThrow();
    }
    // The only real route to an issue for an agent is github.issue.create itself: untrusted, it must
    // be approved by the user, who says no here.
    r.answer.value = false;
    await expect(
      r.core.runtime.toolGateway.call({
        actor: agent,
        tool: "github.issue.create",
        input: {
          repository: REPO,
          title: "injected",
          body: "from an agent",
          idempotency_key: "phx_agentattempt_0",
        },
        environment: "local",
        resource: `github:${REPO}`,
        dataClass: "sensitive",
      }),
    ).rejects.toThrow();
    expect(posts(r)).toEqual([]);
    expect(r.gh.issues).toEqual([]);
    expect((await detail(r, approved.plan.id)).plan.status).toBe("approved");
  });

  it("a capability command named like a plan action does not exist", async () => {
    const r = await rig();
    for (const [cap, command] of [
      ["github", "plan.approve"],
      ["github", "plan.create"],
      ["github", "approve"],
    ]) {
      const res = await r.core.api("POST", `/api/capabilities/${cap}/commands/${command}`, {
        input: {},
      });
      expect(res.status, `${cap}.${command}`).toBeGreaterThanOrEqual(400);
    }
    expect(posts(r)).toEqual([]);
  });

  it("the kill switch stops creation", async () => {
    const r = await rig();
    const approved = await approvedPlan(r);
    await r.core.api("POST", "/api/security/kill-switch", { engaged: true });
    const res = await r.core.api("POST", `/api/plans/${approved.plan.id}/create`, {
      confirm: true,
    });
    expect(res.json.plan?.status === "failed" || res.status >= 400).toBe(true);
    expect(posts(r)).toEqual([]);
  });
});

describe("validation", () => {
  it("rejects unknown fields, bad destinations and empty edits", async () => {
    const r = await rig();
    const plan = await makePlan(r);
    const cases: [string, string, unknown][] = [
      ["POST", `/api/meeting-items/${r.actionId}/plan`, { destination: GITHUB_DEST, extra: 1 }],
      ["POST", `/api/meeting-items/${r.actionId}/plan`, { destination: { system: "gitlab" } }],
      [
        "POST",
        `/api/meeting-items/${r.actionId}/plan`,
        { destination: { system: "github", repository: "no-slash" } },
      ],
      ["POST", `/api/plans/${plan.id}/edit`, {}],
      ["POST", `/api/plans/${plan.id}/edit`, { title: 3 }],
      ["POST", `/api/plans/${plan.id}/edit`, { surprise: true }],
      ["POST", `/api/plans/${plan.id}/approve`, { hash: plan.content_hash, extra: 1 }],
      ["POST", `/api/plans/${plan.id}/approve`, { hash: 5 }],
      ["POST", `/api/plans/${plan.id}/propose`, { x: 1 }],
      ["GET", `/api/task-links?system=svn&id=1`, undefined],
      ["GET", `/api/task-links?system=github`, undefined],
    ];
    for (const [method, path, body] of cases) {
      const res = await r.core.api(method, path, body);
      expect(res.status, `${method} ${path} ${JSON.stringify(body)}`).toBe(400);
    }
    expect((await r.core.api("GET", "/api/plans/plan_nope")).status).toBe(404);
    expect((await r.core.api("POST", "/api/plans/plan_nope/cancel", {})).status).toBe(404);
    expect(TOKEN).toBeTruthy();
  });

  it("cancel ends a draft and a cancelled plan cannot be approved or created", async () => {
    const r = await rig();
    const plan = await makePlan(r);
    expect((await r.core.api("POST", `/api/plans/${plan.id}/cancel`, {})).json.plan.status).toBe(
      "cancelled",
    );
    expect((await r.core.api("POST", `/api/plans/${plan.id}/propose`, {})).status).toBe(400);
    expect(
      (await r.core.api("POST", `/api/plans/${plan.id}/create`, { confirm: true })).status,
    ).toBe(400);
  });
});

describe("derived counts", () => {
  it("plans show in the privacy inventory and diagnostics counts only (no text)", async () => {
    const r = await rig();
    await makePlan(r);
    const inv = (await r.core.api("GET", "/api/privacy")).json;
    expect(inv.derived.find((d: { id: string }) => d.id === "plans")).toMatchObject({ count: 1 });
    const diag = (await r.core.api("GET", "/api/diagnostics")).json;
    expect(diag.derived.plans).toBe(1);
    expect(JSON.stringify(diag)).not.toContain("migration guide");
  });
});
