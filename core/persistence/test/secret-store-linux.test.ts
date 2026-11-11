// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { KeychainSecretStore, SecretTooLongError, type ToolRunner } from "../src";

// Fake `secret-tool`. The real tool is driven by core/persistence/test/real-linux/run-in-container.sh
// (manual, Docker): there `secret-tool store` kept only the first 8192 bytes of a longer value and
// still exited 0.
function runner(code = 0) {
  const calls: { cmd: string; args: string[]; stdin: string | undefined }[] = [];
  const run: ToolRunner = async (cmd, args, stdin) => {
    calls.push({ cmd, args, stdin });
    return { code, stdout: "", stderr: "" };
  };
  return { calls, run };
}

describe("KeychainSecretStore on Linux", () => {
  it("stores a value of exactly 8192 bytes whole, on stdin only", async () => {
    const { calls, run } = runner();
    const value = "x".repeat(8192);
    await new KeychainSecretStore("linux", run).set("r", value);
    expect(calls[0]!.cmd).toBe("secret-tool");
    expect(calls[0]!.args.join(" ")).not.toContain(value);
    expect(calls[0]!.stdin).toBe(value);
  });

  it("refuses a value over 8192 bytes instead of letting secret-tool cut it, and runs nothing", async () => {
    const { calls, run } = runner();
    await expect(new KeychainSecretStore("linux", run).set("r", "x".repeat(8193))).rejects.toThrow(
      SecretTooLongError,
    );
    expect(calls).toHaveLength(0);
  });

  it("counts bytes, not characters: 4097 two-byte characters are refused", async () => {
    const { calls, run } = runner();
    const store = new KeychainSecretStore("linux", run);
    await expect(store.set("r", "\u00e9".repeat(4097))).rejects.toThrow(SecretTooLongError);
    await store.set("r", "\u00e9".repeat(4096));
    expect(calls).toHaveLength(1);
  });

  it("does not put the value in the error when secret-tool fails", async () => {
    const run: ToolRunner = async () => ({ code: 1, stdout: "", stderr: "no session bus" });
    await expect(new KeychainSecretStore("linux", run).set("r", "v")).rejects.toThrow(
      "Could not store secret: no session bus",
    );
  });
});
