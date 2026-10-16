# Phase 65 — Botless Notetaker

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Built and tested with an injected fake consent dialog, but **cannot be used end to end**: Core refuses every token-only recording start and nothing in `apps/desktop` provides the trusted consent dialog yet, so in the shipped app "Record a call" is disabled and no call can be recorded; no system-audio capture; no real call, microphone or speech was ever run |
| Depends on | [Phase 15 — Kage Adapter & Meeting Lifecycle](phase-15-kage-adapter-meeting-lifecycle.md), [Phase 35 — Kage Decisions & Action-Item Extraction](phase-35-kage-decisions-and-action-items.md), [Phase 64 — Dictation Anywhere](phase-64-dictation-anywhere.md) |
| Unblocks | [Phase 83 — Calendar Awareness & Meeting Prep](phase-83-calendar-and-meeting-prep.md) |

## Goal

Record a call from this computer, without a bot joining, and get transcript, summary and to-dos in Phoenix's meeting pipeline.

## Tasks — parity with Coucou

- [ ] Record microphone + system audio. The microphone path is built (`Notetaker.tsx` captures PCM in the page and streams it to Core over a single-use WebSocket, `core/api/src/notetaker-socket.ts`; two channels, microphone = "You" and system audio = "Others", are accepted by the protocol). System-audio capture is **not built**: nothing captures it, and Core's status reports `system_audio: false` (macOS ScreenCaptureKit is the intended route). More importantly, no recording can start at all in the shipped app (see "Consent channel" below).
- [ ] Transcript per person, summary, key points, to-dos. Transcript is written per 30-second window with a speaker label, a summary with topics, decisions and action items is generated, and the existing pipeline proposes items (`ai/multimodal/src/notetaker/sessions.ts`, `summary.ts`, `core/runtime/src/notetaker.ts`; tests `notetaker-sessions.test.ts` "windows", `notetaker-summary.test.ts`, `core/runtime/test/notetaker.test.ts` "a recording from start to meeting"). Per-person diarisation is **not** built: only the two labels "You" and "Others" exist, and with no system audio only "You" is ever produced. Exercised with a fake recogniser and a fake model only.
- [x] Audio deleted once the transcript is written. Audio is never on disk: it is held in memory, transcribed in fixed windows, and each buffer is zeroed right after its text is produced and on every abort path (cancel, kill switch, switching off, shutdown, closed socket, size/rate limit, recogniser failure). Tests: `notetaker-sessions.test.ts` ("windows: PCM is transcribed in fixed windows and zeroed", "PCM is zeroed on EVERY abort path…"), `core/runtime/test/notetaker.test.ts` ("a recording from start to meeting" checks that neither the data dir nor the temp dir gained a file and that no text is in events, audit or logs; "every abort path zeroes the PCM…"). Run only with a fake recogniser; zeroing is a best effort in a garbage-collected runtime and copies made by the real whisper process or the OS were not examined.
- [ ] Reminder to tell people the call is recorded. A notice and a required acknowledgement checkbox are built into the page's dialog (`apps/web/test/notetaker.test.tsx` "Record a call: the consent dialog"), but that dialog is no longer the proof of consent (see below), and no trusted dialog exists in the desktop shell, so the reminder is not shown to anyone in the shipped app.

## Tasks — Phoenix improvements

- [x] Feeds the existing meeting records (Phase 15/16) and decisions/action items (Phase 35), so to-dos can become tasks (Phase 36): a recorded call becomes a meeting from the reserved capability `notetaker`, labelled "Recorded on this computer", listed beside Kage's; the Phase 35 extraction creates only **proposed** items; the summary does not enter memory until the user accepts items in review, and an accepted fact is labelled reviewed, never Kage. Tests: `notetaker.test.ts` ("a recording from start to meeting", "a recorded call reaches memory only through the item review", "a recorded call is NOT searchable until an item is accepted…"), `apps/web/test/notetaker.test.tsx` ("meetings recorded on this computer"). Turning a to-do into a task (Phase 36) uses the existing flow and was not re-exercised here.
- [ ] Transcribe locally or hand off to Kage. Local transcription through the same on-device recogniser as dictation is built (fake in tests). Hand-off to Kage is not built.
- [x] RECORDING shown in every Fawkes view for the whole capture (no silent recording): Core publishes `notetaker.recording` / `notetaker.idle` (Core-only events) mapped to RECORDING with no timeout; the banner in the page shows elapsed time and a Stop button for as long as Core says recording. Tests: `notetaker-sessions.test.ts` ("RECORDING brackets the whole capture"), `notetaker.test.ts` ("RECORDING for the whole capture…", "the microphone indicators cannot be forged or cleared over the API", "an external capability cannot impersonate a local recording"), `notetaker.test.tsx` ("the recording banner"). Not looked at in each view on a real display.

## Deliverables

- Local capture in apps/desktop: **not built**. Capture is in the web page; the desktop shell has no recording code and no consent dialog.
- Meeting pipeline adapter: built (`core/runtime/src/notetaker.ts`, capability id `notetaker`).

## Exit criteria

- [ ] A real call is recorded, transcribed and summarised; the audio file is gone afterwards. Not met and not possible today: no real call, microphone or speech was ever recorded, and the shipped app cannot start a recording.

## Implementation notes

### Consent channel: why nothing can be recorded yet

After a security review, Core refuses **every** recording start that is authorised only by the session token (`403 CONSENT_CHANNEL_UNAVAILABLE`). The request flags `consent` and `notice_acknowledged` are client claims, and the session token cannot tell a person from an agent or any other process of the same OS user, so they prove nothing. Recording starts only when the embedder passes a trusted `RuntimeOptions.notetakerConsent` dialog in code that asks a person for each recording and whose "no" is final.

Nothing in `apps/desktop` provides that dialog. In the shipped app `GET /api/notetaker/status` therefore reports the consent channel unavailable and "Record a call" is disabled with an explanation. Phase 65 is built and tested with an injected fake dialog (`core/runtime/test/notetaker.test.ts`, `ai/multimodal/test/notetaker-sessions.test.ts`), and `notetaker.test.ts` "a session-token holder alone cannot start a recording" shows the refusal with every flag set. Stop, cancel and the audio stream still use only the token.

### Other decisions

- Local-only summary: the summary purpose is outside the sensitive-cloud allow-list, so even with a routed cloud provider, the grant and every opt-in no cloud request is made and no summary is stored (`notetaker-summary.test.ts`, `notetaker.test.ts` "the summary is local only and never faked"). A failed or unreadable model reply stores no summary; the transcript stays.
- `notetaker` and `dictation` are reserved capability ids and event namespaces: an external capability cannot declare them, and `POST /api/events` refuses `dictation.listening`, `dictation.idle`, `notetaker.recording` and `notetaker.idle`.
- Limits: 4 h maximum, 1 MiB frames, no faster than twice real time per channel, one session at a time, off by default.

What was not done or not run: system-audio capture, per-person diarisation, hand-off to Kage, the desktop consent dialog, any real call, microphone or Whisper run on speech, any real model summary. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Off by default.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
