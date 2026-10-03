// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 18 exit criterion with real data: `phoenix run` wraps a failing build,
// passes its exit code through, and Fawkes enters ERROR with readable text.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { terminalCapability } from "@phoenix/capability-terminal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCore, TOKEN } from "./helpers";

const ROOT = join(import.meta.dirname, "../../..");
const CLI = join(ROOT, "capabilities/terminal/src/cli.ts");
const TSX = join(ROOT, "node_modules/.bin/tsx");

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

// Async on purpose: Core runs in this process and must keep serving while the CLI runs.
function phoenixRun(coreUrl: string, ...args: string[]) {
  const child = spawn(TSX, [CLI, "run", ...args], {
    env: { ...process.env, PHOENIX_CORE_URL: coreUrl, PHOENIX_SESSION_TOKEN: TOKEN },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c: Buffer) => (stdout += c));
  child.stderr.on("data", (c: Buffer) => (stderr += c));
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) =>
    child.on("close", (status) => resolve({ status, stdout, stderr })),
  );
}

describe("phoenix run", () => {
  it("a failing build drives Fawkes to ERROR and keeps the exit code", async () => {
    const core = await startCore({}, { capabilities: [terminalCapability] });
    stop = () => core.runtime.stop();
    await core.api("POST", "/api/capabilities/terminal/enable", {});

    const script = "console.log('compiling'); console.error('error TS2304: x'); process.exit(3)";
    const r = await phoenixRun(core.base, "--kind", "build", process.execPath, "-e", script);
    expect(r.status).toBe(3);
    expect(r.stdout).toContain("compiling");
    expect(r.stderr).toContain("error TS2304");
    expect(r.stderr).not.toMatch(/not reported/);

    // The report is accepted (202) before the capability emits; give it a moment.
    const state = await vi.waitFor(async () => {
      const s = (await core.api("GET", "/api/pet/state")).json;
      expect(s.state).toBe("ERROR");
      return s;
    });
    expect(state.explanation).toMatch(/^Build failed: .*node -e/);

    const events = (await core.api("GET", "/api/events?limit=50")).json.events as {
      event: { event_type: string; payload: Record<string, unknown> };
    }[];
    const types = events.map((e) => e.event.event_type);
    expect(types).toEqual(expect.arrayContaining(["build.started", "build.failed"]));
    // Reports have no side effects: they stay out of the activity history.
    expect(types).not.toContain("capability.command.completed");
    const failed = events.find((e) => e.event.event_type === "build.failed")!.event;
    expect(failed.payload).toMatchObject({ exit_code: 3, excerpt: "compiling\nerror TS2304: x" });
  });

  it("still runs the command when Phoenix Core is not reachable", async () => {
    const r = await phoenixRun("http://127.0.0.1:9", process.execPath, "-e", "process.exit(0)");
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/not reported/);
  });

  it("reports a missing command as exit 127", async () => {
    const r = await phoenixRun("http://127.0.0.1:9", "phoenix-no-such-command-xyz");
    expect(r.status).toBe(127);
  });
});
