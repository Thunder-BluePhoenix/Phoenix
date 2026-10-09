// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// PRE-REGISTRATION for the Phase 38 value gate ("graph/hybrid retrieval proves measurable value").
// This file was written, formatted and hashed BEFORE the graph runner or the baseline runner existed;
// the sha256 recorded with the results is the hash of this file as committed. It imports nothing from
// the graph package and nothing from the retrieval baseline, so neither system can shape the questions
// or the answers.
//
// DATA (all real): this repository's git history up to the pinned revision; the markdown files tracked
// at that revision; the GitHub Actions runs in capabilities/github/test/fixtures/runs.json (a recorded
// response from the real Thunder-BluePhoenix/Phoenix repository) and the pull request fixture.
//
// QUESTIONS (36 in total; counts are what the fixed rules below produce at the pinned revision; the first draft of this
// header said 37 and guessed the per-category counts (multihop is 2, not 4: only two paths qualify) before the generator was run; the generator also had a
// bug, `\b` is not supported by git's POSIX regex on macOS, which silently emptied phase_commit. Both were
// corrected BEFORE either system was run), asked in plain words, one string each:
//   touched      "Which commits touched <path>?"                      target Commit    (8)
//   adr_docs     "Which documents reference ADR-NNNN?"                target Document  (5)
//   phase_docs   "Which documents mention Phase N?"                   target Document  (4)
//   phase_commit "Which commits mention Phase N?"                     target Commit    (4)
//   ci_for       "Which CI runs ran for commit <sha7>?"               target CIRun     (3)
//   ci_commit    "Which commit did CI run <id> run for?"              target Commit    (4)
//   multihop     "Which CI runs ran for commits that touched <path>?" target CIRun     (2)
//   who          "Who authored the commits that touched <path>?"      target Person    (3)
//   lexical      "Which commits mention <phrase>?"                    target Commit    (3)
// Selection of paths, ADRs and phases is by the deterministic rules in `buildQuestions`, fixed here.
//
// SYSTEMS COMPARED, all answering the same strings:
//   graph  GraphIngestor + answerQuestion (exact seeds, bounded traversal, no model).
//   B1     the memory store as Phoenix builds it today: stock commit memories (commitCapture over
//          `git log --format=%H,%cI,%s`, so "Commit abc1234 in repo: <subject line>") and project-doc chunks
//          (docCaptures, one memory per chunk), searched with MemoryStore.search (bm25, the question run
//          through buildMatchQuery). Items are mapped to entities and the top 10 distinct are kept.
//   B2     "best-case retrieval": B1 plus, in each commit memory, the author name, the FULL commit message
//          and the file list ("Files: a, b, c", memory text is capped at 4000 characters by the pipeline, so
//          the largest commits lose the tail of their file list; that is a real property of memory), and one
//          memory note per CI run holding its id, workflow, branch, conclusion, title and short commit hash.
//          B2 exists so the graph is not credited for data that retrieval simply was never given. The graph
//          is given the same data as B2 (full message, author, files, runs) and nothing more.
//   G+B2   the combination a product would ship: the graph's answer when it returns at least one entity of
//          the target type, otherwise B2's answer. Fixed here before any run; no other combination is tried.
//
// HOW A RETRIEVED ITEM COUNTS AS AN ENTITY (baselines): items are taken in rank order (top 50 from bm25).
// An item contributes (1) its own entity: a commit memory is that Commit, a doc chunk is that Document, a
// CI note is that CIRun; (2) in B2 only, the author written into a commit memory is a Person; (3) every
// 7-40 character hex string in its text that is the prefix of exactly one known commit is that Commit
// (so a CI note that says "for commit a4ef8a4" names a commit). Only entities of the question's target
// type are kept, the first ten distinct ones in rank order are the answer. Paths written in a commit's
// file list do NOT make a Document answer: a commit that touched a file is not a document about it.
// This is a judge, not a reader: it asks "could a reader find the expected entity in this item?".
//
// METRICS (per question, then averaged):
//   PRIMARY  R-precision = |top-|E| of the ranked answer  intersect  E| / |E|, E = ground-truth set.
//            A system that returns nothing scores 0.
//   SECONDARY recall@10 = |top-10 intersect E| / |E|.
//   Also: wins / ties / losses of graph against each baseline per question on R-precision.
//
// GATE (the v0.7 -> v0.8 criterion), decided by these rules and by nothing else:
//   MEASURABLE VALUE if, over the relationship questions (touched, ci_for, ci_commit, multihop, who),
//   mean R-precision of the graph exceeds that of B2 by at least 0.15 absolute AND exceeds B1.
//   Expectations written down in advance, not conditions: graph beats B1 by a wide margin on touched,
//   ci_* , multihop and who (B1 holds none of that data); graph is NOT better than the baselines on
//   lexical questions (it has no text index) and roughly ties them on adr_docs / phase_docs /
//   phase_commit (an explicit token is exactly what bm25 is good at). If the graph loses a category
//   where it was not expected to win, that is reported as such, not tuned away.
//   GraphRAG (a model reading graph paths) is built only if the graph's own answers leave a relationship
//   category below 0.8 mean R-precision for reasons a narration step could plausibly fix; otherwise not.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const PINNED_REV = "9413132a2f1f67160615e48637ac97cdf8ec6f92";
export const REPOSITORY = "Thunder-BluePhoenix/Phoenix";
export const TOP_K = 10;
export const GATE_MARGIN = 0.15;
export const RELATIONSHIP_CATEGORIES: readonly Category[] = [
  "touched",
  "ci_for",
  "ci_commit",
  "multihop",
  "who",
];

export type Category =
  | "touched"
  | "adr_docs"
  | "phase_docs"
  | "phase_commit"
  | "ci_for"
  | "ci_commit"
  | "multihop"
  | "who"
  | "lexical";

export type TargetType = "Commit" | "Document" | "CIRun" | "Person";

export interface BenchQuestion {
  id: string;
  category: Category;
  text: string;
  target: TargetType;
  /** Ground truth as plain strings: full sha, repo-relative path, run id, lower-case author name. */
  expected: string[];
}

export interface Fixtures {
  runsJson: string;
}

export function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

export function pinnedRevAvailable(repo: string): boolean {
  try {
    git(repo, "cat-file", "-e", `${PINNED_REV}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

const lines = (text: string): string[] => text.split("\n").filter((l) => l.length > 0);
const SKIP_PATH = /(^|\/)(pnpm-lock\.yaml|package\.json|TRACKER\.md|\.gitignore)$/;

/** Evenly spaced picks: indices floor(i * n / count). */
function spread<T>(items: readonly T[], count: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < count && items.length > 0; i++) {
    const item = items[Math.floor((i * items.length) / count)];
    if (item !== undefined && !out.includes(item)) out.push(item);
  }
  return out;
}

export interface Truth {
  /** commits (full sha) touching each tracked path, in `git log` order */
  commitsByPath: Record<string, string[]>;
  mdFiles: string[];
  content: (path: string) => string;
}

export function loadTruth(repo: string): Truth {
  const log = git(repo, "log", PINNED_REV, "--no-renames", "--name-only", "--format=%x1e%H");
  const commitsByPath: Record<string, string[]> = {};
  for (const record of log.split("\u001e")) {
    const [sha, ...files] = record.split("\n").filter((l) => l.length > 0);
    if (!sha) continue;
    for (const f of files) (commitsByPath[f] ??= []).push(sha.trim());
  }
  const mdFiles = lines(git(repo, "ls-tree", "-r", "--name-only", PINNED_REV)).filter((f) =>
    f.toLowerCase().endsWith(".md"),
  );
  return {
    commitsByPath,
    mdFiles,
    content: (path) => git(repo, "show", `${PINNED_REV}:${path}`),
  };
}

export function buildQuestions(repo: string, truth: Truth, fixtures: Fixtures): BenchQuestion[] {
  const out: BenchQuestion[] = [];
  const author = (sha: string): string =>
    git(repo, "log", "-1", "--format=%an", sha).trim().toLowerCase();
  const runs = (
    JSON.parse(fixtures.runsJson) as { workflow_runs: { id: number; head_sha: string }[] }
  ).workflow_runs;

  // touched: paths touched by 3..9 commits, not lock/package/tracker files, 8 evenly spaced in path order.
  const touchable = Object.keys(truth.commitsByPath)
    .filter((p) => !SKIP_PATH.test(p))
    .filter((p) => {
      const n = truth.commitsByPath[p]?.length ?? 0;
      return n >= 3 && n <= 9;
    })
    .sort();
  const touched = spread(touchable, 8);
  for (const p of touched) {
    out.push({
      id: `touched:${p}`,
      category: "touched",
      text: `Which commits touched ${p}?`,
      target: "Commit",
      expected: truth.commitsByPath[p] ?? [],
    });
  }

  // adr_docs: ADRs referenced by 2..10 markdown files at the revision; first five in id order.
  const adrFiles: Record<string, string[]> = {};
  const phaseFiles: Record<number, string[]> = {};
  for (const f of truth.mdFiles) {
    const text = truth.content(f);
    for (const id of new Set([...text.matchAll(/\bADR-(\d{4})\b/g)].map((m) => m[1] ?? ""))) {
      (adrFiles[id] ??= []).push(f);
    }
    for (const n of new Set(
      [...text.matchAll(/\bphase[ -]0*(\d{1,3})\b/gi)].map((m) => Number(m[1])),
    )) {
      (phaseFiles[n] ??= []).push(f);
    }
  }
  const adrs = Object.keys(adrFiles)
    .filter((id) => (adrFiles[id]?.length ?? 0) >= 2 && (adrFiles[id]?.length ?? 0) <= 10)
    .sort()
    .slice(0, 5);
  for (const id of adrs) {
    out.push({
      id: `adr_docs:${id}`,
      category: "adr_docs",
      text: `Which documents reference ADR-${id}?`,
      target: "Document",
      expected: adrFiles[id] ?? [],
    });
  }

  // phase_docs: phases N (1..60) mentioned by 2..10 markdown files; first four in numeric order.
  const phases = Object.keys(phaseFiles)
    .map(Number)
    .filter(
      (n) =>
        n >= 1 &&
        n <= 60 &&
        (phaseFiles[n]?.length ?? 0) >= 2 &&
        (phaseFiles[n]?.length ?? 0) <= 10,
    )
    .sort((a, b) => a - b)
    .slice(0, 4);
  for (const n of phases) {
    out.push({
      id: `phase_docs:${n}`,
      category: "phase_docs",
      text: `Which documents mention Phase ${n}?`,
      target: "Document",
      expected: phaseFiles[n] ?? [],
    });
  }

  // phase_commit: the four phases that the most commits mention (git --grep), ties to the lower number.
  const commitPhaseHits: Record<number, string[]> = {};
  for (let n = 0; n <= 60; n++) {
    const hits = lines(
      git(repo, "log", PINNED_REV, "-i", "-E", `--grep=phase[ -]0*${n}([^0-9]|$)`, "--format=%H"),
    );
    if (hits.length > 0) commitPhaseHits[n] = hits;
  }
  const topPhases = Object.keys(commitPhaseHits)
    .map(Number)
    .sort((a, b) => (commitPhaseHits[b]?.length ?? 0) - (commitPhaseHits[a]?.length ?? 0) || a - b)
    .slice(0, 4);
  for (const n of topPhases) {
    out.push({
      id: `phase_commit:${n}`,
      category: "phase_commit",
      text: `Which commits mention Phase ${n}?`,
      target: "Commit",
      expected: commitPhaseHits[n] ?? [],
    });
  }

  // ci_for / ci_commit: straight from the recorded runs.
  const shas = [...new Set(runs.map((r) => r.head_sha))].sort();
  for (const sha of shas) {
    out.push({
      id: `ci_for:${sha.slice(0, 7)}`,
      category: "ci_for",
      text: `Which CI runs ran for commit ${sha.slice(0, 7)}?`,
      target: "CIRun",
      expected: runs.filter((r) => r.head_sha === sha).map((r) => String(r.id)),
    });
  }
  for (const run of [...runs].sort((a, b) => a.id - b.id)) {
    out.push({
      id: `ci_commit:${run.id}`,
      category: "ci_commit",
      text: `Which commit did CI run ${run.id} run for?`,
      target: "Commit",
      expected: [run.head_sha],
    });
  }

  // multihop: paths touched by at least one CI commit AND by 2..9 commits in all; four evenly spaced.
  const ciShas = new Set(shas);
  const hopPaths = Object.keys(truth.commitsByPath)
    .filter((p) => !SKIP_PATH.test(p))
    .filter((p) => {
      const commits = truth.commitsByPath[p] ?? [];
      return commits.length >= 2 && commits.length <= 9 && commits.some((c) => ciShas.has(c));
    })
    .sort();
  for (const p of spread(hopPaths, 4)) {
    const commits = truth.commitsByPath[p] ?? [];
    out.push({
      id: `multihop:${p}`,
      category: "multihop",
      text: `Which CI runs ran for commits that touched ${p}?`,
      target: "CIRun",
      expected: runs.filter((r) => commits.includes(r.head_sha)).map((r) => String(r.id)),
    });
  }

  // who: authors of the commits touching the first three `touched` paths.
  for (const p of touched.slice(0, 3)) {
    out.push({
      id: `who:${p}`,
      category: "who",
      text: `Who authored the commits that touched ${p}?`,
      target: "Person",
      expected: [...new Set((truth.commitsByPath[p] ?? []).map(author))].sort(),
    });
  }

  // lexical: three phrases chosen in advance.
  for (const phrase of ["bot supervisor", "database locking", "skip link"]) {
    out.push({
      id: `lexical:${phrase}`,
      category: "lexical",
      text: `Which commits mention ${phrase}?`,
      target: "Commit",
      expected: lines(git(repo, "log", PINNED_REV, "-i", `--grep=${phrase}`, "--format=%H")),
    });
  }
  return out;
}

export function readFixture(repo: string, name: string): string {
  return readFileSync(`${repo}/capabilities/github/test/fixtures/${name}`, "utf8");
}

// ------------------------------------------------------------------ metrics

export function rPrecision(ranked: readonly string[], expected: readonly string[]): number {
  if (expected.length === 0) return 0;
  const top = new Set(ranked.slice(0, expected.length));
  return expected.filter((e) => top.has(e)).length / expected.length;
}

export function recallAtK(
  ranked: readonly string[],
  expected: readonly string[],
  k = TOP_K,
): number {
  if (expected.length === 0) return 0;
  const top = new Set(ranked.slice(0, k));
  return expected.filter((e) => top.has(e)).length / expected.length;
}

export const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
