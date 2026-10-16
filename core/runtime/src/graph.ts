// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The knowledge graph inside Core (Phase 38 wiring, ADR-0020).
//
// What flows in: capability events (commits, PRs, CI, deploys, containers, issues), the memories
// the memory runtime already holds, and meetings and their reviewed items (only while the user
// allows sensitive meeting data). What flows out: provenance inspection, neighbours, and
// why/which/who answers whose body is the explanation path itself. No model builds or queries the
// graph; narration of a path is off unless the user asks for it and AI is on.
//
// A live `git.commit.created` event carries only repository, path, sha and branch, so each new
// commit is also read from the repository (read-only `git log`, author NAME and file paths) and
// cited to that same event: deleting the event deletes what was learned from it.
//
// Deletion: memory and meeting rows leave the graph through the triggers of migrations 11 and 17;
// "sensitive meetings off" calls `removeWhere` here. Every read passes the viewer.
import { statSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import {
  answerQuestion,
  GRAPH_EVENT_PATTERNS,
  GraphIngestor,
  GraphInspector,
  GraphQuery,
  KnowledgeGraph,
  narrate,
  NODE_TYPES,
  pathsOf,
  readGitHistory,
  WorldModel,
  type ResolvedEntity,
  type WorldHop,
  type DocumentHit,
  type DocumentRoot,
  type EdgeView,
  type ExplanationPath,
  type GraphAnswer,
  type NodeView,
  type ProvenanceView,
} from "@phoenix/ai-knowledge-graph";
import type { MeetingItem } from "@phoenix/ai-meetings";
import {
  buildMatchQuery,
  canView,
  MEMORY_DOMAINS,
  type MemoryStore,
  type Viewer,
} from "@phoenix/ai-memory";
import type { AiService } from "@phoenix/ai-models";
import type {
  GraphAnswerView,
  GraphApi,
  GraphAskView,
  GraphEdgeView,
  GraphInspectionView,
  GraphNeighborhoodView,
  GraphNodeView,
  GraphPathView,
  GraphProvenanceView,
  GraphWorldEntityView,
  GraphWorldResultView,
  GraphStatusView,
} from "@phoenix/api";
import type { CapabilityManager } from "@phoenix/capability-manager";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { AuditLog } from "@phoenix/permissions";
import type { Database, MeetingStore } from "@phoenix/persistence";
import type { PhoenixEvent } from "@phoenix/protocol";
import { NOTETAKER_CAPABILITY_ID } from "./notetaker";
import type { RetrievalRuntime } from "./retrieval";

const PURPOSE_NARRATE = "narrate a knowledge graph path";
const MEETING_CAPABILITIES = ["kage", NOTETAKER_CAPABILITY_ID];
/** Counting visible nodes per type stops here, so a huge graph cannot make status slow. */
const COUNT_CAP = 10_000;
const DOCUMENT_LIMIT = 5;
const SHA = /^[0-9a-f]{40}$/;

const provenanceView = (p: ProvenanceView, owner = false): GraphProvenanceView => {
  const detail = { ...p.detail };
  if (!owner) delete detail.source_quote;
  return {
    source_kind: p.sourceKind,
    source_id: p.sourceId,
    capability: p.capability,
    observed_at: p.observedAt,
    recorded_at: p.recordedAt,
    confidence: p.confidence,
    asserted_by: p.assertedBy,
    scope: p.scope,
    domain: p.domain,
    sensitivity: p.sensitivity,
    detail,
  };
};

const nodeView = (n: NodeView, owner = false): GraphNodeView => ({
  id: n.id,
  type: n.type,
  key: n.key,
  label: n.label,
  status: n.status,
  detail: { ...n.detail },
  provenance: n.provenance.map((p) => provenanceView(p, owner)),
});

const edgeView = (e: EdgeView, owner = false): GraphEdgeView => ({
  id: e.id,
  src: e.src,
  rel: e.rel,
  dst: e.dst,
  status: e.status,
  provenance: e.provenance.map((p) => provenanceView(p, owner)),
});

const pathView = (p: ExplanationPath, owner = false): GraphPathView => ({
  nodes: p.nodes.map((n) => nodeView(n, owner)),
  hops: p.hops.map((h) => ({
    from: h.from,
    to: h.to,
    direction: h.direction,
    edge: edgeView(h.edge, owner),
  })),
  text: p.text,
});

const worldEntityView = (entity: ResolvedEntity): GraphWorldEntityView => ({
  node: nodeView(entity.node),
  provenance: entity.provenance.map((p) => provenanceView(p)),
  confidence: entity.confidence,
  observed_at: entity.observedAt,
  age_ms: entity.ageMs,
});

const worldHopView = (hop: WorldHop): GraphWorldResultView["chains"][number]["hops"][number] => ({
  from: hop.from,
  to: hop.to,
  edge: edgeView(hop.edge),
  provenance: hop.provenance.map((p) => provenanceView(p)),
  confidence: hop.confidence,
  observed_at: hop.observedAt,
  age_ms: hop.ageMs,
  meaning: hop.meaning,
});

function answerView(a: GraphAnswer, owner = false): GraphAnswerView {
  const subject = a.subject ? nodeView(a.subject, owner) : null;
  if (a.kind === "why") {
    return {
      kind: "why",
      subject,
      paths: a.paths.map((p) => pathView(p, owner)),
      truncated: { ...a.truncated },
    };
  }
  if (a.kind === "which") {
    return {
      kind: "which",
      subject,
      type: a.type,
      results: a.results.map((r) => ({
        node: nodeView(r.node, owner),
        path: pathView(r.path, owner),
      })),
      truncated: { ...a.truncated },
    };
  }
  return {
    kind: "who",
    subject,
    people: a.people.map((p) => ({
      person: nodeView(p.person, owner),
      paths: p.paths.map((path) => pathView(path, owner)),
    })),
    truncated: { ...a.truncated },
  };
}

export interface GraphDeps {
  db: Database;
  bus: EventBus;
  capabilities: CapabilityManager;
  store: MemoryStore;
  meetings: MeetingStore;
  ai: AiService;
  aiEnabled: () => boolean;
  retrieval: RetrievalRuntime;
  viewer: () => Viewer;
  audit: AuditLog;
  logger: Logger;
  /** Reviewed items of one meeting. */
  itemsOf: (meetingId: string) => readonly MeetingItem[];
  /** True while the user allows sensitive meeting data into Phoenix. */
  meetingsAllowed: () => boolean;
}

export class GraphRuntime implements GraphApi {
  readonly graph: KnowledgeGraph;
  private readonly query: GraphQuery;
  private readonly inspector: GraphInspector;
  private readonly world: WorldModel;
  private readonly unsubscribe: () => void;
  private readonly stopMeetings: () => void;
  private chain: Promise<unknown> = Promise.resolve();
  private commitsBackfilled = 0;
  private lastIngest: GraphStatusView["last_ingest"] = null;
  private closed = false;

  constructor(private readonly d: GraphDeps) {
    this.graph = new KnowledgeGraph(d.db);
    this.query = new GraphQuery(this.graph);
    this.inspector = new GraphInspector(this.graph);
    this.world = new WorldModel(this.graph);
    this.unsubscribe = d.bus.subscribe("knowledge-graph", GRAPH_EVENT_PATTERNS, (event) =>
      this.onEvent(event),
    );
    this.stopMeetings = d.meetings.onChange(() => this.queueMeetingSync());
  }

  // ── Configuration read from the capabilities, on every use ─────────────────

  private repositoryConfig(capability: string): unknown[] {
    try {
      const list = this.d.capabilities.get(capability).config.repositories;
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  /** Absolute paths of the repositories the git capability watches. */
  private gitPaths(): string[] {
    return this.repositoryConfig("git").filter(
      (p): p is string => typeof p === "string" && isAbsolute(p),
    );
  }

  /** Built per use, so a changed capability configuration applies without a restart. */
  private ingestor(): GraphIngestor {
    const documentRoots: DocumentRoot[] = this.gitPaths().map((root) => ({
      root,
      repository: basename(root),
    }));
    const known = this.repositoryConfig("github").filter(
      (r): r is string => typeof r === "string" && /^[\w.-]+\/[\w.-]+$/.test(r),
    );
    return new GraphIngestor({
      graph: this.graph,
      knownRepositories: known,
      documentRoots,
    });
  }

  // ── Ingestion ──────────────────────────────────────────────────────────────

  private onEvent(event: PhoenixEvent): void {
    // Only the capability that owns the event family: a forged `git.commit.created` from another
    // source is not a commit.
    if (
      this.closed ||
      event.source !== event.event_type.split(".")[0] ||
      !this.d.db.prepare("SELECT 1 FROM events WHERE event_id = ?").get(event.event_id)
    )
      return;
    this.ingestor().handle(event);
    if (event.event_type === "git.commit.created") this.enqueue(() => this.backfillCommit(event));
  }

  private enqueue(job: () => Promise<void>): void {
    this.chain = this.chain.then(job).catch((err: unknown) => {
      this.d.logger.warn("graph: background job failed", { error: (err as Error).message });
    });
  }

  /** Resolves when queued commit backfills have finished. */
  async settled(): Promise<void> {
    await this.chain;
  }

  /** Reads the new commit (author name, files) from the watched repository and cites the event. */
  private async backfillCommit(event: PhoenixEvent): Promise<void> {
    if (this.closed) return;
    const sha = event.payload.sha;
    const path = event.payload.path;
    const repository = event.payload.repository;
    if (typeof sha !== "string" || !SHA.test(sha)) return;
    if (typeof path !== "string" || typeof repository !== "string") return;
    // Only a repository the user told the git capability to watch is ever read.
    if (!this.gitPaths().includes(path)) return;
    try {
      if (!statSync(path).isDirectory()) return;
      const [commit] = await readGitHistory(path, repository, { limit: 1, rev: sha });
      if (
        !commit ||
        commit.sha !== sha ||
        this.closed ||
        !this.d.db.prepare("SELECT 1 FROM events WHERE event_id = ?").get(event.event_id)
      )
        return;
      this.ingestor().ingestCommit(
        {
          ...commit,
          branch: typeof event.payload.branch === "string" ? event.payload.branch : null,
        },
        { sourceKind: "event", sourceId: event.event_id },
      );
      this.commitsBackfilled++;
    } catch (err) {
      this.d.logger.warn("graph: could not read the commit", { error: (err as Error).message });
    }
  }

  /** Memories the memory runtime holds (commits, project docs, meeting decisions). Idempotent. */
  ingestMemory(): void {
    if (this.closed) return;
    const out = this.ingestor().ingestMemory(this.d.store);
    this.lastIngest = {
      at: new Date().toISOString(),
      memories: out.written,
      meetings: this.lastIngest?.meetings ?? 0,
    };
  }

  private meetingSyncQueued = false;

  private queueMeetingSync(): void {
    if (this.meetingSyncQueued || this.closed) return;
    this.meetingSyncQueued = true;
    queueMicrotask(() => {
      this.meetingSyncQueued = false;
      this.syncMeetings();
    });
  }

  /** Meetings and their reviewed items, only while sensitive meeting data is allowed. */
  syncMeetings(): void {
    if (this.closed || !this.d.meetingsAllowed()) return;
    const ingestor = this.ingestor();
    let count = 0;
    const all = this.d.meetings.listAll();
    for (const meeting of all) {
      if (!MEETING_CAPABILITIES.includes(meeting.capability_id)) continue;
      try {
        ingestor.ingestMeeting(
          meeting,
          this.d.meetings.summary(meeting.id),
          this.d.itemsOf(meeting.id).map((i) => ({
            id: i.id,
            kind: i.kind,
            text: i.text,
            status: i.status,
            extractedBy: i.extractedBy,
            evidence: i.evidence,
          })),
        );
        count++;
      } catch (err) {
        this.d.logger.warn("graph: meeting ingest failed", { error: (err as Error).message });
      }
    }
    this.lastIngest = {
      at: new Date().toISOString(),
      memories: this.lastIngest?.memories ?? 0,
      meetings: count,
    };
  }

  /** The user switched sensitive meeting data off: nothing derived from meetings stays. */
  removeMeetingData(): void {
    const meetings = this.graph.removeWhere({ sourceKind: "meeting" });
    const items = this.graph.removeWhere({ sourceKind: "meeting_item" });
    this.d.audit.record({
      actor: "user",
      action: "graph.meeting_data.removed",
      decision: "info",
      details: {
        provenance: meetings.provenance + items.provenance,
        nodes: meetings.nodes + items.nodes,
        edges: meetings.edges + items.edges,
      },
    });
  }

  /** Privacy counts only provenance the current viewer can inspect, never hidden graph rows. */
  visibleInventory(): { nodes: number; edges: number; provenance: number } {
    const viewer = this.d.viewer();
    const nodes = new Map<string, number>();
    const edges = new Map<string, number>();
    const rows = this.d.db
      .prepare("SELECT subject_kind, subject_id, scope, domain, sensitivity FROM kg_provenance")
      .iterate() as Iterable<{
      subject_kind: string;
      subject_id: string;
      scope: string;
      domain: string;
      sensitivity: "public" | "internal" | "sensitive";
    }>;
    for (const row of rows) {
      if (
        !canView(viewer, {
          scope: row.scope,
          domain: (MEMORY_DOMAINS as readonly string[]).includes(row.domain)
            ? (row.domain as (typeof MEMORY_DOMAINS)[number])
            : "general",
          sensitivity: row.sensitivity,
        })
      )
        continue;
      const visible = row.subject_kind === "node" ? nodes : edges;
      visible.set(row.subject_id, (visible.get(row.subject_id) ?? 0) + 1);
    }
    let provenance = [...nodes.values()].reduce((sum, n) => sum + n, 0);
    let visibleEdges = 0;
    const edgeRows = this.d.db.prepare("SELECT id, src, dst FROM kg_edges").iterate() as Iterable<{
      id: string;
      src: string;
      dst: string;
    }>;
    for (const edge of edgeRows) {
      if (nodes.has(edge.src) && nodes.has(edge.dst)) {
        const count = edges.get(edge.id) ?? 0;
        if (count > 0) {
          visibleEdges++;
          provenance += count;
        }
      }
    }
    return { nodes: nodes.size, edges: visibleEdges, provenance };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsubscribe();
    this.stopMeetings();
    await this.chain.catch(() => undefined);
  }

  // ── GraphApi ───────────────────────────────────────────────────────────────

  status(): GraphStatusView {
    const viewer = this.d.viewer();
    const counts = this.graph.stats();
    const visible: Record<string, number> = {};
    for (const type of NODE_TYPES) {
      const n = this.graph.listByType(viewer, type, COUNT_CAP).length;
      if (n > 0) visible[type] = n;
    }
    return {
      nodes: counts.nodes,
      edges: counts.edges,
      provenance: counts.provenance,
      visible_nodes_by_type: visible,
      commits_backfilled: this.commitsBackfilled,
      last_ingest: this.lastIngest,
    };
  }

  inspect(nodeId: string): GraphInspectionView | null {
    const viewer = this.d.viewer();
    const found = this.inspector.inspect(viewer, nodeId);
    if (!found) return null;
    const owner = viewer.id === "owner";
    return {
      node: nodeView(found.node, owner),
      origin: found.origin.map((p) => provenanceView(p, owner)),
      summary: { ...found.summary },
      visible_edges: found.visibleEdges,
    };
  }

  neighbors(nodeId: string, depth: number): GraphNeighborhoodView | null {
    const viewer = this.d.viewer();
    const found = this.inspector.neighbors(viewer, nodeId, { depth });
    if (!found) return null;
    const owner = viewer.id === "owner";
    return {
      center: found.center,
      nodes: found.nodes.map((n) => nodeView(n, owner)),
      edges: found.edges.map((e) => edgeView(e, owner)),
      truncated: found.truncated,
    };
  }

  /** Historical cutoff selects revisions only from currently surviving, viewer-readable assertions. */
  failureChains(
    key: string,
    options: { asOf?: string; maxAgeMs?: number; limit?: number },
  ): GraphWorldResultView {
    const result = this.world.rootCauseChains(this.d.viewer(), {
      failure: { type: "Failure", key },
      ...options,
    });
    return {
      subject: result.subject ? worldEntityView(result.subject) : null,
      chains: result.chains.map((chain) => ({
        nodes: chain.nodes.map(worldEntityView),
        hops: chain.hops.map(worldHopView),
        confidence: chain.confidence,
        interpretation: chain.interpretation,
      })),
      truncated: { ...result.truncated },
      as_of: result.asOf,
      max_age_ms: result.maxAgeMs,
    };
  }

  async ask(question: string, options: { narrate: boolean }): Promise<GraphAskView> {
    const viewer = this.d.viewer();
    let info: GraphAskView["retrieval"] = this.d.retrieval.lexicalInfo();
    const answer = await answerQuestion(this.query, question, {
      viewer,
      documentLimit: DOCUMENT_LIMIT,
      retriever: async (request) => {
        const found = await this.d.retrieval.searchMemory({
          text: request.query,
          viewer: request.viewer,
          limit: request.limit,
        });
        info = found.info;
        if (found.hits !== null) {
          return found.hits.map((h): DocumentHit => ({
            id: h.item.id,
            text: h.item.text,
            citation: { source: h.item.source, sourceRef: h.item.sourceRef },
            score: h.score,
          }));
        }
        return this.lexicalDocuments(request.query, request.viewer, request.limit);
      },
    });
    const answers = answer.graph.map((a) => answerView(a, viewer.id === "owner"));
    return {
      question: answer.question,
      seeds: answer.seeds.map((n) => nodeView(n, viewer.id === "owner")),
      answers,
      documents: answer.documents.map((doc) => ({
        id: doc.id,
        text: doc.text,
        source: doc.citation.source,
        source_ref: doc.citation.sourceRef,
        score: doc.score ?? null,
      })),
      notes: answer.notes,
      retrieval: info,
      narration: options.narrate ? await this.narration(answer.graph) : null,
    };
  }

  /** Keyword documents when hybrid retrieval is off. The permission filter runs inside the search. */
  private lexicalDocuments(query: string, viewer: Viewer, limit: number): DocumentHit[] {
    const match = buildMatchQuery(query);
    if (match === null) return [];
    return this.d.store
      .search({ match, limit, accept: (item) => canView(viewer, item) })
      .map((h) => ({
        id: h.item.id,
        text: h.item.text,
        citation: { source: h.item.source, sourceRef: h.item.sourceRef },
        score: h.score,
      }));
  }

  private async narration(answers: readonly GraphAnswer[]): Promise<GraphAskView["narration"]> {
    const first = answers.flatMap((a) => pathsOf(a)).find((p) => p.hops.length > 0);
    if (!first) return null;
    if (!this.d.aiEnabled()) {
      return { text: first.text, narrated: false, processed_by: null };
    }
    let processedBy: string | null = null;
    try {
      const result = await narrate(first, async (prompt) => {
        const outcome = await this.d.ai.run({
          kind: "generate",
          request: {
            // Paths may hold meeting-derived facts: labelled sensitive, with a purpose the cloud
            // gate never allows for sensitive data, so narration stays on this device.
            privacy: "sensitive",
            purpose: PURPOSE_NARRATE,
            messages: [{ role: "user", content: prompt }],
            maxTokens: 200,
            temperature: 0,
          },
        });
        if (outcome.kind !== "generate") return "";
        processedBy = outcome.provenance.processedBy;
        return outcome.result.text;
      });
      return { text: result.text, narrated: result.narrated, processed_by: processedBy };
    } catch {
      return { text: first.text, narrated: false, processed_by: null };
    }
  }

  forgetPerson(name: string): { removed: { provenance: number; nodes: number; edges: number } } {
    const removed = this.graph.forgetPerson(name);
    this.d.audit.record({
      actor: "user",
      action: "graph.person.forgotten",
      decision: "info",
      details: { ...removed },
    });
    return { removed };
  }
}
