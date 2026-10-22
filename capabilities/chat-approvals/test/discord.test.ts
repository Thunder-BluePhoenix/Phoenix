// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Discord through the real capability with a pretend Core: Ed25519-signed interactions, the confirm
// step and the refusals, plus cross-provider token reuse. Simulated: no request reaches Discord.
import { afterEach, describe, expect, it } from "vitest";
import {
  agentRequest,
  baseConfig,
  discordButtons,
  DISCORD_OWNER,
  makeRig,
  slackButtons,
  type Rig,
} from "./rig";

let rig: Rig | undefined;
afterEach(async () => {
  await rig?.harness.close();
  rig = undefined;
});

async function posted(over = {}) {
  rig = await makeRig();
  rig.core.add(agentRequest(over));
  await rig.chat.postPending();
  const slackCard = rig.transport.sent.find((s) => s.request.url.includes("slack.com"))!;
  const card = rig.transport.sent.find((s) => s.request.url.includes("discord.com"))!;
  return { r: rig, card, buttons: discordButtons(card.body), slackCard };
}

const data = (reply: { json?: unknown }) => (reply.json as { data: Record<string, unknown> }).data;

describe("a Discord card", () => {
  it("is posted with a Bot authorization header, mentions disabled, and no preview or hash", async () => {
    const { card } = await posted({ command: "echo @everyone <@123> **x**" });
    expect(card.request.headers.authorization).toMatch(/^Bot [0-9a-f]{24}$/);
    expect(card.body.allowed_mentions).toEqual({ parse: [] });
    expect(String(card.body.content)).not.toMatch(/@|<|\*/);
    expect(card.request.body).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe("Discord interactions", () => {
  it("answers a signed PING with a PONG and a bad one with 401", async () => {
    const { r } = await posted();
    const ping = r.discord.sign(JSON.stringify({ type: 1 }), r.clock.ms);
    expect(await r.chat.handleCallback("discord", ping)).toEqual({
      status: 200,
      json: { type: 1 },
    });
    const forged = r.discord.forged(JSON.stringify({ type: 1 }), r.clock.ms);
    expect((await r.chat.handleCallback("discord", forged)).status).toBe(401);
  });

  it("Allow leads to a confirm step; Yes decides with actor chat:discord:<user>", async () => {
    const { r, buttons } = await posted();
    const first = await r.chat.handleCallback(
      "discord",
      r.discord.press(buttons.Allow!, r.clock.ms),
    );
    expect(first.status).toBe(200);
    expect(r.core.decisions).toEqual([]);
    const confirm = discordButtons(data(first));
    expect(Object.keys(confirm).sort()).toEqual(["Cancel", "Yes, allow"]);
    r.clock.advance(1000);
    await r.chat.handleCallback("discord", r.discord.press(confirm["Yes, allow"]!, r.clock.ms));
    expect(r.core.decisions).toEqual([
      expect.objectContaining({ decision: "approve", actor: `chat:discord:${DISCORD_OWNER}` }),
    ]);
  });

  it("a body edited after signing, a wrong key and a malformed signature are refused", async () => {
    const { r, buttons } = await posted();
    const good = r.discord.press(buttons.Deny!, r.clock.ms);
    const edited = { ...good, body: Buffer.from(good.body.toString("utf8").replace("3", "4")) };
    expect((await r.chat.handleCallback("discord", edited)).status).toBe(401);
    const malformed = { ...good, headers: { ...good.headers, "x-signature-ed25519": "abcd" } };
    expect((await r.chat.handleCallback("discord", malformed)).status).toBe(401);
    expect((await r.chat.handleCallback("discord", { headers: {}, body: good.body })).status).toBe(
      401,
    );
    expect(r.core.decisions).toEqual([]);
  });

  it("a stale timestamp is refused, an identical signed request is a replay", async () => {
    const { r, buttons } = await posted();
    const stale = r.discord.press(buttons.Deny!, r.clock.ms - 301_000);
    expect((await r.chat.handleCallback("discord", stale)).status).toBe(401);
    const fresh = r.discord.press(buttons.Allow!, r.clock.ms);
    expect((await r.chat.handleCallback("discord", fresh)).status).toBe(200);
    expect((await r.chat.handleCallback("discord", fresh)).status).toBe(401);
    expect(r.core.decisions).toEqual([]);
  });

  it("a user outside the allow-list and another guild get an ephemeral refusal", async () => {
    const { r, buttons } = await posted();
    for (const over of [{ user: "9000000000999" }, { guild: "9000000000998" }]) {
      const reply = await r.chat.handleCallback(
        "discord",
        r.discord.press(buttons.Deny!, r.clock.ms, over),
      );
      expect(data(reply).flags).toBe(64);
    }
    expect(r.core.decisions).toEqual([]);
  });

  it("refuses when the project is switched off or the request changed", async () => {
    const { r, buttons } = await posted();
    r.core.change("agent", "apr_1", "something else");
    const reply = await r.chat.handleCallback(
      "discord",
      r.discord.press(buttons.Deny!, r.clock.ms),
    );
    expect(String(data(reply).content)).toContain("changed after this card");
    expect(r.core.decisions).toEqual([]);
  });

  it("refuses when the project is switched off after posting", async () => {
    const { r, buttons } = await posted();
    r.config.projects = [];
    const reply = await r.chat.handleCallback(
      "discord",
      r.discord.press(buttons.Deny!, r.clock.ms),
    );
    expect(String(data(reply).content)).toContain("turned off");
    expect(r.core.decisions).toEqual([]);
  });

  it("an expired token is refused", async () => {
    const { r, buttons } = await posted({ expiresInMs: 3_600_000 });
    r.clock.advance(301_000);
    const reply = await r.chat.handleCallback(
      "discord",
      r.discord.press(buttons.Deny!, r.clock.ms),
    );
    expect(String(data(reply).content)).toContain("expired");
    expect(r.core.decisions).toEqual([]);
  });
});

describe("tokens do not cross providers", () => {
  it("a Slack button pressed through Discord (and the reverse) decides nothing and is not burnt", async () => {
    const { r, buttons, slackCard } = await posted();
    const slackButton = slackButtons(slackCard.body).phx_deny!;
    // The same user id in both configs, so only the provider binding can stop it.
    r.config = baseConfig({
      discord: {
        enabled: true,
        workspace: "9000000000001",
        channel: "C0APPROVALS",
        approvers: [DISCORD_OWNER],
      },
    });
    const viaDiscord = await r.chat.handleCallback(
      "discord",
      r.discord.press(slackButton, r.clock.ms, { channel: "C0APPROVALS" }),
    );
    expect(String(data(viaDiscord).content)).toContain("does not belong to this chat app");
    const viaSlack = await r.chat.handleCallback("slack", r.slack.press(buttons.Deny!, r.clock.ms));
    expect(viaSlack.status).toBe(200);
    expect(r.core.decisions).toEqual([]);
    // The genuine Slack button still works afterwards.
    r.clock.advance(1000);
    await r.chat.handleCallback("slack", r.slack.press(slackButton, r.clock.ms));
    expect(r.core.decisions).toHaveLength(1);
  });
});
