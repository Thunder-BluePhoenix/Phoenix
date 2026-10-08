# Phase 27 — Model Adapter & Router

| Field | Value |
|---|---|
| Stage | Stage 3 — Memory & Context (v0.3) |
| Release target | v0.3 |
| Priority | High |
| Status | 🟨 In progress (package built and tested; runtime wiring and Anthropic live check outstanding) |
| Depends on | [Phase 26 — Issue Tracker Capabilities & v0.2 Release](phase-26-issue-tracker-capabilities.md) |
| Unblocks | [Phase 28 — Context Engine & Basic Memory Store](phase-28-context-engine-and-memory-store.md) |

## Goal

Introduce a provider-agnostic AI layer with one cloud and one local adapter, optional to core.

## Scope

**In scope**

- Common model interface (text first; embedding role)
- Router by task, privacy, latency, cost, availability
- Visible provider choice

**Out of scope**

- Vision/speech models (Phase 54)

## Tasks

- [x] Define model interface: generate, stream, embed
- [x] Implement one local and one cloud adapter
- [x] Router factors: privacy class, latency, cost, offline availability, user choice
- [x] Timeouts, retries, safe fallback; never auto-retry side effects
- [x] AI_external_processing permission gate + visible 'processed by X' label
- [x] Core keeps working with AI disabled

## Deliverables

- ai/models package

## Exit criteria

- [x] No silent external AI transmission (proved at package level with a counting fake network; the runtime must still construct `AiService` with the real grant, see notes)
- [x] Core functional without AI (nothing in Core imports `@phoenix/ai-models`; `enabled: false` makes zero calls)

## Implementation notes

- `ai/models` (`@phoenix/ai-models`) depends only on protocol + logging. `AiService.run(task)` → router plan → gate → provider with timeout, bounded retry (generate/embed only, 5xx/429/network, injected sleeper) and fallback. Every result carries `provenance.processedBy` ("Ollama (this device) · llama3.2 · on this device").
- Hard rules, not weights: sensitive data never goes to a cloud provider (`SENSITIVE_DATA_MAY_USE_CLOUD`, the Phase 29 hook in `gate.ts`); cloud needs the `AI_external_processing` grant (asked again before every call) AND a per-class opt-in (`public`/`internal`; there is no sensitive opt-in). A refused cloud provider is recorded with its reason in `attempts`, never silently replaced by sending anyway.
- Ollama is loopback-only and also refuses models that Ollama proxies to a remote host (`*:cloud`, anything with `remote_host` in `/api/tags`): on this machine `kimi-k2.5:cloud` and `gpt-oss:120b-cloud` are of that kind, so they are not "local".
- Verified for real against Ollama 0.15.5 (`llama3.2`, `nomic-embed-text`): `PHOENIX_REAL_OLLAMA=1 npx vitest run ai/models/test/real-ollama.test.ts`. Embeddings are 768-dimensional; cosine of near-duplicate sentences 0.898 vs 0.400 for unrelated ones.
- **Not verified: the Anthropic adapter.** No API key was available and `api.anthropic.com` was never contacted; it is tested only against fakes that emit the documented Messages/SSE format. The default model id (`claude-haiku-4-5`) is unchecked.
- Not done in this phase: runtime wiring, settings persistence and API routes (parent), Phase 29 rules for sensitive data.

## Source documents

- Technical Spec Suite 04–14 §04, §14 milestone 8
- AI Evolution v1.0→v2.0 §16
- Full System PRD v2.0 §12

---
Back to [TRACKER](TRACKER.md)
