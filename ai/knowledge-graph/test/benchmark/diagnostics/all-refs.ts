// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// MANUAL DIAGNOSTIC, NOT A TEST (vitest does not collect it: no *.test.ts name). It depends on this
// repository's own refs, so its numbers change whenever a branch moves and it must never gate CI.
//
// Phase 38 follow-up: re-run the pre-registered benchmark with the revision source overridden from
// the pinned commit to `git log --all` (every branch, tag, remote-tracking ref and stash), for BOTH
// the ingested history and the ground truth, and print per-question detail for `touched` and `who`.
//
// spec.ts, systems.ts and run.ts are untouched and imported as they are, so the question rules, the
// metrics and the sha256 of spec.ts are identical. The only override is a `git` shim put first on PATH
// that rewrites the pinned sha to `--all` in `git -C <repo> log ...` invocations (the benchmark runs
// git by name). `ls-tree` / `show` keep reading the markdown files at the pinned revision, so the
// document questions are not affected. Real people's names are printed as author-A, author-B, ...
//
// Usage: npx tsx ai/knowledge-graph/test/benchmark/diagnostics/all-refs.ts [repo-path] [flags]
//   --pinned  run without the shim (control: must reproduce the pinned numbers and spec hash)
//   --variant=both|ingest-only|truth-only  which side is switched to --all (default both). The truth side
//     is the invocation whose format is exactly %x1e%H or %H (loadTruth and the --grep questions); the
//     ingest side is every other `git log` (readGitHistory and the baselines' parseGitLog).
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SYSTEM_NAMES, formatReport, runBenchmark } from "../run";
import { PINNED_REV, TOP_K, git, rPrecision } from "../spec";

const repo = resolve(process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) ?? ".");
const pinnedControl = process.argv.includes("--pinned");
const variant = process.argv.find((a) => a.startsWith("--variant="))?.slice(10) ?? "both";

const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

if (!pinnedControl) {
  const shimDir = mkdtempSync(join(tmpdir(), "p38-git-shim-"));
  const shim = join(shimDir, "git");
  // `git -C <repo> log <PINNED> ...` -> `git -C <repo> log --all ...`; everything else is untouched.
  writeFileSync(
    shim,
    [
      "#!/bin/sh",
      `if [ "$1" = "-C" ] && [ "$3" = "log" ]; then`,
      `  repo="$2"; shift 3; out=""; truth=0`,
      `  for a in "$@"; do case "$a" in --format=%x1e%H|--format=%H) truth=1;; esac; done`,
      `  rewrite=1`,
      `  if [ "$truth" = 1 ] && [ "${variant}" = ingest-only ]; then rewrite=0; fi`,
      `  if [ "$truth" = 0 ] && [ "${variant}" = truth-only ]; then rewrite=0; fi`,
      `  for a in "$@"; do if [ "$a" = "${PINNED_REV}" ] && [ "$rewrite" = 1 ]; then a="--all"; fi; out="$out '$a'"; done`,
      `  eval "exec '${realGit}' -C '$repo' log $out"`,
      "fi",
      `exec '${realGit}' "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(shim, 0o755);
  process.env.PATH = `${shimDir}:${process.env.PATH ?? ""}`;
}

const count = (args: string[]): string => git(repo, ...args).trim();
console.log(`mode: ${pinnedControl ? "PINNED (control)" : "git log --all"}`);
console.log(
  `refs: ${count(["for-each-ref", "--format=%(refname:rstrip=-2)"]).split("\n").sort().join(" ")}`,
);
console.log(
  `commits: pinned ${count(["rev-list", "--count", PINNED_REV])}, all refs ${count(["rev-list", "--count", "--all"])}, stashes ${count(["stash", "list"]) === "" ? 0 : count(["stash", "list"]).split("\n").length}`,
);

const report = await runBenchmark(repo);
console.log(formatReport(report));

// Anonymise authors: author-A, author-B, ... in order of first appearance in the ground truth.
const labels = new Map<string, string>();
const label = (name: string): string => {
  if (!labels.has(name)) labels.set(name, `author-${String.fromCharCode(65 + labels.size)}`);
  return labels.get(name) ?? name;
};
for (const r of report.results)
  if (r.question.category === "who") r.question.expected.forEach(label);

const short = (s: string): string => s.slice(0, 7);
for (const r of report.results) {
  const { question: q } = r;
  if (q.category !== "touched" && q.category !== "who") continue;
  const fmt = (xs: string[]): string =>
    `[${xs.map((x) => (q.category === "who" ? label(x) : short(x))).join(", ")}]`;
  console.log(`\n[${q.category}] ${q.text}\n  expected(${q.expected.length}) ${fmt(q.expected)}`);
  for (const n of SYSTEM_NAMES) {
    const s = r.scores[n];
    const missing = q.expected.filter((e) => !s.returned.slice(0, q.expected.length).includes(e));
    console.log(
      `  ${n.padEnd(5)} rp=${rPrecision(s.returned, q.expected).toFixed(2)} recall@${TOP_K}=${s.recall.toFixed(2)} returned(${s.returned.length}) ${fmt(s.returned)} missingInTop|E|=${fmt(missing)}`,
    );
  }
}
