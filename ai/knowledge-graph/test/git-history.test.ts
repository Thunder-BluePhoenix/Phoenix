// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readGitHistory } from "../src";
import { OWNER, rig } from "./helpers";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
}

function repoWithTwoCommits(): string {
  const dir = mkdtempSync(join(tmpdir(), "kg-git-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Ada Lovelace");
  git(dir, "config", "user.email", "ada@example.com");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.ts"), "1");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "first\n\nbody line fixes #4");
  writeFileSync(join(dir, "src", "b.ts"), "2");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "second");
  return dir;
}

describe("readGitHistory", () => {
  it("reads author names (not emails), messages with bodies, and files, newest first", async () => {
    const dir = repoWithTwoCommits();
    const commits = await readGitHistory(dir, "o/r");
    expect(commits.map((c) => c.message.split("\n")[0])).toEqual(["second", "first"]);
    expect(commits[1]).toMatchObject({ author: "Ada Lovelace", files: ["src/a.ts"] });
    expect(commits[1]?.message).toContain("fixes #4");
    expect(JSON.stringify(commits)).not.toContain("ada@example.com");
    expect(await readGitHistory(dir, "o/r", { limit: 1 })).toHaveLength(1);
  });

  it("ingests into the graph with the mention and the author, and refuses option-shaped revisions", async () => {
    const dir = repoWithTwoCommits();
    const r = rig();
    for (const c of await readGitHistory(dir, "o/r")) r.ingest.ingestCommit(c);
    const first = (await readGitHistory(dir, "o/r")).at(-1)!;
    expect(
      r.graph.edge(OWNER, `Commit:o/r@${first.sha}|FIXES|Issue:o/r#4`)?.provenance[0]?.assertedBy,
    ).toBe("rule");
    expect(r.graph.edge(OWNER, `Commit:o/r@${first.sha}|MENTIONS|Issue:o/r#4`)).toBeNull();
    expect(r.graph.node(OWNER, "Person:ada lovelace")).not.toBeNull();
    await expect(readGitHistory(dir, "o/r", { rev: "--output=/tmp/evil" })).rejects.toThrow(
      /never an option/,
    );
  });
});
