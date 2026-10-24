// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { EventBus } from "@phoenix/event-bus";
import { AuditLog } from "@phoenix/permissions";
import { openDatabase } from "@phoenix/persistence";
import { createEvent } from "@phoenix/protocol";
import { describe, expect, it } from "vitest";
import { ChatApprovalsService } from "../src/chat-approvals/service";

const HOUR = 3_600_000;

/**
 * The scheduled digest through Core's service: resolve events are counted (outcome word only), the
 * check sends through the same transport, audit and enabled / kill-switch guards as a card, and the
 * time of the last send is handed to a store. Simulated: the transport is a recording fake.
 */
function rig(
  state: { enabled: boolean; killed: boolean; schedule: boolean } = {
    enabled: true,
    killed: false,
    schedule: true,
  },
) {
  const bus = new EventBus({ retryDelayMs: 0 });
  const db = openDatabase(":memory:");
  const audit = new AuditLog(db, () => 0);
  const sent: { url: string; body: string }[] = [];
  let at = Date.parse("2026-10-22T12:00:00Z");
  let stored: number | undefined;
  const service = new ChatApprovalsService({
    permissions: { pendingConfirmations: () => [], resolveConfirmation: () => false },
    agentApprovals: {
      list: () =>
        [
          {
            id: "apr_1",
            kind: "permission",
            agent: "claude",
            project: "alpha",
            tool: "Bash",
            input_summary: { command: "npm run secret-thing" },
            expires_at: new Date(at + 24 * HOUR).toISOString(),
          },
        ] as never,
      decide: () => undefined as never,
    },
    audit,
    bus,
    config: () => ({
      projects: ["alpha"],
      slack: { enabled: true, workspace: "T1", channel: "C1", approvers: ["U1"], digest: true },
      ...(state.schedule ? { digest_schedule: { enabled: true, interval_minutes: 60 } } : {}),
    }),
    enabled: () => state.enabled,
    killSwitchEngaged: () => state.killed,
    now: () => at,
    digestClock: {
      read: () => stored,
      write: (value) => {
        stored = value;
      },
    },
    transport: (request) => {
      sent.push({ url: request.url, body: request.body });
      return Promise.resolve({ status: 200, body: JSON.stringify({ ok: true }) });
    },
  });
  service.module.init?.({
    id: "chat-approvals",
    config: {},
    logger: { warn() {}, info() {}, error() {}, debug() {} },
    signal: new AbortController().signal,
    secret: () => Promise.resolve("a-generated-test-value"),
  } as never);
  const resolved = (outcome: string) =>
    bus.publish(
      createEvent({
        event_type: "agent.approval.resolved",
        source: "core",
        severity: "info",
        payload: { id: "apr_0", outcome, decided_by: "user" },
      }),
    );
  return {
    service,
    bus,
    sent,
    audit,
    resolved,
    advance: (ms: number) => {
      at += ms;
    },
    stored: () => stored,
  };
}

describe("chat approvals digest in Core", () => {
  it("counts decisions by outcome, sends once the interval is up and records the time", async () => {
    const r = rig();
    await r.service.checkDigest(); // starts the interval, sends nothing
    expect(r.sent).toEqual([]);
    expect(r.stored()).toBeDefined();
    r.resolved("allow");
    r.resolved("deny");
    r.resolved("surprise");
    await r.bus.drain();
    r.advance(HOUR);
    await r.service.checkDigest();
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.url).toContain("slack.com");
    expect(r.sent[0]!.body).toContain("3 decided");
    expect(r.sent[0]!.body).toContain("1 allowed, 1 denied, 0 expired, 1 other");
    expect(r.sent[0]!.body).toContain("apr_1 Bash");
    expect(r.sent[0]!.body).not.toMatch(/secret-thing|alpha/);
    const row = r.audit.list({ limit: 5 }).find((a) => a.action === "chat.digest.sent");
    expect(row).toMatchObject({ actor: "chat:scheduler", decision: "allowed" });
    expect(r.stored()).toBe(Date.parse("2026-10-22T13:00:00Z"));
    await r.service.checkDigest();
    expect(r.sent).toHaveLength(1);
  });

  it("sends nothing while the schedule is off, the capability is off or the emergency stop is on", async () => {
    for (const state of [
      { enabled: true, killed: false, schedule: false },
      { enabled: false, killed: false, schedule: true },
      { enabled: true, killed: true, schedule: true },
    ]) {
      const r = rig(state);
      await r.service.checkDigest();
      r.resolved("allow");
      await r.bus.drain();
      r.advance(5 * HOUR);
      await r.service.checkDigest();
      expect([JSON.stringify(state), r.sent]).toEqual([JSON.stringify(state), []]);
    }
  });

  it("runs no timer until it is started and stops it on close", async () => {
    const r = rig();
    r.service.close();
    r.service.startDigest();
    r.service.close();
    expect(r.sent).toEqual([]);
  });
});
