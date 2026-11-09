# Phase 65 — Botless Notetaker

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Built and tested with an injected fake consent dialog and, new, a secret-authenticated consent channel for an opt-in **managed Core** (the shell starts Core and shows the native dialog); never run on a real display, and in the default `pnpm dev:core` workflow Core still refuses every token-only recording start, so "Record a call" stays disabled there; system-audio adapter written but unreachable and never run; no real call, microphone or speech was ever run |
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

- Local capture in apps/desktop: the **system-audio adapter is written but unreachable and never run** (see "System-audio adapter" below); the microphone is still captured in the web page, and the desktop shell's consent dialog exists only in the opt-in managed-Core mode.
- Meeting pipeline adapter: built (`core/runtime/src/notetaker.ts`, capability id `notetaker`).

## Exit criteria

- [ ] A real call is recorded, transcribed and summarised; the audio file is gone afterwards. Not met and not possible today: no real call, microphone or speech was ever recorded, and the shipped app cannot start a recording.

## Implementation notes

### Consent channel: why nothing can be recorded yet

After a security review, Core refuses **every** recording start that is authorised only by the session token (`403 CONSENT_CHANNEL_UNAVAILABLE`). The request flags `consent` and `notice_acknowledged` are client claims, and the session token cannot tell a person from an agent or any other process of the same OS user, so they prove nothing. Recording starts only when the embedder passes a trusted `RuntimeOptions.notetakerConsent` dialog in code that asks a person for each recording and whose "no" is final.

Nothing in the default setup provides that dialog: with `pnpm dev:core`, `GET /api/notetaker/status` reports the consent channel unavailable and "Record a call" is disabled with an explanation. The opt-in managed Core mode below provides it. Phase 65 is built and tested with an injected fake dialog (`core/runtime/test/notetaker.test.ts`, `ai/multimodal/test/notetaker-sessions.test.ts`), and `notetaker.test.ts` "a session-token holder alone cannot start a recording" shows the refusal with every flag set. Stop, cancel and the audio stream still use only the token.

### Consent channel, managed mode (owner decision (1); built, never run on a real display)

The owner chose mechanism (1). It is **opt-in**: nothing changes for the separate `pnpm dev:core` workflow, which never reads stdin, never exposes the consent routes' success path, reports `consent_channel: available: false` and keeps answering 403 `CONSENT_CHANNEL_UNAVAILABLE` (test: `notetaker-consent.test.ts` "unmanaged mode (pnpm dev:core) still refuses").

**Shell (`apps/desktop/src-tauri/src/managed_core.rs`).** With `PHOENIX_MANAGED_CORE=1` and `PHOENIX_MANAGED_CORE_ARGV` (a JSON array, e.g. `["node","--import","tsx","/path/core/runtime/src/main.ts"]`; optional `PHOENIX_MANAGED_CORE_CWD`) the shell starts Core as its child: argv only (no shell, no string splitting), `env_clear()` plus a short allow-list (`PASS_ENV`; `NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_*`, cloud credentials, `PHOENIX_HOST` and `PHOENIX_ALLOW_REMOTE` are not passed) plus `PHOENIX_MANAGED_CORE=stdin` (announces the pipe, carries no secret). stdout and stderr are captured into 8 KiB tails (a console message on exit; never sent to a page). The child is killed on shell exit (`RunEvent::Exit`, `Drop`). It refuses to adopt a Core: if anything already accepts connections on Core's port it does not start. The mode is not started under the mock runtime.

**Secret.** 32 bytes from the OS CSPRNG (`getrandom` 0.3, already in `Cargo.lock` as a transitive dependency of tauri; now a direct dependency, MIT OR Apache-2.0, no new lockfile package), hex encoded (64 characters), written once to the child's **stdin pipe** as `PHOENIX-CONSENT-V1 <hex>\n`, never argv, environment, a file or a log. The shell keeps the pipe open. `ConsentSecret` has no `Clone`, a redacted `Debug`, and is volatile-zeroed on drop (as are the bytes of the line sent). Core reads the line (`readConsentSecret`, 256 bytes, 5 s, refuses a TTY), keeps only a SHA-256 digest (the string is dropped by the caller), and compares in constant time (`timingSafeEqual` over digests).

**Liveness and restart.** When the pipe closes (the shell exited or died) Core ends any waiting consent as "no", marks the link dead and shuts down (verified with a real Core process over a real pipe: `consent_channel` available while the pipe is open, process stops when it closes). Restart policy: if the child exits while the shell runs it is restarted after 2 s, at most 3 times in 10 minutes, each time with a **new** secret; after that the mode stays off until the shell restarts and recording stays refused (the reason is printed to the console).

**Core (`core/runtime/src/consent-channel.ts`, `core/api/src/notetaker-routes.ts`).** A recording start (`POST /api/notetaker/sessions`) in managed mode creates one **pending consent**: `what: "notetaker.record"`, `requested_by: "session-api"`, a cleaned title (printable, one line, 80 characters), an expiry (60 s) and a single-use nonce (24 random bytes). Two routes, authenticated **only** by the secret in the header `x-phoenix-consent-secret`:

- `GET /api/notetaker/consent/pending` returns the pending consent (this is also the shell's heartbeat).
- `POST /api/notetaker/consent/answer {nonce, decision: "granted" | "denied"}`.

They are marked `public` in the router so the session-token check does not run: **the session token is not accepted and not looked at**, and sending it in `Authorization` or in the secret header is just another wrong secret (401). A request carrying `Origin` or `Cookie` (a web page) is refused 403 before the secret is read. A nonce works once (a replay is 404), expires after 60 s (expiry answers "no"), and an answer for any other nonce is the same 404. Rate limit: 5 failed authentications per minute lock both routes (even for the right secret), and 120 calls per minute in total (the shell polls every 2 s). No HTTP request, setting or event can supply a consent answer; the web UI has no route to call and the routes do not appear in the web client. Audit rows (`notetaker.consent.requested|granted|denied|expired|rejected`, actor `desktop-shell`) carry the kind, a 12-character digest prefix of the nonce and the title length; never the secret, the nonce or the title.

`GET /api/notetaker/status` reports `consent_channel.available: true` **only** in managed mode **and** while the shell has called Core in the last 10 s over the open pipe; otherwise it is the old unavailable answer with the same code, and a start is refused before any recogniser, buffer, meeting record or RECORDING event exists. Because the dialog waits for a person, the HTTP call of a start can wait up to 60 s for the answer.

**Dialog (`consent_dialog.rs`, `native_dialog.rs`).** The managed-Core supervisor thread (never a Tauri command; no capability or `build.rs` entry; nothing in a web page can trigger it) fetches the pending consent over the loopback client (no `Origin`, no cookie, no `Authorization`, only the secret header) and shows a native dialog through the existing `native_dialog` code (AppKit, Win32, GTK) with fixed text, **Cancel** as the default and **Record** as the only yes. From Core it takes only the nonce and a title that is cleaned again and shown as quoted data. An unknown `what`, a nonce that is not plain, a nonce already asked, a dialog that cannot be shown, closing the dialog, any error: nothing is granted. A `Granted` value exists only if the person chose Record **and** Core confirmed `{"decision":"granted"}`.

**Grant minting.** `system_audio::ConsentGrant::from_granted(Granted)` is the only production constructor. The supervisor mints one per granted consent, and **drops it**: no code turns it into a running `CaptureSession` yet, so system-audio capture start is **still not reachable** (and still has no Tauri command). Microphone capture stays in the web page and uses the normal session path, which now proceeds once the person has answered Record in the shell dialog.

**Dictation.** Dictation does not use this channel; it never recorded a call and still does not.

**Tests.** `core/runtime/test/notetaker-consent.test.ts` (22 tests, via `startCore` with an injected secret and clock and an injected stdin stream for the reader): unmanaged mode refuses; link liveness; granted/denied; the token cannot read or answer; wrong or missing secret; web-page `Origin` or cookie; replayed nonce; expired nonce; bad decision and extra fields; both rate limits; the audit has no secret, nonce or title; the secret is in no status, audit or event body; reader parsing; the shell going away. Mutations that make named tests fail: replacing the secret comparison with `true` (3 tests), not clearing the pending consent after an answer (2), disabling expiry (1), disabling the rate limits (2), dropping the `Origin`/cookie refusal (1). Rust: `managed_core.rs` and `consent_dialog.rs` unit tests (spawn spec and cleaned environment, secret generation, redaction and zeroing, restart policy, adoption refusal, a fake spawner that sees the secret only on the pipe, one real `/bin/sh` child on unix that proves the secret arrives on stdin, the environment is cleaned and the parent's variables do not cross, request bytes, the loopback client against a real socket, dialog decision table). Not covered: the native dialogs (real display), a real Core spawned by the shell, the Windows and Linux builds (cfg gates reasoned; macOS clippy, `cargo test` and the lifecycle test ran).

**Residual risks (documented, not removed).** The mechanism takes the *session-token holder* (a web page, a script, an agent that only read `session.token`) out of the consent path. It does not defend against a same-user process that can read the shell's or Core's memory or the child's pipe: on Linux `/proc/<pid>/fd/0` of the child is readable by the same user (the kernel permits it for same-uid processes unless `ptrace_scope`/YAMA says otherwise), a debugger or `ptrace` can read both processes, and a same-user process could replace the Core binary the shell is configured to run. macOS and Windows have comparable same-user debug rights (`task_for_pid` is restricted for hardened apps; a user-level `OpenProcess` is not). A same-user process that already controls the user's session can also click the dialog. The secret is held in process memory of two processes (Core's Node string for the pipe line is garbage collected, not wiped; only the digest is kept). The window between a nonce being shown and answered is 60 s at most. An agent that can also automate the UI (accessibility API) could press **Record**: the dialog says who asked, not who is clicking. None of this was exercised on a real system.

### System-audio adapter (shell side): written, unreachable, never run

`apps/desktop/src-tauri/src/system_audio.rs` (platform-neutral core and tests in `system_audio_tests.rs`) and `system_audio_macos.rs` (ScreenCaptureKit backend, `cfg(target_os = "macos")`). **No audio was ever captured with this code.**

**Why it is still not reachable.** `CaptureSession::start` takes a `ConsentGrant`. The only production constructor, `ConsentGrant::from_granted`, needs the `Granted` proof of a Record answer that Core confirmed in managed mode (see above); the supervisor mints it and drops it. Nothing connects a grant to `CaptureSession::start`, a sink (Core's notetaker stream needs a session id the page owns) or an indicator, so capture does not start. There is no Tauri command, menu item, capability permission or `build.rs` command entry for it, so no web page, agent or token holder can start capture. Wiring it end to end needs a decision on who owns the notetaker session (page or shell) and a session-id handoff; not done.

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

What was not done or not run: any real system-audio capture (the adapter exists but is unreachable and was never run), per-person diarisation, hand-off to Kage, the native consent dialog on a real display, a shell-spawned real Core, any real call, microphone or Whisper run on speech, any real model summary. Open items are in the [gap register](../gaps.md).

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
