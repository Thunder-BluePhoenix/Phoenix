// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { openDatabase } from "@phoenix/persistence";
import { ErrorCode, PhoenixError, type PhoenixEvent } from "@phoenix/protocol";
import { describe, expect, it } from "vitest";
import { PermissionGateway, type ActionRequest } from "../src";

function setup(opts: { timeoutMs?: number } = {}) {
  const events: PhoenixEvent[] = [];
  const db = openDatabase(":memory:");
  const gw = new PermissionGateway({
    db,
    publish: (e) => void events.push(e),
    confirmationTimeoutMs: opts.timeoutMs ?? 60_000,
  });
  return { gw, events, db };
}

const read: ActionRequest = {
  capabilityId: "git",
  command: "git.status",
  permissions: ["repository_access"],
  sideEffect: "read",
  summary: "Read repository status",
};
const write: ActionRequest = {
  capabilityId: "github",
  command: "issue.create",
  permissions: ["external_api"],
  sideEffect: "external",
  summary: "Create a GitHub issue",
};

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof PhoenixError ? e.code : String(e);
  }
}

describe("grants", () => {
  it("denies without a grant and allows a granted read", async () => {
    const { gw, events } = setup();
    expect(await code(gw.authorize(read))).toBe(ErrorCode.PERMISSION_DENIED);
    expect(events.map((e) => e.event_type)).toEqual(["security.permission.denied"]);
    gw.grant("git", ["repository_access"]);
    expect(await code(gw.authorize(read))).toBe("ok");
  });

  it("reports which permissions are missing", async () => {
    const { gw } = setup();
    gw.grant("x", ["network"]);
    const err = await gw
      .authorize({ ...read, capabilityId: "x", permissions: ["network", "filesystem_write"] })
      .catch((e: PhoenixError) => e);
    expect((err as PhoenixError).details).toEqual(["filesystem_write"]);
  });

  it("grants are per capability and revocable", async () => {
    const { gw } = setup();
    gw.grant("git", ["repository_access"]);
    expect(await code(gw.authorize({ ...read, capabilityId: "other" }))).toBe(
      ErrorCode.PERMISSION_DENIED,
    );
    gw.revoke("git", ["repository_access"]);
    expect(await code(gw.authorize(read))).toBe(ErrorCode.PERMISSION_DENIED);
  });

  it("expired grants no longer count", async () => {
    const { gw } = setup();
    gw.grant("git", ["repository_access"], "user", new Date(Date.now() - 1));
    expect(await code(gw.authorize(read))).toBe(ErrorCode.PERMISSION_DENIED);
  });

  it("grants persist across gateway instances", async () => {
    const { gw, db } = setup();
    gw.grant("git", ["repository_access"]);
    expect(await code(new PermissionGateway({ db }).authorize(read))).toBe("ok");
  });
});

describe("confirmation flow", () => {
  it("external side effects wait for approval", async () => {
    const { gw, events } = setup();
    gw.grant("github", ["external_api"]);
    const pending = gw.authorize(write);
    await Promise.resolve();
    const [conf] = gw.pendingConfirmations();
    expect(conf).toMatchObject({ capabilityId: "github", summary: "Create a GitHub issue" });
    const requested = events.find((e) => e.event_type === "security.confirmation.requested");
    expect(requested).toMatchObject({ requires_action: true, correlation_id: conf!.id });

    expect(gw.resolveConfirmation(conf!.id, true)).toBe(true);
    const action = await pending;
    expect(action.confirmationId).toBe(conf!.id);
    expect(gw.pendingConfirmations()).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({
      event_type: "security.confirmation.resolved",
      payload: { outcome: "approved" },
    });
  });

  it("rejection produces PERMISSION_DENIED and no side effect", async () => {
    const { gw } = setup();
    gw.grant("github", ["external_api"]);
    let ran = false;
    const p = gw.authorize(write).then(() => (ran = true));
    await Promise.resolve();
    gw.resolveConfirmation(gw.pendingConfirmations()[0]!.id, false);
    expect(await code(p)).toBe(ErrorCode.PERMISSION_DENIED);
    expect(ran).toBe(false);
  });

  it("unanswered confirmations expire", async () => {
    const { gw } = setup({ timeoutMs: 10 });
    gw.grant("github", ["external_api"]);
    expect(await code(gw.authorize(write))).toBe(ErrorCode.OPERATION_TIMEOUT);
  });

  it("recording always needs confirmation even as a read", () => {
    const { gw } = setup();
    expect(gw.needsConfirmation({ sideEffect: "read", permissions: ["meeting_recording"] })).toBe(
      true,
    );
    expect(gw.needsConfirmation({ sideEffect: "read", permissions: ["repository_access"] })).toBe(
      false,
    );
    expect(gw.needsConfirmation({ sideEffect: "write", permissions: [] })).toBe(true);
  });

  it("resolving an unknown confirmation returns false", () => {
    expect(setup().gw.resolveConfirmation("conf_nope", true)).toBe(false);
  });
});

describe("kill switch", () => {
  it("blocks everything and rejects pending confirmations", async () => {
    const { gw, events } = setup();
    gw.grant("git", ["repository_access"]);
    gw.grant("github", ["external_api"]);
    const pending = gw.authorize(write);
    await Promise.resolve();

    gw.engageKillSwitch("user", "test");
    expect(await code(pending)).toBe(ErrorCode.SECURITY_POLICY_BLOCKED);
    expect(await code(gw.authorize(read))).toBe(ErrorCode.SECURITY_POLICY_BLOCKED);
    expect(events.some((e) => e.event_type === "security.kill_switch.engaged")).toBe(true);

    gw.disengageKillSwitch();
    expect(await code(gw.authorize(read))).toBe("ok");
  });

  it("survives restart", () => {
    const { gw, db } = setup();
    gw.engageKillSwitch();
    expect(new PermissionGateway({ db }).isKillSwitchEngaged()).toBe(true);
  });
});

describe("audit", () => {
  it("records every decision, newest first, with secrets redacted", async () => {
    const { gw } = setup();
    await code(gw.authorize(read));
    gw.grant("git", ["repository_access"]);
    const action = await gw.authorize({ ...read, details: { token: "leak" } });
    gw.recordOutcome(action, "succeeded", { password: "nope" });
    const entries = gw.audit.list();
    expect(entries.map((e) => [e.action, e.decision])).toEqual([
      ["action.succeeded", "info"],
      ["action.authorized", "allowed"],
      ["permission.granted", "info"],
      ["action.denied", "denied"],
    ]);
    expect(JSON.stringify(entries)).not.toContain("nope");
    expect(gw.audit.list({ capabilityId: "other" })).toHaveLength(0);
  });
});
