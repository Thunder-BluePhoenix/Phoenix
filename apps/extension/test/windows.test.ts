// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Windows branch of install-host.js against an injected fake file system and an injected fake
// reg.exe runner. Nothing here ran on Windows and no registry was touched.
import { describe, expect, it } from "vitest";
import {
  install,
  isSafeWindowsPath,
  makeRegRunner,
  registryKey,
  uninstall,
  windowsLauncherScript,
} from "../scripts/install-host.js";

const CHROME = "abcdefghijklmnopabcdefghijklmnop";
const ROOT = "C:\\Phoenix\\apps\\extension";
const NODE = "C:\\Program Files\\nodejs\\node.exe";
const LOCAL = "C:\\Users\\a\\AppData\\Local";

type Call = string[];

interface Fakes {
  fs: {
    existsSync: (p: string) => boolean;
    mkdirSync: (p: string) => void;
    writeFileSync: (p: string, text: string) => void;
    rmSync: (p: string) => void;
  };
  runReg: (args: string[]) => { status: number; stderr: string };
  files: Map<string, string>;
  removed: string[];
  dirs: string[];
  calls: Call[];
  log: string[];
  push: (m: string) => void;
}

function fakes(
  options: { regStatus?: (args: string[]) => number; present?: Set<string> } = {},
): Fakes {
  const files = new Map<string, string>();
  const present = options.present ?? new Set<string>([`${ROOT}\\host\\main.js`]);
  const removed: string[] = [];
  const dirs: string[] = [];
  const calls: Call[] = [];
  const fs = {
    existsSync: (p: string) => present.has(p) || files.has(p),
    mkdirSync: (p: string) => void dirs.push(p),
    writeFileSync: (p: string, text: string) => void files.set(p, text),
    rmSync: (p: string) => {
      removed.push(p);
      files.delete(p);
    },
  };
  const runReg = (args: string[]) => {
    calls.push(args);
    return { status: options.regStatus ? options.regStatus(args) : 0, stderr: "denied" };
  };
  const log: string[] = [];
  return { fs, runReg, files, removed, dirs, calls, log, push: (m: string) => log.push(m) };
}

function run(f: Fakes, ids: { chrome?: string; firefox?: string }, browsers: string[]) {
  return install({
    browsers,
    ids,
    home: "C:\\Users\\a",
    localAppData: LOCAL,
    platform: "win32",
    nodePath: NODE,
    root: ROOT,
    log: f.push,
    fs: f.fs,
    runReg: f.runReg,
  });
}

describe("Windows path validation", () => {
  it("accepts ordinary absolute drive paths", () => {
    for (const ok of [
      "C:\\Program Files\\nodejs\\node.exe",
      "D:\\a\\b.c\\d_e+f-g\\main.js",
      "c:\\x",
      "C:\\Users\\Jo Smith\\AppData\\Local\\Phoenix",
    ]) {
      expect(isSafeWindowsPath(ok), ok).toBe(true);
    }
  });

  it("refuses quotes, metacharacters, relative, UNC and odd forms", () => {
    const bad = [
      "",
      "node.exe",
      "C:node.exe",
      "C:/Program Files/node.exe",
      "\\\\server\\share\\node.exe",
      "\\\\?\\C:\\node.exe",
      'C:\\a"b\\node.exe',
      "C:\\a'b\\node.exe",
      "C:\\a%PATH%\\node.exe",
      "C:\\a&calc\\node.exe",
      "C:\\a|b\\node.exe",
      "C:\\a<b\\node.exe",
      "C:\\a>b\\node.exe",
      "C:\\a^b\\node.exe",
      "C:\\a(b)\\node.exe",
      "C:\\a!b\\node.exe",
      "C:\\a;b\\node.exe",
      "C:\\a,b\\node.exe",
      "C:\\a=b\\node.exe",
      "C:\\a`b\\node.exe",
      "C:\\a\nb\\node.exe",
      "C:\\a\rb\\node.exe",
      "C:\\a\0b\\node.exe",
      "C:\\a\\..\\node.exe",
      "C:\\a\\.\\node.exe",
      "C:\\a \\node.exe",
      "C:\\a.\\node.exe",
      "C:\\ a\\node.exe",
      "C:\\a\\\\node.exe",
      "C:\\a\\node.exe\\",
      "C:\\a\\é\\node.exe",
      `C:\\${"a".repeat(250)}`,
    ];
    for (const path of bad) expect(isSafeWindowsPath(path), JSON.stringify(path)).toBe(false);
    expect(isSafeWindowsPath(undefined as unknown as string)).toBe(false);
  });

  it("builds a CRLF .cmd launcher with quoted fixed paths, and refuses unsafe ones", () => {
    expect(windowsLauncherScript(NODE, `${ROOT}\\host\\main.js`)).toBe(
      `@echo off\r\n"${NODE}" "${ROOT}\\host\\main.js"\r\n`,
    );
    expect(() => windowsLauncherScript('C:\\a"b\\node.exe', "C:\\h.js")).toThrow();
    expect(() => windowsLauncherScript(NODE, "C:\\h&calc.js")).toThrow();
  });
});

describe("Windows install", () => {
  it("writes the manifest and the launcher, then runs reg add with argv for each browser", () => {
    const f = fakes();
    const wrote = run(f, { chrome: CHROME, firefox: "phoenix-send-page@phoenix.invalid" }, [
      "chrome",
      "chromium",
      "edge",
      "firefox",
    ]);
    const launcher = `${ROOT}\\host\\phoenix-host.cmd`;
    expect(f.files.get(launcher)).toBe(`@echo off\r\n"${NODE}" "${ROOT}\\host\\main.js"\r\n`);
    expect(wrote).toEqual(
      ["chrome", "chromium", "edge", "firefox"].map(
        (b) => `${LOCAL}\\Phoenix\\NativeMessagingHosts\\${b}\\dev.phoenix.companion.json`,
      ),
    );
    expect(f.calls).toEqual([
      [
        "add",
        "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\dev.phoenix.companion",
        "/ve",
        "/d",
        wrote[0],
        "/f",
      ],
      [
        "add",
        "HKCU\\Software\\Chromium\\NativeMessagingHosts\\dev.phoenix.companion",
        "/ve",
        "/d",
        wrote[1],
        "/f",
      ],
      [
        "add",
        "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\dev.phoenix.companion",
        "/ve",
        "/d",
        wrote[2],
        "/f",
      ],
      [
        "add",
        "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\dev.phoenix.companion",
        "/ve",
        "/d",
        wrote[3],
        "/f",
      ],
    ]);
    const chromeManifest = JSON.parse(f.files.get(wrote[0]) ?? "");
    expect(chromeManifest).toMatchObject({
      name: "dev.phoenix.companion",
      path: launcher,
      type: "stdio",
      allowed_origins: [`chrome-extension://${CHROME}/`],
    });
    expect(JSON.parse(f.files.get(wrote[3]) ?? "").allowed_extensions).toEqual([
      "phoenix-send-page@phoenix.invalid",
    ]);
    // Only per-user keys: nothing is ever written under HKLM.
    for (const call of f.calls) expect(call[1]?.startsWith("HKCU\\")).toBe(true);
  });

  it("skips a browser with no id and writes nothing when every browser is skipped", () => {
    const f = fakes();
    expect(run(f, {}, ["chrome", "firefox"])).toEqual([]);
    expect(f.files.size).toBe(0);
    expect(f.calls).toEqual([]);
    expect(f.log.filter((l) => l.startsWith("skipped"))).toHaveLength(2);
  });

  it("validates every path before writing or registering anything", () => {
    for (const [nodePath, root, local] of [
      ['C:\\bad"quote\\node.exe', ROOT, LOCAL],
      [NODE, "C:\\Phoenix & calc\\ext", LOCAL],
      [NODE, ROOT, "C:\\Users\\a\\App%Data"],
      [NODE, "relative\\ext", LOCAL],
    ] as const) {
      const f = fakes({ present: new Set([`${root}\\host\\main.js`]) });
      expect(() =>
        install({
          browsers: ["chrome"],
          ids: { chrome: CHROME },
          home: "C:\\Users\\a",
          localAppData: local,
          platform: "win32",
          nodePath,
          root,
          log: f.push,
          fs: f.fs,
          runReg: f.runReg,
        }),
      ).toThrow();
      expect(f.files.size).toBe(0);
      expect(f.calls).toEqual([]);
    }
  });

  it("refuses an invalid id before any reg call, and a missing host script", () => {
    const f = fakes();
    expect(() => run(f, { chrome: "*" }, ["chrome"])).not.toThrow();
    expect(f.calls).toEqual([]);
    expect(() => run(f, { chrome: CHROME }, ["safari"])).toThrow();
    expect(() => run(fakes({ present: new Set() }), { chrome: CHROME }, ["chrome"])).toThrow(
      /Missing/,
    );
  });

  it("fails loudly when reg add fails, and requires a runner", () => {
    const f = fakes({ regStatus: () => 1 });
    expect(() => run(f, { chrome: CHROME }, ["chrome"])).toThrow(
      /reg add failed \(exit 1\): denied/,
    );
    expect(() =>
      install({
        browsers: ["chrome"],
        ids: { chrome: CHROME },
        home: "C:\\Users\\a",
        platform: "win32",
        nodePath: NODE,
        root: ROOT,
        log: () => {},
        fs: f.fs,
      }),
    ).toThrow(/registry runner/);
  });
});

describe("Windows uninstall", () => {
  it("runs reg delete only for keys that exist, removes the manifests and the launcher", () => {
    const f = fakes({
      regStatus: (args) => (args[0] === "query" && args[1]?.includes("Edge") ? 1 : 0),
    });
    const wrote = run(f, { chrome: CHROME }, ["chrome", "edge"]);
    f.calls.length = 0;
    const removed = uninstall({
      browsers: ["chrome", "edge"],
      home: "C:\\Users\\a",
      localAppData: LOCAL,
      platform: "win32",
      root: ROOT,
      log: f.push,
      fs: f.fs,
      runReg: f.runReg,
    });
    expect(f.calls).toEqual([
      ["query", registryKey("chrome")],
      ["delete", registryKey("chrome"), "/f"],
      ["query", registryKey("edge")],
    ]);
    expect(removed).toEqual(wrote);
    expect(f.files.size).toBe(0);
    expect(f.removed).toContain(`${ROOT}\\host\\phoenix-host.cmd`);
  });

  it("fails when reg delete fails", () => {
    const f = fakes({ regStatus: (args) => (args[0] === "delete" ? 5 : 0) });
    expect(() =>
      uninstall({
        browsers: ["chrome"],
        home: "C:\\Users\\a",
        localAppData: LOCAL,
        platform: "win32",
        root: ROOT,
        log: f.push,
        fs: f.fs,
        runReg: f.runReg,
      }),
    ).toThrow(/reg delete failed/);
  });
});

describe("reg.exe runner", () => {
  it("only accepts a safe SystemRoot and never uses a shell", () => {
    expect(() => makeRegRunner("C:\\Windows & calc")).toThrow();
    expect(typeof makeRegRunner("C:\\Windows")).toBe("function");
    expect(typeof makeRegRunner(undefined)).toBe("function");
  });

  it("spawns the system reg.exe by absolute path with the argument array and no shell", () => {
    const seen: unknown[][] = [];
    const run = makeRegRunner("C:\\Windows", ((...a: unknown[]) => {
      seen.push(a);
      return { status: 0, stderr: "" };
    }) as never);
    expect(run(["query", "HKCU\\x"])).toEqual({ status: 0, stderr: "" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe("C:\\Windows\\System32\\reg.exe");
    expect(seen[0]?.[1]).toEqual(["query", "HKCU\\x"]);
    expect(seen[0]?.[2]).toMatchObject({ shell: false });
    const failing = makeRegRunner("C:\\Windows", (() => ({ error: new Error("ENOENT") })) as never);
    expect(failing(["query", "k"]).status).toBe(1);
  });

  it("registryKey is HKCU only and null for an unknown browser", () => {
    for (const b of ["chrome", "chromium", "edge", "firefox"]) {
      expect(registryKey(b)).toMatch(
        /^HKCU\\Software\\.*\\NativeMessagingHosts\\dev\.phoenix\.companion$/,
      );
    }
    expect(registryKey("safari")).toBeNull();
    expect(registryKey("__proto__")).toBeNull();
  });
});
