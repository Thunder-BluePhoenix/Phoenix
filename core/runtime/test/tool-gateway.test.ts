// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 30 wiring: the runtime's own ToolGateway in front of a real built-in capability.
import { ToolGatewayError } from "@phoenix/ai-tool-gateway";
import type { CapabilityModule } from "@phoenix/capability-manager";
import { mockCapability } from "@phoenix/capability-mock";
import { PolicyAdmin, PolicyError, PolicyStore, type Actor } from "@phoenix/policy";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

const agent: Actor = { kind: "agent", id: "fawkes", trustedByUser: true };
const user: Actor = { kind: "user", id: "me", trustedByUser: true };

let core: TestCore | undefined;
afterEach(async () => {
  await core?.runtime.stop();
  core = undefined;
});

interface AuditRow {
  id: number;
  action: string;
  details: Record<string, unknown>;
}
const auditRows = async (c: TestCore) =>
  ((await c.api("GET", "/api/audit?limit=200")).json.entries as AuditRow[]).toSorted(
    (a, b) => a.id - b.id,
  );

/** The mock capability with a handler that records the audit position at the moment it runs. */
function probed(c: () => TestCore, seen: { auditCountAtRun: number | null }): CapabilityModule {
  return {
    ...mockCapability,
    commands: {
      ...mockCapability.commands,
      ping: () => {
        seen.auditCountAtRun = c().runtime.permissions.audit.count();
        return "pong";
      },
    },
  };
}

describe("runtime tool gateway", () => {
  it("is exposed on the runtime, lists only enabled capabilities, and denies tools of disabled ones", async () => {
    core = await startCore({}, { capabilities: [mockCapability] });
    expect(core.runtime.toolGateway.tools()).toEqual([]);
    const denied = await core.runtime.toolGateway
      .call({ actor: agent, tool: "mock.ping", input: {}, environment: "local" })
      .catch((e: unknown) => e);
    expect(denied).toBeInstanceOf(ToolGatewayError);
    expect((denied as ToolGatewayError).code).toBe("UNKNOWN_TOOL");
    await core.runtime.capabilities.enable("mock");
    expect(core.runtime.toolGateway.tools().map((t) => t.name)).toContain("mock.ping");
  });

  it("writes the policy decision to the audit log BEFORE the capability runs", async () => {
    const seen = { auditCountAtRun: null as number | null };
    core = await startCore({}, { capabilities: [probed(() => core!, seen)] });
    await core.runtime.capabilities.enable("mock");
    const before = core.runtime.permissions.audit.count();
    const result = await core.runtime.toolGateway.call({
      actor: agent,
      tool: "mock.ping",
      input: {},
      environment: "local",
    });
    expect(result.output).toBe("pong");
    expect(result.decision.effect).toBe("allow");
    // At the moment the handler ran, the decision was already in the log.
    expect(seen.auditCountAtRun).toBeGreaterThan(before);
    const rows = await auditRows(core);
    const decision = rows.find((r) => r.id === result.auditId);
    expect(decision?.action).toBe("policy.decision");
    expect(decision?.details).toMatchObject({ tool: "mock.ping" });
    const authorized = rows.find((r) => r.action === "action.authorized" && r.id > result.auditId);
    expect(authorized).toBeDefined();
  });

  it("a denied call (kill switch) never reaches the capability, and is audited", async () => {
    const seen = { auditCountAtRun: null as number | null };
    core = await startCore({}, { capabilities: [probed(() => core!, seen)] });
    await core.runtime.capabilities.enable("mock");
    core.runtime.permissions.engageKillSwitch("user");
    const err = await core.runtime.toolGateway
      .call({ actor: agent, tool: "mock.ping", input: {}, environment: "local" })
      .catch((e: unknown) => e);
    expect((err as ToolGatewayError).code).toBe("DENIED");
    expect(seen.auditCountAtRun).toBeNull();
    const rows = await auditRows(core);
    expect(rows.some((r) => r.action === "policy.decision")).toBe(true);
  });

  it("an agent cannot change policy: PolicyAdmin refuses it, and no route exposes policy", async () => {
    core = await startCore({}, { capabilities: [mockCapability] });
    // The runtime keeps PolicyAdmin private; build one over the same store to prove the refusal
    // is the class's own, not an accident of how it was wired.
    const admin = new PolicyAdmin({
      store: new PolicyStore(core.runtime.db),
      audit: core.runtime.permissions.audit,
    });
    const rule = {
      effect: "allow",
      tools: ["mock.*"],
      environments: ["production"],
    };
    expect(() => admin.addRule(agent, rule)).toThrow(PolicyError);
    expect(() => admin.addRule({ ...user, trustedByUser: false }, rule)).toThrow(PolicyError);
    expect(() =>
      admin.approveTemporarily({
        toolPattern: "mock.ping",
        scope: { environment: "local", resource: "x" },
        ttlMs: 60_000,
        by: agent,
      }),
    ).toThrow(PolicyError);
    const refused = (await auditRows(core)).filter(
      (r) => r.action.startsWith("policy.") && r.action.includes("refus"),
    );
    expect(refused.length).toBeGreaterThanOrEqual(3);
    for (const path of [
      "/api/policy",
      "/api/policy/rules",
      "/api/policy/approvals",
      "/api/tools",
      "/api/tool-gateway",
    ]) {
      for (const method of ["GET", "POST"]) {
        expect(
          (await core.api(method, path, method === "POST" ? {} : undefined)).status,
          `${method} ${path}`,
        ).toBe(404);
      }
    }
  });
});
