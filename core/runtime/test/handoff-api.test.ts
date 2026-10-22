// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Handoff notes over the real HTTP API of a real Core: auth, a note written for a live session,
// the privacy inventory row and the `handoff` delete-all kind, and the file's permissions on disk.
// The agent session comes from a real hook-style step report to the live-session route; no agent,
// model or GitHub is involved (the AI is off, so the summary route refuses with CAPABILITY_DISABLED).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

const cores: TestCore[] = [];
afterEach(async () => {
  for (const core of cores.splice(0).reverse()) await core.runtime.stop();
});
async function core(): Promise<TestCore> {
  const c = await startCore();
  cores.push(c);
  return c;
}

const SESSION = "5f1c1b0e-6a0e-4f43-8d7d-0a6a3f4b2c11";
const step = (over: Record<string, unknown> = {}) => ({
  agent: "claude-code",
  session_id: SESSION,
  project: "/work/shop",
  kind: "edit",
  tool: "Edit",
  target: "/work/shop/src/a.ts",
  at: new Date().toISOString(),
  file: { path: "/work/shop/src/a.ts", added: 4, removed: 1 },
  ...over,
});

describe("handoff API", () => {
  it("needs the session token on every route", async () => {
    const c = await core();
    for (const [method, path] of [
      ["GET", "/api/handoff/notes"],
      ["POST", "/api/handoff/notes"],
      ["GET", "/api/handoff/settings"],
      ["GET", "/api/secret-guard"],
      ["POST", "/api/secret-guard/result"],
    ] as const) {
      const res = await fetch(`${c.base}${path}`, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("writes a note from reported steps, serves it, counts it in the inventory and deletes it", async () => {
    const c = await core();
    expect((await c.api("POST", "/api/agent/live/step", step())).status).toBe(200);
    await c.api(
      "POST",
      "/api/agent/live/step",
      step({ kind: "run", tool: "Bash", target: "npm test", file: undefined }),
    );

    const made = await c.api("POST", "/api/handoff/notes", { session_id: SESSION });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({
      agent: "claude-code",
      project: "shop",
      trigger: "user",
      files_total: 1,
      commands: ["npm test"],
      generated_by: "rules",
      summary: null,
    });
    expect(made.json.text).not.toContain("/work/shop");

    const dir = join(c.dataDir, "handoff");
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, `${made.json.id}.json`)).mode & 0o777).toBe(0o600);

    const listed = (await c.api("GET", "/api/handoff/notes")).json.notes;
    expect(listed.map((n: { id: string }) => n.id)).toEqual([made.json.id]);
    expect(listed[0]).not.toHaveProperty("text");
    expect((await c.api("GET", `/api/handoff/notes/${made.json.id}`)).json.text).toContain(
      "## Commands run",
    );

    const inv = (await c.api("GET", "/api/privacy")).json;
    expect(inv.derived.find((d: { id: string }) => d.id === "handoff_notes")).toMatchObject({
      count: 1,
    });

    const gone = await c.api("POST", "/api/privacy/delete", { data: "handoff", confirm: true });
    expect(gone.json).toEqual({ deleted: 1 });
    expect(readdirSync(dir)).toEqual([]);
    expect((await c.api("GET", `/api/handoff/notes/${made.json.id}`)).status).toBe(404);
    const audit = (await c.api("GET", "/api/audit?limit=200")).json.entries as { action: string }[];
    expect(audit.some((e) => e.action === "privacy.data.deleted")).toBe(true);
  });

  it("delete-all of handoff needs the confirmation like every other kind", async () => {
    const c = await core();
    expect((await c.api("POST", "/api/privacy/delete", { data: "handoff" })).json.code).toBe(
      "ACTION_REQUIRES_CONFIRMATION",
    );
  });

  it("an unknown session is 404, a bad body is 400, and no file is made", async () => {
    const c = await core();
    expect((await c.api("POST", "/api/handoff/notes", { session_id: SESSION })).status).toBe(404);
    expect((await c.api("POST", "/api/handoff/notes", { session_id: "../x" })).status).toBe(400);
    expect((await c.api("GET", "/api/handoff/notes/not-an-id")).status).toBe(404);
    expect(existsSync(join(c.dataDir, "handoff"))).toBe(false);
  });

  it("with AI off the summary is refused and the note is unchanged", async () => {
    const c = await core();
    await c.api("POST", "/api/agent/live/step", step());
    const made = await c.api("POST", "/api/handoff/notes", { session_id: SESSION });
    const res = await c.api("POST", `/api/handoff/notes/${made.json.id}/summary`, {});
    expect(res.status).toBe(409);
    expect((await c.api("GET", `/api/handoff/notes/${made.json.id}`)).json.summary).toBeNull();
  });

  it("settings default to automatic notes on and cloud off, validate input and are audited", async () => {
    const c = await core();
    expect((await c.api("GET", "/api/handoff/settings")).json).toEqual({
      auto: true,
      allow_cloud: false,
    });
    expect((await c.api("POST", "/api/handoff/settings", { allow_cloud: "yes" })).status).toBe(400);
    expect((await c.api("POST", "/api/handoff/settings", { other: true })).status).toBe(400);
    expect((await c.api("POST", "/api/handoff/settings", { allow_cloud: true })).json).toEqual({
      auto: true,
      allow_cloud: true,
    });
    const audit = (await c.api("GET", "/api/audit?limit=50")).json.entries as { action: string }[];
    expect(audit.some((e) => e.action === "handoff.settings.changed")).toBe(true);
  });

  it("an attach preview of a commit message writes nothing and is copy only", async () => {
    const c = await core();
    await c.api("POST", "/api/agent/live/step", step());
    const made = await c.api("POST", "/api/handoff/notes", { session_id: SESSION });
    const preview = await c.api("POST", `/api/handoff/notes/${made.json.id}/attach`, {
      target: "commit_message",
    });
    expect(preview.json).toMatchObject({ mode: "preview", delivery: "copy", wired: false });
    const applied = await c.api("POST", `/api/handoff/notes/${made.json.id}/attach`, {
      target: "commit_message",
      confirm_hash: preview.json.hash,
    });
    expect(applied.json).toMatchObject({ mode: "applied", copy_only: true });
  });
});
