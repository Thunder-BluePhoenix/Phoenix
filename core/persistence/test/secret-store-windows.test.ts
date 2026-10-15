// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { KeychainSecretStore, type ToolRunner } from "../src";

// These tests run on any OS with a fake runner: they pin down what is sent to PowerShell
// (arguments, stdin) and how its answers are read. The script itself needs a real Windows
// machine (PHOENIX_TEST_KEYCHAIN=1 round-trip in meetings.test.ts) and is not run here.
interface Call {
  cmd: string;
  args: string[];
  stdin: string | undefined;
}

function fakeRunner(reply: { code: number; stdout?: string; stderr?: string }) {
  const calls: Call[] = [];
  const run: ToolRunner = async (cmd, args, stdin) => {
    calls.push({ cmd, args, stdin });
    return { code: reply.code, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "" };
  };
  return { calls, run };
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const decodedScript = (args: string[]) =>
  Buffer.from(args[args.indexOf("-EncodedCommand") + 1] ?? "", "base64").toString("utf16le");

describe("KeychainSecretStore on Windows (Credential Manager)", () => {
  const value = `p@ss "w0rd" \\x $HOME é`;

  it("is accepted on win32 and still rejected on unknown platforms", () => {
    expect(() => new KeychainSecretStore("win32")).not.toThrow();
    expect(() => new KeychainSecretStore("freebsd")).toThrow(/No OS secret storage/);
  });

  it("stores through PowerShell with the reference and value only on stdin, base64", async () => {
    const { calls, run } = fakeRunner({ code: 0 });
    await new KeychainSecretStore("win32", run).set("cap.token", value);
    const [call] = calls;
    expect(call?.cmd).toBe("powershell.exe");
    expect(call?.args).toEqual(
      expect.arrayContaining(["-NoProfile", "-NonInteractive", "-EncodedCommand"]),
    );
    expect(call?.stdin).toBe(`${b64("phoenix:cap.token")}\n${b64(value)}\n`);
    // Nothing secret or identifying on the command line.
    const argv = (call?.args ?? []).join(" ");
    expect(argv).not.toContain(value);
    expect(argv).not.toContain("cap.token");
    expect(decodedScript(call?.args ?? [])).toContain("$op = 'set'");
    expect(decodedScript(call?.args ?? [])).toContain("CredWrite");
  });

  it("reads a value back from the base64 the script prints", async () => {
    const { calls, run } = fakeRunner({ code: 0, stdout: `${b64(value)}\r\n` });
    expect(await new KeychainSecretStore("win32", run).get("cap.token")).toBe(value);
    expect(calls[0]?.stdin).toBe(`${b64("phoenix:cap.token")}\n`);
    expect(decodedScript(calls[0]?.args ?? [])).toContain("$op = 'get'");
  });

  it("treats a missing credential (exit 44) as undefined", async () => {
    const { run } = fakeRunner({ code: 44 });
    expect(await new KeychainSecretStore("win32", run).get("nope")).toBeUndefined();
  });

  it("deletes by target and does not fail when it was already gone", async () => {
    const { calls, run } = fakeRunner({ code: 0 });
    await new KeychainSecretStore("win32", run).delete("cap.token");
    expect(calls[0]?.stdin).toBe(`${b64("phoenix:cap.token")}\n`);
    expect(decodedScript(calls[0]?.args ?? [])).toContain("$op = 'delete'");
  });

  it("reports a failed write without echoing the value", async () => {
    const { run } = fakeRunner({ code: 1, stderr: "CredWrite failed: 5\n" });
    await expect(new KeychainSecretStore("win32", run).set("a", value)).rejects.toThrow(
      "Could not store secret: CredWrite failed: 5",
    );
  });

  it("refuses multi-line values and values over the 2560-byte credential limit", async () => {
    const { calls, run } = fakeRunner({ code: 0 });
    const store = new KeychainSecretStore("win32", run);
    await expect(store.set("a", "x\ny")).rejects.toThrow(/single line/);
    await expect(store.set("a", "x".repeat(1281))).rejects.toThrow(/at most 1280/);
    await store.set("a", "x".repeat(1280));
    expect(calls).toHaveLength(1);
  });

  it("leaves the macOS and Linux commands unchanged", async () => {
    const mac = fakeRunner({ code: 0 });
    await new KeychainSecretStore("darwin", mac.run).set("r", "v");
    expect(mac.calls[0]).toEqual({
      cmd: "security",
      args: ["add-generic-password", "-U", "-s", "phoenix", "-a", "r", "-w"],
      stdin: "v\nv\n",
    });
    const lin = fakeRunner({ code: 0 });
    await new KeychainSecretStore("linux", lin.run).delete("r");
    expect(lin.calls[0]).toEqual({
      cmd: "secret-tool",
      args: ["clear", "service", "phoenix", "account", "r"],
      stdin: undefined,
    });
  });
});
