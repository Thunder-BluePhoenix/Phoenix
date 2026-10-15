# Phase 63 — More AI Providers & Model Switcher

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 27 — Model Adapter & Router](phase-27-model-adapter-and-router.md) |
| Unblocks | [Phase 62 — Drop Files & Attach Windows as Context](phase-62-file-drop-and-window-context.md) |

## Goal

Chat with any common provider or a local model, switchable from the chat box.

## Tasks — parity with Coucou

- [ ] Claude, Gemini, OpenAI, DeepSeek, Qwen, Moonshot, Ollama, LM Studio
- [ ] Model name above the chat box opens a provider/model switcher
- [ ] User's own keys in the OS keychain

## Tasks — Phoenix improvements

- [ ] One OpenAI-compatible adapter covers OpenAI, DeepSeek, Qwen, Moonshot, LM Studio and any compatible server
- [ ] Per-purpose routing (chat, summaries, clean-up) with local-first defaults
- [ ] Shows which model processed each answer and its cost when known

## Deliverables

- ai/models OpenAI-compatible and Gemini adapters
- Chat model switcher

## Exit criteria

- [ ] Each provider answers a real request (keys permitting); missing keys fail clearly

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
