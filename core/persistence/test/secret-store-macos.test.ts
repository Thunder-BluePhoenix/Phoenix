// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { KeychainSecretStore, SecretTooLongError, type ToolRunner } from "../src";

// Fake `security`: pins down what is sent (no value in argv, hex on stdin, never over the line
// limit) and how `-g` answers are read. The real tool is exercised by
// core/runtime/test/real-keychain-provider-key.test.ts (PHOENIX_REAL_KEYCHAIN=1).
interface Call {
  cmd: string;
  args: string[];
  stdin: string | undefined;
}
function runner(reply: { code: number; stdout?: string; stderr?: string }) {
  const calls: Call[] = [];
  const run: ToolRunner = async (cmd, args, stdin) => {
    calls.push({ cmd, args, stdin });
    return { code: reply.code, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "" };
  };
  return { calls, run };
}

describe("KeychainSecretStore on macOS", () => {
  const long = "x".repeat(200);

  it("sends a value longer than the 128 characters `-w` keeps, whole, as hex on stdin only", async () => {
    const { calls, run } = runner({ code: 0 });
    await new KeychainSecretStore("darwin", run).set("r", long);
    expect(calls[0]!.args).toEqual(["-i"]);
    expect(calls[0]!.args.join(" ")).not.toContain(long);
    expect(calls[0]!.stdin).toContain(Buffer.from(long).toString("hex"));
    expect(calls[0]!.stdin!.endsWith("\n")).toBe(true);
  });

  it("escapes quotes and backslashes in the account", async () => {
    const { calls, run } = runner({ code: 0 });
    await new KeychainSecretStore("darwin", run).set('a"b\\c d', "v");
    expect(calls[0]!.stdin).toContain('-a "a\\"b\\\\c d"');
  });

  it("refuses, and runs nothing, for a value that does not fit one `security -i` line", async () => {
    const { calls, run } = runner({ code: 0 });
    const store = new KeychainSecretStore("darwin", run);
    await expect(store.set("phoenix.ai.openai_api_key", "x".repeat(4000))).rejects.toBeInstanceOf(
      SecretTooLongError,
    );
    expect(calls).toEqual([]);
    await store.set("phoenix.ai.openai_api_key", "x".repeat(1900));
    expect(calls).toHaveLength(1);
  });

  it("does not put the tool's output (which echoes the command) in the error", async () => {
    const { run } = runner({
      code: 1,
      stderr: `bad ${Buffer.from("secretvalue").toString("hex")}`,
    });
    const err = await new KeychainSecretStore("darwin", run)
      .set("r", "secretvalue")
      .catch((e) => e);
    expect(String(err.message)).not.toContain(Buffer.from("secretvalue").toString("hex"));
    expect(String(err.message)).toContain("exit 1");
  });

  it("reads plain, quoted and hex (non-ASCII) answers of `-g`; not found is undefined", async () => {
    const get = (reply: { code: number; stderr?: string }) =>
      new KeychainSecretStore("darwin", runner(reply).run).get("r");
    expect(await get({ code: 0, stderr: 'keychain: "x"\npassword: "q\\"uo\\"te"' })).toBe(
      'q\\"uo\\"te',
    );
    expect(await get({ code: 0, stderr: 'password: "plain "q" x"' })).toBe('plain "q" x');
    const hex = Buffer.from("héllo ✓").toString("hex").toUpperCase();
    expect(await get({ code: 0, stderr: `password: 0x${hex}  "h\\303\\251llo"` })).toBe("héllo ✓");
    expect(await get({ code: 44, stderr: "could not be found" })).toBeUndefined();
  });
});
