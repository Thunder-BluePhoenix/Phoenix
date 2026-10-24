// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The install and uninstall scripts, exercised ONLY in their read-only modes (`--print-*`), with
// bash, in a temp HOME, without root. Their real mode refuses unless euid is 0 and --yes is given;
// that refusal is tested too, and the real mode is never reached.
import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { renderLaunchdPlist, renderSudoers } from "../../src/power/backstop";
import { ALLOWED_HELPER_LINES } from "../../src/power/helper-client";
import { JOURNAL_FILE } from "../../src/power/journal";
// The rule Core uses to hand out the directory; the installer must compute the same path.
import { capabilityDataPath } from "../../../../core/capability-manager/src/data-dir";

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

async function bash(
  script: string,
  home: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<Out> {
  try {
    const r = await run("/bin/bash", [script, ...args], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home,
        PHOENIX_SUDOERS_DIR: "/etc/sudoers.d",
        ...extraEnv,
      },
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
        journal: `${home}/data/capabilities/awake/recovery-journal.jsonl`,
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

// ---- findings 1, 5, 8: the root script creates user files AS the user and refuses planted links ----

const me = userInfo().username;
const plainName = /^[a-z_][a-z0-9_-]{0,31}$/.test(me);
const dry = it.skipIf(!plainName);

/** A temp HOME with the folders a real macOS account has. */
const macHome = () => {
  const h = tempHome();
  mkdirSync(join(h, "Library", "Application Support"), { recursive: true });
  return h;
};

describe("--dry-run: every step is printed, none is run (finding 1)", () => {
  dry(
    "creates every user-owned folder and file AS THE USER; only the sudoers rule is root's",
    async () => {
      const home = macHome();
      const out = await bash(INSTALL, home, ["--dry-run", "--user", me, "--home", home]);
      expect(out.code, out.stderr).toBe(0);
      const steps = out.stdout.split("\n").filter((l) => l.startsWith("RUN "));
      const root = steps.filter((l) => l.startsWith("RUN root: "));
      const user = steps.filter((l) => l.startsWith(`RUN ${me}: `));
      // Root touches only the sudoers file (and validators / launchctl); never anything under HOME.
      for (const l of root) {
        if (l.includes("install -m 0440")) expect(l).toContain("/etc/sudoers.d/phoenix-awake.new");
        if (l.includes("/bin/mv") || l.includes("install ")) expect(l).not.toContain(home);
      }
      expect(root.some((l) => l.includes("/usr/bin/install -d"))).toBe(false);
      // Each dir and file under HOME is made by the user, with no -o/-g (nothing to chown).
      const made = user.filter((l) => l.includes("/usr/bin/install"));
      expect(made.map((l) => l.replace(`RUN ${me}: `, ""))).toEqual([
        `/usr/bin/install -d -m 0700 ${home}/Library/Application Support/Phoenix`,
        `/usr/bin/install -d -m 0755 ${home}/Library/LaunchAgents`,
        `/usr/bin/install -d -m 0755 ${home}/Library/Logs`,
        expect.stringMatching(
          new RegExp(
            `^/usr/bin/install -m 0644 \\S+/script\\.mjs ${home}/Library/Application Support/Phoenix/phoenix-awake-backstop\\.mjs$`,
          ),
        ),
        expect.stringMatching(
          new RegExp(
            `^/usr/bin/install -m 0644 \\S+/plist ${home}/Library/LaunchAgents/dev\\.phoenix\\.awake-backstop\\.plist$`,
          ),
        ),
      ]);
      for (const l of made) expect(l).not.toMatch(/ -o | -g /);
      // The root step order: rule first, then the user's files.
      const iRule = steps.findIndex((l) => l.includes("phoenix-awake.new"));
      const iFirstUser = steps.findIndex((l) => l.startsWith(`RUN ${me}:`));
      expect(iRule).toBeGreaterThanOrEqual(0);
      expect(iRule).toBeLessThan(iFirstUser);
      // Nothing was created.
      expect(readdirSync(join(home, "Library")).sort()).toEqual(["Application Support"]);
    },
  );

  dry(
    "refuses, before anything is printed to run, when a component is a symbolic link",
    async () => {
      for (const link of ["LaunchAgents", "Logs", "Application Support/Phoenix"]) {
        const home = macHome();
        const target = mkdtempSync(join(tmpdir(), "zz-awake-target-"));
        homes.push(target);
        symlinkSync(target, join(home, "Library", link));
        const out = await bash(INSTALL, home, ["--dry-run", "--user", me, "--home", home]);
        expect(out.code, link).not.toBe(0);
        expect(out.stderr, link).toContain("is a symbolic link");
        expect(out.stdout, link).not.toContain("RUN ");
        expect(readdirSync(target), link).toEqual([]);
      }
    },
  );

  dry("refuses a symlinked leaf (the plist or the log) and a symlinked HOME itself", async () => {
    const home = macHome();
    mkdirSync(join(home, "Library", "LaunchAgents"));
    symlinkSync(
      "/etc/sudoers.d/phoenix-awake",
      join(home, "Library", "LaunchAgents", "dev.phoenix.awake-backstop.plist"),
    );
    const leaf = await bash(INSTALL, home, ["--dry-run", "--user", me, "--home", home]);
    expect(leaf.code).not.toBe(0);
    expect(leaf.stderr).toContain("is a symbolic link");

    const real = macHome();
    const parent = tempHome();
    const viaLink = join(parent, "home-link");
    symlinkSync(real, viaLink);
    const top = await bash(INSTALL, parent, ["--dry-run", "--user", me, "--home", viaLink]);
    expect(top.code).not.toBe(0);
    expect(top.stderr).toContain("is a symbolic link");
  });

  dry("refuses when a component is not owned by the account the rule is for", async () => {
    const home = macHome();
    mkdirSync(join(home, "Library", "Logs"));
    // `nobody` is a plain account name that is not this user: the temp folders are owned by `me`.
    const out = await bash(INSTALL, home, ["--dry-run", "--user", "nobody", "--home", home]);
    expect(out.code).not.toBe(0);
    expect(out.stderr).toMatch(new RegExp(`owned by ${me}, not by nobody`));
    expect(out.stdout).not.toContain("RUN ");
  });

  dry("refuses a component that is a file where a folder belongs", async () => {
    const home = macHome();
    writeFileSync(join(home, "Library", "LaunchAgents"), "x");
    const out = await bash(INSTALL, home, ["--dry-run", "--user", me, "--home", home]);
    expect(out.code).not.toBe(0);
    expect(out.stderr).toContain("is not a directory");
  });

  dry(
    "uninstall removes the user's files AS THE USER, the rule first, and refuses links",
    async () => {
      const home = macHome();
      const ok = await bash(UNINSTALL, home, ["--dry-run", "--user", me, "--home", home]);
      expect(ok.code, ok.stderr).toBe(0);
      const steps = ok.stdout.split("\n").filter((l) => l.startsWith("RUN "));
      const iRule = steps.findIndex((l) =>
        l.startsWith("RUN root: /bin/rm -f -- /etc/sudoers.d/phoenix-awake"),
      );
      const iUser = steps.findIndex((l) => l.startsWith(`RUN ${me}: /bin/rm -f --`));
      expect(iRule).toBeGreaterThanOrEqual(0);
      expect(iRule).toBeLessThan(iUser);
      expect(steps.filter((l) => l.startsWith("RUN root:") && l.includes(home))).toEqual([]);

      for (const link of ["LaunchAgents", "Logs", "Application Support/Phoenix"]) {
        const h = macHome();
        const target = mkdtempSync(join(tmpdir(), "zz-awake-target-"));
        homes.push(target);
        writeFileSync(join(target, "keep"), "x");
        symlinkSync(target, join(h, "Library", link));
        const out = await bash(UNINSTALL, h, ["--dry-run", "--user", me, "--home", h]);
        expect(out.code, link).not.toBe(0);
        expect(out.stderr, link).toContain("is a symbolic link");
        expect(out.stdout, link).not.toContain("RUN " + me);
        expect(readdirSync(target), link).toEqual(["keep"]);
      }
    },
  );

  it("PHOENIX_SUDOERS_DIR moves the rule only in print and dry-run modes; real mode has no such path", async () => {
    const home = macHome();
    const plan = await bash(INSTALL, home, ["--print-plan", "--user", "alice"], {
      PHOENIX_SUDOERS_DIR: "/tmp/elsewhere",
    });
    expect(paths(plan.stdout, "CREATE")).toContain("/tmp/elsewhere/phoenix-awake");
    for (const file of [INSTALL, UNINSTALL]) {
      const text = readFileSync(file, "utf8");
      // The default is the fixed path, and the variable is read only inside the non-executing branch.
      expect(text).toContain('SUDOERS_DIR="/etc/sudoers.d"\nif [');
      const reads = text.split("\n").filter((l) => l.includes("PHOENIX_SUDOERS_DIR:-"));
      expect(reads).toHaveLength(1);
      const at = text.indexOf(reads[0] ?? "");
      const guard = text.lastIndexOf("\nif [", at);
      expect(text.slice(guard, at)).toMatch(/dry"? -eq 1/);
      expect(text.slice(guard, at)).toMatch(/!= "(install|uninstall)"/);
    }
  });
});

describe("--data-dir and the journal the backstop watches (finding 8)", () => {
  /** The path Core hands the awake capability for its journal: the one the backstop must watch. */
  const coreJournal = (dataDir: string) => join(capabilityDataPath(dataDir, "awake"), JOURNAL_FILE);

  it("--print-plan watches the journal Core writes, for the data dir the same rule picks", async () => {
    const home = tempHome();
    const def = await bash(INSTALL, home, ["--print-plan", "--user", "alice"]);
    // No variable set: Core's rule gives ~/.phoenix/dev (it is dev when PHOENIX_ENV is unset).
    expect(paths(def.stdout, "WATCH")).toEqual([coreJournal(`${home}/.phoenix/dev`)]);
    expect(def.stdout).toContain("no --data-dir given");
    expect(def.stdout).toContain("journal_path");
    const given = await bash(INSTALL, home, [
      "--print-plan",
      "--user",
      "alice",
      "--data-dir",
      "/srv/phoenix/dev",
    ]);
    expect(paths(given.stdout, "WATCH")).toEqual([coreJournal("/srv/phoenix/dev")]);
    expect(paths(given.stdout, "WATCH")).toEqual([
      "/srv/phoenix/dev/capabilities/awake/recovery-journal.jsonl",
    ]);
    expect(given.stdout).not.toContain("no --data-dir given");
    expect(given.stdout).toContain("from --data-dir");
  });

  it("without --data-dir it follows PHOENIX_DATA_DIR, then PHOENIX_ENV, like Core", async () => {
    const home = tempHome();
    const byDir = await bash(INSTALL, home, ["--print-plan", "--user", "alice"], {
      PHOENIX_DATA_DIR: "/srv/core",
      PHOENIX_ENV: "prod",
    });
    expect(paths(byDir.stdout, "WATCH")).toEqual([coreJournal("/srv/core")]);
    expect(byDir.stdout).toContain("from PHOENIX_DATA_DIR");
    for (const env of ["dev", "staging", "prod"]) {
      const out = await bash(INSTALL, home, ["--print-plan", "--user", "alice"], {
        PHOENIX_ENV: env,
      });
      expect(paths(out.stdout, "WATCH"), env).toEqual([coreJournal(`${home}/.phoenix/${env}`)]);
    }
    // --data-dir beats the environment.
    const flag = await bash(
      INSTALL,
      home,
      ["--print-plan", "--user", "alice", "--data-dir", "/srv/flag"],
      { PHOENIX_DATA_DIR: "/srv/core" },
    );
    expect(paths(flag.stdout, "WATCH")).toEqual([coreJournal("/srv/flag")]);
  });

  it("refuses an environment Core itself would refuse", async () => {
    const home = tempHome();
    for (const env of [{ PHOENIX_ENV: "qa" }, { PHOENIX_DATA_DIR: "relative/dir" }] as Record<
      string,
      string
    >[]) {
      const out = await bash(INSTALL, home, ["--print-plan", "--user", "alice"], env);
      expect(out.code, JSON.stringify(env)).not.toBe(0);
      expect(out.stderr).toMatch(/PHOENIX_(ENV|DATA_DIR) must be/);
    }
  });

  it("warns, read-only, about a journal an older Phoenix left at the old place and says what exists", async () => {
    const home = tempHome();
    const data = join(home, "data");
    mkdirSync(join(data, "awake"), { recursive: true });
    writeFileSync(join(data, "awake", "recovery-journal.jsonl"), "x\n");
    const out = await bash(INSTALL, home, ["--print-plan", "--user", "alice", "--data-dir", data]);
    expect(out.stdout).toContain("older Phoenix journal exists");
    expect(out.stdout).toContain("NOT watched");
    expect(out.stdout).toContain("no journal at the WATCH path yet");
    expect(readFileSync(join(data, "awake", "recovery-journal.jsonl"), "utf8")).toBe("x\n");
    mkdirSync(join(data, "capabilities", "awake"), { recursive: true });
    writeFileSync(join(data, "capabilities", "awake", "recovery-journal.jsonl"), "");
    const there = await bash(INSTALL, home, [
      "--print-plan",
      "--user",
      "alice",
      "--data-dir",
      data,
    ]);
    expect(there.stdout).toContain("the journal exists at the WATCH path");
  });

  it("--data-dir must be absolute", async () => {
    for (const bad of ["relative/dir", "./x", "~/phoenix"]) {
      const out = await bash(INSTALL, tempHome(), [
        "--print-plan",
        "--user",
        "alice",
        "--data-dir",
        bad,
      ]);
      expect(out.code, bad).not.toBe(0);
      expect(out.stderr, bad).toContain("must be an absolute path");
    }
  });
});

describe("the sudoers rule is described as account-wide (finding 5)", () => {
  it("the script header, the plan and the --yes refusal all say any process of the account can use it", async () => {
    const text = readFileSync(INSTALL, "utf8");
    expect(text).toMatch(/ACCOUNT-WIDE/);
    expect(text).toMatch(/ANY process that\s+#\s+runs as you/);
    const plan = await bash(INSTALL, tempHome(), ["--print-plan", "--user", "alice"]);
    expect(plan.stdout).toContain("account-wide");
    expect(plan.stdout).toContain("AI agent");
    expect(readFileSync(UNINSTALL, "utf8")).toContain("--dry-run");
  });
});
