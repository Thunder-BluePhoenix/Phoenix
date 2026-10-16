// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// requestApproval against an in-process fake Core (node:http, 127.0.0.1, port 0). Deadlines run
// on fake timers: nothing here waits in real time.
import { isRecord } from "../src/guards";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestApproval } from "../src/approval-client";
import { approvalDigest, mapApprovalPayload, type ApprovalRequest } from "../src/approval-map";
import {
  decided,
  ID,
  NONCE,
  pending,
  pendingThen,
  startFakeCore,
  TOKEN_FOR_TESTS,
  type FakeCore,
  type Script,
} from "./approval-core";
import { CWD, SESSION } from "./fixtures";

const request = (timeoutMs = 120_000): ApprovalRequest =>
  mapApprovalPayload(
    {
      session_id: SESSION,
      cwd: CWD,
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    },
    { agent: "claude-code", timeoutMs },
  )!.request;

let core: FakeCore | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await core?.close();
  core = undefined;
});

async function run(script: Script, req = request()) {
  core = await startFakeCore(script);
  return requestApproval(req, { coreUrl: core.url, token: TOKEN_FOR_TESTS });
}

describe("requestApproval: decisions", () => {
  it("allow: creates with the session token, waits with the nonce, returns the decision", async () => {
    const outcome = await run(pendingThen(decided({ behavior: "allow" })));
    expect(outcome).toEqual({ decision: { behavior: "allow" }, decidedBy: "user" });
    const [create, wait] = core!.hits;
    expect(create).toMatchObject({
      method: "POST",
      path: "/api/agent-approvals",
      authorization: `Bearer ${TOKEN_FOR_TESTS}`,
    });
    expect(create!.body).toEqual(request());
    expect(wait).toMatchObject({
      path: `/api/agent-approvals/${ID}/wait`,
      authorization: `Bearer ${TOKEN_FOR_TESTS}`,
    });
    expect(wait!.body).toEqual({ nonce: NONCE, wait_ms: expect.any(Number) });
  });

  it("deny keeps the message", async () => {
    const outcome = await run(pendingThen(decided({ behavior: "deny", message: "No thanks" })));
    expect(outcome).toEqual({
      decision: { behavior: "deny", message: "No thanks" },
      decidedBy: "user",
    });
  });

  it("an Always decision arrives as a plain allow (Phoenix applies the rule itself)", async () => {
    const outcome = await run(
      pendingThen(decided({ behavior: "allow", always: { ttl_minutes: 30 } })),
    );
    expect(outcome).toEqual({ decision: { behavior: "allow" }, decidedBy: "user" });
  });

  it("keeps long-polling while the reply is pending", async () => {
    const outcome = await run(pendingThen(pending, pending, decided({ behavior: "allow" })));
    expect(outcome).toMatchObject({ decision: { behavior: "allow" } });
    expect(core!.hits.filter((h) => h.path.endsWith("/wait"))).toHaveLength(3);
  });

  it("a policy or rule decision on create needs no wait and no nonce", async () => {
    const outcome = await run((_hit, req) => ({
      status: 201,
      body: {
        id: ID,
        digest: approvalDigest(req!),
        status: "decided",
        decision: { behavior: "deny", message: "Blocked by policy" },
        decided_by: "policy",
      },
    }));
    expect(outcome).toEqual({
      decision: { behavior: "deny", message: "Blocked by policy" },
      decidedBy: "policy",
    });
    expect(core!.hits).toHaveLength(1);
  });
});

describe("requestApproval: fail open", () => {
  it("Core down", async () => {
    const outcome = await requestApproval(request(), {
      coreUrl: "http://127.0.0.1:9",
      token: TOKEN_FOR_TESTS,
    });
    expect(outcome).toEqual({ decision: null, reason: "Phoenix Core did not answer" });
  });

  it("no session token", async () => {
    const outcome = await requestApproval(request(), {
      coreUrl: "http://127.0.0.1:9",
      token: "",
    });
    // Falls back to the environment/data dir lookup: either it finds none or Core is down.
    expect(outcome.decision).toBeNull();
  });

  it.each([500, 503, 401, 404, 409])("create answers HTTP %d", async (status) => {
    const outcome = await run(() => ({ status, body: { message: "nope" } }));
    expect(outcome).toEqual({ decision: null, reason: `create failed (HTTP ${status})` });
    expect(core!.hits).toHaveLength(1);
  });

  it("wait answers 500", async () => {
    const outcome = await run(pendingThen(() => ({ status: 500, body: { message: "boom" } })));
    expect(outcome).toEqual({ decision: null, reason: "wait failed (HTTP 500)" });
  });

  it("wait answers 404 (wrong nonce looks like this)", async () => {
    const outcome = await run(pendingThen(() => ({ status: 404, body: {} })));
    expect(outcome).toEqual({ decision: null, reason: "wait failed (HTTP 404)" });
  });

  it.each([
    ["create", () => ({ status: 201, raw: "{not json" })],
    ["create (HTML)", () => ({ status: 200, raw: "<html></html>" })],
    ["create (an array)", () => ({ status: 201, raw: "[]" })],
    ["create (empty)", () => ({ status: 201, raw: "" })],
  ] as const)("malformed %s response", async (_name, reply) => {
    const outcome = await run(reply);
    expect(outcome.decision).toBeNull();
    expect(core!.hits).toHaveLength(1);
  });

  it("malformed wait response", async () => {
    const outcome = await run(pendingThen(() => ({ status: 200, raw: "{oops" })));
    expect(outcome).toEqual({ decision: null, reason: "wait failed (HTTP 200)" });
  });

  it.each([
    ["an empty behavior", { behavior: "" }],
    ["an unknown behavior", { behavior: "maybe" }],
  ])("a decided reply with %s", async (_name, decision) => {
    const outcome = await run(pendingThen(decided(decision)));
    expect(outcome).toEqual({ decision: null, reason: "malformed decision" });
  });

  it.each([
    ["pending", "expired"],
    ["pending", "cancelled"],
    ["pending", "terminal"],
  ])("status %s then %s means no decision", async (_first, status) => {
    const outcome = await run(
      pendingThen((d) => ({ status: 200, body: { id: ID, digest: d, status } })),
    );
    expect(outcome.decision).toBeNull();
  });

  it("a malformed create reply (bad id or nonce) is rejected", async () => {
    const badId = await run((_h, req) => ({
      status: 201,
      body: { id: "apr_x", nonce: NONCE, digest: approvalDigest(req!), status: "pending" },
    }));
    expect(badId).toEqual({ decision: null, reason: "malformed approval id" });
    await core!.close();
    const badNonce = await run((_h, req) => ({
      status: 201,
      body: { id: ID, nonce: "short", digest: approvalDigest(req!), status: "pending" },
    }));
    expect(badNonce).toEqual({ decision: null, reason: "malformed nonce" });
  });
});

describe("requestApproval: id and digest binding", () => {
  const otherDigest = "0".repeat(64);
  const otherId = `apr_${"ef56".repeat(6)}`;

  it("a decision whose digest is another request's is ignored", async () => {
    const outcome = await run(
      pendingThen(() => ({
        status: 200,
        body: { id: ID, digest: otherDigest, status: "decided", decision: { behavior: "allow" } },
      })),
    );
    expect(outcome).toEqual({ decision: null, reason: "id or digest mismatch" });
  });

  it("a decision whose id is another request's is ignored", async () => {
    const outcome = await run(
      pendingThen((digest) => ({
        status: 200,
        body: { id: otherId, digest, status: "decided", decision: { behavior: "allow" } },
      })),
    );
    expect(outcome).toEqual({ decision: null, reason: "id or digest mismatch" });
  });

  it("a decision without id and digest is ignored", async () => {
    const outcome = await run(
      pendingThen(() => ({
        status: 200,
        body: { status: "decided", decision: { behavior: "allow" } },
      })),
    );
    expect(outcome.decision).toBeNull();
  });

  it("an immediate (policy) decision for another digest is ignored", async () => {
    const outcome = await run(() => ({
      status: 201,
      body: {
        id: ID,
        digest: otherDigest,
        status: "decided",
        decision: { behavior: "allow" },
        decided_by: "rule",
      },
    }));
    expect(outcome.decision).toBeNull();
  });

  it("a create reply with another digest is ignored", async () => {
    const outcome = await run(() => ({
      status: 201,
      body: { id: ID, nonce: NONCE, digest: otherDigest, status: "pending" },
    }));
    expect(outcome).toEqual({ decision: null, reason: "id or digest mismatch" });
    expect(core!.hits).toHaveLength(1);
  });

  it("a pending reply that names another request stops the wait", async () => {
    const outcome = await run(
      pendingThen(() => ({
        status: 200,
        body: { id: otherId, digest: otherDigest, status: "pending" },
      })),
    );
    expect(outcome).toEqual({ decision: null, reason: "id or digest mismatch" });
  });

  it("terminal means the user will answer in the terminal: no decision", async () => {
    const outcome = await run(
      pendingThen((digest) => ({
        status: 200,
        body: { id: ID, digest, status: "terminal" },
      })),
    );
    expect(outcome).toEqual({ decision: null, reason: "answered in the terminal" });
  });
});

describe("requestApproval: deadlines (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  it("Core never answers create: gives up at the create budget, not later", async () => {
    core = await startFakeCore(() => "hang");
    const promise = requestApproval(request(5_000), {
      coreUrl: core.url,
      token: TOKEN_FOR_TESTS,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await promise).toEqual({ decision: null, reason: "Phoenix Core did not answer" });
  });

  it("Core stops answering wait: gives up by timeout_ms", async () => {
    let created = false;
    core = await startFakeCore((_hit, req) => {
      if (req && !created) {
        created = true;
        return {
          status: 201,
          body: { id: ID, nonce: NONCE, digest: approvalDigest(req), status: "pending" },
        };
      }
      return "hang";
    });
    const waited = core.nextHit("/wait");
    const promise = requestApproval(request(30_000), {
      coreUrl: core.url,
      token: TOKEN_FOR_TESTS,
    });
    await waited;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await promise).toEqual({ decision: null, reason: "Phoenix Core did not answer" });
  });

  it("keeps asking until timeout_ms, then returns no decision", async () => {
    const script = pendingThen((digest) => {
      vi.setSystemTime(Date.now() + 4_000); // each long-poll "takes" 4 s
      return pending(digest);
    });
    core = await startFakeCore(script);
    const outcome = await requestApproval(request(10_000), {
      coreUrl: core.url,
      token: TOKEN_FOR_TESTS,
    });
    expect(outcome).toEqual({ decision: null, reason: "timed out waiting for a decision" });
    const waits = core.hits.filter((h) => h.path.endsWith("/wait"));
    expect(waits.length).toBeGreaterThanOrEqual(2);
    // Never asks Core to hold the poll past what is left of timeout_ms.
    for (const w of waits) {
      const waitMs = isRecord(w.body) ? w.body.wait_ms : undefined;
      expect(waitMs).toBeLessThanOrEqual(10_000);
    }
  });

  it("a decision arriving before the deadline still wins", async () => {
    const script = pendingThen(
      (digest) => {
        vi.setSystemTime(Date.now() + 4_000);
        return pending(digest);
      },
      decided({ behavior: "deny", message: "later" }),
    );
    core = await startFakeCore(script);
    const outcome = await requestApproval(request(10_000), {
      coreUrl: core.url,
      token: TOKEN_FOR_TESTS,
    });
    expect(outcome).toMatchObject({ decision: { behavior: "deny", message: "later" } });
  });
});

describe("requestApproval: the token only goes to this machine", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("a user:password URL pointing at the recording server receives nothing", async () => {
    core = await startFakeCore(pendingThen(decided({ behavior: "allow" })));
    const withCredentials = core.url.replace("http://", "http://user:pw@");
    vi.stubEnv("PHOENIX_CORE_URL", withCredentials);
    const outcome = await requestApproval(request(), { token: TOKEN_FOR_TESTS });
    expect(outcome.decision).toBeNull();
    expect(core.hits).toHaveLength(0);
  });

  it.each([
    "https://evil.example",
    "http://127.0.0.1.evil.example",
    "http://127.0.0.1@evil.example",
    "http://user:pw@127.0.0.1:4870",
    "ftp://127.0.0.1",
    "not a url",
  ])("PHOENIX_CORE_URL=%s: no request leaves the process", async (url) => {
    core = await startFakeCore(pendingThen(decided({ behavior: "allow" })));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.stubEnv("PHOENIX_CORE_URL", url);
    const outcome = await requestApproval(request(), { token: TOKEN_FOR_TESTS });
    expect(outcome).toEqual({
      decision: null,
      reason: "PHOENIX_CORE_URL is not a loopback address; nothing was sent",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(core.hits).toHaveLength(0);
  });

  it("an explicit non-loopback coreUrl is refused the same way", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const outcome = await requestApproval(request(), {
      coreUrl: "https://evil.example",
      token: TOKEN_FOR_TESTS,
      relay: false,
    });
    expect(outcome.decision).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a loopback PHOENIX_CORE_URL still works", async () => {
    core = await startFakeCore(pendingThen(decided({ behavior: "allow" })));
    vi.stubEnv("PHOENIX_CORE_URL", core.url);
    const outcome = await requestApproval(request(), { token: TOKEN_FOR_TESTS });
    expect(outcome.decision).toEqual({ behavior: "allow" });
    expect(core.hits[0]?.authorization).toBe(`Bearer ${TOKEN_FOR_TESTS}`);
  });
});
