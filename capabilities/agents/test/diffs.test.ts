// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE_GITHUB_TOKEN } from "../../../protocol/testing/fake-secrets";
import {
  FileTallies,
  GIT_OUTPUT_CUT_MARKER,
  MAX_DIFF_CHARS,
  MAX_TRACKED_FILES,
  boundDiff,
  diffHeadArgv,
  diffLinks,
  execGit,
  readDiff,
  resolveProjectFile,
  type ExecResult,
  type GitExec,
} from "../src/diffs";
import type { LinkView } from "../src/links";

const dirs: string[] = [];
function temp(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "phoenix-diffs-")));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
    cwd,
    stdio: "pipe",
  });

function repo(): string {
  const root = temp();
  git(root, "init", "-q");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "a.ts"), "one\ntwo\nthree\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

describe("FileTallies", () => {
  it("sums added/removed/edits per file without content", () => {
    const t = new FileTallies();
    t.apply({ path: "/p/a.ts", added: 2, removed: 1 }, "t1");
    const second = t.apply({ path: "/p/a.ts", added: 3, removed: 0 }, "t2");
    expect(second).toEqual({ path: "/p/a.ts", added: 5, removed: 1, edits: 2, last_at: "t2" });
    t.apply({ path: "/p/b.ts", added: 1, removed: 1 }, "t3");
    expect(t.list().map((f) => f.path)).toEqual(["/p/b.ts", "/p/a.ts"]);
  });

  it("is bounded; the least recently changed file is dropped", () => {
    const t = new FileTallies();
    for (let i = 0; i < MAX_TRACKED_FILES + 5; i++)
      t.apply({ path: `/p/${i}`, added: 1, removed: 0 }, "t");
    expect(t.list()).toHaveLength(MAX_TRACKED_FILES);
    expect(t.has("/p/0")).toBe(false);
    expect(t.has(`/p/${MAX_TRACKED_FILES + 4}`)).toBe(true);
  });
});

describe("resolveProjectFile: path-escape refusal", () => {
  it("accepts a file inside the project (relative or absolute, existing or new)", () => {
    const root = repo();
    expect(resolveProjectFile(root, "src/a.ts")).toMatchObject({ rel: "src/a.ts", root });
    expect(resolveProjectFile(root, join(root, "src", "a.ts")).rel).toBe("src/a.ts");
    expect(resolveProjectFile(root, join(root, "src", "new", "deep.ts")).rel).toBe(
      "src/new/deep.ts",
    );
  });

  it("refuses `..` in any spelling", () => {
    const root = repo();
    for (const p of [
      "../x",
      "src/../../x",
      "src/..",
      `${root}/src/../../etc/passwd`,
      "..\\x",
      "a/../b",
    ]) {
      expect(() => resolveProjectFile(root, p), p).toThrow(/\.\./);
    }
  });

  it("refuses an absolute path outside the project, and the project root itself", () => {
    const root = repo();
    const other = temp();
    writeFileSync(join(other, "secret.txt"), "x");
    expect(() => resolveProjectFile(root, join(other, "secret.txt"))).toThrow(/outside/);
    expect(() => resolveProjectFile(root, "/etc/passwd")).toThrow(/outside/);
    expect(() => resolveProjectFile(root, root)).toThrow(/outside/);
    // A sibling whose name starts with the project's name is not inside it.
    const sibling = `${root}-evil`;
    mkdirSync(sibling);
    dirs.push(sibling);
    expect(() => resolveProjectFile(root, join(sibling, "f"))).toThrow(/outside/);
  });

  it("refuses a symlink that escapes the project (file and directory)", () => {
    const root = repo();
    const other = temp();
    writeFileSync(join(other, "secret.txt"), "x");
    symlinkSync(join(other, "secret.txt"), join(root, "link.txt"));
    symlinkSync(other, join(root, "linkdir"));
    expect(() => resolveProjectFile(root, "link.txt")).toThrow(/outside/);
    expect(() => resolveProjectFile(root, "linkdir/secret.txt")).toThrow(/outside/);
    expect(() => resolveProjectFile(root, "linkdir/not-yet-created.txt")).toThrow(/outside/);
  });

  it("allows a symlink that stays inside the project", () => {
    const root = repo();
    symlinkSync(join(root, "src"), join(root, "alias"));
    expect(resolveProjectFile(root, "alias/a.ts").rel).toBe("src/a.ts");
  });

  it("works when the project itself is reached through a symlink", () => {
    const root = repo();
    const holder = temp();
    symlinkSync(root, join(holder, "proj"));
    expect(resolveProjectFile(join(holder, "proj"), "src/a.ts")).toMatchObject({
      rel: "src/a.ts",
      root,
    });
  });

  it("refuses control characters, empty and oversized paths, relative or missing projects", () => {
    const root = repo();
    for (const p of ["", "a\nb", "a\u0000b", "x".repeat(1001)]) {
      expect(() => resolveProjectFile(root, p)).toThrow();
    }
    expect(() => resolveProjectFile("relative/dir", "a")).toThrow(/absolute/);
    expect(() => resolveProjectFile(join(root, "missing"), "a")).toThrow(/not available/);
  });
});

describe("readDiff uses git with a fixed argv, no shell", () => {
  function recorder(results: ExecResult[]) {
    const calls: { argv: readonly string[]; cwd: string }[] = [];
    const exec: GitExec = async (argv, cwd) => {
      calls.push({ argv, cwd });
      return results.shift() ?? { code: 1, stdout: "", stderr: "" };
    };
    return { exec, calls };
  }

  it("passes the path as ONE argv element after `--`, even if it looks like an option or a command", async () => {
    const root = repo();
    for (const name of ["--output=evil", "-p", "a; rm -rf ~", "$(touch x)", "a b", "`id`"]) {
      const { exec, calls } = recorder([{ code: 0, stdout: "diff --git a/x b/x\n", stderr: "" }]);
      await readDiff(root, name, exec);
      const argv = calls[0]!.argv;
      expect(argv).toEqual(diffHeadArgv(name));
      const dashdash = argv.indexOf("--");
      expect(argv.slice(dashdash)).toEqual(["--", name]);
      expect(argv.filter((a) => a === name)).toHaveLength(1);
      expect(argv).toContain("--no-ext-diff");
      expect(argv).toContain("--no-textconv");
      expect(argv).toContain("--literal-pathspecs");
      expect(calls[0]!.cwd).toBe(root);
    }
  });

  it("never reaches git for a refused path (no exec call)", async () => {
    const root = repo();
    const { exec, calls } = recorder([]);
    await expect(readDiff(root, "../etc/passwd", exec)).rejects.toThrow();
    await expect(readDiff(root, "/etc/passwd", exec)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("falls back to an untracked-file diff when HEAD has none", async () => {
    const root = repo();
    const { exec, calls } = recorder([
      { code: 0, stdout: "", stderr: "" },
      { code: 0, stdout: "new.ts\n", stderr: "" },
      { code: 1, stdout: "diff --git a/new.ts b/new.ts\n+hello\n", stderr: "" },
    ]);
    const out = await readDiff(root, "new.ts", exec);
    expect(out).toMatchObject({ path: "new.ts", source: "untracked file" });
    expect(out.diff).toContain("+hello");
    expect(calls.map((c) => c.argv[c.argv.indexOf("--") - 1])).toEqual([
      "HEAD",
      "--exclude-standard",
      "--no-index",
    ]);
  });

  it("reports a non-repository clearly", async () => {
    const root = temp();
    const { exec } = recorder([
      { code: 128, stdout: "", stderr: "not a git repository" },
      { code: 128, stdout: "", stderr: "" },
    ]);
    await expect(readDiff(root, "a.ts", exec)).rejects.toThrow(/git repository/);
  });

  it("works against a real git repository", async () => {
    const root = repo();
    writeFileSync(join(root, "src", "a.ts"), "one\nTWO\nthree\nfour\n");
    writeFileSync(join(root, "src", "fresh.ts"), "brand new\n");
    const tracked = await readDiff(root, join(root, "src", "a.ts"));
    expect(tracked.source).toBe("git diff HEAD");
    expect(tracked.diff).toContain("-two");
    expect(tracked.diff).toContain("+TWO");
    expect(tracked.diff).toContain("+four");
    const fresh = await readDiff(root, "src/fresh.ts");
    expect(fresh.source).toBe("untracked file");
    expect(fresh.diff).toContain("+brand new");
  });

  it("does not run an external diff driver configured in the repository", async () => {
    const root = repo();
    writeFileSync(join(root, ".gitattributes"), "*.ts diff=evil\n");
    git(root, "config", "diff.evil.command", `touch ${join(root, "PWNED")}`);
    git(root, "config", "diff.evil.textconv", `touch ${join(root, "PWNED2")}`);
    writeFileSync(join(root, "src", "a.ts"), "changed\n");
    const out = await readDiff(root, "src/a.ts");
    expect(out.diff).toContain("+changed");
    expect(existsSync(join(root, "PWNED"))).toBe(false);
    expect(existsSync(join(root, "PWNED2"))).toBe(false);
  });
});

describe("readDiff never runs a program the repository configures", () => {
  /** A repository whose attributes send every file through a clean filter that touches a marker. */
  function filtered(driverKeys: readonly string[]): { root: string; marker: string } {
    const root = repo();
    const marker = join(root, "PWNED-FILTER");
    writeFileSync(join(root, ".gitattributes"), "* filter=evil\n");
    for (const key of driverKeys) git(root, "config", `filter.evil.${key}`, `touch ${marker}; cat`);
    return { root, marker };
  }

  it("a clean filter in .git/config is not run for a tracked file (the working file is hashed)", async () => {
    const { root, marker } = filtered(["clean"]);
    writeFileSync(join(root, "src", "a.ts"), "one\nTWO\nthree\n");
    const out = await readDiff(root, "src/a.ts");
    expect(out.diff).toContain("+TWO");
    expect(existsSync(marker)).toBe(false);
  });

  it("a clean filter is not run for an untracked file either", async () => {
    const { root, marker } = filtered(["clean"]);
    writeFileSync(join(root, "src", "fresh.ts"), "brand new\n");
    const out = await readDiff(root, "src/fresh.ts");
    expect(out.source).toBe("untracked file");
    expect(out.diff).toContain("+brand new");
    expect(existsSync(marker)).toBe(false);
  });

  it("a long-running `process` filter and a `smudge` filter are not started", async () => {
    const { root, marker } = filtered(["process", "smudge"]);
    writeFileSync(join(root, "src", "a.ts"), "changed\n");
    await readDiff(root, "src/a.ts");
    expect(existsSync(marker)).toBe(false);
  });

  it("a `required` filter that would fail does not make the diff fail", async () => {
    const { root, marker } = filtered(["clean"]);
    git(root, "config", "filter.evil.required", "true");
    writeFileSync(join(root, "src", "a.ts"), "changed\n");
    const out = await readDiff(root, "src/a.ts");
    expect(out.diff).toContain("+changed");
    expect(existsSync(marker)).toBe(false);
  });

  it("a driver name with dots and odd characters is neutralised too", async () => {
    const root = repo();
    const marker = join(root, "PWNED-DOTTED");
    writeFileSync(join(root, ".gitattributes"), "* filter=a.b-c\n");
    git(root, "config", "filter.a.b-c.clean", `touch ${marker}; cat`);
    writeFileSync(join(root, "src", "a.ts"), "changed\n");
    const out = await readDiff(root, "src/a.ts");
    expect(out.diff).toContain("+changed");
    expect(existsSync(marker)).toBe(false);
  });

  it("the fixture really fires without the guard (the marker would be created)", () => {
    const { root, marker } = filtered(["clean"]);
    writeFileSync(join(root, "src", "a.ts"), "changed\n");
    git(root, "diff", "--no-ext-diff", "--no-textconv", "HEAD", "--", "src/a.ts");
    expect(existsSync(marker)).toBe(true);
  });

  it("does not run a core.fsmonitor program from the repository config", async () => {
    const root = repo();
    const marker = join(root, "PWNED-FSMONITOR");
    git(root, "config", "core.fsmonitor", `touch ${marker}`);
    writeFileSync(join(root, "src", "a.ts"), "changed\n");
    await readDiff(root, "src/a.ts");
    expect(existsSync(marker)).toBe(false);
  });
});

describe("git is started from a neutral directory", () => {
  it("runs with cwd = the temp dir and selects the repository with `-C <root>`", async () => {
    const root = repo();
    const bin = temp();
    const log = join(bin, "log.txt");
    // A stand-in `git` first on PATH that records where it was started and with what.
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\nprintf '%s\\n' "$PWD" "$1" "$2" >> "${log}"\nexit 1\n`,
      { mode: 0o755 },
    );
    const saved = process.env.PATH;
    process.env.PATH = `${bin}:${saved ?? ""}`;
    try {
      await execGit(["status"], root);
    } finally {
      process.env.PATH = saved ?? "";
    }
    const lines = readFileSync(log, "utf8").trim().split("\n");
    const calls: { cwd: string; first: string; second: string }[] = [];
    for (let i = 0; i < lines.length; i += 3)
      calls.push({ cwd: lines[i]!, first: lines[i + 1]!, second: lines[i + 2]! });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(realpathSync(c.cwd)).toBe(realpathSync(tmpdir()));
      expect(c.cwd).not.toBe(root);
      expect([c.first, c.second]).toEqual(["-C", root]);
    }
  });
});

describe("readDiff output", () => {
  const exec =
    (stdout: string, truncated = false): GitExec =>
    async () => ({
      code: truncated ? null : 0,
      stdout,
      stderr: "",
      ...(truncated ? { truncated } : {}),
    });

  it("masks key=value secrets, private-key blocks and token shapes, and says so", async () => {
    const root = repo();
    const block = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEabcdef",
      "-----END RSA PRIVATE KEY-----",
    ];
    const text = [
      "diff --git a/x b/x",
      "+db_password=hunter2",
      `+token = ${FAKE_GITHUB_TOKEN}`,
      ...block.map((l) => `+${l}`),
      "+const keep = 1;",
      "",
    ].join("\n");
    const out = await readDiff(root, "src/a.ts", exec(text));
    expect(out.redacted).toBe(true);
    expect(out.diff).not.toMatch(/hunter2|MIIEabcdef/);
    expect(out.diff).not.toContain(FAKE_GITHUB_TOKEN);
    expect(out.diff).toContain("+const keep = 1;");
  });

  it("redacted is false when nothing was masked", async () => {
    const root = repo();
    const out = await readDiff(root, "src/a.ts", exec("diff --git a/x b/x\n+const a = 1;\n"));
    expect(out.redacted).toBe(false);
  });

  it("returns a truncated diff with a marker when git's output passed the buffer limit", async () => {
    const root = repo();
    const out = await readDiff(
      root,
      "src/a.ts",
      exec("diff --git a/x b/x\n+one\n+partial li", true),
    );
    expect(out.truncated).toBe(true);
    expect(out.diff).toContain("+one\n");
    expect(out.diff).not.toContain("partial li");
    expect(out.diff.endsWith(GIT_OUTPUT_CUT_MARKER)).toBe(true);
  });

  it("a real git whose output passes the buffer yields a truncated diff, not an error", async () => {
    const root = repo();
    writeFileSync(
      join(root, "src", "big.ts"),
      "line of text that is fairly long\n".repeat(120_000),
    );
    const out = await readDiff(root, "src/big.ts");
    expect(out.source).toBe("untracked file");
    expect(out.truncated).toBe(true);
    expect(out.diff.endsWith(GIT_OUTPUT_CUT_MARKER)).toBe(true);
  });
});

describe("boundDiff", () => {
  it("strips escapes and control characters and cuts at a line boundary", () => {
    expect(boundDiff("+a\u001b[31mred\u001b[0m\u0000b\r\n+c\n").diff).toBe("+ared" + "b\n+c\n");
    const big = `${"+line\n".repeat(MAX_DIFF_CHARS)}`;
    const out = boundDiff(big);
    expect(out.truncated).toBe(true);
    expect(out.diff.length).toBeLessThanOrEqual(MAX_DIFF_CHARS);
    expect(out.diff.endsWith("\n")).toBe(true);
  });
});

describe("diffLinks reuses stored associations only", () => {
  const link = (over: Partial<LinkView>): LinkView => ({
    id: 1,
    session_id: "ph-0123456789abcdef",
    kind: "commit",
    ref: "abc1234",
    repo: "phoenix",
    confidence: "time+path",
    source: "e1",
    why: {},
    created_at: "2026-10-16T10:00:00.000Z",
    ...over,
  });

  it("splits commits and CI runs and carries the conclusion; PRs and tasks are not included", () => {
    const out = diffLinks([
      link({}),
      link({
        id: 2,
        kind: "ci_run",
        ref: "77",
        detail: { conclusion: "failure", commit: "abc1234" },
      }),
      link({ id: 3, kind: "pr", ref: "5" }),
      link({ id: 4, kind: "task", ref: "t" }),
    ]);
    expect(out.commits).toEqual([
      {
        ref: "abc1234",
        repo: "phoenix",
        confidence: "time+path",
        created_at: "2026-10-16T10:00:00.000Z",
      },
    ]);
    expect(out.ci_runs).toMatchObject([{ ref: "77", conclusion: "failure" }]);
    expect(diffLinks([])).toEqual({ commits: [], ci_runs: [] });
  });
});
