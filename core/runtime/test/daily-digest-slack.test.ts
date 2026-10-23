// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { SECRETS, type HttpRequest } from "@phoenix/capability-chat-approvals";
import { MemorySecretStore } from "@phoenix/persistence";
import { describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

const WORKSPACE = "T0PHOENIX";
const CHANNEL = "C0DIGEST";
const OWNER = "U0OWNER";

interface ConfiguredCore {
  core: TestCore;
  slack: FakeSlack;
}

class FakeSlack {
  readonly sent: HttpRequest[] = [];

  send = async (request: HttpRequest) => {
    this.sent.push(request);
    return { status: 200, body: '{"ok":true}' };
  };
}

async function configured(): Promise<ConfiguredCore> {
  const secrets = new MemorySecretStore();
  const slack = new FakeSlack();
  const core = await startCore({}, { secrets, runtime: { chatTransport: slack.send } });
  await core.runtime.capabilities.setSecret("chat-approvals", SECRETS.slackBotToken, "fake-token");
  core.runtime.capabilities.configure("chat-approvals", {
    projects: [],
    slack: { enabled: true, workspace: WORKSPACE, channel: CHANNEL, approvers: [OWNER] },
  });
  await core.runtime.capabilities.enable("chat-approvals", "user");
  core.runtime.permissions.grant("chat-approvals", ["network", "external_api"]);
  return { core, slack };
}

async function pending(core: TestCore) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const confirmation = core.runtime.permissions.pendingConfirmations()[0];
    if (confirmation) return confirmation;
    await Promise.resolve();
  }
  throw new Error("Daily digest confirmation was not created");
}

describe("daily digest Slack delivery", () => {
  it("stays off by default and cannot call a transport", async () => {
    const { core, slack } = await configured();
    try {
      expect((await core.api("GET", "/api/digest/slack")).json).toMatchObject({
        enabled: false,
        available: false,
        reason: "disabled",
      });
      const result = await core.api("POST", "/api/digest/slack", {});
      expect(result.status).toBe(403);
      expect(slack.sent).toEqual([]);
    } finally {
      await core.runtime.stop();
    }
  });

  it("requires Core approval, sends only after it, and records the exact generated digest", async () => {
    const { core, slack } = await configured();
    try {
      expect((await core.api("PUT", "/api/digest/slack", { enabled: true })).json).toMatchObject({
        enabled: true,
        available: true,
        reason: "ready",
      });
      expect(await core.runtime.digestSlack!.status()).toMatchObject({
        enabled: true,
        available: true,
        reason: "ready",
      });
      const published = core.runtime.events.append({
        event_id: "evt_abcdefgh",
        event_type: "github.ci.passed",
        version: "1.1",
        source: "github",
        timestamp: "2026-10-21T12:00:00.000Z",
        severity: "info",
        subject: "Cited delivery fixture",
        payload: {},
      });
      expect(published).not.toBeNull();
      const delivery = core.runtime.digestSlack!.send("2026-10-22");
      const confirmation = await pending(core);
      expect(confirmation).toMatchObject({
        capabilityId: "chat-approvals",
        command: "post_daily_digest",
        sideEffect: "external",
        permissions: ["network", "external_api"],
        summary: expect.stringContaining("2026-10-22"),
        details: { dailyDigest: { citedSourceCount: 1 } },
      });
      expect(slack.sent).toEqual([]);
      expect(core.runtime.permissions.resolveConfirmation(confirmation.id, true)).toBe(true);
      expect(await delivery).toEqual({ ok: true, day: "2026-10-22", cited_sources: 1 });
      expect(slack.sent).toHaveLength(1);
      expect(slack.sent[0]!.url).toBe("https://slack.com/api/chat.postMessage");
      const body = JSON.parse(slack.sent[0]!.body) as {
        channel: string;
        text: string;
        blocks: unknown[];
      };
      expect(body.channel).toBe(CHANNEL);
      expect(body.text).toContain("Daily digest — 2026-10-22");
      expect(body.text).toContain("Unverified event · Cited delivery fixture");
      expect(body.blocks).toHaveLength(5);
    } finally {
      await core.runtime.stop();
    }
  });

  it("does not send when the person rejects the Core confirmation", async () => {
    const { core, slack } = await configured();
    try {
      await core.api("PUT", "/api/digest/slack", { enabled: true });
      const delivery = core.runtime.digestSlack!.send("2026-10-22");
      const confirmation = await pending(core);
      expect(core.runtime.permissions.resolveConfirmation(confirmation.id, false)).toBe(true);
      await expect(delivery).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect(slack.sent).toEqual([]);
      expect(
        core.runtime.permissions.audit
          .list({ capabilityId: "chat-approvals" })
          .some(
            (entry) =>
              entry.action === "action.succeeded" && entry.details.command === "post_daily_digest",
          ),
      ).toBe(false);
    } finally {
      await core.runtime.stop();
    }
  });

  it("fails closed when the emergency stop is engaged before delivery", async () => {
    const { core, slack } = await configured();
    try {
      await core.api("PUT", "/api/digest/slack", { enabled: true });
      core.runtime.permissions.engageKillSwitch();
      const result = await core.api("POST", "/api/digest/slack", {});
      expect(result.status).toBe(403);
      expect(slack.sent).toEqual([]);
      expect(core.runtime.permissions.pendingConfirmations()).toEqual([]);
    } finally {
      await core.runtime.stop();
    }
  });

  it("cancels a delivery when the emergency stop engages during confirmation", async () => {
    const { core, slack } = await configured();
    try {
      await core.api("PUT", "/api/digest/slack", { enabled: true });
      const delivery = core.runtime.digestSlack!.send("2026-10-22");
      await pending(core);
      core.runtime.permissions.engageKillSwitch();
      await expect(delivery).rejects.toMatchObject({ code: "SECURITY_POLICY_BLOCKED" });
      expect(slack.sent).toEqual([]);
    } finally {
      await core.runtime.stop();
    }
  });
});
