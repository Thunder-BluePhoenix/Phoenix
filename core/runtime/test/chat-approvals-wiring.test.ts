// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHmac, randomBytes } from "node:crypto";
import { SECRETS, type HttpRequest } from "@phoenix/capability-chat-approvals";
import { MemorySecretStore } from "@phoenix/persistence";
import { describe, expect, it } from "vitest";
import { startCore, TOKEN, type TestCore } from "./helpers";

const WORKSPACE = "T0PHOENIX";
const CHANNEL = "C0APPROVALS";
const OWNER = "U0OWNER";
const PROJECT = "/work/phoenix";

/** Recording stand-in for Slack: nothing here touches the network. */
class FakeSlack {
  readonly sent: { request: HttpRequest; body: Record<string, unknown> }[] = [];
  readonly send = (request: HttpRequest) => {
    this.sent.push({ request, body: JSON.parse(request.body) as Record<string, unknown> });
    return Promise.resolve({ status: 200, body: JSON.stringify({ ok: true }) });
  };
}

interface Block {
  type?: string;
  elements?: { action_id?: string; value?: string }[];
}

function buttons(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const block of (body.blocks ?? []) as Block[])
    for (const el of block.elements ?? [])
      if (el.action_id && el.value) out[el.action_id] = el.value;
  return out;
}

async function setup(config: Record<string, unknown> = {}) {
  const secrets = new MemorySecretStore();
  const signing = randomBytes(24).toString("hex");
  const slack = new FakeSlack();
  const core = await startCore({}, { secrets, runtime: { chatTransport: slack.send } });
  const id = "chat-approvals";
  await core.runtime.capabilities.setSecret(id, SECRETS.slackSigningSecret, signing);
  await core.runtime.capabilities.setSecret(
    id,
    SECRETS.slackBotToken,
    randomBytes(12).toString("hex"),
  );
  core.runtime.capabilities.configure(id, {
    projects: [PROJECT],
    slack: { enabled: true, workspace: WORKSPACE, channel: CHANNEL, approvers: [OWNER] },
    ...config,
  });
  await core.runtime.capabilities.enable(id, "user");
  return { core, slack, signing };
}

function sign(signing: string, body: string, at = Date.now()) {
  const timestamp = String(Math.floor(at / 1000));
  const mac = createHmac("sha256", signing).update(`v0:${timestamp}:${body}`).digest("hex");
  return { "x-slack-signature": `v0=${mac}`, "x-slack-request-timestamp": timestamp };
}

async function press(core: TestCore, signing: string, token: string, user = OWNER) {
  const payload = {
    type: "block_actions",
    user: { id: user },
    team: { id: WORKSPACE },
    channel: { id: CHANNEL },
    response_url: "https://hooks.slack.com/actions/T/1/x",
    actions: [{ action_id: "phx", value: token }],
  };
  const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
  return fetch(`${core.base}/api/chat-approvals/callback/slack`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...sign(signing, body),
    },
    body,
  });
}

const raise = (core: TestCore, project = PROJECT) =>
  core.api("POST", "/api/agent-approvals", {
    kind: "permission",
    agent: "claude",
    session_id: "s1",
    project,
    tool: "Bash",
    input_summary: { command: "npm test" },
  });

describe("chat approvals through the running Core", () => {
  it("is registered but off: no card is posted and no callback is answered until it is enabled", async () => {
    const slack = new FakeSlack();
    const core = await startCore(
      {},
      { secrets: new MemorySecretStore(), runtime: { chatTransport: slack.send } },
    );
    expect(core.runtime.capabilities.get("chat-approvals").status).not.toBe("enabled");
    await raise(core);
    await core.runtime.chatApprovals!.idle();
    expect(slack.sent).toEqual([]);
    const res = await fetch(`${core.base}/api/chat-approvals/callback/slack`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "payload=%7B%7D",
    });
    expect(res.status).toBe(503);
    await core.runtime.stop();
  });

  it("posts a card for a switched-on project and decides it only after a signed press and a confirm", async () => {
    const { core, slack, signing } = await setup();
    const created = (await raise(core)).json as { id: string };
    await core.runtime.chatApprovals!.idle();
    expect(slack.sent).toHaveLength(1);
    const { phx_allow: allow, phx_deny: deny } = buttons(slack.sent[0]!.body);
    expect(allow).toBeTruthy();
    expect(deny).toBeTruthy();

    // Allow only asks again: nothing is decided yet.
    expect((await press(core, signing, allow!)).status).toBe(200);
    expect(core.runtime.agentApprovals.list().map((a) => a.id)).toContain(created.id);
    const { phx_confirm: confirm } = buttons(slack.sent.at(-1)!.body);
    expect(confirm).toBeTruthy();

    // Only the confirm press decides, and the audit row names the chat user.
    expect((await press(core, signing, confirm!)).status).toBe(200);
    expect(core.runtime.agentApprovals.list().map((a) => a.id)).not.toContain(created.id);
    const actors = core.runtime.permissions.audit.list({ limit: 100 }).map((e) => e.actor);
    expect(actors).toContain(`chat:slack:${OWNER}`);
    await core.runtime.stop();
  });

  it("refuses a press from someone who is not an allow-listed approver, and a bad signature", async () => {
    const { core, slack, signing } = await setup();
    const created = (await raise(core)).json as { id: string };
    await core.runtime.chatApprovals!.idle();
    const { phx_allow: allow } = buttons(slack.sent[0]!.body);

    await press(core, signing, allow!, "U0STRANGER");
    expect(core.runtime.agentApprovals.list().map((a) => a.id)).toContain(created.id);

    const bad = await fetch(`${core.base}/api/chat-approvals/callback/slack`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...sign("0".repeat(48), "payload=x"),
      },
      body: "payload=x",
    });
    expect(bad.status).toBe(401);
    expect(await bad.text()).toBe("");
    await core.runtime.stop();
  });

  it("makes no card for a project that is not switched on", async () => {
    const { core, slack } = await setup();
    await raise(core, "/work/other");
    await core.runtime.chatApprovals!.idle();
    expect(slack.sent).toEqual([]);
    await core.runtime.stop();
  });

  it("does not use the session token as a credential on the callback route", async () => {
    const { core } = await setup();
    const res = await fetch(`${core.base}/api/chat-approvals/callback/slack`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Bearer ${TOKEN}`,
      },
      body: "payload=x",
    });
    expect(res.status).toBe(401);
    await core.runtime.stop();
  });

  it("answers no press once the emergency stop is engaged, even on a card posted before it", async () => {
    const { core, slack, signing } = await setup();
    await raise(core);
    await core.runtime.chatApprovals!.idle();
    const { phx_allow: allow } = buttons(slack.sent[0]!.body);
    core.runtime.permissions.engageKillSwitch("test");
    expect((await press(core, signing, allow!)).status).toBe(503);
    await core.runtime.stop();
  });

  it("posts nothing for an approval that arrives while the capability is switched off again", async () => {
    const { core, slack } = await setup();
    await core.runtime.capabilities.disable("chat-approvals");
    await raise(core);
    await core.runtime.chatApprovals!.idle();
    expect(slack.sent).toEqual([]);
    await core.runtime.stop();
  });
});
