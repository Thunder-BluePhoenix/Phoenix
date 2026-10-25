# Phase 65 — Botless Notetaker

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Built and tested with an injected fake consent dialog, but **cannot be used end to end**: Core refuses every token-only recording start and nothing in `apps/desktop` provides the trusted consent dialog yet, so in the shipped app "Record a call" is disabled and no call can be recorded; system-audio adapter written but unreachable and never run; no real call, microphone or speech was ever run |
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

- Local capture in apps/desktop: the **system-audio adapter is written but unreachable and never run** (see "System-audio adapter" below); the microphone is still captured in the web page, and the desktop shell has no consent dialog.
- Meeting pipeline adapter: built (`core/runtime/src/notetaker.ts`, capability id `notetaker`).

## Exit criteria

- [ ] A real call is recorded, transcribed and summarised; the audio file is gone afterwards. Not met and not possible today: no real call, microphone or speech was ever recorded, and the shipped app cannot start a recording.

## Implementation notes

### Consent channel: why nothing can be recorded yet

After a security review, Core refuses **every** recording start that is authorised only by the session token (`403 CONSENT_CHANNEL_UNAVAILABLE`). The request flags `consent` and `notice_acknowledged` are client claims, and the session token cannot tell a person from an agent or any other process of the same OS user, so they prove nothing. Recording starts only when the embedder passes a trusted `RuntimeOptions.notetakerConsent` dialog in code that asks a person for each recording and whose "no" is final.

Nothing in `apps/desktop` provides that dialog. In the shipped app `GET /api/notetaker/status` therefore reports the consent channel unavailable and "Record a call" is disabled with an explanation. Phase 65 is built and tested with an injected fake dialog (`core/runtime/test/notetaker.test.ts`, `ai/multimodal/test/notetaker-sessions.test.ts`), and `notetaker.test.ts` "a session-token holder alone cannot start a recording" shows the refusal with every flag set. Stop, cancel and the audio stream still use only the token.

### Why the desktop shell cannot supply the consent dialog today (decision, nothing built)

The question was whether the shell can show a native dialog that Core trusts without letting a process that only holds the session token forge "consent granted". Checked against the code, it cannot:

- **The shell does not own Core.** `apps/desktop/src-tauri` has no code that starts Core: no `Command::new` for it, no sidecar or `externalBin` in `tauri.conf.json`, no `tauri-plugin-shell` in `Cargo.toml` (the only process spawn in `src` is a `mkfifo` call in a `file_drop.rs` test). The desktop README says the shell needs "a running core (`pnpm dev:core` in another terminal)". Core is an independent Node process.
- **The shell and an agent hold the same credential.** The shell finds Core on `127.0.0.1` and reads `<dataDir>/session.token` (`connection.rs`), exactly as any same-user process can. Core also injects that token into every HTML file it serves (`core/api/src/static.ts`). Any "consent granted" message from the shell would be authenticated with a value an agent already has.
- **No second secret can be handed over.** A per-launch secret needs an inherited pipe, an inherited environment or a file only the shell can read. Core is not the shell's child, so there is no inherited channel; a secret in a file is readable by the same OS user; and the environment of an unrelated process is not a channel at all. The peer-credential route (`LOCAL_PEERPID` on macOS, `SO_PEERCRED` on Linux) is not available either: Core listens on TCP loopback only (`core/api/src/server.ts`), the shell has no unix-socket code, and a peer PID alone would still need a code-signature check before Core could call a PID "the shell".

A token-authenticated consent-answer route would let any token holder grant its own recording consent, which is the person-versus-agent confusion this refusal exists to prevent. So **no behaviour was changed**: Core still answers 403 `CONSENT_CHANNEL_UNAVAILABLE`, the injected `notetakerConsent` path and its tests are unchanged. This was a code and configuration reading; no real desktop, Core pairing or process-environment probe was run.

What would make it possible (an owner decision, the same one the Phase 63 and Phase 67 rows need):

1. The shell starts Core as its own child and passes a per-launch random secret over an inherited pipe or stdin. That secret authenticates only a dedicated consent-answer route, with single-use nonces bound to the pending request id, the hash of the fixed dialog text and a short expiry.
2. Core listens on a unix socket (or Windows named pipe) and identifies the shell by an OS peer credential plus a code-signature check of the peer executable.
3. A keychain item whose access control list names the shell binary only.

Whichever is chosen, the dialog text stays fixed (never Core-supplied apart from a cleaned participant count or meeting label), defaults to Cancel, collapses duplicate dialogs, fails closed on any error and is audited on every grant and denial.

### System-audio adapter (shell side): written, unreachable, never run

`apps/desktop/src-tauri/src/system_audio.rs` (platform-neutral core and tests in `system_audio_tests.rs`) and `system_audio_macos.rs` (ScreenCaptureKit backend, `cfg(target_os = "macos")`). **No audio was ever captured with this code.**

**Why it cannot be reached.** `CaptureSession::start` takes a `ConsentGrant`, and nothing outside the unit tests can construct one. The consent channel that would mint it is the open decision above (Core refuses every token-only start). There is no Tauri command, menu item, capability permission or `build.rs` command entry for it, so no web page, agent or token holder can start capture. When the owner resolves the consent decision, only the code implementing the chosen mechanism may create a `ConsentGrant`, one per recording (consumed by `start`). This work does not fix or bypass that decision.

**What it does once started.** macOS 13+ ScreenCaptureKit, audio only: a display filter (all applications except Phoenix), `capturesAudio`, `excludesCurrentProcessAudio`, 16 kHz, 1 channel, a 2x2 pixel 1 fps video side that is never read, microphone off, and an `SCStreamOutput` of type Audio only. Each sample buffer is read using its own `AudioStreamBasicDescription` (float32 or int16, interleaved or planar, any rate 8 to 384 kHz, up to 8 channels), downmixed by averaging, resampled by a streaming area-average resampler (a plain low-pass-by-averaging, adequate for speech recognition, not a studio filter) to 16 kHz mono 16-bit little-endian PCM, and handed in 100 ms chunks (3 200 bytes, notetaker channel byte 2 = "Others", `CHANNEL_ID`) to an injected `PcmSink`. The intended sink is Core's single-use WebSocket; none is written.

**Guarantees, mirroring the page's microphone path, and the test that holds each.**

| Guarantee | Test (`system_audio_tests.rs`) |
|---|---|
| Bounded buffers: frames per OS buffer, channels, rate range, chunk size fixed, 4 h cap; over a bound ends the session | `malformed_buffers_end_the_session_and_deliver_nothing`, `an_oversized_buffer_ends_the_session`, `chunks_never_exceed_the_bound_whatever_the_input_size`, `the_session_time_limit_ends_the_session` |
| Zeroing: chunk, byte scratch (including spare capacity) and resampler state wiped after every chunk and on every end path | `buffers_are_zeroed_after_every_chunk_and_every_end_path`, `spare_capacity_of_the_sample_buffer_is_wiped_too` |
| No disk: the module has no file or path code; only the sink decides where PCM goes | by construction (read the file); no test |
| Visible indicator: an injected `Indicator` is shown before the OS is asked (failure means nothing starts) and hidden only after the OS confirmed the stop; an unconfirmed stop keeps it shown and the slot taken | `the_indicator_is_shown_before_the_os_is_asked_and_hidden_after_it_stopped`, `without_an_indicator_nothing_starts`, `an_unconfirmed_stop_keeps_the_indicator_and_the_slot` |
| Stop on drop, on a refusing sink, on a bad buffer and when the OS ends the stream; one capture at a time | `dropping_the_session_stops_capture_and_hides_the_indicator`, `a_sink_that_refuses_ends_the_session_and_gets_nothing_more`, `a_bad_buffer_from_the_os_ends_the_capture_through_the_session`, `the_os_ending_the_stream_stops_everything`, `only_one_capture_at_a_time` |
| Conversion: pass-through, 48 kHz and 44.1 kHz down, 8 kHz up, stereo and planar downmix, int16, NaN becomes silence | `sixteen_khz_mono_passes_through_unchanged`, `downsampling_*`, `upsampling_8k_*`, `output_length_tracks_the_ratio_*`, `stereo_*`, `non_interleaved_*`, `sixteen_bit_*`, `non_finite_*` |
| Clean "unsupported" off macOS: `start` returns `Unsupported` and touches no indicator | `elsewhere_than_macos_start_says_unsupported_and_touches_nothing` (runs on Linux and Windows CI only; the Windows and Linux builds were not run locally, the cfg gates were reasoned) |

Mutations that make tests fail (run on macOS): removing the post-delivery wipe, removing the frame cap, removing the stop in `Drop`, removing the single-slot check, hiding the indicator before the OS confirms, and dropping the downmix division each fail named tests.

**What is only reasoned, not verified.** All of `system_audio_macos.rs` runs against ScreenCaptureKit, which needs a display session, the Screen Recording permission for the host binary and a signed app, none available here: that the display filter delivers system audio with the current-process exclusion, that macOS honours 16 kHz mono (the conversion does not depend on it), the permission prompt and relaunch flow (`CGPreflightScreenCaptureAccess` / `CGRequestScreenCaptureAccess` are called before any stream is built), the mapped error codes, the callback queue behaviour, and the OS's own copy of each sample buffer, which this module cannot zero. macOS 15 shows its own recurring screen-recording prompt and menu-bar indicator; Phoenix's `Indicator` is separate and the real one is not written (Core's `notetaker.recording` event remains what Fawkes shows). `Info.plist` has no new key: ScreenCaptureKit has no usage-description key, the permission is the Screen Recording privacy switch and no entitlement is added (the app is unsandboxed). No notarised build was tried.

**Dependency decision (justified).** The only alternative to `objc2-screen-capture-kit` is hand-written `objc2` `msg_send!` bindings for roughly twenty ScreenCaptureKit and CoreMedia methods, which is more unsafe code than the generated, typed bindings. The crate (0.3.2, `Zlib OR Apache-2.0 OR MIT`, same author and 0.3 generation as the `objc2-app-kit`, `objc2-foundation` and `objc2-web-kit` crates already locked) is a macOS-only dependency. It adds five lockfile entries, all macOS-gated and of that family: `objc2-screen-capture-kit`, `objc2-core-media`, `objc2-core-audio-types`, and (pulled in by `objc2-core-media`'s own default features, which cannot be switched off for those two) `objc2-core-audio` and `objc2-core-video`. `dispatch2`, `block2`, `objc2-foundation` and `objc2-core-foundation` were already locked and are now also direct dependencies. `THIRD_PARTY_NOTICES.md` was regenerated and `--check` passes.

### Per-person transcript (decision, nothing built)

Diarisation needs a speaker-embedding or segmentation model (for example pyannote or a sherpa-onnx speaker model) plus a runtime to run it. None is in the repository, the lockfiles or the on-device model set, and a model download is an owner decision (size, licence, a new on-device model class). Even with system audio, the "Others" channel mixes every remote participant into one stream, so labels beyond "You" and "Others" need that model. Decision recommended: keep the two labels, which the protocol, the UI and the meeting records already carry honestly, until a diarisation model is chosen. No code changed.

### Hand-off to Kage (decision, nothing built)

Not small. The Kage contract (ADR-0017, `capabilities/kage`) has no audio-ingest route for Phoenix to call: meetings reach Kage when its extension or bot uploads audio after a call, auth is a per-user `X-API-Key` held in the keychain, and the adapter offers `meeting.start`, `list`, `get_status`, `get_transcript` and `get_summary` only. A hand-off would also change the notetaker's central guarantee: audio today exists only in memory and is zeroed, while a hand-off has to deliver a recording to another process (a temp file or a long-lived buffer plus a network call), needs an explicit consent to leave Phoenix, and needs Kage to publish an upload endpoint and say what it retains. Decision recommended: drop "hand off to Kage" from Phase 65 and treat it as a Kage contract ask (an ingest endpoint with a retention statement). No code changed.

### Other decisions

- Local-only summary: the summary purpose is outside the sensitive-cloud allow-list, so even with a routed cloud provider, the grant and every opt-in no cloud request is made and no summary is stored (`notetaker-summary.test.ts`, `notetaker.test.ts` "the summary is local only and never faked"). A failed or unreadable model reply stores no summary; the transcript stays.
- `notetaker` and `dictation` are reserved capability ids and event namespaces: an external capability cannot declare them, and `POST /api/events` refuses `dictation.listening`, `dictation.idle`, `notetaker.recording` and `notetaker.idle`.
- Limits: 4 h maximum, 1 MiB frames, no faster than twice real time per channel, one session at a time, off by default.

What was not done or not run: any real system-audio capture (the adapter exists but is unreachable and was never run), per-person diarisation, hand-off to Kage, the desktop consent dialog, any real call, microphone or Whisper run on speech, any real model summary. Open items are in the [gap register](../gaps.md).

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
