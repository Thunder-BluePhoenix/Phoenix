// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_AWS_KEY, FAKE_GITHUB_TOKEN } from "../../../protocol/testing/fake-secrets";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_COMMITS,
  MAX_FILES,
  createGitCapability,
  parseLog,
  validateLimit,
  validatePathFilter,
  validateRef,
  type RecentCommits,
} from "../src";

const dirs: string[] = [];
let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function sh(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function emptyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "phoenix-git-recent-"));
  dirs.push(dir);
  sh(dir, "init", "-q", "-b", "main");
  sh(dir, "config", "user.email", "ada.secret@example.invalid");
  sh(dir, "config", "user.name", "Ada Secretname");
  sh(dir, "config", "commit.gpgsign", "false");
  return dir;
}

/** Commits `files` (path -> content) with `subject`; the message is read from stdin. */
function commit(dir: string, subject: string, files: Record<string, string> = {}) {
  const changes = Object.keys(files).length ? files : { "counter.txt": `${Math.random()}\n` };
  for (const [path, content] of Object.entries(changes)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  sh(dir, "add", "-A");
  execFileSync("git", ["commit", "-q", "-F", "-"], { cwd: dir, input: subject });
}

async function enable(...repositories: string[]) {
  h = createHarness({ modules: [createGitCapability()] });
  h.manager.configure("git", { repositories, poll_ms: 60_000 });
  await h.enable("git");
}

async function recent(input: Record<string, unknown> = {}) {
  const op = await h!.run("git", "recent_commits", input);
  return { op, result: op.result as RecentCommits };
}

describe("recent_commits manifest", () => {
  it("is a read command needing only repository_access", async () => {
    await enable(emptyRepo());
    const view = h!.manager.get("git");
    expect(view.commands).toContainEqual(
      expect.objectContaining({ name: "recent_commits", side_effect: "read" }),
    );
    expect(view.permissions.map((p) => p.permission)).toEqual(["repository_access"]);
  });

  it.each([
    ["limit 0", { limit: 0 }],
    ["limit above the maximum", { limit: MAX_COMMITS + 1 }],
    ["a fractional limit", { limit: 2.5 }],
    ["a string limit", { limit: "5" }],
    ["a negative limit", { limit: -1 }],
    ["an unknown key", { repo: "/x" }],
    ["a non-string path_filter", { path_filter: 5 }],
    ["an empty path_filter", { path_filter: "" }],
    ["an over-long path_filter", { path_filter: "a".repeat(201) }],
    ["a non-string repo_path", { repo_path: 7 }],
  ])("rejects %s before the capability runs", async (_name, input) => {
    await enable(emptyRepo());
    expect(() => h!.manager.invoke("git", "recent_commits", input)).toThrow(
      /Invalid command input/,
    );
  });
});

describe("recent_commits output", () => {
  it("returns sha, subject, ISO date and changed files; never author names or emails", async () => {
    const dir = emptyRepo();
    commit(dir, "first", { "a.txt": "1\n", "src/b.ts": "2\n" });
    commit(dir, "second\n\nlong body that is not returned", { "src/b.ts": "3\n" });
    await enable(dir);
    const { op, result } = await recent();
    expect(op.status).toBe("succeeded");
    expect(result.truncated).toBe(false);
    expect(result.repository).toBe(dir.split("/").pop());
    expect(result.commits.map((c) => c.subject)).toEqual(["second", "first"]);
    const [newest, oldest] = result.commits;
    expect(newest!.sha).toBe(sh(dir, "rev-parse", "HEAD").trim());
    expect(newest!.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(newest!.short_sha).toBe(newest!.sha.slice(0, 7));
    expect(newest!.author_date).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(newest).toMatchObject({ files_changed: 1, files: ["src/b.ts"] });
    expect(oldest).toMatchObject({ files_changed: 2, files: ["a.txt", "src/b.ts"] });
    expect(newest!.committer_date).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(Object.keys(newest!).sort()).toEqual([
      "author_date",
      "committer_date",
      "files",
      "files_changed",
      "sha",
      "short_sha",
      "subject",
    ]);
    const text = JSON.stringify(op.result);
    expect(text).not.toContain("Secretname");
    expect(text).not.toContain("example.invalid");
    expect(text).not.toContain("long body");
  });

  it("an empty repository (no commits) gives commits: []", async () => {
    await enable(emptyRepo());
    const { op, result } = await recent();
    expect(op.status).toBe("succeeded");
    expect(result).toMatchObject({ commits: [], truncated: false });
  });

  it("honours limit, reports truncation, and defaults to 10", async () => {
    const dir = emptyRepo();
    for (let i = 1; i <= 12; i++) commit(dir, `c${i}`);
    await enable(dir);
    expect((await recent()).result.commits.map((c) => c.subject)).toEqual(
      Array.from({ length: 10 }, (_, i) => `c${12 - i}`),
    );
    expect((await recent()).result.truncated).toBe(true);
    const three = (await recent({ limit: 3 })).result;
    expect(three.commits.map((c) => c.subject)).toEqual(["c12", "c11", "c10"]);
    expect(three.truncated).toBe(true);
    const all = (await recent({ limit: 12 })).result;
    expect(all.commits).toHaveLength(12);
    expect(all.truncated).toBe(false);
  });

  it("limit 50 is the maximum and returns at most 50 commits", async () => {
    const dir = emptyRepo();
    for (let i = 0; i < MAX_COMMITS + 3; i++) commit(dir, `c${i}`);
    await enable(dir);
    const { result } = await recent({ limit: MAX_COMMITS });
    expect(result.commits).toHaveLength(MAX_COMMITS);
    expect(result.truncated).toBe(true);
  });

  it("caps files at 30 paths of 200 characters while still counting them all", async () => {
    const dir = emptyRepo();
    const files: Record<string, string> = {};
    for (let i = 0; i < 45; i++) files[`f${String(i).padStart(2, "0")}.txt`] = "x\n";
    files[`${"d".repeat(120)}/${"e".repeat(120)}.txt`] = "x\n";
    commit(dir, "many files", files);
    await enable(dir);
    const commitOut = (await recent()).result.commits[0]!;
    expect(commitOut.files_changed).toBe(46);
    expect(commitOut.files).toHaveLength(MAX_FILES);
    expect(commitOut.files.every((f) => f.length <= 200)).toBe(true);
    const long = (await recent({ path_filter: "d".repeat(120) })).result.commits[0]!;
    expect(long.files[0]).toHaveLength(200);
    expect(long.files[0]!.endsWith("…")).toBe(true);
  });

  it("clips a long subject to 200 characters", async () => {
    const dir = emptyRepo();
    commit(dir, "s".repeat(500));
    await enable(dir);
    const subject = (await recent()).result.commits[0]!.subject;
    expect(subject).toHaveLength(200);
    expect(subject.endsWith("…")).toBe(true);
  });

  it("redacts secret-looking subjects", async () => {
    const dir = emptyRepo();
    commit(dir, `deploy with ${FAKE_GITHUB_TOKEN} and ${FAKE_AWS_KEY}`);
    await enable(dir);
    const { op, result } = await recent();
    expect(result.commits[0]!.subject).toBe("deploy with [REDACTED] and [REDACTED]");
    expect(JSON.stringify(op.result)).not.toContain(FAKE_GITHUB_TOKEN);
  });

  it("a subject that looks like a flag is data: no option is run, nothing is written", async () => {
    const dir = emptyRepo();
    const out = join(tmpdir(), `phoenix-recent-out-${process.pid}-${Date.now()}`);
    commit(dir, `--output=${out}`);
    commit(dir, "-n 1");
    commit(dir, "--exec=touch /tmp/phoenix-should-not-exist");
    await enable(dir);
    const { result } = await recent({ limit: 5 });
    expect(result.commits.map((c) => c.subject)).toEqual([
      "--exec=touch /tmp/phoenix-should-not-exist",
      "-n 1",
      `--output=${out}`,
    ]);
    expect(existsSync(out)).toBe(false);
  });

  it("a subject containing the field and record delimiters cannot forge commits or fields", async () => {
    const dir = emptyRepo();
    const fake = `\u001e${"a".repeat(40)}\u001f2001-01-01T00:00:00Z\u001fforged`;
    commit(dir, `real \u001f ${fake}`);
    commit(dir, fake);
    await enable(dir);
    const { result } = await recent();
    expect(result.commits).toHaveLength(2);
    expect(result.commits.map((c) => c.sha)).not.toContain("a".repeat(40));
    expect(result.commits[1]!.subject).toContain("real");
    expect(result.commits[1]!.subject).toContain("forged");
    expect(result.commits[1]!.author_date).not.toBe("2001-01-01T00:00:00.000Z");
  });

  it("merge commits are listed once, with no files", async () => {
    const dir = emptyRepo();
    commit(dir, "base", { "base.txt": "1\n" });
    sh(dir, "checkout", "-qb", "feature");
    commit(dir, "feature work", { "feature.txt": "1\n" });
    sh(dir, "checkout", "-q", "main");
    commit(dir, "main work", { "main.txt": "1\n" });
    sh(dir, "merge", "-q", "--no-ff", "-m", "Merge feature", "feature");
    await enable(dir);
    const { result } = await recent();
    expect(result.commits.map((c) => c.subject)).toEqual([
      "Merge feature",
      "main work",
      "feature work",
      "base",
    ]);
    expect(result.commits[0]).toMatchObject({ files_changed: 0, files: [] });
  });

  it("path_filter keeps only commits touching that path, and treats it literally", async () => {
    const dir = emptyRepo();
    commit(dir, "docs", { "docs/readme.md": "1\n" });
    commit(dir, "code", { "src/main.ts": "1\n" });
    commit(dir, "star", { "weird*name.txt": "1\n" });
    await enable(dir);
    expect((await recent({ path_filter: "docs" })).result.commits.map((c) => c.subject)).toEqual([
      "docs",
    ]);
    expect((await recent({ path_filter: "src/main.ts" })).result.commits).toHaveLength(1);
    // A glob is not expanded: "*" matches no file called "*".
    expect((await recent({ path_filter: "*" })).result.commits).toEqual([]);
    expect((await recent({ path_filter: ":(top)docs" })).result.commits).toEqual([]);
    expect((await recent({ path_filter: "weird*name.txt" })).result.commits).toHaveLength(1);
  });

  it("only runs git log", async () => {
    // A spy on the binary: a shim that records its arguments and then execs the real git.
    const dir = emptyRepo();
    commit(dir, "one");
    const bin = mkdtempSync(join(tmpdir(), "phoenix-git-shim-"));
    dirs.push(bin);
    const log = join(bin, "calls.log");
    const real = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexec "${real}" "$@"\n`,
      { mode: 0o755 },
    );
    const before = process.env.PATH;
    process.env.PATH = `${bin}:${before}`;
    try {
      await enable(dir);
      await recent({ limit: 2, path_filter: "counter.txt" });
    } finally {
      process.env.PATH = before;
    }
    const calls = execFileSync("cat", [log], { encoding: "utf8" }).trim().split("\n");
    const logCalls = calls.filter((c) => c.includes(" log "));
    expect(logCalls).toHaveLength(1);
    expect(logCalls[0]).toContain("--no-pager");
    expect(logCalls[0]).toContain("--no-color");
    expect(logCalls[0]).toContain("-n 3");
    expect(logCalls[0]).toMatch(/--end-of-options -- counter\.txt$/);
    expect(logCalls[0]).toContain("--literal-pathspecs");
    expect(logCalls[0]).not.toMatch(/\b(commit|push|checkout|reset|fetch|pull|merge)\b/);
  });
});

describe("recent_commits path_filter validation", () => {
  it.each([
    ["an option", "--exec=x"],
    ["a short option", "-x"],
    ["a parent segment", "../x"],
    ["a nested parent segment", "a/../../x"],
    ["a backslash parent segment", "a\\..\\x"],
    ["a bare parent", ".."],
    ["an absolute path", "/etc/passwd"],
    ["a windows drive", "C:\\Windows"],
    ["a backslash root", "\\share"],
    ["a newline", "a\nb"],
    ["a NUL", "a\u0000b"],
    ["a tab", "a\tb"],
    ["an escape character", "a\u001bb"],
  ])("rejects %s", async (_name, filter) => {
    expect(() => validatePathFilter(filter)).toThrow();
    const dir = emptyRepo();
    commit(dir, "one");
    await enable(dir);
    const { op } = await recent({ path_filter: filter });
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/path_filter/);
  });

  it("accepts ordinary paths, including dots and spaces", () => {
    for (const ok of [
      "src",
      "src/a b.ts",
      ".github/workflows/ci.yml",
      "a..b",
      "...",
      "x/.hidden",
    ]) {
      expect(validatePathFilter(ok)).toBe(ok);
    }
  });
});

describe("recent_commits repository selection", () => {
  it("defaults to the only watched repository", async () => {
    const dir = emptyRepo();
    commit(dir, "one");
    await enable(dir);
    expect((await recent()).result.commits).toHaveLength(1);
    expect((await recent({ repo_path: dir })).result.commits).toHaveLength(1);
  });

  it("needs repo_path when several are watched, and picks the matching one", async () => {
    const a = emptyRepo();
    const b = emptyRepo();
    commit(a, "in a");
    commit(b, "in b");
    await enable(a, b);
    const missing = await recent();
    expect(missing.op.status).toBe("failed");
    expect(missing.op.error?.message).toMatch(/repo_path is required/);
    expect((await recent({ repo_path: b })).result.commits[0]!.subject).toBe("in b");
    expect((await recent({ repo_path: a })).result.commits[0]!.subject).toBe("in a");
  });

  it("refuses a repository that is not configured, even a real one", async () => {
    const watched = emptyRepo();
    const other = emptyRepo();
    commit(other, "secret work");
    await enable(watched);
    for (const repo_path of [
      other,
      join(watched, ".."),
      join(watched, "sub"),
      "relative/path",
      ".",
      "/",
    ]) {
      const { op } = await recent({ repo_path });
      expect(op.status, repo_path).toBe("failed");
      expect(op.error?.message).toMatch(/not one of the watched repositories/);
      expect(JSON.stringify(op)).not.toContain("secret work");
    }
  });

  it("accepts an equivalent spelling of a watched path but not a relative one", async () => {
    const dir = emptyRepo();
    commit(dir, "one");
    await enable(dir);
    expect((await recent({ repo_path: `${dir}/` })).op.status).toBe("succeeded");
    expect((await recent({ repo_path: `${dir}/sub/..` })).op.status).toBe("succeeded");
  });

  it("fails when nothing is watched", async () => {
    await enable();
    const { op } = await recent();
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/No repositories selected/);
  });

  it("fails clearly for a watched path that is not a repository", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-git-notrepo-"));
    dirs.push(dir);
    await enable(dir);
    const { op } = await recent();
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/git log failed/);
  });
});

describe("validateLimit (second line of defence behind the schema)", () => {
  it("accepts 1..50 and undefined, rejects everything else", () => {
    expect(validateLimit(undefined)).toBe(10);
    expect(validateLimit(1)).toBe(1);
    expect(validateLimit(MAX_COMMITS)).toBe(MAX_COMMITS);
    for (const bad of [0, -1, MAX_COMMITS + 1, 1e9, 2.5, NaN, Infinity, "5", null, {}]) {
      expect(() => validateLimit(bad), String(bad)).toThrow(/limit must be/);
    }
  });
});

describe("parseLog", () => {
  it("ignores stray lines before the first header and survives garbage dates", () => {
    const sha = "b".repeat(40);
    const commits = parseLog(
      `noise\n\u001e${sha}\u001fnot-a-date\u001fnope\u001fhello\nfile.txt\n\n`,
    );
    expect(commits).toEqual([
      {
        sha,
        short_sha: "bbbbbbb",
        subject: "hello",
        author_date: null,
        committer_date: null,
        files_changed: 1,
        files: ["file.txt"],
      },
    ]);
  });
});

describe("ref: only the commits that led to a given commit", () => {
  const shaOf = (dir: string, rev: string) => sh(dir, "rev-parse", rev).trim();

  it("lists the ancestors of the ref, not the newest commits of the repository", async () => {
    const dir = emptyRepo();
    commit(dir, "base");
    commit(dir, "on main");
    const fork = shaOf(dir, "HEAD");
    sh(dir, "checkout", "-q", "-b", "side");
    commit(dir, "side one");
    const sideTip = shaOf(dir, "HEAD");
    sh(dir, "checkout", "-q", "main");
    commit(dir, "main newer");
    await enable(dir);
    const all = (await recent()).result.commits.map((c) => c.subject);
    const fromSide = (await recent({ ref: sideTip })).result;
    expect(fromSide.ref).toEqual({ requested: sideTip, found: true });
    expect(fromSide.commits.map((c) => c.subject)).toEqual(["side one", "on main", "base"]);
    const fromFork = (await recent({ ref: fork.slice(0, 10) })).result;
    expect(fromFork.commits.map((c) => c.subject)).toEqual(["on main", "base"]);
    expect(fromFork.ref).toEqual({ requested: fork.slice(0, 10), found: true });
  });

  it("a commit that is not in this repository is reported as not found, with no commits", async () => {
    const dir = emptyRepo();
    commit(dir, "only");
    await enable(dir);
    const absent = "a4ef8a44ea85e0e78161a10caeabfc54ec476bca";
    const result = (await recent({ ref: absent })).result;
    expect(result).toEqual({
      repository: result.repository,
      ref: { requested: absent, found: false },
      commits: [],
      truncated: false,
    });
  });

  it("an object that exists but is not a commit (a blob) is treated as not found", async () => {
    const dir = emptyRepo();
    commit(dir, "only", { "a.txt": "hello\n" });
    const blob = sh(dir, "rev-parse", "HEAD:a.txt").trim();
    await enable(dir);
    expect((await recent({ ref: blob })).result.ref).toEqual({ requested: blob, found: false });
  });

  it.each([
    "--output=/tmp/phoenix-ref-x",
    "-n1",
    "HEAD",
    "main",
    "HEAD;rm",
    "HEAD~1",
    "abc",
    "abcdef0 --all",
    "abcdef0\n--all",
    "a".repeat(41),
    "",
    "origin/main",
    "..",
    "$(id)",
    "g".repeat(10),
  ])("rejects %j", async (ref) => {
    const dir = emptyRepo();
    commit(dir, "only");
    await enable(dir);
    expect(() => h!.manager.invoke("git", "recent_commits", { ref })).toThrow(
      /Invalid command input/,
    );
    expect(() => validateRef(ref)).toThrow();
    expect(existsSync("/tmp/phoenix-ref-x")).toBe(false);
  });

  it("rejects a non-string ref", async () => {
    const dir = emptyRepo();
    commit(dir, "only");
    await enable(dir);
    for (const ref of [5, null, ["abcdef0"], { a: 1 }]) {
      expect(() => h!.manager.invoke("git", "recent_commits", { ref })).toThrow(
        /Invalid command input/,
      );
      expect(() => validateRef(ref)).toThrow();
    }
  });

  it("a ref combines with limit and path_filter", async () => {
    const dir = emptyRepo();
    commit(dir, "docs one", { "docs/a.md": "1\n" });
    commit(dir, "src one", { "src/a.ts": "1\n" });
    const tip = shaOf(dir, "HEAD");
    commit(dir, "docs two", { "docs/b.md": "1\n" });
    await enable(dir);
    const out = (await recent({ ref: tip, path_filter: "docs" })).result;
    expect(out.commits.map((c) => c.subject)).toEqual(["docs one"]);
    expect((await recent({ ref: tip, limit: 1 })).result.truncated).toBe(true);
  });
});
