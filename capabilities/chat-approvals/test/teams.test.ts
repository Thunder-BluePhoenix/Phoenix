// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Teams is notify-only: a card with a signed Open-in-Phoenix link, no Allow button, no inbound door.
// The link proves which request Core notified about; it decides nothing.
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEEP_LINK_BASE,
  SignatureError,
  signDeepLink,
  teamsWebhookUrl,
  verifyDeepLink,
} from "../src";
import { agentRequest, baseConfig, makeRig, TEAMS_WEBHOOK, type Rig } from "./rig";

let rig: Rig | undefined;
afterEach(async () => {
  await rig?.harness.close();
  rig = undefined;
});

const teamsConfig = () => baseConfig({ teams: { enabled: true }, slack: {}, discord: {} });

describe("Teams card", () => {
  it("goes to the webhook with a signed link and has no decision button", async () => {
    rig = await makeRig(teamsConfig());
    rig.core.add(agentRequest());
    await rig.chat.postPending();
    expect(rig.transport.sent).toHaveLength(1);
    const sent = rig.transport.sent[0]!;
    expect(sent.request.url).toBe(TEAMS_WEBHOOK);
    const card = (
      sent.body.attachments as { content: { actions: { type: string; url: string }[] } }[]
    )[0]!.content;
    expect(card.actions).toEqual([
      expect.objectContaining({ type: "Action.OpenUrl", title: "Open in Phoenix" }),
    ]);
    expect(card.actions[0]!.url.startsWith(DEEP_LINK_BASE)).toBe(true);
    expect(sent.request.body).not.toMatch(/Action\.Submit|Allow|Deny/);
  });

  it("the link opens the request it was made for, and refuses once the request changed", async () => {
    rig = await makeRig(teamsConfig());
    rig.core.add(agentRequest());
    await rig.chat.postPending();
    const link = (
      rig.transport.sent[0]!.body.attachments as { content: { actions: { url: string }[] } }[]
    )[0]!.content.actions[0]!.url;
    const shown = await rig.chat.openTeamsLink(link);
    expect(shown).toMatchObject({ kind: "show", id: "apr_1" });
    expect(rig.core.decisions).toEqual([]);
    rig.core.change("agent", "apr_1", "rm -rf /");
    expect(await rig.chat.openTeamsLink(link)).toEqual({
      kind: "refused",
      reason: "request_changed",
    });
    rig.clock.advance(400_000);
    expect(await rig.chat.openTeamsLink(link)).toEqual({ kind: "refused", reason: "expired" });
  });

  it("a link with an edited field, a forged key or a missing signature is refused", async () => {
    const r = (rig = await makeRig(teamsConfig()));
    const snapshot = r.core.add(agentRequest());
    const key = randomBytes(16).toString("hex");
    const link = signDeepLink(key, snapshot, r.clock.ms, 60_000)!;
    expect(verifyDeepLink(link, key, r.clock.ms).id).toBe("apr_1");
    expect(() => verifyDeepLink(link.replace("apr_1", "apr_2"), key, r.clock.ms)).toThrow(
      SignatureError,
    );
    expect(() => verifyDeepLink(link, randomBytes(16).toString("hex"), r.clock.ms)).toThrow(
      SignatureError,
    );
    expect(() => verifyDeepLink(link, key, r.clock.ms + 61_000)).toThrow(SignatureError);
    await expect(r.chat.openTeamsLink("phoenix://approvals/open?s=agent")).resolves.toEqual({
      kind: "refused",
      reason: "bad_link",
    });
  });

  it("never posts to a URL that is not a Microsoft webhook", () => {
    expect(teamsWebhookUrl(TEAMS_WEBHOOK)).toBeDefined();
    for (const bad of [
      "http://x.webhook.office.com/a",
      "https://evil.example/a",
      "https://webhook.office.com.evil.example/a",
      "https://user:pw@x.webhook.office.com/a",
      "https://x.webhook.office.com:8443/a",
      "nonsense",
    ])
      expect(teamsWebhookUrl(bad)).toBeUndefined();
  });
});
