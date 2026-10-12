// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { WorldModel, type NodeRef, type Relation } from "../src";
import { OWNER, prov, rig, viewerOf } from "./helpers";

const at = "2026-10-09T10:00:00.000Z";
const refs: NodeRef[] = [
  { type: "Failure", key: "prod:incident-7" },
  { type: "Deployment", key: "o/r/deploy/7" },
  { type: "Commit", key: `o/r@${"a".repeat(40)}` },
  { type: "Service", key: "payments" },
  { type: "Issue", key: "ENG-7" },
  { type: "Decision", key: "ADR-7" },
  { type: "Meeting", key: "meeting-7" },
];
const relations: Relation[] = [
  "ASSOCIATED_WITH",
  "DEPLOYED_TO",
  "TOUCHES",
  "REFERENCES",
  "MENTIONS",
  "DECIDED_IN",
];
const edges: [number, number][] = [
  [0, 1],
  [2, 1],
  [2, 3],
  [4, 3],
  [4, 5],
  [5, 6],
];

function setup() {
  const r = rig();
  const world = new WorldModel(r.graph);
  for (const [index, ref] of refs.entries()) {
    r.graph.upsertNode(
      ref,
      prov({ sourceId: `node-${index}`, detail: { title: `label-${index}` } }),
    );
  }
  for (const [index, pair] of edges.entries()) {
    const [from, to] = pair;
    const src = refs[from];
    const dst = refs[to];
    const relation = relations[index];
    if (src && dst && relation)
      r.graph.assertEdge(src, relation, dst, prov({ sourceId: `edge-${index}`, confidence: 0.8 }));
  }
  const failure = refs[0];
  if (!failure) throw new Error("missing fixture");
  return { ...r, world, failure };
}

const query = { asOf: at, maxAgeMs: 2 * 86_400_000 };

describe("temporal world model", () => {
  it("walks only explicit documented associations and never asserts causation", () => {
    const { world, failure } = setup();
    const result = world.rootCauseChains(OWNER, { failure, ...query });
    expect(result.chains).toHaveLength(1);
    const chain = result.chains[0];
    expect(chain?.nodes.map((n) => n.node.type)).toEqual(refs.map((r) => r.type));
    expect(chain?.confidence).toBe(0.8);
    expect(chain?.hops.map((h) => h.edge.rel)).toEqual(relations);
    expect(
      chain?.hops.every(
        (h) => h.provenance.length > 0 && h.confidence === 0.8 && h.ageMs === 86_400_000,
      ),
    ).toBe(true);
    expect(chain?.interpretation).toContain("causation not established");
    expect(JSON.stringify(result)).not.toMatch(/caused by|root cause is/i);
  });

  it("resolves exact typed identity only, never an ambiguous label", () => {
    const { graph, world } = setup();
    graph.upsertNode(
      { type: "Service", key: "billing" },
      prov({ sourceId: "billing", detail: { title: "payments" } }),
    );
    expect(world.resolve(OWNER, { type: "Service", key: "payments" }, query)?.node.key).toBe(
      "payments",
    );
    expect(world.resolve(OWNER, { type: "Service", key: "label-3" }, query)).toBeNull();
    expect(world.resolve(OWNER, { type: "Service", key: "pay" }, query)).toBeNull();
  });

  it("excludes stale, future and AI-only assertions, including endpoints", () => {
    const { graph, world, failure } = setup();
    expect(world.rootCauseChains(OWNER, { failure, asOf: at, maxAgeMs: 1000 }).chains).toEqual([]);
    expect(
      world.rootCauseChains(OWNER, { failure, asOf: "2026-10-07T10:00:00.000Z" }).subject,
    ).toBeNull();
    graph.retractEdge(refs[4]!, "MENTIONS", refs[5]!, "git");
    graph.assertEdge(
      refs[4]!,
      "MENTIONS",
      refs[5]!,
      prov({ sourceId: "ai-edge", assertedBy: "ai:test" }),
    );
    expect(world.rootCauseChains(OWNER, { failure, ...query }).chains).toEqual([]);
  });

  it("uses only fresh supporting rows, even when the edge also has stale evidence", () => {
    const { graph, world, failure } = setup();
    graph.assertEdge(
      refs[4]!,
      "MENTIONS",
      refs[5]!,
      prov({
        sourceId: "stale-assertion",
        observedAt: "2025-01-01T00:00:00.000Z",
        confidence: 0.01,
      }),
    );
    const hop = world.rootCauseChains(OWNER, { failure, ...query }).chains[0]?.hops[4];
    expect(hop?.provenance.map((row) => row.sourceId)).toEqual(["edge-4"]);
    expect(hop?.confidence).toBe(0.8);
  });

  it("honours revoked sources, deleted parents and viewer permissions", () => {
    const { graph, world, failure } = setup();
    graph.assertEdge(
      refs[4]!,
      "MENTIONS",
      refs[5]!,
      prov({ sourceId: "restricted", scope: "repo:secret", parentKey: "meeting:restricted" }),
    );
    graph.removeSource("event", "edge-4");
    expect(world.rootCauseChains(viewerOf("repo:o/r"), { failure, ...query }).chains).toEqual([]);
    expect(world.rootCauseChains(OWNER, { failure, ...query }).chains).toHaveLength(1);
    graph.removeParent("meeting:restricted");
    expect(world.rootCauseChains(OWNER, { failure, ...query }).chains).toEqual([]);
  });

  it("does not invent a link from a same-service deployment or an issue's prose", () => {
    const { graph, world, failure } = setup();
    graph.removeSource("event", "edge-0");
    graph.assertEdge(refs[1]!, "DEPLOYED_TO", refs[3]!, prov({ sourceId: "service-deploy" }));
    expect(world.rootCauseChains(OWNER, { failure, ...query }).chains).toEqual([]);
  });

  it("bounds fanout and does not revisit nodes on a cyclic issue mention", () => {
    const { graph, world, failure } = setup();
    graph.assertEdge(refs[4]!, "MENTIONS", refs[4]!, prov({ sourceId: "self-cycle" }));
    expect(world.rootCauseChains(OWNER, { failure, ...query }).chains).toHaveLength(1);
    for (let i = 0; i < 4; i++) {
      graph.assertEdge(
        refs[0]!,
        "ASSOCIATED_WITH",
        { type: "Deployment", key: `unrelated-${i}` },
        prov({ sourceId: `noise-${i}` }),
      );
    }
    const bounded = world.rootCauseChains(OWNER, { failure, ...query, maxFanout: 1 });
    expect(bounded.truncated.fanout).toBe(true);
    expect(bounded.chains.length).toBeLessThanOrEqual(1);
    const limited = world.rootCauseChains(OWNER, { failure, ...query, maxVisited: 1 });
    expect(limited.truncated.visited).toBe(true);
  });

  it("rejects invalid time and non-failure starting identity", () => {
    const { world } = setup();
    expect(() => world.rootCauseChains(OWNER, { failure: refs[1]!, ...query })).toThrow();
    expect(() => world.resolve(OWNER, refs[0]!, { asOf: "not a date" })).toThrow();
  });
});
