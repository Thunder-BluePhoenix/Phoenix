// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The three systems the pre-registered benchmark (spec.ts) compares. The baselines use only
// @phoenix/ai-memory: a bm25 search over memories built the way Phoenix builds them.
import {
  GIT_LOG_FORMAT,
  MemoryPipeline,
  MemoryStore,
  buildMatchQuery,
  commitCapture,
  createDefaultPolicy,
  ingestCommits,
  ingestDocs,
  ownerViewer,
  parseGitLog,
  type DocReader,
  type MemoryItem,
} from "@phoenix/ai-memory";
import { openDatabase } from "@phoenix/persistence";
import { createEvent, type PhoenixEvent } from "@phoenix/protocol";
import { diffPulls, diffRuns, parsePulls, parseRuns } from "../../../../capabilities/github/src";
import {
  GraphIngestor,
  GraphQuery,
  KnowledgeGraph,
  answerQuestion,
  readGitHistory,
  type GraphAnswer,
  type GraphCommit,
} from "../../src";
import {
  PINNED_REV,
  REPOSITORY,
  TOP_K,
  git,
  loadTruth,
  type BenchQuestion,
  type Fixtures,
  type TargetType,
  type Truth,
} from "./spec";

export const DOC_ROOT = "/repo";
const OWNER = ownerViewer("benchmark");

export interface RankedAnswer {
  entities: string[];
}

export type System = (question: BenchQuestion) => Promise<RankedAnswer>;

/** A DocReader over `git show <pinned>:<path>`, so the benchmark never reads the working tree. */
export function gitDocReader(truth: Truth): { reader: DocReader; paths: string[] } {
  const cache: Record<string, string> = {};
  const read = (abs: string): string =>
    (cache[abs] ??= truth.content(abs.slice(DOC_ROOT.length + 1)));
  return {
    paths: truth.mdFiles.map((f) => `${DOC_ROOT}/${f}`),
    reader: {
      stat: async (abs) => ({ size: read(abs).length, modifiedAt: "2026-10-08T00:00:00.000Z" }),
      read: async (abs) => read(abs),
    },
  };
}

/** Events the real github capability would emit for the committed fixtures. */
export function fixtureEvents(fixtures: Fixtures, pullsJson: string): PhoenixEvent[] {
  const ctx = { repository: REPOSITORY, liveSince: 0 };
  const runs = diffRuns(parseRuns(JSON.parse(fixtures.runsJson)), {}, ctx);
  const pulls = diffPulls(parsePulls(JSON.parse(pullsJson)), {}, ctx);
  const events: PhoenixEvent[] = [];
  for (const change of runs.changes) {
    const at = change.run.updatedAt ?? change.run.createdAt ?? 0;
    events.push(
      createEvent({ ...change.event, source: "github", timestamp: new Date(at).toISOString() }),
    );
  }
  for (const e of pulls.events)
    events.push(createEvent({ ...e, source: "github", timestamp: "2026-10-03T18:47:10.000Z" }));
  return events;
}

// -------------------------------------------------------------------- graph

export interface GraphSystem {
  system: System;
  graph: KnowledgeGraph;
  ingested: { commits: number; docs: number; events: number };
}

function keyOf(id: string, type: TargetType): string {
  if (type === "Commit") return id.slice(id.indexOf("@") + 1);
  if (type === "Document") return id.slice(id.indexOf(":", "Document:".length) + 1);
  if (type === "CIRun") return id.slice(id.lastIndexOf("/") + 1);
  return id.slice("Person:".length);
}

function entitiesOf(answers: readonly GraphAnswer[], type: TargetType): string[] {
  const out: string[] = [];
  const add = (id: string): void => {
    if (id.startsWith(`${type}:`)) {
      const key = keyOf(id, type);
      if (!out.includes(key)) out.push(key);
    }
  };
  for (const a of answers) {
    if (a.kind === "which") for (const r of a.results) add(r.node.id);
    else if (a.kind === "who") for (const p of a.people) add(p.person.id);
    else for (const path of a.paths) add(path.nodes.at(-1)?.id ?? "");
  }
  return out;
}

export async function buildGraphSystem(
  repo: string,
  truth: Truth,
  fixtures: Fixtures,
  pullsJson: string,
): Promise<GraphSystem> {
  const db = openDatabase(":memory:");
  const graph = new KnowledgeGraph(db);
  const memory = new MemoryStore(db);
  const pipeline = new MemoryPipeline({
    store: memory,
    owner: "benchmark",
    policy: createDefaultPolicy({ isSourceEnabled: () => true, allowSensitive: () => true }),
  });
  const ingest = new GraphIngestor({
    graph,
    knownRepositories: [REPOSITORY],
    documentRoots: [{ root: DOC_ROOT, repository: REPOSITORY }],
  });
  const commits = await readGitHistory(repo, REPOSITORY, { rev: PINNED_REV });
  for (const commit of commits) ingest.ingestCommit(commit);
  const docs = gitDocReader(truth);
  await ingestDocs({ pipeline, store: memory, reader: docs.reader, paths: docs.paths });
  ingest.ingestMemory(memory);
  const events = fixtureEvents(fixtures, pullsJson);
  for (const event of events) ingest.handle(event);
  const query = new GraphQuery(graph);
  return {
    graph,
    ingested: { commits: commits.length, docs: docs.paths.length, events: events.length },
    system: async (q) => {
      const answer = await answerQuestion(query, q.text, { viewer: OWNER });
      return { entities: entitiesOf(answer.graph, q.target) };
    },
  };
}

// ---------------------------------------------------------------- baselines

type BaselineKind = "B1" | "B2";

const HEX = /\b[0-9a-f]{7,40}\b/g;

/** The entities of `type` an item names, by the rules written in spec.ts. */
function itemEntities(
  item: MemoryItem,
  type: TargetType,
  kind: BaselineKind,
  commits: readonly string[],
): string[] {
  const p = item.provenance;
  const out: string[] = [];
  if (type === "Commit") {
    if (typeof p.sha === "string") out.push(p.sha);
    for (const m of item.text.matchAll(HEX)) {
      const hits = commits.filter((c) => c.startsWith(m[0]));
      if (hits.length === 1 && hits[0] !== undefined) out.push(hits[0]);
    }
  } else if (type === "Document") {
    if (typeof p.path === "string") out.push(p.path.slice(DOC_ROOT.length + 1));
  } else if (type === "CIRun") {
    if (typeof p.run_id === "number") out.push(String(p.run_id));
  } else if (kind === "B2" && typeof p.author === "string") out.push(p.author.toLowerCase());
  return out;
}

export interface BaselineSystem {
  system: System;
  memory: MemoryStore;
}

export async function buildBaseline(
  kind: BaselineKind,
  repo: string,
  truth: Truth,
  fixtures: Fixtures,
): Promise<BaselineSystem> {
  const db = openDatabase(":memory:");
  const memory = new MemoryStore(db);
  const pipeline = new MemoryPipeline({
    store: memory,
    owner: "benchmark",
    policy: createDefaultPolicy({ isSourceEnabled: () => true, allowSensitive: () => true }),
  });
  const subjects = parseGitLog(REPOSITORY, git(repo, "log", PINNED_REV, GIT_LOG_FORMAT));
  const fullCommits: GraphCommit[] = await readGitHistory(repo, REPOSITORY, {
    rev: PINNED_REV,
  });
  const shas = fullCommits.map((c) => c.sha);
  if (kind === "B1") {
    ingestCommits(pipeline, subjects);
  } else {
    for (const c of fullCommits) {
      const base = commitCapture({
        repository: REPOSITORY,
        sha: c.sha,
        message: c.message,
        at: c.at,
      });
      pipeline.capture({
        ...base,
        text: `${base.text}\nAuthor: ${c.author ?? "unknown"}\nFiles: ${(c.files ?? []).join(", ")}`,
        provenance: { ...base.provenance, author: c.author ?? "" },
      });
    }
    const runs = (JSON.parse(fixtures.runsJson) as { workflow_runs: Record<string, unknown>[] })
      .workflow_runs;
    for (const run of runs) {
      const sha = String(run.head_sha ?? "").slice(0, 7);
      pipeline.capture({
        source: "github",
        sourceRef: String(run.id),
        scope: `repo:${REPOSITORY}`,
        contentType: "note",
        text: `CI run ${String(run.id)} (${String(run.name)}) on ${String(run.head_branch)}: ${String(run.conclusion)}. ${String(run.display_title)}. Commit ${sha}`,
        observedAt: String(run.created_at),
        dedupeKey: `github:run:${String(run.id)}`,
        provenance: { run_id: Number(run.id) },
      });
    }
  }
  const docs = gitDocReader(truth);
  await ingestDocs({ pipeline, store: memory, reader: docs.reader, paths: docs.paths });
  return {
    memory,
    system: async (q) => {
      const match = buildMatchQuery(q.text);
      if (match === null) return { entities: [] };
      const out: string[] = [];
      for (const hit of memory.search({ match, limit: 50 })) {
        for (const e of itemEntities(hit.item, q.target, kind, shas))
          if (!out.includes(e)) out.push(e);
        if (out.length >= TOP_K) break;
      }
      return { entities: out.slice(0, TOP_K) };
    },
  };
}

/** G+B2: the graph's answer if it has at least one entity of the target type, else B2's. */
export function combine(graph: System, b2: System): System {
  return async (q) => {
    const g = await graph(q);
    return g.entities.length > 0 ? g : b2(q);
  };
}

export { loadTruth };
