# Phase 54 — Multimodal Interaction (Speech & Vision)

| Field | Value |
|---|---|
| Stage | Stage 11 — AI Evolution (v1.1 → v2.0) |
| Release target | v2.0 |
| Priority | Medium |
| Status | 🟨 Same-origin Core-authorized, per-use approved microphone/screen capture and local adapters built; no installed models, real device result or Fawkes voice verified; v2.0 not released |
| Depends on | [Phase 53 — Self-Improving Workflows & Evaluation Loop](phase-53-evaluation-feedback-loop.md) |
| Unblocks | [Phase 55 — v2.0 — Ambient AI Operating Layer](phase-55-v2-0-ambient-ai-layer.md) |

## Goal

Add voice and vision through explicit capability boundaries.

## Scope

**In scope**

- Speech (Fawkes voice, via Kage/speech capability)
- Vision (screen/context understanding)
- Model router roles for speech/vision

## Tasks

- [x] Local-only Whisper WAV and Ollama vision model adapters; require actual installed model and browser/native driver.
- [ ] Fawkes voice interaction/LISTENING with an installed Whisper model and real microphone remains unverified; a user-owned one-shot capture UI is built.
- [x] `screen_capture` and microphone are separately enabled first-party capabilities, each requiring a persisted grant and per-use Core confirmation before browser OS permission.
- [x] ScopedCaptureSession binds one capture to one agent and zeroes returned bytes on stop; no global agent context injection.

## Deliverables

- v2.0 release

## Exit criteria

- [ ] Fawkes interacts through text and selected multimodal interfaces

## Implementation notes

`@phoenix/ai-multimodal` exports a scoped browser-capture session factory, local whisper.cpp WAV transcription and local Ollama vision description; `@phoenix/ai-models` rejects cloud routing for sensitive multimodal input. A direct browser capture driver is not part of the public package entry. Core now owns a dedicated same-origin, session-authenticated, single-use capture WebSocket (no transferable capture token): separate `capture-microphone` and `capture-screen` built-ins must be enabled by the user, the PermissionGateway approves every capture, and the browser asks for OS access only after Core's ready message. One bounded WAV/frame goes to the selected local adapter; close, revoke, kill switch and stop abort the session and clear media buffers. Real-Core tests cover approval, denial, origin/token checks, size limits, revoke/kill and socket close against a fake local vision service. The real Core/browser smoke showed both captures disabled because no Whisper model or local vision model was configured. No actual device capture, real-model result, Fawkes LISTENING/voice interaction or v2.0 release was verified.

## Source documents

- AI Evolution v1.0→v2.0 §15, §16

---
Back to [TRACKER](TRACKER.md)
