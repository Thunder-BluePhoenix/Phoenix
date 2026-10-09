// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Capability events, meetings and memory -> graph. Every function here is deterministic: a fact is
// either carried by the source (a commit's author and files, a PR's number and branch, an issue's
// assignee) or spelled out in its text (`#12`, `PROJ-45`, `ADR-0014`, `Phase 13`). Nothing is guessed
// and no model is called. A person is a name or login and nothing else.
//
// Provenance: what a capability reported is asserted by `capability`; what a pattern found in text is
// asserted by `rule` (with the matched words in the detail). Both are facts. Only `ai:<model>` rows,
// which this module never writes, make an edge `proposed`.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { digest as memoryDigest, type MemoryItem, type MemoryStore } from "@phoenix/ai-memory";
import type { PrivacyClass } from "@phoenix/ai-models";
import type { Meeting, Summary } from "@phoenix/persistence";
import type { PhoenixEvent } from "@phoenix/protocol";
import { extractMentions, type MentionContext } from "./extract";
import { KnowledgeGraph, keyProblem, nodeId, personKeyOf } from "./graph";
import type { Assertor, Detail, NodeRef, ProvenanceInput, Relation, SourceKind } from "./types";
import type { MemoryDomain } from "@phoenix/ai-memory";

const run = promisify(execFile);

const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
/** Most files recorded per commit; the rest are counted in the detail, not stored. */
export const MAX_FILES_PER_COMMIT = 200;
const MAX_TEXT = 4000;

/** What the runtime's EventBus offers. A bus handler may take a second argument; ours ignores it. */
export interface EventSubscriber {
  subscribe(
    id: string,
    patterns: string | readonly string[],
    handler: (event: PhoenixEvent) => void | Promise<void>,
  ): () => void;
}

export const GRAPH_EVENT_PATTERNS: readonly string[] = [
  "git.commit.created",
  "github.pr.*",
  "github.ci.*",
  "github.deploy.*",
  "docker.container.*",
  "issues.*",
];

export interface FeatureRule {
  /** Repository-relative path prefix, for example `docs/phases/phase-38-` or `ai/memory/`. */
  prefix: string;
  /** Key of the Feature a commit touching a file under the prefix is connected to. */
  feature: string;
}

export interface DocumentRoot {
  /** Absolute directory of a checkout the user listed as a doc source. */
  root: string;
  /** Repository the files belong to. */
  repository: string;
}

export interface IngestorOptions {
  graph: KnowledgeGraph;
  /** `owner/name` repositories that a text may name in full. */
  knownRepositories?: readonly string[];
  /** Local folder name -> canonical `owner/name` (the git capability reports folder names). */
  repositoryAliases?: Readonly<Record<string, string>>;
  /** Issue tracker prefixes whose `PREFIX-123` counts as an issue. Prefixes already in the graph count too. */
  trackerPrefixes?: readonly string[];
  featureRules?: readonly FeatureRule[];
  documentRoots?: readonly DocumentRoot[];
  /** The login or name the issue tracker means by "assigned to me". Without it no assignee edge is made. */
  selfName?: string;
  /** Files of a commit that arrives as an event (the event carries only the hash). */
  commitFiles?: (repository: string, sha: string) => readonly string[];
}

export interface GraphCommit {
  repository: string;
  sha: string;
  message: string;
  /** ISO commit time. */
  at: string;
  /** A name or login. Never an email. */
  author?: string | undefined;
  branch?: string | null | undefined;
  files?: readonly string[] | undefined;
  /** Event id when the commit came from `git.commit.created`. */
  eventId?: string | undefined;
}

export interface IngestOutcome {
  /** Edges and node assertions written. */
  written: number;
  /** Events or records ignored because they were not the expected shape. */
  skipped: number;
}

export interface MeetingItemRecord {
  id: string;
  kind: string;
  text: string;
  status: string;
  /** `kage`, `manual` or `ai:<model>`. */
  extractedBy: string;
}

interface Base {
  sourceKind: SourceKind;
  sourceId: string;
  parentKey?: string;
  capability: string;
  observedAt: string;
  scope: string;
  domain: MemoryDomain;
  sensitivity: PrivacyClass;
}

const str = (v: unknown, max = 300): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
const posInt = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : undefined;

export class GraphIngestor {
  private readonly graph: KnowledgeGraph;
  private readonly repos: Record<string, true> = {};
  private readonly aliases: Readonly<Record<string, string>>;
  private readonly prefixes: Record<string, true> = {};
  private readonly rules: readonly FeatureRule[];
  private readonly roots: readonly DocumentRoot[];

  constructor(private readonly options: IngestorOptions) {
    this.graph = options.graph;
    this.aliases = options.repositoryAliases ?? {};
    for (const r of options.knownRepositories ?? []) this.repos[r] = true;
    for (const r of Object.values(this.aliases)) this.repos[r] = true;
    for (const p of options.trackerPrefixes ?? []) this.prefixes[p] = true;
    for (const p of this.graph.issuePrefixes()) this.prefixes[p] = true;
    this.rules = options.featureRules ?? [];
    this.roots = options.documentRoots ?? [];
  }

  /** Subscribes to the capability events the graph understands. Returns the unsubscribe function. */
  attach(subscriber: EventSubscriber, id = "knowledge-graph"): () => void {
    return subscriber.subscribe(id, GRAPH_EVENT_PATTERNS, (event) => void this.handle(event));
  }

  /** One event. Unknown types and malformed payloads are skipped and counted, never thrown. */
  handle(event: PhoenixEvent): IngestOutcome {
    const out: IngestOutcome = { written: 0, skipped: 0 };
    const t = event.event_type;
    try {
      this.graph.transaction(() => {
        const ok =
          t === "git.commit.created"
            ? this.gitEvent(event, out)
            : t.startsWith("github.pr.")
              ? this.prEvent(event, out)
              : t.startsWith("github.ci.")
                ? this.ciEvent(event, out)
                : t.startsWith("github.deploy.")
                  ? this.deployEvent(event, out)
                  : t.startsWith("docker.container.")
                    ? this.dockerEvent(event, out)
                    : t.startsWith("issues.")
                      ? this.issueEvent(event, out)
                      : false;
        if (!ok) out.skipped++;
      });
    } catch {
      // A hostile or oversized payload must not break the subscriber; the event is simply not in the graph.
      return { written: 0, skipped: 1 };
    }
    return out;
  }

  // ----------------------------------------------------------------- git

  /** Canonical repository name: an alias, or the one known `owner/name` ending in `/<name>`. */
  canonicalRepository(name: string): string {
    const alias = this.aliases[name];
    if (alias !== undefined) return alias;
    if (name.includes("/")) return name;
    const matches = Object.keys(this.repos).filter((r) => r.endsWith(`/${name}`));
    return matches.length === 1 && matches[0] !== undefined ? matches[0] : name;
  }

  /** Backfill or live: one commit, its author, repository, files, features and explicit mentions. */
  ingestCommit(commit: GraphCommit, source?: Partial<Base>): IngestOutcome {
    const out: IngestOutcome = { written: 0, skipped: 0 };
    if (!SHA.test(commit.sha) || Number.isNaN(Date.parse(commit.at))) {
      out.skipped++;
      return out;
    }
    const repo = this.canonicalRepository(commit.repository);
    this.graph.transaction(() => {
      const base: Base = {
        sourceKind: "capability",
        sourceId: `git:${repo}:${commit.sha}`,
        capability: "git",
        observedAt: commit.at,
        scope: `repo:${repo}`,
        domain: "git",
        sensitivity: "internal",
        ...source,
      };
      this.writeCommit(base, repo, commit, out);
    });
    return out;
  }

  private writeCommit(base: Base, repo: string, c: GraphCommit, out: IngestOutcome): void {
    this.repos[repo] = true;
    const ref: NodeRef = { type: "Commit", key: `${repo}@${c.sha}` };
    const subject = c.message.split("\n", 1)[0] ?? "";
    const detail: Detail = {
      title: subject.slice(0, 200),
      sha: c.sha,
      repository: repo,
      ...(c.branch ? { branch: c.branch } : {}),
    };
    this.node(base, ref, detail, out);
    this.edge(base, ref, "PART_OF", { type: "Repository", key: repo }, {}, out);
    const author = c.author === undefined ? null : personKeyOf(c.author);
    if (author !== null && c.author !== undefined) {
      this.person(base, c.author, author, ref, "AUTHORED", out);
    }
    const files = (c.files ?? this.options.commitFiles?.(c.repository, c.sha) ?? [])
      .filter((f) => f.length > 0 && keyProblem("Document", `${repo}:${f}`) === null)
      .slice(0, MAX_FILES_PER_COMMIT);
    const features: Record<string, true> = {};
    for (const file of files) {
      this.edge(
        base,
        ref,
        "TOUCHES",
        { type: "Document", key: `${repo}:${file}` },
        { path: file },
        out,
      );
      for (const rule of this.rules) {
        if (file.startsWith(rule.prefix)) features[rule.feature] = true;
      }
    }
    for (const feature of Object.keys(features)) {
      this.edge(base, ref, "TOUCHES", { type: "Feature", key: feature }, {}, out);
    }
    this.mentions(base, ref, c.message, repo, out);
    this.linkRuns(repo, out);
  }

  private gitEvent(event: PhoenixEvent, out: IngestOutcome): boolean {
    const repository = str(event.payload.repository);
    const sha = str(event.payload.sha, 64);
    if (!repository || !sha || !SHA.test(sha)) return false;
    const commit: GraphCommit = {
      repository,
      sha,
      message: str(event.payload.message, MAX_TEXT) ?? "",
      at: event.timestamp,
      author: str(event.payload.author),
      branch: str(event.payload.branch),
      eventId: event.event_id,
    };
    const repo = this.canonicalRepository(repository);
    const base: Base = {
      sourceKind: "event",
      sourceId: event.event_id,
      capability: "git",
      observedAt: event.timestamp,
      scope: `repo:${repo}`,
      domain: "git",
      sensitivity: "internal",
    };
    this.writeCommit(base, repo, commit, out);
    return true;
  }

  // -------------------------------------------------------------- github

  private repoOf(event: PhoenixEvent): string | null {
    const repo = str(event.payload.repository);
    return repo !== undefined && REPOSITORY.test(repo) ? repo : null;
  }

  private githubBase(event: PhoenixEvent, repo: string): Base {
    return {
      sourceKind: "event",
      sourceId: event.event_id,
      capability: "github",
      observedAt: event.timestamp,
      scope: `repo:${repo}`,
      domain: "git",
      sensitivity: "internal",
    };
  }

  private prEvent(event: PhoenixEvent, out: IngestOutcome): boolean {
    const repo = this.repoOf(event);
    const number = posInt(event.payload.number);
    if (repo === null || number === undefined) return false;
    this.repos[repo] = true;
    const base = this.githubBase(event, repo);
    const ref: NodeRef = { type: "PullRequest", key: `${repo}#${number}` };
    const title = str(event.payload.title, 200) ?? "";
    const state = event.event_type.slice("github.pr.".length).slice(0, 20);
    const detail: Detail = {
      title,
      state,
      ...(str(event.payload.url, 500) ? { url: str(event.payload.url, 500) ?? "" } : {}),
      ...(str(event.payload.branch) ? { branch: str(event.payload.branch) ?? "" } : {}),
      ...(str(event.payload.base) ? { base: str(event.payload.base) ?? "" } : {}),
    };
    this.node(base, ref, detail, out);
    this.edge(base, ref, "PART_OF", { type: "Repository", key: repo }, {}, out);
    const actor = str(event.payload.actor);
    if (actor !== undefined && actor !== "unknown") {
      const key = personKeyOf(actor);
      if (key !== null) this.person(base, actor, key, ref, "AUTHORED", out);
    }
    this.mentions(base, ref, title, repo, out);
    return true;
  }

  private ciEvent(event: PhoenixEvent, out: IngestOutcome): boolean {
    const repo = this.repoOf(event);
    const runId = posInt(event.payload.run_id);
    if (repo === null || runId === undefined) return false;
    this.repos[repo] = true;
    const base = this.githubBase(event, repo);
    const ref: NodeRef = { type: "CIRun", key: `${repo}/run/${runId}` };
    const state = event.event_type.slice("github.ci.".length).slice(0, 20);
    const detail: Detail = {
      title: str(event.payload.title, 200) ?? str(event.payload.workflow, 200) ?? `run ${runId}`,
      state,
    };
    for (const field of ["workflow", "branch", "conclusion", "failed_job", "url"] as const) {
      const v = str(event.payload[field], field === "url" ? 500 : 200);
      if (v !== undefined) detail[field] = v;
    }
    const attempt = posInt(event.payload.attempt);
    if (attempt !== undefined) detail.attempt = attempt;
    // The github capability reports a run's commit as a 7-character hash. It is kept as such in the
    // provenance and linked to a full commit only when exactly one known commit in the repository has
    // that prefix (see linkRuns): a prefix that matches nothing yet, or two commits, links nothing.
    const sha = str(event.payload.commit, 64)?.toLowerCase();
    if (sha !== undefined && /^[0-9a-f]{7,40}$/.test(sha)) detail.commit = sha;
    this.node(base, ref, detail, out);
    this.edge(base, ref, "PART_OF", { type: "Repository", key: repo }, {}, out);
    this.linkRuns(repo, out);
    const actor = str(event.payload.actor);
    if (actor !== undefined && actor !== "unknown") {
      const key = personKeyOf(actor);
      if (key !== null) this.person(base, actor, key, ref, "TRIGGERED", out);
    }
    return true;
  }

  /**
   * Links CI runs to commits once both exist: a run that named a commit by a short hash gets its
   * TRIGGERED edge when exactly one commit of the repository starts with that hash. Ambiguous or
   * unknown hashes link nothing and are retried whenever a commit or run arrives.
   */
  private linkRuns(repo: string, out: IngestOutcome): void {
    for (const pending of this.graph.pendingRunLinks(repo)) {
      const matches = this.graph.commitsWithPrefix(repo, pending.shortSha, 2);
      const full = matches.length === 1 ? matches[0] : undefined;
      if (full === undefined) continue;
      const run: NodeRef = { type: "CIRun", key: pending.run };
      const commit: NodeRef = { type: "Commit", key: `${repo}@${full}` };
      if (this.graph.assertEdge(commit, "TRIGGERED", run, pending.provenance) !== null)
        out.written++;
    }
  }

  private deployEvent(event: PhoenixEvent, out: IngestOutcome): boolean {
    const repo = this.repoOf(event);
    const id = posInt(event.payload.deployment_id);
    if (repo === null || id === undefined) return false;
    this.repos[repo] = true;
    const base = this.githubBase(event, repo);
    const ref: NodeRef = { type: "Deployment", key: `${repo}/deploy/${id}` };
    const environment = str(event.payload.environment, 100) ?? "unknown";
    const detail: Detail = {
      title: `${environment} deployment ${id}`,
      environment,
      state: event.event_type.slice("github.deploy.".length).slice(0, 20),
    };
    const gitRef = str(event.payload.branch, 100);
    if (gitRef !== undefined) detail.ref = gitRef;
    this.node(base, ref, detail, out);
    this.edge(base, ref, "PART_OF", { type: "Repository", key: repo }, {}, out);
    // A deployment names a commit only when its ref is a full hash; a branch name is not a commit.
    if (gitRef !== undefined && SHA.test(gitRef)) {
      this.edge(base, { type: "Commit", key: `${repo}@${gitRef}` }, "DEPLOYED_TO", ref, {}, out);
    }
    const actor = str(event.payload.actor);
    if (actor !== undefined && actor !== "unknown") {
      const key = personKeyOf(actor);
      if (key !== null) this.person(base, actor, key, ref, "TRIGGERED", out);
    }
    return true;
  }

  // -------------------------------------------------------------- docker

  private dockerEvent(event: PhoenixEvent, out: IngestOutcome): boolean {
    const name = str(event.payload.name, 100);
    if (name === undefined) return false;
    const base: Base = {
      sourceKind: "event",
      sourceId: event.event_id,
      capability: "docker",
      observedAt: event.timestamp,
      scope: `service:${name}`,
      domain: "general",
      sensitivity: "internal",
    };
    const ref: NodeRef = { type: "Service", key: name };
    const detail: Detail = {
      title: name,
      state: event.event_type.slice("docker.container.".length).slice(0, 20),
    };
    const image = str(event.payload.image, 200);
    if (image !== undefined) detail.image = image;
    this.node(base, ref, detail, out);
    const project = str(event.payload.compose_project, 100);
    if (project !== undefined) {
      this.edge(base, ref, "PART_OF", { type: "Project", key: project }, { title: project }, out);
    }
    return true;
  }

  // -------------------------------------------------------------- issues

  private issueEvent(event: PhoenixEvent, out: IngestOutcome): boolean {
    const key = str(event.payload.key, 200);
    if (key === undefined || keyProblem("Issue", key) !== null) return false;
    const tracker = str(event.payload.tracker, 40) ?? "issues";
    const repoMatch = /^([A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100})#\d+$/.exec(key);
    const repo = repoMatch?.[1];
    const prefix = /^([A-Z][A-Z0-9]{1,9})-\d+$/.exec(key)?.[1];
    if (prefix !== undefined) this.prefixes[prefix] = true;
    const base: Base = {
      sourceKind: "event",
      sourceId: event.event_id,
      capability: "issues",
      observedAt: event.timestamp,
      scope: repo !== undefined ? `repo:${repo}` : `tracker:${tracker}`,
      domain: "general",
      sensitivity: "internal",
    };
    const ref: NodeRef = { type: "Issue", key };
    const title = str(event.payload.title, 200) ?? key;
    const detail: Detail = { title, tracker };
    for (const field of ["status", "category", "url"] as const) {
      const v = str(event.payload[field], field === "url" ? 500 : 100);
      if (v !== undefined) detail[field] = v;
    }
    this.node(base, ref, detail, out);
    if (repo !== undefined) {
      this.repos[repo] = true;
      this.edge(base, ref, "PART_OF", { type: "Repository", key: repo }, {}, out);
    }
    const self = this.options.selfName;
    const selfKey = self === undefined ? null : personKeyOf(self);
    if (self !== undefined && selfKey !== null) {
      const person: NodeRef = { type: "Person", key: selfKey };
      if (event.event_type === "issues.assigned") {
        this.edge(base, ref, "ASSIGNED_TO", person, { name: self }, out);
      } else if (event.event_type === "issues.unassigned") {
        out.written += this.graph.retractEdge(ref, "ASSIGNED_TO", person, "issues");
      }
    }
    this.mentions(base, ref, title, repo, out);
    return true;
  }

  // ------------------------------------------------------------ meetings

  /**
   * A meeting, its participants (names only; email-shaped entries are skipped) and its decisions.
   * Everything is parented to the meeting, so deleting it removes all of it. `items` are reviewed
   * meeting items: a rejected one is ignored, an accepted or manual one is the user's word, an
   * `ai:` one stays a proposal.
   */
  ingestMeeting(
    meeting: Meeting,
    summary: Summary | null,
    items: readonly MeetingItemRecord[] = [],
  ): IngestOutcome {
    const out: IngestOutcome = { written: 0, skipped: 0 };
    const at = meeting.started_at ?? meeting.ended_at ?? meeting.updated_at;
    const parentKey = `meeting:${meeting.id}`;
    const base: Base = {
      sourceKind: "meeting",
      sourceId: meeting.id,
      parentKey,
      capability: meeting.capability_id,
      observedAt: at,
      scope: parentKey,
      domain: "meeting",
      sensitivity: "sensitive",
    };
    this.graph.transaction(() => {
      const ref: NodeRef = { type: "Meeting", key: meeting.id };
      this.node(base, ref, { title: meeting.title ?? `Meeting ${meeting.external_id}` }, out);
      for (const name of meeting.participants ?? []) {
        const key = typeof name === "string" ? personKeyOf(name) : null;
        if (key === null) {
          out.skipped++;
          continue;
        }
        this.person(base, name, key, ref, "PARTICIPATED_IN", out);
      }
      for (const text of summary?.decisions ?? []) {
        if (typeof text !== "string" || !text.trim()) continue;
        this.decision(
          base,
          ref,
          text.trim(),
          `${meeting.id}#${memoryDigest(text.trim())}`,
          "capability",
          out,
        );
      }
      for (const item of items) {
        if (item.kind !== "decision" || item.status === "rejected" || !item.text.trim()) continue;
        const assertedBy =
          item.extractedBy.startsWith("ai:") && item.status === "proposed"
            ? (item.extractedBy as Assertor)
            : item.status === "accepted" ||
                item.status === "edited" ||
                item.extractedBy === "manual"
              ? "user"
              : "capability";
        const itemBase: Base = { ...base, sourceKind: "meeting_item", sourceId: item.id };
        this.decision(
          itemBase,
          ref,
          item.text.trim(),
          `${meeting.id}#${memoryDigest(item.text.trim())}`,
          assertedBy,
          out,
        );
      }
    });
    return out;
  }

  private decision(
    base: Base,
    meeting: NodeRef,
    text: string,
    key: string,
    assertedBy: Assertor,
    out: IngestOutcome,
  ): void {
    const ref: NodeRef = { type: "Decision", key };
    this.edge(base, ref, "DECIDED_IN", meeting, {}, out, assertedBy, {
      title: text.slice(0, 200),
      text: text.slice(0, 300),
    });
    this.mentions(base, ref, text, undefined, out);
  }

  // -------------------------------------------------------------- memory

  /**
   * Builds graph facts from live memory items (commits, project docs, meeting decisions), citing
   * each memory id as the source: tombstoning the memory removes what only it supported. Returns how
   * many items produced something. Items in other domains are ignored.
   */
  ingestMemory(store: MemoryStore): IngestOutcome {
    const out: IngestOutcome = { written: 0, skipped: 0 };
    for (let offset = 0; ; offset += 500) {
      const page = store.list({ limit: 500, offset });
      for (const item of page) this.ingestMemoryItem(item, out);
      if (page.length < 500) break;
    }
    return out;
  }

  /** One memory item. Idempotent. */
  ingestMemoryItem(
    item: MemoryItem,
    out: IngestOutcome = { written: 0, skipped: 0 },
  ): IngestOutcome {
    if (item.deletedAt !== null || item.kind !== "fact") return out;
    const base: Base = {
      sourceKind: "memory",
      sourceId: item.id,
      capability: item.source,
      observedAt: item.observedAt,
      scope: item.scope,
      domain: item.domain,
      sensitivity: item.sensitivity,
    };
    const p = item.provenance;
    this.graph.transaction(() => {
      if (item.domain === "git") {
        const repository = str(p.repository);
        const sha = str(p.sha, 64);
        if (!repository || !sha || !SHA.test(sha)) return void out.skipped++;
        const repo = this.canonicalRepository(repository);
        const message = item.text.replace(/^Commit [0-9a-f]+(?: on \S+)? in \S+:?\s*/, "");
        this.writeCommit(
          { ...base, scope: `repo:${repo}` },
          repo,
          { repository, sha, message, at: item.observedAt, branch: str(p.branch) },
          out,
        );
      } else if (item.domain === "meeting") {
        const meetingId = str(p.meeting_id);
        if (!meetingId || p.part !== "decision") return void out.skipped++;
        const parent = `meeting:${meetingId}`;
        const body = item.text.replace(/^Decision in "[^"]*":\s*/, "");
        this.decision(
          { ...base, parentKey: parent },
          { type: "Meeting", key: meetingId },
          body,
          `${meetingId}#${memoryDigest(body)}`,
          "capability",
          out,
        );
      } else if (item.domain === "project") {
        const path = str(p.path, 400);
        const doc = path === undefined ? null : this.documentFor(path);
        if (doc === null) return void out.skipped++;
        this.writeDocument(base, doc.repo, doc.rel, item.text, out);
      } else out.skipped++;
    });
    return out;
  }

  private documentFor(absPath: string): { repo: string; rel: string } | null {
    for (const root of this.roots) {
      const prefix = root.root.endsWith("/") ? root.root : `${root.root}/`;
      if (absPath.startsWith(prefix))
        return { repo: root.repository, rel: absPath.slice(prefix.length) };
    }
    return null;
  }

  private writeDocument(
    base: Base,
    repo: string,
    rel: string,
    text: string,
    out: IngestOutcome,
  ): void {
    this.repos[repo] = true;
    const ref: NodeRef = { type: "Document", key: `${repo}:${rel}` };
    this.node(base, ref, { title: rel, path: rel }, out);
    this.edge(base, ref, "PART_OF", { type: "Repository", key: repo }, {}, out);
    const adr = /(?:^|\/)ADR-(\d{4})-[^/]*\.md$/.exec(rel)?.[1];
    if (adr !== undefined) {
      this.edge(base, { type: "Decision", key: `ADR-${adr}` }, "DECIDED_IN", ref, {}, out, "rule", {
        title: `ADR-${adr}`,
      });
    }
    const phase = /(?:^|\/)phase-(\d{2})-[^/]*\.md$/.exec(rel)?.[1];
    if (phase !== undefined) {
      this.edge(
        base,
        ref,
        "REFERENCES",
        { type: "Feature", key: `phase-${phase}` },
        { title: `Phase ${phase}` },
        out,
        "rule",
      );
    }
    this.mentions(base, ref, text, repo, out);
  }

  // ------------------------------------------------------------- helpers

  private provenance(
    base: Base,
    assertedBy: Assertor,
    detail: Detail,
    confidence = 1,
  ): ProvenanceInput {
    return {
      sourceKind: base.sourceKind,
      sourceId: base.sourceId,
      ...(base.parentKey ? { parentKey: base.parentKey } : {}),
      capability: base.capability,
      observedAt: base.observedAt,
      confidence,
      assertedBy,
      scope: base.scope,
      domain: base.domain,
      sensitivity: base.sensitivity,
      detail,
    };
  }

  private node(
    base: Base,
    ref: NodeRef,
    detail: Detail,
    out: IngestOutcome,
    by: Assertor = "capability",
  ): void {
    if (this.graph.upsertNode(ref, this.provenance(base, by, detail)) !== null) out.written++;
  }

  private edge(
    base: Base,
    src: NodeRef,
    rel: Relation,
    dst: NodeRef,
    detail: Detail,
    out: IngestOutcome,
    by: Assertor = "capability",
    srcDetail?: Detail,
    confidence = 1,
  ): void {
    if (srcDetail !== undefined) this.node(base, src, srcDetail, out, by);
    if (
      this.graph.assertEdge(src, rel, dst, this.provenance(base, by, detail, confidence)) !== null
    )
      out.written++;
  }

  /** A person node (display name in detail) with an edge from the person to `other`. */
  private person(
    base: Base,
    display: string,
    key: string,
    other: NodeRef,
    rel: "AUTHORED" | "TRIGGERED" | "PARTICIPATED_IN",
    out: IngestOutcome,
  ): void {
    const person: NodeRef = { type: "Person", key };
    this.edge(base, person, rel, other, {}, out, "capability", { name: display.slice(0, 100) });
  }

  private mentionContext(repo: string | undefined): MentionContext {
    return {
      repository: repo,
      knownRepositories: Object.keys(this.repos),
      trackerPrefixes: Object.keys(this.prefixes),
      hasNode: (id) => this.graph.hasNode(id),
    };
  }

  private mentions(
    base: Base,
    from: NodeRef,
    text: string,
    repo: string | undefined,
    out: IngestOutcome,
  ): void {
    const source = from.type;
    for (const m of extractMentions(text, this.mentionContext(repo))) {
      if (nodeId(m.target) === nodeId(from)) continue;
      // The relation must fit the source's type; a document cannot FIX an issue, a Decision cannot MENTION a Commit.
      try {
        this.edge(
          base,
          from,
          m.rel,
          m.target,
          { matched: m.matched, from_type: source },
          out,
          "rule",
          undefined,
          m.confidence,
        );
      } catch {
        out.skipped++;
      }
    }
  }
}

/** Reads a repository's history with a read-only `git log` (author name, message, files). */
export async function readGitHistory(
  repoPath: string,
  repository: string,
  options: { limit?: number; rev?: string } = {},
): Promise<GraphCommit[]> {
  if (options.rev !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._/~^@-]{0,200}$/.test(options.rev)) {
    throw new Error("rev must be a branch, tag or commit name, never an option");
  }
  const args = [
    "-C",
    repoPath,
    "log",
    "--no-renames",
    "--name-only",
    "--format=%x1e%H%x1f%cI%x1f%an%x1f%B%x1f",
  ];
  if (options.limit !== undefined) args.splice(3, 0, `--max-count=${options.limit}`);
  if (options.rev !== undefined) args.splice(3, 0, options.rev);
  const { stdout } = await run("git", args, { maxBuffer: 256 * 1024 * 1024 });
  const out: GraphCommit[] = [];
  for (const record of stdout.split("\u001e")) {
    const [sha, at, author, message, fileText] = record.split("\u001f");
    if (!sha || !at || !SHA.test(sha.trim()) || Number.isNaN(Date.parse(at))) continue;
    out.push({
      repository,
      sha: sha.trim(),
      at,
      author: author?.trim() || undefined,
      message: (message ?? "").trim(),
      files: (fileText ?? "")
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean),
    });
  }
  return out;
}
