// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { EventBus } from "@phoenix/event-bus";
import { AuditLog } from "@phoenix/permissions";
import { openDatabase } from "@phoenix/persistence";
import { createEvent } from "@phoenix/protocol";
import { describe, expect, it } from "vitest";
import { ChatApprovalsService } from "../src/chat-approvals/service";

/**
 * The runtime also disables the capability on the emergency stop, but that happens a moment later.
 * The module is initialised here with a fake context, so it would answer and post; the service's
 * own switch and kill-switch checks are then the only thing that can stop it, and each is proven.
 */
function rig(state: { enabled: boolean; killed: boolean }) {
  const bus = new EventBus({ retryDelayMs: 0 });
  const audit = new AuditLog(openDatabase(":memory:"), () => 0);
  const sent: string[] = [];
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
            input_summary: { command: "npm test" },
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
        ] as never,
      decide: () => undefined as never,
    },
    audit,
    bus,
    config: () => ({
      projects: ["alpha"],
      slack: { enabled: true, workspace: "T1", channel: "C1", approvers: ["U1"] },
    }),
    enabled: () => state.enabled,
    killSwitchEngaged: () => state.killed,
    transport: (request) => {
      sent.push(request.url);
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
  const raised = () =>
    bus.publish(
      createEvent({
        event_type: "agent.approval.requested",
        source: "agents",
        severity: "warning",
        payload: {},
      }),
    );
  return { service, bus, sent, raised };
}

const CLOSED = [
  { enabled: false, killed: false },
  { enabled: true, killed: true },
];

describe("chat approvals service guards", () => {
  it("answers a callback with 503 while the capability is off or the emergency stop is on", async () => {
    for (const state of CLOSED) {
      const { service } = rig(state);
      const reply = await service.handleCallback("slack", { headers: {}, body: Buffer.from("") });
      expect([JSON.stringify(state), reply.status]).toEqual([JSON.stringify(state), 503]);
    }
  });

  it("with both guards open the callback reaches the provider's signature check instead", async () => {
    const { service } = rig({ enabled: true, killed: false });
    const reply = await service.handleCallback("slack", { headers: {}, body: Buffer.from("") });
    expect(reply.status).toBe(401);
  });

  it("posts nothing for a new approval while off or stopped, and posts when open", async () => {
    for (const state of CLOSED) {
      const { service, bus, sent, raised } = rig(state);
      raised();
      await bus.drain();
      await service.idle();
      expect([JSON.stringify(state), sent]).toEqual([JSON.stringify(state), []]);
    }
    const open = rig({ enabled: true, killed: false });
    open.raised();
    await open.bus.drain();
    await open.service.idle();
    expect(open.sent.length).toBeGreaterThan(0);
  });
});
