# Phase 63 — More AI Providers & Model Switcher

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 OpenAI-compatible and Gemini adapters, per-provider keys, per-category routing, the chat model switcher and answer attribution built and tested against fake networks; the OpenAI-compatible adapter ran against a real local Ollama `/v1` only (opt-in); no cloud provider, key or LM Studio was ever contacted; one HIGH architectural gap is open (the external-AI grant) |
| Depends on | [Phase 27 — Model Adapter & Router](phase-27-model-adapter-and-router.md) |
| Unblocks | [Phase 62 — Drop Files & Attach Windows as Context](phase-62-file-drop-and-window-context.md) |

## Goal

Chat with any common provider or a local model, switchable from the chat box.

## Tasks — parity with Coucou

- [ ] Claude, Gemini, OpenAI, DeepSeek, Qwen, Moonshot, Ollama, LM Studio. Code exists for all eight: Claude and Ollama from Phase 27, Gemini (`ai/models/src/gemini.ts`), and presets for OpenAI, DeepSeek, Qwen, Moonshot and LM Studio on the OpenAI-compatible adapter (`ai/models/src/openai-compatible.ts`). Each has unit tests against a fake network (`gemini.test.ts`, `openai-compatible.test.ts`, `routing.test.ts`). Left unticked: no cloud provider was ever contacted and LM Studio was never run, so "supported" is unproven for seven of the eight; only Ollama (the existing adapter, and the `/v1` path of the new one) ran for real.
- [x] The model name above the chat box opens a provider/model switcher: `apps/web/src/components/ModelSwitcher.tsx`, rendered by `Chat.tsx`. Keyboard-driven listbox, "Automatic" or a provider plus an on-demand model list, posts only the `chat` route. Tests: `apps/web/test/model-switcher.test.tsx` (all of "ModelSwitcher"). Component tests with a fake Core; not looked at in a browser.
- [x] The user's own keys are kept in the OS secret store: write-only `POST/DELETE /api/ai/providers/:id/secret` (the old `/api/ai/secret` route is gone), stored under `phoenix.ai.<id>_api_key`, never returned, audited without the value, deleted when an endpoint is removed or its URL changes. Tests: `core/runtime/test/ai-providers.test.ts` ("per-provider keys are write-only", "a key belongs to its destination…", "replacing an endpoint never lets the old key reach the new host…"), `apps/web/test/ai-providers.test.tsx` ("AI providers: keys"). The tests use an in-memory secret store; the macOS Keychain / Linux Secret Service / Windows Credential Manager paths were not exercised with a provider key.

## Tasks — Phoenix improvements

- [x] One OpenAI-compatible adapter covers OpenAI, DeepSeek, Qwen, Moonshot, LM Studio and any compatible server: five vendor presets (base URLs read from each vendor's public documentation, the URL kept beside the preset as `docs`; Qwen is the international Singapore endpoint `dashscope-intl.aliyuncs.com` only) plus up to eight user-added endpoints (`ai/models/test/openai-compatible.test.ts` "presets and user endpoints", `apps/web/test/ai-providers.test.tsx` "custom endpoints"). Locality is derived from the URL (`ai/models/src/url.ts`), never claimed: a user endpoint cannot declare itself local; redirects are refused; non-loopback endpoints need https.
- [x] Per-purpose routing with local-first defaults: purposes map to `chat`, `summaries`, `cleanup` (routable) and `embeddings` (never routed, never leaves this device) in `ai/models/src/purposes.ts`; with nothing routed no cloud provider is contacted; a routed provider is the only one tried and its failure does not fall through (`ai/models/test/routing.test.ts`, `core/runtime/test/ai-providers.test.ts` "routing, endpoints and prices settings"). A routed cloud provider still passes the existing gate (AI on, the `AI_external_processing` grant, the class opt-in, the sensitive-purpose allow-list).
- [x] Shows which model processed each answer and its cost when known: `AnswerView.tsx` shows model, provider, locality and cost. Cost is computed only from prices the user typed in (Phoenix ships no vendor prices); without a price, or for a non-finite result, it says cost unknown; a local answer is free (`routing.test.ts` "costOf: only from the user's prices", `model-switcher.test.tsx` "AnswerView attribution").

## Deliverables

- ai/models OpenAI-compatible and Gemini adapters (built)
- Chat model switcher (built)
- Settings → AI providers (`AiProviders.tsx`): per-provider key, custom endpoints, routing per category, user prices (built, `ai-providers.test.tsx`)

## Exit criteria

- [ ] Each provider answers a real request (keys permitting); missing keys fail clearly. Not met. A missing key failing clearly is tested for OpenAI and Gemini against fake networks ("No API key is set for …", nothing sent). A real answer was obtained from **local Ollama through the OpenAI-compatible adapter** only (opt-in `PHOENIX_REAL_OLLAMA=1`, `ai/models/test/real-ollama.test.ts`, 8 tests with `llama3.2` and `nomic-embed-text`). OpenAI, Gemini, DeepSeek, Qwen, Moonshot, Anthropic and LM Studio were never contacted: no key was used.

## Implementation notes

- **Trusted local.** Only the built-in Ollama adapter is treated as trusted-local: it alone may receive sensitive data or embed. LM Studio and every user-added loopback endpoint are refused for sensitive purposes and for embeddings even with every opt-in, because a loopback server may forward text elsewhere (`routing.test.ts` "a loopback server is not vetted…"). They do run public and internal purposes with no grant and no key.
- **Model forwarding.** Ollama models that forward to a remote host are refused for the adapters that can tell (`openai-compatible.test.ts` "refuses a model a local server forwards to a remote host").
- **Keys.** The key is sent only to its own provider, in a header (Gemini: `x-goog-api-key`, never in the URL); error messages never contain the key or the server's text (`openai-compatible.test.ts`, `gemini.test.ts`, `ai-providers.test.ts` "the key is sent to its provider only").
- **Review findings fixed with tests.** A key reaching a new endpoint during an edit, the loopback-forwarding bypass of the cloud gate, and an `Infinity` cost display. These came from a static review, not a human audit.

### Open and HIGH: the external-AI grant is not bound to a person

`POST /api/ai/external-processing` and `POST /api/ai/settings` are protected by the session token alone. Core has no credential that distinguishes a person from an agent, and the token is also injected into HTML served from `webRoot`. Any process of the same OS user that can read the token can therefore grant the external-AI permission and set the opt-ins, which is what every routed cloud provider relies on. It is a known limit shared with other token-only routes (see the Phase 56 rows) and is not fixed; the route carries a comment saying so. See the [gap register](../gaps.md).

What was not done or not run: any cloud provider, any key, LM Studio; vendor prices; token counting or context-window checks; a look at the switcher in a browser. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory. The presets cite vendor documentation for URLs only; no vendor code or assets were copied.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
