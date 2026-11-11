# Phase 37: real embedding pipeline run (2026-11-12)

Raw numbers: `phase-37-real-embed-pipeline-2026-11-12-raw.json`. Test: `core/runtime/test/real-embed-pipeline.test.ts`
(`PHOENIX_REAL_OLLAMA=1`, optional `PHOENIX_EVIDENCE_OUT=<file>`; three tests, about 36 s). One run is recorded;
nothing was tuned after a result. Timings are single observations on one Mac, not a benchmark.

## Setup

- A real in-process `PhoenixRuntime` on a temp on-disk data dir (`phoenix.sqlite`, removed afterwards), so Core is
  stopped and a NEW `PhoenixRuntime` is started on the same dir. Real settings store, real `memory_vectors` table.
- Corpus: 36 short synthetic notes written for this test (12 cooking, 12 astronomy, 12 cycling), captured through the
  real `MemoryPipeline`. No personal data.
- Core reaches Ollama **only** through a loopback TCP/HTTP proxy owned by the test (127.0.0.1:11998, `ollamaUrl` plus a
  fetch guard that refuses any other host or any `cloud` body). The proxy forwards `GET /api/version`, `GET /api/tags`
  and `POST /api/embed` (models `nomic-embed-text` and one alias) to the owner's Ollama 0.15.5 on 11434, refuses
  everything else (0 refused in the run), counts every request, and can destroy connections or be stopped and started.
- Owner's Ollama: only `GET /api/tags`, `/api/ps`, `/api/version`, `POST /api/embed` through the proxy,
  and one `POST /api/generate {model: nomic-embed-text, keep_alive: 0}` (eviction from RAM only). No pull, create,
  copy, remove, no generation, no llama3.2 call, no `cloud` model used. The `/api/tags` list (names and digests,
  SHA-256 of the list) was identical before and after the run.

## 1. Cold start (observed)

- `/api/ps` was empty before; after the keep_alive 0 call `/api/ps` showed no nomic-embed-text (confirmed).
- Turning retrieval on indexed 36 notes in batches of **16, 16, 4** (the indexer default `batchSize` 16), one provider
  call each, **no timeout, retry or failure**. First embed (includes loading the model): **598 ms** in the final run
  (861 ms in the first run); the next batches 79 ms and 25 ms (87 ms and 26 ms first run). Whole index wall time
  743 ms (1006 ms first run). `/api/ps` afterwards listed nomic-embed-text.
- Warm repeat (explicit rebuild of the same 36 texts): 79, 79, 25 ms (195 ms wall). The cold penalty here was about
  0.5 to 0.8 s for this 274 MB model on this Mac. A much larger model or a loaded machine could be slower; the
  per-call limit in the wiring is 60 s (`timeoutMs: 60_000`) and was never close.
- Stored: 36 rows in `memory_vectors` for `ollama/nomic-embed-text#prefixed`, one distinct dimension (**768**).
- Sanity (not exact-value assertions): mean cosine of stored vectors, same topic 0.648 vs different topic 0.549.
  The assertion is only same-topic > different-topic (it held). The gap is small; this says the vectors carry some
  topic signal, not that retrieval is good.
- Core start 82 ms, stop 3 to 4 ms.

## 2. Outage and restart during the cooldown (observed, with the proxy, not a real Ollama restart)

- The proxy let the first batch of 16 through, then destroyed every connection (the outage).
- Indexer behaviour: the batch of 16 failed, then the items were retried one at a time; two consecutive failures with
  no success meant "provider down": 3 embed requests were reset in total (the batch plus two single retries), nothing
  was recorded against any item (`failures` 0, no parking), the run ended with `degraded: ["provider_unavailable"]`,
  16 vectors stored, 20 still unembedded. The router marked the `ollama` provider `available: false`
  ("Could not reach ollama").
- Cooldown: `memory.indexer.cooldown_until` was written to the real settings table (row seen in SQLite,
  `1794422182660` in the final run, 29 997 ms after it was set: the default first backoff of 30 s; the indexer
  exposes the length only through `backoffMs`, which Core does not set, so the real default was used with the real
  clock rather than an injected clock).
- Events: no bus event is published for the outage and the audit log has only the two settings changes
  (`ai.settings.changed`, `retrieval.settings.changed`). The only outward signs are `last_run.degraded` and
  `GET /api/retrieval/status` (and `/api/ai/status` provider availability).
- Core A stopped cleanly (4 ms). The proxy was stopped and started (provider "back"). A NEW Core on the same data
  dir started 28 ms later, loaded retrieval as enabled, saw the same `cooldown_until`, ran the startup maintenance
  (`memory.maintain()`) and three explicit `retrieval.index()` calls: each returned 0 embedded with
  `provider_unavailable`. **Embed requests that reached the proxy during the cooldown: 0** (and none until
  after expiry; also checked at the end of the wait).
- After the cooldown expired (about 30 s of real clock), the next `index()` embedded the remaining 20 in batches
  16 and 4 (182 ms), cleared the setting (`null`), and ended with 36 vector rows, 36 distinct memory ids, 0 lost,
  0 failures, and exactly 20 texts sent (all distinct) on resume: no duplicates, nothing re-embedded.
- NOT done: a real Ollama restart. The outage is a dropped TCP connection at a proxy in front of a running Ollama.
  A killed, restarted or still-loading Ollama (connection refused, then slow model reload) was not exercised
  because the assignment forbids stopping or restarting the owner's process.

## 3. Model switch on a real database (observed, with one logical model standing in for a second)

- A genuinely different embedding model is NOT available (the owner's only embedding model is nomic-embed-text).
  The second identity is the configured model name `nomic-embed-text-alias256`. The code keys vectors by
  `provider/model#prefixed` (`vector_space`), so this is a different vector space. The proxy rewrites that name to
  `nomic-embed-text` upstream and truncates each returned vector to its first 256 values (nomic-embed-text v1.5 is a
  Matryoshka model; I did not verify that claim against the model card, it only has to give the alias a different
  width). So the alias space holds REAL nomic vectors of width 256 beside the 768-wide ones; it tests the switching
  logic with real vectors and a real database, not the behaviour of two different models.
- Index with nomic-embed-text: 36 x 768. Switch the setting to the alias (`POST /api/retrieval/settings`): status
  showed `vector_space` = alias key, `embedded` 36, `other_models: [{nomic: 36}]`; 36 x 256 stored by 3 embed calls
  (16, 16, 4) that all named the alias model; the original 36 rows were byte-identical afterwards (SHA-256 of
  id+vector).
- Search under the alias embedded the query with the alias model only (1 request, width 256) and returned
  `retrieval: {mode: "hybrid"}`. The store refuses to mix spaces: a 768-wide query on the alias space and a 256-wide
  query on the real space both throw `VectorDimensionError`; a search on the alias space returned only ids that have
  alias vectors.
- Rebuild under the alias re-embedded all 36 texts through the alias (3 calls), replaced only the alias space
  (the real space unchanged, byte-identical); the alias vectors were identical after re-embedding (embedding is
  deterministic here). Switching back to nomic-embed-text needed 0 embed requests (its vectors were retained);
  rebuild under nomic re-embedded 36 texts and left the alias space untouched.
- For the one question used ("which telescope shows the moons of a giant planet"), the top two results were the same in
  both spaces (Jupiter moons note, lunar eclipse note); result quality is not assessed.

## What stays unverified

- Real Ollama restart or crash (connection refused, model reload after restart, a half-written response).
- A genuinely different embedding model (different architecture/dimension/tokeniser). The switch test used one
  model under two names.
- A large corpus (36 notes only), a model larger than 274 MB, and cold start under memory pressure.
- The one-hour maximum backoff and repeated outages (second backoff 60 s etc.) were not run; only the first
  30 s cooldown was.
