// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Grounding rules for a diagnosis. Everything here is plain code that runs AFTER a model has
// answered and does not depend on the prompt:
//   * a claim is "grounded" only if it cites at least one piece of evidence and every cited id
//     exists in this run's evidence book, is not model output, and has text;
//   * confidence is never taken from a model: coverage = grounded claims / claims, computed here;
//   * a claim that says a commit caused the failure is rewritten to "possibly related" unless the
//     commit's sha is in the evidence AND the commit changed files in the failing area.
import type { EvidenceBook } from "@phoenix/ai-orchestrator";
import type { DiagnosisClaim, Evidence } from "@phoenix/protocol";
import { isRecord } from "./guards";

export const MAX_MODEL_CLAIMS = 6;
export const MAX_CLAIM_CHARS = 400;
const MAX_CITATIONS = 10;
const EVIDENCE_ID = /^E[0-9]{1,3}$/;

/** Words too common in CI step and job names to say anything about an area. */
const AREA_STOPWORDS: Readonly<Record<string, true>> = {
  run: true,
  runs: true,
  action: true,
  actions: true,
  checkout: true,
  setup: true,
  complete: true,
  post: true,
  step: true,
  steps: true,
  main: true,
  with: true,
  node: true,
  github: true,
  job: true,
  ubuntu: true,
  latest: true,
  // Every test job says these, so they match any test file and say nothing about the area.
  test: true,
  tests: true,
  includes: true,
  check: true,
  build: true,
};

/**
 * Words naming the area that failed (job and failed-step names): "Run gitleaks/gitleaks-action@v2"
 * in job "secret-scan" gives gitleaks, secret, scan. Short and generic words are dropped.
 */
export function areaTerms(names: readonly string[]): string[] {
  const terms: Record<string, true> = {};
  for (const name of names) {
    for (const word of name.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length >= 4 && !/^v?[0-9]+$/.test(word) && AREA_STOPWORDS[word] !== true) {
        terms[word] = true;
      }
    }
  }
  return Object.keys(terms).slice(0, 12);
}

/** The changed files that sit in the failing area: a path contains an area term, or is named by the log. */
export function filesInArea(
  files: readonly string[],
  terms: readonly string[],
  namedPaths: readonly string[] = [],
): string[] {
  return files.filter((file) => {
    const lower = file.toLowerCase();
    return (
      terms.some((t) => lower.includes(t)) ||
      namedPaths.some((p) => p.length > 0 && lower === p.toLowerCase())
    );
  });
}

export interface CommitFacts {
  sha: string;
  /** Evidence id of the commit's evidence entry. */
  evidenceId: string;
  files: readonly string[];
  /** The commit led to the run's head commit (it is the head or one of its ancestors). */
  ancestorOfRun: boolean;
  /** Authored and committed no later than the run was created. */
  beforeRun: boolean;
}

// ── Model answer ─────────────────────────────────────────────────────────────

export interface ModelClaim {
  text: string;
  evidence: string[];
}
export interface ModelAnswer {
  claims: ModelClaim[];
  proposal: { text: string; rationale: string; evidence: string[] } | null;
  /** The model's own word for how sure it is. Shown as such; never used for any decision. */
  confidence: string | null;
}

function oneLine(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text.length === 0 ? null : text.slice(0, max);
}

function citations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value.slice(0, MAX_CITATIONS)) {
    // A model may write "E3" or "[E3]"; anything else is kept as written so the verifier rejects it.
    const id = typeof v === "string" ? v.trim().replace(/^\[|\]$/g, "") : "(not an id)";
    if (!out.includes(id)) out.push(id.slice(0, 40));
  }
  return out;
}

/**
 * Reads the model's JSON answer. Returns null when no usable object is found. Nothing is trusted:
 * unknown keys are ignored, text is cut and flattened, counts are capped.
 */
export function parseModelAnswer(text: string): ModelAnswer | null {
  const stripped = text.replace(/```(?:json)?/gi, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!isRecord(raw) || !Array.isArray(raw.claims)) return null;
  const claims: ModelClaim[] = [];
  for (const c of raw.claims.slice(0, MAX_MODEL_CLAIMS)) {
    if (!isRecord(c)) continue;
    const claimText = oneLine(c.text, MAX_CLAIM_CHARS);
    if (claimText) claims.push({ text: claimText, evidence: citations(c.evidence) });
  }
  let proposal: ModelAnswer["proposal"] = null;
  if (isRecord(raw.proposal)) {
    const p = oneLine(raw.proposal.text, 600);
    if (p) {
      proposal = {
        text: p,
        rationale: oneLine(raw.proposal.rationale, 600) ?? "",
        evidence: citations(raw.proposal.evidence),
      };
    }
  }
  const confidence = oneLine(raw.confidence, 40);
  return claims.length === 0 ? null : { claims, proposal, confidence };
}

// ── Citations ────────────────────────────────────────────────────────────────

export interface Grounding {
  valid: string[];
  invalid: string[];
}

/** Citable evidence exists in this run, is not model output, and has text. */
export function checkCitations(ids: readonly string[], book: EvidenceBook): Grounding {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const id of ids) {
    const e: Evidence | undefined = EVIDENCE_ID.test(id) ? book.get(id) : undefined;
    if (e && e.kind !== "model" && e.excerpt.trim().length > 0) valid.push(id);
    else invalid.push(id);
  }
  return { valid, invalid };
}

// ── Commit wording ───────────────────────────────────────────────────────────

const CAUSAL =
  /\b(caus(?:e|es|ed|ing)|brok(?:e|en)|breaks?|introduc(?:e|es|ed)|culprit|responsible|root cause|due to|because of|result(?:s|ed)? (?:of|from)|trigger(?:s|ed)?|led to|leads to|at fault)\b/i;
const COMMIT_WORDS =
  /\b(commit|commits|merge|merged|pr|pull request|change|changes|push|patch|revert)\b/i;
// Any 7-40 hex run counts, including all-letter ones ("deadbee"): over-matching a word like
// "decade" only makes a causal sentence more cautious, never less.
const SHA = /\b[0-9a-f]{7,40}\b/gi;

export interface WordingResult {
  text: string;
  /** Why the wording was replaced; undefined when it was left as written. */
  note?: string;
}

/**
 * The model may not say a commit caused the failure unless that commit's sha is in the evidence,
 * it led to the run (ancestor of the run's head commit), it was not authored or committed after the
 * run was created, and it changed files in the failing area. Otherwise the claim is replaced by "possibly related"
 * wording. This is a code check on the finished text, not an instruction in the prompt.
 */
export function checkCommitWording(
  text: string,
  commits: readonly CommitFacts[],
  terms: readonly string[],
  namedPaths: readonly string[],
): WordingResult {
  if (!CAUSAL.test(text)) return { text };
  const lower = text.toLowerCase();
  const mentioned = [...text.matchAll(SHA)].map((m) => m[0].toLowerCase());
  // A sha made only of digits is indistinguishable from a number, so known commits are also found by their short sha.
  for (const c of commits) {
    const short = c.sha.slice(0, 7).toLowerCase();
    if (
      new RegExp(`\\b${short}`).test(lower) &&
      !mentioned.some((m) => short.startsWith(m) || m.startsWith(short))
    ) {
      mentioned.push(short);
    }
  }
  if (mentioned.length === 0 && !COMMIT_WORDS.test(text)) return { text };

  const resolved: CommitFacts[] = [];
  for (const sha of mentioned) {
    const hits = commits.filter((c) => c.sha.toLowerCase().startsWith(sha));
    if (hits.length === 1) resolved.push(hits[0]!);
  }
  const allKnown = mentioned.length > 0 && resolved.length === mentioned.length;
  const overlaps =
    allKnown && resolved.every((c) => filesInArea(c.files, terms, namedPaths).length > 0);
  const ordered = allKnown && resolved.every((c) => c.ancestorOfRun && c.beforeRun);
  if (allKnown && overlaps && ordered) return { text };

  // A commit that did not lead to the run, or came after it, cannot be related to its failure at
  // all, so it is not named as "possibly related" either.
  const outOfOrder = resolved.filter((c) => !c.ancestorOfRun || !c.beforeRun);
  const reason = !allKnown
    ? mentioned.length === 0
      ? "causal wording about a change with no commit sha"
      : "causal wording about a commit that is not in the evidence"
    : outOfOrder.length > 0
      ? "causal wording about a commit that did not lead to the run or came after it"
      : "causal wording about a commit that did not change files in the failing area";
  const names = resolved.map((c) => c.sha.slice(0, 7));
  const related =
    names.length > 0
      ? `Commit ${names.join(", ")} is possibly related to the failure; the evidence does not establish that it caused it.`
      : "A recent change is possibly related to the failure; the evidence does not establish that it caused it.";
  return {
    text:
      outOfOrder.length > 0
        ? "No commit in the evidence can be tied to the failure: the commit named did not lead to this run or came after it."
        : related,
    note: reason,
  };
}

// ── Claims ───────────────────────────────────────────────────────────────────

export interface VerifiedClaims {
  claims: DiagnosisClaim[];
  /** Citations removed because the evidence does not exist, is empty or is model output. */
  invalidCitations: number;
  /** Claims whose causal wording was replaced. */
  reworded: number;
  grounded: number;
}

/** Verifies the model's claims one by one. Claims keep their order; none is silently dropped. */
export function verifyModelClaims(
  claims: readonly ModelClaim[],
  book: EvidenceBook,
  commits: readonly CommitFacts[],
  terms: readonly string[],
  namedPaths: readonly string[],
): VerifiedClaims {
  let invalidCitations = 0;
  let reworded = 0;
  let grounded = 0;
  const out = claims.map((claim): DiagnosisClaim => {
    const { valid, invalid } = checkCitations(claim.evidence, book);
    invalidCitations += invalid.length;
    const wording = checkCommitWording(claim.text, commits, terms, namedPaths);
    if (wording.note) reworded++;
    const notes: string[] = [];
    if (claim.evidence.length === 0) notes.push("cites no evidence");
    if (invalid.length > 0) {
      notes.push(
        `cites evidence that does not exist or is empty: ${invalid.join(", ").slice(0, 80)}`,
      );
    }
    if (wording.note) notes.push(wording.note);
    const isGrounded = valid.length > 0 && invalid.length === 0;
    if (isGrounded) grounded++;
    return {
      text: wording.text,
      evidenceIds: valid,
      grounded: isGrounded,
      origin: "model",
      ...(notes.length > 0 ? { note: notes.join("; ").slice(0, 200) } : {}),
    };
  });
  return { claims: out, invalidCitations, reworded, grounded };
}

/** Grounded claims / claims, 0 when there are none. Computed here, never reported by a model. */
export function coverageOf(claims: readonly DiagnosisClaim[]): number {
  if (claims.length === 0) return 0;
  return claims.filter((c) => c.grounded).length / claims.length;
}
