// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityManager } from "@phoenix/capability-manager";
import { EventBus } from "../../../core/event-bus/src";
import { PermissionGateway } from "@phoenix/permissions";
import { EventStore, MemorySecretStore, openDatabase, type Database } from "@phoenix/persistence";
import { PolicyAdmin, PolicyEngine, PolicyStore, type Actor } from "@phoenix/policy";
import { StateEngine } from "../../../core/state-engine/src";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitCapability } from "../../../capabilities/git/src";
import { approverFromPermissions, enabledManifests, ToolGateway, ToolRegistry } from "../src";

const user: Actor = { kind: "user", id: "me", trustedByUser: true };
const agent: Actor = { kind: "agent", id: "fawkes", trustedByUser: true };

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

/** The runtime's wiring, built from core packages over a real SQLite file. */
async function boot(path: string, repo: string) {
  const db: Database = openDatabase(path);
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
  cleanups.push(async () => {
    await manager.close();
    db.close();
  });
  manager.registerBuiltin(createGitCapability());
  manager.configure("git", { repositories: [repo], poll_ms: 60_000 });
  await manager.enable("git");

  const registry = new ToolRegistry({ manifests: enabledManifests(manager, db) });
  const policyStore = new PolicyStore(db);
  const policy = new PolicyEngine({
    store: policyStore,
    audit: permissions.audit,
    isKillSwitchEngaged: () => permissions.isKillSwitchEngaged(),
    isKnownTool: (t) => registry.has(t),
  });
  const admin = new PolicyAdmin({ store: policyStore, audit: permissions.audit });
  const gateway = new ToolGateway({
    host: {
      invokeAndWait: (id, cmd, input, actor) => manager.invokeAndWait(id, cmd, input, actor),
    },
    registry,
    policy,
    audit: permissions.audit,
    approver: approverFromPermissions(permissions),
  });
  return { db, permissions, policy, admin, gateway };
}

describe("real SQLite file, real PermissionGateway and CapabilityManager, real git capability", () => {
  it("git.status runs through the gateway; rules and audit survive a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-toolgw-real-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const repo = join(dir, "repo");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    execFileSync("git", ["init", "-q", "-b", "main", repo], { stdio: "ignore" });
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "T");
    git("config", "commit.gpgsign", "false");
    git("commit", "-q", "--allow-empty", "-m", "initial");
    const dbPath = join(dir, "phoenix.db");

    const first = await boot(dbPath, repo);
    first.admin.addRule(user, {
      id: "no-git-from-agents-at-night",
      effect: "deny",
      match: { tool: "git.*", actorKinds: ["agent"], time: { fromHourUtc: 3, toHourUtc: 4 } },
    });
    const ok = await first.gateway.call({
      actor: agent,
      tool: "git.status",
      input: {},
      environment: "local",
    });
    expect(ok.output).toMatchObject({ repositories: [{ path: repo, branch: "main" }] });
    const approval = first.admin.approveTemporarily({
      toolPattern: "git.status",
      scope: { environment: "staging", resource: "repo" },
      ttlMs: 3_600_000,
      by: user,
    });
    const auditedBefore = first.permissions.audit.count();
    expect(auditedBefore).toBeGreaterThan(3);
    await vi.waitFor(() =>
      expect(
        first.permissions.audit.list({ limit: 1000 }).some((e) => e.action === "tool.succeeded"),
      ).toBe(true),
    );

    // Restart: close everything, reopen the same file.
    await cleanups.pop()!();
    const second = await boot(dbPath, repo);
    expect(second.policy.rules().map((r) => r.id)).toEqual(["no-git-from-agents-at-night"]);
    expect(second.policy.approvals().map((a) => a.id)).toEqual([approval.id]);
    expect(second.permissions.audit.count()).toBeGreaterThanOrEqual(auditedBefore);
    const again = await second.gateway.call({
      actor: agent,
      tool: "git.status",
      input: {},
      environment: "local",
    });
    expect(again.auditId).toBeGreaterThan(ok.auditId);
    // The agent cannot touch the stored policy.
    expect(() => second.admin.removeRule(agent, "no-git-from-agents-at-night")).toThrow(
      /authenticated user/,
    );
    expect(second.policy.rules()).toHaveLength(1);
  });
});
