// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Correlating sessions with commits, CI runs and pull requests (migration 15). A link says "this
// happened during the session"; it never says "the agent wrote it". Wrong links are worse than
// missing ones, so every negative rule has a test.
import { createEvent, type PhoenixEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LINK_WINDOW_AFTER_MS, type LinkView } from "../src/links";
import type { SessionView } from "../src/sessions";
import { cleanTempDirs, orchestrated, workspaceIn, type Orchestrated } from "./rig";

let o: Orchestrated | undefined;
afterEach(async () => {
  if (o) {
    await o.h.manager.disable("agents");
    await o.h.close();
  }
  o = undefined;
  cleanTempDirs();
});

const SHA = "a".repeat(40);
const SHA2 = "b".repeat(40);

async function ready(over: Parameters<typeof orchestrated>[0] = {}) {
  o = await orchestrated(over);
  return o;
}

async function begin(c: Orchestrated, workspace = c.workspace, prompt = "FAKE:hang\nwork") {
  const op = await c.run("session.start", { launcher: "fake", workspace, prompt });
  expect(op.error).toBeUndefined();
  return op.result as SessionView;
}

interface Detail {
  session: SessionView | null;
  links: LinkView[];
  ambiguous: LinkView[];
  timeline: { kind: string; at: string }[];
}
const detail = async (c: Orchestrated, id: string) =>
  (await c.run("session.get", { session_id: id })).result as Detail;
const links = async (c: Orchestrated, id: string) => (await detail(c, id)).links;

function publish(c: Orchestrated, event: Parameters<typeof createEvent>[0]): PhoenixEvent {
  const full = createEvent(event);
  c.h.bus.publish(full);
  return full;
}

const commit = (path: string, sha = SHA, extra: { source?: string; timestamp?: string } = {}) => ({
  event_type: "git.commit.created",
  source: extra.source ?? "git",
  severity: "info" as const,
  subject: "project",
  ...(extra.timestamp ? { timestamp: extra.timestamp } : {}),
  payload: { repository: "project", path, sha, branch: "feature/x" },
});

const ci = (sha: string, over: Record<string, unknown> = {}, type = "github.ci.failed") => ({
  event_type: type,
  source: "github",
  severity: "error" as const,
  payload: {
    repository: "me/project",
    run_id: 4242,
    workflow: "CI",
    commit: sha.slice(0, 7),
    branch: "feature/x",
    conclusion: "failure",
    url: "https://github.com/me/project/actions/runs/4242",
    ...over,
  },
});

/** The subscriber returns the correlator's promise, so draining the bus waits for the lookup too. */
async function settle(c: Orchestrated): Promise<void> {
  await c.h.drain();
}

describe("commit ↔ session", () => {
  it("links a commit made in the workspace while the session is active, and records why", async () => {
    const c = await ready();
    const s = await begin(c);
    c.commitTimes[SHA] = Date.now();
    publish(c, commit(c.workspace));
    await vi.waitFor(async () => expect(await links(c, s.id)).toHaveLength(1));
    const [link] = await links(c, s.id);
    expect(link).toMatchObject({
      kind: "commit",
      ref: SHA,
      repo: "project",
      confidence: "time+path",
      session_id: s.id,
      detail: { branch: "feature/x" },
    });
    expect(link!.why).toMatchObject({
      rule: "time+path",
      repository_path: c.workspace,
      workspace: c.workspace,
      path_relation: "repository is the workspace",
    });
    expect(String(link!.why.meaning)).toContain("does not say the agent wrote it");
    expect((await detail(c, s.id)).timeline.map((t) => t.kind)).toEqual(
      expect.arrayContaining(["session.started", "link.commit"]),
    );
  });

  it("links a commit of a repository INSIDE the workspace, not one that merely shares a name prefix", async () => {
    const c = await ready();
    const s = await begin(c);
    c.commitTimes[SHA] = Date.now();
    c.commitTimes[SHA2] = Date.now();
    publish(c, commit(`${c.workspace}/packages/api`, SHA));
    publish(c, commit(`${c.workspace}-evil`, SHA2));
    await vi.waitFor(async () => expect(await links(c, s.id)).toHaveLength(1));
    await settle(c);
    const found = await links(c, s.id);
    expect(found.map((l) => l.ref)).toEqual([SHA]);
    expect(found[0]!.why.path_relation).toBe("repository is inside the workspace");
  });

  it("never links a commit DETECTED before the session existed, even when its own timestamp falls inside the session (clock skew, hostile git)", async () => {
    const c = await ready();
    const s = await begin(c, c.workspace, "FAKE:echo\nquick");
    await vi.waitFor(async () => expect((await detail(c, s.id)).session?.state).toBe("completed"));
    const started = Date.parse(s.started_at);
    c.commitTimes[SHA] = started + 5; // inside the session…
    publish(c, commit(c.workspace, SHA, { timestamp: new Date(started - 60_000).toISOString() })); // …but detected "before" it
    await settle(c);
    expect(await links(c, s.id)).toEqual([]);
  });

  it("never links a commit older than the session start (later cannot cause earlier)", async () => {
    const c = await ready();
    const s = await begin(c);
    c.commitTimes[SHA] = Date.parse(s.started_at) - 60_000;
    publish(c, commit(c.workspace));
    await settle(c);
    expect(await links(c, s.id)).toEqual([]);
    expect((await detail(c, s.id)).ambiguous).toEqual([]);
  });

  it("links nothing for a repository in another workspace", async () => {
    const c = await ready();
    const s = await begin(c);
    const other = workspaceIn();
    c.commitTimes[SHA] = Date.now();
    publish(c, commit(other.workspace));
    await settle(c);
    expect(await links(c, s.id)).toEqual([]);
  });

  it("links to NEITHER session when two active sessions share the workspace, and records the ambiguity", async () => {
    const c = await ready();
    const a = await begin(c);
    const b = await begin(c);
    c.commitTimes[SHA] = Date.now();
    publish(c, commit(c.workspace));
    await vi.waitFor(async () => expect((await detail(c, a.id)).ambiguous).toHaveLength(1));
    expect(await links(c, a.id)).toEqual([]);
    expect(await links(c, b.id)).toEqual([]);
    const [open] = (await detail(c, b.id)).ambiguous;
    expect(open).toMatchObject({
      kind: "commit",
      ref: SHA,
      confidence: "ambiguous",
      session_id: null,
      candidates: [a.id, b.id].sort(),
    });
    expect(open!.why).toMatchObject({ reason: "more than one session qualified" });
    const listed = (await c.run("session.list")).result as { ambiguous_links: LinkView[] };
    expect(listed.ambiguous_links).toHaveLength(1);
  });

  it("an ambiguity is recorded once even if the event is delivered twice, and the user can resolve it", async () => {
    const c = await ready();
    const a = await begin(c);
    const b = await begin(c);
    c.commitTimes[SHA] = Date.now();
    const event = commit(c.workspace);
    publish(c, event);
    c.h.bus.publish(createEvent({ ...event, event_id: "evt_second_delivery_of_same_commit" }));
    await vi.waitFor(async () => expect((await detail(c, a.id)).ambiguous).toHaveLength(1));
    await settle(c);
    expect((await detail(c, a.id)).ambiguous).toHaveLength(1);

    const open = (await detail(c, a.id)).ambiguous[0]!;
    const outsider = await c.run("link.resolve", {
      link_id: open.id,
      session_id: "ph-ffffffffffffffff",
    });
    expect(outsider.error?.message).toMatch(/not one of the candidates/);
    const resolved = await c.run("link.resolve", { link_id: open.id, session_id: b.id });
    expect(resolved.result).toMatchObject({ session_id: b.id, confidence: "user", ref: SHA });
    expect((await links(c, b.id)).map((l) => l.ref)).toEqual([SHA]);
    expect((await detail(c, a.id)).ambiguous).toEqual([]);
    const again = await c.run("link.resolve", { link_id: open.id, session_id: b.id });
    expect(again.error?.message).toMatch(/not an open ambiguity/);
    expect(c.audit.map((e) => e.action)).toContain("agent.link.resolved");
  });

  it("a second session in a different workspace does not make the first ambiguous", async () => {
    const c = await ready();
    const a = await begin(c);
    const other = workspaceIn();
    c.h.manager.configure("agents", {
      launchers: { fake: { ...(c.launchers.fake as object), cwd_roots: [c.root, other.root] } },
      grace_ms: 150,
    });
    await c.h.manager.disable("agents");
    await c.h.enable("agents");
    const first = await begin(c);
    const second = await begin(c, other.workspace);
    c.commitTimes[SHA] = Date.now();
    publish(c, commit(c.workspace));
    await vi.waitFor(async () => expect(await links(c, first.id)).toHaveLength(1));
    expect(await links(c, second.id)).toEqual([]);
    expect(a.id).not.toBe(first.id);
  });

  it("links a commit that appears shortly after the session finished, but not one long after", async () => {
    const c = await ready();
    const s = await begin(c, c.workspace, "FAKE:echo\nquick");
    await vi.waitFor(async () => expect((await detail(c, s.id)).session?.state).toBe("completed"));
    const ended = Date.parse((await detail(c, s.id)).session!.ended_at!);

    c.commitTimes[SHA] = ended;
    publish(c, commit(c.workspace, SHA, { timestamp: new Date(ended + 1_000).toISOString() }));
    await vi.waitFor(async () => expect(await links(c, s.id)).toHaveLength(1));

    c.commitTimes[SHA2] = ended;
    publish(
      c,
      commit(c.workspace, SHA2, {
        timestamp: new Date(ended + LINK_WINDOW_AFTER_MS + 5_000).toISOString(),
      }),
    );
    await settle(c);
    expect((await links(c, s.id)).map((l) => l.ref)).toEqual([SHA]);
  });

  it("does not link a commit whose own time is after the session ended, even if detected inside the window", async () => {
    const c = await ready();
    const s = await begin(c, c.workspace, "FAKE:echo\nquick");
    await vi.waitFor(async () => expect((await detail(c, s.id)).session?.state).toBe("completed"));
    const ended = Date.parse((await detail(c, s.id)).session!.ended_at!);
    c.commitTimes[SHA] = ended + 30_000;
    publish(c, commit(c.workspace, SHA, { timestamp: new Date(ended + 31_000).toISOString() }));
    await settle(c);
    expect(await links(c, s.id)).toEqual([]);
  });

  it("is idempotent: the same commit delivered twice is one link", async () => {
    const c = await ready();
    const s = await begin(c);
    c.commitTimes[SHA] = Date.now();
    publish(c, commit(c.workspace));
    await vi.waitFor(async () => expect(await links(c, s.id)).toHaveLength(1));
    publish(c, commit(c.workspace));
    await settle(c);
    expect(await links(c, s.id)).toHaveLength(1);
    expect(c.audit.filter((a) => a.action === "agent.link.created")).toHaveLength(1);
  });

  it("ignores a commit whose time cannot be established, and malformed commit events", async () => {
    const c = await ready();
    const s = await begin(c);
    publish(c, commit(c.workspace, SHA)); // no entry in commitTimes
    publish(c, {
      ...commit(c.workspace),
      payload: { repository: "p", path: c.workspace, sha: "zz" },
    });
    publish(c, {
      ...commit(c.workspace),
      payload: { repository: "p", path: "relative/path", sha: SHA2 },
    });
    publish(c, { ...commit(c.workspace), payload: { repository: "p", sha: SHA2 } });
    await settle(c);
    expect(await links(c, s.id)).toEqual([]);
  });

  it("only trusts events whose source is the git capability", async () => {
    const c = await ready();
    const s = await begin(c);
    c.commitTimes[SHA] = Date.now();
    publish(c, commit(c.workspace, SHA, { source: "terminal" }));
    await settle(c);
    expect(await links(c, s.id)).toEqual([]);
  });

  it("never links the commit of a session that is no longer running to a later, unrelated session", async () => {
    const c = await ready();
    const first = await begin(c, c.workspace, "FAKE:echo\nquick");
    await vi.waitFor(async () =>
      expect((await detail(c, first.id)).session?.state).toBe("completed"),
    );
    const second = await begin(c);
    // A commit made before the second session began (inside the first one's window).
    c.commitTimes[SHA] = Date.parse(second.started_at) - 10_000;
    publish(c, commit(c.workspace));
    await settle(c);
    expect(await links(c, second.id)).toEqual([]);
  });
});

describe("CI runs and pull requests", () => {
  async function linkedCommit(c: Orchestrated) {
    const s = await begin(c);
    c.commitTimes[SHA] = Date.now();
    publish(c, commit(c.workspace));
    await vi.waitFor(async () => expect(await links(c, s.id)).toHaveLength(1));
    return s;
  }

  it("links a CI run whose head commit is a linked commit (sha-match) and keeps the latest conclusion", async () => {
    const c = await ready();
    const s = await linkedCommit(c);
    publish(c, ci(SHA, { conclusion: undefined }, "github.ci.started"));
    await vi.waitFor(async () => expect(await links(c, s.id)).toHaveLength(2));
    publish(c, ci(SHA));
    await vi.waitFor(async () => {
      const run = (await links(c, s.id)).find((l) => l.kind === "ci_run");
      expect(run?.detail).toMatchObject({ event_type: "github.ci.failed", conclusion: "failure" });
    });
    const run = (await links(c, s.id)).find((l) => l.kind === "ci_run")!;
    expect(run).toMatchObject({ ref: "4242", repo: "me/project", confidence: "sha-match" });
    expect(run.why).toMatchObject({ rule: "sha-match", commit: SHA });
    expect(run.detail?.url).toBe("https://github.com/me/project/actions/runs/4242");
    expect((await links(c, s.id)).filter((l) => l.kind === "ci_run")).toHaveLength(1);
  });

  it("does not link a CI run of a commit that no session owns, or another repository's run with the same prefix", async () => {
    const c = await ready();
    const s = await linkedCommit(c);
    publish(c, ci(SHA2));
    publish(c, ci(SHA, { repository: "me/other", run_id: 7 }));
    await settle(c);
    expect((await links(c, s.id)).map((l) => l.kind)).toEqual(["commit"]);
  });

  it("ignores CI events with a hostile payload", async () => {
    const c = await ready();
    const s = await linkedCommit(c);
    publish(c, ci(SHA, { run_id: "4242; DROP TABLE agent_links" }));
    publish(c, ci(SHA, { commit: "../../etc" }));
    publish(c, ci(SHA, { repository: "x".repeat(500) }));
    publish(c, ci(SHA, { url: "javascript:alert(1)", run_id: 99 }));
    await settle(c);
    const runs = (await links(c, s.id)).filter((l) => l.kind === "ci_run");
    expect(runs.map((r) => r.ref)).toEqual(["99"]);
    expect(runs[0]!.detail).not.toHaveProperty("url");
  });

  it("only trusts CI events whose source is github", async () => {
    const c = await ready();
    const s = await linkedCommit(c);
    publish(c, { ...ci(SHA), source: "terminal" });
    await settle(c);
    expect((await links(c, s.id)).filter((l) => l.kind === "ci_run")).toEqual([]);
  });

  it("links a pull request through the branch of a linked commit (GitHub's PR events carry no sha)", async () => {
    const c = await ready();
    const s = await linkedCommit(c);
    publish(c, {
      event_type: "github.pr.opened",
      source: "github",
      severity: "info",
      payload: {
        repository: "me/project",
        number: 12,
        branch: "feature/x",
        base: "main",
        title: "t",
      },
    });
    publish(c, {
      event_type: "github.pr.opened",
      source: "github",
      severity: "info",
      payload: {
        repository: "me/project",
        number: 13,
        branch: "unrelated",
        base: "main",
        title: "t",
      },
    });
    await vi.waitFor(async () =>
      expect((await links(c, s.id)).some((l) => l.kind === "pr")).toBe(true),
    );
    await settle(c);
    const prs = (await links(c, s.id)).filter((l) => l.kind === "pr");
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ ref: "12", confidence: "branch-match" });
  });

  it("a CI run whose commit prefix matches commits of two sessions is ambiguous, not linked", async () => {
    const c = await ready();
    const other = workspaceIn();
    c.h.manager.configure("agents", {
      launchers: { fake: { ...(c.launchers.fake as object), cwd_roots: [c.root, other.root] } },
      grace_ms: 150,
    });
    await c.h.manager.disable("agents");
    await c.h.enable("agents");
    const a = await begin(c);
    const b = await begin(c, other.workspace);
    c.commitTimes[SHA] = Date.now();
    c.commitTimes[`${SHA.slice(0, 7)}${"c".repeat(33)}`] = Date.now();
    publish(c, commit(c.workspace, SHA));
    publish(c, commit(other.workspace, `${SHA.slice(0, 7)}${"c".repeat(33)}`));
    await vi.waitFor(async () => {
      expect(await links(c, a.id)).toHaveLength(1);
      expect(await links(c, b.id)).toHaveLength(1);
    });
    publish(c, ci(SHA));
    await vi.waitFor(async () => expect((await detail(c, a.id)).ambiguous).toHaveLength(1));
    expect((await links(c, a.id)).filter((l) => l.kind === "ci_run")).toEqual([]);
    expect((await links(c, b.id)).filter((l) => l.kind === "ci_run")).toEqual([]);
  });
});

describe("persistence", () => {
  it("links survive in the database after the session is gone from memory, and are removed with forgetSession", async () => {
    const c = await ready();
    const s = await begin(c);
    c.commitTimes[SHA] = Date.now();
    publish(c, commit(c.workspace));
    await vi.waitFor(async () => expect(await links(c, s.id)).toHaveLength(1));
    const rows = c.h.db
      .prepare("SELECT session_id, kind, ref, confidence, why FROM agent_links")
      .all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("FAKE:hang");
    await c.run("session.stop", { session_id: s.id });
    await c.h.manager.disable("agents");
    await c.h.enable("agents");
    // New capability instance: the session table is empty, the links are not.
    const gone = await c.run("session.get", { session_id: s.id });
    expect(gone.result).toMatchObject({
      session: null,
      links: [expect.objectContaining({ ref: SHA })],
    });
  });

  it("migration 15 refuses a link of an unknown kind or confidence", async () => {
    const c = await ready();
    const insert = (kind: string, confidence: string) =>
      c.h.db
        .prepare(
          "INSERT INTO agent_links (session_id, kind, ref, repo, confidence, source, why, created_at) VALUES ('s', ?, 'r', 'x', ?, 'e', '{}', 1)",
        )
        .run(kind, confidence);
    expect(() => insert("commit", "guess")).toThrow();
    expect(() => insert("file", "time+path")).toThrow();
    expect(() => insert("commit", "time+path")).not.toThrow();
    expect(() => insert("commit", "time+path")).toThrow(/UNIQUE/);
  });
});
