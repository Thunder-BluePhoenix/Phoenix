// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The capability through the real manager and permission gateway (in memory): everything is off by
// default, posting asks for confirmation, secrets come only from the secret store, notices and
// digests are opt-in. Simulated: no request reaches a chat provider.
import { afterEach, describe, expect, it } from "vitest";
import { agentRequest, baseConfig, makeRig, slackButtons, TEAMS_WEBHOOK, type Rig } from "./rig";

let rig: Rig | undefined;
afterEach(async () => {
  await rig?.harness.close();
  rig = undefined;
});

describe("defaults", () => {
  it("with no configuration nothing is posted and no press is accepted", async () => {
    rig = await makeRig({});
    rig.core.add(agentRequest());
    expect(await rig.chat.postPending()).toMatchObject({
      cards: { slack: 0, discord: 0, teams: 0 },
      notices: { slack: 0, discord: 0, teams: 0 },
    });
    expect(rig.transport.sent).toEqual([]);
    expect(rig.chat.binding.size).toBe(0);
    const op = await rig.harness.run("chat-approvals", "status");
    expect(op.result).toMatchObject({
      providers: { slack: false, discord: false, teams: false },
      teams_mode: "notify-only",
      projects: [],
    });
  });

  it("the manifest declares the secrets, no event, and Teams as notify-only", async () => {
    rig = await makeRig();
    const view = rig.harness.manager.get("chat-approvals");
    expect(view.secrets.map((s) => s.name).sort()).toEqual([
      "discord_bot_token",
      "discord_public_key",
      "slack_bot_token",
      "slack_signing_secret",
      "teams_link_key",
      "teams_webhook_url",
    ]);
    expect(view.secrets.every((s) => s.set)).toBe(true);
    expect(view.events).toEqual([]);
    expect(view.commands.find((c) => c.name === "post_pending")?.side_effect).toBe("external");
  });

  it("configuration cannot carry a secret", async () => {
    rig = await makeRig();
    expect(() =>
      rig!.harness.manager.configure("chat-approvals", { slack: { bot_token: "x" } }),
    ).toThrow();
    expect(() =>
      rig!.harness.manager.configure("chat-approvals", { slack_signing_secret: "x" }),
    ).toThrow();
  });
});

describe("posting through the command path", () => {
  it("asks for confirmation; declining posts nothing", async () => {
    rig = await makeRig();
    rig.core.add(agentRequest());
    const op = await rig.harness.run("chat-approvals", "post_pending", {}, false);
    expect(op.status).toBe("failed");
    expect(rig.transport.sent).toEqual([]);
  });

  it("posts a card per ready provider once, and again only when the request changed", async () => {
    rig = await makeRig();
    rig.core.add(agentRequest());
    const op = await rig.harness.run("chat-approvals", "post_pending");
    expect(op.status).toBe("succeeded");
    expect(rig.transport.sent).toHaveLength(2);
    await rig.chat.postPending();
    expect(rig.transport.sent).toHaveLength(2);
    rig.core.change("agent", "apr_1", "npm run build");
    await rig.chat.postPending();
    expect(rig.transport.sent).toHaveLength(4);
  });

  it("a provider that rejects the card leaves no live token behind", async () => {
    rig = await makeRig();
    rig.transport.response = { status: 500, body: "" };
    rig.core.add(agentRequest());
    await rig.chat.postPending();
    expect(rig.chat.binding.size).toBe(0);
  });

  it("a Slack ok:false answer counts as not delivered", async () => {
    rig = await makeRig(baseConfig({ discord: {} }));
    rig.transport.response = { status: 200, body: JSON.stringify({ ok: false }) };
    rig.core.add(agentRequest());
    const result = await rig.chat.postPending();
    expect(result.cards.slack).toBe(0);
    expect(rig.chat.binding.size).toBe(0);
  });
});

describe("notices and digests are opt-in", () => {
  it("a request not switched on for chat gets no card and, by default, no message at all", async () => {
    rig = await makeRig(baseConfig({ projects: [] }));
    rig.core.add(agentRequest({ command: "private command" }));
    await rig.chat.postPending();
    expect(rig.transport.sent).toEqual([]);
  });

  it("with notify on, that request gets one generic notice with no title, tool or project", async () => {
    const slack = {
      enabled: true,
      workspace: "T0PHOENIX",
      channel: "C0APPROVALS",
      approvers: ["U0OWNER"],
      notify: true,
    };
    rig = await makeRig(baseConfig({ projects: [], slack }));
    rig.core.add(agentRequest({ command: "private command", project: "hidden-repo" }));
    await rig.chat.postPending();
    await rig.chat.postPending();
    expect(rig.transport.sent).toHaveLength(1);
    expect(rig.transport.sent[0]!.request.body).not.toMatch(/private command|hidden-repo|Bash/);
    expect(slackButtons(rig.transport.sent[0]!.body)).toEqual({});
  });

  it("the digest goes only to providers with digest on and holds counts only", async () => {
    const slack = {
      enabled: true,
      workspace: "T0PHOENIX",
      channel: "C0APPROVALS",
      approvers: ["U0OWNER"],
      digest: true,
    };
    rig = await makeRig(baseConfig({ slack }));
    rig.core.add(agentRequest({ command: "secret-ish command" }));
    const result = await rig.chat.postDigest();
    expect(result.sent).toEqual({ slack: true, discord: false, teams: false });
    expect(rig.transport.sent).toHaveLength(1);
    expect(rig.transport.sent[0]!.request.body).not.toContain("secret-ish command");
    expect(result.text).toContain("1 approval");
  });
});

describe("secrets", () => {
  it("no secret value is ever in a card body, an audit row or a log-able result", async () => {
    rig = await makeRig();
    rig.core.add(agentRequest());
    await rig.chat.postPending();
    expect(Object.keys(rig.secrets)).toHaveLength(6);
    for (const value of Object.values(rig.secrets)) {
      for (const sent of rig.transport.sent) {
        // Tokens are sent only as the Authorization header, never in a body or URL.
        expect(sent.request.body).not.toContain(value);
        expect(sent.request.url.replace(TEAMS_WEBHOOK, "")).not.toContain(value);
      }
      expect(JSON.stringify(rig.core.audit)).not.toContain(value);
      expect(JSON.stringify(rig.harness.manager.get("chat-approvals"))).not.toContain(value);
    }
  });
});
