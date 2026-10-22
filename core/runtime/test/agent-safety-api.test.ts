// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The agent safety net through a real Core (HTTP API, event bus, permission gateway, privacy
// service) against a temp git repository. The "agent" is a scripted fake: steps are posted the way
// the hook's relay would deliver them. Simulated: no real agent session was involved.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

const SESSION = "5f1c1b0e-6a0e-4f43-8d7d-0a6a3f4b2c11";
const dirs: string[] = [];
let core: TestCore | undefined;
afterEach(async () => {
  await core?.runtime.stop();
  core = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    },
  });
}

function project(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phoenix-safety-api-")));
  dirs.push(root);
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "a.txt"), "original\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "initial");
  return root;
}

const stepBody = (root: string) => ({
  agent: "claude-code",
  session_id: SESSION,
  project: root,
  kind: "edit",
  tool: "Edit",
  target: join(root, "a.txt"),
  at: new Date().toISOString(),
});

/** Resolves with the confirmation card as soon as Core publishes it (no polling, no timers). */
function nextConfirmation(c: TestCore) {
  const { promise, resolve } = Promise.withResolvers<string>();
  const off = c.runtime.bus.subscribe(
    "test-confirmation",
    "security.confirmation.requested",
    (e) => {
      resolve(String(e.payload.confirmation_id));
    },
  );
  return promise.finally(off);
}

async function settle(c: TestCore) {
  await c.runtime.bus.drain();
}

describe("agent safety net API", () => {
  it("checkpoints on the first reported edit, previews, and rolls back after the owner approves the bound preview", async () => {
    core = await startCore();
    const root = project();
    expect((await core.api("POST", "/api/agent/live/step", stepBody(root))).status).toBe(200);
    await settle(core);

    const status = (await core.api("GET", "/api/agent-safety")).json;
    expect(status.checkpoints).toHaveLength(1);
    expect(status.settings).toMatchObject({ enabled: true, retention_days: 7, notify: true });
    const cp = status.checkpoints[0];
    // No file path of the user's machine is exposed: the folder name only.
    expect(JSON.stringify(status)).not.toContain(root);

    writeFileSync(join(root, "a.txt"), "the agent changed this\n");
    writeFileSync(join(root, "made-by-agent.txt"), "new\n");
    const preview = (await core.api("GET", `/api/agent-safety/checkpoints/${cp.id}/preview`)).json;
    expect(preview.restore).toEqual([{ path: "a.txt", change: "modified" }]);
    expect(preview.remove).toEqual(["made-by-agent.txt"]);
    expect(preview.preview_hash).toMatch(/^[0-9a-f]{64}$/);

    // The rollback waits for the owner: a confirmation card appears and nothing moves until then.
    const asked = nextConfirmation(core);
    const pending = core.api("POST", `/api/agent-safety/checkpoints/${cp.id}/rollback`, {
      preview_hash: preview.preview_hash,
    });
    const cardId = await asked;
    const card = (await core.api("GET", "/api/confirmations")).json.confirmations[0];
    expect(card).toMatchObject({
      id: cardId,
      command: "checkpoint.rollback",
      sideEffect: "execute",
    });
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("the agent changed this\n");
    await core.api("POST", `/api/confirmations/${cardId}`, { approve: true });
    const done = await pending;
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ restored: 1, removed: 1, exact: true });
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("original\n");
    expect(existsSync(join(root, "made-by-agent.txt"))).toBe(false);

    const audit = (await core.api("GET", "/api/audit?capability=agent-safety")).json.entries as {
      action: string;
    }[];
    expect(audit.map((e) => e.action)).toEqual(
      expect.arrayContaining(["action.authorized", "action.succeeded"]),
    );
  });

  it("a rejected approval leaves the tree alone", async () => {
    core = await startCore();
    const root = project();
    await core.api("POST", "/api/agent/live/step", stepBody(root));
    await settle(core);
    const cp = (await core.api("GET", "/api/agent-safety")).json.checkpoints[0];
    writeFileSync(join(root, "a.txt"), "changed\n");
    const preview = (await core.api("GET", `/api/agent-safety/checkpoints/${cp.id}/preview`)).json;
    const asked = nextConfirmation(core);
    const pending = core.api("POST", `/api/agent-safety/checkpoints/${cp.id}/rollback`, {
      preview_hash: preview.preview_hash,
    });
    await core.api("POST", `/api/confirmations/${await asked}`, { approve: false });
    expect((await pending).status).toBe(403);
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("changed\n");
  });

  it("only Core can announce loop and stall warnings", async () => {
    core = await startCore();
    const res = await core.api("POST", "/api/events", {
      event_id: "evt_fake1",
      event_type: "agent.safety.loop",
      version: "1.1",
      source: "terminal",
      timestamp: new Date().toISOString(),
      severity: "warning",
      payload: {},
    });
    expect(res.status).toBe(403);
  });

  it("privacy delete-all for agent_checkpoints removes the records and the refs, and is listed in the inventory", async () => {
    core = await startCore();
    const root = project();
    git(root, "branch", "keep-me");
    await core.api("POST", "/api/agent/live/step", stepBody(root));
    await settle(core);
    const inv = (await core.api("GET", "/api/privacy")).json;
    expect(inv.derived.find((d: { id: string }) => d.id === "agent_checkpoints")).toMatchObject({
      count: 1,
    });
    expect(git(root, "for-each-ref", "refs/phoenix").trim()).not.toBe("");

    expect(
      (await core.api("POST", "/api/privacy/delete", { data: "agent_checkpoints" })).status,
    ).toBe(409);
    const gone = await core.api("POST", "/api/privacy/delete", {
      data: "agent_checkpoints",
      confirm: true,
    });
    expect(gone.json).toEqual({ deleted: 1 });
    await core.runtime.agentSafety.settled();
    expect(git(root, "for-each-ref", "refs/phoenix").trim()).toBe("");
    expect(
      git(root, "for-each-ref", "--format=%(refname)", "refs/heads").trim().split("\n"),
    ).toEqual(["refs/heads/keep-me", "refs/heads/main"]);
    expect((await core.api("GET", "/api/agent-safety")).json.checkpoints).toEqual([]);
  });
});
