// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { EventBus } from "@phoenix/event-bus";
import { describe, expect, it, vi } from "vitest";
import { createEvent } from "@phoenix/protocol";
import { FAKE_AWS_KEY } from "../../../protocol/testing/fake-secrets";
import { GRAPH_EVENT_PATTERNS, nodeId } from "../src";
import { OWNER, SHA_A, SHA_B, T0, event, rig, type Rig } from "./helpers";

const R = { repositoryAliases: { phoenix: "o/phoenix" }, trackerPrefixes: ["PROJ"] };

describe("git events and commits", () => {
  it("git.commit.created becomes a Commit in a Repository, with the folder name resolved", () => {
    const r = rig(R);
    const out = r.ingest.handle(
      event("git.commit.created", { repository: "phoenix", sha: SHA_A, branch: "main" }),
    );
    expect(out.skipped).toBe(0);
    const c = r.graph.node(OWNER, `Commit:o/phoenix@${SHA_A}`);
    expect(c?.provenance[0]).toMatchObject({
      sourceKind: "event",
      capability: "git",
      assertedBy: "capability",
    });
    expect(
      r.graph.edge(OWNER, `Commit:o/phoenix@${SHA_A}|PART_OF|Repository:o/phoenix`),
    ).not.toBeNull();
  });

  it("an event with no message still gives the commit; later backfill adds its author, files and mentions", () => {
    const r = rig({ ...R, featureRules: [{ prefix: "ai/memory/", feature: "memory" }] });
    r.ingest.handle(event("git.commit.created", { repository: "phoenix", sha: SHA_A }));
    r.ingest.ingestCommit({
      repository: "phoenix",
      sha: SHA_A,
      at: T0,
      message: "Fix store (#12), Phase 28\n\nbody mentions PROJ-3",
      author: "Ada Lovelace",
      files: ["ai/memory/src/store.ts", "README.md"],
    });
    const id = `Commit:o/phoenix@${SHA_A}`;
    const rel = (e: string) => r.graph.edge(OWNER, e);
    expect(rel(`Person:ada lovelace|AUTHORED|${id}`)?.provenance[0]?.assertedBy).toBe("capability");
    expect(rel(`${id}|TOUCHES|Feature:memory`)).not.toBeNull();
    expect(rel(`${id}|TOUCHES|Document:o/phoenix:README.md`)).not.toBeNull();
    expect(rel(`${id}|MENTIONS|Issue:o/phoenix#12`)?.provenance[0]).toMatchObject({
      assertedBy: "rule",
    });
    expect(rel(`${id}|MENTIONS|Issue:PROJ-3`)).not.toBeNull();
    expect(rel(`${id}|REFERENCES|Feature:phase-28`)).not.toBeNull();
    // Display name only in the person's provenance, not an email.
    expect(r.graph.node(OWNER, "Person:ada lovelace")?.label).toBe("Ada Lovelace");
  });

  it("re-ingesting the same history changes nothing", () => {
    const r = rig(R);
    const commit = {
      repository: "phoenix",
      sha: SHA_A,
      at: T0,
      message: "x #1",
      author: "ada",
      files: ["a.ts"],
    };
    r.ingest.ingestCommit(commit);
    const before = r.graph.stats();
    r.ingest.ingestCommit(commit);
    expect(r.graph.stats()).toEqual(before);
  });

  it("never stores an email: an email-shaped author makes no Person", () => {
    const r = rig(R);
    r.ingest.ingestCommit({
      repository: "phoenix",
      sha: SHA_A,
      at: T0,
      message: "m",
      author: "ada@example.com",
    });
    expect(r.graph.listByType(OWNER, "Person", 10)).toEqual([]);
    expect(JSON.stringify(r.db.prepare("SELECT * FROM kg_provenance").all())).not.toContain(
      "@example.com",
    );
  });

  it("skips malformed commits and hostile events without throwing", () => {
    const r = rig(R);
    expect(
      r.ingest.ingestCommit({ repository: "phoenix", sha: "nothex", at: T0, message: "" }).skipped,
    ).toBe(1);
    expect(
      r.ingest.ingestCommit({ repository: "phoenix", sha: SHA_A, at: "never", message: "" })
        .skipped,
    ).toBe(1);
    for (const payload of [
      {},
      { repository: 5, sha: SHA_A },
      { repository: "x", sha: ["a"] },
      { repository: "a|b", sha: SHA_A, message: "z".repeat(1e5) },
    ]) {
      const out = r.ingest.handle(event("git.commit.created", payload));
      expect(out.written).toBeLessThanOrEqual(8);
    }
    expect(r.ingest.handle(event("mock.thing", {})).skipped).toBe(1);
    expect(r.graph.listByType(OWNER, "Commit", 10)).toEqual([]);
  });

  it("redacts a credential in a commit subject before it is stored", () => {
    const r = rig(R);
    r.ingest.ingestCommit({
      repository: "phoenix",
      sha: SHA_A,
      at: T0,
      message: `oops ${FAKE_AWS_KEY}`,
    });
    expect(JSON.stringify(r.db.prepare("SELECT detail FROM kg_provenance").all())).not.toContain(
      FAKE_AWS_KEY,
    );
  });

  it("caps the files stored per commit", () => {
    const r = rig(R);
    const files = Array.from({ length: 500 }, (_, i) => `f${i}.ts`);
    r.ingest.ingestCommit({ repository: "phoenix", sha: SHA_A, at: T0, message: "m", files });
    expect(r.graph.listByType(OWNER, "Document", 1000)).toHaveLength(200);
  });
});

describe("github events", () => {
  it("pull requests: node, repository, author, and a mention in the title", () => {
    const r = rig(R);
    r.ingest.handle(
      event("github.pr.merged", {
        repository: "o/phoenix",
        number: 1,
        title: "Fix #5 for Phase 9",
        actor: "octo",
        branch: "b",
        base: "main",
      }),
    );
    const pr = r.graph.node(OWNER, "PullRequest:o/phoenix#1");
    expect(pr?.detail).toMatchObject({ state: "merged", branch: "b" });
    expect(r.graph.edge(OWNER, "Person:octo|AUTHORED|PullRequest:o/phoenix#1")).not.toBeNull();
    expect(r.graph.edge(OWNER, "PullRequest:o/phoenix#1|FIXES|Issue:o/phoenix#5")).not.toBeNull();
    expect(
      r.graph.edge(OWNER, "PullRequest:o/phoenix#1|REFERENCES|Feature:phase-09"),
    ).not.toBeNull();
  });

  it("a later PR event updates the state without duplicating anything", () => {
    const r = rig(R);
    r.ingest.handle(
      event(
        "github.pr.opened",
        { repository: "o/phoenix", number: 1, title: "t", actor: "octo" },
        { timestamp: "2026-10-08T09:00:00.000Z" },
      ),
    );
    r.ingest.handle(
      event("github.pr.merged", { repository: "o/phoenix", number: 1, title: "t", actor: "octo" }),
    );
    expect(r.graph.node(OWNER, "PullRequest:o/phoenix#1")?.detail.state).toBe("merged");
    expect(r.graph.node(OWNER, "PullRequest:o/phoenix#1")?.provenance).toHaveLength(2);
    expect(r.graph.listByType(OWNER, "PullRequest", 10)).toHaveLength(1);
  });

  it("CI runs link to the commit they ran for, whichever of the two arrives first", () => {
    const ci = (run: number, commit: string) =>
      event("github.ci.failed", {
        repository: "o/phoenix",
        run_id: run,
        workflow: "CI",
        branch: "x",
        commit,
        conclusion: "failure",
        actor: "octo",
        failed_job: "lint",
      });
    const r = rig(R);
    // Run first: nothing to link to yet.
    r.ingest.handle(ci(77, SHA_A.slice(0, 7)));
    expect(
      r.graph
        .adjacent(OWNER, "CIRun:o/phoenix/run/77", { limit: 10, direction: "in" })
        .edges.map((e) => e.src.split(":")[0]),
    ).toEqual(["Person"]);
    expect(r.graph.node(OWNER, "CIRun:o/phoenix/run/77")?.detail).toMatchObject({
      state: "failed",
      failed_job: "lint",
      conclusion: "failure",
    });
    expect(r.graph.edge(OWNER, "Person:octo|TRIGGERED|CIRun:o/phoenix/run/77")).not.toBeNull();
    // The commit arrives later and the link appears, citing the run's own event.
    r.ingest.ingestCommit({ repository: "phoenix", sha: SHA_A, at: T0, message: "m" });
    const edge = r.graph.edge(OWNER, `Commit:o/phoenix@${SHA_A}|TRIGGERED|CIRun:o/phoenix/run/77`);
    expect(edge?.provenance[0]).toMatchObject({ sourceKind: "event", capability: "github" });
    // Commit first, run second.
    r.ingest.ingestCommit({ repository: "phoenix", sha: SHA_B, at: T0, message: "m" });
    r.ingest.handle(ci(78, SHA_B.slice(0, 7)));
    expect(
      r.graph.edge(OWNER, `Commit:o/phoenix@${SHA_B}|TRIGGERED|CIRun:o/phoenix/run/78`),
    ).not.toBeNull();
  });

  it("an ambiguous or unknown short hash links nothing", () => {
    const r = rig(R);
    const sha1 = "abcdef0" + "1".repeat(33);
    const sha2 = "abcdef0" + "2".repeat(33);
    r.ingest.ingestCommit({ repository: "phoenix", sha: sha1, at: T0, message: "m" });
    r.ingest.ingestCommit({ repository: "phoenix", sha: sha2, at: T0, message: "m" });
    r.ingest.handle(
      event("github.ci.passed", { repository: "o/phoenix", run_id: 5, commit: "abcdef0" }),
    );
    r.ingest.handle(
      event("github.ci.passed", { repository: "o/phoenix", run_id: 6, commit: "1234567" }),
    );
    expect(
      r.graph.adjacent(OWNER, "CIRun:o/phoenix/run/5", {
        limit: 10,
        direction: "in",
        rel: "TRIGGERED",
      }).edges,
    ).toEqual([]);
    expect(
      r.graph.adjacent(OWNER, "CIRun:o/phoenix/run/6", {
        limit: 10,
        direction: "in",
        rel: "TRIGGERED",
      }).edges,
    ).toEqual([]);
  });

  it("a deployment links to a commit only when its ref is a full hash", () => {
    const r = rig(R);
    r.ingest.handle(
      event("github.deploy.succeeded", {
        repository: "o/phoenix",
        deployment_id: 5,
        environment: "prod",
        branch: SHA_B,
        actor: "octo",
      }),
    );
    r.ingest.handle(
      event("github.deploy.started", {
        repository: "o/phoenix",
        deployment_id: 6,
        environment: "prod",
        branch: "main",
      }),
    );
    expect(
      r.graph.edge(OWNER, `Commit:o/phoenix@${SHA_B}|DEPLOYED_TO|Deployment:o/phoenix/deploy/5`),
    ).not.toBeNull();
    expect(
      r.graph.adjacent(OWNER, "Deployment:o/phoenix/deploy/6", { limit: 10, direction: "in" })
        .edges,
    ).toEqual([]);
  });

  it("'unknown' actors (the capability's placeholder) do not become people", () => {
    const r = rig(R);
    r.ingest.handle(
      event("github.ci.passed", { repository: "o/phoenix", run_id: 1, actor: "unknown" }),
    );
    expect(r.graph.listByType(OWNER, "Person", 10)).toEqual([]);
  });
});

describe("docker and issues", () => {
  it("containers become Services, grouped by compose project", () => {
    const r = rig(R);
    r.ingest.handle(
      event("docker.container.died", {
        container_id: "abc",
        name: "db",
        image: "postgres:16",
        compose_project: "stack",
      }),
    );
    expect(r.graph.node(OWNER, "Service:db")?.detail).toMatchObject({
      state: "died",
      image: "postgres:16",
    });
    expect(r.graph.edge(OWNER, "Service:db|PART_OF|Project:stack")).not.toBeNull();
  });

  it("issue events: the issue, its assignee only for the configured self, and an unassign retracts", () => {
    const r = rig({ ...R, selfName: "Octo" });
    r.ingest.handle(
      event("issues.assigned", {
        tracker: "github",
        key: "o/phoenix#3",
        title: "Crash on start, fixes none",
        status: "Open",
        category: "open",
      }),
    );
    const id = "Issue:o/phoenix#3|ASSIGNED_TO|Person:octo";
    expect(r.graph.edge(OWNER, id)).not.toBeNull();
    expect(r.graph.edge(OWNER, "Issue:o/phoenix#3|PART_OF|Repository:o/phoenix")).not.toBeNull();
    r.ingest.handle(
      event("issues.unassigned", { tracker: "github", key: "o/phoenix#3", title: "t" }),
    );
    expect(r.graph.edge(OWNER, id)).toBeNull();
    expect(r.graph.node(OWNER, "Issue:o/phoenix#3")).not.toBeNull();
    const noSelf = rig(R);
    noSelf.ingest.handle(
      event("issues.assigned", { tracker: "linear", key: "PROJ-8", title: "t" }),
    );
    expect(noSelf.graph.listByType(OWNER, "Person", 5)).toEqual([]);
    // PROJ is learned from the issue itself, so a later commit mentioning PROJ-8 links to it.
    noSelf.ingest.ingestCommit({
      repository: "phoenix",
      sha: SHA_A,
      at: T0,
      message: "work on PROJ-8",
    });
    expect(
      noSelf.graph.edge(OWNER, `Commit:o/phoenix@${SHA_A}|MENTIONS|Issue:PROJ-8`),
    ).not.toBeNull();
  });
});

describe("meetings", () => {
  function makeMeeting(r: Rig) {
    const m = r.meetings.upsert({
      capabilityId: "kage",
      externalId: "9",
      status: "ended",
      title: "Planning",
      startedAt: T0,
      participants: ["Ada", "grace@example.com", "Linus"],
    })!;
    r.meetings.setSummary(m.id, {
      text: "s",
      decisions: ["Use SQLite for the graph, see ADR-0014", "Ship #12 first"],
    });
    return m;
  }

  it("meeting, participants (no emails) and decisions, all parented to the meeting", () => {
    const r = rig(R);
    const m = makeMeeting(r);
    const out = r.ingest.ingestMeeting(m, r.meetings.summary(m.id));
    expect(out.skipped).toBe(1);
    expect(r.graph.listByType(OWNER, "Person", 10).map((p) => p.id)).toEqual([
      "Person:ada",
      "Person:linus",
    ]);
    const decisions = r.graph.listByType(OWNER, "Decision", 10).filter((d) => d.key.includes("#"));
    expect(decisions).toHaveLength(2);
    expect(
      r.graph.edge(OWNER, `${decisions[0]!.id}|DECIDED_IN|Meeting:kage:9`)?.provenance[0],
    ).toMatchObject({
      sensitivity: "sensitive",
      scope: "meeting:kage:9",
    });
    const mentions = decisions.flatMap((d) =>
      r.graph.adjacent(OWNER, d.id, { rel: "MENTIONS", limit: 5 }).edges.map((e) => e.dst),
    );
    // "#12" has no repository in a meeting, so only the ADR reference is explicit enough.
    expect(mentions).toEqual(["Decision:ADR-0014"]);
    expect(r.graph.stats().provenance).toBeGreaterThan(5);
  });

  it("deleting the meeting through MeetingStore removes everything derived from it", () => {
    const r = rig(R);
    const m = makeMeeting(r);
    r.ingest.ingestMeeting(m, r.meetings.summary(m.id));
    expect(r.graph.stats().nodes).toBeGreaterThan(4);
    r.meetings.delete(m.id);
    expect(r.graph.stats()).toEqual({ nodes: 0, edges: 0, provenance: 0 });
  });

  it("a decision also mentioned by a commit keeps the commit's edge after the meeting is deleted", () => {
    const r = rig(R);
    const m = makeMeeting(r);
    r.ingest.ingestMeeting(m, r.meetings.summary(m.id));
    r.ingest.ingestCommit({
      repository: "phoenix",
      sha: SHA_A,
      at: T0,
      message: "implement ADR-0014",
    });
    r.meetings.delete(m.id);
    expect(
      r.graph.edge(OWNER, `Commit:o/phoenix@${SHA_A}|MENTIONS|Decision:ADR-0014`),
    ).not.toBeNull();
    expect(r.graph.listByType(OWNER, "Meeting", 5)).toEqual([]);
    expect(r.graph.node(OWNER, "Person:ada")).toBeNull();
  });

  it("meeting items: rejected are ignored, ai items are proposals, accepted ones are the user's word; rejecting later removes", () => {
    const r = rig(R);
    const m = r.meetings.upsert({
      capabilityId: "kage",
      externalId: "5",
      status: "ended",
      title: "T",
      startedAt: T0,
    })!;
    r.ingest.ingestMeeting(m, null, [
      {
        id: "mi_1",
        kind: "decision",
        text: "Adopt the graph",
        status: "proposed",
        extractedBy: "ai:llama3.2",
      },
      {
        id: "mi_2",
        kind: "decision",
        text: "Rejected idea",
        status: "rejected",
        extractedBy: "ai:llama3.2",
      },
      {
        id: "mi_3",
        kind: "decision",
        text: "Agreed thing",
        status: "accepted",
        extractedBy: "ai:llama3.2",
      },
      { id: "mi_4", kind: "action_item", text: "do it", status: "proposed", extractedBy: "kage" },
    ]);
    const edges = r.graph
      .listByType(OWNER, "Decision", 10)
      .map(
        (d) =>
          r.graph.adjacent(OWNER, d.id, { rel: "DECIDED_IN", limit: 3, includeProposed: true })
            .edges[0],
      );
    expect(edges.map((e) => e?.status).sort()).toEqual(["fact", "proposed"]);
    expect(edges.find((e) => e?.status === "proposed")?.provenance[0]).toMatchObject({
      assertedBy: "ai:llama3.2",
      sourceKind: "meeting_item",
      sourceId: "mi_1",
    });
    expect(
      r.graph.adjacent(OWNER, "Meeting:kage:5", { rel: "DECIDED_IN", limit: 5 }).edges,
    ).toHaveLength(1);
    // The meeting_items trigger path: a real row rejected later takes the proposal with it.
    r.db
      .exec(`INSERT INTO meeting_items (id, meeting_id, kind, text, status, extracted_by, dedupe_key, created_at)
      VALUES ('mi_1', 'kage:5', 'decision', 'Adopt the graph', 'proposed', 'ai:llama3.2', 'k', '${T0}')`);
    r.db.exec("UPDATE meeting_items SET status = 'rejected' WHERE id = 'mi_1'");
    expect(
      r.graph.adjacent(OWNER, "Meeting:kage:5", {
        rel: "DECIDED_IN",
        limit: 5,
        includeProposed: true,
      }).edges,
    ).toHaveLength(1);
  });
});

describe("memory", () => {
  it("builds graph facts from commit memories and removes them when the memory is forgotten", () => {
    const r = rig(R);
    const out = r.pipeline.capture({
      source: "git",
      sourceRef: "phoenix",
      scope: "repo:phoenix",
      contentType: "commit",
      text: `Commit aaaaaaa on main in phoenix: Fix thing (#4)`,
      observedAt: T0,
      dedupeKey: "git:phoenix:a",
      provenance: { repository: "phoenix", sha: SHA_A, branch: "main" },
    });
    if (out.status !== "stored") throw new Error("not stored");
    expect(r.ingest.ingestMemory(r.memory).written).toBeGreaterThan(0);
    const c = r.graph.node(OWNER, `Commit:o/phoenix@${SHA_A}`);
    expect(c?.provenance[0]).toMatchObject({ sourceKind: "memory", sourceId: out.item.id });
    expect(
      r.graph.edge(OWNER, `Commit:o/phoenix@${SHA_A}|MENTIONS|Issue:o/phoenix#4`),
    ).not.toBeNull();
    r.memory.forget(out.item.id);
    expect(r.graph.stats()).toEqual({ nodes: 0, edges: 0, provenance: 0 });
    // The tombstoned memory is not ingested again.
    expect(r.ingest.ingestMemory(r.memory).written).toBe(0);
  });

  it("a meeting-decision memory is ingested as a decision parented to its meeting", () => {
    const r = rig(R);
    const m = r.meetings.upsert({
      capabilityId: "kage",
      externalId: "2",
      status: "ended",
      title: "Sync",
      startedAt: T0,
    })!;
    r.meetings.setSummary(m.id, { text: "s", decisions: ["Pick SQLite"] });
    r.pipeline.capture({
      source: "kage",
      sourceRef: m.id,
      scope: `meeting:${m.id}`,
      contentType: "meeting_decision",
      text: 'Decision in "Sync": Pick SQLite',
      observedAt: T0,
      dedupeKey: "meeting:kage:2:decision:x",
      provenance: { meeting_id: m.id, part: "decision" },
    });
    r.ingest.ingestMemory(r.memory);
    expect(r.graph.listByType(OWNER, "Decision", 5)).toHaveLength(1);
    r.meetings.delete(m.id);
    expect(r.graph.stats().nodes).toBe(0);
  });

  it("project docs under a configured root become Documents; ADR files make their Decision", () => {
    const r = rig({ ...R, documentRoots: [{ root: "/work/phoenix", repository: "o/phoenix" }] });
    r.pipeline.capture({
      source: "project-docs",
      sourceRef: "/work/phoenix/docs/adr/ADR-0014-persistence.md",
      scope: "path:/work/phoenix/docs/adr/ADR-0014-persistence.md",
      contentType: "doc",
      text: "ADR-0014 › Decision: use SQLite, as Phase 3 needs",
      observedAt: T0,
      dedupeKey: "doc:x:1:1",
      provenance: { path: "/work/phoenix/docs/adr/ADR-0014-persistence.md" },
    });
    r.pipeline.capture({
      source: "project-docs",
      sourceRef: "/elsewhere/x.md",
      scope: "path:/elsewhere/x.md",
      contentType: "doc",
      text: "unrelated",
      observedAt: T0,
      dedupeKey: "doc:y:1:1",
      provenance: { path: "/elsewhere/x.md" },
    });
    const out = r.ingest.ingestMemory(r.memory);
    expect(out.skipped).toBe(1);
    const doc = "Document:o/phoenix:docs/adr/ADR-0014-persistence.md";
    expect(
      r.graph.edge(OWNER, `Decision:ADR-0014|DECIDED_IN|${doc}`)?.provenance[0]?.assertedBy,
    ).toBe("rule");
    expect(r.graph.edge(OWNER, `${doc}|REFERENCES|Feature:phase-03`)).not.toBeNull();
  });
});

describe("event subscription", () => {
  it("subscribes to exactly the capability event families and ingests what the bus delivers", async () => {
    const r = rig(R);
    const bus = new EventBus();
    const off = r.ingest.attach(bus);
    const fire = (type: string, payload: Record<string, unknown>) =>
      bus.publish(
        createEvent({
          event_type: type,
          source: type.split(".")[0] ?? "x",
          severity: "info",
          payload,
        }),
      );
    fire("git.commit.created", { repository: "phoenix", sha: SHA_A });
    fire("github.pr.opened", { repository: "o/phoenix", number: 2, title: "t", actor: "octo" });
    fire("kage.meeting.started", { x: 1 });
    await vi.waitFor(() => expect(r.graph.node(OWNER, "PullRequest:o/phoenix#2")).not.toBeNull());
    expect(r.graph.node(OWNER, `Commit:o/phoenix@${SHA_A}`)).not.toBeNull();
    expect(GRAPH_EVENT_PATTERNS).not.toContain("*");
    expect(r.graph.listByType(OWNER, "Meeting", 5)).toEqual([]);
    off();
    fire("github.pr.opened", { repository: "o/phoenix", number: 3, title: "t" });
    const flushed = Promise.withResolvers<void>();
    setImmediate(() => flushed.resolve());
    await flushed.promise;
    expect(r.graph.node(OWNER, nodeId({ type: "PullRequest", key: "o/phoenix#3" }))).toBeNull();
  });
});
