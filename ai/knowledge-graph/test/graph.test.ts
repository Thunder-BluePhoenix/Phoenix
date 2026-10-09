// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { FAKE_GITHUB_TOKEN } from "../../../protocol/testing/fake-secrets";
import { MIGRATIONS } from "@phoenix/persistence";
import { nodeId, parseNodeId } from "../src";
import { OWNER, SHA_A, prov, rig, viewerOf } from "./helpers";

const commit = { type: "Commit", key: `o/r@${SHA_A}` } as const;
const person = { type: "Person", key: "ada" } as const;

describe("migration 11", () => {
  it("is the reserved version and keeps the ones before it", () => {
    const v = MIGRATIONS.map((m) => m.version);
    expect(v).toContain(11);
    expect(v).toEqual([...v].sort((a, b) => a - b));
    expect(new Set(v).size).toBe(v.length);
  });
});

describe("upserts", () => {
  it("are idempotent: the same node and edge twice is one row each, one provenance row", () => {
    const r = rig();
    for (let i = 0; i < 3; i++) {
      r.graph.assertEdge(person, "AUTHORED", commit, prov());
    }
    expect(r.graph.stats()).toEqual({ nodes: 2, edges: 1, provenance: 3 });
  });

  it("keeps every supporting source of an edge", () => {
    const r = rig();
    r.graph.assertEdge(person, "AUTHORED", commit, prov({ sourceId: "evt_1" }));
    r.graph.assertEdge(
      person,
      "AUTHORED",
      commit,
      prov({ sourceKind: "memory", sourceId: "mem_9" }),
    );
    const edge = r.graph.edge(OWNER, `Person:ada|AUTHORED|${nodeId(commit)}`);
    expect(edge?.provenance.map((p) => p.sourceId).sort()).toEqual(["evt_1", "mem_9"]);
    expect(edge?.status).toBe("fact");
  });

  it("rejects relations between types the schema does not allow, and unknown types/relations", () => {
    const r = rig();
    expect(() => r.graph.assertEdge(commit, "AUTHORED", person, prov())).toThrow(/does not join/);
    expect(() => r.graph.assertEdge(person, "OWNS" as never, commit, prov())).toThrow(
      /unknown relation/,
    );
    expect(() => r.graph.upsertNode({ type: "Wizard" as never, key: "x" }, prov())).toThrow(
      /unknown node type/,
    );
    expect(r.graph.stats().nodes).toBe(0);
  });

  it("rejects hostile keys and provenance without writing anything", () => {
    const r = rig();
    const bad = ["", " x", "a|b", "a\nb", "x".repeat(301), "ada@example.com"];
    for (const key of bad) {
      expect(() => r.graph.upsertNode({ type: "Person", key }, prov())).toThrow();
    }
    expect(() => r.graph.upsertNode(person, prov({ assertedBy: "root" as never }))).toThrow();
    expect(() => r.graph.upsertNode(person, prov({ confidence: 2 }))).toThrow();
    expect(() => r.graph.upsertNode(person, prov({ observedAt: "yesterday-ish" }))).toThrow();
    expect(() => r.graph.upsertNode(person, prov({ sensitivity: "secret" as never }))).toThrow();
    expect(() => r.graph.upsertNode(person, prov({ detail: { nested: {} } as never }))).toThrow();
    expect(r.graph.stats()).toEqual({ nodes: 0, edges: 0, provenance: 0 });
  });

  it("redacts secret-shaped detail before it is stored", () => {
    const r = rig();
    r.graph.upsertNode(commit, prov({ detail: { title: `fix ${FAKE_GITHUB_TOKEN} leak` } }));
    const view = r.graph.node(OWNER, nodeId(commit));
    expect(JSON.stringify(view)).not.toContain(FAKE_GITHUB_TOKEN);
    expect(view?.label).toContain("[REDACTED]");
  });

  it("a failed write inside a transaction leaves no partial edge", () => {
    const r = rig();
    expect(() =>
      r.graph.transaction(() => {
        r.graph.assertEdge(person, "AUTHORED", commit, prov());
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(r.graph.stats()).toEqual({ nodes: 0, edges: 0, provenance: 0 });
  });

  it("node ids round-trip and refuse junk", () => {
    expect(parseNodeId(nodeId(commit))).toEqual(commit);
    expect(parseNodeId("Wizard:x")).toBeNull();
    expect(parseNodeId("Commit:")).toBeNull();
    expect(parseNodeId("nocolon")).toBeNull();
  });
});

describe("AI assertions", () => {
  it("are proposed, never facts, and are left out of traversal until confirmed", () => {
    const r = rig();
    const id = r.graph.assertEdge(
      { type: "Decision", key: "m#1" },
      "MENTIONS",
      { type: "Issue", key: "o/r#1" },
      prov({
        assertedBy: "ai:llama3.2",
        confidence: 0.6,
        sourceKind: "meeting",
        sourceId: "kage:1",
      }),
    )!;
    expect(r.graph.edge(OWNER, id)?.status).toBe("proposed");
    expect(r.graph.node(OWNER, "Issue:o/r#1")?.status).toBe("proposed");
    expect(r.graph.adjacent(OWNER, "Issue:o/r#1", { limit: 10 }).edges).toEqual([]);
    expect(
      r.graph.adjacent(OWNER, "Issue:o/r#1", { limit: 10, includeProposed: true }).edges,
    ).toHaveLength(1);

    expect(r.graph.confirmEdge(OWNER, id, "me")).toBe(true);
    const confirmed = r.graph.edge(OWNER, id)!;
    expect(confirmed.status).toBe("fact");
    // The origin chain keeps the AI row next to the user's confirmation.
    expect(confirmed.provenance.map((p) => p.assertedBy).sort()).toEqual(["ai:llama3.2", "user"]);
    expect(r.graph.adjacent(OWNER, "Issue:o/r#1", { limit: 10 }).edges).toHaveLength(1);
  });

  it("a rule row on the same edge makes it a fact without any confirmation, and an AI row alone cannot", () => {
    const r = rig();
    const a = { type: "Decision", key: "m#2" } as const;
    const b = { type: "Issue", key: "o/r#2" } as const;
    const id = r.graph.assertEdge(a, "MENTIONS", b, prov({ assertedBy: "ai:x", sourceId: "s1" }))!;
    expect(r.graph.edge(OWNER, id)?.status).toBe("proposed");
    r.graph.assertEdge(a, "MENTIONS", b, prov({ assertedBy: "rule", sourceId: "s2" }));
    expect(r.graph.edge(OWNER, id)?.status).toBe("fact");
  });

  it("a rejected proposal is gone and is not proposed again; a rule can still assert it", () => {
    const r = rig();
    const a = { type: "Decision", key: "m#3" } as const;
    const b = { type: "Issue", key: "o/r#3" } as const;
    const ai = prov({ assertedBy: "ai:x", sourceId: "s1" });
    const id = r.graph.assertEdge(a, "MENTIONS", b, ai)!;
    expect(r.graph.rejectEdge(OWNER, id)).toBe(true);
    expect(r.graph.edge(OWNER, id)).toBeNull();
    expect(r.graph.assertEdge(a, "MENTIONS", b, ai)).toBeNull();
    expect(r.graph.assertEdge(a, "MENTIONS", b, prov({ assertedBy: "rule", sourceId: "s3" }))).toBe(
      id,
    );
    expect(r.graph.edge(OWNER, id)?.status).toBe("fact");
  });

  it("cannot be confirmed by someone who cannot see the edge, nor twice", () => {
    const r = rig();
    const id = r.graph.assertEdge(
      { type: "Decision", key: "m#4" },
      "MENTIONS",
      { type: "Issue", key: "o/r#4" },
      prov({
        assertedBy: "ai:x",
        scope: "meeting:k:1",
        domain: "meeting",
        sensitivity: "sensitive",
      }),
    )!;
    expect(r.graph.confirmEdge(viewerOf("repo:*"), id, "me")).toBe(false);
    expect(r.graph.confirmEdge(OWNER, id, "me")).toBe(true);
    expect(r.graph.confirmEdge(OWNER, id, "me")).toBe(false);
  });
});

describe("deleting a source", () => {
  it("removes an edge whose only provenance it was, and keeps one that has another source", () => {
    const r = rig();
    const solo = { type: "Commit", key: `o/r@${"1".repeat(40)}` } as const;
    r.graph.assertEdge(person, "AUTHORED", solo, prov({ sourceId: "only" }));
    r.graph.assertEdge(person, "AUTHORED", commit, prov({ sourceId: "one" }));
    r.graph.assertEdge(person, "AUTHORED", commit, prov({ sourceId: "two" }));
    const report = r.graph.removeSource("event", "only");
    expect(report.edges).toBe(1);
    expect(r.graph.edge(OWNER, `Person:ada|AUTHORED|${nodeId(solo)}`)).toBeNull();
    expect(r.graph.node(OWNER, nodeId(solo))).toBeNull();
    // The shared edge and the person survive; only the removed source's row went.
    r.graph.removeSource("event", "one");
    const kept = r.graph.edge(OWNER, `Person:ada|AUTHORED|${nodeId(commit)}`);
    expect(kept?.provenance.map((p) => p.sourceId)).toEqual(["two"]);
    expect(r.graph.node(OWNER, "Person:ada")).not.toBeNull();
    r.graph.removeSource("event", "two");
    expect(r.graph.stats()).toEqual({ nodes: 0, edges: 0, provenance: 0 });
  });

  it("an edge goes with its last source even when both endpoints stay alive on other sources", () => {
    const r = rig();
    r.graph.upsertNode(person, prov({ sourceId: "person-elsewhere" }));
    r.graph.upsertNode(commit, prov({ sourceId: "commit-elsewhere" }));
    r.graph.assertEdge(person, "AUTHORED", commit, prov({ sourceId: "edge-only" }));
    const before = r.graph.stats();
    const report = r.graph.removeSource("event", "edge-only");
    expect(report).toMatchObject({ edges: 1, nodes: 0 });
    expect(r.graph.stats()).toEqual({ nodes: 2, edges: 0, provenance: before.provenance - 3 });
    expect(r.graph.node(OWNER, nodeId(commit))).not.toBeNull();
    expect(r.db.prepare("SELECT COUNT(*) AS n FROM kg_edges").get()).toEqual({ n: 0 });
  });

  it("tombstoning a memory item removes what only it supported (trigger, no application call)", () => {
    const r = rig();
    const out = r.pipeline.capture({
      source: "git",
      sourceRef: "r",
      scope: "repo:o/r",
      contentType: "commit",
      text: "Commit aaaaaaa in r: x",
      observedAt: "2026-10-08T10:00:00.000Z",
      dedupeKey: "git:r:a",
      provenance: { repository: "r", sha: SHA_A },
    });
    if (out.status !== "stored") throw new Error("not stored");
    r.graph.assertEdge(
      person,
      "AUTHORED",
      commit,
      prov({ sourceKind: "memory", sourceId: out.item.id }),
    );
    r.graph.assertEdge(person, "AUTHORED", commit, prov({ sourceId: "evt_live" }));
    r.memory.forget(out.item.id);
    expect(r.graph.edge(OWNER, `Person:ada|AUTHORED|${nodeId(commit)}`)?.provenance).toHaveLength(
      1,
    );
    expect(r.memory.get(out.item.id)?.deletedAt).not.toBeNull();
  });

  it("MemoryStore.forgetWhere and purge also reach the graph", () => {
    const r = rig();
    const ids: string[] = [];
    for (const k of ["a", "b"]) {
      const out = r.pipeline.capture({
        source: "git",
        sourceRef: "r",
        scope: "repo:o/r",
        contentType: "commit",
        text: `Commit ${k}${k}${k}${k}${k}${k}${k} in r: x`,
        observedAt: "2026-10-08T10:00:00.000Z",
        dedupeKey: `git:r:${k}`,
        provenance: { repository: "r", sha: k.repeat(40) },
      });
      if (out.status === "stored") ids.push(out.item.id);
      r.graph.upsertNode(
        { type: "Commit", key: `o/r@${k.repeat(40)}` },
        prov({ sourceKind: "memory", sourceId: out.status === "stored" ? out.item.id : "?" }),
      );
    }
    expect(r.graph.stats().nodes).toBe(2);
    r.memory.forgetWhere({ accept: () => true });
    expect(r.graph.stats()).toEqual({ nodes: 0, edges: 0, provenance: 0 });
  });

  it("deleting a meeting removes everything parented to it, and leaves other meetings", () => {
    const r = rig();
    for (const id of ["kage:1", "kage:2"]) {
      r.meetings.upsert({
        capabilityId: "kage",
        externalId: id.slice(5),
        status: "ended",
        title: id,
      });
      r.graph.assertEdge(
        { type: "Decision", key: `${id}#d` },
        "DECIDED_IN",
        { type: "Meeting", key: id },
        prov({
          sourceKind: "meeting",
          sourceId: id,
          parentKey: `meeting:${id}`,
          scope: `meeting:${id}`,
          domain: "meeting",
        }),
      );
    }
    expect(r.graph.stats().edges).toBe(2);
    r.meetings.delete("kage:1");
    expect(r.graph.stats()).toMatchObject({ nodes: 2, edges: 1 });
    expect(r.graph.node(OWNER, "Meeting:kage:1")).toBeNull();
    expect(r.graph.node(OWNER, "Meeting:kage:2")).not.toBeNull();
  });

  it("removeWhere refuses an empty filter; clear empties everything", () => {
    const r = rig();
    r.graph.assertEdge(person, "AUTHORED", commit, prov());
    expect(() => r.graph.removeWhere({})).toThrow(/filter/);
    expect(r.graph.removeWhere({ capability: "git" }).edges).toBe(1);
    expect(r.graph.stats()).toEqual({ nodes: 0, edges: 0, provenance: 0 });
    r.graph.assertEdge(person, "AUTHORED", commit, prov());
    r.graph.clear();
    expect(r.graph.stats().nodes).toBe(0);
  });

  it("retractEdge withdraws one capability's claim only", () => {
    const r = rig();
    const issue = { type: "Issue", key: "o/r#9" } as const;
    r.graph.assertEdge(
      issue,
      "ASSIGNED_TO",
      person,
      prov({ capability: "issues", sourceId: "e1" }),
    );
    r.graph.assertEdge(issue, "ASSIGNED_TO", person, prov({ capability: "other", sourceId: "e2" }));
    expect(r.graph.retractEdge(issue, "ASSIGNED_TO", person, "issues")).toBe(1);
    expect(r.graph.edge(OWNER, "Issue:o/r#9|ASSIGNED_TO|Person:ada")?.provenance).toHaveLength(1);
  });
});

describe("forgetting a person", () => {
  it("removes the node, its edges and its provenance, and stops them coming back", () => {
    const r = rig();
    r.graph.assertEdge(person, "AUTHORED", commit, prov({ sourceId: "e1" }));
    r.graph.assertEdge(person, "AUTHORED", commit, prov({ sourceId: "e2" }));
    r.graph.upsertNode(person, prov({ sourceId: "e3", detail: { name: "Ada Lovelace" } }));
    const report = r.graph.forgetPerson("  ADA ");
    expect(report.nodes).toBeGreaterThanOrEqual(1);
    expect(r.graph.node(OWNER, "Person:ada")).toBeNull();
    expect(r.graph.edge(OWNER, `Person:ada|AUTHORED|${nodeId(commit)}`)).toBeNull();
    const rows = r.db
      .prepare(
        "SELECT COUNT(*) AS n FROM kg_provenance WHERE subject_id LIKE 'Person:ada%' OR subject_id LIKE '%Person:ada%'",
      )
      .get() as { n: number };
    expect(rows.n).toBe(0);
    // The commit, which is not the person, stays.
    expect(r.graph.node(OWNER, nodeId(commit))).not.toBeNull();
    // Re-ingestion cannot bring the person back, and the table holds a hash, not the name.
    expect(r.graph.assertEdge(person, "AUTHORED", commit, prov({ sourceId: "e4" }))).toBeNull();
    expect(r.graph.upsertNode(person, prov())).toBeNull();
    expect(JSON.stringify(r.db.prepare("SELECT * FROM kg_suppressed").all())).not.toContain("ada");
    expect(r.graph.allowPerson("ada")).toBe(true);
    expect(r.graph.upsertNode(person, prov())).not.toBeNull();
  });

  it("ignores names that cannot identify a person", () => {
    const r = rig();
    expect(r.graph.forgetPerson("a@b.co")).toEqual({ provenance: 0, nodes: 0, edges: 0 });
  });
});

describe("permissions", () => {
  function twoScopes() {
    const r = rig();
    const secret = { type: "Decision", key: "m#1" } as const;
    const meeting = { type: "Meeting", key: "kage:7" } as const;
    const issue = { type: "Issue", key: "o/r#5" } as const;
    r.graph.assertEdge(
      secret,
      "DECIDED_IN",
      meeting,
      prov({
        sourceKind: "meeting",
        sourceId: "kage:7",
        scope: "meeting:kage:7",
        domain: "meeting",
        sensitivity: "sensitive",
      }),
    );
    r.graph.assertEdge(
      secret,
      "MENTIONS",
      issue,
      prov({
        sourceId: "e1",
        scope: "meeting:kage:7",
        domain: "meeting",
        sensitivity: "sensitive",
      }),
    );
    r.graph.assertEdge(commit, "MENTIONS", issue, prov({ sourceId: "e2" }));
    return r;
  }

  it("an entity supported only by a source the viewer cannot read is invisible", () => {
    const r = twoScopes();
    const v = viewerOf("repo:*");
    expect(r.graph.node(v, "Decision:m#1")).toBeNull();
    expect(r.graph.node(v, "Meeting:kage:7")).toBeNull();
    expect(r.graph.node(v, "Issue:o/r#5")).not.toBeNull();
    expect(r.graph.findExact(v, "kage:7", 5)).toEqual([]);
    expect(r.graph.node(OWNER, "Decision:m#1")).not.toBeNull();
  });

  it("degree and path existence do not leak: the narrow viewer sees one edge where the owner sees two", () => {
    const r = twoScopes();
    const v = viewerOf("repo:*");
    expect(r.graph.adjacent(OWNER, "Issue:o/r#5", { limit: 10 }).edges).toHaveLength(2);
    const seen = r.graph.adjacent(v, "Issue:o/r#5", { limit: 10 });
    expect(seen.edges).toHaveLength(1);
    expect(seen.truncated).toBe(false);
    // An inspection reports only visible edges, and a limit smaller than the visible count truncates on visible edges alone.
    expect(r.inspector.inspect(v, "Issue:o/r#5")?.visibleEdges).toBe(1);
    expect(r.graph.adjacent(v, "Issue:o/r#5", { limit: 1 }).truncated).toBe(false);
    expect(
      r.inspector
        .neighbors(v, "Issue:o/r#5", { depth: 2 })
        ?.nodes.map((n) => n.id)
        .sort(),
    ).toEqual([nodeId(commit), "Issue:o/r#5"]);
    // Asking the guarded decision directly gives the same answer as a node that does not exist.
    expect(r.inspector.inspect(v, "Decision:m#1")).toEqual(r.inspector.inspect(v, "Decision:nope"));
  });

  it("a node backed by two sources is visible through the readable one, with only that row shown", () => {
    const r = twoScopes();
    r.graph.upsertNode(
      { type: "Decision", key: "m#1" },
      prov({ sourceId: "pub", scope: "repo:o/r", sensitivity: "public" }),
    );
    const view = r.graph.node(viewerOf("repo:*"), "Decision:m#1");
    expect(view?.provenance.map((p) => p.sourceId)).toEqual(["pub"]);
  });

  it("a sensitivity above the grant hides the row even in a granted scope", () => {
    const r = rig();
    r.graph.upsertNode(commit, prov({ sensitivity: "sensitive" }));
    expect(r.graph.node(viewerOf("repo:*"), nodeId(commit))).toBeNull();
  });
});
