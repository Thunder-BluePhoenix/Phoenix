// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  MemoryPipeline,
  MemoryStore,
  createDefaultPolicy,
  ownerViewer,
  type Viewer,
} from "@phoenix/ai-memory";
import { MeetingStore, openDatabase, type Database } from "@phoenix/persistence";
import type { PhoenixEvent } from "@phoenix/protocol";
import {
  GraphIngestor,
  GraphInspector,
  GraphQuery,
  KnowledgeGraph,
  type IngestorOptions,
  type ProvenanceInput,
} from "../src";

export const T0 = "2026-10-08T10:00:00.000Z";
export const OWNER: Viewer = ownerViewer("owner");
export const SHA_A = "a".repeat(40);
export const SHA_B = "b".repeat(40);
export const SHA_C = "c".repeat(40);

export interface Rig {
  db: Database;
  graph: KnowledgeGraph;
  query: GraphQuery;
  inspector: GraphInspector;
  ingest: GraphIngestor;
  memory: MemoryStore;
  pipeline: MemoryPipeline;
  meetings: MeetingStore;
}

export function rig(options: Partial<IngestorOptions> = {}): Rig {
  const db = openDatabase(":memory:");
  const graph = new KnowledgeGraph(db, { now: () => new Date(T0) });
  let n = 0;
  const memory = new MemoryStore(db, { now: () => new Date(T0), newId: () => `mem_${++n}` });
  return {
    db,
    graph,
    query: new GraphQuery(graph),
    inspector: new GraphInspector(graph),
    ingest: new GraphIngestor({ graph, ...options }),
    memory,
    pipeline: new MemoryPipeline({
      store: memory,
      owner: "me",
      policy: createDefaultPolicy({ isSourceEnabled: () => true, allowSensitive: () => true }),
    }),
    meetings: new MeetingStore(db),
  };
}

export function prov(over: Partial<ProvenanceInput> = {}): ProvenanceInput {
  return {
    sourceKind: "event",
    sourceId: "evt_1",
    capability: "git",
    observedAt: T0,
    assertedBy: "capability",
    scope: "repo:o/r",
    domain: "git",
    sensitivity: "internal",
    ...over,
  };
}

let eventCounter = 0;
export function event(
  event_type: string,
  payload: Record<string, unknown>,
  over: Partial<PhoenixEvent> = {},
): PhoenixEvent {
  eventCounter++;
  return {
    event_id: `evt_t${eventCounter}`,
    event_type,
    version: "1.1",
    source: event_type.split(".")[0] ?? "test",
    timestamp: T0,
    severity: "info",
    payload,
    ...over,
  };
}

/** A viewer who may read only the given scope patterns (internal data at most). */
export function viewerOf(...scopes: string[]): Viewer {
  return { id: "narrow", grants: scopes.map((scope) => ({ scope, maxSensitivity: "internal" })) };
}
