// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `POST /api/chat-approvals/teams/verify-link` through a running Core. The Teams webhook is a fake
// transport; nothing here touches Teams.
import { randomBytes } from "node:crypto";
import { SECRETS, signDeepLink, type HttpRequest } from "@phoenix/capability-chat-approvals";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCore, TOKEN, type TestCore } from "./helpers";

const PROJECT = "/work/phoenix";
const WEBHOOK = "https://phoenix-test.webhook.office.com/webhookb2/abc";
const PATH = "/api/chat-approvals/teams/verify-link";
const NO = { valid: false, approval_id: null };

const sent: HttpRequest[] = [];
const send = (request: HttpRequest) => {
  sent.push(request);
  return Promise.resolve({ status: 200, body: "1" });
};

let core: TestCore | undefined;
afterEach(async () => {
  vi.useRealTimers();
  sent.length = 0;
  await core?.runtime.stop();
  core = undefined;
});

async function setup(config: Record<string, unknown> = {}): Promise<TestCore> {
  const secrets = new MemorySecretStore();
  core = await startCore({}, { secrets, runtime: { chatTransport: send } });
  const id = "chat-approvals";
  await core.runtime.capabilities.setSecret(id, SECRETS.teamsWebhookUrl, WEBHOOK);
  await core.runtime.capabilities.setSecret(
    id,
    SECRETS.teamsLinkKey,
    randomBytes(24).toString("hex"),
  );
  core.runtime.capabilities.configure(id, {
    projects: [PROJECT],
    teams: { enabled: true },
    ...config,
  });
  await core.runtime.capabilities.enable(id, "user");
  return core;
}

const raise = (c: TestCore, project = PROJECT) =>
  c.api("POST", "/api/agent-approvals", {
    kind: "permission",
    agent: "claude",
    session_id: "s1",
    project,
    tool: "Bash",
    input_summary: { command: "npm test" },
  });

/** The signed link Core put in the Teams card, as the shell would forward its query. */
async function postedLink(c: TestCore): Promise<{ query: string; id: string }> {
  const created = (await raise(c)).json as { id: string };
  await c.runtime.chatApprovals!.idle();
  expect(sent).toHaveLength(1);
  const body = JSON.parse(sent[0]!.body) as {
    attachments: { content: { actions: { url: string }[] } }[];
  };
  const url = body.attachments[0]!.content.actions[0]!.url;
  return { query: url.slice(url.indexOf("?") + 1), id: created.id };
}

const verify = (c: TestCore, query: string) => c.api("POST", PATH, { query });

describe("Teams link verification", () => {
  it("needs the session token", async () => {
    const c = await setup();
    for (const authorization of [undefined, `Bearer x${TOKEN}`]) {
      const res = await fetch(`${c.base}${PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({ query: "s=agent" }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("accepts the link Core signed and returns only valid and the approval id", async () => {
    const c = await setup();
    const { query, id } = await postedLink(c);
    const res = await verify(c, query);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ valid: true, approval_id: id });
    // The whole search string, with its "?", is the same link.
    expect((await verify(c, `?${query}`)).json).toEqual({ valid: true, approval_id: id });
  });

  it("refuses a tampered link in every field with the same bare answer", async () => {
    const c = await setup();
    const { query } = await postedLink(c);
    const params = new URLSearchParams(query);
    const flip = (v: string) => `${v.slice(0, -1)}${v.endsWith("0") ? "1" : "0"}`;
    const edits: Record<string, string> = {
      s: params.get("s") === "agent" ? "confirmation" : "agent",
      i: `${params.get("i")}x`,
      h: flip(params.get("h")!),
      e: String(Number(params.get("e")) + 60_000),
      m: flip(params.get("m")!),
    };
    for (const [field, value] of Object.entries(edits)) {
      const changed = new URLSearchParams(query);
      changed.set(field, value);
      const res = await verify(c, changed.toString());
      expect(res.status, field).toBe(200);
      expect(res.json, field).toEqual(NO);
    }
    const dropped = new URLSearchParams(query);
    dropped.delete("m");
    expect((await verify(c, dropped.toString())).json).toEqual(NO);
  });

  it("refuses a link signed with a different key, even one that matches the live request", async () => {
    const c = await setup();
    const { query, id } = await postedLink(c);
    const real = new URLSearchParams(query);
    const forged = signDeepLink(
      randomBytes(24).toString("hex"),
      {
        source: "agent",
        id,
        tool: "Bash",
        title: "x",
        request_hash: real.get("h")!,
        expires_at: new Date(Number(real.get("e"))).toISOString(),
      },
      Date.now(),
      3_600_000,
    )!;
    const forgedQuery = forged.slice(forged.indexOf("?") + 1);
    expect(new URLSearchParams(forgedQuery).get("m")).not.toBe(real.get("m"));
    expect((await verify(c, forgedQuery)).json).toEqual(NO);
  });

  it("refuses an expired link", async () => {
    // Only the clock is faked, and before Core starts: the capability reads `Date.now` at creation.
    vi.useFakeTimers({ toFake: ["Date"] });
    const c = await setup({ token_ttl_seconds: 30 });
    const { query, id } = await postedLink(c);
    expect((await verify(c, query)).json).toEqual({ valid: true, approval_id: id });
    vi.setSystemTime(Date.now() + 31_000);
    // The request itself (long timeout) is still pending: only the link's own expiry ended.
    expect(c.runtime.agentApprovals.list().map((a) => a.id)).toContain(id);
    expect((await verify(c, query)).json).toEqual(NO);
  });

  it("has no nonce: a link can be opened again while pending, but never once the request is decided", async () => {
    const c = await setup();
    const { query, id } = await postedLink(c);
    expect((await verify(c, query)).json).toEqual({ valid: true, approval_id: id });
    expect((await verify(c, query)).json).toEqual({ valid: true, approval_id: id });
    c.runtime.agentApprovals.decide(id, { behavior: "deny" }, "test");
    expect((await verify(c, query)).json).toEqual(NO);
  });

  it("answers the same bare no for a project switched off, the capability off and the kill switch", async () => {
    const c = await setup();
    const { query, id } = await postedLink(c);
    c.runtime.capabilities.configure("chat-approvals", { projects: [], teams: { enabled: true } });
    expect((await verify(c, query)).json).toEqual(NO);
    c.runtime.capabilities.configure("chat-approvals", {
      projects: [PROJECT],
      teams: { enabled: true },
    });
    expect((await verify(c, query)).json).toEqual({ valid: true, approval_id: id });
    await c.runtime.capabilities.disable("chat-approvals");
    expect((await verify(c, query)).json).toEqual(NO);
    await c.runtime.capabilities.enable("chat-approvals", "user");
    expect((await verify(c, query)).json).toEqual({ valid: true, approval_id: id });
    c.runtime.permissions.engageKillSwitch("test");
    expect((await verify(c, query)).json).toEqual(NO);
  });

  it("answers no when no key is stored, and never carries a secret", async () => {
    const secrets = new MemorySecretStore();
    const c = await startCore({}, { secrets, runtime: { chatTransport: send } });
    core = c;
    const res = await verify(c, "s=agent&i=apr_1");
    expect(res.status).toBe(200);
    expect(res.json).toEqual(NO);
    expect(JSON.stringify(res.json)).not.toMatch(/key|secret|hmac/i);
  });

  it("rejects a body that is not a link query", async () => {
    const c = await setup();
    for (const body of [{}, { query: 5 }, { query: "" }, { query: "a b" }, { query: "a\n" }, []]) {
      const res = await c.api("POST", PATH, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await c.api("POST", PATH, { query: "a".repeat(601) })).status).toBe(400);
  });
});
