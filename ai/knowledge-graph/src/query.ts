// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Why / which / who. Every answer is the explanation path itself: the entities and edges that lead
// from the question's subject to the answer, each with the provenance rows the viewer may read. A
// traversal is bounded in depth, fan-out, visited nodes and time, and says which bound it hit. It
// only ever walks edges the viewer can see, so an answer, a count or the existence of a path cannot
// reveal something the viewer's grants do not cover. Proposed (AI-only) edges are never walked unless
// the caller asks, and then they are marked.
import { contentWords, tokenize, type Viewer } from "@phoenix/ai-memory";
import { phaseKey } from "./extract";
import { KnowledgeGraph, keyProblem, nodeId, parseNodeId, type VisibilityMemo } from "./graph";
import {
  RELATION_SCHEMA,
  isNodeType,
  type EdgeView,
  type NodeType,
  type NodeView,
  type Relation,
} from "./types";

export interface TraversalLimits {
  /** Longest path in edges. Hard cap 4. */
  maxDepth: number;
  /** Most edges read from one node. */
  maxFanout: number;
  /** Most nodes visited in one question. */
  maxVisited: number;
  /** Wall-clock budget in milliseconds. */
  deadlineMs: number;
}

export const DEFAULT_LIMITS: TraversalLimits = {
  maxDepth: 3,
  maxFanout: 50,
  maxVisited: 2000,
  deadlineMs: 500,
};
export const HARD_MAX_DEPTH = 4;

export interface QueryOptions {
  limits?: Partial<TraversalLimits>;
  /** Monotonic millisecond clock for the time bound. Default `performance.now`. */
  clock?: () => number;
  /** Include proposed (AI-only) edges, marked as such. Default false: they are never facts. */
  includeProposed?: boolean;
}

/** Which bound cut an answer short. An empty object means the search was exhaustive within the bounds. */
export interface Truncation {
  depth?: true;
  fanout?: true;
  visited?: true;
  time?: true;
  results?: true;
}

/** One traversed edge, in the direction it was walked. */
export interface Hop {
  from: string;
  to: string;
  edge: EdgeView;
  /** `forward` = walked src -> dst, `backward` = dst -> src. */
  direction: "forward" | "backward";
}

export interface ExplanationPath {
  /** Entities along the path, start first. */
  nodes: NodeView[];
  hops: Hop[];
  /** One line per hop, for people. Facts only: no words that are not in the graph. */
  text: string;
}

export interface WhyAnswer {
  kind: "why";
  subject: NodeView | null;
  paths: ExplanationPath[];
  truncated: Truncation;
}

export interface WhichAnswer {
  kind: "which";
  subject: NodeView | null;
  relation: Relation;
  type: NodeType;
  results: { node: NodeView; path: ExplanationPath }[];
  truncated: Truncation;
}

export interface WhoPerson {
  person: NodeView;
  /** Shortest connection first. */
  paths: ExplanationPath[];
}

export interface WhoAnswer {
  kind: "who";
  subject: NodeView | null;
  people: WhoPerson[];
  truncated: Truncation;
}

export type GraphAnswer = WhyAnswer | WhichAnswer | WhoAnswer;

/** Relations that carry reasons. Containment (PART_OF) and attendance are not reasons and would only add hubs. */
const WHY_RELATIONS: readonly Relation[] = [
  "DECIDED_IN",
  "MENTIONS",
  "FIXES",
  "DEPLOYED_TO",
  "TRIGGERED",
  "TOUCHES",
  "REFERENCES",
];

/** What a reason is, most telling first. */
const REASON_RANK: Record<string, number> = {
  Decision: 0,
  Meeting: 1,
  Issue: 2,
  PullRequest: 3,
  Commit: 4,
  Document: 5,
  CIRun: 6,
};

/** Relations that connect people. */
const WHO_RELATIONS: readonly Relation[] = [
  "AUTHORED",
  "ASSIGNED_TO",
  "PARTICIPATED_IN",
  "TRIGGERED",
  "DECIDED_IN",
  "MENTIONS",
  "FIXES",
  "TOUCHES",
  "DEPLOYED_TO",
  "REFERENCES",
  "PART_OF",
];

/** Relations `nearest` walks: the ones that carry a connection between work items, not containment. */
const NEAREST_RELATIONS: readonly Relation[] = [...WHY_RELATIONS, "ASSIGNED_TO"];

interface Frontier {
  id: string;
  hops: Hop[];
}

export class GraphQuery {
  constructor(
    private readonly graph: KnowledgeGraph,
    private readonly options: QueryOptions = {},
  ) {}

  /** Resolve an entity by id (`Type:key`) or by exact key. Several matches: the first in id order. */
  resolve(viewer: Viewer, entity: string): NodeView | null {
    const parsed = parseNodeId(entity);
    if (parsed !== null) {
      const view = this.graph.node(viewer, nodeId(parsed));
      if (view) return view;
    }
    return this.graph.findExact(viewer, entity.trim(), 1)[0] ?? null;
  }

  /**
   * The chain of decisions, meetings, issues, pull requests and commits that led to an entity,
   * as explanation paths ranked by how telling the reason is, then by length.
   */
  why(viewer: Viewer, entity: string, options: { limit?: number } = {}): WhyAnswer {
    const subject = this.resolve(viewer, entity);
    const truncated: Truncation = {};
    if (!subject) return { kind: "why", subject, paths: [], truncated };
    const found = this.search(
      viewer,
      subject.id,
      WHY_RELATIONS,
      truncated,
      (node) => node.id !== subject.id && node.type in REASON_RANK,
      undefined,
      true,
    );
    const memo: VisibilityMemo = {};
    const limit = options.limit ?? 10;
    const ranked = found
      .map((f) => ({ f, last: f.hops.at(-1)?.to ?? "" }))
      .sort((a, b) => {
        const ra = REASON_RANK[a.last.slice(0, a.last.indexOf(":"))] ?? 9;
        const rb = REASON_RANK[b.last.slice(0, b.last.indexOf(":"))] ?? 9;
        return ra - rb || a.f.hops.length - b.f.hops.length || (a.last < b.last ? -1 : 1);
      });
    if (ranked.length > limit) truncated.results = true;
    const paths = ranked
      .slice(0, limit)
      .map(({ f }) => this.toPath(viewer, subject.id, f.hops, memo))
      .filter((p): p is ExplanationPath => p !== null);
    return { kind: "why", subject, paths, truncated };
  }

  /**
   * Nodes of `type` joined to the entity by `relation` (one edge). The direction follows from the
   * relation's schema: "which commits touched this feature" walks TOUCHES backward from the feature.
   */
  which(
    viewer: Viewer,
    request: { type: NodeType; relation: Relation; entity: string; limit?: number },
  ): WhichAnswer {
    const subject = this.resolve(viewer, request.entity);
    const truncated: Truncation = {};
    const empty: WhichAnswer = {
      kind: "which",
      subject,
      relation: request.relation,
      type: request.type,
      results: [],
      truncated,
    };
    if (!subject || !isNodeType(request.type)) return empty;
    const schema = RELATION_SCHEMA[request.relation];
    const results: WhichAnswer["results"] = [];
    const memo: VisibilityMemo = {};
    const limit = request.limit ?? 50;
    const limits = this.limits();
    const walk = (direction: "in" | "out"): void => {
      const adj = this.graph.adjacent(
        viewer,
        subject.id,
        {
          direction,
          rel: request.relation,
          includeProposed: this.options.includeProposed === true,
          limit: limits.maxFanout,
        },
        memo,
      );
      if (adj.truncated) truncated.fanout = true;
      for (const edge of adj.edges) {
        const otherId = direction === "in" ? edge.src : edge.dst;
        if (!otherId.startsWith(`${request.type}:`)) continue;
        if (results.length >= limit) {
          truncated.results = true;
          return;
        }
        const node = this.graph.node(viewer, otherId);
        if (!node) continue;
        const hop: Hop = {
          from: subject.id,
          to: otherId,
          edge,
          direction: direction === "in" ? "backward" : "forward",
        };
        const path = this.toPath(viewer, subject.id, [hop], memo);
        if (path) results.push({ node, path });
      }
    };
    if (schema.to.includes(subject.type) && schema.from.includes(request.type)) walk("in");
    if (schema.from.includes(subject.type) && schema.to.includes(request.type)) walk("out");
    results.sort((a, b) => latest(b.node) - latest(a.node) || (a.node.id < b.node.id ? -1 : 1));
    return { ...empty, results };
  }

  /**
   * The entities of `type` closest to the entity: every one at the smallest number of hops at which
   * any exists (at most the depth bound). "Which CI runs ran for commits that touched this file?" is
   * the runs two hops away; commits that touch the same file are farther away and are not returned.
   */
  nearest(
    viewer: Viewer,
    entity: string,
    type: NodeType,
    options: { limit?: number } = {},
  ): WhichAnswer {
    const subject = this.resolve(viewer, entity);
    const truncated: Truncation = {};
    const answer: WhichAnswer = {
      kind: "which",
      subject,
      relation: "TOUCHES",
      type,
      results: [],
      truncated,
    };
    if (!subject || !isNodeType(type)) return answer;
    const found = this.search(
      viewer,
      subject.id,
      NEAREST_RELATIONS,
      truncated,
      (node) => node.type === type && node.id !== subject.id,
      undefined,
      true,
    );
    const shortest = Math.min(...found.map((f) => f.hops.length));
    const memo: VisibilityMemo = {};
    const limit = options.limit ?? 50;
    for (const f of found
      .filter((x) => x.hops.length === shortest)
      .sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (answer.results.length >= limit) {
        truncated.results = true;
        break;
      }
      const path = this.toPath(viewer, subject.id, f.hops, memo);
      const node = path?.nodes.at(-1);
      if (path && node) answer.results.push({ node, path });
    }
    return answer;
  }

  /** People connected with the entity (two edges at most by default), each with the paths that connect them. */
  who(viewer: Viewer, entity: string, options: { limit?: number } = {}): WhoAnswer {
    const subject = this.resolve(viewer, entity);
    const truncated: Truncation = {};
    if (!subject) return { kind: "who", subject, people: [], truncated };
    const memo: VisibilityMemo = {};
    const found = this.search(
      viewer,
      subject.id,
      WHO_RELATIONS,
      truncated,
      (node) => node.type === "Person" && node.id !== subject.id,
      Math.min(this.limits().maxDepth, 2),
      true,
    );
    const byPerson: Record<string, Frontier[]> = {};
    const order: string[] = [];
    for (const f of found) {
      const person = f.hops.at(-1)?.to ?? "";
      if (byPerson[person] === undefined) {
        byPerson[person] = [];
        order.push(person);
      }
      byPerson[person]?.push(f);
    }
    const people: WhoPerson[] = [];
    const limit = options.limit ?? 20;
    for (const id of order) {
      const person = this.graph.node(viewer, id);
      if (!person) continue;
      const paths = (byPerson[id] ?? [])
        .sort((a, b) => a.hops.length - b.hops.length)
        .slice(0, 3)
        .map((f) => this.toPath(viewer, subject.id, f.hops, memo))
        .filter((p): p is ExplanationPath => p !== null);
      if (paths.length === 0) continue;
      if (people.length >= limit) {
        truncated.results = true;
        break;
      }
      people.push({ person, paths });
    }
    people.sort(
      (a, b) =>
        (a.paths[0]?.hops.length ?? 9) - (b.paths[0]?.hops.length ?? 9) ||
        b.paths.length - a.paths.length ||
        (a.person.id < b.person.id ? -1 : 1),
    );
    return { kind: "who", subject, people, truncated };
  }

  /** Entities a question names exactly: ids, keys, issue and PR numbers, ADR and phase numbers, hashes, paths, names. */
  seeds(viewer: Viewer, question: string, limit = 5): NodeView[] {
    const out: NodeView[] = [];
    const seen: Record<string, true> = {};
    const add = (views: readonly NodeView[]): void => {
      for (const v of views) {
        if (out.length < limit && seen[v.id] !== true) {
          seen[v.id] = true;
          out.push(v);
        }
      }
    };
    let text = question.slice(0, 1000);
    // Repository paths first, and then blanked out: "phase-30" inside docs/phases/phase-30-x.md names
    // the file, not Phase 30.
    for (const m of text.matchAll(/(?<![\w])[\w.-]+(?:\/[\w.-]+)+(?![\w])/g)) {
      const token = m[0].replace(/[.]+$/, "");
      add(this.graph.findExact(viewer, token, 2));
      add(this.graph.findBySuffix(viewer, "Document", `:${token}`, 2));
    }
    text = text.replace(/(?<![\w])[\w.-]+(?:\/[\w.-]+)+(?![\w])/g, " ");
    for (const m of text.matchAll(
      /\b(?:Person|Project|Repository|Commit|Service|Deployment|Meeting|Decision|Feature|Issue|PullRequest|CIRun|Document):[^\s,;?]{1,300}/g,
    )) {
      const parsed = parseNodeId(m[0].replace(/[.)]+$/, ""));
      if (parsed !== null) add(this.graph.findExact(viewer, nodeId(parsed), 1));
    }
    for (const m of text.matchAll(/\bADR-(\d{4})\b/gi))
      add(this.graph.findExact(viewer, `ADR-${m[1] ?? ""}`, 1));
    for (const m of text.matchAll(/\bphase[ -](\d{1,3})\b/gi)) {
      add(this.graph.findExact(viewer, phaseKey(m[1] ?? ""), 1));
    }
    for (const m of text.matchAll(/(?<![\w-])[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g))
      add(this.graph.findExact(viewer, m[0], 1));
    for (const m of text.matchAll(
      /(?<![\w/#])(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#(\d{1,7})\b/g,
    )) {
      const hits = this.graph.findBySuffix(viewer, "PullRequest", `#${m[1] ?? ""}`, 3);
      const issues = this.graph.findBySuffix(viewer, "Issue", `#${m[1] ?? ""}`, 3);
      add([...hits, ...issues]);
    }
    for (const m of text.matchAll(/\bruns?\s+#?(\d{3,})\b/gi)) {
      add(this.graph.findBySuffix(viewer, "CIRun", `/run/${m[1] ?? ""}`, 2));
    }
    for (const m of text.matchAll(/\bdeployments?\s+#?(\d{3,})\b/gi)) {
      add(this.graph.findBySuffix(viewer, "Deployment", `/deploy/${m[1] ?? ""}`, 2));
    }
    for (const m of text.matchAll(/\b[0-9a-f]{7,40}\b/gi)) {
      add(this.graph.findCommitsByHash(viewer, m[0], 2));
    }
    const words = tokenize(text);
    for (let n = Math.min(3, words.length); n >= 1; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n).join(" ");
        if (n === 1 && (gram.length < 3 || contentWords(gram).length === 0)) continue;
        if (keyProblem("Person", gram) !== null) continue;
        add(this.graph.findExact(viewer, gram, 1));
      }
    }
    return out;
  }

  // -------------------------------------------------------------- internals

  private limits(): TraversalLimits {
    const l = { ...DEFAULT_LIMITS, ...this.options.limits };
    return { ...l, maxDepth: Math.max(1, Math.min(l.maxDepth, HARD_MAX_DEPTH)) };
  }

  /**
   * Breadth-first search from `start` over `relations` (both directions), returning the shortest
   * path to each node accepted by `accept`. Stops at `maxDepth`, `maxFanout` edges per node,
   * `maxVisited` nodes or the deadline, and records which bound was hit.
   */
  private search(
    viewer: Viewer,
    start: string,
    relations: readonly Relation[],
    truncated: Truncation,
    accept: (node: NodeView) => boolean,
    depthOverride?: number,
    continueThroughMatches = false,
  ): Frontier[] {
    const limits = this.limits();
    const maxDepth = depthOverride ?? limits.maxDepth;
    const clock = this.options.clock ?? (() => performance.now());
    const started = clock();
    const memo: VisibilityMemo = {};
    const seen: Record<string, true> = { [start]: true };
    const matches: Frontier[] = [];
    let layer: Frontier[] = [{ id: start, hops: [] }];
    let visited = 1;
    for (let depth = 0; depth < maxDepth && layer.length > 0; depth++) {
      const next: Frontier[] = [];
      for (const here of layer) {
        for (const rel of relations) {
          const adj = this.graph.adjacent(
            viewer,
            here.id,
            {
              rel,
              includeProposed: this.options.includeProposed === true,
              limit: limits.maxFanout,
            },
            memo,
          );
          if (adj.truncated) truncated.fanout = true;
          for (const edge of adj.edges) {
            const forward = edge.src === here.id;
            const to = forward ? edge.dst : edge.src;
            if (seen[to] === true) continue;
            if (visited >= limits.maxVisited) {
              truncated.visited = true;
              return matches;
            }
            if (clock() - started > limits.deadlineMs) {
              truncated.time = true;
              return matches;
            }
            seen[to] = true;
            visited++;
            const hop: Hop = {
              from: here.id,
              to,
              edge,
              direction: forward ? "forward" : "backward",
            };
            const hops = [...here.hops, hop];
            const node = this.graph.node(viewer, to, memo);
            if (!node) continue;
            const hit = accept(node);
            if (hit) matches.push({ id: to, hops });
            // A person is an endpoint, never a bridge: "ada" authored thousands of things, and a path
            // through her says nothing about how any two of them are related.
            if (node.type !== "Person" && (!hit || continueThroughMatches)) {
              next.push({ id: to, hops });
            }
          }
        }
      }
      layer = next;
      if (depth + 1 === maxDepth && layer.length > 0) truncated.depth = true;
    }
    return matches;
  }

  private toPath(
    viewer: Viewer,
    start: string,
    hops: readonly Hop[],
    memo: VisibilityMemo,
  ): ExplanationPath | null {
    const ids = [start, ...hops.map((h) => h.to)];
    const nodes: NodeView[] = [];
    for (const id of ids) {
      const node = this.graph.node(viewer, id);
      memo[id] = node !== null;
      if (!node) return null;
      nodes.push(node);
    }
    const lines = hops.map((h, i) => describeHop(nodes[i], nodes[i + 1], h));
    return { nodes, hops: [...hops], text: lines.join("\n") };
  }
}

function latest(node: NodeView): number {
  const last = node.provenance.at(-1)?.observedAt;
  return last === undefined ? 0 : Date.parse(last);
}

/** `A --REL--> B` read in the direction of the edge, with the status and the number of sources. */
export function describeHop(a: NodeView | undefined, b: NodeView | undefined, hop: Hop): string {
  const src = hop.direction === "forward" ? a : b;
  const dst = hop.direction === "forward" ? b : a;
  const sources = hop.edge.provenance
    .map((p) => `${p.sourceKind}:${p.sourceId} (${p.assertedBy})`)
    .join("; ");
  const mark = hop.edge.status === "proposed" ? " [proposed, not a fact]" : "";
  return `${label(src, hop.edge.src)} --${hop.edge.rel}--> ${label(dst, hop.edge.dst)}${mark}  [sources: ${sources}]`;
}

function label(node: NodeView | undefined, id: string): string {
  return node ? `${node.id} "${node.label}"` : id;
}
