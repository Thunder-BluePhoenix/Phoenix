// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it } from "vitest";
import { parseRunArgs } from "../src/cli";
import { classify, excerpt, redactText, terminalCapability } from "../src";

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe("classify", () => {
  it.each([
    ["pnpm test", "test"],
    ["npx vitest run", "test"],
    ["bench run-tests:unit", "command"],
    ["pytest -x tests/", "test"],
    ["npm run build", "build"],
    ["make", "build"],
    ["cargo build --release", "build"],
    ["tsc -p .", "build"],
    ["ls -la", "command"],
    ["git status", "command"],
  ])("%s → %s", (cmd, kind) => expect(classify(cmd)).toBe(kind));
});

describe("redaction", () => {
  it("removes secrets from command lines and output", () => {
    expect(redactText("deploy --token abc123 --password=hunter2 --api-key k")).toBe(
      "deploy --token [REDACTED] --password=[REDACTED] --api-key [REDACTED]",
    );
    expect(redactText("GITHUB_TOKEN=ghp_x DB_PASSWORD=p ./run")).toBe(
      "GITHUB_TOKEN=[REDACTED] DB_PASSWORD=[REDACTED] ./run",
    );
    expect(redactText("curl https://user:pa55@example.com/x")).toBe(
      "curl https://user:[REDACTED]@example.com/x",
    );
    expect(redactText("Authorization: Bearer abcdefghijklmnop")).toContain("[REDACTED]");
    expect(redactText("npm run build")).toBe("npm run build");
  });

  it("keeps the last lines of output without colour codes", () => {
    const out = Array.from({ length: 30 }, (_, i) => `\x1b[31mline ${i}\x1b[0m`).join("\n") + "\n";
    const text = excerpt(out, 3);
    expect(text).toBe("line 27\nline 28\nline 29");
    expect(excerpt("x".repeat(5_000)).length).toBe(2_000);
  });
});

describe("parseRunArgs", () => {
  it("separates phoenix flags from the command", () => {
    expect(parseRunArgs(["make", "--kind", "x"])).toEqual({ command: ["make", "--kind", "x"] });
    expect(parseRunArgs(["--kind", "test", "./check.sh"])).toEqual({
      kind: "test",
      command: ["./check.sh"],
    });
    expect(parseRunArgs(["--kind=build", "--", "--weird"])).toEqual({
      kind: "build",
      command: ["--weird"],
    });
    expect(() => parseRunArgs([])).toThrow(/Usage/);
    expect(() => parseRunArgs(["--kind", "nope", "x"])).toThrow(/Usage/);
  });
});

describe("terminal capability", () => {
  async function ready() {
    h = createHarness({ modules: [terminalCapability] });
    await h.enable("terminal");
    return h;
  }
  const report = (input: Record<string, unknown>) =>
    h!.run("terminal", "report", { id: "r1", command: "make", cwd: "/home/me/phoenix", ...input });

  it("a failing build makes Fawkes ERROR with readable text and an excerpt (US-03)", async () => {
    await ready();
    await report({ phase: "started" });
    expect(h!.state.snapshot()).toMatchObject({ state: "WORKING" });
    await report({
      phase: "finished",
      exit_code: 2,
      duration_ms: 1200,
      output: "cc: error: x.c\n",
    });
    expect(h!.state.snapshot()).toMatchObject({
      state: "ERROR",
      explanation: "Build failed: make",
    });
    const failed = h!.events.find((e) => e.event_type === "build.failed")!;
    expect(failed).toMatchObject({
      source: "terminal",
      subject: "phoenix",
      correlation_id: "run_r1",
      payload: { command: "make", exit_code: 2, excerpt: "cc: error: x.c" },
    });
    expect(h!.state.tasks()).toEqual([]);
  });

  it("passing tests show SUCCESS; plain commands complete", async () => {
    await ready();
    await report({ phase: "started", command: "pnpm test" });
    await report({ phase: "finished", command: "pnpm test", exit_code: 0 });
    expect(h!.state.snapshot().state).toBe("SUCCESS");
    await report({ id: "r2", phase: "finished", command: "ls", exit_code: 0 });
    expect(h!.types("terminal")).toEqual(["test.started", "test.passed", "command.completed"]);
  });

  it("an explicit kind wins over the guess", async () => {
    await ready();
    await report({ phase: "finished", command: "./ci.sh", kind: "test", exit_code: 1 });
    expect(h!.state.snapshot().explanation).toBe("Tests failed: ./ci.sh");
  });

  it("refuses unredacted secrets and malformed reports", async () => {
    await ready();
    expect(() =>
      h!.manager.invoke("terminal", "report", {
        phase: "started",
        id: "r1",
        command: "echo ghp_abcdefghijklmnopqrstuvwxyz0123",
      }),
    ).toThrow(/secrets/);
    expect(() =>
      h!.manager.invoke("terminal", "report", { phase: "started", id: "../x", command: "ls" }),
    ).toThrow(/Invalid command input/);
  });

  it("reports go nowhere while the capability is disabled", async () => {
    await ready();
    await h!.manager.disable("terminal");
    expect(() =>
      h!.manager.invoke("terminal", "report", { phase: "started", id: "a", command: "ls" }),
    ).toThrow(/not enabled/);
  });
});
