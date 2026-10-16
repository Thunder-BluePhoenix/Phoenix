// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The hook-installer routes against a real Core. The installer is built over a temp home, so
// nothing here can read or write the real ~/.claude (or any other agent's) settings.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HookInstaller } from "@phoenix/capability-agents";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, TOKEN, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const USER_SETTINGS = `${JSON.stringify({ theme: "dark", permissions: { allow: ["Bash(ls)"] } }, null, 2)}\n`;

interface Setup {
  core: TestCore;
  home: string;
  settings: string;
  backupDir: string;
  changed: () => number;
}

/** A Core whose installer sees a temp home with only Claude Code present. */
async function setup(): Promise<Setup> {
  const home = mkdtempSync(join(tmpdir(), "phoenix-relay-home-"));
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".claude"));
  const settings = join(home, ".claude", "settings.json");
  writeFileSync(settings, USER_SETTINGS);
  const backupDir = join(home, "backups");
  const installer = new HookInstaller({ home, env: {}, backupDir });
  const core = await startCore({}, { runtime: { installer } });
  cleanups.push(() => core.runtime.stop());
  let changes = 0;
  const unsubscribe = core.runtime.bus.subscribe("relay-routes-test", "agent.relay.changed", () => {
    changes++;
  });
  cleanups.push(unsubscribe);
  return { core, home, settings, backupDir, changed: () => changes };
}

const preview = async (s: Setup, action: string, agent = "claude-code") => {
  const res = await s.core.api("POST", `/api/agent-relay/${action}`, { agent });
  expect(res.status).toBe(200);
  expect(res.json.mode).toBe("preview");
  return res.json as { hash: string; diff: string; changed: boolean; path: string };
};

describe("agent relay HTTP routes", () => {
  it("needs the session token on all four routes", async () => {
    const s = await setup();
    const routes: [string, string][] = [
      ["GET", "/api/agent-relay/agents"],
      ["POST", "/api/agent-relay/install"],
      ["POST", "/api/agent-relay/uninstall"],
      ["POST", "/api/agent-relay/repair"],
    ];
    for (const [method, path] of routes) {
      const res = await fetch(s.core.base + path, {
        method,
        ...(method === "POST"
          ? { headers: { "content-type": "application/json" }, body: '{"agent":"claude-code"}' }
          : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    const wrong = await fetch(`${s.core.base}/api/agent-relay/agents`, {
      headers: { authorization: `Bearer ${TOKEN}x` },
    });
    expect(wrong.status).toBe(401);
  });

  it("lists the injected installer's agents and the relay status", async () => {
    const s = await setup();
    const res = await s.core.api("GET", "/api/agent-relay/agents");
    expect(res.status).toBe(200);
    expect(res.json.relay).toMatchObject({
      running: true,
      version: 1,
      platform: process.platform,
      path: join(s.core.dataDir, "relay", "relay.sock"),
    });
    const agents = res.json.agents as { id: string; detected: boolean; state: string }[];
    const claude = agents.find((a) => a.id === "claude-code");
    expect(claude).toMatchObject({ detected: true, state: "not_installed" });
    const others = agents.filter((a) => a.id !== "claude-code");
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((a) => !a.detected)).toBe(true);
  });

  it("a request without confirm_hash is a preview and writes nothing", async () => {
    const s = await setup();
    const p = await preview(s, "install");
    expect(p.changed).toBe(true);
    expect(p.diff).toContain("capabilities/agents/src/claude-hook.ts");
    expect(p.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.path).toBe(s.settings);
    expect(readFileSync(s.settings, "utf8")).toBe(USER_SETTINGS);
    expect(readdirSync(s.home).sort()).toEqual([".claude"]);
    expect(s.changed()).toBe(0);
  });

  it("applies the previewed install, keeps the user's own settings, backs up, and announces it", async () => {
    const s = await setup();
    const p = await preview(s, "install");
    const applied = await s.core.api(
      "POST",
      "/api/agent-relay/install",
      { agent: "claude-code", confirm_hash: p.hash },
      { "x-phoenix-client": "web" },
    );
    expect(applied.status).toBe(200);
    expect(applied.json).toMatchObject({
      mode: "applied",
      action: "install",
      agent: "claude-code",
      path: s.settings,
      changed: true,
    });
    const written = JSON.parse(readFileSync(s.settings, "utf8")) as Record<string, unknown>;
    expect(written.theme).toBe("dark");
    expect(JSON.stringify(written.hooks)).toContain("capabilities/agents/src/claude-hook.ts");
    expect(readdirSync(s.backupDir).length).toBeGreaterThan(0);

    await s.core.runtime.bus.drain();
    expect(s.changed()).toBe(1);

    const audit = (await s.core.api("GET", "/api/audit")).json.entries as Record<string, unknown>[];
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "agent_relay.install",
          actor: "user:web",
          capabilityId: "agent_relay",
          decision: "allowed",
          details: expect.objectContaining({ agent: "claude-code", changed: true }),
        }),
      ]),
    );
    const listed = (await s.core.api("GET", "/api/agent-relay/agents")).json.agents as {
      id: string;
      state: string;
    }[];
    expect(listed.find((a) => a.id === "claude-code")?.state).toBe("installed");
  });

  it("a wrong hash is 409 and leaves the file alone; the denial is audited", async () => {
    const s = await setup();
    await preview(s, "install");
    const res = await s.core.api("POST", "/api/agent-relay/install", {
      agent: "claude-code",
      confirm_hash: "0".repeat(64),
    });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("ACTION_REQUIRES_CONFIRMATION");
    expect(typeof res.json.message).toBe("string");
    expect(readFileSync(s.settings, "utf8")).toBe(USER_SETTINGS);
    await s.core.runtime.bus.drain();
    expect(s.changed()).toBe(0);
    const audit = (await s.core.api("GET", "/api/audit")).json.entries as Record<string, unknown>[];
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "agent_relay.install", decision: "denied" }),
      ]),
    );
  });

  it("a user edit between preview and confirm is 409 and is not overwritten", async () => {
    const s = await setup();
    const p = await preview(s, "install");
    const edited = `${JSON.stringify({ theme: "light" }, null, 2)}\n`;
    writeFileSync(s.settings, edited);
    const res = await s.core.api("POST", "/api/agent-relay/install", {
      agent: "claude-code",
      confirm_hash: p.hash,
    });
    expect(res.status).toBe(409);
    expect(readFileSync(s.settings, "utf8")).toBe(edited);
  });

  it("uninstall previews, then restores the original bytes", async () => {
    const s = await setup();
    const install = await preview(s, "install");
    await s.core.api("POST", "/api/agent-relay/install", {
      agent: "claude-code",
      confirm_hash: install.hash,
    });
    expect(readFileSync(s.settings, "utf8")).not.toBe(USER_SETTINGS);

    const afterInstall = readFileSync(s.settings, "utf8");
    const p = await preview(s, "uninstall");
    expect(readFileSync(s.settings, "utf8")).toBe(afterInstall);
    const res = await s.core.api("POST", "/api/agent-relay/uninstall", {
      agent: "claude-code",
      confirm_hash: p.hash,
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ mode: "applied", action: "uninstall", changed: true });
    expect(readFileSync(s.settings, "utf8")).toBe(USER_SETTINGS);
  });

  it("repair completes a partly removed install", async () => {
    const s = await setup();
    const install = await preview(s, "install");
    await s.core.api("POST", "/api/agent-relay/install", {
      agent: "claude-code",
      confirm_hash: install.hash,
    });
    const installed = JSON.parse(readFileSync(s.settings, "utf8")) as {
      hooks: Record<string, unknown>;
    };
    const [firstEvent] = Object.keys(installed.hooks);
    delete installed.hooks[firstEvent!];
    writeFileSync(s.settings, `${JSON.stringify(installed, null, 2)}\n`);

    const listed = (await s.core.api("GET", "/api/agent-relay/agents")).json.agents as {
      id: string;
      state: string;
      missing: string[];
    }[];
    expect(listed.find((a) => a.id === "claude-code")).toMatchObject({ state: "needs_repair" });

    const p = await preview(s, "repair");
    const res = await s.core.api("POST", "/api/agent-relay/repair", {
      agent: "claude-code",
      confirm_hash: p.hash,
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ mode: "applied", action: "repair" });
    const fixed = (await s.core.api("GET", "/api/agent-relay/agents")).json.agents as {
      id: string;
      state: string;
    }[];
    expect(fixed.find((a) => a.id === "claude-code")?.state).toBe("installed");
  });

  it("answers 404 for an unknown agent, 400 for an unsupported or undetected one and for bad bodies", async () => {
    const s = await setup();
    const unknown = await s.core.api("POST", "/api/agent-relay/install", {
      agent: "no-such-agent",
    });
    expect(unknown.status).toBe(404);
    expect(unknown.json.code).toBe("RESOURCE_NOT_FOUND");

    const agents = (await s.core.api("GET", "/api/agent-relay/agents")).json.agents as {
      id: string;
      support: string;
      detected: boolean;
    }[];
    const unsupported = agents.find((a) => a.support === "unsupported");
    if (unsupported) {
      const res = await s.core.api("POST", "/api/agent-relay/install", { agent: unsupported.id });
      expect(res.status).toBe(400);
    }
    const absent = agents.find((a) => a.support === "supported" && !a.detected);
    expect(absent).toBeDefined();
    expect(
      (await s.core.api("POST", "/api/agent-relay/install", { agent: absent!.id })).status,
    ).toBe(400);

    const bad: unknown[] = [
      {},
      { agent: 7 },
      { agent: "Claude Code" },
      { agent: "../etc" },
      { agent: "claude-code", confirm_hash: "abc" },
      { agent: "claude-code", confirm_hash: 5 },
      { agent: "claude-code", extra: true },
      [],
    ];
    for (const body of bad) {
      const res = await s.core.api("POST", "/api/agent-relay/install", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.json.code).toBe("INVALID_REQUEST");
    }
    expect(readFileSync(s.settings, "utf8")).toBe(USER_SETTINGS);
  });
});
