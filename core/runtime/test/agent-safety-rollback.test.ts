// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Agent safety net (Phase 77): checkpoints and rollback against REAL git in fresh temp
// repositories created inside each test (never the Phoenix checkout). The "agent" is a script that
// edits files and reports steps over the real event bus; no real agent, model or service is used.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "@phoenix/event-bus";
import { silentLogger } from "@phoenix/logging";
import type { NotificationPreferences } from "@phoenix/notifications";
import type { AuthorizedAction } from "@phoenix/permissions";
import { openDatabase, SettingsStore, type Database } from "@phoenix/persistence";
import { createEvent, ErrorCode, PhoenixError, type PhoenixEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentSafety,
  CHECKPOINT_REF_PREFIX,
  deleteCheckpointRef,
  planRollback,
  safetyGit,
  type SafetyGit,
} from "../src/agent-safety";

const T0 = Date.parse("2026-10-20T10:00:00Z");
const DAY = 86_400_000;
const SESSION = "5f1c1b0e-6a0e-4f43-8d7d-0a6a3f4b2c11";

const dirs: string[] = [];
const dbs: Database[] = [];
const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const db of dbs.splice(0)) db.close();
});

/** git in a temp repo with no user, system or global configuration leaking in. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    },
  });
}

function put(root: string, rel: string, text: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}
const read = (root: string, rel: string): string => readFileSync(join(root, rel), "utf8");

/** A repository with a committed history and the user's own uncommitted work. */
function repo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phoenix-safety-")));
  dirs.push(root);
  git(root, "init", "-q", "-b", "main");
  put(root, ".gitignore", "ignored.log\nbuild/\n");
  put(root, "a.txt", "a: committed\n");
  put(root, "b.txt", "b: committed\n");
  put(root, "src/deep/c.txt", "c: committed\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "initial");
  git(root, "stash", "list");
  // The user's own work in progress at the moment the agent starts.
  put(root, "a.txt", "a: the user's edit\n");
  put(root, "u.txt", "u: the user's untracked file\n");
  put(root, "ignored.log", "ignored: the user's log\n");
  git(root, "add", "a.txt"); // staged on purpose: the user's index must survive untouched
  put(root, "a.txt", "a: the user's edit, then more\n");
  return root;
}

/** Everything of the user's that the safety net promises not to touch. */
function userState(root: string): Record<string, string> {
  return {
    head: git(root, "rev-parse", "HEAD"),
    branch: git(root, "symbolic-ref", "HEAD"),
    heads: git(
      root,
      "for-each-ref",
      "--format=%(refname) %(objectname)",
      "refs/heads",
      "refs/tags",
    ),
    stash: git(root, "stash", "list"),
    index: git(root, "ls-files", "-s"),
    indexFile: readFileSync(join(root, ".git", "index")).toString("base64"),
    headFile: read(root, ".git/HEAD"),
    config: read(root, ".git/config"),
  };
}

interface Rig {
  safety: AgentSafety;
  bus: EventBus;
  db: Database;
  clock: { now: number };
  events: PhoenixEvent[];
  authorized: { command: string; sideEffect: string; summary: string; details: unknown }[];
  outcomes: string[];
  hooks: { beforeAuthorize?: () => void; deny?: boolean; kill?: boolean };
  prefs: NotificationPreferences;
  step(over: Record<string, unknown>, project: string): Promise<void>;
}

function rig(options: { maxCheckpoints?: number } = {}): Rig {
  const db = openDatabase(":memory:");
  dbs.push(db);
  const bus = new EventBus();
  const clock = { now: T0 };
  const events: PhoenixEvent[] = [];
  bus.subscribe("test", "agent.safety.*", (e) => {
    events.push(e);
  });
  const hooks: Rig["hooks"] = {};
  const authorized: Rig["authorized"] = [];
  const outcomes: string[] = [];
  const prefs: NotificationPreferences = {
    enabled: true,
    min_severity: "warning",
    muted_sources: [],
  };
  const safety = new AgentSafety({
    db,
    settings: new SettingsStore(db),
    bus,
    logger: silentLogger,
    now: () => clock.now,
    excludesFile: null,
    ...(options.maxCheckpoints === undefined ? {} : { maxCheckpoints: options.maxCheckpoints }),
    permissions: {
      isKillSwitchEngaged: () => hooks.kill === true,
      authorize: async (request): Promise<AuthorizedAction> => {
        authorized.push({
          command: request.command,
          sideEffect: request.sideEffect,
          summary: request.summary,
          details: request.details,
        });
        hooks.beforeAuthorize?.();
        if (hooks.deny) throw new PhoenixError(ErrorCode.PERMISSION_DENIED, "Rejected by user");
        return { id: "act_1", request, authorizedAt: "t" };
      },
      recordOutcome: (_action, outcome) => void outcomes.push(outcome),
    },
    notifications: {
      preferences: () => ({ ...prefs }),
      setPreferences: (input) => {
        Object.assign(prefs, input);
        return { ...prefs };
      },
    },
    state: { addRules: () => {} },
  });
  closers.push(() => safety.close());
  let n = 0;
  return {
    safety,
    bus,
    db,
    clock,
    events,
    authorized,
    outcomes,
    hooks,
    prefs,
    step: async (over, project) => {
      bus.publish(
        createEvent({
          event_type: "agent.session.step",
          source: "core",
          severity: "info",
          payload: {
            agent: "claude-code",
            session_id: SESSION,
            project,
            n: ++n,
            kind: "edit",
            tool: "Edit",
            target: "a.txt",
            at: new Date(clock.now).toISOString(),
            ...over,
          },
        }),
        { ephemeral: true },
      );
      await bus.drain();
    },
  };
}

/** The agent's work after its checkpoint. */
function agentWork(root: string): void {
  put(root, "a.txt", "a: the AGENT's rewrite\n");
  rmSync(join(root, "b.txt"));
  put(root, "new.txt", "new: made by the agent\n");
  put(root, "src/deep/new2.txt", "new2: made by the agent\n");
  put(root, "u.txt", "u: the agent changed the user's untracked file\n");
  put(root, "build/out.js", "ignored build output\n");
  put(root, "ignored.log", "ignored: changed by the agent\n");
}

describe("checkpoint", () => {
  it("snapshots tracked changes and untracked files, skips ignored ones, and leaves the user's git state alone", async () => {
    const root = repo();
    const before = userState(root);
    const status = git(root, "status", "--porcelain");
    const r = rig();
    await r.step({}, root);

    const rows = r.safety.store.list();
    expect(rows).toHaveLength(1);
    const cp = rows[0]!;
    expect(cp.ref).toBe(`${CHECKPOINT_REF_PREFIX}${cp.id}`);
    expect(cp.project).toBe(root);
    expect(cp.headId).toBe(before.head!.trim());
    expect(cp.expiresAt).toBe(new Date(T0 + 7 * DAY).toISOString());

    const files = git(root, "ls-tree", "-r", "--name-only", cp.commitId).split("\n");
    expect(files).toEqual(
      expect.arrayContaining([".gitignore", "a.txt", "b.txt", "src/deep/c.txt", "u.txt"]),
    );
    // Ignored files are never snapshotted.
    expect(files).not.toContain("ignored.log");
    expect(git(root, "show", `${cp.commitId}:a.txt`)).toBe("a: the user's edit, then more\n");
    expect(git(root, "show", `${cp.commitId}:u.txt`)).toBe("u: the user's untracked file\n");

    // The user's branches, HEAD, index (staged state), stash and work tree are untouched.
    expect(userState(root)).toEqual(before);
    expect(git(root, "status", "--porcelain")).toBe(status);
    expect(read(root, "a.txt")).toBe("a: the user's edit, then more\n");
    // The only new ref is the checkpoint's.
    expect(git(root, "for-each-ref", "--format=%(refname)", "refs/phoenix").trim()).toBe(cp.ref);
  });

  it("is taken once, at the first edit of a session, not by reads or later edits", async () => {
    const root = repo();
    const r = rig();
    await r.step({ kind: "read", tool: "Read" }, root);
    await r.step({ kind: "run", tool: "Bash", target: "ls" }, root);
    expect(r.safety.store.count()).toBe(0);
    await r.step({}, root);
    put(root, "a.txt", "changed\n");
    await r.step({}, root);
    r.clock.now += 61_000; // the one-per-minute gap per project
    await r.step({ session_id: "another-session" }, root);
    expect(
      r.safety.store
        .list()
        .map((c) => c.sessionId)
        .sort(),
    ).toEqual([SESSION, "another-session"].sort());
  });

  it("takes none for a folder that is not a git repository, and says so", async () => {
    const plain = realpathSync(mkdtempSync(join(tmpdir(), "phoenix-safety-plain-")));
    dirs.push(plain);
    put(plain, "x.txt", "x\n");
    const r = rig();
    await r.step({}, plain);
    expect(r.safety.store.count()).toBe(0);
    expect((await r.safety.status()).skipped).toEqual([
      expect.objectContaining({ session_id: SESSION, reason: "not_git" }),
    ]);
    expect(existsSync(join(plain, ".git"))).toBe(false);
  });

  it("skips and reports a tree over the file limit; nothing is written", async () => {
    const root = repo();
    const r = rig();
    // 100 files is the smallest limit the setting accepts; the repository holds more.
    r.safety.configure({ max_files: 100 });
    for (let i = 0; i < 101; i++) put(root, `many/f${i}.txt`, `${i}\n`);
    await r.step({}, root);
    expect(r.safety.store.count()).toBe(0);
    expect((await r.safety.status()).skipped[0]).toMatchObject({ reason: "too_many_files" });
    expect(git(root, "for-each-ref", "refs/phoenix").trim()).toBe("");
  });

  it("takes none while the kill switch is engaged or the net is switched off", async () => {
    const root = repo();
    const r = rig();
    r.hooks.kill = true;
    await r.step({}, root);
    r.hooks.kill = false;
    r.safety.configure({ enabled: false });
    await r.step({ session_id: "second" }, root);
    expect(r.safety.store.count()).toBe(0);
    expect((await r.safety.status()).skipped.map((s) => s.reason)).toEqual([
      "disabled",
      "kill_switch",
    ]);
  });
});

describe("checkpoint volume", () => {
  const refs = (root: string) =>
    git(root, "for-each-ref", "--format=%(refname)", "refs/phoenix")
      .trim()
      .split("\n")
      .filter(Boolean);

  it("takes at most one checkpoint per project per minute; another project is not held back", async () => {
    const root = repo();
    const other = repo();
    const r = rig();
    await r.step({ session_id: "s1" }, root);
    await r.step({ session_id: "s2" }, root);
    await r.step({ session_id: "s3" }, root);
    expect(r.safety.store.count()).toBe(1);
    expect((await r.safety.status()).skipped[0]).toMatchObject({ reason: "throttled" });
    expect(refs(root)).toHaveLength(1);
    await r.step({ session_id: "s4" }, other);
    expect(r.safety.store.count()).toBe(2);
    r.clock.now += 60_000;
    await r.step({ session_id: "s5" }, root);
    expect(r.safety.store.count()).toBe(3);
  });

  it("keeps at most the configured number of checkpoints: the oldest row and ref go first", async () => {
    const root = repo();
    const r = rig({ maxCheckpoints: 2 });
    git(root, "branch", "keep-me");
    const ids: string[] = [];
    for (const session of ["s1", "s2", "s3", "s4"]) {
      await r.step({ session_id: session }, root);
      await r.safety.settled();
      r.clock.now += 61_000;
    }
    const left = r.safety.store.every();
    expect(left.map((c) => c.sessionId)).toEqual(["s3", "s4"]);
    ids.push(...left.map((c) => c.id));
    expect(refs(root).sort()).toEqual(ids.map((id) => `${CHECKPOINT_REF_PREFIX}${id}`).sort());
    expect(git(root, "for-each-ref", "--format=%(refname)", "refs/heads")).toContain("keep-me");
  });
});

describe("rollback", () => {
  async function setup() {
    const root = repo();
    const r = rig();
    await r.step({}, root);
    const cp = r.safety.store.list()[0]!;
    agentWork(root);
    return { root, r, cp };
  }

  it("previews, then restores modified and deleted files and removes only the new files it listed", async () => {
    const { root, r, cp } = await setup();
    const before = userState(root);

    const preview = await r.safety.preview(cp.id);
    expect(preview.refusal).toBeNull();
    expect(preview.restore).toEqual([
      { path: "a.txt", change: "modified" },
      { path: "b.txt", change: "deleted" },
      { path: "u.txt", change: "modified" },
    ]);
    expect(preview.remove).toEqual(["new.txt", "src/deep/new2.txt"]);
    expect(preview.counts).toEqual({ restore: 3, remove: 2, kept: 0 });
    expect(preview.diff).toContain("the AGENT's rewrite");
    // Ignored files are not part of the preview at all.
    expect(JSON.stringify(preview)).not.toContain("ignored.log");
    expect(JSON.stringify(preview)).not.toContain("out.js");
    // Previewing changes nothing.
    expect(read(root, "a.txt")).toBe("a: the AGENT's rewrite\n");

    const done = await r.safety.rollback(cp.id, { preview_hash: preview.preview_hash });
    expect(done).toMatchObject({ restored: 3, removed: 2, exact: true });

    expect(read(root, "a.txt")).toBe("a: the user's edit, then more\n");
    expect(read(root, "b.txt")).toBe("b: committed\n");
    expect(read(root, "u.txt")).toBe("u: the user's untracked file\n");
    expect(existsSync(join(root, "new.txt"))).toBe(false);
    expect(existsSync(join(root, "src/deep/new2.txt"))).toBe(false);
    // Files the checkpoint never saw because git ignores them are left exactly as they are.
    expect(read(root, "build/out.js")).toBe("ignored build output\n");
    expect(read(root, "ignored.log")).toBe("ignored: changed by the agent\n");

    // Branch, HEAD, stash, the user's index and .git/config are exactly as before.
    expect(userState(root)).toEqual(before);
    // It went through the permission gateway as an `execute` action naming the bound preview.
    expect(r.authorized).toEqual([
      expect.objectContaining({
        command: "checkpoint.rollback",
        sideEffect: "execute",
        details: { checkpoint: cp.id, preview_hash: preview.preview_hash },
      }),
    ]);
    expect(r.authorized[0]!.summary).toContain(preview.preview_hash!.slice(0, 12));
    expect(r.outcomes).toEqual(["succeeded"]);
    expect(r.safety.store.get(cp.id)!.rolledBackAt).not.toBeNull();
  });

  it("refuses when the tree changed after the preview, and changes nothing", async () => {
    const { root, r, cp } = await setup();
    const preview = await r.safety.preview(cp.id);
    put(root, "a.txt", "a: edited again after the preview\n");

    await expect(
      r.safety.rollback(cp.id, { preview_hash: preview.preview_hash }),
    ).rejects.toMatchObject({
      details: ["preview_stale"],
    });
    expect(r.authorized).toEqual([]); // the owner is not even asked about a stale preview
    expect(read(root, "a.txt")).toBe("a: edited again after the preview\n");
    expect(existsSync(join(root, "new.txt"))).toBe(true);
  });

  it("recomputes the plan after the approval: a change made while the owner decided is refused", async () => {
    const { root, r, cp } = await setup();
    const preview = await r.safety.preview(cp.id);
    r.hooks.beforeAuthorize = () => put(root, "late.txt", "arrived while the owner was deciding\n");

    await expect(
      r.safety.rollback(cp.id, { preview_hash: preview.preview_hash }),
    ).rejects.toMatchObject({
      details: ["preview_stale"],
    });
    expect(read(root, "a.txt")).toBe("a: the AGENT's rewrite\n");
    expect(existsSync(join(root, "new.txt"))).toBe(true);
    expect(existsSync(join(root, "b.txt"))).toBe(false);
    expect(r.outcomes).toEqual(["failed"]);
  });

  it("refuses when HEAD moved since the checkpoint (the agent committed) and offers nothing", async () => {
    const { root, r, cp } = await setup();
    const preview = await r.safety.preview(cp.id);
    git(root, "add", "-A");
    git(root, "commit", "-qm", "the agent committed");
    const head = git(root, "rev-parse", "HEAD");

    const after = await r.safety.preview(cp.id);
    expect(after).toMatchObject({
      refusal: "head_moved",
      preview_hash: null,
      restore: [],
      remove: [],
    });
    await expect(
      r.safety.rollback(cp.id, { preview_hash: preview.preview_hash }),
    ).rejects.toMatchObject({
      details: ["head_moved"],
    });
    expect(r.authorized).toEqual([]);
    expect(read(root, "a.txt")).toBe("a: the AGENT's rewrite\n");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
  });

  it("keeps a new file that HEAD tracks and never touches ignored files", async () => {
    const root = repo();
    git(root, "rm", "-q", "--cached", "b.txt"); // staged deletion; the work-tree file stays
    rmSync(join(root, "b.txt")); // the user deleted b.txt before the agent started
    const r = rig();
    await r.step({}, root);
    const cp = r.safety.store.list()[0]!;
    put(root, "b.txt", "b: the agent re-created a file HEAD tracks\n");
    put(root, "fresh.txt", "fresh\n");
    put(root, "ignored.log", "x\n");

    const preview = await r.safety.preview(cp.id);
    expect(preview.remove).toEqual(["fresh.txt"]);
    expect(preview.kept).toEqual([{ path: "b.txt", why: "tracked_by_head" }]);

    await r.safety.rollback(cp.id, { preview_hash: preview.preview_hash });
    expect(read(root, "b.txt")).toBe("b: the agent re-created a file HEAD tracks\n");
    expect(existsSync(join(root, "fresh.txt"))).toBe(false);
    expect(read(root, "ignored.log")).toBe("x\n");
  });

  it("never lists an ignored file for deletion, even if the snapshot step were to pick one up", async () => {
    const { root, r, cp } = await setup();
    // A git whose `add -A` also takes ignored files: simulates the two ignore checks disagreeing.
    const forcing: SafetyGit = (dir, argv, options) =>
      safetyGit(
        dir,
        argv[argv.length - 2] === "add" && argv.at(-1) === "-A" ? [...argv, "-f"] : argv,
        options,
      );
    const planned = await planRollback({ git: forcing, excludes: null, tmpDir: tmpdir() }, cp);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.remove).toEqual(["new.txt", "src/deep/new2.txt"]);
    expect(planned.plan.kept).toEqual(
      expect.arrayContaining([
        { path: "build/out.js", why: "ignored" },
        { path: "ignored.log", why: "ignored" },
      ]),
    );
    expect(r.authorized).toEqual([]);
  });

  it("does not roll back when the owner declines, and never writes into .git", async () => {
    const { root, r, cp } = await setup();
    const preview = await r.safety.preview(cp.id);
    const gitFiles = git(root, "ls-files", "--others", "--ignored", "--exclude-standard");
    r.hooks.deny = true;
    await expect(
      r.safety.rollback(cp.id, { preview_hash: preview.preview_hash }),
    ).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
    });
    expect(read(root, "a.txt")).toBe("a: the AGENT's rewrite\n");
    expect(r.safety.store.get(cp.id)!.rolledBackAt).toBeNull();
    expect(git(root, "ls-files", "--others", "--ignored", "--exclude-standard")).toBe(gitFiles);
  });

  it("rejects a malformed or missing preview hash and an unknown checkpoint", async () => {
    const { r, cp } = await setup();
    for (const body of [
      {},
      { preview_hash: "nope" },
      { preview_hash: 5 },
      { preview_hash: "a".repeat(64), x: 1 },
    ]) {
      await expect(r.safety.rollback(cp.id, body)).rejects.toMatchObject({
        code: ErrorCode.INVALID_REQUEST,
      });
    }
    await expect(
      r.safety.rollback("cp_0000000000000000", { preview_hash: "a".repeat(64) }),
    ).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
    });
    await expect(r.safety.preview("../../etc")).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
    });
  });

  it("restores a file replaced by a symlink to outside the project without following it", async () => {
    const root = repo();
    const r = rig();
    await r.step({}, root);
    const cp = r.safety.store.list()[0]!;
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "phoenix-safety-outside-")));
    dirs.push(outside);
    writeFileSync(join(outside, "victim.txt"), "outside\n");
    rmSync(join(root, "src"), { recursive: true });
    execFileSync("ln", ["-s", outside, join(root, "src")]);
    const preview = await r.safety.preview(cp.id);
    // Anything under the symlinked directory is kept out of the plan.
    expect(preview.restore.map((x) => x.path)).not.toContain("src/deep/c.txt");
    await r.safety.rollback(cp.id, { preview_hash: preview.preview_hash }).catch(() => undefined);
    expect(readFileSync(join(outside, "victim.txt"), "utf8")).toBe("outside\n");
    expect(readFileSync(join(outside, "victim.txt"), "utf8")).toBe("outside\n");
  });
});

describe("hidden characters in what the owner reads (F12)", () => {
  const RLO = String.fromCharCode(0x202e);

  it("a bidi override in a changed file's name is shown as ?", async () => {
    const root = repo();
    const r = rig();
    await r.step({}, root);
    put(root, `evil${RLO}gpj.js`, "x\n");
    put(root, "a.txt", "changed\n");
    const checkpoint = r.safety.store.list()[0]!;
    const preview = await r.safety.preview(checkpoint.id);
    const shown = [
      ...preview.restore.map((x) => x.path),
      ...preview.remove,
      ...preview.kept.map((k) => k.path),
    ];
    expect(shown.some((p) => p.startsWith("evil"))).toBe(true);
    for (const p of shown) expect(p).not.toContain(RLO);
    expect(shown).toContain("evil?gpj.js");
  });

  it("a bidi override in the project folder's name is not in the confirmation summary or the views", async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "phoenix-safety-")));
    dirs.push(base);
    const root = join(base, `proj${RLO}gnp`);
    mkdirSync(root);
    git(root, "init", "-q", "-b", "main");
    put(root, "a.txt", "a\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "i");
    const r = rig();
    await r.step({}, root);
    put(root, "a.txt", "agent\n");
    const checkpoint = r.safety.store.list()[0]!;
    const preview = await r.safety.preview(checkpoint.id);
    expect(preview.checkpoint.repository).toBe("proj?gnp");
    await r.safety.rollback(checkpoint.id, { preview_hash: preview.preview_hash });
    expect(r.authorized[0]!.summary).toContain("proj?gnp");
    expect(r.authorized[0]!.summary).not.toContain(RLO);
  });
});

describe("retention and deletion", () => {
  it("prunes expired checkpoints (ref and row) and keeps the rest", async () => {
    const root = repo();
    const r = rig();
    await r.step({}, root);
    r.clock.now = T0 + 3 * DAY;
    await r.step({ session_id: "later" }, root);
    expect(r.safety.store.count()).toBe(2);

    r.clock.now = T0 + 8 * DAY; // the first expired at day 7, the second at day 10
    await r.safety.maintain();
    expect(r.safety.store.list().map((c) => c.sessionId)).toEqual(["later"]);
    expect(
      git(root, "for-each-ref", "--format=%(refname)", "refs/phoenix").trim().split("\n"),
    ).toHaveLength(1);
  });

  it("only ever deletes refs under refs/phoenix/checkpoints/, whatever a stored row says", async () => {
    const root = repo();
    const r = rig();
    git(root, "branch", "keep-me");
    git(root, "tag", "keep-tag");
    const head = git(root, "rev-parse", "HEAD").trim();
    const old = new Date(T0 - DAY).toISOString();
    // Rows as a tampered database could hold them: the stored ref points at the user's own refs.
    for (const [i, ref] of [
      "refs/heads/keep-me",
      "refs/heads/main",
      "refs/tags/keep-tag",
      "refs/stash",
      "refs/phoenix/checkpoints/../../heads/main",
    ].entries()) {
      r.safety.store.insert({
        id: `cp_${String(i).padStart(16, "0")}`,
        sessionId: `s${i}`,
        agent: "claude-code",
        project: root,
        ref,
        commitId: head,
        headId: head,
        fileCount: 1,
        createdAt: old,
        expiresAt: old,
        rolledBackAt: null,
      });
    }
    await r.safety.maintain();
    expect(
      git(root, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags")
        .trim()
        .split("\n"),
    ).toEqual(["refs/heads/keep-me", "refs/heads/main", "refs/tags/keep-tag"]);
    expect(r.safety.store.count()).toBe(0); // the rows are expired and go; the refs never did
  });

  it("the ref deleter itself refuses anything outside refs/phoenix/checkpoints/cp_<16 hex>", async () => {
    const root = repo();
    git(root, "branch", "keep-me");
    git(root, "tag", "keep-tag");
    put(root, "stash-me.txt", "x\n");
    git(root, "add", "stash-me.txt");
    git(root, "stash", "push", "-q");
    const head = git(root, "rev-parse", "HEAD").trim();
    git(root, "update-ref", "refs/phoenix/checkpoints/other", head); // right prefix, not one of ours
    const refs = () => git(root, "for-each-ref", "--format=%(refname)").trim().split("\n");
    const before = refs();
    for (const ref of [
      "refs/heads/keep-me",
      "refs/heads/main",
      "refs/tags/keep-tag",
      "refs/stash",
      "refs/phoenix/checkpoints/other",
      "refs/phoenix/checkpoints/cp_0123456789abcdef/extra",
      "refs/phoenix/checkpoints/../../heads/main",
      "HEAD",
    ])
      expect(await deleteCheckpointRef(safetyGit, root, ref)).toBe(false);
    expect(refs()).toEqual(before);
    git(root, "update-ref", "refs/phoenix/checkpoints/cp_0123456789abcdef", head);
    expect(
      await deleteCheckpointRef(safetyGit, root, "refs/phoenix/checkpoints/cp_0123456789abcdef"),
    ).toBe(true);
    expect(refs()).toEqual(before);
  });

  it("delete-all removes the records and the refs it created, and nothing else", async () => {
    const root = repo();
    const r = rig();
    git(root, "branch", "keep-me");
    await r.step({}, root);
    r.clock.now += 61_000;
    await r.step({ session_id: "two" }, root);
    expect(git(root, "for-each-ref", "refs/phoenix").trim().split("\n")).toHaveLength(2);

    expect(r.safety.deleteAll()).toEqual({ deleted: 2 });
    await r.safety.settled();
    expect(r.safety.store.count()).toBe(0);
    expect(git(root, "for-each-ref", "refs/phoenix").trim()).toBe("");
    expect(
      git(root, "for-each-ref", "--format=%(refname)", "refs/heads").trim().split("\n"),
    ).toEqual(["refs/heads/keep-me", "refs/heads/main"]);
  });
});
