// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it } from "vitest";
import { createGitCapability, diff, readStatus, type RepoStatus } from "../src";

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

function fixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "phoenix-git-"));
  dirs.push(dir);
  sh(dir, "init", "-q", "-b", "main");
  sh(dir, "config", "user.email", "fawkes@example.invalid");
  sh(dir, "config", "user.name", "Fawkes");
  sh(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.txt"), "one\n");
  sh(dir, "add", ".");
  sh(dir, "commit", "-qm", "initial");
  return dir;
}

function conflict(dir: string) {
  sh(dir, "checkout", "-qb", "other");
  writeFileSync(join(dir, "a.txt"), "theirs\n");
  sh(dir, "commit", "-qam", "theirs");
  sh(dir, "checkout", "-q", "main");
  writeFileSync(join(dir, "a.txt"), "ours\n");
  sh(dir, "commit", "-qam", "ours");
  try {
    sh(dir, "merge", "-q", "other");
  } catch {
    /* expected: conflict */
  }
}

const base: RepoStatus = {
  path: "/r",
  name: "r",
  branch: "main",
  head: "a",
  changed: 0,
  conflicts: [],
};

describe("diff", () => {
  it("maps transitions to git.* events", () => {
    const types = (next: Partial<RepoStatus>, prev: Partial<RepoStatus> = {}) =>
      diff({ ...base, ...prev }, { ...base, ...next }).map((e) => e.event_type);
    expect(types({})).toEqual([]);
    expect(types({ head: "b" })).toEqual(["git.commit.created"]);
    expect(types({ branch: "dev", head: "b" })).toEqual(["git.branch.changed"]);
    expect(types({ changed: 2 })).toEqual(["git.working_tree.dirty"]);
    expect(types({ changed: 3 }, { changed: 2 })).toEqual([]);
    expect(types({}, { changed: 2 })).toEqual(["git.working_tree.clean"]);
    expect(types({ conflicts: ["a"], changed: 1 })).toEqual([
      "git.merge_conflict",
      "git.working_tree.dirty",
    ]);
    expect(types({}, { conflicts: ["a"] })).toEqual(["git.merge_conflict_resolved"]);
  });
});

describe("readStatus", () => {
  it("reads branch, head, changes and conflicts from a real repository", async () => {
    const dir = fixtureRepo();
    let s = await readStatus(dir);
    expect(s).toMatchObject({ branch: "main", changed: 0, conflicts: [] });
    expect(s.head).toMatch(/^[0-9a-f]{40}$/);

    writeFileSync(join(dir, "new.txt"), "x\n");
    writeFileSync(join(dir, "a.txt"), "two\n");
    expect((await readStatus(dir)).changed).toBe(2);

    sh(dir, "checkout", "-q", "--", "a.txt");
    rmSync(join(dir, "new.txt"));
    conflict(dir);
    s = await readStatus(dir);
    expect(s.conflicts).toEqual(["a.txt"]);
  });

  it("reports an empty repository without a head", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-git-"));
    dirs.push(dir);
    sh(dir, "init", "-q", "-b", "main");
    expect(await readStatus(dir)).toMatchObject({ head: null, branch: "main" });
  });

  it("rejects a directory that is not a repository", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-notgit-"));
    dirs.push(dir);
    await expect(readStatus(dir)).rejects.toThrow();
  });
});

describe("git capability", () => {
  async function watch(...repositories: string[]) {
    h = createHarness({ modules: [createGitCapability()] });
    h.manager.configure("git", { repositories, poll_ms: 500 });
    await h.enable("git");
    await h.run("git", "status"); // baseline
    return h;
  }

  it("requires repository_access and is read-only", async () => {
    await watch(fixtureRepo());
    expect(h!.permissions.grants.missing("git", ["repository_access"])).toEqual([]);
    expect(h!.manager.get("git").commands).toEqual([
      expect.objectContaining({ name: "status", side_effect: "read" }),
    ]);
  });

  it("real commits and conflicts drive Fawkes", async () => {
    const dir = fixtureRepo();
    await watch(dir);

    writeFileSync(join(dir, "a.txt"), "two\n");
    sh(dir, "commit", "-qam", "token ghp_abcdefghijklmnopqrstuvwxyz0123 leaked");
    await h!.run("git", "status");
    const commit = h!.events.find((e) => e.event_type === "git.commit.created");
    expect(commit).toMatchObject({
      source: "git",
      subject: expect.stringMatching(/^phoenix-git-/),
    });
    expect(commit!.payload.message).toBe("token [REDACTED] leaked");

    conflict(dir);
    await h!.run("git", "status");
    expect(h!.state.snapshot()).toMatchObject({ state: "WARNING" });
    expect(h!.state.snapshot().explanation).toMatch(/Merge conflict/);

    sh(dir, "merge", "--abort");
    await h!.run("git", "status");
    expect(h!.types("git")).toContain("git.merge_conflict_resolved");
    expect(h!.state.snapshot().state).not.toBe("WARNING");
  });

  it("reports a conflict that already exists when watching starts", async () => {
    const dir = fixtureRepo();
    conflict(dir);
    await watch(dir);
    expect(h!.types("git")).toEqual(["git.merge_conflict"]);
  });

  it("shows repository status in health, and degrades on a broken path", async () => {
    const dir = fixtureRepo();
    const missing = join(tmpdir(), "phoenix-does-not-exist-" + Date.now());
    await watch(dir, missing);
    const view = await h!.manager.checkHealth("git");
    expect(view.health.status).toBe("degraded");
    expect(view.health.message).toMatch(/: main/);
  });

  it("refuses relative paths", async () => {
    h = createHarness({ modules: [createGitCapability()] });
    h.manager.configure("git", { repositories: ["relative/repo"] });
    await expect(h.enable("git")).rejects.toThrow(/must be absolute/);
  });
});
