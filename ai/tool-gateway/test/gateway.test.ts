// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CapabilityModule, Operation } from "@phoenix/capability-manager";
import {
  assertAudited,
  PolicyAdmin,
  PolicyEngine,
  PolicyStore,
  type Actor,
  type PolicyAuditSink,
} from "@phoenix/policy";
import type { CapabilityManifest } from "@phoenix/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitCapability } from "../../../capabilities/git/src";
import { createHarness, type Harness } from "../../../sdk/testing/src";
import {
  approverFromPermissions,
  enabledManifests,
  ToolGateway,
  ToolGatewayError,
  ToolRegistry,
  type CapabilityHost,
  type ToolCall,
} from "../src";

const user: Actor = { kind: "user", id: "me", trustedByUser: true };
const agent: Actor = { kind: "agent", id: "fawkes", trustedByUser: true };

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const c of cleanups.splice(0).reverse()) await c();
});

interface Calls {
  names: string[];
}

/** A write-class and a read-class mock capability; handlers record that they ran. */
function mockCapability(
  calls: Calls,
  over: { slowMs?: number; output?: unknown } = {},
): CapabilityModule {
  const manifest: CapabilityManifest = {
    id: "notes",
    name: "Notes",
    version: "1.0.0",
    description: "Test notes",
    license: "GPL-3.0-or-later",
    events: ["notes.*"],
    permissions: ["filesystem_write"],
    commands: [
      {
        name: "list",
        description: "List notes",
        side_effect: "read",
        permissions: [],
      },
      {
        name: "save",
        description: "Save a note",
        side_effect: "write",
        permissions: ["filesystem_write"],
        input_schema: {
          type: "object",
          required: ["title"],
          additionalProperties: false,
          properties: { title: { type: "string", maxLength: 50 } },
        },
      },
      {
        name: "deploy",
        description: "Deploy to production",
        side_effect: "production",
        permissions: ["production_action"],
      },
    ],
  };
  return {
    manifest: { ...manifest, permissions: ["filesystem_write", "production_action"] },
    commands: {
      list: () => {
        calls.names.push("list");
        return over.output ?? { notes: [] };
      },
      save: (input) => {
        calls.names.push("save");
        const title =
          typeof input === "object" && input !== null && "title" in input ? input.title : null;
        return { saved: title };
      },
      deploy: () => {
        calls.names.push("deploy");
        return { ok: true };
      },
    },
  };
}

async function setup(
  modules: CapabilityModule[],
  options: {
    audit?: (real: PolicyAuditSink) => PolicyAuditSink;
    host?: (real: CapabilityHost) => CapabilityHost;
    retries?: number;
    approvalWaitMs?: number;
    outputSchemas?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const h: Harness = createHarness({ modules });
  cleanups.push(() => h.close());
  for (const m of modules) await h.enable(m.manifest.id);
  let nowMs = Date.now();
  const store = new PolicyStore(h.db);
  const manifests = enabledManifests(h.manager, h.db);
  const registry = new ToolRegistry({
    manifests,
    ...(options.outputSchemas ? { outputSchemas: options.outputSchemas } : {}),
  });
  const audit = options.audit ? options.audit(h.permissions.audit) : h.permissions.audit;
  const policy = new PolicyEngine({
    store,
    audit,
    isKillSwitchEngaged: () => h.permissions.isKillSwitchEngaged(),
    isKnownTool: (t) => registry.has(t),
    now: () => nowMs,
  });
  const admin = new PolicyAdmin({ store, audit: h.permissions.audit, now: () => nowMs });
  const realHost: CapabilityHost = {
    invokeAndWait: (id, command, input, actor) =>
      h.manager.invokeAndWait(id, command, input, actor),
  };
  const gateway = new ToolGateway({
    host: options.host ? options.host(realHost) : realHost,
    registry,
    policy,
    audit,
    approver: approverFromPermissions(h.permissions),
    now: () => nowMs,
    ...(options.retries === undefined ? {} : { idempotentRetries: options.retries }),
    ...(options.approvalWaitMs === undefined ? {} : { approvalWaitMs: options.approvalWaitMs }),
  });
  /** Answers confirmation prompts like the Pet Panel would. */
  const answer = async (approved: boolean) => {
    await vi.waitFor(() => expect(h.permissions.pendingConfirmations().length).toBeGreaterThan(0));
    for (const c of h.permissions.pendingConfirmations())
      h.permissions.resolveConfirmation(c.id, approved);
  };
  return {
    h,
    gateway,
    policy,
    admin,
    registry,
    store,
    answer,
    setNow: (ms: number) => (nowMs = ms),
  };
}

const call = (tool: string, over: Partial<ToolCall> = {}): ToolCall => ({
  actor: agent,
  tool,
  input: {},
  environment: "local",
  ...over,
});

async function failure(p: Promise<unknown>): Promise<ToolGatewayError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ToolGatewayError) return err;
    throw err;
  }
  throw new Error("expected the call to fail");
}

const actions = (h: Harness) =>
  h.permissions.audit
    .list({ limit: 1000 })
    .reverse()
    .map((e) => e.action);

describe("registry", () => {
  it("turns every command of an enabled capability into a tool with manifest-declared safety data", async () => {
    const { registry } = await setup([mockCapability({ names: [] })]);
    const save = registry.get("notes.save")?.contract;
    expect(save).toMatchObject({
      name: "notes.save",
      capabilityId: "notes",
      command: "save",
      sideEffect: "write",
      permissions: ["filesystem_write"],
      idempotent: false,
      timeoutMs: 10_000,
      auditMetadata: { capabilityName: "Notes", capabilityVersion: "1.0.0" },
    });
    expect(registry.get("notes.list")?.contract).toMatchObject({
      idempotent: true,
      sideEffect: "read",
    });
    expect(registry.list().map((t) => t.name)).toEqual([
      "notes.deploy",
      "notes.list",
      "notes.save",
    ]);
    expect(registry.get("notes.nope")).toBeUndefined();
    expect(registry.get("notes")).toBeUndefined();
    expect(registry.get("note.save")).toBeUndefined();
  });

  it("drops the tools of a disabled capability", async () => {
    const s = await setup([mockCapability({ names: [] })]);
    await s.h.manager.disable("notes");
    expect(s.registry.list()).toEqual([]);
    expect(s.registry.has("notes.list")).toBe(false);
  });
});

describe("call: validation before anything else", () => {
  it("denies and audits an unknown tool without reaching the capability", async () => {
    const calls: Calls = { names: [] };
    const { gateway, h } = await setup([mockCapability(calls)]);
    const err = await failure(gateway.call(call("notes.delete_everything")));
    expect(err.code).toBe("UNKNOWN_TOOL");
    expect(err.decision?.matched).toEqual(["builtin:unknown-tool"]);
    expect(calls.names).toEqual([]);
    expect(h.permissions.audit.list()[0]).toMatchObject({
      action: "policy.decision",
      decision: "denied",
    });
  });

  it("denies tool names that are not even strings", async () => {
    const { gateway } = await setup([mockCapability({ names: [] })]);
    const err = await failure(
      gateway.call(call({ toString: () => "notes.list" } as unknown as string)),
    );
    expect(err.code).toBe("UNKNOWN_TOOL");
  });

  it("rejects schema-invalid input before policy and before the capability", async () => {
    const calls: Calls = { names: [] };
    const { gateway, h } = await setup([mockCapability(calls)]);
    for (const input of [
      {},
      { title: 5 },
      { title: "x", extra: 1 },
      { title: "x".repeat(51) },
      null,
      "title",
    ]) {
      const err = await failure(gateway.call(call("notes.save", { actor: user, input })));
      expect(err.code, JSON.stringify(input)).toBe("INVALID_INPUT");
    }
    expect(calls.names).toEqual([]);
    expect(actions(h)).not.toContain("policy.decision");
    expect(actions(h)).toContain("tool.input_rejected");
  });

  it("commands without an input schema accept only an empty object", async () => {
    const calls: Calls = { names: [] };
    const { gateway } = await setup([mockCapability(calls)]);
    expect(
      (await failure(gateway.call(call("notes.list", { input: { path: "/etc/passwd" } })))).code,
    ).toBe("INVALID_INPUT");
    await gateway.call(call("notes.list"));
    expect(calls.names).toEqual(["list"]);
  });

  it("refuses oversized input", async () => {
    const { gateway } = await setup([mockCapability({ names: [] })]);
    const big = { title: "x".repeat(300 * 1024) };
    const err = await failure(gateway.call(call("notes.save", { actor: user, input: big })));
    expect(err.code).toBe("INVALID_INPUT");
  });
});

describe("call: policy decides, the existing confirmation flow approves", () => {
  it("runs a low-risk read for an agent with no prompt and records decision then outcome", async () => {
    const calls: Calls = { names: [] };
    const { gateway, h } = await setup([mockCapability(calls)]);
    const result = await gateway.call(call("notes.list"));
    expect(result.output).toEqual({ notes: [] });
    expect(result.decision).toMatchObject({ effect: "allow", risk: "low" });
    expect(h.permissions.pendingConfirmations()).toEqual([]);
    const log = actions(h);
    expect(log.indexOf("policy.decision")).toBeGreaterThanOrEqual(0);
    expect(log.indexOf("policy.decision")).toBeLessThan(log.indexOf("action.authorized"));
    expect(log.indexOf("action.authorized")).toBeLessThan(log.indexOf("tool.succeeded"));
    const decision = h.permissions.audit
      .list({ limit: 1000 })
      .find((e) => e.action === "policy.decision");
    expect(decision?.id).toBe(result.auditId);
    expect(decision?.details).toMatchObject({
      tool: "notes.list",
      attempt: 1,
      origin: "tool-gateway",
    });
  });

  it("an agent's write waits for the user's approval through PermissionGateway, then runs", async () => {
    const calls: Calls = { names: [] };
    const { gateway, answer, h } = await setup([mockCapability(calls)]);
    const pending = gateway.call(call("notes.save", { input: { title: "hello" } }));
    await answer(true);
    const result = await pending;
    expect(result.output).toEqual({ saved: "hello" });
    expect(result.decision).toMatchObject({ effect: "require_approval", risk: "medium" });
    expect(calls.names).toEqual(["save"]);
    expect(actions(h)).toEqual(
      expect.arrayContaining([
        "policy.decision",
        "confirmation.requested",
        "confirmation.approved",
        "action.authorized",
        "tool.succeeded",
      ]),
    );
    // exactly one prompt: policy does not add a second one on top of the manager's
    expect(actions(h).filter((a) => a === "confirmation.requested")).toHaveLength(1);
  });

  it("a rejected approval never runs the tool", async () => {
    const calls: Calls = { names: [] };
    const { gateway, answer } = await setup([mockCapability(calls)]);
    const pending = gateway.call(call("notes.save", { input: { title: "no" } }));
    const failed = failure(pending);
    await answer(false);
    expect((await failed).code).toBe("APPROVAL_REJECTED");
    expect(calls.names).toEqual([]);
  });

  it("the user acting directly runs medium-risk work without a policy prompt (the manager still confirms writes)", async () => {
    const calls: Calls = { names: [] };
    const { gateway, answer } = await setup([mockCapability(calls)]);
    const pending = gateway.call(call("notes.save", { actor: user, input: { title: "mine" } }));
    await answer(true);
    expect((await pending).decision.effect).toBe("allow");
    expect(calls.names).toEqual(["save"]);
  });

  it("a temporary approval lets an agent's medium-risk write skip policy escalation until it expires, but the manager still confirms writes", async () => {
    const calls: Calls = { names: [] };
    const { gateway, admin, answer, setNow } = await setup([mockCapability(calls)]);
    const base = Date.now();
    setNow(base);
    const a = admin.approveTemporarily({
      toolPattern: "notes.save",
      scope: { environment: "local", resource: "inbox" },
      ttlMs: 60_000,
      by: user,
    });
    const first = gateway.call(call("notes.save", { input: { title: "a" }, resource: "inbox" }));
    await answer(true);
    const r = await first;
    expect(r.decision).toMatchObject({ effect: "allow", matched: [a.id] });
    setNow(a.expiresAt);
    const second = gateway.call(call("notes.save", { input: { title: "b" }, resource: "inbox" }));
    await answer(true);
    expect((await second).decision.effect).toBe("require_approval");
  });

  it("production actions are critical: approval is required for the user too and agents cannot be pre-approved", async () => {
    const calls: Calls = { names: [] };
    const { gateway, admin, answer } = await setup([mockCapability(calls)]);
    admin.approveTemporarily({
      toolPattern: "notes.deploy",
      scope: { environment: "production", resource: "svc" },
      ttlMs: 1000,
      by: user,
    });
    const pending = gateway.call(
      call("notes.deploy", { environment: "production", resource: "svc" }),
    );
    await answer(false);
    expect((await failure(pending)).decision).toMatchObject({
      effect: "require_approval",
      risk: "critical",
    });
    expect(calls.names).toEqual([]);
  });

  it("a read in production by an agent is high risk: policy asks through the PermissionGateway", async () => {
    const calls: Calls = { names: [] };
    const { gateway, answer, h } = await setup([mockCapability(calls)]);
    const pending = gateway.call(call("notes.list", { environment: "production" }));
    await answer(true);
    const result = await pending;
    expect(result.decision).toMatchObject({ effect: "require_approval", risk: "high" });
    expect(calls.names).toEqual(["list"]);
    const requested = h.permissions.audit
      .list({ limit: 1000 })
      .find((e) => e.action === "confirmation.requested");
    expect(requested).toBeDefined();
  });

  it("deny rules block, the kill switch blocks, and neither reaches the capability", async () => {
    const calls: Calls = { names: [] };
    const { gateway, admin, h } = await setup([mockCapability(calls)]);
    admin.addRule(user, {
      id: "no-list",
      effect: "deny",
      match: { tool: "notes.list", actorKinds: ["agent"] },
    });
    expect((await failure(gateway.call(call("notes.list")))).code).toBe("DENIED");
    h.permissions.engageKillSwitch();
    const err = await failure(gateway.call(call("notes.list", { actor: user })));
    expect(err.decision?.matched).toEqual(["builtin:kill-switch"]);
    expect(calls.names).toEqual([]);
  });

  it("an untrusted-origin write is escalated even for a user actor, and a rejected approval ends it", async () => {
    const calls: Calls = { names: [] };
    const { gateway, answer } = await setup([mockCapability(calls)]);
    const pending = failure(
      gateway.call(
        call("notes.save", { actor: { ...user, trustedByUser: false }, input: { title: "t" } }),
      ),
    );
    await answer(false);
    expect((await pending).decision?.matched).toEqual(["builtin:untrusted-origin"]);
    expect(calls.names).toEqual([]);
  });
});

describe("bypass resistance", () => {
  it("an audit store that fails blocks execution: the tool does not run", async () => {
    const calls: Calls = { names: [] };
    const { gateway, h } = await setup([mockCapability(calls)], {
      audit: (real) => ({
        record: (entry) => {
          if (entry.action === "policy.decision") throw new Error("disk full");
          return real.record(entry);
        },
      }),
    });
    const err = await failure(gateway.call(call("notes.list")));
    expect(err.code).toBe("AUDIT_FAILED");
    expect(calls.names).toEqual([]);
    expect(h.permissions.pendingConfirmations()).toEqual([]);
  });

  it("an audit store that fails for every write blocks reads, writes and denies alike", async () => {
    const calls: Calls = { names: [] };
    const { gateway } = await setup([mockCapability(calls)], {
      audit: () => ({
        record: () => {
          throw new Error("read-only filesystem");
        },
      }),
    });
    for (const [tool, input] of [
      ["notes.list", {}],
      ["notes.save", { title: "x" }],
      ["notes.deploy", {}],
    ] as const) {
      const err = await failure(gateway.call(call(tool, { actor: user, input })));
      expect(err.code).toBe("AUDIT_FAILED");
    }
    expect(calls.names).toEqual([]);
  });

  it("the decision is committed to the audit log before the capability host is called", async () => {
    const calls: Calls = { names: [] };
    const order: string[] = [];
    const { gateway } = await setup([mockCapability(calls)], {
      audit: (real) => ({
        record: (entry) => {
          order.push(`audit:${entry.action}`);
          return real.record(entry);
        },
      }),
      host: (real) => ({
        invokeAndWait: (...args) => {
          order.push("host");
          return real.invokeAndWait(...args);
        },
      }),
    });
    await gateway.call(call("notes.list"));
    expect(order.indexOf("audit:policy.decision")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("audit:policy.decision")).toBeLessThan(order.indexOf("host"));
  });

  it("a denied call never invokes the host", async () => {
    const hostCalls: string[] = [];
    const { gateway, admin } = await setup([mockCapability({ names: [] })], {
      host: (real) => ({
        invokeAndWait: (...args) => {
          hostCalls.push(args[1]);
          return real.invokeAndWait(...args);
        },
      }),
    });
    admin.addRule(user, { id: "d", effect: "deny", match: { tool: "notes.*" } });
    await failure(gateway.call(call("notes.list")));
    await failure(gateway.call(call("notes.nope")));
    expect(hostCalls).toEqual([]);
  });

  it("a caller cannot override side effect or permissions: only the manifest counts", async () => {
    const calls: Calls = { names: [] };
    const { gateway, answer } = await setup([mockCapability(calls)]);
    const forged = {
      ...call("notes.save", { input: { title: "x" } }),
      sideEffect: "none",
      permissions: [],
      environment: "local",
    };
    const pending = gateway.call(forged as ToolCall);
    await answer(false);
    const err = await failure(pending);
    expect(err.decision).toMatchObject({ effect: "require_approval", risk: "medium" });
    expect(calls.names).toEqual([]);
  });

  it("a capability that is disabled is not callable, and one disabled between decision and run fails closed", async () => {
    const calls: Calls = { names: [] };
    const s = await setup([mockCapability(calls)]);
    await s.h.manager.disable("notes");
    expect((await failure(s.gateway.call(call("notes.list")))).code).toBe("UNKNOWN_TOOL");

    const calls2: Calls = { names: [] };
    const racing = await setup([mockCapability(calls2)], {
      host: (real) => ({
        invokeAndWait: async (...args) => {
          await racingHolder.h?.manager.disable("notes");
          return real.invokeAndWait(...args);
        },
      }),
    });
    racingHolder.h = racing.h;
    const err = await failure(racing.gateway.call(call("notes.list")));
    expect(err.code).toBe("CAPABILITY_DISABLED");
    expect(calls2.names).toEqual([]);
  });

  it("a hand-made decision cannot be used to execute", () => {
    expect(() =>
      assertAudited({
        decision: { effect: "allow", risk: "low", reasons: [], matched: [] },
        auditId: 1,
      }),
    ).toThrow(/not issued/);
  });
});

const racingHolder: { h?: Harness } = {};

describe("outcomes", () => {
  it("validates output against the declared output schema", async () => {
    const calls: Calls = { names: [] };
    const schemas = {
      "notes.list": {
        type: "object",
        required: ["notes"],
        properties: { notes: { type: "array", items: { type: "string" } } },
      },
    };
    const ok = await setup([mockCapability(calls, { output: { notes: ["a"] } })], {
      outputSchemas: schemas,
    });
    expect((await ok.gateway.call(call("notes.list"))).output).toEqual({ notes: ["a"] });
    const bad = await setup([mockCapability(calls, { output: { notes: [1] } })], {
      outputSchemas: schemas,
    });
    const err = await failure(bad.gateway.call(call("notes.list")));
    expect(err.code).toBe("INVALID_OUTPUT");
    expect(actions(bad.h)).toContain("tool.invalid_output");
  });

  it("rejects absurdly large output", async () => {
    const { gateway } = await setup([
      mockCapability({ names: [] }, { output: { blob: "x".repeat(1024 * 1024 + 1) } }),
    ]);
    expect((await failure(gateway.call(call("notes.list")))).code).toBe("INVALID_OUTPUT");
  });

  it("reports a failing command and audits the failure", async () => {
    const m = mockCapability({ names: [] });
    m.commands!.list = () => {
      throw new Error("boom");
    };
    const { gateway, h } = await setup([m]);
    const err = await failure(gateway.call(call("notes.list")));
    expect(err.code).toBe("EXECUTION_FAILED");
    expect(actions(h)).toContain("action.failed");
  });

  it("enforces the tool timeout when the host never answers, and does not retry a non-idempotent tool", async () => {
    vi.useFakeTimers();
    const attempts: string[] = [];
    const { gateway } = await setup([mockCapability({ names: [] })], {
      approvalWaitMs: 0,
      retries: 3,
      host: () => ({
        invokeAndWait: () => {
          attempts.push("save");
          return new Promise<Operation>(() => {});
        },
      }),
    });
    const pending = failure(
      gateway.call(call("notes.save", { actor: user, input: { title: "x" } })),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const err = await pending;
    expect(err.code).toBe("TIMEOUT");
    expect(err.message).toContain("outcome is unknown");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toEqual(["save"]);
  });

  it("retries an idempotent tool after a timeout with a fresh decision and audit record each time", async () => {
    vi.useFakeTimers();
    let n = 0;
    const calls: Calls = { names: [] };
    const { gateway, h } = await setup([mockCapability(calls)], {
      approvalWaitMs: 0,
      retries: 1,
      host: (real) => ({
        invokeAndWait: (...args) => {
          n++;
          return n === 1 ? new Promise<Operation>(() => {}) : real.invokeAndWait(...args);
        },
      }),
    });
    const pending = gateway.call(call("notes.list"));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(100); // the manager polls its operation on a 5 ms timer
    const result = await pending;
    expect(result.output).toEqual({ notes: [] });
    expect(n).toBe(2);
    const decisions = h.permissions.audit
      .list({ limit: 1000 })
      .filter((e) => e.action === "policy.decision");
    expect(decisions.map((d) => d.details.attempt).sort()).toEqual([1, 2]);
  });

  it("only timeouts are retried: a failing command runs once even with retries enabled", async () => {
    const m = mockCapability({ names: [] });
    let runs = 0;
    m.commands!.list = () => {
      runs++;
      throw new Error("bad");
    };
    const { gateway } = await setup([m], { retries: 5 });
    await failure(gateway.call(call("notes.list")));
    expect(runs).toBe(1);
  });
});

describe("real end to end: git status through the gateway", () => {
  it("runs the real git capability against a throwaway repository, audited", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-toolgw-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    sh("init", "-q", "-b", "main");
    sh("config", "user.email", "t@example.invalid");
    sh("config", "user.name", "T");
    sh("config", "commit.gpgsign", "false");
    sh("commit", "-q", "--allow-empty", "-m", "initial");

    const git = createGitCapability();
    const s = await setup([]);
    s.h.manager.registerBuiltin(git);
    s.h.manager.configure("git", { repositories: [dir], poll_ms: 60_000 });
    await s.h.enable("git");
    expect(s.registry.list().map((t) => t.name)).toEqual(["git.status"]);

    const result = await s.gateway.call(call("git.status"));
    expect(result.output).toMatchObject({
      repositories: [{ path: dir, branch: "main", changed: 0 }],
    });
    expect(result.decision).toMatchObject({ effect: "allow", risk: "low" });
    const log = s.h.permissions.audit.list({ limit: 1000 }).filter((e) => e.capabilityId === "git");
    expect(log.map((e) => e.action)).toEqual(
      expect.arrayContaining(["policy.decision", "action.authorized", "tool.succeeded"]),
    );
  });
});
