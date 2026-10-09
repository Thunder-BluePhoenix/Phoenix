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

// ── Support: does the cited evidence contain what the claim asserts? ────────

const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\u00ad]/g;
const EVIDENCE_REF = /^e[0-9]{1,3}$/;
const ORDINAL_OR_UNIT = /^[0-9]+(?:st|nd|rd|th|s|ms|m|h|d|am|pm|min|sec|kb|mb|gb)$/;
/**
 * Hyphenated plain words that are ordinary English, not names. A hyphenated name such as
 * "secret-scan" IS checked; these are not, so an honest paraphrase is not rejected for them.
 */
const COMMON_COMPOUNDS: Readonly<Record<string, true>> = {
  "rule-based": true,
  "re-run": true,
  "re-runs": true,
  "built-in": true,
  "up-to-date": true,
  "follow-up": true,
  "non-zero": true,
  "well-known": true,
  "open-source": true,
  "third-party": true,
  "read-only": true,
  "long-running": true,
  "high-risk": true,
  "low-risk": true,
  "so-called": true,
  "step-by-step": true,
  "one-off": true,
};
const MAX_CHECKED_IDENTIFIERS = 24;

/** NFKC, invisible characters removed, lower-cased: zero-width characters cannot hide a match. */
function fold(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE, "").toLowerCase();
}

const QUOTED_PHRASE =
  /["`\u201c]([^"`\u201c\u201d]{2,80})["`\u201d]|(?<![\p{L}\p{N}])'([^']{2,80})'(?![\p{L}\p{N}])/gu;

function trimPunctuation(token: string): string {
  return token.replace(/^[([{'"`<]+/, "").replace(/[.,;:!?)\]}'"`>]+$/, "");
}

/**
 * The identifier-like things a claim asserts, and only those: quoted names, commit shas (7-40 hex
 * characters containing a digit), numbers of five or more digits (run and job ids), paths and file
 * names, and names with an underscore, digit or hyphen. Plain words are never checked, so honest
 * paraphrase is not rejected. References to evidence ("E4") are not identifiers of the claim.
 */
export function identifiersIn(claim: string): string[] {
  const text = fold(claim);
  const found: Record<string, true> = {};
  for (const m of text.matchAll(QUOTED_PHRASE)) {
    const phrase = (m[1] ?? m[2] ?? "").trim();
    if (phrase.length >= 2) found[phrase] = true;
  }
  // Words inside quotes were taken whole above; the rest is scanned token by token.
  const rest = text.replace(QUOTED_PHRASE, " ");
  for (const raw of rest.split(/[\s,;()[\]{}<>]+/)) {
    const token = trimPunctuation(raw);
    if (token.length < 3 || EVIDENCE_REF.test(token)) continue;
    const hasLetter = /\p{L}/u.test(token);
    const hasDigit = /\p{N}/u.test(token);
    if (/^[0-9a-f]{7,40}$/.test(token)) {
      if (hasDigit) found[token] = true;
    } else if (/^[0-9]{5,}$/.test(token)) {
      found[token] = true;
    } else if (token.includes("/") || token.includes("\\")) {
      const bare = token.replace(/^\.?\//, "");
      const segments = bare.split(/[/\\]/).filter(Boolean);
      const pathLike =
        segments.length >= 3 ||
        /[._@~\p{N}-]/u.test(bare) ||
        token.startsWith(".") ||
        token.startsWith("/");
      if (segments.length >= 2 && pathLike) found[bare] = true;
    } else if (
      /^[\p{L}\p{N}_-]*\.[\p{L}\p{N}]{1,5}$/u.test(token) ||
      /^\.[\p{L}]{3,}$/u.test(token)
    ) {
      // A file name: "package.json", ".gitleaksignore". "e.g." and "i.e." fall out (no stem).
      const stem = token.slice(0, token.lastIndexOf("."));
      if (token.startsWith(".") || (stem.length >= 2 && hasLetter && !/^[0-9.]+$/.test(token))) {
        found[token] = true;
      }
    } else if (/[_]/.test(token) && hasLetter) {
      found[token] = true;
    } else if (/^[\p{L}]+(?:-[\p{L}\p{N}]+)+$|^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)+$/u.test(token)) {
      if (COMMON_COMPOUNDS[token] !== true && (hasDigit || token.length >= 6)) found[token] = true;
    } else if (/^\p{L}+\p{N}[\p{L}\p{N}]*$/u.test(token) && !ORDINAL_OR_UNIT.test(token)) {
      found[token] = true;
    }
  }
  return Object.keys(found).slice(0, MAX_CHECKED_IDENTIFIERS);
}

/** Identifiers the claim asserts that none of `evidenceTexts` contains. Empty = supported. */
export function unsupportedIdentifiers(claim: string, evidenceTexts: readonly string[]): string[] {
  const evidence = fold(evidenceTexts.join("\n"));
  return identifiersIn(claim).filter((id) => !evidence.includes(id));
}

/** Evidence ids whose text is old memory: set by the agent when it copies memory in. */
export type StaleEvidence = Readonly<Record<string, true>>;

export const STALE_NOTE = "rests on stale memory";
export const UNSUPPORTED_NOTE = "cited but unsupported";

export interface ClaimAssessment {
  /** Citations that exist, are not model output and have text. */
  evidenceIds: string[];
  grounded: boolean;
  notes: string[];
  /** Citations removed because the evidence does not exist or is empty. */
  invalid: number;
}

/**
 * Decides whether a claim is grounded. All of these must hold: it cites at least one piece of
 * evidence; every cited id exists, is not model output and has text; it cites at least one piece of
 * FRESH evidence (a claim resting only on stale memory is not grounded); and the fresh cited text
 * contains every identifier the claim asserts. Model text only: rule claims are built from the
 * evidence itself.
 */
export function assessClaim(
  text: string,
  cited: readonly string[],
  book: EvidenceBook,
  stale: StaleEvidence = {},
): ClaimAssessment {
  const { valid, invalid } = checkCitations(cited, book);
  const notes: string[] = [];
  if (cited.length === 0) notes.push("cites no evidence");
  if (invalid.length > 0) {
    notes.push(
      `cites evidence that does not exist or is empty: ${invalid.join(", ").slice(0, 80)}`,
    );
  }
  const fresh = valid.filter((id) => stale[id] !== true);
  const staleIds = valid.filter((id) => stale[id] === true);
  let grounded = valid.length > 0 && invalid.length === 0;
  if (grounded && fresh.length === 0) {
    grounded = false;
    notes.push(`${STALE_NOTE}: ${staleIds.join(", ")}`);
  }
  if (grounded) {
    const texts = fresh.flatMap((id) => book.get(id)?.excerpt ?? []);
    const missing = unsupportedIdentifiers(text, texts);
    if (missing.length > 0) {
      grounded = false;
      const staleTexts = staleIds.flatMap((id) => book.get(id)?.excerpt ?? []);
      const onlyStale =
        staleTexts.length > 0 &&
        unsupportedIdentifiers(missing.join(" \n "), staleTexts).length === 0;
      notes.push(
        onlyStale
          ? `${STALE_NOTE}: ${staleIds.join(", ")}`
          : `${UNSUPPORTED_NOTE}: the cited evidence does not contain ${missing.slice(0, 3).join(", ").slice(0, 80)}`,
      );
    }
  }
  return { evidenceIds: valid, grounded, notes, invalid: invalid.length };
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
  stale: StaleEvidence = {},
): VerifiedClaims {
  let invalidCitations = 0;
  let reworded = 0;
  let grounded = 0;
  const out = claims.map((claim): DiagnosisClaim => {
    const wording = checkCommitWording(claim.text, commits, terms, namedPaths);
    if (wording.note) reworded++;
    // Support is checked against what the claim says AFTER any rewrite: the rewritten sentence
    // asserts nothing the evidence could fail to contain.
    const a = assessClaim(wording.text, claim.evidence, book, stale);
    invalidCitations += a.invalid;
    const notes = [...a.notes, ...(wording.note ? [wording.note] : [])];
    if (a.grounded) grounded++;
    return {
      text: wording.text,
      evidenceIds: a.evidenceIds,
      grounded: a.grounded,
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
