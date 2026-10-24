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
  reading the audio from stdin). No audio file is written by Phoenix. There is no cloud speech path.
- The transcript is used for matching and then dropped. It is never stored, never put in an event
  and never put in the audit log.

## Wake phrase (and its limitation)

The wake phrase is matched on the **text** a recogniser produced for a short VAD-gated utterance.
It is **not a keyword spotter**: a whisper pass runs for each utterance of speech (not for silence),
so in a room where people talk, a recogniser pass runs per utterance. Consequences, stated plainly:

- A name like "Fawkes" depends on the model's vocabulary. The matcher accepts "ok/okay" followed by
  "fawkes", a few whisper spellings ("fawks", "fawkis", …) and anything one edit away from "fawkes"
  (five letters or more). It rejects "ok", "fawkes" alone, "ok google", "ok folks", "ok fake".
- It can miss the phrase or mishear a similar one; it was never run with a real voice here.
- Only the start of the utterance counts (at most two lead words, e.g. "hey OK Fawkes").
- There is **no speaker verification**: any audio source in the room (a person, a video, a hostile
  speaker) that says the wake phrase can trigger the read-only requests below (and "deny"). It can
  never approve anything or run a write.
- Fawkes's own spoken replies must not wake it: the page drops microphone frames while its speech
  synthesis is speaking and for about one second after, and wake-phrase-like text in third-party
  fields (repository, branch, track title, artist, container names) is removed before it is spoken.
- "OK Fawkes, what is my git status" in one breath works; "OK Fawkes" alone opens an 8-second awake
  window in which the next utterance is the request.

## What it can do (and cannot)

Intent matching is a deterministic phrase matcher (`ai/multimodal/src/voice/intent.ts`). The spoken
words only **select** a fixed intent; they are never a tool input, a command line or a URL.

| You say                                                                                                           | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "what is my git status", "github status", "docker containers", "service status"                                   | Runs the matching enabled read-only tool (`git.status`, `github.status`, `docker.containers`) through the tool gateway and speaks a fixed-shape sentence built from counts and clipped names.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| "what am I listening to"                                                                                          | Runs `spotify.now_playing`, `apple-music.now_playing` or `mpris.now_playing` **if that capability is enabled** (matched by tool name); otherwise says "No music service is enabled".                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| "search the web for …", "search for …", "look up …"                                                               | **Needs your approval every time.** Runs `web-search.search_confirmed` (an `external` command of the `web-search` capability, **only if you enabled it and set a Brave Search key**; otherwise "Web search is not enabled."). The words after the verb (at most 80 characters, so you can read all of them) are the one input of that call. Core shows the whole query in an approval card, and **nothing is sent until you approve it in the Pet Panel**; voice can only deny, and spoken "yes" or "approve" is refused. The spoken answer is a fixed sentence ("The search found 3 results. The first is …"), never the result text as an instruction. |
| "switch to the pill", "next pill", "previous pill"                                                                | The reply carries a `switch_pill` UI action with a `direction` (`next` or `previous`); the page runs the same pill command as the Phoenix shortcut and palette: it selects the next or previous active source pill and opens the page that shows it. Core acts on nothing.                                                                                                                                                                                                                                                                                                                                                                               |
| "draft an email about …"                                                                                          | The reply carries a `mailto:` draft link made by Core (URL-encoded, ≤ 300 chars). The page shows it as a link **you** click. Fawkes never sends mail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| "deny" / "reject" / "cancel that"                                                                                 | Denies every waiting confirmation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| anything that sounds like an action ("send", "delete", "deploy", "play", "pause", "yes", "approve", "confirm", …) | Refused with a spoken explanation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

A tool is eligible only if the live registry lists it with side effect `none` or `read` **and** it
needs no input. The check runs twice: when the intent is chosen and again immediately before the
call. Tools with writes, execution or external effects are unreachable by any phrase, **with one
named exception: `web-search.search_confirmed`** (next section).

## Web search (the query leaves this computer)

"Search the web for cats" sends the words **"cats" to the search host** (Brave Search,
`https://api.search.brave.com`; see `capabilities/web-search/README.md`). That is the one thing in
Phoenix voice that sends spoken text off the device, so it is held to the rules for external
actions:

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
secret-bearing query, capability not enabled) and `capabilities/web-search/test/`. **No real search
service was contacted, no real key was used and no speech recogniser heard a real query.**

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
`scripts/bench-voice-vad.ts`.
