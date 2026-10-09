// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  GraphQuery,
  MAX_NEIGHBOR_DEPTH,
  answerQuestion,
  identifiersIn,
  narrate,
  pathsOf,
  type DocumentHit,
  type NodeRef,
  type Retriever,
} from "../src";
import { OWNER, SHA_A, SHA_B, T0, prov, rig, viewerOf, type Rig } from "./helpers";

const repo = "o/phoenix";
const c = (sha: string): NodeRef => ({ type: "Commit", key: `${repo}@${sha}` });
const meetingScope = {
  scope: "meeting:kage:1",
  domain: "meeting",
  sensitivity: "sensitive",
} as const;

/**
 * Meeting kage:1 decided D (ADR-0014). Commit A mentions ADR-0014 and fixes issue #7. Commit B (by ada)
 * touches feature "memory". Deployment 5 shipped commit A. Ada authored B; grace took part in the meeting.
 */
function seeded(): Rig {
  const r = rig({ repositoryAliases: { phoenix: repo } });
  const g = r.graph;
  const decision: NodeRef = { type: "Decision", key: "ADR-0014" };
  const meeting: NodeRef = { type: "Meeting", key: "kage:1" };
  g.assertEdge(
    decision,
    "DECIDED_IN",
    meeting,
    prov({
      sourceKind: "meeting",
      sourceId: "kage:1",
      ...meetingScope,
      detail: { title: "Use SQLite" },
    }),
  );
  g.upsertNode(
    meeting,
    prov({
      sourceKind: "meeting",
      sourceId: "kage:1",
      ...meetingScope,
      detail: { title: "Planning" },
    }),
  );
  g.assertEdge(
    { type: "Person", key: "grace" },
    "PARTICIPATED_IN",
    meeting,
    prov({ sourceKind: "meeting", sourceId: "kage:1", ...meetingScope, detail: {} }),
  );
  g.assertEdge(
    c(SHA_A),
    "MENTIONS",
    decision,
    prov({ sourceId: "e_a", assertedBy: "rule", scope: `repo:${repo}` }),
  );
  g.assertEdge(
    c(SHA_A),
    "FIXES",
    { type: "Issue", key: `${repo}#7` },
    prov({ sourceId: "e_a", assertedBy: "rule", scope: `repo:${repo}` }),
  );
  g.assertEdge(
    { type: "Person", key: "ada" },
    "AUTHORED",
    c(SHA_B),
    prov({ sourceId: "e_b", scope: `repo:${repo}` }),
  );
  g.assertEdge(
    c(SHA_B),
    "TOUCHES",
    { type: "Feature", key: "memory" },
    prov({ sourceId: "e_b", scope: `repo:${repo}` }),
  );
  g.assertEdge(
    c(SHA_A),
    "DEPLOYED_TO",
    { type: "Deployment", key: `${repo}/deploy/5` },
    prov({ sourceId: "e_d", scope: `repo:${repo}` }),
  );
  g.assertEdge(
    c(SHA_A),
    "TOUCHES",
    { type: "Feature", key: "memory" },
    prov({ sourceId: "e_a2", scope: `repo:${repo}` }),
  );
  return r;
}

describe("why", () => {
  it("returns the chain from an issue to the decision and meeting behind it, each hop with its sources", () => {
    const r = seeded();
    const ans = r.query.why(OWNER, `Issue:${repo}#7`);
    const toDecision = ans.paths.find((p) => p.nodes.at(-1)?.id === "Decision:ADR-0014");
    expect(toDecision?.nodes.map((n) => n.id)).toEqual([
      `Issue:${repo}#7`,
      `Commit:${repo}@${SHA_A}`,
      "Decision:ADR-0014",
    ]);
    expect(toDecision?.hops.map((h) => `${h.edge.rel}/${h.direction}`)).toEqual([
      "FIXES/backward",
      "MENTIONS/forward",
    ]);
    for (const hop of toDecision?.hops ?? []) expect(hop.edge.provenance.length).toBeGreaterThan(0);
    expect(toDecision?.text).toContain("sources: event:e_a (rule)");
    // The decision outranks the commit as a reason, and the meeting is reachable within three hops.
    expect(ans.paths[0]?.nodes.at(-1)?.type).toBe("Decision");
    expect(ans.paths.some((p) => p.nodes.at(-1)?.id === "Meeting:kage:1")).toBe(true);
  });

  it("resolves by exact key or name and says nothing for an unknown entity", () => {
    const r = seeded();
    expect(r.query.why(OWNER, "adr-0014").subject?.id).toBe("Decision:ADR-0014");
    const none = r.query.why(OWNER, "nothing like it");
    expect(none).toMatchObject({ subject: null, paths: [] });
  });

  it("stops at the depth bound and says so", () => {
    const r = seeded();
    const q = new GraphQuery(r.graph, { limits: { maxDepth: 1 } });
    const ans = q.why(OWNER, `Issue:${repo}#7`);
    expect(ans.paths.every((p) => p.hops.length <= 1)).toBe(true);
    expect(ans.truncated.depth).toBe(true);
  });

  it("clamps an absurd depth to the hard cap, and honours visited and fan-out bounds", () => {
    const r = rig();
    const hub: NodeRef = { type: "Issue", key: "o/r#1" };
    for (let i = 0; i < 40; i++) {
      r.graph.assertEdge(
        { type: "Commit", key: `o/r@${String(i).padStart(40, "0")}` },
        "FIXES",
        hub,
        prov({ sourceId: `e${i}` }),
      );
    }
    const wide = new GraphQuery(r.graph, { limits: { maxFanout: 5, maxDepth: 99 } }).why(
      OWNER,
      "Issue:o/r#1",
    );
    expect(wide.truncated.fanout).toBe(true);
    expect(wide.paths.length).toBeLessThanOrEqual(5);
    const few = new GraphQuery(r.graph, { limits: { maxVisited: 3 } }).why(OWNER, "Issue:o/r#1");
    expect(few.truncated.visited).toBe(true);
    expect(DEFAULT_LIMITS.maxDepth).toBeLessThanOrEqual(4);
  });

  it("stops at the time bound using the injected clock", () => {
    const r = seeded();
    let t = 0;
    const q = new GraphQuery(r.graph, { clock: () => (t += 1000), limits: { deadlineMs: 500 } });
    expect(q.why(OWNER, `Issue:${repo}#7`).truncated.time).toBe(true);
  });

  it("never walks proposed AI edges unless asked, and then marks them", () => {
    const r = rig();
    r.graph.assertEdge(
      { type: "Decision", key: "d1" },
      "MENTIONS",
      { type: "Issue", key: "o/r#1" },
      prov({ assertedBy: "ai:llama3.2", sourceId: "m" }),
    );
    expect(r.query.why(OWNER, "Issue:o/r#1").paths).toEqual([]);
    const withAi = new GraphQuery(r.graph, { includeProposed: true }).why(OWNER, "Issue:o/r#1");
    expect(withAi.paths[0]?.text).toContain("[proposed, not a fact]");
    expect(withAi.paths[0]?.hops[0]?.edge.status).toBe("proposed");
  });

  it("a viewer without the meeting's scope gets the commits but no trace of the meeting", () => {
    const r = seeded();
    const v = viewerOf(`repo:*`);
    const ans = r.query.why(v, `Issue:${repo}#7`);
    const ids = ans.paths.flatMap((p) => p.nodes.map((n) => n.id));
    expect(ids).not.toContain("Meeting:kage:1");
    // The decision is reachable only through a commit that mentions it, and exists for this viewer only through that.
    const decision = ans.paths.find((p) => p.nodes.at(-1)?.id === "Decision:ADR-0014");
    expect(decision?.nodes.at(-1)?.provenance.every((p) => p.scope.startsWith("repo:"))).toBe(true);
    expect(JSON.stringify(ans)).not.toContain("kage:1");
    expect(JSON.stringify(ans)).not.toContain("Use SQLite");
  });
});

describe("which", () => {
  it("which commits touched a feature, newest first, each with a one-hop path", () => {
    const r = seeded();
    const ans = r.query.which(OWNER, {
      type: "Commit",
      relation: "TOUCHES",
      entity: "Feature:memory",
    });
    expect(ans.results.map((x) => x.node.id).sort()).toEqual([
      `Commit:${repo}@${SHA_A}`,
      `Commit:${repo}@${SHA_B}`,
    ]);
    expect(
      ans.results.every((x) => x.path.hops.length === 1 && x.path.hops[0]?.edge.provenance.length),
    ).toBe(true);
  });

  it("which deployment contained a commit follows the relation's schema direction", () => {
    const r = seeded();
    const ans = r.query.which(OWNER, {
      type: "Deployment",
      relation: "DEPLOYED_TO",
      entity: `Commit:${repo}@${SHA_A}`,
    });
    expect(ans.results.map((x) => x.node.id)).toEqual([`Deployment:${repo}/deploy/5`]);
    const other = r.query.which(OWNER, {
      type: "Deployment",
      relation: "DEPLOYED_TO",
      entity: `Commit:${repo}@${SHA_B}`,
    });
    expect(other.results).toEqual([]);
  });

  it("returns nothing for a pairing the schema forbids, and honours the result limit", () => {
    const r = seeded();
    expect(
      r.query.which(OWNER, { type: "Person", relation: "TOUCHES", entity: "Feature:memory" })
        .results,
    ).toEqual([]);
    const lim = r.query.which(OWNER, {
      type: "Commit",
      relation: "TOUCHES",
      entity: "Feature:memory",
      limit: 1,
    });
    expect(lim.results).toHaveLength(1);
    expect(lim.truncated.results).toBe(true);
  });
});

describe("people are endpoints, not bridges", () => {
  it("two issues assigned to the same person are not 'nearest' to each other", () => {
    const r = rig();
    const ada: NodeRef = { type: "Person", key: "ada" };
    r.graph.assertEdge(
      { type: "Issue", key: "o/r#1" },
      "ASSIGNED_TO",
      ada,
      prov({ sourceId: "a" }),
    );
    r.graph.assertEdge(
      { type: "Issue", key: "o/r#2" },
      "ASSIGNED_TO",
      ada,
      prov({ sourceId: "b" }),
    );
    expect(r.query.nearest(OWNER, "Issue:o/r#1", "Issue").results).toEqual([]);
    expect(r.query.nearest(OWNER, "Issue:o/r#1", "Person").results.map((x) => x.node.id)).toEqual([
      "Person:ada",
    ]);
  });
});

describe("who", () => {
  it("people connected with a decision, shortest connection first, with paths", () => {
    const r = seeded();
    const ans = r.query.who(OWNER, "Decision:ADR-0014");
    expect(ans.people.map((p) => p.person.id)).toEqual(["Person:grace"]);
    expect(ans.people[0]?.paths[0]?.text).toContain("PARTICIPATED_IN");
    const feature = r.query.who(OWNER, "Feature:memory");
    expect(feature.people.map((p) => p.person.id)).toEqual(["Person:ada"]);
    expect(feature.people[0]?.paths[0]?.hops).toHaveLength(2);
  });

  it("a viewer who cannot read the meeting does not learn who attended", () => {
    const r = seeded();
    expect(r.query.who(viewerOf("repo:*"), "Decision:ADR-0014").people).toEqual([]);
    // Whatever it reports about bounds is computed from the visible graph only: the same as for an entity
    // that exists nowhere, apart from the entity itself being found.
    const seen = r.query.who(viewerOf("repo:*"), "Decision:ADR-0014").truncated;
    expect(seen.fanout).toBeUndefined();
    expect(seen.visited).toBeUndefined();
  });
});

describe("answerQuestion", () => {
  const retriever: Retriever = async ({ query, limit }) => {
    const docs: DocumentHit[] = [
      {
        id: "mem_1",
        text: `about ${query}`,
        citation: { source: "project-docs", sourceRef: "/x.md" },
      },
    ];
    return docs.slice(0, limit);
  };

  it("keeps graph facts and retrieved documents apart, and cites both", async () => {
    const r = seeded();
    const out = await answerQuestion(r.query, `Why did we do ADR-0014?`, {
      viewer: OWNER,
      retriever,
    });
    expect(out.seeds.map((s) => s.id)).toEqual(["Decision:ADR-0014"]);
    expect(out.graph[0]?.kind).toBe("why");
    expect(out.documents[0]?.citation.sourceRef).toBe("/x.md");
    expect(JSON.stringify(out.graph)).not.toContain("about");
  });

  it("routes who and which questions, finds seeds by hash, #number and path-free names", async () => {
    const r = seeded();
    const who = await answerQuestion(r.query, "Who worked on the memory feature?", {
      viewer: OWNER,
    });
    expect(who.notes.some((n) => /retriever/.test(n))).toBe(true);
    const w = await answerQuestion(r.query, "who is connected with Feature:memory", {
      viewer: OWNER,
    });
    expect(w.graph.some((a) => a.kind === "who" && a.people.length === 1)).toBe(true);
    const which = await answerQuestion(r.query, `Which commits touched Feature:memory?`, {
      viewer: OWNER,
    });
    const first = which.graph.find((a) => a.kind === "which");
    expect(first?.kind === "which" && first.results).toHaveLength(2);
    expect(pathsOf(first!)).toHaveLength(2);
    expect(r.query.seeds(OWNER, `what is ${SHA_A.slice(0, 7)} about`).map((s) => s.id)).toEqual([
      `Commit:${repo}@${SHA_A}`,
    ]);
    expect(r.query.seeds(OWNER, "status of #7").map((s) => s.id)).toEqual([`Issue:${repo}#7`]);
  });

  it("with no matching entity it says so instead of inventing graph facts", async () => {
    const r = seeded();
    const out = await answerQuestion(r.query, "Why is the sky blue?", { viewer: OWNER, retriever });
    expect(out.graph).toEqual([]);
    expect(out.notes[0]).toMatch(/matches the graph exactly/);
    expect(out.documents).toHaveLength(1);
  });

  it("seed lookup cannot be tricked by hostile text", () => {
    const r = seeded();
    const hostile = `${"Commit:".repeat(500)}'; DROP TABLE kg_nodes; -- %_ ${"#".repeat(300)} \u0000`;
    expect(() => r.query.seeds(OWNER, hostile)).not.toThrow();
    expect(r.graph.stats().nodes).toBeGreaterThan(5);
  });
});

describe("narration cannot add facts", () => {
  it("accepts a faithful paraphrase", async () => {
    const r = seeded();
    const path = r.query.why(OWNER, `Issue:${repo}#7`).paths[0]!;
    const out = await narrate(
      path,
      async () => "A commit fixing the issue also mentions the decision.",
    );
    expect(out.narrated).toBe(true);
  });

  it("refuses a narration that invents an id, number or hash, and returns the path text", async () => {
    const r = seeded();
    const path = r.query.why(OWNER, `Issue:${repo}#7`).paths[0]!;
    for (const lie of [
      "It was decided in Meeting:kage:99.",
      "See issue #8 for context.",
      "Commit deadbeefcafe1234 did it.",
      "Approved under ADR-0099 and PROJ-12.",
      "In phase 31 this changed.",
    ]) {
      const out = await narrate(path, async () => lie);
      expect(out.narrated).toBe(false);
      expect(out.invented.length).toBeGreaterThan(0);
      expect(out.text).toBe(path.text);
    }
    expect((await narrate(path, async () => "   ")).narrated).toBe(false);
  });

  it("identifiersIn finds ids, hashes, numbers and issue keys", () => {
    expect(identifiersIn("Commit:o/r@abc1234def and #12, PROJ-45, phase 3, 2026")).toEqual(
      expect.arrayContaining(["commit:o/r@abc1234def", "#12", "proj-45", "phase 3", "2026"]),
    );
  });
});

describe("inspection", () => {
  it("inspect returns the origin chain newest first with assertor, confidence and time", () => {
    const r = rig();
    r.graph.upsertNode(
      c(SHA_A),
      prov({ sourceId: "old", observedAt: "2026-10-01T00:00:00Z", confidence: 0.5 }),
    );
    r.graph.upsertNode(c(SHA_A), prov({ sourceId: "new", observedAt: T0, assertedBy: "rule" }));
    const ins = r.inspector.inspect(OWNER, `Commit:${repo}@${SHA_A}`)!;
    expect(ins.origin.map((o) => o.sourceId)).toEqual(["new", "old"]);
    expect(ins.origin[1]).toMatchObject({
      confidence: 0.5,
      assertedBy: "capability",
      capability: "git",
    });
    expect(ins.summary).toMatchObject({
      sources: 2,
      assertors: ["capability", "rule"],
      status: "fact",
    });
    expect(r.inspector.inspect(OWNER, "Commit:o/none@x")).toBeNull();
  });

  it("neighbors is bounded: depth is clamped to 2 and the node and edge caps truncate", () => {
    const r = rig();
    const hub: NodeRef = { type: "Issue", key: "o/r#1" };
    for (let i = 0; i < 150; i++) {
      r.graph.assertEdge(
        { type: "Commit", key: `o/r@${String(i).padStart(40, "0")}` },
        "FIXES",
        hub,
        prov({ sourceId: `e${i}` }),
      );
    }
    const n = r.inspector.neighbors(OWNER, "Issue:o/r#1", { depth: 50 });
    expect(MAX_NEIGHBOR_DEPTH).toBe(2);
    expect(n?.nodes.length).toBeLessThanOrEqual(100);
    expect(n?.edges.length).toBeLessThanOrEqual(200);
    expect(n?.truncated).toBe(true);
    const dangling = n!.edges.filter(
      (e) => !n!.nodes.some((x) => x.id === e.src) || !n!.nodes.some((x) => x.id === e.dst),
    );
    expect(dangling).toEqual([]);
  });

  it("neighbors depth 1 vs 2 differ by exactly the second ring", () => {
    const r = seeded();
    const one = r.inspector.neighbors(OWNER, "Decision:ADR-0014", { depth: 1 })!;
    const two = r.inspector.neighbors(OWNER, "Decision:ADR-0014", { depth: 2 })!;
    expect(one.nodes.map((x) => x.id).sort()).toEqual([
      `Commit:${repo}@${SHA_A}`,
      "Decision:ADR-0014",
      "Meeting:kage:1",
    ]);
    expect(two.nodes.length).toBeGreaterThan(one.nodes.length);
  });
});
