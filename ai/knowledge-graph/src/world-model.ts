// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Evidence trail, not causal inference: only explicitly asserted, visible, fresh relations are walked.
import type { Viewer } from "@phoenix/ai-memory";
import { KnowledgeGraph, nodeId, type VisibilityMemo } from "./graph";
import type { Detail, EdgeView, NodeRef, NodeView, ProvenanceView, Relation } from "./types";

export interface WorldModelOptions {
  /** Observation cutoff; revisions of surviving assertions only (withdrawn sources stay withdrawn). */
  asOf?: string;
  /** Maximum age of EACH supporting observation, in milliseconds. Default 90 days. */
  maxAgeMs?: number;
  /** Maximum visible edges inspected at each step (default 40, hard cap 100). */
  maxFanout?: number;
  /** Maximum candidate nodes inspected across the search (default 500, hard cap 2000). */
  maxVisited?: number;
  /** Maximum completed trails (default 10, hard cap 50). */
  limit?: number;
  /** Wall-clock traversal budget (default 500ms, hard cap 2000ms). */
  deadlineMs?: number;
  clock?: () => number;
}

export interface ResolvedEntity {
  node: NodeView;
  provenance: ProvenanceView[];
  confidence: number;
  observedAt: string;
  ageMs: number;
}

export interface WorldHop {
  from: string;
  to: string;
  edge: EdgeView;
  /** Only surviving visible, non-AI, in-window supporting rows. */
  provenance: ProvenanceView[];
  confidence: number;
  observedAt: string;
  ageMs: number;
  /** Describes the relation; never implies that an earlier step caused a later one. */
  meaning: string;
}

export interface WorldChain {
  nodes: ResolvedEntity[];
  hops: WorldHop[];
  confidence: number;
  /** These associations are an investigation trail, not an established root cause. */
  interpretation: "documented association; causation not established";
}

export interface WorldResult {
  subject: ResolvedEntity | null;
  chains: WorldChain[];
  truncated: { fanout?: true; visited?: true; time?: true; results?: true };
  asOf: string;
  maxAgeMs: number;
}

/** The stored direction is explicit. No arbitrary same-project or text-similarity shortcuts. */
const STEPS: readonly {
  type: NodeRef["type"];
  rel: Relation;
  direction: "out" | "in";
  meaning: string;
}[] = [
  {
    type: "Deployment",
    rel: "ASSOCIATED_WITH",
    direction: "out",
    meaning: "failure explicitly associated with deployment; not evidence of causation",
  },
  { type: "Commit", rel: "DEPLOYED_TO", direction: "in", meaning: "commit shipped by deployment" },
  {
    type: "Service",
    rel: "TOUCHES",
    direction: "out",
    meaning: "commit explicitly linked to service",
  },
  {
    type: "Issue",
    rel: "REFERENCES",
    direction: "in",
    meaning: "issue explicitly references service",
  },
  {
    type: "Decision",
    rel: "MENTIONS",
    direction: "out",
    meaning: "issue explicitly mentions decision",
  },
  { type: "Meeting", rel: "DECIDED_IN", direction: "out", meaning: "decision recorded in meeting" },
];

const DAY = 86_400_000;
function bounded(value: number | undefined, fallback: number, max: number, name: string): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1 || n > max)
    throw new RangeError(`${name} must be 1..${max}`);
  return n;
}

function context(options: WorldModelOptions): { at: number; asOf: string; maxAgeMs: number } {
  const at = options.asOf === undefined ? Date.now() : Date.parse(options.asOf);
  if (!Number.isFinite(at)) throw new RangeError("asOf must be a valid date");
  const maxAgeMs = options.maxAgeMs ?? 90 * DAY;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0)
    throw new RangeError("maxAgeMs must be a nonnegative integer");
  return { at, asOf: new Date(at).toISOString(), maxAgeMs };
}

/** An assertion needs an actual non-AI source in the time window; old/future/AI rows do not count. */
function evidence(rows: readonly ProvenanceView[], at: number, maxAgeMs: number): ProvenanceView[] {
  return rows.filter((row) => {
    const observed = Date.parse(row.observedAt);
    const recorded = Date.parse(row.recordedAt);
    return (
      !row.assertedBy.startsWith("ai:") &&
      Number.isFinite(observed) &&
      Number.isFinite(recorded) &&
      observed <= at &&
      recorded <= at &&
      at - observed <= maxAgeMs
    );
  });
}

function resolved(node: NodeView, at: number, maxAgeMs: number): ResolvedEntity | null {
  const provenance = evidence(node.provenance, at, maxAgeMs);
  if (!provenance.length) return null;
  const detail: Detail = Object.assign({}, ...provenance.map((row) => row.detail));
  const title = detail.title ?? detail.name ?? detail.label;
  const label = typeof title === "string" && title.length ? title : node.key;
  const observedAt = provenance.reduce(
    (newest, row) => (row.observedAt > newest ? row.observedAt : newest),
    "",
  );
  return {
    node: { ...node, label, detail, provenance, status: "fact" },
    provenance,
    confidence: Math.max(...provenance.map((row) => row.confidence)),
    observedAt,
    ageMs: at - Date.parse(observedAt),
  };
}

/** Exact typed identity only. Display labels, partial hashes and ambiguous aliases never resolve. */
export class WorldModel {
  constructor(private readonly graph: KnowledgeGraph) {}

  resolve(viewer: Viewer, ref: NodeRef, options: WorldModelOptions = {}): ResolvedEntity | null {
    const { at, maxAgeMs } = context(options);
    const node = this.graph.node(
      viewer,
      nodeId(ref),
      {},
      options.asOf === undefined ? undefined : new Date(at).toISOString(),
    );
    return node ? resolved(node, at, maxAgeMs) : null;
  }

  rootCauseChains(viewer: Viewer, request: { failure: NodeRef } & WorldModelOptions): WorldResult {
    if (request.failure.type !== "Failure") throw new RangeError("failure must have type Failure");
    const { at, asOf, maxAgeMs } = context(request);
    const maxFanout = bounded(request.maxFanout, 40, 100, "maxFanout");
    const maxVisited = bounded(request.maxVisited, 500, 2000, "maxVisited");
    const limit = bounded(request.limit, 10, 50, "limit");
    const deadlineMs = bounded(request.deadlineMs, 500, 2000, "deadlineMs");
    const clock = request.clock ?? (() => performance.now());
    const deadline = clock() + deadlineMs;
    const subject = this.resolve(viewer, request.failure, request);
    const result: WorldResult = { subject, chains: [], truncated: {}, asOf, maxAgeMs };
    if (!subject) return result;
    const memo: VisibilityMemo = {};
    let visited = 0;
    const walk = (nodes: ResolvedEntity[], hops: WorldHop[]): void => {
      if (clock() >= deadline) {
        result.truncated.time = true;
        return;
      }
      if (hops.length === STEPS.length) {
        if (result.chains.length >= limit) {
          result.truncated.results = true;
          return;
        }
        result.chains.push({
          nodes,
          hops,
          confidence: Math.min(...nodes.map((n) => n.confidence), ...hops.map((h) => h.confidence)),
          interpretation: "documented association; causation not established",
        });
        return;
      }
      const step = STEPS[hops.length];
      const current = nodes[nodes.length - 1];
      if (!step || !current) return;
      const adj = this.graph.adjacent(
        viewer,
        current.node.id,
        {
          direction: step.direction,
          rel: step.rel,
          limit: maxFanout,
          includeProposed: false,
        },
        memo,
        request.asOf === undefined ? undefined : asOf,
      );
      if (adj.truncated) result.truncated.fanout = true;
      for (const edge of adj.edges) {
        if (clock() >= deadline) {
          result.truncated.time = true;
          return;
        }
        if (visited >= maxVisited) {
          result.truncated.visited = true;
          return;
        }
        visited++;
        const nextId = step.direction === "out" ? edge.dst : edge.src;
        if (!nextId.startsWith(`${step.type}:`) || nodes.some((n) => n.node.id === nextId))
          continue;
        const provenance = evidence(edge.provenance, at, maxAgeMs);
        if (!provenance.length) continue;
        const nextNode = this.graph.node(
          viewer,
          nextId,
          memo,
          request.asOf === undefined ? undefined : asOf,
        );
        const next = nextNode ? resolved(nextNode, at, maxAgeMs) : null;
        if (!next) continue;
        const observedAt = provenance.reduce(
          (newest, row) => (row.observedAt > newest ? row.observedAt : newest),
          "",
        );
        const hop: WorldHop = {
          from: current.node.id,
          to: nextId,
          edge: { ...edge, provenance, status: "fact" },
          provenance,
          confidence: Math.max(...provenance.map((row) => row.confidence)),
          observedAt,
          ageMs: at - Date.parse(observedAt),
          meaning: step.meaning,
        };
        walk([...nodes, next], [...hops, hop]);
        if (result.truncated.time || result.truncated.visited || result.truncated.results) return;
      }
    };
    walk([subject], []);
    return result;
  }
}
