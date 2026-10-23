// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// Relative imports: the CLI package itself depends on no workspace package, so the test reaches
// the real Core through the repo layout instead of declaring Core as a dependency.
import { defaults } from "../../../core/config/src/index";
import { silentLogger } from "../../../core/logging/src/index";
import { PhoenixRuntime } from "../../../core/runtime/src/index";
import { makeHarness, type Harness } from "./harness";

const TOKEN = "cli-integration-session-token";
let runtime: PhoenixRuntime | undefined;
let h: Harness | undefined;

afterEach(async () => {
  h?.cleanup();
  h = undefined;
  await runtime?.stop();
  runtime = undefined;
});

async function core() {
  const dataDir = mkdtempSync(join(tmpdir(), "phoenix-cli-core-"));
  runtime = new PhoenixRuntime({
    config: { ...defaults("dev"), port: 0, dataDir },
    databasePath: ":memory:",
    logger: silentLogger,
    token: TOKEN,
    capabilities: [],
    writeTokenFile: true,
  });
  const { port } = await runtime.start();
  h = makeHarness(TOKEN, `http://127.0.0.1:${port}`);
  return h;
}

describe("phoenix CLI against the real loopback Core API", () => {
  it("uses Core's session.token, status routes, confirmation route and audit log end to end", async () => {
    const cli = await core();
    const waiting = runtime!.permissions.authorize({
      capabilityId: "cli-test",
      command: "delete-preview",
      permissions: [],
      sideEffect: "write",
      summary: "Delete the test preview",
    });
    const confirmation = runtime!.permissions.pendingConfirmations()[0]!;
    const status = await cli.cli(["status"]);
    expect(status.code).toBe(0);
    expect(status.out).toContain("Approvals waiting 1");

    const list = JSON.parse((await cli.cli(["approvals", "list", "--json"])).out) as {
      approvals: { id: string; ref: string; source: string }[];
    };
    expect(list.approvals).toHaveLength(1);
    expect(list.approvals[0]).toMatchObject({ id: confirmation.id, source: "confirmation" });

    const result = await cli.cli([
      "approvals",
      "approve",
      confirmation.id,
      "--ref",
      list.approvals[0]!.ref,
    ]);
    expect(result.code).toBe(0);
    await expect(waiting).resolves.toMatchObject({ confirmationId: confirmation.id });
    const audit = runtime!.permissions.audit.list({ capabilityId: "cli-test" });
    expect(
      audit.some((entry) => entry.action === "confirmation.approved" && entry.actor === "user"),
    ).toBe(true);
  });

  it("fails closed against the real memory route when Core produced no AI answer", async () => {
    const cli = await core();
    const r = await cli.cli(["ask", "why did CI fail?"]);
    // No model was configured or called: Core answers 200 without generated text.
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toMatch(/^phoenix: .+/);
    expect(cli.everything(r)).not.toContain(TOKEN);
  });

  it("uses the existing agent approval decision API and records phoenix-cli as the client", async () => {
    const cli = await core();
    const created = runtime!.agentApprovals.create({
      kind: "permission",
      agent: "test-agent",
      session_id: "test-session",
      project: "/work/test",
      tool: "Bash",
      input_summary: { command: "git status" },
      suggestions_ok: true,
    });
    if (created.status !== "pending") throw new Error("Test request should wait for a decision");
    const list = JSON.parse((await cli.cli(["approvals", "list", "--json"])).out) as {
      approvals: { id: string; ref: string }[];
    };
    const request = list.approvals.find((a) => a.id === created.id)!;
    expect((await cli.cli(["approvals", "deny", created.id, "--ref", request.ref])).code).toBe(0);
    const row = runtime!.agentApprovals.history(10).find((entry) => entry.id === created.id)!;
    expect(row.outcome).toBe("deny");
    expect(row.client).toBe("phoenix-cli");
  });

  it("uses the actual Core event history endpoint", async () => {
    const cli = await core();
    runtime!.bus.publish({
      event_id: "evt_clitail0001",
      event_type: "build.failed",
      version: "1.1",
      source: "terminal",
      timestamp: "2026-10-22T12:00:00.000Z",
      severity: "error",
      payload: {},
    });
    const tail = await cli.cli(["events", "tail", "--source", "terminal"]);
    expect(tail.code).toBe(0);
    expect(tail.out).toMatch(/^#\d+ /);
    expect(tail.out).toContain("build.failed");
  });
});
