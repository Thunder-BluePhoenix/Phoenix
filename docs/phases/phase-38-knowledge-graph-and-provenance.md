# Phase 38 — Knowledge Graph & Provenance

| Field | Value |
|---|---|
| Stage | Stage 7 — Knowledge Graph (v0.7) |
| Release target | v0.7 |
| Priority | High |
| Status | 🟨 Built, measured and wired into Core; the value gate is **not met** by the graph alone; the provenance view in the web app is not built |
| Depends on | [Phase 37 — Hybrid Retrieval (Lexical + Vector + Rerank)](phase-37-hybrid-retrieval.md) |
| Unblocks | [Phase 39 — Workflow Engine](phase-39-workflow-engine.md) |

## Goal

Model relationships between people, meetings, decisions, features, commits, issues and deployments.

## Scope

**In scope**

- Graph store (evaluate Neo4j or compatible)
- Core entities + relations
- Graph + document retrieval
- Provenance inspection UI

## Tasks

- [x] Pick graph store via ADR (licence compatible) — [ADR-0020](../adr/ADR-0020-knowledge-graph-store.md): SQLite tables in the Phoenix database; Neo4j Community (GPL-3.0) is licence-compatible but a second datastore, and was not benchmarked
- [x] Entities/relations: Person, Project, Repository, Commit, Service, Deployment, Meeting, Decision, Feature, Issue (+ PullRequest, CIRun, Document) — closed sets, enforced by `CHECK` constraints and a relation schema
- [x] Ingest from existing capabilities — git, github (PR, CI, deploy), docker, issues, meetings, memory, explicit mentions; run for real on this repository's history and the committed GitHub fixtures
- [x] Answer 'why/which/who' graph questions — the answer is the explanation path with provenance for every hop
- [ ] UI to inspect origin of important context — **not built** (parent builds the UI); the API it needs is `GraphInspector.inspect` / `neighbors`
- [ ] Release v0.7 — **not cut**: the value gate is not met by the graph alone, and nothing is wired into Core

## Deliverables

- ai/knowledge-graph
- ADR-0020
- v0.7 release (not cut)

## Exit criteria

- [ ] Graph/hybrid retrieval proves measurable value (gate v0.7 → v0.8) — **measured, not met by the rule fixed in advance** (graph − best-case retrieval = +0.089 on relationship questions, needed +0.150). The graph clearly beats today's memory search (+0.630) and the graph-plus-retrieval combination beats best-case retrieval by +0.189; see the benchmark below. The owner decides whether the combination is the gate.

## Notes & risks

- Add GraphRAG only when measurably useful.

## Implementation notes

### What was built (`ai/knowledge-graph`, `@phoenix/ai-knowledge-graph`)

- **Store** (`graph.ts`, migration **11**, ADR-0020): `kg_nodes`, `kg_edges`, `kg_provenance`, plus `kg_rejected` (a rejected AI proposal is not proposed again) and `kg_suppressed` (a hash of a forgotten person's id). Node ids are `<Type>:<natural key>`; edges are `<src>|<REL>|<dst>`. 13 node types and 11 relations (`AUTHORED TOUCHES PART_OF DECIDED_IN MENTIONS FIXES DEPLOYED_TO TRIGGERED ASSIGNED_TO REFERENCES PARTICIPATED_IN`), each relation restricted to the node types it may join (`RELATION_SCHEMA`; a write outside it throws). Upserts are idempotent on `(type, key)`; an edge keeps one provenance row per `(source, assertor)`, so an edge with several supporting sources keeps all of them.
- **Provenance on every node and edge**: source kind and id (event id, memory id, meeting id, meeting item id, capability), capability, observed-at, recorded-at, confidence, assertor (`rule | capability | user | ai:<model>`), and the **scope, domain and sensitivity of the source**. Descriptive detail (title, state, url) is small, flat, secret-redacted and lives on the provenance row, so it is deleted with it.
- **AI assertions are proposals**: an edge with only `ai:` rows is `proposed`, is not walked by any query unless asked (then it is marked `[proposed, not a fact]` in the path text), and becomes a fact only through `confirmEdge` (adds a `user` row next to the AI row; the origin chain keeps both) or a rule/capability row. `rejectEdge` deletes it and remembers the rejection. This phase's ingestion never writes an `ai:` row; the mechanism exists for Phase 35's reviewed meeting items and later phases.
- **Deletion** is by triggers, like the FTS and vector indexes: the last provenance row of an edge or node removes it; tombstoning or deleting a `memory_items` row, tombstoning a `meetings` row, and deleting or rejecting a `meeting_items` row delete the provenance they were the source of. Edges with other sources keep the rest. Tested through the real `MemoryStore.forget`, `forgetWhere` and `MeetingStore.delete`, not only through the graph's own calls. `forgetPerson(name)` removes the node, its edges and provenance and suppresses the name (stored as a hash) so ingestion does not bring them back; `allowPerson` lifts it.
- **Permissions**: every read takes a `Viewer`. A provenance row the viewer cannot read does not exist for them; a node or edge with no readable row is invisible; traversal drops it before counting, so degree, `truncated` flags and path existence reflect the visible graph only (tested with a narrow viewer next to the owner on the same graph).
- **Ingestion** (`ingest.ts`, `extract.ts`): `GraphIngestor.attach(bus)` subscribes to `git.commit.created`, `github.pr.*`, `github.ci.*`, `github.deploy.*`, `docker.container.*`, `issues.*` through an injected `EventSubscriber` (`EventBus` satisfies it). Also `ingestCommit` / `readGitHistory` (read-only `git log`, author **name** only, files per commit capped at 200), `ingestMeeting` (participants as Person nodes by name, decisions, reviewed meeting items), `ingestMemory` (commit, meeting-decision and project-doc memories cite the memory id as their source). **Explicit mentions only**: `#12`, `owner/repo#12`, `fixes/closes/resolves #12`, `pull request #4`, `PROJ-45` (only for tracker prefixes that are configured or already in the graph), `ADR-0014`, `Phase 13`, a full 40-hex commit hash that already exists, and a known `owner/name`. No fuzzy matching, no model. Email-shaped names never become a Person. The github capability reports a CI run's commit as a 7-character hash; the run keeps it in its provenance and is linked to a commit only when exactly one known commit of the repository has that prefix (ambiguous or unknown: no link; retried when a commit or run arrives).
- **Questions** (`query.ts`, `answer.ts`): `why(entity)` (reasons ranked Decision > Meeting > Issue > PullRequest > Commit > Document > CIRun, then by length), `which({type, relation, entity})` (one edge, direction from the relation schema), `nearest(entity, type)` (the entities of that type at the smallest hop count), `who(entity)` (people within 2 hops, shortest path first). The answer is the **explanation path**: nodes, hops, and for every hop its provenance rows. A person is an endpoint, never a bridge (a path through "ada" says nothing about how two things she touched are related). Bounds: depth ≤ 4 (default 3), fan-out per node (default 50), nodes visited (2000), wall clock (500 ms, injected clock); the answer says which bound was hit. `answerQuestion(question)` finds seed entities by exact id / key / name / hash / `#N` / ADR / phase, runs the matching queries, and takes documents from an **injected `Retriever` function type** (`(request) => Promise<DocumentHit[]>`; a `HybridRetriever` result adapts by mapping id, text and citation), returning `graph` (facts with paths) and `documents` (retrieved text with citations) separately and never merged. `narrate(path, generate)` rewrites a path through an injected text function and **refuses** the result if it contains any identifier (graph id, hash, number, issue key, phase number) that the path does not; then the deterministic path text is returned.
- **Inspection** (`inspect.ts`): `inspect(viewer, nodeId)` → origin chain (newest first: source, time, assertor, confidence, capability), a summary and a visible-edge count; `inspectEdge`; `neighbors(viewer, nodeId, {depth ≤ 2})`, capped at 100 nodes and 200 edges and saying when it cut.

### Benchmark: does the graph earn its place? (exit criterion)

`ai/knowledge-graph/test/benchmark/` (`spec.ts` is the pre-registration; `systems.ts`, `run.ts`, `benchmark.test.ts`). Run: `npx tsx ai/knowledge-graph/test/benchmark/run.ts .`

**Pre-registered before either system existed**, in `spec.ts` (sha256 `03d5f054306cd8f3b0ee213f00a7a2d72c5d106966f59d3694abe94855c75e0e`, unchanged for every run reported here): data = this repository's git history at `9413132`, the 102 markdown files tracked there, and the committed GitHub fixtures (4 real workflow runs, 1 real PR). **36 questions** in 9 categories, ground truth from `git` itself (`git log -- path`, `git log --grep`, `git show` for file contents) and the fixtures, never from either system. Metric: **R-precision** (the top |E| of the answer against the expected set E; an empty answer scores 0); also recall@10. Systems: **graph**; **B1** = today's Phoenix memory search (stock commit and doc memories, bm25); **B2** = best-case retrieval (B1 plus each commit's author, full message and file list in its memory text, and one memory per CI run), so the graph is not credited for data retrieval was never given; **G+B2** = graph answer if it has any entity of the target type, else B2's. **Gate, fixed in advance:** on the relationship questions (touched, ci_for, ci_commit, multihop, who) the graph's mean R-precision must exceed B2's by ≥ 0.15 **and** exceed B1's. Expectations written in advance: the graph wins on touched / ci / multihop / who, ties on explicit tokens (ADR, phase), loses on pure lexical phrases.

R-precision / recall@10 (36 questions, one run, deterministic):

| Category | n | graph | B1 (today) | B2 (best-case retrieval) | G+B2 |
| --- | --- | --- | --- | --- | --- |
| touched ("which commits touched `<path>`") | 8 | **1.000** / 1.000 | 0.300 / 0.300 | 0.652 / 1.000 | 1.000 / 1.000 |
| adr_docs | 5 | 1.000 / 1.000 | 1.000 / 1.000 | 1.000 / 1.000 | 1.000 / 1.000 |
| phase_docs | 4 | 1.000 / 1.000 | 0.042 / 0.042 | 0.042 / 0.042 | 1.000 / 1.000 |
| phase_commit | 4 | 1.000 / 1.000 | 0.250 / 0.625 | 0.250 / 0.250 | 1.000 / 1.000 |
| ci_for ("which CI runs ran for commit X") | 3 | 0.333 / 0.333 | 0.000 / 0.000 | **1.000** / 1.000 | 1.000 / 1.000 |
| ci_commit | 4 | 0.250 / 0.250 | 0.000 / 0.000 | 0.250 / 0.250 | 0.250 / 0.250 |
| multihop ("CI runs for commits that touched `<path>`") | 2 | **1.000** / 1.000 | 0.000 / 0.000 | 0.500 / 1.000 | 1.000 / 1.000 |
| who | 3 | 1.000 / 1.000 | 0.000 / 0.000 | 1.000 / 1.000 | 1.000 / 1.000 |
| lexical ("commits mentioning a phrase") | 3 | **0.000** / 0.000 | **1.000** / 1.000 | 1.000 / 1.000 | 1.000 / 1.000 |
| **Relationship questions (gate set, n = 20)** | 20 | **0.750** | 0.120 | 0.661 | 0.850 |
| **All 36** | 36 | 0.778 | 0.321 | 0.622 | 0.917 |

Per question, graph vs B1: 23 wins, 10 ties, 3 losses; vs B2: 16 wins, 15 ties, 5 losses. **Gate: graph − B2 = +0.089 (needs ≥ +0.150); graph − B1 = +0.630 → NOT PASSED** by the rule written beforehand. (G+B2 − B2 = +0.189 on the same questions, but G+B2 was not the gate and the gate was not rewritten after the fact.)

What the numbers say, without spin:

- **Against today's memory search the graph wins by a wide margin** (+0.630 on relationship questions). That is mostly data, not cleverness: Phoenix's memory holds one line per commit, no files, no author and no CI runs, so "which commits touched X" is unanswerable by it (0.300).
- **Against best-case retrieval the margin is small and not enough.** Once the commit memory contains the file list, bm25 finds the commits that touched a path almost as well (touched: recall@10 1.000, but R-precision 0.652 because it returns ten commits mentioning words from the path, mixed with the right ones). The graph's real advantage there is precision, and that the answer is the exact set with a path for each member, not a ranked guess.
- **The graph beats both baselines clearly on multi-hop** (multihop 1.000 vs 0.500) and on phase mentions in documents (phase_docs 1.000 vs 0.042; the memory search drops single-character query words (`contentWords`), so "Phase 1" is searched as just "phase" and matches nearly every chunk; this was inferred from the code, not separately tested), and ties on explicit ADR tokens, as expected.
- **The graph loses where it has no text** (lexical 0.000 vs 1.000), as expected and as it should: it is not a search engine. It returns nothing rather than a guess.
- **Three of the four `ci_commit` and two of the three `ci_for` questions are not answerable by anything**: the recorded runs name commits (`a4ef8a4`, `f36167b`) that are not reachable from the pinned `main` history (`f36167b` exists only on the local branch `claude/upbeat-faraday-qor262`; `a4ef8a4` is on no local ref; commit `17ce5a1`'s subject mentions history rewrites, which may be why; not investigated), so they are not in the pinned history and no commit node exists to link. The graph says nothing for them; B2 got `ci_for` right by returning every run (all four runs fit in the top 10), which is not an answer to "which runs ran for this commit". That is a weakness of the judge (R-precision rewards returning the whole short list) and was kept as registered.
- **The ground-truth set is small** (36 questions, 4 CI runs, 2 multi-hop questions, 3 who questions). A difference of 0.089 over 20 questions is within what re-picking the questions could change; the +0.630 against B1 is not.

Two generic bugs were fixed between the first and second run, found by reading failures; the spec was not edited. (1) Traversal let a Person node act as a bridge, so "which commit did CI run N run for?" returned a commit reached commit → person → commit (a wrong answer in the first run; after the fix the graph returns nothing for it, same R-precision 0.25). (2) Question seeds were extracted from a path before the path text was masked, so `phase-30` inside `docs/phases/phase-30-x.md` was also read as "Phase 30" (touched 0.875 → 1.000, which is the whole move of the gate-set mean from 0.700 to 0.750). A **post-hoc** run with `git log --all` instead of the pinned history was also made, to see whether including the branch commits helps the CI questions: it did (ci_for 0.667, ci_commit 0.500), but the graph then trailed B2 on the gate set (0.545 vs 0.643) and `who` fell to R-precision 0.000 with recall@10 1.000; the cause of that drop was not investigated. That variant is not part of the registered result and was not kept as a code path; it is mentioned only because it was run.

**Decision on GraphRAG: not built.** The pre-registered rule was to build an LLM-over-graph layer only if a relationship category stayed below 0.8 "for reasons a narration step could plausibly fix". The relationship categories below 0.8 are `ci_for` and `ci_commit`, and the reason is missing data (commits that are not in the history), which no model can fix. Everything else is at 1.000. `narrate` (a guarded rewrite of one path) exists and was run against real `llama3.2` on three paths, which it narrated without inventing an identifier; that is a presentation aid, not retrieval.

**Decision for the owner:** the graph alone does not meet the gate against best-case retrieval. What the data supports is "graph + retrieval beats retrieval", measured as G+B2 (0.850) vs B2 (0.661). If the v0.7 → v0.8 gate means "graph/hybrid", that is met; if it means "graph beats a retrieval baseline that already contains the graph's facts as text", it is not. This doc does not make that call.

### Real runs (this repository, read-only)

- Ingested the pinned history (59 commits, 102 markdown files via the real Phase 28 `ingestDocs`, the 4 real workflow runs and the real PR from the committed fixtures through the real `diffRuns`/`diffPulls`): **619 nodes, 1,561 edges, 9,672 provenance rows**, 2.8 s.
- Real answers: *Which commits touched `core/state-engine/src/engine.ts`?* → 6 commits, each with the `git` event/commit source on its edge; *Which CI runs ran for commits that touched `docs/security-review.md`?* → run 37827195337 via `a27fd84 --TOUCHES--> docs/security-review.md` and `a27fd84 --TRIGGERED--> run`; *Who authored the commits that touched `apps/web/src/App.tsx`?* → `thunder-bluephoenix`, path commit → file and person → commit; *Which documents reference ADR-0014?* → the ADR file itself, `docs/adr/README.md`, `phase-03-core-runtime-skeleton.md`, … each with memory-id sources; *Why Phase 14?* → `ADR-0001`, `ADR-0013` via the documents that reference Phase 14.
- Deletion on real data: `forgetWhere` over all 1,655 project-doc memories took the graph from 619 nodes / 1,561 edges / 9,672 provenance rows to 564 / 1,052 / 2,184; `Decision:ADR-0014` disappeared (its only sources were documents); all 59 commits stayed. `forgetPerson("Rahul Sarkar")` removed 1 node, 1 edge, 2 provenance rows and left the other author.
- Latency at 100k edges: see ADR-0020.

### Not done / limits

The inspection UI and the release; the gaps are listed in `docs/gaps.md`.

## Wired into Core

`core/runtime/src/graph.ts` (`GraphRuntime`), routes in `core/api/src/graph-routes.ts`, migration **17** (`kg_event_deleted`), tests in `core/runtime/test/graph.test.ts` (35 cases through the real routes).

- **Ingestion.** The runtime subscribes to the bus for the graph's event types (only when the event's `source` is the family it names: a `git.commit.created` from `terminal` is ignored). A live commit event carries no author or files, so each new sha is also read with a read-only `git log -1` from the repository named in the event's `path` **only if that exact path is configured on the git capability**, and its facts cite the event id (deleting the event deletes them). Memories are ingested at startup and hourly (`ingestMemory`); meetings and their reviewed items are ingested while `allow_sensitive_meetings` is on, after every meeting change and every review action.
- **Deletion paths** (one runtime test each): event retention and delete-all events (migration 17 trigger on `events`), delete-all memory and forget one memory (migration 11 triggers), delete a meeting and delete-all meetings (migration 11 trigger), rejecting a reviewed item (trigger), turning 'allow sensitive meetings' off (`removeWhere({sourceKind:'meeting'|'meeting_item'})` plus audit `graph.meeting_data.removed`), forget a person (`POST /api/graph/people/forget`). Event-sourced rows are removed by the trigger rather than by a call after `deleteBefore` because the history limit, capability uninstall and delete-all also delete events and none of them can forget to tell the graph.
- **Viewer.** Every route reads as the runtime's one viewer (`memory.agentContext().viewer`), never as the owner by default; a narrower viewer gets 404 for a node it has no readable provenance for (tested).
- Narration is off unless the request says `narrate: true` and AI is on; it is labelled sensitive with a purpose the cloud gate never allows for sensitive data, and falls back to the path text when it names an identifier the path lacks.
- Not wired: `POST /api/graph/edges/:id/confirm|reject` (nothing writes an AI-asserted edge yet), the web provenance view, stale-fact reconciliation.

## API contract

All routes need the session token; JSON is snake_case; bodies have exact keys (unknown field = 400). Errors are `{code, message, details}`. Node ids look like `Commit:Phoenix@<sha>`, `Document:Phoenix:core/api/src/server.ts`, `Person:ada lovelace`, `Meeting:kage:7`, `Decision:ADR-0020`; **they must be %-encoded in the URL path** (`encodeURIComponent`).

**Provenance** (`GraphProvenanceView`), one per source supporting a node or edge: `{ source_kind: "event|capability|memory|meeting|meeting_item|user", source_id, capability, observed_at, recorded_at, confidence (0-1), asserted_by: "rule|capability|user|ai:<model>", scope, domain, sensitivity: "public|internal|sensitive", detail: {flat string/number/bool/null map: title, state, url ...} }`. `source_id` is an event id for `event`, a memory id for `memory`, a meeting id for `meeting` and an item id for `meeting_item`; the UI can link the last three to the Memory tab, the meeting and the review item. Show `sensitivity` (a meeting-derived row is `sensitive`) and `asserted_by` (an `ai:` row on its own makes the node `status: "proposed"`; label it "suggested by a model, not a fact").

**Node** (`GraphNodeView`): `{ id, type, key, label, status: "fact|proposed", detail, provenance: Provenance[] }` (oldest provenance first). **Edge** (`GraphEdgeView`): `{ id: "<src>|<REL>|<dst>", src, rel, dst, status, provenance }`. Types: Person, Project, Repository, Commit, Service, Deployment, Meeting, Decision, Feature, Issue, PullRequest, CIRun, Document. Relations: AUTHORED, TOUCHES, PART_OF, DECIDED_IN, MENTIONS, FIXES, DEPLOYED_TO, TRIGGERED, ASSIGNED_TO, REFERENCES, PARTICIPATED_IN.

| Route | Response |
|---|---|
| `GET /api/graph/nodes/:id` | 200 `{ node: Node, origin: Provenance[] (newest first), summary: { sources, assertors: string[], capabilities: string[], status }, visible_edges }`; **404** when the node does not exist or the viewer can read nothing about it (the two are indistinguishable); ids over 400 characters are 404. This is the origin chain the provenance view shows. |
| `GET /api/graph/nodes/:id/neighbors?depth=` | `depth` 1 (default) or 2, else 400. 200 `{ center, nodes: Node[], edges: Edge[], truncated: bool }` (at most 100 nodes and 200 edges; `truncated` says it cut). 404 as above. |
| `POST /api/graph/ask` `{ question (1-500), narrate?: bool }` | 200 `{ question, seeds: Node[], answers: Answer[], documents: [{id,text,source,source_ref,score}], notes: string[], retrieval: {mode,...}, narration: null \| { text, narrated: bool, processed_by: string\|null } }`. `seeds` are the entities of the question that matched exactly (empty = no graph facts, `notes` says so). `answers` are why/which/who facts, **never produced by a model**; `documents` are memory text found for the same question (hybrid when Phase 37 retrieval is on) and are shown apart. `narration` is non-null only when `narrate: true`; `narrated: false` means the model's words were refused and `text` is the path text. |
| `POST /api/graph/people/forget` `{ name (1-200), confirm: true }` | 200 `{ removed: { provenance, nodes, edges } }`; `confirm` must be the literal `true` or 409 `ACTION_REQUIRES_CONFIRMATION`. Removes the person node, their edges and provenance, and keeps them out of future ingestion (only a hash of the id is stored). Audit `graph.person.forgotten` (counts only). |
| `GET /api/graph/status` | `{ nodes, edges, provenance (whole-graph counts), visible_nodes_by_type: {Type: n}, commits_backfilled, last_ingest: null \| { at, memories, meetings } }` |

**Answer** (`GraphAnswerView`) is a union on `kind`: `{ kind: "why", subject: Node|null, paths: Path[], truncated }`, `{ kind: "which", subject, type, results: [{ node: Node, path: Path }], truncated }`, `{ kind: "who", subject, people: [{ person: Node, paths: Path[] }], truncated }`. **Path**: `{ nodes: Node[], hops: [{ from, to, direction: "forward|backward", edge: Edge }], text }`; `text` is one line per hop from graph facts only and is what to show first; each `edge.provenance` is the evidence for that hop. `truncated` is `{ depth?, fanout?, visited?, time?, results? : true }`: say which bound cut the answer short.

**Real run** (Core booted with `PHOENIX_DATA_DIR`, git capability watching this repository, 4 real commit events through `POST /api/events`): *which commits touched `core/api/src/server.ts`* returned 3 commits, each path citing a `git` event; *who touched it* returned `Person:thunder-bluephoenix`; a commit node's origin chain read `event / git / capability`; a meeting inserted through the same tables the Kage sync writes (no real Kage was running) produced `Meeting`, `Decision` and two `Person` nodes whose provenance is `sensitive`, and `why Meeting:kage:real1` returned the decision with `--DECIDED_IN-->` and (with `narrate`) a llama3.2 sentence that passed the identifier check. Delete-all events took the event-sourced rows out (102 nodes to 66), delete-all memory emptied the graph and the vectors, deleting the meeting removed its nodes.

## Web UI

`#/provenance` (`Provenance.tsx`, nav link "Provenance"): a question box (`POST /api/graph/ask`) that lists the entities found as links, graph facts as numbered text steps (relation, direction, confidence, "suggested, not a fact" for AI-only edges) with Core's own path line under each, retrieved documents apart, and a note naming the bound that cut an answer short. `#/provenance/<node id>`: what the entity is, whether it is a fact, "Where it came from" (sources, assertors) and "What it is connected to" as text lists ("Connected from" / "Connected to"; one or two steps out). Every node and edge has a "Why do you think this?" button (`aria-expanded`) that lists the evidence: `<source_kind>:<source_id>`, assertor in words, confidence, capability, sensitivity, the stored quote or "No quote is stored", and the flat detail fields, all as text. There is no canvas.

Limits found: Core returns no quote for a provenance row beyond `detail.text` / `detail.title`, so a meeting row says "No quote is stored for this evidence" unless the ingestion wrote one; edges that do not touch the entity (what depth 2 can return) are listed under "Further out" (not seen in the smoke, where depth 2 added none).

**Checked:** `apps/web/test/provenance.test.tsx` (14 cases: empty graph, error, hostile label, quote and document as text, AI-suggested node, evidence list, depth 2, unknown node, double click). Browser smoke against a real Core with a meeting and three decisions: "why Meeting:kage:7" listed three DECIDED_IN steps with 100% confidence, the evidence list showed `meeting_item:` and `meeting:` ids with sensitivity, a decision whose text was `<img src=x onerror=alert(1)>` produced no `img` element, and the page did not overflow at 320, 360, 460 and 768 px.

## Source documents

- Post-MVP Roadmap v1.0 §9
- Technical Spec Suite 04–14 §08

---
Back to [TRACKER](TRACKER.md)
