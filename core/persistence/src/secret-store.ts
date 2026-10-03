// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { spawn } from "node:child_process";

/**
 * Abstraction over OS secure storage (ADR-0014). The database only ever stores a
 * reference; the secret value lives here (KeychainSecretStore in production,
 * MemorySecretStore in tests).
 */
export interface SecretStore {
  set(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string | undefined>;
  delete(ref: string): Promise<void>;
}

/** Non-persistent store for tests and development. */
export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async set(ref: string, value: string): Promise<void> {
    this.values.set(ref, value);
  }

  async get(ref: string): Promise<string | undefined> {
    return this.values.get(ref);
  }

  async delete(ref: string): Promise<void> {
    this.values.delete(ref);
  }
}

const SERVICE = "phoenix";

function runTool(
  cmd: string,
  args: string[],
  stdin?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c));
    child.stderr.on("data", (c: Buffer) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(stdin ?? "");
  });
}

/**
 * OS secure storage: macOS Keychain (`security`) or the Linux Secret Service
 * (`secret-tool`). Values are always passed on stdin, never on the command
 * line, so they do not show up in `ps`.
 */
export class KeychainSecretStore implements SecretStore {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {
    if (platform !== "darwin" && platform !== "linux") {
      throw new Error(`No OS secret storage support for ${platform} yet`);
    }
  }

  async set(ref: string, value: string): Promise<void> {
    if (value.includes("\n")) throw new Error("Secret values must be a single line");
    const r =
      this.platform === "darwin"
        ? // `security` reads the value twice (entry + confirmation) when -w is last.
          await runTool(
            "security",
            ["add-generic-password", "-U", "-s", SERVICE, "-a", ref, "-w"],
            `${value}\n${value}\n`,
          )
        : await runTool(
            "secret-tool",
            ["store", "--label", `Phoenix: ${ref}`, "service", SERVICE, "account", ref],
            value,
          );
    if (r.code !== 0) throw new Error(`Could not store secret: ${r.stderr.trim()}`);
  }

  async get(ref: string): Promise<string | undefined> {
    const r =
      this.platform === "darwin"
        ? await runTool("security", ["find-generic-password", "-s", SERVICE, "-a", ref, "-w"])
        : await runTool("secret-tool", ["lookup", "service", SERVICE, "account", ref]);
    if (r.code !== 0) return undefined; // 44 on macOS / 1 on Linux: not found
    return r.stdout.replace(/\n$/, "") || undefined;
  }

  async delete(ref: string): Promise<void> {
    if (this.platform === "darwin") {
      await runTool("security", ["delete-generic-password", "-s", SERVICE, "-a", ref]);
    } else {
      await runTool("secret-tool", ["clear", "service", SERVICE, "account", ref]);
    }
  }
}
