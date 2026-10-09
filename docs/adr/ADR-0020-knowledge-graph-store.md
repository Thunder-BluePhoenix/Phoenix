# ADR-0020: Knowledge graph store: a property graph on SQLite tables

**Status:** Accepted  
**Date:** 2026-10-09

## Context

Phase 38 builds a graph of people, repositories, commits, issues, meetings, decisions, CI runs and deployments, with provenance on every node and edge, and answers "why / which / who" questions from it. The phase says to "evaluate Neo4j or compatible". Constraints already decided: Phoenix is local-first (ADR-0001), a single local Core owns one SQLite database (ADR-0014, ADR-0015), and the project is GPL-3.0 (ADR-0009). Two requirements are specific to the graph and decide the choice more than raw query speed:

1. **Deletion must reach the graph in the same transaction as its source.** A memory tombstone, a deleted meeting or "forget this person" must remove every node, edge and provenance row that only that source supported, with no window in which the graph still answers.
2. **Reads are permission-scoped per edge.** An entity supported only by data the viewer cannot read must not exist for that viewer, nor be inferable from degree or path existence.

## Candidates

| Candidate                                                       | Licence (checked 2026-10-09 against the upstream repositories)                                                                                                                                                                   | Runs as                              | Fit                                                                                                                                                                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **(a) Property graph on SQLite tables in the Phoenix database** | SQLite is public domain; `node:sqlite` is part of Node                                                                                                                                                                           | in-process                           | One transaction with memory, meetings and the vector index; deletion by triggers; no new process, port, credential or dependency.                                                                                  |
| (b) **Neo4j Community**                                         | GPL-3.0 (GitHub `neo4j/neo4j`: "Neo4j Community Edition is an open source product licensed under GPLv3"; the same README says Enterprise Edition "requires a commercial license"). The official JavaScript driver is Apache-2.0. | JVM server (Bolt on 7687, HTTP 7474) | Compatible with GPL-3.0 as a separate process. A second datastore the user must install, run, secure and back up; deletion and permission rules would have to be mirrored from SQLite, with no shared transaction. |
| (c) Kùzu (embedded graph DB)                                    | MIT, but the upstream repository is **archived** (last push 2025-10-10)                                                                                                                                                          | in-process                           | Attractive shape, no maintainer. Not a base for a v0.7 release.                                                                                                                                                    |
| (c) Memgraph                                                    | BSL 1.1 / Memgraph Enterprise Licence (per `LICENSE`)                                                                                                                                                                            | server                               | Source-available, not open source; not suitable for a GPL-3.0 project to require.                                                                                                                                  |
| (c) FalkorDB                                                    | SSPL v1                                                                                                                                                                                                                          | Redis module                         | SSPL is not an OSI licence; rejected.                                                                                                                                                                              |
| (c) SurrealDB                                                   | BSL 1.1 with a "Database Service" restriction                                                                                                                                                                                    | server                               | Source-available; rejected.                                                                                                                                                                                        |
| (c) Apache AGE                                                  | Apache-2.0                                                                                                                                                                                                                       | PostgreSQL extension                 | Needs a PostgreSQL server; same objection as Neo4j and a bigger one for deletion (still a second database).                                                                                                        |

What was **not** done: Neo4j was not installed, started or benchmarked for this ADR. A Neo4j server was already running on the author's machine; it is the user's, and nothing in this phase connected to it. The Neo4j row is therefore about licence and operations, not measured performance, and no claim is made that Neo4j is slower or faster than the numbers below.

## Decision

Store the graph as three SQLite tables in the Phoenix database (migration 11): `kg_nodes`, `kg_edges` and `kg_provenance`, plus small `kg_rejected` and `kg_suppressed` tables. Node ids are `<Type>:<natural key>`; node types and relation types are closed sets enforced by `CHECK` constraints and by a relation schema in code (`RELATION_SCHEMA`).

**Provenance carries everything.** A node or edge has no content of its own. Each `kg_provenance` row records the source (event id, memory id, meeting id, meeting item id or capability key), when it was observed and recorded, confidence, who asserted it (`rule`, `capability`, `user` or `ai:<model>`), and the **scope, domain and sensitivity the source had**, the same vocabulary as `memory_items`. Existence and visibility both follow from these rows:

- Triggers delete a node or edge when its last provenance row goes, and delete the provenance of a removed node or edge. Further triggers delete provenance when a `memory_items` row is tombstoned or deleted, when a meeting is tombstoned, and when a meeting item is deleted or rejected. No application code has to remember to call the graph; this is the same pattern as the FTS (migration 7) and vector (migration 10) triggers.
- A viewer sees a node or edge only through provenance rows `canView` accepts. A node or edge with no readable row does not exist for that viewer, and traversal skips it before it is counted, so degree, "truncated" flags and path existence are computed on the visible graph only.
- AI-asserted rows (`ai:<model>`) never make a fact: an edge is `proposed` until a row from a rule, capability or the user stands behind it, proposed edges are not walked unless asked, and a user rejection is remembered so the same proposal is not made again.

Traversal is breadth-first in application code with hard bounds (depth ≤ 4, default 3; fan-out per node; nodes visited; wall-clock), and says which bound it hit. No recursive SQL.

## Measured limits

Synthetic graph built through the public API (so every write is validated and carries provenance): **100,000 edges, 30,500 nodes, 225,000 provenance rows**: 25,000 commits each with an author edge, a mention of one of 2,000 issues, and two touched files out of 3,000. Apple Silicon laptop, Node 25.2.1, SQLite 3.51.2, one process. Database file 137 MB. Load in one transaction: 14.0 s. Medians of 20 runs (max in brackets):

| Operation                                                                | Time          |
| ------------------------------------------------------------------------ | ------------- |
| `adjacent` of an issue with about 50 edges                               | 0.18 ms (4.7) |
| `which` commits mention an issue (1 hop)                                 | 0.69 ms (0.8) |
| `why` an issue, depth 3, default bounds                                  | 3.3 ms (3.6)  |
| `who` for a file, depth 2, default bounds                                | 2.4 ms (2.7)  |
| `removeSource` (took out 9 provenance rows, 4 edges, 1 node)             | 6.1 ms        |
| `forgetPerson` (about 200 commits' worth: 100 provenance rows, 50 edges) | 6.5 ms        |

Worst case, one issue mentioned by 3,000 commits (a hub): `why` with default bounds 114 ms; `why` with fan-out raised to 5,000 at depth 3: 1.5 s; `who` at depth 2 with fan-out 5,000: 0.77 s; `neighbors` depth 2 (bounded to 100 nodes / 200 edges): 14 ms. The cost is per visible edge (each one is a provenance lookup plus a permission check), which is why the fan-out bound exists and why defaults stay small.

Real data: this repository's 59 commits, 102 markdown files and the GitHub fixtures give 619 nodes, 1,561 edges and 9,672 provenance rows, ingested in about 2.8 s including the memory pipeline.

Two things these numbers do **not** show: a second concurrent writer, and a graph larger than 100k edges. SQLite serialises writers; Core is the single writer.

## Consequences

- No new process, port, dependency or credential. Backup, export and deletion of the graph are the existing database operations.
- Deleting a source cannot leave a dangling fact, and the tests exercise the triggers (memory forget, `forgetWhere`, meeting delete) rather than only application calls.
- The graph answers questions about explicit relationships. It has no text index: a question about words that appear in no relation is a retrieval question, and the benchmark in the Phase 38 notes shows the graph losing there.
- There is **no Cypher or other graph query language**; queries are written in TypeScript against a small API. Anything a graph database would give for free (path patterns, PageRank, community detection) is not available.
- A timing side channel exists: a query over a hub the viewer cannot see is faster than the same query for a viewer who can. Measured on the hub above: the same `why` took 6.5 ms for a viewer with no matching grant and 114 ms for one who can read it. Counts and flags do not leak; timing does. Accepted for a local single-owner Core (gap register).
- Edge provenance rows grow linearly with the number of sources per edge (provenance rows, nodes' included, per edge: 2.25 in the synthetic graph, 6.2 on this repository, where each document chunk asserts the same edges again).

## Revisit when

- The graph passes about **1 million edges**, or `why`/`who` at the default bounds exceed **100 ms** on a normal user's data.
- A feature needs **unbounded or variable-length path queries**, graph algorithms, or a second process that writes the graph.
- Kùzu or another embedded graph engine is maintained, GPL-compatible and can take part in a SQLite transaction (or Phoenix gives up the single-transaction deletion guarantee on purpose).
- Neo4j changes its Community licence, or a deployment mode (a team server, ADR-0015's non-local topology) needs a shared graph.
