# Phase 38: why the `git log --all` variant looked worse (diagnosis, 2026-11-12)

Question (docs/gaps.md, Phase 38, "unverified"): a post-hoc run over `git log --all` instead of the pinned history put the graph
below best-case retrieval on the relationship set (0.545 vs 0.643) and `who` at R-precision 0.000 with recall 1.000. Is that a
ground-truth artifact or a graph bug?

Short answer: **both, in different parts.** The `who` 0.000 / recall 1.000 signature is a ground-truth artifact (the expected set
was smaller than what the graph was given). Separately, running the variant consistently (ingest and truth both over `--all`)
exposed one small, real graph bug: a question naming a root-level file (`.gitleaksignore`) found no seed. It is fixed; the pinned
benchmark is bit-for-bit unchanged.

No secrets here. Authors are real people, so they appear only as `author-A`, `author-B`, `author-C`; the letters are assigned per
table in order of first appearance and are not comparable between tables.

## Commands

```
export PATH=/Users/bluephoenix/.nvm/versions/node/v22.19.0/bin:$PATH
./node_modules/.bin/tsx ai/knowledge-graph/test/benchmark/run.ts . --detail          # pinned, before and after the fix
./node_modules/.bin/tsx ai/knowledge-graph/test/benchmark/diagnostics/all-refs.ts . --pinned               # control
./node_modules/.bin/tsx ai/knowledge-graph/test/benchmark/diagnostics/all-refs.ts . --variant=both         # ingest + truth over --all
./node_modules/.bin/tsx ai/knowledge-graph/test/benchmark/diagnostics/all-refs.ts . --variant=ingest-only  # graph/baselines see --all, truth pinned
./node_modules/.bin/tsx ai/knowledge-graph/test/benchmark/diagnostics/all-refs.ts . --variant=truth-only   # truth over --all, ingest pinned
```

`diagnostics/all-refs.ts` is a manual script (no `.test.ts` name, not collected by vitest, header says so). It does not edit
`spec.ts`, `systems.ts` or `run.ts`; it puts a `git` shim first on `PATH` that rewrites the pinned sha to `--all` in
`git -C <repo> log ...` calls (markdown files are still read at the pinned revision). The control (`--pinned`) and the unmodified
`run.ts` print the same spec sha256 `03d5f054306cd8f3b0ee213f00a7a2d72c5d106966f59d3694abe94855c75e0e` and the same numbers.

## Repository state

| Item                                                                          | Count                                                                                                                                    |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Pinned revision `9413132...` (commit date 2026-10-09), `rev-list --count`     | 59                                                                                                                                       |
| `rev-list --count --all`                                                      | 178 (119 commits are not reachable from the pinned revision)                                                                             |
| Refs                                                                          | 2 heads (`main`, one `claude/...` branch), 3 remote-tracking, 2 `refs/codex/turn-diffs/*` (tree objects, not commits), 0 tags, 0 stashes |
| Commits `pinned..main`                                                        | 104 (pinned is an ancestor of `main`); 15 more only on the `claude/...` branch                                                           |
| Authors in the 59 pinned commits                                              | 2 (58 + 1 commits)                                                                                                                       |
| Authors in the 119 extra commits                                              | 2 (104 + 15 commits)                                                                                                                     |
| Duplicate commits across refs (same author, time, subject; or equal patch-id) | 0                                                                                                                                        |
| Author names that differ only by case or whitespace                           | 0                                                                                                                                        |

So the extra refs add new commits, not duplicates or cherry-picks, and author normalisation is not in play.

**Reproducibility caveat.** The earlier numbers (0.545 vs 0.643) cannot be reproduced exactly: refs have moved since that run
(119 extra commits today), and the question generator picks paths from the truth, so the variant now asks 38 questions (4 multihop,
different `touched` paths) instead of 36. What can be compared is the mechanism, below.

## Pinned benchmark, before and after the fix

Identical (diff of the full `--detail` output, excluding timings, is empty): spec sha256 as above, 36 questions, ingested
`{"commits":59,"docs":102,"events":5}`; relationship set graph 0.750, B1 0.120, B2 0.661, G+B2 0.850; gate NOT PASSED
(graph-B2 0.089). `benchmark.test.ts`: 2 passed.

## Variants (today's refs, before the fix)

| Variant                       | Questions | touched graph        | who graph (R-prec / recall) | relationship graph | B2    | gate graph-B2 |
| ----------------------------- | --------- | -------------------- | --------------------------- | ------------------ | ----- | ------------- |
| pinned (control)              | 36        | 1.000                | 1.000 / 1.000               | 0.750              | 0.661 | +0.089        |
| both (`--all` ingest + truth) | 38        | 0.875                | 0.667 / 0.667               | 0.773              | 0.811 | -0.038        |
| ingest-only (truth pinned)    | 36        | 0.583 (recall 0.887) | **0.000 / 1.000**           | 0.483              | 0.604 | -0.121        |
| truth-only (ingest pinned)    | 38        | 0.050                | 0.000 / 0.000               | 0.109              | 0.513 | -0.403        |

The `who` signature in the gap row (R-precision 0.000, recall 1.000) is exactly the **ingest-only** row.

## Diagnosis 1: `who` 0.000 with recall 1.000 is a ground-truth artifact

Ingest-only: the graph holds all 178 commits, but the expected sets were computed from the 59 pinned commits. Per `who` question:

| Question (path touched)      | Expected (pinned truth) | Graph returned       | B2 returned          |
| ---------------------------- | ----------------------- | -------------------- | -------------------- |
| `.github/workflows/ci.yml`   | [author-A] (1)          | [author-B, author-A] | [author-A, author-B] |
| `apps/web/src/App.tsx`       | [author-A] (1)          | [author-B, author-A] | [author-A, author-B] |
| `apps/web/test/app.test.tsx` | [author-A] (1)          | [author-B, author-A] | [author-A, author-B] |

For each of these three paths the pinned history has one author, while `--all` has two (`git log --all --format=%an -- <path>` gives
2 distinct names for each). The second author only wrote post-pin commits (extra commits per path: ci.yml 6, App.tsx 12,
app.test.tsx 2). R-precision looks at the top-|E| = 1 answer. The graph returns both authors, which is correct for the ingested history. Both are two hops from the file (file, commit, person), so the order between them is decided by the next keys in `GraphQuery.who` (number of paths, each person capped at 3, then person id), and in all three questions the pinned author lands second. Recall@10 is 1.000 because both are in the list; the top-1 cut drops the pinned author. B2 happens to rank the pinned author first (bm25 order). The graph returned the right people for its input; the metric compared them to a truth built from a different history. The exact tie-break key that put the other author first was not isolated (author names are not shown here). Not a graph bug.

Consistency check: with truth and ingest both over `--all` (variant `both`), the expected `who` sets contain both authors where both
wrote, and the graph's `who` is 1.000 on the two questions that have a seed (see below for the third).

## Diagnosis 2: the same artifact explains `touched` in ingest-only

| Question                                          | \|E\| pinned | Graph R-prec | Graph recall@10 | Returned > \|E\|                         |
| ------------------------------------------------- | ------------ | ------------ | --------------- | ---------------------------------------- |
| `.github/workflows/ci.yml`                        | 5            | 0.40         | 0.80            | 10 (post-pin commits in the top 5)       |
| `apps/web/src/App.tsx`                            | 4            | 0.25         | 0.50            | 10 (App.tsx has 16 commits over `--all`) |
| `apps/web/test/app.test.tsx`                      | 4            | 0.75         | 1.00            | 6                                        |
| `core/capability-manager/src/manager.ts`          | 5            | 0.60         | 0.80            | 10                                       |
| `core/persistence/src/meeting-store.ts`           | 3            | 0.67         | 1.00            | 4                                        |
| `core/state-engine/src/engine.ts`                 | 6            | 0.50         | 1.00            | 9                                        |
| `docs/phases/phase-14-floating-desktop-fawkes.md` | 6            | 0.83         | 1.00            | 8                                        |
| `docs/phases/phase-30-policy-and-tool-gateway.md` | 3            | 0.67         | 1.00            | 6                                        |

The graph ranks `which` results newest-first (`latest()` in `GraphQuery.which`), so with more commits over `--all` the post-pin ones take the top-|E| slots. I did not list per-question which returned commits are post-pin; the aggregate evidence is the extra-commit counts per path above and recall@10 staying higher than R-precision. That is the expected-set growing
under a fixed |E| and top-k, i.e. an artifact of the variant, not wrong entities.

## Diagnosis 3: a real graph bug found in the consistent variant (`both`)

With truth and ingest aligned the graph should be at or near 1.000 on `touched` and `who`. It was not: the first `touched`
question, `Which commits touched .gitleaksignore?`, returned **0 entities** (expected 8 commits, 2 authors), which also
zeroed the matching `who` question (`who` 0.667, `touched` 0.875).

Evidence: `GraphQuery.seeds` extracts repository paths only with a regex that requires a slash
(`[\w.-]+(?:\/[\w.-]+)+`). A root-level file such as `.gitleaksignore` has no slash, so it was never looked up as a Document
(`Document:Thunder-BluePhoenix/Phoenix:.gitleaksignore` exists in the graph); the question had no seed and the graph said nothing.
That is a graph failure on identical inputs. It is independent of the variant: in the pinned run the picked paths all contain a
slash, so the bug never surfaced there (the pinned selection is by evenly spaced paths; `.gitleaksignore` has 3 pinned commits and
simply was not picked).

Fix (`ai/knowledge-graph/src/query.ts`): after the path pass and its blanking, a root-file pass looks up dotted, slash-free words
as `Document` keys ending in `:<name>` (a nested path's tail like `:src/a.ts` can never match). Words with no dot are left to the
existing name lookup. Test (`ai/knowledge-graph/test/query.test.ts`, "seeds a root-level file named without a slash, ..."): written first
and observed failing (`expected [] to deeply equal [ 'Document:o/phoenix:.gitleaksignore' ]`), then passing with the fix; it also asserts
`README.md` seeds and that "J.R. Smith, e.g. in v1.2.3 or a.ts" seeds nothing. Knowledge-graph suite: 7 files, 104 tests pass.

Effect on the variants (after the fix, today's refs):

| Variant     | touched graph     | who graph                 | relationship graph | B2                | gate graph-B2       |
| ----------- | ----------------- | ------------------------- | ------------------ | ----------------- | ------------------- |
| pinned      | 1.000             | 1.000                     | 0.750 (unchanged)  | 0.661 (unchanged) | +0.089 (unchanged)  |
| both        | 1.000 (was 0.875) | 1.000 (was 0.667)         | 0.864 (was 0.773)  | 0.811             | +0.053 (was -0.038) |
| ingest-only | 0.583 (unchanged) | 0.000 / 1.000 (unchanged) | 0.483              | 0.604             | -0.121              |

`both` after the fix: `.gitleaksignore` returns all 8 expected commits and both authors.

## Other categories in the `both` variant (not part of the ask, recorded because they moved)

`phase_commit` graph 0.000 vs B2 0.938: the graph has no text index, as pre-registered (lexical is 0.000 too); the expected sets grow to
3 to 4 commits per phase over `--all`. `ci_for` 0.667 and `ci_commit` 0.500 improve over pinned (0.333, 0.250) because commits like
`f36167b` become reachable; `a4ef8a4` is still on no ref, so those answers remain unavailable. Not investigated further.

## Classification

- `who` R-precision 0.000 / recall 1.000, and the `touched` drop of the post-hoc run: **ground-truth artifact** (expected sets from
  the pinned history, graph ingested from all refs; extra authors and commits are correct answers that the pinned truth cannot know).
  The variant is not comparable to the pinned result unless truth and ingest use the same refs.
- Truth and ingest aligned: **one small graph bug** (root-level file names without `/` were not seeded), fixed with a test. Pinned
  numbers and spec hash are identical, so the pre-registered behaviour is untouched.
- The graph-vs-B2 gap in the aligned variant (+0.053 after the fix, -0.038 before) comes from `phase_commit`/lexical-style
  categories where the graph has no text index; it is not evidence of a ranking defect in `who` or `touched`.

## What this does not show

One repository, refs as they were on 2026-11-12, 36 to 38 questions. The earlier 0.545/0.643 figures were not re-obtained. Nothing was
run against any other repository.
