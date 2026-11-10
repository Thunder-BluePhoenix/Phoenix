# « OK Fawkes » voice assistant (Phase 66)

Talk to Fawkes hands-free: say "OK Fawkes", then ask. Everything is **off until you turn it on**
(Settings → Voice). This page says what is built, how it decides, what it measured and what it did
not.

## What happens to audio

```
microphone (webview, only after you switched voice on)
  → 16 kHz Int16 frames over a single-use, same-origin WebSocket
  → Core: energy VAD on every frame          (idle cost: one pass of integer maths per frame)
  → only when speech is heard: ONE short utterance (+ 400 ms pre-roll) → local recogniser
  → text → wake-phrase match "OK Fawkes" → (awake window) → intent → tool gateway → reply text
  → the page speaks the reply with the browser's speechSynthesis (Core produces no audio)
```

- Audio lives only in memory: a fixed pre-roll ring and at most one utterance (15 s cap). The
  ring, the partial utterance and every utterance chunk are zeroed on **every** exit: stop, the
  kill switch, switching voice off, the socket closing, a recogniser failure, a limit, shutdown.
  The ring is also zeroed the moment its contents move into an utterance. (Tests:
  `ai/multimodal/test/voice/`, `core/runtime/test/voice.test.ts`.)
- Recognition uses the existing `SpeechRecognizer` seam (`WhisperStdinRecognizer`: whisper.cpp
  reading the audio from stdin, arguments `-nt -np -otxt -of - -`: `-otxt -of -` is what makes whisper-cpp
  1.8.6 print the transcript to stdout; without it that build printed nothing). By default no audio file is written by Phoenix
  (observed once on one machine for dictation, not proven; [evidence](evidence/phase-64-real-dictation-2026-11-11.md)). If the owner opts in to
  Parakeet (`PHOENIX_SPEECH_ENGINES` lists `parakeet` and `PHOENIX_PARAKEET_MODEL_DIR` is set), that
  engine's `sherpa-onnx-offline` can only read a WAV file, so while it is the active engine each utterance
  goes to a private temporary file (0700 directory, 0600 file) that is zeroed and removed straight after;
  the status shows `audio_on_disk: true` and Settings says so. There is no cloud speech path.
- The transcript is used for matching and then dropped. It is never stored, never put in an event
  and never put in the audit log.

## Wake phrase (and its limitation)

The wake phrase is matched on the **text** a recogniser produced for a short VAD-gated utterance.
It is **not a keyword spotter**: a whisper pass runs for each utterance of speech (not for silence),
so in a room where people talk, a recogniser pass runs per utterance. Consequences, stated plainly:

- A name like "Fawkes" depends on the model's vocabulary. The matcher accepts "ok/okay" followed by
  "fawkes", a few whisper spellings ("fawks", "fawkis", …) and anything one edit away from "fawkes"
  (five letters or more). It rejects "ok", "fawkes" alone, "ok google", "ok folks", "ok fake".
- It can miss the phrase or mishear a similar one; with real audio (macOS system voices, one run) whisper tiny.en heard the name as "Fox", "forks" or "folks" and the matcher did not wake (see "Real speech end to end" below). A 191-clip measurement (see "Measured wake quality" below) found the same: 0 of 80 wake clips woke.
- Only the start of the utterance counts (at most two lead words, e.g. "hey OK Fawkes").
- There is **no speaker verification**: any audio source in the room (a person, a video, a hostile
  speaker) that says the wake phrase can trigger the read-only requests below (and "deny"). It can
  never approve anything or run a write.
- Fawkes's own spoken replies must not wake it: the page drops microphone frames while its speech
  synthesis is speaking and for about one second after, and wake-phrase-like text in third-party
  fields (repository, branch, track title, artist, container names) is removed before it is spoken.
- "OK Fawkes, what is my git status" in one breath works; "OK Fawkes" alone opens an 8-second awake
  window in which the next utterance is the request.

## Measured wake quality (Phase 66): synthetic voices, one run, exit criterion NOT met

Evidence: `docs/evidence/phase-66-real-wake-2026-11-11.md` (+ `-raw.json`; test `ai/multimodal/test/real-wake.test.ts`, gated by `PHOENIX_REAL_DICTATION=1`). Fixtures and the scoring rule are in the test header and were fixed before the first run. The chain was the shipped one: `UtteranceGate` (default energy VAD, 4096-sample frames) → real `WhisperStdinRecognizer` with `whisper-cli` (whisper.cpp 1.8.6) and `ggml-tiny.en.bin` → `matchWake`. 191 clips: 185 from five macOS `say` voices (Samantha, Daniel, Karen, Moira, Rishi; 37 fixtures × 5; **synthetic, not people**), the whisper.cpp `jfk.wav` recording, 3 two-voice overlaps and 2 clips with synthetic pink-ish noise at 20 dB SNR. Intervals are Wilson 95%.

| measure                                                                                                                                                                   | result                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| wake false reject, "OK/Okay Fawkes …" (70 clips: 14 fixtures × 5 voices)                                                                                                  | 70/70 = 100% [94.8, 100]                                                              |
| wake false reject, "Hey/Hi Fawkes …" (10 clips; not a documented form: "hey" is only allowed before "ok")                                                                 | 10/10 = 100% [72.2, 100]                                                              |
| false accept, non-wake `say` clips (95 clips: near-folks, near-fox, near-fork, "Fawkes" mid-sentence, news, bird, command-without-wake, "OK Google/OK fine", long speech) | 0/95 = 0% [0, 3.9]                                                                    |
| false accept, jfk.wav (one recording, three utterances)                                                                                                                   | 0/1 [0, 79.3]                                                                         |
| borderline "Hey Fowkes" / "OK Fowkes" (reported separately, not an error)                                                                                                 | 1/10 accepted (Rishi: "Okfauks, geese status.")                                       |
| VAD gate never opened                                                                                                                                                     | 1/191 [0.1, 2.9]: the 20 dB-SNR noise clip                                            |
| every wake miss: recognition or matcher                                                                                                                                   | 80/80 recognition: `tiny.en` wrote "Fox", "Forks", "Folks" or "vlogs", never "Fawkes" |

By voice, the wake false-reject rate was 16/16 for each of the five voices and the non-wake false accept 0/19 for each. Recognition took about 0.6 s per utterance on this machine.

What it means: on this model, with these voices, the documented wake phrase did not work, and the matcher cannot fix that from the text alone ("OK Fox, get status" has the same shape as the near-miss "Okay fox, what does the fox say"). The matcher refused every near miss it was given, but since the recogniser never wrote the name this is a weak test of its selectivity. Another model, a vocabulary hint for the recogniser or a different engine might change this; none was tried. The matcher and thresholds were not changed. In the noise clip the noise (RMS 0.0139 of full scale) was above the gate's `stopRms` 0.012, so the gate never saw the end of the utterance [inference from a separate render of the same sentence].

Limits: synthetic voices (not people) except one recording; one English-only tiny model; quiet clean clips (digital silence around each, two with synthetic noise); English only, five system voices; no live microphone; no speaker echo of Fawkes's own voice; `VoiceSessions` itself (socket, timers, intent dispatch) was not in the loop, only its gate, recogniser and matcher; one machine, one run (a second identical run gave identical text for all 191 clips).

## What it can do (and cannot)

Intent matching is a deterministic phrase matcher (`ai/multimodal/src/voice/intent.ts`). The spoken
words only **select** a fixed intent; they are never a tool input, a command line or a URL.

| You say                                                                                                           | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "what is my git status", "github status", "docker containers", "service status"                                   | Runs the matching enabled read-only tool (`git.status`, `github.status`, `docker.containers`) through the tool gateway and speaks a fixed-shape sentence built from counts and clipped names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| "what am I listening to"                                                                                          | Runs `spotify.now_playing`, `apple-music.now_playing` or `mpris.now_playing` **if that capability is enabled** (matched by tool name); otherwise says "No music service is enabled".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| "search the web for …", "search for …", "look up …"                                                               | **Needs your approval every time.** Runs `web-search.search_confirmed` (an `external` command of the `web-search` capability, **only if you enabled it**; no key is needed, because DuckDuckGo needs none; otherwise "Web search is not enabled."). The words after the verb (at most 80 characters, so you can read all of them) are the one input of that call. Core shows the whole query in an approval card, and **nothing is sent until you approve it in the Pet Panel**; voice can only deny, and spoken "yes" or "approve" is refused. The spoken answer is a fixed sentence ("The search found 3 results. The first is …"), never the result text as an instruction. |
| "switch to the pill", "next pill", "previous pill"                                                                | The reply carries a `switch_pill` UI action with a `direction` (`next` or `previous`); the page runs the same pill command as the Phoenix shortcut and palette: it selects the next or previous active source pill and opens the page that shows it. Core acts on nothing.                                                                                                                                                                                                                                                                                                                                                                                                     |
| "draft an email about …"                                                                                          | The reply carries a `mailto:` draft link made by Core (URL-encoded, ≤ 300 chars). The page shows it as a link **you** click. Fawkes never sends mail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| "deny" / "reject" / "cancel that"                                                                                 | Denies every waiting confirmation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| anything that sounds like an action ("send", "delete", "deploy", "play", "pause", "yes", "approve", "confirm", …) | Refused with a spoken explanation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

A tool is eligible only if the live registry lists it with side effect `none` or `read` **and** it
needs no input. The check runs twice: when the intent is chosen and again immediately before the
call. Tools with writes, execution or external effects are unreachable by any phrase, **with one
named exception: `web-search.search_confirmed`** (next section).

## Web search (the query leaves this computer)

"Search the web for cats" sends the words **"cats" to a search provider**. That is the one thing in
Phoenix voice that sends spoken text off the device, so it is held to the rules for external
actions. Which provider (see `capabilities/web-search/README.md`):

- **Nothing needs setting up.** The `web-search` capability is installed but **never enabled
  automatically**. Once **you** enable it, a spoken search goes to **DuckDuckGo's Instant Answer API**
  (`https://api.duckduckgo.com`) even with no key and no other setting: the old rule "without your
  key nothing is sent anywhere" no longer holds. DuckDuckGo's answers are **topic and entity
  summaries, not ranked web results**, and many queries get none ("The search found no results.").
- If you set `searxng_url` (your own SearXNG instance; https, or http to this computer only) the
  query goes to **that host** instead; if you stored a Brave Search key and set no `searxng_url`, to
  **Brave Search** (`https://api.search.brave.com`). The order is SearXNG, then Brave, then DuckDuckGo.
- **The approved search asks exactly one provider and never falls back.** The approval card shows the
  query and a fixed description that names all three possible providers, but it cannot show the
  address you set in `searxng_url` (the card shows the command text and the `query` value, nothing
  else), so letting a failed search quietly go on to another host would send your words somewhere
  the card did not name. If that one provider fails the search fails with a fixed message. The plain
  `search` command (owner, API, agents; never voice) does fall back, only when a provider fails,
  never on an empty answer, at most three attempts.
- Whoever can change the capability's settings can point queries at another host (queries only; no
  credential is attached to it), possibly on your local network.

- The request must **start** with "search (the web|the internet) (for|about)", "search for" or "look
  up"; a sentence that merely mentions the web is refused with a hint. The query is the rest of the
  phrase, lower-cased with punctuation removed, **at most 80 characters** (longer is refused, not cut).
- Voice may call only the tool named `web-search.search_confirmed`, and only while the registry
  lists it exactly as built: side effect `external` and an input of one required `query` with no
  other property. The same check runs again immediately before the call. If the registry says
  `read` for that name (no approval) the call is refused. The plain `web-search.search` read command
  is never named by voice.
- `external` means Core asks a person **before every call**, and the approval card shows the whole
  query (`[query: …]`). Voice runs as `{ kind: "agent", id: "voice", trustedByUser: false }`; it has no
  approve method and spoken approvals are refused. If nobody approves within 60 s voice withdraws its
  own request and nothing is sent.
- Before the card is raised, the capability manager refuses a query that looks like a credential;
  after approval, the capability checks again with the agent secret detector and refuses, so a spoken
  or misrecognised key is never sent to a search host.
- Results are untrusted text. The spoken sentence has a fixed shape (count and first title only,
  with wake-phrase-like text removed). Titles, snippets and links are never followed or fetched.
- Words that sound like actions ("delete", "send", "yes") **inside** a search are just query text:
  the query feeds only the one search tool, and a person still approves it. A phrase that does not
  start with the search verb ("delete my files then search the web for cats") is refused as before.
- The audit log has `voice.request` (intent kind `web_search`) and `voice.action` (tool name and
  outcome), **never the query**. The tool gateway's own record carries only the tool name. The query
  is in the approval card and in the request to the search host.

**What was verified:** only fakes. `ai/multimodal/test/voice/wake-intent.test.ts` (intent, registry
shape, dispatch), `core/runtime/test/voice-web-search.test.ts` (real tool gateway, permission gateway
and capability manager against a loopback mock: nothing sent before approval, decline, timeout,
secret-bearing query, capability not enabled) and `capabilities/web-search/test/`. **No real SearXNG
instance, Brave Search or DuckDuckGo was contacted by any test, no real key was used and no speech
recogniser heard a real query.**

## Same approvals as a click; voice may deny, never approve

- Execution is `ToolGateway.call` with the actor `{ kind: "agent", id: "voice", trustedByUser: false }`.
  Per `core/policy/README.md`, an actor that is not directly asked for by the user needs approval
  above low risk. Core builds the call (`input: {}`, `environment: "local"`); the tool output is
  untrusted data and is summarised into a fixed sentence (`summary.ts`).
- `VoiceRuntime` is handed only `VoiceApprovals { pending(); deny(id) }`, which can call
  `PermissionGateway.resolveConfirmation(id, false, "voice")` and nothing else. There is no approve
  method to call. Spoken "yes", "approve", "confirm", "go ahead", "allow", … are refused as actions.
  Tests spy on `resolveConfirmation` and assert no call with `approved === true` ever comes from
  voice, including after spoken approvals while a real policy-escalated confirmation is pending.
- If a call waits for a person's approval longer than 60 s, voice stops waiting and aborts its own
  call; the gateway withdraws that call's own confirmation. Voice denies nothing else on a timeout,
  so a confirmation another actor raised during the wait is left for the person.
- `pending()` also carries each confirmation's `details.targets` (already re-sanitised by the
  gateway). Voice still treats them as untrusted text: "deny" and the 60 s timeout reply add a short
  sentence `target: "<value>", … and N more` (`approval-summary.ts`). Only values are spoken, each
  inside quotes after the fixed word `target:`; control, bidi, zero-width and quote characters are
  removed, NFKC folded, values clipped to 80 characters, secret-shaped runs and the redaction marker
  spoken as `[hidden]`, wake phrases and answer or action words (approve, yes, no, deny, ok, send, …)
  replaced by an ellipsis, at most 3 values in all. The timeout reply names only the confirmations
  that call itself raised. Nothing here changes what approving or denying does. Tests:
  `ai/multimodal/test/voice/approval-summary.test.ts`, `core/runtime/test/voice-approvals-targets.test.ts`
  (simulated; no real voice session or speaker).

## Audit

`voice.start`, `voice.wake`, `voice.request` (intent kind), `voice.action` (tool name + outcome),
`voice.stop` (reason) and `voice.settings`: ids, tool names, outcomes and reasons only. The tool
gateway adds its own `policy.decision` record for the voice actor before anything runs.

## Fawkes states

No new states. `voice.listening` (published when the awake window opens) shows **LISTENING**;
`voice.idle` clears it. While the assistant is only waiting for the wake phrase, Fawkes shows
nothing for it, so the two situations differ; the page's "Microphone on" indicator and
`GET /api/voice/status` (`active.phase`: `waiting` | `awake` | `thinking`) cover the waiting case.
Both events are Core-only (`POST /api/events` refuses them) and carry only `{ session }`.

## Desktop host (Tauri): never run on a real microphone

Evidence status: **Rust unit tests, a lifecycle test on Tauri's mock runtime and web tests with a fake shell only.** Nothing ran on a real microphone, a real OS permission prompt, a real webview, a real window title or tray, or in a packaged app. The mock runtime has no web engine: it fires no page-load, title or permission event, so those paths are driven by test hooks that call the same decision code.

What exists (`apps/desktop/src-tauri/src/voice_window.rs`, `apps/web/voice.html`, `apps/web/src/voice/`):

- **A window for the existing assistant.** The tray entry "Open voice assistant (OK Fawkes)" opens the window `phoenix-voice` on Core's `/voice.html` (fixed by the shell: loopback `http` only, never supplied by a page). The page runs the same `VoiceAssistant` as Settings > Voice, with the same single-use same-origin stream. Nothing opens at startup. Turning voice on (consent) stays in Settings; the window only starts and stops listening and refuses to offer a start while voice is off or the emergency stop is engaged. Core's consent behaviour is unchanged.
- **No command for the page.** `phoenix-voice` is named by no capability file and by no runtime `add_capability`, and `build.rs` lists no voice command, so this remote page can invoke nothing and listen to nothing (a unit test reads the files for this). Its only channel to the shell is its document title (`phoenix-voice:active` / `phoenix-voice:idle`), which the shell reads as an untrusted claim; a web test compares those strings with the Rust constants.
- **Microphone allowed for this page only.** `permission_decision` returns `Allow` only for the microphone, from the window labelled `phoenix-voice`, while it is on exactly `<Core>/voice.html`. Every other kind (camera, display capture, geolocation, clipboard, notifications, …) and every other window or page gets `Deny`; the function never returns `Default`, so nothing falls back to the platform's allow-or-prompt behaviour. Navigation away from that page and new windows are refused. (The dictation pill's existing handler still answers `Default` for the microphone; it is a different window and was not changed.)
- **A LISTENING indicator the page cannot omit.** Allowing the microphone turns the indicator on in the shell, before the stream can open: the window title becomes "Phoenix Voice - LISTENING (microphone on)" and the tray tooltip gets " - LISTENING (voice microphone on)" (kept on top of the Keep-awake text). The page's "active" claim can also turn it on; its "idle" claim turns it off only after it said "active" (a stale "idle" is ignored). A page load, the window closing or the shell stop turn it off. **Limit:** the shell cannot see the web engine's capture state, so a page that claims "idle" while still holding a stream would clear the indicator, and a platform that remembers a grant might not ask the handler again; the stop below does not depend on either.
- **Emergency stop from the shell.** Tray "Stop voice listening" destroys the window, which takes the web engine, the capture stream, the audio thread and the socket to Core with it, whatever the page is doing; Core ends the session when its socket closes (and its own kill switch still ends sessions from the Core side). It never asks Core or the page. In the mock runtime only the shell's bookkeeping (indicator cleared, destroy requested) is observable.
- **`Info.plist`.** `NSMicrophoneUsageDescription` now says that the microphone is used for dictation and, if switched on, for the OK Fawkes assistant; that it listens for the wake phrase on this device, the audio is processed locally, and nothing is sent anywhere until a command is understood (the only thing that can leave is the text of a web search you approve); that audio is not stored; and that LISTENING is shown and "Stop voice listening" ends it. A Rust test reads the file. **It takes effect only in a built macOS bundle** (`tauri build`); `tauri dev` and the tests never show it, and the wording was never seen in a real prompt. It was kept truthful with the code as it stands: an optional recogniser engine (`audio_on_disk`) can use a short-lived temporary file, which the text says.
- **Not done:** no run on a real microphone or OS prompt; no packaged app; Windows and Linux permission behaviour (WebView2, WebKitGTK) was only read from the Tauri sources, not run; no always-on global hotkey for voice; the on-screen tray icon does not change colour (tooltip and window title only).

## Real speech end to end (one run, 2026-11-11): the wake phrase was NOT recognised

Test: `core/runtime/test/real-voice-e2e.test.ts` (gated `PHOENIX_REAL_DICTATION=1`), evidence
[phase-66-real-voice-e2e-2026-11-11.md](evidence/phase-66-real-voice-e2e-2026-11-11.md) (+ `-raw.json`). It starts a real in-process
Core with voice on and a real temporary git repository (3 commits, one modified and one untracked file), renders
requests with macOS `say` (**synthetic voices, not people**), and feeds the 16 kHz PCM, paced at real time in 100 ms frames,
through the real `/api/voice/stream` WebSocket, the VAD gate, the production recogniser chain with the real `whisper-cli` 1.8.6 and
`ggml-tiny.en.bin`, wake and intent matching, the real `ToolGateway`, policy engine and audit log. Requests, voices and what is
recorded were fixed in the test header before the first run. **Speech synthesis did not run** (the browser's `speechSynthesis` is out
of reach here); no live microphone, no browser page, no person.

**Result of that one run, recorded without tuning:** 12 renderings (9 read-only: "git status", "what is the status of my services",
"is anything happening" × Samantha, Daniel, Karen; plus "delete the branch", "approve the request", "deny"). The tiny model heard the
name as "Fox", "forks" or "folks" in every one of the 12 (for example "OK Fox, get status.", "OK forks, good status."), which the wake
matcher rejects **by design** (see above), so **wake was accepted 0 of 12 times**, no intent was chosen, **no capability call was
made, and no reply came back**. This is the wake-phrase limitation above shown with real audio: with this model and these voices the
assistant did not wake. The matcher was not changed afterwards. What the run does show: real whisper recognition of the utterances
worked and finished (about 0.6 s each), the structural properties held trivially (no gateway call, no `resolveConfirmation` call, a pending write confirmation was still pending after "approve the request" was said, no audio-like file created in the watched roots in these 12 runs). Because the wake never matched, the speech never reached the intent matcher, so the "voice cannot approve" and "delete is refused" claims were **not** tested through real audio by this run (they stay shown by the fake-recogniser tests and by `matchIntent` on the reference text, recorded in the evidence file). The path "wake accepted → intent → `git.status` → reply" with real recognised text was therefore **not**
exercised by this run; it stays shown only with the fake recogniser.

## Protocol

See the header of `core/api/src/voice-routes.ts` and `docs/api/openapi.yaml`:
`GET/POST /api/voice/settings`, `GET /api/voice/status`, `POST /api/voice/sessions`,
`DELETE /api/voice/sessions/:id`, and `WS /api/voice/stream?session=<id>` (binary PCM only; same
upgrade rules as the dictation stream).

## CPU budget (exit criterion): measured per component, NOT whole-app

Script: `scripts/bench-voice-vad.ts` (`npx tsx scripts/bench-voice-vad.ts`). Deterministic synthetic
audio (a fixed LCG), 600 s per run, median of 5 runs, 4096-sample frames, `process.cpuUsage()`
(user + system) rather than wall time. Machine: Apple Silicon (darwin/arm64), Node v25.2.1. Run
twice; the two runs agreed within the noise shown.

| Component, 16 kHz mono audio                                     | CPU ms per audio second | % of one core   |
| ---------------------------------------------------------------- | ----------------------- | --------------- |
| `EnergyVad`, room noise only                                     | 0.008                   | 0.0008 %        |
| `EnergyVad`, speech-like audio (40 % speech)                     | 0.04 – 0.07             | 0.004 – 0.007 % |
| `UtteranceGate` (VAD + pre-roll ring), room noise only           | 0.019 – 0.020           | 0.002 %         |
| `UtteranceGate` (VAD + pre-roll ring), speech-like (40 % speech) | 0.022 – 0.030           | 0.002 – 0.003 % |

What this shows: the gate that runs on every frame costs on the order of **0.02 ms of CPU per
second of audio** on this machine, so the VAD-first design makes the Core-side idle cost
negligible next to 1 % of a core (10 ms per second).

What it does **not** show, and therefore the exit criterion "< 1 % CPU when idle" stays **UNMET**:

- Whole-app idle CPU was **not measured**.
- The webview microphone path was not measured: `getUserMedia`, the audio thread, the
  `ScriptProcessorNode` callback (4096 samples every 256 ms), `Float32 → Int16` conversion and the
  WebSocket send. That path runs continuously while voice is on and is likely the larger cost.
- Core's WebSocket receive and per-frame copy were not measured, nor was a whisper pass (which runs
  once per utterance of speech and is far heavier than the gate).
- The synthetic audio is not a microphone recording.

## Files

`ai/multimodal/src/voice/` (vad, utterance, wake, intent, summary, dispatch, sessions, settings),
`core/runtime/src/voice.ts`, `core/api/src/voice-{routes,socket}.ts`, `capabilities/web-search/` (the search),
`apps/web/src/components/Voice.tsx`, `apps/web/src/core/voice{,-assistant}.ts`,
`apps/web/voice.html`, `apps/web/src/voice/`, `apps/desktop/src-tauri/src/voice_window.rs`,
`scripts/bench-voice-vad.ts`.
