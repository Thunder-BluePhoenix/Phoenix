// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Questions in words -> graph answer + cited documents, and the optional narration of a path.
//
// answerQuestion: finds seed entities by exact id / key / name, expands them with the deterministic
// queries, and asks the injected Retriever for documents. The two result sets are returned apart:
// `graph` are facts with explanation paths, `documents` are retrieved text with citations. Nothing
// merges them and nothing here calls a model.
//
// narrate: puts a path into words through an injected text function and then REFUSES the result if it
// names anything the path does not contain (an id, hash, number, issue key or ADR/phase number that is
// not in the path). On refusal the deterministic path text is returned instead. A narration therefore
// cannot add a fact that is checkable as an identifier; it can still phrase things loosely, which is
// why the path is always returned next to it.
import type { Viewer } from "@phoenix/ai-memory";
import { GraphQuery, type GraphAnswer } from "./query";
import type { NodeType, NodeView } from "./types";
import type { ExplanationPath } from "./query";

/** One retrieved document. A `HybridRetriever` result item adapts to this by mapping three fields. */
export interface DocumentHit {
  id: string;
  text: string;
  citation: { source: string; sourceRef: string };
  score?: number;
}

export interface RetrieverRequest {
  query: string;
  viewer: Viewer;
  limit: number;
}

/** Document retrieval, injected so graph and hybrid retrieval can be wired together later. */
export type Retriever = (request: RetrieverRequest) => Promise<readonly DocumentHit[]>;

export interface GraphDocumentAnswer {
  question: string;
  /** Exact-match entities found in the question. Empty means the graph has nothing to say. */
  seeds: NodeView[];
  /** Facts, each with its explanation path. Never produced by a model. */
  graph: GraphAnswer[];
  /** Retrieved text with citations. Interpretation of it is the caller's business. */
  documents: readonly DocumentHit[];
  /** Why a part is empty, in words a user can act on. */
  notes: string[];
}

/** "which <noun>" -> node type. Fixed phrases only: no synonyms, no stemming, no guessing. */
const TYPE_NOUNS: readonly { re: RegExp; type: NodeType }[] = [
  { re: /\bwhich (?:ci )?(?:runs?|workflow runs?)\b/i, type: "CIRun" },
  { re: /\bwhich commits?\b/i, type: "Commit" },
  { re: /\bwhich deployments?\b/i, type: "Deployment" },
  { re: /\bwhich (?:pull requests?|prs?)\b/i, type: "PullRequest" },
  { re: /\bwhich issues?\b/i, type: "Issue" },
  { re: /\bwhich decisions?\b/i, type: "Decision" },
  { re: /\bwhich (?:documents?|docs|files?)\b/i, type: "Document" },
  { re: /\bwhich meetings?\b/i, type: "Meeting" },
];

export interface AnswerOptions {
  viewer: Viewer;
  retriever?: Retriever;
  documentLimit?: number;
  /** Most seeds expanded. */
  seedLimit?: number;
}

export async function answerQuestion(
  query: GraphQuery,
  question: string,
  options: AnswerOptions,
): Promise<GraphDocumentAnswer> {
  const { viewer } = options;
  const seeds = query.seeds(viewer, question, options.seedLimit ?? 3);
  const graph: GraphAnswer[] = [];
  const notes: string[] = [];
  if (seeds.length === 0)
    notes.push("No entity in the question matches the graph exactly, so there are no graph facts.");
  const asksWho = /\bwho\b/i.test(question);
  const asksWhy = /\bwhy\b|\bwhat led\b|\bhow did\b.*\bcome\b/i.test(question);
  const which = TYPE_NOUNS.find((p) => p.re.test(question));
  for (const seed of seeds) {
    if (asksWho) graph.push(query.who(viewer, seed.id));
    if (which) graph.push(query.nearest(viewer, seed.id, which.type));
    if (asksWhy || (!asksWho && !which)) graph.push(query.why(viewer, seed.id));
  }
  let documents: readonly DocumentHit[] = [];
  if (options.retriever) {
    documents = await options.retriever({
      query: question,
      viewer,
      limit: options.documentLimit ?? 5,
    });
  } else notes.push("No document retriever was supplied, so only graph facts are returned.");
  return { question, seeds, graph, documents, notes };
}

/** The paths of an answer, flattened. */
export function pathsOf(answer: GraphAnswer): ExplanationPath[] {
  if (answer.kind === "why") return answer.paths;
  if (answer.kind === "which") return answer.results.map((r) => r.path);
  return answer.people.flatMap((p) => p.paths);
}

/** Generates text from a prompt. In production this wraps AiService.run with the right privacy class. */
export type TextGenerator = (prompt: string) => Promise<string>;

export interface Narration {
  text: string;
  /** True when the model's words were used; false when they were refused and the path text is returned. */
  narrated: boolean;
  /** Identifiers the model introduced that the path does not contain. */
  invented: string[];
}

const IDENTIFIER_PATTERNS: readonly RegExp[] = [
  /\b(?:Person|Project|Repository|Commit|Service|Deployment|Meeting|Decision|Feature|Issue|PullRequest|CIRun|Document):\S+/g,
  /\b[0-9a-f]{7,40}\b/g,
  /#\d+\b/g,
  /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g,
  /\bphase[ -]?\d+\b/gi,
  /\b\d{2,}\b/g,
];

/** Identifier-like tokens in a text (ids, hashes, numbers, issue keys), lower-cased, trailing punctuation trimmed. */
export function identifiersIn(text: string): string[] {
  const out: Record<string, true> = {};
  for (const re of IDENTIFIER_PATTERNS) {
    for (const m of text.matchAll(re)) out[m[0].replace(/[.,;:)"']+$/, "").toLowerCase()] = true;
  }
  return Object.keys(out);
}

export async function narrate(path: ExplanationPath, generate: TextGenerator): Promise<Narration> {
  const facts = path.text;
  const prompt =
    "Rewrite the following graph facts as one short plain sentence. Use only the facts given. " +
    "Do not add names, numbers, identifiers or reasons that are not in them.\n\n" +
    facts;
  const raw = (await generate(prompt)).trim();
  const allowed: Record<string, true> = {};
  for (const id of identifiersIn(facts)) allowed[id] = true;
  // Sub-tokens of an allowed id ("a4ef8a4" inside a full hash, "123" inside "repo#123") are the same fact.
  const allowedList = Object.keys(allowed);
  const invented = identifiersIn(raw).filter(
    (id) => allowed[id] !== true && !allowedList.some((a) => a.includes(id)),
  );
  if (raw.length === 0 || invented.length > 0) return { text: facts, narrated: false, invented };
  return { text: raw, narrated: true, invented: [] };
}
