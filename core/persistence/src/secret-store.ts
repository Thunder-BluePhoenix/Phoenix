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

/** Runs an OS tool. Injectable so the Windows backend can be tested on any OS. */
export type ToolRunner = typeof runTool;

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
 * Windows Credential Manager through PowerShell + advapi32 (`CredWrite` / `CredRead` /
 * `CredDelete`), so no extra binary or npm package is needed. The script is passed with
 * `-EncodedCommand`; the reference and the value travel on stdin as base64 (ASCII only, so no
 * console code page can corrupt them) and never reach a command line, so they do not show up in
 * the process list. Generic credentials are limited to 2560 bytes (UTF-16), checked up front.
 */
const CRED_MAX_BYTES = 2560;
const WINDOWS_CRED_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PhoenixCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite(ref CREDENTIAL c, uint flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, uint type, uint flags, out IntPtr cred);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredDelete(string target, uint type, uint flags);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr p);
}
'@
function Decode($b64) { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64)) }
$lines = [Console]::In.ReadToEnd() -split "\\r?\\n"
$target = Decode $lines[0]
switch ($op) {
  'set' {
    $bytes = [System.Text.Encoding]::Unicode.GetBytes((Decode $lines[1]))
    $blob = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
    try {
      [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
      $c = New-Object PhoenixCred+CREDENTIAL
      $c.Type = 1; $c.Persist = 2; $c.TargetName = $target; $c.UserName = 'phoenix'
      $c.CredentialBlobSize = $bytes.Length; $c.CredentialBlob = $blob
      if (-not [PhoenixCred]::CredWrite([ref]$c, 0)) { throw "CredWrite failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
    } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($blob) }
  }
  'get' {
    $p = [IntPtr]::Zero
    if (-not [PhoenixCred]::CredRead($target, 1, 0, [ref]$p)) { exit 44 }
    try {
      $c = [Runtime.InteropServices.Marshal]::PtrToStructure($p, [Type][PhoenixCred+CREDENTIAL])
      $bytes = New-Object byte[] $c.CredentialBlobSize
      [Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $bytes, 0, $bytes.Length)
      [Console]::Out.Write([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([System.Text.Encoding]::Unicode.GetString($bytes))))
    } finally { [PhoenixCred]::CredFree($p) }
  }
  'delete' { [void][PhoenixCred]::CredDelete($target, 1, 0) }
}
`;

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

function powershellArgs(op: "set" | "get" | "delete"): string[] {
  const script = `$op = '${op}'\n${WINDOWS_CRED_SCRIPT}`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded];
}

/**
 * OS secure storage: macOS Keychain (`security`), the Linux Secret Service (`secret-tool`) or
 * the Windows Credential Manager. Values are always passed on stdin, never on the command
 * line, so they do not show up in `ps`.
 */
export class KeychainSecretStore implements SecretStore {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly run: ToolRunner = runTool,
  ) {
    if (platform !== "darwin" && platform !== "linux" && platform !== "win32") {
      throw new Error(`No OS secret storage support for ${platform} yet`);
    }
  }

  async set(ref: string, value: string): Promise<void> {
    if (value.includes("\n")) throw new Error("Secret values must be a single line");
    if (this.platform === "win32") {
      if (value.length * 2 > CRED_MAX_BYTES) {
        throw new Error(
          `Windows Credential Manager keeps at most ${CRED_MAX_BYTES / 2} characters`,
        );
      }
      const w = await this.run(
        "powershell.exe",
        powershellArgs("set"),
        `${b64(`${SERVICE}:${ref}`)}\n${b64(value)}\n`,
      );
      if (w.code !== 0) throw new Error(`Could not store secret: ${w.stderr.trim()}`);
      return;
    }
    const r =
      this.platform === "darwin"
        ? // `security` reads the value twice (entry + confirmation) when -w is last.
          await this.run(
            "security",
            ["add-generic-password", "-U", "-s", SERVICE, "-a", ref, "-w"],
            `${value}\n${value}\n`,
          )
        : await this.run(
            "secret-tool",
            ["store", "--label", `Phoenix: ${ref}`, "service", SERVICE, "account", ref],
            value,
          );
    if (r.code !== 0) throw new Error(`Could not store secret: ${r.stderr.trim()}`);
  }

  async get(ref: string): Promise<string | undefined> {
    if (this.platform === "win32") {
      const w = await this.run(
        "powershell.exe",
        powershellArgs("get"),
        `${b64(`${SERVICE}:${ref}`)}\n`,
      );
      if (w.code !== 0) return undefined; // 44: not found
      const text = Buffer.from(w.stdout.trim(), "base64").toString("utf8");
      return text || undefined;
    }
    const r =
      this.platform === "darwin"
        ? await this.run("security", ["find-generic-password", "-s", SERVICE, "-a", ref, "-w"])
        : await this.run("secret-tool", ["lookup", "service", SERVICE, "account", ref]);
    if (r.code !== 0) return undefined; // 44 on macOS / 1 on Linux: not found
    return r.stdout.replace(/\n$/, "") || undefined;
  }

  async delete(ref: string): Promise<void> {
    if (this.platform === "win32") {
      await this.run("powershell.exe", powershellArgs("delete"), `${b64(`${SERVICE}:${ref}`)}\n`);
    } else if (this.platform === "darwin") {
      await this.run("security", ["delete-generic-password", "-s", SERVICE, "-a", ref]);
    } else {
      await this.run("secret-tool", ["clear", "service", SERVICE, "account", ref]);
    }
  }
}
