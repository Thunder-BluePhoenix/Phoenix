// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The install and uninstall scripts, exercised ONLY in their read-only modes (`--print-*`), with
// bash, in a temp HOME, without root. Their real mode refuses unless euid is 0 and --yes is given;
// that refusal is tested too, and the real mode is never reached.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { renderLaunchdPlist, renderSudoers } from "../../src/power/backstop";
import { ALLOWED_HELPER_LINES } from "../../src/power/helper-client";

const run = promisify(execFile);
const INSTALL = join(__dirname, "../../../../scripts/awake/install-helper.sh");
const UNINSTALL = join(__dirname, "../../../../scripts/awake/uninstall-helper.sh");

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
const tempHome = () => {
  const h = mkdtempSync(join(tmpdir(), "zz-awake-home-"));
  homes.push(h);
  return h;
};

interface Out {
  code: number;
  stdout: string;
  stderr: string;
}

async function bash(script: string, home: string, args: string[]): Promise<Out> {
  try {
    const r = await run("/bin/bash", [script, ...args], {
      env: { PATH: process.env.PATH ?? "", HOME: home, PHOENIX_SUDOERS_DIR: "/etc/sudoers.d" },
    });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

const paths = (text: string, verb: string) =>
  text
    .split("\n")
    .filter((l) => l.startsWith(`${verb} `))
    .map((l) => l.slice(verb.length + 1))
    .sort();

describe("the sudoers rule", () => {
  it("the script prints exactly the rule the TypeScript module renders", async () => {
    const out = await bash(INSTALL, tempHome(), ["--print-sudoers", "--user", "alice"]);
    expect(out.code).toBe(0);
    expect(out.stdout).toBe(renderSudoers("alice"));
  });

  it("allows exactly the four literal commands: no wildcard, nothing extra", () => {
    const rule = renderSudoers("alice");
    const grants = rule.split("\n").filter((l) => l !== "" && !l.startsWith("#"));
    expect(grants).toHaveLength(1);
    const [who, rest] = (grants[0] ?? "").split(" ALL = (root) NOPASSWD: ");
    expect(who).toBe("alice");
    expect(rest?.split(", ")).toEqual([...ALLOWED_HELPER_LINES]);
    expect(rule).not.toMatch(/[*?\[\]]/);
    expect(rule).not.toContain("ALL, ");
    expect(rule).not.toMatch(/NOPASSWD:\s*ALL/);
    expect((grants[0] ?? "").split(",")).toHaveLength(4);
  });

  it("refuses an account name that could inject sudoers syntax", () => {
    for (const bad of ["root;ALL", "a b", "a\nALL", "", "A", "x:y", "a".repeat(40), "$(id)"]) {
      expect(() => renderSudoers(bad), bad).toThrow();
    }
  });

  it("the script refuses to grant the rule to root or to a hostile name", async () => {
    for (const user of ["root", "a;b", "$(id)", "A", "a b"]) {
      const out = await bash(INSTALL, tempHome(), ["--print-sudoers", "--user", user]);
      expect(out.code, user).not.toBe(0);
      expect(out.stdout, user).toBe("");
    }
  });
});

describe("the launchd plist", () => {
  it("the script prints exactly the plist the TypeScript module renders", async () => {
    const home = tempHome();
    const out = await bash(INSTALL, home, [
      "--print-plist",
      "--user",
      "alice",
      "--node",
      "/opt/homebrew/bin/node",
      "--data-dir",
      `${home}/data`,
    ]);
    expect(out.code).toBe(0);
    expect(out.stdout).toBe(
      renderLaunchdPlist({
        node: "/opt/homebrew/bin/node",
        script: `${home}/Library/Application Support/Phoenix/phoenix-awake-backstop.mjs`,
        journal: `${home}/data/awake/recovery-journal.jsonl`,
        log: `${home}/Library/Logs/phoenix-awake-backstop.log`,
      }),
    );
  });

  it("runs every 60 seconds, at load, as the user (a LaunchAgent), with no shell", () => {
    const plist = renderLaunchdPlist({
      node: "/n/node",
      script: "/s/b.mjs",
      journal: "/j/j.jsonl",
      log: "/l/x.log",
    });
    expect(plist).toContain("<key>StartInterval</key>\n  <integer>60</integer>");
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).not.toContain("UserName");
    expect(plist).not.toMatch(/\/bin\/(ba)?sh|-c/);
  });

  it("refuses paths that are not plain absolute paths, and escapes XML", () => {
    const ok = { node: "/n/node", script: "/s/b.mjs", journal: "/j/j.jsonl", log: "/l/x.log" };
    for (const bad of ["relative/path", "/a/../b", "/a<b>", "/a;b", "/a\nb", "/a$(x)", "/a'b"]) {
      expect(() => renderLaunchdPlist({ ...ok, script: bad }), bad).toThrow();
    }
    expect(renderLaunchdPlist({ ...ok, log: "/l/a&b".replace("&", "+") })).toContain("/l/a+b");
  });
});

describe("--print-plan: install and uninstall touch the same files", () => {
  it("uninstall removes exactly the files install creates", async () => {
    const home = tempHome();
    const install = await bash(INSTALL, home, ["--print-plan", "--user", "alice"]);
    const uninstall = await bash(UNINSTALL, home, ["--print-plan", "--user", "alice"]);
    expect(install.code).toBe(0);
    expect(uninstall.code).toBe(0);
    const created = paths(install.stdout, "CREATE");
    expect(created).toHaveLength(4);
    expect(paths(uninstall.stdout, "REMOVE")).toEqual(created);
    // One of them is the root rule; none is outside the sudoers dir or the user's home.
    expect(created.filter((p) => p.startsWith("/etc/sudoers.d/"))).toEqual([
      "/etc/sudoers.d/phoenix-awake",
    ]);
    expect(created.filter((p) => !p.startsWith("/etc/sudoers.d/") && !p.startsWith(home))).toEqual(
      [],
    );
  });

  it("never creates anything: the temp HOME is still empty and /etc/sudoers.d is untouched", async () => {
    const home = tempHome();
    await bash(INSTALL, home, ["--print-plan", "--user", "alice"]);
    await bash(UNINSTALL, home, ["--print-plan", "--user", "alice"]);
    await bash(INSTALL, home, ["--print-sudoers", "--user", "alice"]);
    await bash(INSTALL, home, ["--print-plist", "--user", "alice"]);
    expect(readdirSync(home)).toEqual([]);
    const sudoersDir = (() => {
      try {
        return readdirSync("/etc/sudoers.d");
      } catch {
        return [];
      }
    })();
    expect(sudoersDir).not.toContain("phoenix-awake");
  });

  it("honours --home, and the plan lists what the sudoers rule allows", async () => {
    const out = await bash(INSTALL, tempHome(), [
      "--print-plan",
      "--user",
      "alice",
      "--home",
      "/Users/alice",
    ]);
    expect(paths(out.stdout, "CREATE")).toContain(
      "/Users/alice/Library/LaunchAgents/dev.phoenix.awake-backstop.plist",
    );
    for (const line of ALLOWED_HELPER_LINES) expect(out.stdout).toContain(`#   ${line}`);
  });

  it("rejects an unsafe --home or --data-dir", async () => {
    for (const args of [
      ["--home", "relative"],
      ["--home", "/Users/a/../b"],
      ["--home", "/Users/a;b"],
      ["--data-dir", "/x/$(id)"],
    ]) {
      const out = await bash(INSTALL, tempHome(), ["--print-plan", "--user", "alice", ...args]);
      expect(out.code, args.join(" ")).not.toBe(0);
    }
    const bad = await bash(UNINSTALL, tempHome(), [
      "--print-plan",
      "--user",
      "alice",
      "--home",
      "/x/../y",
    ]);
    expect(bad.code).not.toBe(0);
  });
});

describe("real mode refuses", () => {
  it.each([
    ["install, no root", INSTALL, []],
    ["install, --yes but no root", INSTALL, ["--yes"]],
    ["uninstall, no root", UNINSTALL, []],
    ["uninstall, --yes but no root", UNINSTALL, ["--yes"]],
  ])("%s", async (_name, script, args) => {
    const home = tempHome();
    const out = await bash(script, home, [...args, "--user", "alice", "--home", home]);
    const euid = process.getuid?.() ?? 1;
    // This suite never runs as root; if it somehow does, it must not go on to real mode.
    expect(euid, "run the tests as a normal user").not.toBe(0);
    expect(out.code).not.toBe(0);
    expect(out.stderr).toContain("must run as root");
    expect(readdirSync(home)).toEqual([]);
  });

  it("the scripts are readable and fail fast", () => {
    for (const file of [INSTALL, UNINSTALL]) {
      const text = readFileSync(file, "utf8");
      expect(text.startsWith("#!/bin/bash\n")).toBe(true);
      expect(text).toContain("set -euo pipefail");
      expect(text).toContain("--yes");
      expect(text).toContain("--print-plan");
    }
    expect(readFileSync(INSTALL, "utf8")).toContain("visudo -cf");
    expect(readFileSync(UNINSTALL, "utf8")).toContain("visudo -c");
  });
});
