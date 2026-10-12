# Phase 54 — Multimodal Interaction (Speech & Vision)

| Field | Value |
|---|---|
| Stage | Stage 11 — AI Evolution (v1.1 → v2.0) |
| Release target | v2.0 |
| Priority | Medium |
| Status | 🟨 Local whisper.cpp and Ollama vision adapters, scoped capture and screen permission built; no Core-authorized device flow or installed models verified; v2.0 not released |
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
- [ ] Fawkes voice interaction/LISTENING with a real capture device (no authorized Core/UI capture flow).
- [ ] `screen_capture` and microphone are per-use confirmation permissions; Core does not yet issue a capture grant to a browser session.
- [x] ScopedCaptureSession binds one capture to one agent and zeroes returned bytes on stop; no global agent context injection.

## Deliverables

- v2.0 release

## Exit criteria

- [ ] Fawkes interacts through text and selected multimodal interfaces

## Implementation notes

`@phoenix/ai-multimodal` exports a scoped browser-capture session factory, local whisper.cpp WAV transcription and local Ollama vision description; `@phoenix/ai-models` rejects cloud routing for sensitive multimodal input. Screen capture was added to the manifest/permission enums and always-confirm set. A direct browser capture driver is not part of the public package entry. Core reports configured adapter availability but has no browser↔Core authorization handshake or input endpoint: no model output is presented as an actual mic/screen result. Vision requests reject redirects so a loopback redirect cannot forward a captured frame. No Whisper model, local vision-capable Ollama model, device use or Fawkes voice flow was verified.

## Source documents

- AI Evolution v1.0→v2.0 §15, §16

---
Back to [TRACKER](TRACKER.md)
