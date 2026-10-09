// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Provenance inspection for the UI: where a node or edge came from, and what is around it. Both
// read only what the viewer may read, and bound everything they return.
import type { Viewer } from "@phoenix/ai-memory";
import { KnowledgeGraph, type VisibilityMemo } from "./graph";
import type { EdgeView, NodeView, ProvenanceView } from "./types";

export const MAX_NEIGHBOR_DEPTH = 2;
export const MAX_NEIGHBOR_NODES = 100;
export const MAX_NEIGHBOR_EDGES = 200;
const PER_NODE_EDGES = 25;

export interface Inspection {
  node: NodeView;
  /** Newest observation first. Every row says where, when, how sure and who asserted it. */
  origin: ProvenanceView[];
  /** Distinct capabilities and source kinds behind the node, for a one-line summary. */
  summary: {
    sources: number;
    assertors: string[];
    capabilities: string[];
    status: NodeView["status"];
  };
  /** Number of visible edges (never a count that includes edges the viewer cannot see). */
  visibleEdges: number;
}

export interface Neighborhood {
  center: string;
  nodes: NodeView[];
  edges: EdgeView[];
  truncated: boolean;
}

export class GraphInspector {
  constructor(private readonly graph: KnowledgeGraph) {}

  /** The origin chain of one node, or null when it does not exist or nothing about it is readable. */
  inspect(viewer: Viewer, nodeId: string): Inspection | null {
    const node = this.graph.node(viewer, nodeId);
    if (!node) return null;
    const origin = [...node.provenance].reverse();
    const adj = this.graph.adjacent(viewer, nodeId, { limit: 1000, includeProposed: true });
    return {
      node,
      origin,
      summary: {
        sources: origin.length,
        assertors: [...new Set(origin.map((o) => o.assertedBy))].sort(),
        capabilities: [...new Set(origin.map((o) => o.capability))].sort(),
        status: node.status,
      },
      visibleEdges: adj.edges.length,
    };
  }

  /** The origin chain of one edge: every source that supports it. */
  inspectEdge(viewer: Viewer, edgeId: string): EdgeView | null {
    return this.graph.edge(viewer, edgeId);
  }

  /** Visible nodes and edges within `depth` (at most 2) of a node. Bounded; says when it cut. */
  neighbors(
    viewer: Viewer,
    nodeId: string,
    options: { depth?: number; includeProposed?: boolean } = {},
  ): Neighborhood | null {
    const depth = Math.max(1, Math.min(Math.floor(options.depth ?? 1), MAX_NEIGHBOR_DEPTH));
    const memo: VisibilityMemo = {};
    const center = this.graph.node(viewer, nodeId, memo);
    if (!center) return null;
    const nodes: Record<string, NodeView> = { [nodeId]: center };
    const edges: Record<string, EdgeView> = {};
    let truncated = false;
    let layer = [nodeId];
    for (let d = 0; d < depth && layer.length > 0; d++) {
      const next: string[] = [];
      for (const id of layer) {
        const adj = this.graph.adjacent(
          viewer,
          id,
          { limit: PER_NODE_EDGES, includeProposed: options.includeProposed === true },
          memo,
        );
        if (adj.truncated) truncated = true;
        for (const edge of adj.edges) {
          const other = edge.src === id ? edge.dst : edge.src;
          if (edges[edge.id] === undefined) {
            if (Object.keys(edges).length >= MAX_NEIGHBOR_EDGES) {
              truncated = true;
              continue;
            }
            edges[edge.id] = edge;
          }
          if (nodes[other] === undefined) {
            if (Object.keys(nodes).length >= MAX_NEIGHBOR_NODES) {
              truncated = true;
              delete edges[edge.id];
              continue;
            }
            const view = this.graph.node(viewer, other, memo);
            if (!view) {
              delete edges[edge.id];
              continue;
            }
            nodes[other] = view;
            next.push(other);
          }
        }
      }
      layer = next;
    }
    return {
      center: nodeId,
      nodes: Object.values(nodes),
      edges: Object.values(edges),
      truncated,
    };
  }
}
