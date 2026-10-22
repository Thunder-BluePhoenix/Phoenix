// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PhoenixEvent } from "@phoenix/protocol";
import { describe, expect, it } from "vitest";
import type { Meeting } from "@phoenix/persistence";
import type { LiveSessionView } from "../../api/src/agent-live-routes";
import {
  cleanTitle,
  createDailyDigest,
  readDigestCommits,
  type DigestSource,
  type GitDigestRunner,
} from "../src/daily-digest";
import { DailyDigestService, EVENT_WINDOW, MEETING_WINDOW } from "../src/daily-digest/service";
import { eventDigestSources, sessionDigestSources } from "../src/daily-digest/sources";

const exec = promisify(execFile);
const NOW = Date.parse("2026-10-22T18:00:00Z");
const source = (
  title: string,
  occurredAt: string,
  status: DigestSource["status"] = "done",
  extra: Partial<DigestSource> = {},
): DigestSource => ({
  kind: "task",
  href: `#/meetings/${encodeURIComponent(title)}`,
  title,
  occurredAt,
  status,
  ...extra,
});

let counter = 0;
function event(
  type: string,
  src: string,
  timestamp: string,
  payload: Record<string, unknown>,
  subject = "me/repo",
): PhoenixEvent {
  counter++;
  return {
    event_id: `evt_test${String(counter).padStart(6, "0")}`,
    event_type: type,
    version: "1.1",
    source: src,
    timestamp,
    severity: "info",
    subject,
    payload,
  };
}

const service = (over: Partial<ConstructorParameters<typeof DailyDigestService>[0]> = {}) =>
  new DailyDigestService({
    now: () => NOW,
    timeZone: "UTC",
    repositories: () => [],
    events: () => [],
    sessions: () => [],
    meetingsAllowed: () => false,
    meetings: () => [],
    ...over,
  });

describe("daily digest", () => {
  it("groups only cited observations, never invents plans or blockers", () => {
    const digest = createDailyDigest({
      now: () => NOW,
      timeZone: "UTC",
      sources: [
        source("closed task", "2026-10-21T10:00:00Z"),
        source("planned task", "2026-10-22T08:00:00Z", "planned"),
        source("failed CI", "2026-10-22T09:00:00Z", "blocked"),
        source("completed task", "2026-10-22T12:00:00Z"),
        { ...source("unsupported", "2026-10-22T12:00:00Z"), href: "javascript:alert(1)" },
        { ...source("external", "2026-10-22T12:00:00Z"), href: "https://example.org/x" },
        source("tomorrow", "2026-10-23T10:00:00Z"),
      ],
    });
    expect(digest.yesterday.map((line) => line.text)).toEqual(["closed task"]);
    expect(digest.today.map((line) => line.text)).toEqual(["planned task"]);
    expect(digest.blockers.map((line) => line.text)).toEqual(["failed CI"]);
    expect(digest.endOfDay.map((line) => line.text)).toEqual(["failed CI", "completed task"]);
    for (const line of [...digest.yesterday, ...digest.today, ...digest.blockers])
      expect(line.source.href).toMatch(/^#\//);
  });

  it("never cites a payload URL: event claims are unverified and link to the stored event", () => {
    const forged = event(
      "github.ci.failed",
      "github",
      "2026-10-22T09:00:00Z",
      { url: "https://evil.example/phish" },
      "me/repo · CI",
    );
    expect(eventDigestSources([forged])).toEqual([
      expect.objectContaining({
        href: `#/digest/event/${forged.event_id}`,
        title: "Unverified event · me/repo · CI",
        status: "blocked",
      }),
    ]);
    const svc = service({ events: () => [forged] });
    expect(svc.event(forged.event_id)).toMatchObject({ verified: false, kind: "ci" });
    expect(svc.event("evt_missing01")).toBeNull();
    expect(JSON.stringify(svc.event(forged.event_id))).not.toContain("evil.example");
  });
});

describe("finding 1: failed or truncated sources are reported, not shown as an empty day", () => {
  it("names a failing repository, a failing event store and a failing session list", async () => {
    const digest = await service({
      repositories: () => ["/watched/a"],
      gitRunner: async () => {
        throw new Error("boom");
      },
      events: () => {
        throw new Error("db closed");
      },
      sessions: () => {
        throw new Error("down");
      },
    }).generate();
    expect(digest.yesterday).toEqual([]);
    expect(digest.unavailable.sort()).toEqual(["events", "git", "sessions"]);
  });

  it("names a repository list that cannot be read and a failing meeting store", async () => {
    const digest = await service({
      repositories: () => {
        throw new Error("no config");
      },
      meetingsAllowed: () => true,
      meetings: () => {
        throw new Error("locked");
      },
    }).generate();
    expect(digest.unavailable.sort()).toEqual(["git", "meetings"]);
  });

  it("reports a full event window and a full meeting window as partial", async () => {
    const filler = Array.from({ length: EVENT_WINDOW }, () =>
      event("pet.state.changed", "core", "2026-10-22T09:00:00Z", {}),
    );
    const meetings = Array.from({ length: MEETING_WINDOW }, (_, i) => ({
      id: `m${i}`,
      title: `Meeting ${i}`,
      started_at: "2026-10-22T08:00:00Z",
      ended_at: "2026-10-22T09:00:00Z",
      archived_at: null,
    })) as unknown as Meeting[];
    const digest = await service({
      events: () => filler,
      meetingsAllowed: () => true,
      meetings: () => meetings,
    }).generate();
    expect(digest.partial.sort()).toEqual(["events", "meetings"]);
    expect(digest.unavailable).toEqual([]);
  });

  it("reports nothing when every source was read in full", async () => {
    const digest = await service({
      events: () => [event("github.ci.passed", "github", "2026-10-22T09:00:00Z", {})],
    }).generate();
    expect(digest.unavailable).toEqual([]);
    expect(digest.partial).toEqual([]);
    expect(digest.unattributed).toEqual([]);
  });

  it("keeps the other repositories when one fails", async () => {
    const runner: GitDigestRunner = async (cwd, args) => {
      if (cwd === "/bad") throw new Error("not a repository");
      if (args[0] === "config") return "me@example.invalid\n";
      return `${"a".repeat(40)}\0${"2026-10-21T12:00:00+00:00"}\0me@example.invalid\0Good commit\0`;
    };
    const digest = await service({
      repositories: () => ["/bad", "/good"],
      gitRunner: runner,
    }).generate();
    expect(digest.unavailable).toEqual(["git"]);
    expect(digest.yesterday.map((line) => line.text)).toEqual(["Good commit"]);
  });
});

describe("finding 2: commits are the user's own, by author date", () => {
  const git = (dir: string, ...args: string[]) =>
    exec("git", ["-C", dir, ...args], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    });
  const commit = (dir: string, who: string, message: string, author: string, committer: string) =>
    exec(
      "git",
      [
        "-C",
        dir,
        "-c",
        `user.name=${who}`,
        "-c",
        `user.email=${who}@example.invalid`,
        "commit",
        "--allow-empty",
        "-qm",
        message,
      ],
      {
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_AUTHOR_NAME: who,
          GIT_AUTHOR_EMAIL: `${who}@example.invalid`,
          GIT_AUTHOR_DATE: author,
          GIT_COMMITTER_DATE: committer,
        },
      },
    );

  it("excludes other authors and merges, and dates a commit by its author date", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phoenix-digest-"));
    try {
      await exec("git", ["init", "-q", "-b", "main", dir]);
      await git(dir, "config", "user.email", "me@example.invalid");
      await commit(dir, "me", "Mine yesterday", "2026-10-21T12:00:00Z", "2026-10-21T12:00:00Z");
      await commit(dir, "other", "Someone else", "2026-10-21T13:00:00Z", "2026-10-21T13:00:00Z");
      // Forged: authored by me long ago, committer date set to today to look like fresh work.
      await commit(dir, "me", "Old but re-dated", "2026-09-01T12:00:00Z", "2026-10-22T09:00:00Z");
      // A merge commit by me.
      await git(dir, "checkout", "-q", "-b", "side");
      await commit(dir, "me", "Side work", "2026-10-21T14:00:00Z", "2026-10-21T14:00:00Z");
      await git(dir, "checkout", "-q", "main");
      await commit(dir, "me", "Main work", "2026-10-21T15:00:00Z", "2026-10-21T15:00:00Z");
      await exec("git", ["-C", dir, "merge", "--no-ff", "-q", "-m", "Merge side", "side"], {
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_AUTHOR_NAME: "me",
          GIT_AUTHOR_EMAIL: "me@example.invalid",
          GIT_COMMITTER_NAME: "me",
          GIT_COMMITTER_EMAIL: "me@example.invalid",
          GIT_AUTHOR_DATE: "2026-10-21T16:00:00Z",
          GIT_COMMITTER_DATE: "2026-10-21T16:00:00Z",
        },
      });
      const read = await readDigestCommits(dir, "2026-10-22", "UTC");
      expect(read.attributed).toBe(true);
      const titles = read.sources.map((s) => s.title).sort();
      expect(titles).toEqual(["Main work", "Mine yesterday", "Side work"]);
      expect(titles).not.toContain("Someone else");
      expect(titles).not.toContain("Merge side");
      expect(titles).not.toContain("Old but re-dated");
      for (const s of read.sources) expect(s.href).toMatch(/^#\/digest\/commit\/[0-9a-f]{40}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves commits out and says so when no git identity is configured", async () => {
    const unset: GitDigestRunner = async (_cwd, args) => {
      if (args[0] === "config") throw Object.assign(new Error("unset"), { code: 1 });
      throw new Error("log must not run without an identity");
    };
    expect(await readDigestCommits("/r", "2026-10-22", "UTC", unset)).toEqual({
      sources: [],
      truncated: false,
      attributed: false,
    });
    const digest = await service({ repositories: () => ["/r"], gitRunner: unset }).generate();
    expect(digest.unattributed).toEqual(["git"]);
    expect(digest.unavailable).toEqual([]);
    expect(digest.yesterday).toEqual([]);
  });

  it("does not hide a config read that FAILED as an unset identity", async () => {
    const broken: GitDigestRunner = async () => {
      throw Object.assign(new Error("fatal"), { code: 128 });
    };
    await expect(readDigestCommits("/r", "2026-10-22", "UTC", broken)).rejects.toThrow();
  });

  it("scopes the log by author and refuses merges, and flags a full window as partial", async () => {
    const calls: string[][] = [];
    const runner: GitDigestRunner = async (_cwd, args) => {
      calls.push([...args]);
      if (args[0] === "config") return "ME@Example.invalid\n";
      return Array.from(
        { length: 501 },
        (_, i) =>
          `${i.toString(16).padStart(40, "a")}\0${"2026-10-21T12:00:00+00:00"}\0me@example.invalid\0c${i}\0`,
      ).join("");
    };
    const read = await readDigestCommits("/r", "2026-10-22", "UTC", runner);
    const log = calls.find((args) => args.includes("log"))!;
    expect(log).toContain("--no-merges");
    expect(log).toContain("--author=<me@example.invalid>");
    expect(log).toContain("--fixed-strings");
    expect(read.truncated).toBe(true);
    expect(read.sources).toHaveLength(500);
  });
});

describe("finding 3: a blocker ends when the same subject passes or resumes", () => {
  const ci = (type: string, at: string, workflow = "CI", branch = "main") =>
    event(type, "github", at, { repository: "me/repo", workflow, branch }, "me/repo · CI");
  const build = (events: PhoenixEvent[]) =>
    createDailyDigest({
      now: () => NOW,
      timeZone: "UTC",
      sources: eventDigestSources(events),
    });

  it("clears a failed CI after a later pass of the same workflow and branch", () => {
    const digest = build([
      ci("github.ci.failed", "2026-10-22T09:00:00Z"),
      ci("github.ci.passed", "2026-10-22T10:00:00Z"),
    ]);
    expect(digest.blockers).toEqual([]);
    expect(digest.endOfDay.map((line) => line.source.status)).toEqual(["done"]);
  });

  it("keeps a failure when only a DIFFERENT workflow or branch passed, or the pass was earlier", () => {
    const digest = build([
      ci("github.ci.passed", "2026-10-22T08:00:00Z"),
      ci("github.ci.failed", "2026-10-22T09:00:00Z"),
      ci("github.ci.passed", "2026-10-22T10:00:00Z", "Other workflow"),
      ci("github.ci.passed", "2026-10-22T11:00:00Z", "CI", "feature"),
    ]);
    expect(digest.blockers).toHaveLength(1);
  });

  it("clears a waiting agent once it works again, without listing the resume as a line", () => {
    const waiting = event("agent.waiting", "agents", "2026-10-22T09:00:00Z", {
      agent: "claude-code",
      agent_id: "s1",
    });
    const working = event("agent.working", "agents", "2026-10-22T09:30:00Z", {
      agent: "claude-code",
      agent_id: "s1",
    });
    const digest = build([waiting, working]);
    expect(digest.blockers).toEqual([]);
    expect(digest.endOfDay).toEqual([]);
  });

  it("keeps a waiting agent blocked when a different session resumed", () => {
    const digest = build([
      event("agent.waiting", "agents", "2026-10-22T09:00:00Z", { agent: "a", agent_id: "s1" }),
      event("agent.working", "agents", "2026-10-22T09:30:00Z", { agent: "a", agent_id: "s2" }),
    ]);
    expect(digest.blockers).toHaveLength(1);
  });

  it("judges a past day as it stood then: a pass the next day does not rewrite yesterday", () => {
    const digest = createDailyDigest({
      day: "2026-10-21",
      now: () => NOW,
      timeZone: "UTC",
      sources: eventDigestSources([
        ci("github.ci.failed", "2026-10-21T09:00:00Z"),
        ci("github.ci.passed", "2026-10-22T10:00:00Z"),
      ]),
    });
    expect(digest.blockers).toHaveLength(1);
  });
});

describe("finding 4: titles are sanitised", () => {
  it("strips control and bidi/format characters, collapses newlines and clips", () => {
    expect(cleanTitle("fix\u202Egnp.exe\nnext\tline\u200B\u2066x\u2069\u0007")).toBe(
      "fixgnp.exe next linex",
    );
    expect(cleanTitle("a\r\n\r\n\u2028b")).toBe("a b");
    const clipped = cleanTitle("x".repeat(500));
    expect(Array.from(clipped)).toHaveLength(200);
    expect(clipped.endsWith("…")).toBe(true);
  });

  it("applies in the digest model to every source, including a commit subject", () => {
    const digest = createDailyDigest({
      now: () => NOW,
      timeZone: "UTC",
      sources: [source("evil\u202E\ninjected\u0000title", "2026-10-21T10:00:00Z")],
    });
    expect(digest.yesterday[0]?.text).toBe("evil injected title");
  });
});

describe("finding 5: project names are opt-in", () => {
  const session = (project: string): LiveSessionView => ({
    id: "s1",
    agent: "claude-code",
    project,
    repository: "repo",
    first_seen: "2026-10-22T08:00:00Z",
    last_seen: "2026-10-22T09:00:00Z",
    active: false,
    step_count: 4,
    dropped_steps: 0,
    has_terminal: false,
  });

  it("omits the project folder by default and names it only when switched on", () => {
    const sessions = [session("/Users/me/secret-client-project")];
    expect(sessionDigestSources(sessions)[0]?.title).toBe("claude-code (4 steps)");
    expect(sessionDigestSources(sessions, { projectNames: true })[0]?.title).toBe(
      "claude-code · secret-client-project (4 steps)",
    );
  });

  it("the service passes the project-name choice through, default off", async () => {
    const sessions = () => [session("/Users/me/secret-client-project")];
    const off = await service({ sessions }).generate();
    expect(JSON.stringify(off)).not.toContain("secret-client-project");
    const on = await service({ sessions, projectNames: () => true }).generate();
    expect(JSON.stringify(on)).toContain("secret-client-project");
  });
});

describe("finding 7: commit lookup disables signature output and uses the author date", () => {
  it("passes -c log.showSignature=false and --no-show-signature", async () => {
    const sha = "b".repeat(40);
    const seen: string[][] = [];
    const runner: GitDigestRunner = async (_cwd, args) => {
      seen.push([...args]);
      return `${sha}\0${"2026-10-21T12:00:00+00:00"}\0Subject\u202E\n`;
    };
    const found = await service({ repositories: () => ["/r"], gitRunner: runner }).commit(sha);
    expect(found).toEqual({ sha, title: "Subject", occurredAt: "2026-10-21T12:00:00+00:00" });
    const args = seen[0]!;
    expect(args).toContain("--no-show-signature");
    expect(args.join(" ")).toContain("-c log.showSignature=false");
    expect(args).toContain("--format=%H%x00%aI%x00%s");
    expect(args.indexOf("--end-of-options")).toBe(args.length - 2);
    expect(args.at(-1)).toBe(sha);
  });

  it("resolves a real commit in a temporary repository and refuses a non-hash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phoenix-digest-"));
    try {
      await exec("git", ["init", "-q", dir]);
      await exec(
        "git",
        [
          "-C",
          dir,
          "-c",
          "user.name=Me",
          "-c",
          "user.email=me@example.invalid",
          "commit",
          "--allow-empty",
          "-qm",
          "Shipped local change",
        ],
        {
          env: {
            ...process.env,
            GIT_AUTHOR_DATE: "2026-10-21T12:00:00Z",
            GIT_COMMITTER_DATE: "2026-10-21T12:00:00Z",
          },
        },
      );
      const head = (await exec("git", ["-C", dir, "rev-parse", "HEAD"])).stdout.trim();
      const svc = service({ repositories: () => [dir] });
      expect(await svc.commit(head)).toMatchObject({ sha: head, title: "Shipped local change" });
      expect(await svc.commit("not-a-sha")).toBeNull();
      expect(await svc.commit("c".repeat(40))).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
