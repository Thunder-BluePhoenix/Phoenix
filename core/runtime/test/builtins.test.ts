// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { builtinCapabilities } from "../src/builtins";
import { startCore, type TestCore } from "./helpers";

const FAKE_AGENT = join(import.meta.dirname, "../../../capabilities/agents/testing/fake-agent.cjs");

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

interface CapabilityRow {
  id: string;
  status: string;
}

describe("built-in capabilities", () => {
  it("registers every first-party capability, installed and not enabled", async () => {
    const core = await startCore({}, { capabilities: builtinCapabilities("dev") });
    stop = () => core.runtime.stop();
    const listed = (await core.api("GET", "/api/capabilities")).json
      .capabilities as CapabilityRow[];
    const ids = listed.map((c) => c.id).sort();
    expect(ids).toEqual(
      ["agents", "docker", "frappe", "git", "github", "issues", "kage", "mock", "terminal"].sort(),
    );
    expect(listed.every((c) => c.status === "installed")).toBe(true);
  });

  it("leaves the demo capability out of production", () => {
    const ids = builtinCapabilities("prod").map((m) => m.manifest.id);
    expect(ids).not.toContain("mock");
    expect(ids).toEqual(expect.arrayContaining(["docker", "frappe", "agents", "issues", "github"]));
  });

  it("connects the agents capability to Core: a session starts only after the user approves, and stops with the kill switch", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "phoenix-builtins-")));
    const workspace = join(root, "project");
    mkdirSync(workspace);
    const holder: { core?: TestCore } = {};
    const core = await startCore(
      {},
      {
        capabilities: builtinCapabilities("dev", () => holder.core!.runtime.agentsServices()),
      },
    );
    holder.core = core;
    stop = async () => {
      await core.runtime.stop();
      rmSync(root, { recursive: true, force: true });
    };
    const config = await core.api("POST", "/api/capabilities/agents/config", {
      config: { launchers: { fake: { command: [FAKE_AGENT], cwd_roots: [root] } }, grace_ms: 150 },
    });
    expect(config.status).toBe(200);
    expect((await core.api("POST", "/api/capabilities/agents/enable", {})).status).toBe(200);

    async function run(command: string, input: unknown, approve = true) {
      const posted = await core.api("POST", `/api/capabilities/agents/commands/${command}`, {
        input,
      });
      const id = posted.json.id as string;
      let op = (await core.api("GET", `/api/operations/${id}`)).json;
      await vi.waitFor(async () => {
        const waiting = (await core.api("GET", "/api/confirmations")).json.confirmations.find(
          (c: { id: string; command: string }) => c.command === command,
        );
        if (waiting) await core.api("POST", `/api/confirmations/${waiting.id}`, { approve });
        op = (await core.api("GET", `/api/operations/${id}`)).json;
        expect(["succeeded", "failed"]).toContain(op.status);
      });
      return op as {
        status: string;
        result?: { id: string };
        error?: { code: string; details: string[] };
      };
    }

    const refused = await run(
      "session.start",
      { launcher: "fake", workspace, prompt: "FAKE:hang\ntask" },
      false,
    );
    expect(refused.error?.code).toBe("PERMISSION_DENIED");

    const started = await run("session.start", {
      launcher: "fake",
      workspace,
      prompt: "FAKE:hang\ntask",
    });
    expect(started.error).toBeUndefined();
    expect(started.status).toBe("succeeded");
    const listed = await run("session.list", {});
    expect(JSON.stringify(listed.result)).toContain(started.result!.id);

    // The agent's own pid, read from its output through the same command the Pet Panel uses.
    let pid = 0;
    await vi.waitFor(async () => {
      const got = await run("session.get", { session_id: started.result!.id, output_lines: 50 });
      pid = Number(/fake-agent pid=(\d+)/.exec(JSON.stringify(got.result))?.[1]);
      expect(pid).toBeGreaterThan(0);
    });
    expect(() => process.kill(pid, 0)).not.toThrow();

    // The emergency stop disables the capability, which stops every session and its processes.
    await core.api("POST", "/api/security/kill-switch", { engaged: true });
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  });
});
