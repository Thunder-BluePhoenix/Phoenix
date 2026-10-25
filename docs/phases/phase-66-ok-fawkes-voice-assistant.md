# Phase 66 — « OK Fawkes » Voice Assistant

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Built and tested with a fake recogniser through the real tool gateway; no real microphone, whisper pass, wake recognition or speech synthesis was ever run; only the voice-activity gate's CPU was measured (per component, not whole-app); hosted by a desktop shell window (`apps/desktop`) that was only exercised with Tauri's mock runtime and unit tests, never on a real microphone, permission prompt or packaged app; web search is built behind a confirmation but only tested against a local mock (no real search service or key); exit criteria not met |
| Depends on | [Phase 54 — Multimodal Interaction (Speech & Vision)](phase-54-multimodal-interaction.md), [Phase 64 — Dictation Anywhere](phase-64-dictation-anywhere.md) |
| Unblocks | — |

## Goal

Talk to Fawkes hands-free and have it answer and act through Phoenix's capabilities.

## Tasks — parity with Coucou

- [ ] Wake phrase, local recognition, spoken answers. Built: a fuzzy matcher for "ok fawkes" over the text of a VAD-gated utterance (`ai/multimodal/src/voice/wake.ts`, tests `ai/multimodal/test/voice/wake-intent.test.ts`), recognition through the existing on-device `SpeechRecognizer` seam, and replies spoken by the browser's `speechSynthesis` in `Voice.tsx` (`apps/web/test/voice.test.tsx`). Not done: the matcher ran on text strings only, never on a real voice; no real microphone, whisper pass or speech synthesis was exercised. Wake detection is a VAD-gated recogniser pass per utterance, not a keyword spotter.
- [ ] Questions about services, switching pills, music, web search, drafting emails. Built as a deterministic intent matcher over the live tool registry (`ai/multimodal/src/voice/intent.ts`). Limits: questions are limited to `git.status`, `github.status`, `docker.containers` and `now_playing` (only tools needing no input); "switch pills" selects the next or previous source pill through the Phase 70 pill command (simulated, not run by voice on a real display); music is `now_playing` only because play, pause and skip are write tools; a drafted email is a `mailto:` link the person clicks (never sent); **web search** maps to `web-search.search_confirmed` (`capabilities/web-search`): an `external` command, so Core asks a person to approve the exact query before it is sent to ONE search provider (the owner's SearXNG instance if `searxng_url` is set, otherwise Brave Search if a key is stored, otherwise DuckDuckGo's keyless Instant Answer API; the approved search never falls back to a second provider, because the approval card cannot show the owner's SearXNG host); the plain `search` command tries the chain in that order and moves on only when a provider fails. Once the capability is enabled a query can reach duckduckgo.com with no setup (it is installed, never auto-enabled), and DuckDuckGo's answers are topic and entity summaries, not ranked web results; when the capability is not enabled voice says "Web search is not enabled." Tested with loopback mocks and fakes only (`core/runtime/test/voice-web-search.test.ts`, `capabilities/web-search/test/`): no real SearXNG instance, Brave Search, DuckDuckGo, key or microphone was used by any test (the one DuckDuckGo response the shape was read from was a single manual request, not a test).
- [ ] Off by default; < 1 % CPU when idle (voice activity detection first); audio never saved. Off by default and the audio handling are tested with a fake recogniser (`core/runtime/test/voice.test.ts` "refuses to start, reports itself off…", `ai/multimodal/test/voice/sessions.test.ts`: the pre-roll ring, the partial utterance and every chunk are zeroed on every exit path). The CPU part is **not** demonstrated: see the first exit criterion. Nobody watched the filesystem during a real session.

## Tasks — Phoenix improvements

- [x] Actions go through the tool gateway (Phase 30) with the same approvals as a click; voice may deny but never approve. Voice runs a tool through `ToolGateway.call` as the actor `{ kind: "agent", id: "voice", trustedByUser: false }`, only for tools the live registry lists with side effect `none` or `read` (checked at intent time and again before the call). `VoiceRuntime` is handed only `VoiceApprovals { pending, deny }`, so no approve method exists to call. Tests: `core/runtime/test/voice.test.ts` ("a write tool is never run by voice, whatever is said", "the gateway call carries an actor that does not claim trustedByUser", "a call policy escalates waits for a person; voice gives up after its wait and DENIES it, and no spoken approval is ever an approval", "'deny' by voice denies a waiting confirmation through the permission gateway"), which includes a spy on `resolveConfirmation` and spoken yes/approve/confirm. Run with a fake recogniser only; no spoken word from a real person was ever processed.
- [x] Every voice action is in the audit log. `voice.start`, `voice.wake`, `voice.request`, `voice.action`, `voice.stop` and `voice.settings` carry ids, tool names, outcomes and reasons, never the transcript, and the gateway adds its own `policy.decision` for the voice actor (`core/runtime/test/voice.test.ts` "'ok fawkes what is my git status' runs git.status through the real ToolGateway and returns text", which reads the audit log and checks that no transcript is in it). Fake recogniser only.

## Deliverables

- Voice assistant: the web page (`apps/web/src/components/Voice.tsx`) plus a desktop host, **built but never run**: `apps/web/voice.html` (`apps/web/src/voice/`) is a small page for the shell's own window `phoenix-voice` (`apps/desktop/src-tauri/src/voice_window.rs`, opened only from the tray menu "Open voice assistant (OK Fawkes)"). The shell allows the microphone for that window on Core's own `/voice.html` only and denies every other permission and window (never `Default`), shows LISTENING in the window title and tray tooltip from its own decision, and has a tray "Stop voice listening" that destroys the window. The `Info.plist` `NSMicrophoneUsageDescription` now describes the voice assistant. No capability and no command is granted to the voice window. See [voice-assistant.md](../voice-assistant.md#desktop-host-tauri-never-run-on-a-real-microphone).
- Intent → tool mapping: built (`ai/multimodal/src/voice/intent.ts`, `dispatch.ts`), documented in [voice-assistant.md](../voice-assistant.md).

## Exit criteria

- [ ] CPU budget measured and documented. Not met. Only the VAD gate was measured, by a per-component microbenchmark (`scripts/bench-voice-vad.ts`): about 0.008–0.02 ms of CPU per second of audio on Apple Silicon, documented in [voice-assistant.md](../voice-assistant.md). Whole-app idle CPU (the < 1 % target) with the webview `ScriptProcessorNode` microphone path, the WebSocket, and a whisper pass was **not** measured, and the threshold itself is an open owner decision.
- [ ] A voice request runs a read-only capability action end to end. Not met. It was shown only with a `FakeRecognizer` through the real `ToolGateway` against a real temporary git repository (`git.status`). No real microphone, whisper pass, wake recognition or speech synthesis took part.

## Implementation notes

### What was built

- `ai/multimodal/src/voice/`: energy VAD with hysteresis and hangover, an utterance gate with a zeroed pre-roll ring, a fuzzy wake matcher, the deterministic intent matcher, a summariser that turns tool output into fixed-shape sentences, the dispatcher and the sessions.
- Core: `VoiceRuntime` (`core/runtime/src/voice.ts`), routes (`core/api/src/voice-routes.ts`) and a single-use, token-checked, same-origin WebSocket for binary PCM (`voice-socket.ts`). `voice.listening` and `voice.idle` are Core-only events that show LISTENING for the awake window only.
- Web: `Voice.tsx` (opt-in; the microphone is requested only after voice is enabled), `scripts/bench-voice-vad.ts`, and [voice-assistant.md](../voice-assistant.md).

### Decisions

- The spoken words only select a fixed intent; they are never a tool input, a command line or a URL. The one exception is the web-search query (at most 80 characters), the single input of `web-search.search_confirmed`, which is `external`, so a person approves the exact query before it leaves the computer; voice cannot approve, and the audit log never holds the query. Tool output is untrusted data, summarised into a fixed sentence, with wake-phrase-like text in third-party fields (repository, branch, track, container names) removed before it is spoken.
- No new Fawkes state. No audio file is written by Phoenix, and the transcript is never stored, put in an event or in the audit log.
- There is no speaker verification: any audio source in the room that says the wake phrase can trigger read-only requests and "deny". It can never approve or run a write. This is documented, not fixed.
- Fawkes's own speech could re-trigger it; the page drops microphone frames while speaking plus a one-second tail, but real echo behaviour was not tested.

### Security fix from review

A static review (not a human audit) found that the voice timeout loop could deny confirmations raised by other actors. The loop was removed: after its wait voice aborts only its own call and leaves other actors' confirmations for the person.

What was not done or not run: any real microphone, whisper pass, wake recognition, speech synthesis (including the browser's speech-end events) or room echo; whole-app CPU measurement; a run of web search against a real SearXNG instance, Brave Search or DuckDuckGo, or with a real key (it was only tested against local mocks; the DuckDuckGo shape comes from one manual request); voice play, pause or skip; a run of the desktop voice window on a real display, microphone, OS permission prompt or packaged app (and the changed `Info.plist` text, which only takes effect in a built bundle); speaker verification. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
