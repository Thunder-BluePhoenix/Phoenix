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
/**
 * `security -i` reads one command per line and refuses a line of 4096 characters or more (measured
 * on macOS 27.0.1: a 4094-character line stores, a 4096-character line exits 1).
 */
const MACOS_MAX_COMMAND_CHARS = 4094;
/**
 * `secret-tool store` (libsecret 0.21.4, gnome-keyring 46) reads at most 8192 bytes of stdin: for a
 * longer value it prints "password is too long", keeps the first 8192 bytes and STILL exits 0
 * (measured in Ubuntu 24.04: 8192 bytes round-trip whole, 8193 and 16384 come back as 8192).
 */
const LINUX_MAX_SECRET_BYTES = 8192;

/** The value does not fit the OS store; nothing was stored. */
export class SecretTooLongError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretTooLongError";
  }
}

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
    if (this.platform === "darwin") return this.setMacos(ref, value);
    if (Buffer.byteLength(value, "utf8") > LINUX_MAX_SECRET_BYTES) {
      throw new SecretTooLongError(
        `The Linux Secret Service path keeps at most ${LINUX_MAX_SECRET_BYTES} bytes for a secret`,
      );
    }
    const r = await this.run(
      "secret-tool",
      ["store", "--label", `Phoenix: ${ref}`, "service", SERVICE, "account", ref],
      value,
    );
    if (r.code !== 0) throw new Error(`Could not store secret: ${r.stderr.trim()}`);
  }

  /**
   * macOS: `security add-generic-password -w` reading the value from a prompt keeps only its first
   * 128 characters and still exits 0, so a long key was stored cut short without any error. Instead
   * the command runs inside `security -i` (commands on stdin, so nothing but "security -i" is in
   * `ps`) and the value is passed as hex (`-X`), which has no length cut and needs no quoting.
   * `security -i` refuses a command line of 4096 characters or more, so a value that does not fit
   * (about 2000 bytes) is REFUSED with SecretTooLongError rather than stored cut short.
   */
  private async setMacos(ref: string, value: string): Promise<void> {
    if (/[\u0000-\u001f\u007f]/.test(ref)) throw new Error("Secret references must be printable");
    const quoted = `"${ref.replace(/[\\"]/g, "\\$&")}"`;
    const hex = Buffer.from(value, "utf8").toString("hex");
    const line = `add-generic-password -U -s ${SERVICE} -a ${quoted} -X ${hex}`;
    if (line.length > MACOS_MAX_COMMAND_CHARS) {
      throw new SecretTooLongError(
        `The macOS Keychain path keeps at most ${Math.floor((MACOS_MAX_COMMAND_CHARS - line.length + hex.length) / 2)} bytes for this secret`,
      );
    }
    const r = await this.run("security", ["-i"], `${line}\n`);
    // No stderr/stdout in the message: `security` echoes the command it could not read.
    if (r.code !== 0) throw new Error(`Could not store secret (security exit ${r.code})`);
  }

  /**
   * macOS: `-w` prints a value as hex when it is not plain printable ASCII (a non-ASCII or
   * backslash value came back as hex), so the value is read from `-g` instead, which labels the
   * hex form with `0x`.
   */
  private async getMacos(ref: string): Promise<string | undefined> {
    const r = await this.run("security", ["find-generic-password", "-s", SERVICE, "-a", ref, "-g"]);
    if (r.code !== 0) return undefined; // 44: not found
    const line = r.stderr.split("\n").find((l) => l.startsWith("password:"));
    const shown = line?.slice("password:".length).trim() ?? "";
    const hex = /^0x([0-9a-fA-F]+)/.exec(shown);
    if (hex) return Buffer.from(hex[1]!, "hex").toString("utf8") || undefined;
    if (shown.startsWith('"') && shown.endsWith('"') && shown.length >= 2) {
      return shown.slice(1, -1) || undefined;
    }
    return undefined;
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
    if (this.platform === "darwin") return this.getMacos(ref);
    const r = await this.run("secret-tool", ["lookup", "service", SERVICE, "account", ref]);
    if (r.code !== 0) return undefined; // 1 on Linux: not found
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
