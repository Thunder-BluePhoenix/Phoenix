// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// sendReport and requestApproval prefer the local relay, fall back to HTTP only when the relay is
// absent, and keep HTTP when an explicit Core URL is the only target. Real RelayServer, real fake
// HTTP Core, no real-time waiting.
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { requestApproval } from "../src/approval-client";
import { approvalDigest, mapApprovalPayload, type ApprovalRequest } from "../src/approval-map";
import { isRecord } from "../src/guards";
import { relayPreference } from "../src/relay/client";
import type { AgentReport } from "../src/report";
import { sendReport } from "../src/send";
import {
  ID,
  NONCE,
  pendingThen,
  decided,
  startFakeCore,
  TOKEN_FOR_TESTS,
  type FakeCore,
} from "./approval-core";
import { CWD, SESSION } from "./fixtures";
import { startRelay, tempDataDir } from "./relay-helpers";

const report: AgentReport = {
  agent: "claude-code",
  agent_id: SESSION,
  state: "working",
  workspace: CWD,
};

const request = (): ApprovalRequest =>
  mapApprovalPayload(
    {
      session_id: SESSION,
      cwd: CWD,
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    },
    { agent: "claude-code", timeoutMs: 120_000 },
  )!.request;

let core: FakeCore | undefined;
beforeEach(() => {
  // The developer's own environment must not steer transport choice.
  vi.stubEnv("PHOENIX_CORE_URL", "");
  vi.stubEnv("PHOENIX_RELAY_SOCKET", "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await core?.close();
  core = undefined;
});

const missingSocket = async () => join(await tempDataDir(), "absent.sock");

/** Relay-side Core for approvals: create -> pending, then each wait takes the next reply. */
function approvalHandlers(
  req: ApprovalRequest,
  waits: ((digest: string) => Record<string, unknown>)[],
) {
  const digest = approvalDigest(req);
  let round = 0;
  const create = vi.fn(() => ({ id: ID, nonce: NONCE, digest, status: "pending" }));
  const wait = vi.fn((body: unknown) => {
    const fields = isRecord(body) ? body : {};
    if (fields.id !== ID || fields.nonce !== NONCE) {
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "no such approval");
    }
    return waits[Math.min(round++, waits.length - 1)]!(digest);
  });
  return { create, wait };
}

describe("sendReport over the relay", () => {
  it("prefers the relay: op report, body is the report as-is, no token, no HTTP", async () => {
    core = await startFakeCore(() => ({ status: 200 }));
    const handler = vi.fn(() => ({ accepted: true }));
    const { path } = await startRelay({ handlers: { report: handler } });
    const sent = await sendReport(report, { relay: { socketPath: path }, coreUrl: core.url });
    expect(sent).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledExactlyOnceWith(report);
    expect(core.hits).toHaveLength(0);
  });

  it("uses PHOENIX_RELAY_SOCKET from the environment", async () => {
    const handler = vi.fn(() => null);
    const { path } = await startRelay({ handlers: { report: handler } });
    vi.stubEnv("PHOENIX_RELAY_SOCKET", path);
    vi.stubEnv("PHOENIX_CORE_URL", "http://127.0.0.1:9");
    expect(await sendReport(report)).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("falls back to HTTP when the relay is not there", async () => {
    core = await startFakeCore(() => ({ status: 200 }));
    const sent = await sendReport(report, {
      relay: { socketPath: await missingSocket() },
      coreUrl: core.url,
      token: TOKEN_FOR_TESTS,
    });
    expect(sent).toEqual({ ok: true });
    expect(core.hits).toHaveLength(1);
    expect(core.hits[0]).toMatchObject({
      path: "/api/capabilities/agents/commands/report",
      authorization: `Bearer ${TOKEN_FOR_TESTS}`,
      body: { input: report },
    });
  });

  it("does not fall back when the relay answered and refused", async () => {
    core = await startFakeCore(() => ({ status: 200 }));
    const { path } = await startRelay({
      handlers: {
        report: () => {
          throw new PhoenixError(ErrorCode.INVALID_EVENT, "bad report");
        },
      },
    });
    const sent = await sendReport(report, {
      relay: { socketPath: path },
      coreUrl: core.url,
      token: TOKEN_FOR_TESTS,
    });
    expect(sent).toEqual({ ok: false, message: "bad report" });
    expect(core.hits).toHaveLength(0);
  });

  it("an explicit coreUrl keeps HTTP, even with a live relay", async () => {
    core = await startFakeCore(() => ({ status: 200 }));
    const handler = vi.fn();
    const { path } = await startRelay({ handlers: { report: handler } });
    vi.stubEnv("PHOENIX_RELAY_SOCKET", ""); // no explicit relay choice
    expect(await sendReport(report, { coreUrl: core.url, token: TOKEN_FOR_TESTS })).toEqual({
      ok: true,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(core.hits).toHaveLength(1);
    expect(path).toBeTruthy();
  });

  it("relay: false forces HTTP", async () => {
    core = await startFakeCore(() => ({ status: 200 }));
    const handler = vi.fn();
    await startRelay({ handlers: { report: handler } });
    expect(
      await sendReport(report, { relay: false, coreUrl: core.url, token: TOKEN_FOR_TESTS }),
    ).toEqual({
      ok: true,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("relayPreference: an explicit HTTP target wins unless a relay was also chosen", () => {
    expect(relayPreference(undefined, undefined, {})).toEqual({});
    expect(relayPreference(undefined, "http://x", {})).toBeNull();
    expect(relayPreference(undefined, undefined, { PHOENIX_CORE_URL: "http://x" })).toBeNull();
    expect(relayPreference(undefined, "http://x", { PHOENIX_RELAY_SOCKET: "/s" })).toEqual({});
    expect(relayPreference({ socketPath: "/s" }, "http://x", {})).toEqual({ socketPath: "/s" });
    expect(relayPreference(false, undefined, { PHOENIX_RELAY_SOCKET: "/s" })).toBeNull();
  });
});

describe("requestApproval over the relay", () => {
  it("creates and long-polls over the relay: pending then decided returns the decision", async () => {
    core = await startFakeCore(() => ({ status: 500 }));
    const req = request();
    const handlers = approvalHandlers(req, [
      (digest) => ({ id: ID, digest, status: "pending" }),
      (digest) => ({
        id: ID,
        digest,
        status: "decided",
        decision: { behavior: "allow" },
        decided_by: "user",
      }),
    ]);
    const { path } = await startRelay({
      handlers: { "approval.create": handlers.create, "approval.wait": handlers.wait },
    });
    const outcome = await requestApproval(req, { relay: { socketPath: path }, coreUrl: core.url });
    expect(outcome).toEqual({ decision: { behavior: "allow" }, decidedBy: "user" });
    expect(handlers.create).toHaveBeenCalledExactlyOnceWith(req);
    expect(handlers.wait).toHaveBeenCalledTimes(2);
    expect(handlers.wait).toHaveBeenCalledWith({
      id: ID,
      nonce: NONCE,
      wait_ms: expect.any(Number),
    });
    expect(core.hits).toHaveLength(0); // no HTTP, no token needed
  });

  it("a digest mismatch from the relay is ignored: fail open, no HTTP retry", async () => {
    core = await startFakeCore(() => ({ status: 500 }));
    const req = request();
    const handlers = approvalHandlers(req, [
      () => ({
        id: ID,
        digest: "0".repeat(64),
        status: "decided",
        decision: { behavior: "allow" },
      }),
    ]);
    const { path } = await startRelay({
      handlers: { "approval.create": handlers.create, "approval.wait": handlers.wait },
    });
    const outcome = await requestApproval(req, { relay: { socketPath: path }, coreUrl: core.url });
    expect(outcome).toEqual({ decision: null, reason: "id or digest mismatch" });
    expect(core.hits).toHaveLength(0);
  });

  it("a relay that refuses (rejected) fails open without falling back to HTTP", async () => {
    core = await startFakeCore(() => ({ status: 500 }));
    const { path } = await startRelay({
      handlers: {
        "approval.create": () => {
          throw new PhoenixError(ErrorCode.INVALID_REQUEST, "nope");
        },
      },
    });
    const outcome = await requestApproval(request(), {
      relay: { socketPath: path },
      coreUrl: core.url,
    });
    expect(outcome).toEqual({ decision: null, reason: "create failed (HTTP 400)" });
    expect(core.hits).toHaveLength(0);
  });

  it("an unknown approval on wait (RESOURCE_NOT_FOUND) maps to 404", async () => {
    const req = request();
    const { path } = await startRelay({
      handlers: {
        "approval.create": () => ({
          id: ID,
          nonce: NONCE,
          digest: approvalDigest(req),
          status: "pending",
        }),
        "approval.wait": () => {
          throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "gone");
        },
      },
    });
    const outcome = await requestApproval(req, { relay: { socketPath: path } });
    expect(outcome).toEqual({ decision: null, reason: "wait failed (HTTP 404)" });
  });

  it("falls back to HTTP, with the token, when the relay is absent", async () => {
    core = await startFakeCore(pendingThen(decided({ behavior: "allow" })));
    const outcome = await requestApproval(request(), {
      relay: { socketPath: await missingSocket() },
      coreUrl: core.url,
      token: TOKEN_FOR_TESTS,
    });
    expect(outcome).toEqual({ decision: { behavior: "allow" }, decidedBy: "user" });
    expect(core.hits.map((h) => h.path)).toEqual([
      "/api/agent-approvals",
      `/api/agent-approvals/${ID}/wait`,
    ]);
    expect(core.hits.every((h) => h.authorization === `Bearer ${TOKEN_FOR_TESTS}`)).toBe(true);
  });

  it("an explicit coreUrl keeps HTTP even with a live relay", async () => {
    core = await startFakeCore(pendingThen(decided({ behavior: "deny", message: "No" })));
    const create = vi.fn();
    await startRelay({ handlers: { "approval.create": create } });
    const outcome = await requestApproval(request(), { coreUrl: core.url, token: TOKEN_FOR_TESTS });
    expect(outcome).toMatchObject({ decision: { behavior: "deny", message: "No" } });
    expect(create).not.toHaveBeenCalled();
  });
});
