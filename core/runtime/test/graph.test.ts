// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 38 through the public HTTP API: events and commits become graph facts with provenance,
// questions answer with their explanation path, and EVERY way data can be deleted (event retention,
// delete-all, forgetting memory, deleting a meeting, turning sensitive meetings off, forgetting a
// person) takes the derived graph rows with it.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitCapability } from "@phoenix/capability-git";
import type { CapabilityModule } from "@phoenix/capability-manager";
import { createEvent } from "@phoenix/protocol";
import { MemorySecretStore, type Summary } from "@phoenix/persistence";
import type { Viewer } from "@phoenix/ai-memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeNetwork, type FakeNetwork } from "./ai-network";
import { startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

interface Core extends TestCore {
  network: FakeNetwork;
}

const fakeKage: CapabilityModule = {
  manifest: {
    id: "kage",
    name: "Kage (test double)",
    version: "0.0.1",
    description: "Test double for the meeting capability",
    license: "GPL-3.0-or-later",
    events: ["kage.*"],
    permissions: [],
    data_categories: [],
    commands: [],
  },
};

async function boot(network: FakeNetwork = fakeNetwork(), viewer?: Viewer): Promise<Core> {
  const core = await startCore(
    {},
    {
      capabilities: [fakeKage, createGitCapability()],
      secrets: new MemorySecretStore(),
      runtime: { fetch: network.fetch, ...(viewer ? { memoryViewer: viewer } : {}) },
    },
  );
  cleanups.push(() => core.runtime.stop());
  return { ...core, network };
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();

/** A throwaway repository with two commits by two authors, touching known paths. */
function repo(): { dir: string; shas: string[] } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "phoenix-graph-repo-")));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "-q", "-b", "main");
  mkdirSync(join(dir, "core"));
  const commit = (author: string, file: string, message: string) => {
    writeFileSync(join(dir, file), `${message}\n`);
    git(dir, "add", file);
    git(
      dir,
      "-c",
      `user.name=${author}`,
      "-c",
      `user.email=${author.toLowerCase()}@example.invalid`,
      "commit",
      "-q",
      "-m",
      message,
    );
    return git(dir, "rev-parse", "HEAD");
  };
  return {
    dir,
    shas: [
      commit("Ada Lovelace", "core/engine.ts", "add the engine"),
      commit("Linus Torvalds", "core/engine.ts", "fix the engine, closes #12"),
    ],
  };
}

async function watch(core: Core, dir: string) {
  const res = await core.api("POST", "/api/capabilities/git/config", {
    config: { repositories: [dir] },
  });
  expect(res.status).toBe(200);
}

function publishCommit(core: Core, dir: string, sha: string) {
  core.runtime.bus.publish(
    createEvent({
      event_type: "git.commit.created",
      source: "git",
      severity: "info",
      payload: { repository: "repo", path: dir, sha, branch: "main", message: "ignored here" },
    }),
  );
}

const status = async (core: Core) => (await core.api("GET", "/api/graph/status")).json;
const stats = (core: Core) => core.runtime.graph.graph.stats();
const enc = encodeURIComponent;

async function ingestCommits(core: Core, dir: string, shas: string[]) {
  await watch(core, dir);
  for (const sha of shas) publishCommit(core, dir, sha);
  await core.runtime.bus.drain();
  await core.runtime.graph.settled();
}

describe("commits become graph facts", () => {
  it("a live commit event is enriched from the repository: author name, files and mentions, all citing the event", async () => {
    const { dir, shas } = repo();
    const core = await boot();
    await ingestCommits(core, dir, shas);
    const st = await status(core);
    expect(st.commits_backfilled).toBe(2);
    expect(st.visible_nodes_by_type).toMatchObject({ Commit: 2, Person: 2, Document: 1 });

    const commit = (await core.api("GET", `/api/graph/nodes/${enc(`Commit:repo@${shas[1]}`)}`))
      .json;
    expect(commit.node).toMatchObject({ type: "Commit", status: "fact" });
    expect(commit.origin.length).toBeGreaterThan(0);
    expect(commit.origin.every((o: { source_kind: string }) => o.source_kind === "event")).toBe(
      true,
    );
    expect(commit.origin[0]).toMatchObject({ capability: "git", sensitivity: "internal" });
    // Author EMAIL addresses are never stored.
    expect(JSON.stringify(commit)).not.toContain("example.invalid");
    expect(commit.visible_edges).toBeGreaterThanOrEqual(4);
  });

  it("answers 'which commits touched <path>' with the explanation path for each", async () => {
    const { dir, shas } = repo();
    const core = await boot();
    await ingestCommits(core, dir, shas);
    const res = await core.api("POST", "/api/graph/ask", {
      question: "which commits touched core/engine.ts",
    });
    expect(res.status).toBe(200);
    const which = res.json.answers.find((a: { kind: string }) => a.kind === "which");
    const found = which.results.map((r: { node: { key: string } }) => r.node.key).sort();
    expect(found).toEqual(shas.map((s) => `repo@${s}`).sort());
    for (const r of which.results) {
      expect(r.path.text).toMatch(/TOUCHES|touch/i);
      expect(r.path.hops[0].edge.provenance[0]).toMatchObject({ source_kind: "event" });
    }
    expect(res.json.narration).toBeNull();
    expect(res.json.retrieval).toEqual({ mode: "lexical" });
  });

  it("who authored: names come from the repository, a person is an endpoint", async () => {
    const { dir, shas } = repo();
    const core = await boot();
    await ingestCommits(core, dir, shas);
    const res = await core.api("POST", "/api/graph/ask", {
      question: "who touched core/engine.ts",
    });
    const who = res.json.answers.find((a: { kind: string }) => a.kind === "who");
    expect(who.people.map((p: { person: { key: string } }) => p.person.key).sort()).toEqual([
      "ada lovelace",
      "linus torvalds",
    ]);
  });

  it("never reads a repository the git capability is not told to watch", async () => {
    const { dir, shas } = repo();
    const core = await boot();
    publishCommit(core, dir, shas[0]!);
    await core.runtime.bus.drain();
    await core.runtime.graph.settled();
    expect((await status(core)).commits_backfilled).toBe(0);
    expect((await status(core)).visible_nodes_by_type.Person).toBeUndefined();
    expect((await status(core)).visible_nodes_by_type.Commit).toBe(1); // the event alone
  });

  it("ignores an event that claims a family it does not belong to, and hostile payloads", async () => {
    const core = await boot();
    core.runtime.bus.publish(
      createEvent({
        event_type: "git.commit.created",
        source: "terminal",
        severity: "info",
        payload: { repository: "repo", sha: "d".repeat(40), path: "/tmp" },
      }),
    );
    for (const payload of [
      { repository: "repo", sha: "not-a-sha", path: "/etc" },
      { repository: 5, sha: "e".repeat(40) },
      { repository: "x".repeat(5000), sha: "f".repeat(40), path: "../../etc" },
    ]) {
      core.runtime.bus.publish(
        createEvent({ event_type: "git.commit.created", source: "git", severity: "info", payload }),
      );
    }
    await core.runtime.bus.drain();
    await core.runtime.graph.settled();
    expect((await status(core)).visible_nodes_by_type.Person).toBeUndefined();
    expect(stats(core).nodes).toBeLessThanOrEqual(2);
  });
});

describe("inspection", () => {
  it("neighbors are bounded by depth and say where they came from", async () => {
    const { dir, shas } = repo();
    const core = await boot();
    await ingestCommits(core, dir, shas);
    const id = enc(`Commit:repo@${shas[0]}`);
    const one = (await core.api("GET", `/api/graph/nodes/${id}/neighbors`)).json;
    const two = (await core.api("GET", `/api/graph/nodes/${id}/neighbors?depth=2`)).json;
    expect(one.center).toBe(`Commit:repo@${shas[0]}`);
    expect(two.nodes.length).toBeGreaterThan(one.nodes.length);
    expect(one.edges[0].provenance[0]).toMatchObject({ source_kind: "event" });
    for (const q of ["?depth=3", "?depth=0", "?depth=-1", "?depth=x"]) {
      expect((await core.api("GET", `/api/graph/nodes/${id}/neighbors${q}`)).status, q).toBe(400);
    }
    expect((await core.api("GET", "/api/graph/nodes/Commit%3Anope")).status).toBe(404);
    expect((await core.api("GET", `/api/graph/nodes/${"x".repeat(401)}`)).status).toBe(404);
    expect((await core.api("GET", "/api/graph/nodes/%zz")).status).toBe(400);
  });
});

describe("what the viewer may see", () => {
  it("a narrower viewer gets 404 for a node whose only sources it may not read, and a smaller status", async () => {
    const { dir, shas } = repo();
    const guest: Viewer = {
      id: "guest",
      grants: [{ scope: "repo:other", maxSensitivity: "internal" }],
    };
    const core = await boot(fakeNetwork(), guest);
    await ingestCommits(core, dir, shas);
    expect(stats(core).nodes).toBeGreaterThan(0);
    expect(
      (await core.api("GET", `/api/graph/nodes/${enc(`Commit:repo@${shas[0]}`)}`)).status,
    ).toBe(404);
    expect((await status(core)).visible_nodes_by_type).toEqual({});
    const ask = (
      await core.api("POST", "/api/graph/ask", { question: "who touched core/engine.ts" })
    ).json;
    expect(ask.seeds).toEqual([]);
    expect(JSON.stringify(ask)).not.toContain("lovelace");
  });
});

describe("narration is off unless asked for and AI is on", () => {
  it("narrate:true with AI off returns the path text and calls no model", async () => {
    const { dir, shas } = repo();
    const core = await boot();
    await ingestCommits(core, dir, shas);
    const res = await core.api("POST", "/api/graph/ask", {
      question: "which commits touched core/engine.ts",
      narrate: true,
    });
    expect(res.json.narration).toMatchObject({ narrated: false, processed_by: null });
    expect(core.network.requests).toEqual([]);
  });

  it("with AI on a narration that names something the path does not contain is refused", async () => {
    const { dir, shas } = repo();
    const core = await boot(fakeNetwork({ chat: () => "Commit 99999999 was reviewed by Zed." }));
    await core.api("POST", "/api/ai/settings", { enabled: true });
    await ingestCommits(core, dir, shas);
    const res = await core.api("POST", "/api/graph/ask", {
      question: "which commits touched core/engine.ts",
      narrate: true,
    });
    expect(res.json.narration.narrated).toBe(false);
    expect(res.json.narration.text).toBe(res.json.answers[0].results[0].path.text);
    expect(core.network.cloud()).toEqual([]);
  });
});

describe("every deletion path reaches the graph", () => {
  it("event retention removes what only those events supported, and keeps what memory supports", async () => {
    const { dir, shas } = repo();
    const core = await boot();
    await ingestCommits(core, dir, shas);
    await core.runtime.memory.maintain();
    core.runtime.graph.ingestMemory();
    const before = stats(core);
    expect(before.nodes).toBeGreaterThan(0);
    await core.api("POST", "/api/privacy/retention", { events: 1 });
    expect(core.runtime.privacy.prune(Date.now() + 2 * 86_400_000).events).toBeGreaterThan(0);
    const after = stats(core);
    expect(after.provenance).toBeLessThan(before.provenance);
    // The author and the files came only from the events: they are gone, nothing dangles.
    expect((await status(core)).visible_nodes_by_type.Person).toBeUndefined();
    expect((await status(core)).visible_nodes_by_type.Document).toBeUndefined();
    expect(core.runtime.graph.graph.stats().edges).toBeLessThanOrEqual(before.edges);
  });

  it("delete-all events empties the graph of event-sourced rows", async () => {
    const { dir, shas } = repo();
    const core = await boot();
    await ingestCommits(core, dir, shas);
    expect(stats(core).nodes).toBeGreaterThan(0);
    await core.api("POST", "/api/privacy/delete", { data: "events", confirm: true });
    expect(stats(core)).toEqual({ nodes: 0, edges: 0, provenance: 0 });
  });

  it("delete-all memory removes the graph rows that cited memories", async () => {
    const core = await boot();
    core.runtime.bus.publish(
      createEvent({
        event_type: "git.commit.created",
        source: "git",
        severity: "info",
        payload: { repository: "repo", sha: "1".repeat(40), message: "fix thing, closes #7" },
      }),
    );
    await core.runtime.bus.drain();
    core.runtime.graph.ingestMemory();
    const withMemory = stats(core).provenance;
    await core.api("POST", "/api/privacy/delete", { data: "memory", confirm: true });
    expect(stats(core).provenance).toBeLessThan(withMemory);
    // Nothing in the graph still cites a memory id.
    const rows = core.runtime.db
      .prepare("SELECT COUNT(*) AS n FROM kg_provenance WHERE source_kind = 'memory'")
      .get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it("forgetting one memory in the Memory tab removes what only it supported", async () => {
    const core = await boot();
    core.runtime.bus.publish(
      createEvent({
        event_type: "git.commit.created",
        source: "git",
        severity: "info",
        payload: { repository: "repo", sha: "2".repeat(40), message: "mention ADR-0042" },
      }),
    );
    await core.runtime.bus.drain();
    core.runtime.graph.ingestMemory();
    const rows = () =>
      (
        core.runtime.db
          .prepare("SELECT COUNT(*) AS n FROM kg_provenance WHERE source_kind = 'memory'")
          .get() as { n: number }
      ).n;
    expect(rows()).toBeGreaterThan(0);
    const id = ((await core.api("GET", "/api/memory")).json.items as { id: string }[])[0]!.id;
    await core.api("POST", `/api/memory/${id}/forget`, {});
    expect(rows()).toBe(0);
  });

  describe("meetings", () => {
    const SUMMARY: Summary = { text: "Planning.", decisions: ["Use SQLite"], action_items: [] };

    async function withMeeting(core: Core) {
      await core.runtime.capabilities.enable("kage");
      await core.api("POST", "/api/memory/settings", { allow_sensitive_meetings: true });
      const m = core.runtime.meetings.upsert({
        capabilityId: "kage",
        externalId: "7",
        status: "ready",
        title: "Planning",
        startedAt: "2026-10-01T10:00:00Z",
        participants: ["Ada Lovelace"],
      })!;
      core.runtime.meetings.setSummary(m.id, SUMMARY);
      await vi.waitFor(() => expect(core.runtime.graph.graph.stats().nodes).toBeGreaterThan(0));
      return m.id;
    }

    it("ingests a meeting only while sensitive meeting data is allowed, as sensitive provenance", async () => {
      const core = await boot();
      await core.runtime.capabilities.enable("kage");
      const m = core.runtime.meetings.upsert({
        capabilityId: "kage",
        externalId: "7",
        status: "ready",
        participants: ["Ada Lovelace"],
      })!;
      core.runtime.meetings.setSummary(m.id, SUMMARY);
      await Promise.resolve();
      expect(stats(core).nodes).toBe(0);
      const id = await withMeeting(core);
      const node = (await core.api("GET", `/api/graph/nodes/${enc(`Meeting:${id}`)}`)).json;
      expect(node.origin.length).toBeGreaterThan(0);
      for (const o of node.origin) expect(o).toMatchObject({ sensitivity: "sensitive" });
      expect(node.origin.map((o: { source_kind: string }) => o.source_kind)).toContain("meeting");
    });

    it("turning 'allow sensitive meetings' off removes every meeting-derived row", async () => {
      const core = await boot();
      await withMeeting(core);
      expect(core.runtime.graph.graph.stats().nodes).toBeGreaterThan(0);
      await core.api("POST", "/api/memory/settings", { allow_sensitive_meetings: false });
      expect(stats(core)).toEqual({ nodes: 0, edges: 0, provenance: 0 });
      const audit = (await core.api("GET", "/api/audit?limit=100")).json.entries as {
        action: string;
      }[];
      expect(audit.some((e) => e.action === "graph.meeting_data.removed")).toBe(true);
    });

    it("deleting the meeting removes its rows, and delete-all meetings does too", async () => {
      const core = await boot();
      const id = await withMeeting(core);
      await core.api("DELETE", `/api/meetings/${id}`, { confirm: true });
      expect(stats(core)).toEqual({ nodes: 0, edges: 0, provenance: 0 });
      const again = await boot();
      await withMeeting(again);
      await again.api("POST", "/api/privacy/delete", { data: "meetings", confirm: true });
      expect(stats(again)).toEqual({ nodes: 0, edges: 0, provenance: 0 });
    });

    it("a reviewed decision shows up, and rejecting it takes it out", async () => {
      const core = await boot();
      const id = await withMeeting(core);
      await vi.waitFor(() =>
        expect(core.runtime.meetingReview.service.items.list(id)).not.toHaveLength(0),
      );
      const decision = core.runtime.meetingReview.service.items.list(id, { kind: "decision" })[0]!;
      await core.api("POST", `/api/meeting-items/${decision.id}/accept`, {});
      core.runtime.graph.syncMeetings();
      const rows = () =>
        (
          core.runtime.db
            .prepare("SELECT COUNT(*) AS n FROM kg_provenance WHERE source_kind = 'meeting_item'")
            .get() as { n: number }
        ).n;
      expect(rows()).toBeGreaterThan(0);
      await core.api("POST", `/api/meeting-items/${decision.id}/reject`, {});
      expect(rows()).toBe(0);
    });
  });

  it("forgetting a person removes them and blocks them from coming back", async () => {
    const { dir, shas } = repo();
    const core = await boot();
    await ingestCommits(core, dir, shas);
    expect((await status(core)).visible_nodes_by_type.Person).toBe(2);
    const res = await core.api("POST", "/api/graph/people/forget", {
      name: "Ada Lovelace",
      confirm: true,
    });
    expect(res.json.removed.nodes).toBe(1);
    expect((await status(core)).visible_nodes_by_type.Person).toBe(1);
    // Her commit is read again: she must not return.
    publishCommit(core, dir, shas[0]!);
    await core.runtime.bus.drain();
    await core.runtime.graph.settled();
    expect((await status(core)).visible_nodes_by_type.Person).toBe(1);
    const audit = (await core.api("GET", "/api/audit?limit=100")).json.entries as {
      action: string;
      details: Record<string, unknown>;
    }[];
    const entry = audit.find((e) => e.action === "graph.person.forgotten")!;
    expect(JSON.stringify(entry.details)).not.toMatch(/ada|lovelace/i);
  });
});

describe("hostile input to the graph routes", () => {
  const cases: [string, string, unknown, number][] = [
    ["POST", "/api/graph/ask", {}, 400],
    ["POST", "/api/graph/ask", { question: 5 }, 400],
    ["POST", "/api/graph/ask", { question: "" }, 400],
    ["POST", "/api/graph/ask", { question: "q".repeat(501) }, 400],
    ["POST", "/api/graph/ask", { question: "x", narrate: "yes" }, 400],
    ["POST", "/api/graph/ask", { question: "x", extra: 1 }, 400],
    ["POST", "/api/graph/ask", [], 400],
    ["POST", "/api/graph/people/forget", { name: "Ada" }, 409],
    ["POST", "/api/graph/people/forget", { name: "Ada", confirm: "true" }, 409],
    ["POST", "/api/graph/people/forget", { confirm: true }, 400],
    ["POST", "/api/graph/people/forget", { name: "", confirm: true }, 400],
    ["POST", "/api/graph/people/forget", { name: "x".repeat(201), confirm: true }, 400],
    ["POST", "/api/graph/people/forget", { name: "Ada", confirm: true, extra: 1 }, 400],
    ["GET", "/api/graph/nodes/__proto__", undefined, 404],
    ["GET", "/api/graph/nodes/constructor/neighbors", undefined, 404],
  ];
  it.each(cases)("%s %s -> %i", async (method, path, body, expected) => {
    const { dir, shas } = repo();
    const core = await boot();
    await ingestCommits(core, dir, shas);
    const before = stats(core);
    const res = await core.api(method, path, body ?? undefined);
    expect(res.status).toBe(expected);
    expect(stats(core)).toEqual(before);
  });

  it("every route needs the session token", async () => {
    const core = await boot();
    for (const [method, path] of [
      ["GET", "/api/graph/status"],
      ["GET", "/api/graph/nodes/x"],
      ["GET", "/api/graph/nodes/x/neighbors"],
      ["POST", "/api/graph/ask"],
      ["POST", "/api/graph/people/forget"],
    ] as const) {
      const res = await core.api(method, path, method === "POST" ? {} : undefined, {
        authorization: "",
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("a hostile question that names nothing returns no facts and says so", async () => {
    const core = await boot();
    const res = await core.api("POST", "/api/graph/ask", {
      question: "' OR 1=1; DROP TABLE kg_nodes; -- ../../etc/passwd",
    });
    expect(res.status).toBe(200);
    expect(res.json.seeds).toEqual([]);
    expect(res.json.notes[0]).toMatch(/No entity/);
  });
});

describe("diagnostics and the inventory report counts only", () => {
  it("seeded canaries (a person, a commit subject, a decision) appear in no support report", async () => {
    const { dir, shas } = repo();
    const core = await boot();
    await ingestCommits(core, dir, shas);
    await core.runtime.capabilities.enable("kage");
    await core.api("POST", "/api/memory/settings", { allow_sensitive_meetings: true });
    const m = core.runtime.meetings.upsert({
      capabilityId: "kage",
      externalId: "9",
      status: "ready",
      title: "TITLECANARY",
      participants: ["Grace Hopper"],
    })!;
    core.runtime.meetings.setSummary(m.id, {
      text: "x",
      decisions: ["DECISIONCANARY migrate"],
      action_items: [],
    });
    await vi.waitFor(() =>
      expect(core.runtime.meetingReview.service.items.list(m.id).length).toBeGreaterThan(0),
    );
    core.runtime.graph.ingestMemory();
    const report = (await core.api("GET", "/api/diagnostics")).json;
    expect(report.derived.graph_nodes).toBeGreaterThan(0);
    expect(report.derived.meeting_items).toBeGreaterThan(0);
    const text = JSON.stringify(report);
    for (const canary of [
      "Lovelace",
      "Torvalds",
      "ada lovelace",
      "Hopper",
      "DECISIONCANARY",
      "TITLECANARY",
      "core/engine.ts",
      "add the engine",
    ]) {
      expect(text, canary).not.toContain(canary);
    }
    const inv = JSON.stringify((await core.api("GET", "/api/privacy")).json);
    for (const canary of ["Lovelace", "Hopper", "DECISIONCANARY", "TITLECANARY"]) {
      expect(inv, canary).not.toContain(canary);
    }
  });
});
