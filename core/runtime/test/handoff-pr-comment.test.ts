// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 79 through a running Core (real HTTP, real permission gateway, real capability manager, the
// real github capability) with a FAKE fetch for api.github.com: a handoff note is attached to a pull
// request as ONE comment only after the preview's hash AND the github command's own confirmation.
// No real pull request, repository, token or network was used.
import { createGithubCapability } from "@phoenix/capability-github";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCore, type TestCore } from "./helpers";

const SESSION = "5f1c1b0e-6a0e-4f43-8d7d-0a6a3f4b2c11";
const WRITE = ["gh", "p_", "COREWRITECOREWRITECOREWRITE0123456789"].join("");
const LINK = "https://github.com/octo/shop/pull/12#issuecomment-9001";
const realFetch = globalThis.fetch;

const cores: TestCore[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const core of cores.splice(0).reverse()) await core.runtime.stop();
});

const step = {
  agent: "claude-code",
  session_id: SESSION,
  project: "/work/shop",
  kind: "edit",
  tool: "Edit",
  target: "/work/shop/src/a.ts",
  file: { path: "/work/shop/src/a.ts", added: 4, removed: 1 },
};

interface Sent {
  url: string;
  method: string;
  authorization: string | undefined;
  body: string;
}

/** Fakes api.github.com only; the Core under test is still reached over real loopback HTTP. */
function fakeGithub(reply: () => Response) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
      sent.push({
        url,
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization") ?? undefined,
        body: String(init?.body ?? ""),
      });
      return reply();
    }),
  );
  return sent;
}

async function boot(withToken = true) {
  const core = await startCore(
    {},
    { capabilities: [createGithubCapability()], secrets: new MemorySecretStore() },
  );
  cores.push(core);
  await core.api("POST", "/api/capabilities/github/config", { config: { repositories: [] } });
  if (withToken) {
    await core.api("POST", "/api/capabilities/github/secrets/write_token", { value: WRITE });
  }
  await core.api("POST", "/api/capabilities/github/enable", {});
  await core.api("POST", "/api/agent/live/step", { ...step, at: new Date().toISOString() });
  const note = (await core.api("POST", "/api/handoff/notes", { session_id: SESSION })).json;
  return { core, noteId: note.id as string };
}

async function pendingCard(core: TestCore) {
  let card: { id: string; command: string; summary: string } | undefined;
  await vi.waitFor(async () => {
    card = (await core.api("GET", "/api/confirmations")).json.confirmations[0];
    expect(card).toBeDefined();
  });
  return card!;
}

const created = () => new Response(JSON.stringify({ id: 9001, html_url: LINK }), { status: 201 });
const PR = { target: "pr_description", repository: "octo/shop", number: 12 };

describe("attach a handoff note to a pull request (Core, fake GitHub)", () => {
  it("posts nothing on preview, and nothing without the hash", async () => {
    const sent = fakeGithub(created);
    const { core, noteId } = await boot();
    const path = `/api/handoff/notes/${noteId}/attach`;
    const preview = await core.api("POST", path, PR);
    expect(preview.json).toMatchObject({
      mode: "preview",
      delivery: "github_pr_comment",
      wired: true,
      number: 12,
    });
    expect(preview.json.body_sha256).toMatch(/^[0-9a-f]{64}$/);
    const stale = await core.api("POST", path, { ...PR, confirm_hash: "0".repeat(64) });
    expect(stale.json.code).toBe("ACTION_REQUIRES_CONFIRMATION");
    expect(sent).toEqual([]);
  });

  it("asks a second time, naming the repository, number, hash and size, then posts once", async () => {
    const sent = fakeGithub(created);
    const { core, noteId } = await boot();
    const path = `/api/handoff/notes/${noteId}/attach`;
    const preview = (await core.api("POST", path, PR)).json;

    const pending = core.api("POST", path, { ...PR, confirm_hash: preview.hash });
    const card = await pendingCard(core);
    expect(card.command).toBe("pr.comment");
    expect(card.summary).toContain("repository: octo/shop");
    expect(card.summary).toContain("number: 12");
    expect(card.summary).toContain(`body_sha256: ${preview.body_sha256}`);
    expect(card.summary).toContain(`body_chars: ${preview.body_chars}`);
    expect(sent).toEqual([]); // the user's tick alone is not enough: Core asked again
    await core.api("POST", `/api/confirmations/${card.id}`, { approve: true });

    const done = await pending;
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({
      mode: "applied",
      delivery: "github_pr_comment",
      copy_only: false,
      comment: { repository: "octo/shop", number: 12, id: 9001, url: LINK },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      url: "https://api.github.com/repos/octo/shop/issues/12/comments",
      method: "POST",
      authorization: `Bearer ${WRITE}`,
    });
    expect(JSON.parse(sent[0]!.body)).toEqual({ body: preview.text.trim() });
    const audit = (await core.api("GET", "/api/audit?limit=200")).json.entries as {
      action: string;
    }[];
    expect(audit.some((e) => e.action === "handoff.note.attached")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(WRITE);
  });

  it("declining the github confirmation posts nothing and is not reported as attached", async () => {
    const sent = fakeGithub(created);
    const { core, noteId } = await boot();
    const path = `/api/handoff/notes/${noteId}/attach`;
    const preview = (await core.api("POST", path, PR)).json;
    const pending = core.api("POST", path, { ...PR, confirm_hash: preview.hash });
    const card = await pendingCard(core);
    await core.api("POST", `/api/confirmations/${card.id}`, { approve: false });
    const done = await pending;
    expect(done.status).toBeGreaterThanOrEqual(400);
    expect(sent).toEqual([]);
    const audit = (await core.api("GET", "/api/audit?limit=200")).json.entries as {
      action: string;
    }[];
    expect(audit.some((e) => e.action === "handoff.note.attached")).toBe(false);
  });

  it("without a write token nothing is sent, and the error carries no GitHub or credential text", async () => {
    const sent = fakeGithub(created);
    const { core, noteId } = await boot(false);
    const path = `/api/handoff/notes/${noteId}/attach`;
    const preview = (await core.api("POST", path, PR)).json;
    const pending = core.api("POST", path, { ...PR, confirm_hash: preview.hash });
    const card = await pendingCard(core);
    await core.api("POST", `/api/confirmations/${card.id}`, { approve: true });
    const done = await pending;
    expect(done.status).toBeGreaterThanOrEqual(400);
    expect(sent).toEqual([]);
    expect(JSON.stringify(done.json)).toContain("write_token");
  });

  it("a hostile reply link is refused by the github command, so no off-site link reaches the web", async () => {
    fakeGithub(
      () =>
        new Response(JSON.stringify({ id: 9001, html_url: "https://evil.invalid/x" }), {
          status: 201,
        }),
    );
    const { core, noteId } = await boot();
    const path = `/api/handoff/notes/${noteId}/attach`;
    const preview = (await core.api("POST", path, PR)).json;
    const pending = core.api("POST", path, { ...PR, confirm_hash: preview.hash });
    const card = await pendingCard(core);
    await core.api("POST", `/api/confirmations/${card.id}`, { approve: true });
    const done = await pending;
    expect(done.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(done.json)).not.toContain("evil.invalid");
  });
});
