// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { PrivacyClass } from "@phoenix/ai-models";
import type { MemoryDomain } from "@phoenix/ai-memory";

/** The closed set of things the graph knows about. Anything else is rejected, not stored. */
export const NODE_TYPES = [
  "Person",
  "Project",
  "Repository",
  "Commit",
  "Service",
  "Deployment",
  "Meeting",
  "Decision",
  "Feature",
  "Issue",
  "PullRequest",
  "CIRun",
  "Document",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export function isNodeType(value: string): value is NodeType {
  return (NODE_TYPES as readonly string[]).includes(value);
}

/** The closed set of relation types. A relation is stored `src --REL--> dst`. */
export const RELATIONS = [
  "AUTHORED",
  "TOUCHES",
  "PART_OF",
  "DECIDED_IN",
  "MENTIONS",
  "FIXES",
  "DEPLOYED_TO",
  "TRIGGERED",
  "ASSIGNED_TO",
  "REFERENCES",
  "PARTICIPATED_IN",
] as const;
export type Relation = (typeof RELATIONS)[number];

export function isRelation(value: string): value is Relation {
  return (RELATIONS as readonly string[]).includes(value);
}

export interface RelationSchema {
  from: readonly NodeType[];
  to: readonly NodeType[];
  /** Reads `src REL dst`: what the edge claims. */
  meaning: string;
}

/** Which node types each relation may join. `assertEdge` rejects every other pairing. */
export const RELATION_SCHEMA: Record<Relation, RelationSchema> = {
  AUTHORED: {
    from: ["Person"],
    to: ["Commit", "PullRequest"],
    meaning: "the person wrote the commit or opened the pull request",
  },
  TOUCHES: {
    from: ["Commit", "PullRequest"],
    to: ["Feature", "Document"],
    meaning: "the change modified the file (Document) or a path mapped to the feature",
  },
  PART_OF: {
    from: [
      "Commit",
      "PullRequest",
      "CIRun",
      "Deployment",
      "Issue",
      "Document",
      "Repository",
      "Service",
      "Feature",
    ],
    to: ["Repository", "PullRequest", "Project"],
    meaning: "the thing belongs to the repository, pull request or project",
  },
  DECIDED_IN: {
    from: ["Decision"],
    to: ["Meeting", "Document"],
    meaning: "the decision was taken in the meeting, or is written down in the document (an ADR)",
  },
  MENTIONS: {
    from: ["Commit", "PullRequest", "Issue", "Decision", "Meeting", "Document"],
    to: ["Issue", "PullRequest", "Commit", "Decision"],
    meaning: "the text of the source names the issue, pull request or commit",
  },
  FIXES: {
    from: ["Commit", "PullRequest"],
    to: ["Issue"],
    meaning: "the source says it fixes, closes or resolves the issue",
  },
  DEPLOYED_TO: {
    from: ["Commit", "Deployment"],
    to: ["Deployment", "Service"],
    meaning: "the commit was shipped by the deployment, or the deployment went to the service",
  },
  TRIGGERED: {
    from: ["Person", "Commit"],
    to: ["CIRun", "Deployment"],
    meaning: "the person or commit started the run or deployment",
  },
  ASSIGNED_TO: {
    from: ["Issue", "PullRequest"],
    to: ["Person"],
    meaning: "the issue or pull request is assigned to the person",
  },
  REFERENCES: {
    from: ["Commit", "PullRequest", "Issue", "Decision", "Meeting", "Document"],
    to: ["Repository", "Feature", "Project"],
    meaning: "the source names the repository, feature or project",
  },
  PARTICIPATED_IN: {
    from: ["Person"],
    to: ["Meeting"],
    meaning: "the person attended the meeting",
  },
};

/** What a provenance row points at. */
export const SOURCE_KINDS = [
  "event",
  "capability",
  "memory",
  "meeting",
  "meeting_item",
  "user",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Who or what said it. AI-asserted facts are proposals until a person confirms them. */
export type Assertor = "rule" | "capability" | "user" | `ai:${string}`;

export const ASSERTOR_PATTERN = /^(rule|capability|user|ai:[A-Za-z0-9._:/-]{1,80})$/;

/** Small, flat, descriptive values kept with a provenance row (title, state, url ...). */
export type Detail = Record<string, string | number | boolean | null>;

export interface NodeRef {
  type: NodeType;
  key: string;
}

/** Everything a write must say about where a node or edge came from. */
export interface ProvenanceInput {
  sourceKind: SourceKind;
  /** Event id, memory id, meeting id, meeting item id or capability key. */
  sourceId: string;
  /**
   * The record whose deletion also deletes this row, as `meeting:<id>`. Set for everything that is
   * derived from a meeting, so deleting the meeting removes it.
   */
  parentKey?: string;
  /** Who produced the source: git, github, kage, project-docs, user ... */
  capability: string;
  /** When the thing happened (ISO). */
  observedAt: string;
  /** 0..1. Default 1. */
  confidence?: number;
  assertedBy: Assertor;
  /** Same vocabulary as memory: `repo:<name>`, `meeting:<id>`, `path:<abs>`, `service:<name>`. */
  scope: string;
  domain: MemoryDomain;
  sensitivity: PrivacyClass;
  detail?: Detail;
}

/** A provenance row as a reader sees it: only rows the viewer may read are ever returned. */
export interface ProvenanceView {
  sourceKind: SourceKind;
  sourceId: string;
  capability: string;
  observedAt: string;
  recordedAt: string;
  confidence: number;
  assertedBy: string;
  scope: string;
  domain: MemoryDomain;
  sensitivity: PrivacyClass;
  detail: Detail;
}

/** `fact` once a non-AI assertor (rule, capability or user) stands behind it, else `proposed`. */
export type AssertionStatus = "fact" | "proposed";

export interface NodeView {
  id: string;
  type: NodeType;
  key: string;
  /** A human label taken from the newest visible provenance row, else the key. */
  label: string;
  status: AssertionStatus;
  /** Visible provenance details merged oldest to newest, so the latest state wins. */
  detail: Detail;
  provenance: ProvenanceView[];
}

export interface EdgeView {
  id: string;
  src: string;
  rel: Relation;
  dst: string;
  status: AssertionStatus;
  provenance: ProvenanceView[];
}
