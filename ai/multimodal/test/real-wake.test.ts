// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 66 MEASUREMENT (not a pass threshold): how well the real wake chain of the voice assistant
// accepts "OK Fawkes" and refuses near misses, on speech that is NOT a person (macOS `say` system
// voices) plus one real recording (whisper.cpp's jfk.wav). Skipped unless enabled:
//
//   PHOENIX_REAL_DICTATION=1 PHOENIX_REAL_WHISPER_MODEL=/path/ggml-tiny.en.bin \
//     node ./node_modules/vitest/vitest.mjs run ai/multimodal/test/real-wake.test.ts \
//     --testTimeout=60000
//
// Results are written to docs/evidence/phase-66-real-wake-<date>.md (+ -raw.json).
//
// ------------------------------------------------------------------------------------------------
// THE CHAIN (the production pieces, in the order `VoiceSessions.handle` uses them; sessions.ts)
//   PCM (16 kHz mono Int16) in 4096-sample frames, like the page's ScriptProcessor
//   -> `UtteranceGate` with DEFAULT_UTTERANCE_CONFIG (energy VAD, 400 ms pre-roll, 15 s cap)
//   -> each emitted utterance: real `WhisperStdinRecognizer` (whisper-cli, model from env), push/finish
//   -> `matchWake(text)`; not awake and no match: dropped; match with empty rest: the awake window
//      opens and the NEXT utterance is the request; match with a rest: the rest is the command.
// NOT in this replay: the WebSocket, `VoiceSessions` itself (its intent dispatch needs the tool
// gateway), the timers, the "drop frames while thinking" behaviour (all utterances of a clip are
// queued and recognised in order here, which can only ADD utterances compared to production), the
// page's mute while Fawkes speaks. Each clip gets 1000 ms of digital silence before and 1500 ms
// after the voice, so the VAD hangover (600 ms) can end the utterance; with noise added the noise
// runs over the silence too. A clip whose gate is still "speaking" at the end is recorded as such
// (production would not recognise it until the speech ended), and is NOT recognised.
//
// ------------------------------------------------------------------------------------------------
// FIXTURES (written before the first run; never changed after seeing a result)
// Each fixture is rendered with ALL five voices: Samantha (en_US), Daniel (en_GB), Karen (en_AU),
// Moira (en_IE), Rishi (en_IN), 16 kHz mono LEI16 via `afconvert`. Synthetic voices are NOT people.
//
// WAKE, documented phrase "OK Fawkes" (group wake-ok, 14 fixtures; expected command in brackets):
//   w01 "OK Fawkes, git status"                          [git status]
//   w02 "Okay Fawkes deny"                               [deny]
//   w03 "OK Fawkes, what is the time"                    [what is the time]
//   w04 "Okay Fawkes, what is my git status"             [what is my git status]
//   w05 "OK Fawkes"                                      [] (phrase alone: opens the awake window)
//   w06 "Okay, Fawkes, what is playing"                  [what is playing]
//   w07 "OK Fawkes. Please stop."                        [please stop]
//   w08 "OK Fawkes, how many approvals are waiting"      [how many approvals are waiting]
//   w09 "Okay Fawkes what is the weather"                [what is the weather]
//   w10 "OK Fawkes, read me the last notification"       [read me the last notification]
//   w11 "Hey, OK Fawkes, are you there?"                 [are you there]
//   w12 "Okay Fawkes, show me my calendar for today"     [show me my calendar for today]
//   w13 "OK Fawkes, is the build passing"                [is the build passing]
//   w14 "O.K. Fawkes, git status"                        [git status]
// WAKE, greeting form (group wake-hey, 2 fixtures). The assignment labels these WAKE. The matcher
// documents "ok/okay" + "fawkes" and allows "hey" only BEFORE "ok" (wake.ts), so "Hey Fawkes" is
// expected to be rejected by design; it is reported as its own group and in the pooled wake total:
//   h01 "Hey Fawkes what is the time"                    [what is the time]
//   h02 "Hi Fawkes, git status"                          [git status]
// NON-WAKE (group nonwake; category in brackets; 19 fixtures + the jfk recording):
//   n01 "OK folks, let's get started"                    [near-folks]
//   n02 "Okay folks, dinner is ready"                    [near-folks]
//   n03 "Okay fox, what does the fox say"                [near-fox]
//   n04 "OK fork status"                                 [near-fork]
//   n05 "Okay, forks and knives are in the drawer"       [near-fork]
//   n06 "The old story of Guy Fawkes is told every November"           [fawkes-mid-sentence]
//   n07 "Remember the fifth of November, Guy Fawkes and his plot"      [fawkes-mid-sentence]
//   n08 "He said okay and then Fawkes lit the fuse"                    [fawkes-mid-sentence]
//   n09 "The central bank held interest rates steady on Tuesday, citing slower inflation" [news]
//   n10 "Heavy rain is expected across the north of the country this weekend"             [news]
//   n11 "The phoenix is a bird that rises from its own ashes"          [bird]
//   n12 "Fawkes the phoenix sings a song of healing"                   [bird]
//   n13 "Stop the video"                                 [command-without-wake]
//   n14 "What is the time"                               [command-without-wake]
//   n15 "Git status please"                              [command-without-wake]
//   n16 "OK Google, what is the weather"                 [ok-other]
//   n17 "Okay, that sounds good to me"                   [ok-other]
//   n18 "OK, fine, let's go"                             [ok-other]
//   n19 "And so my fellow Americans, ask not what your country can do for you" [speech-long]
//   jfk  /opt/homebrew/share/whisper-cpp/jfk.wav (a recording of a person; one clip)  [speech-long]
// BORDERLINE (arguable; reported separately; NOT counted as false accept or false reject):
//   b01 "Hey Fowkes, what is the time"   (hey form AND a one-edit spelling of the name)
//   b02 "OK Fowkes, git status"          (one edit from "fawkes": the matcher accepts it by design)
// OVERLAP (two voices mixed sample by sample at t = 0, mean of the two; reported separately):
//   ov1 w01 Samantha + n10 Daniel (expected WAKE)    ov2 w02 Karen + n09 Moira (expected WAKE)
//   ov3 n01 Rishi + n06 Samantha (expected NON-WAKE)
// NOISE (synthetic pink-ish noise, seeded LCG + Kellet pink filter, scaled to RMS = RMS of the
// unpadded voice samples / 10^(20/20), i.e. 20 dB below the voice, added over the whole padded
// clip including the leading and trailing silence; NOT a recording of any real room):
//   nz1 w02 Karen, seed 66001 (expected WAKE)        nz2 n01 Moira, seed 66002 (expected NON-WAKE)
// Totals: (14 wake-ok + 2 wake-hey + 19 nonwake) = 35 fixtures x 5 voices = 175 clips, + 1 jfk
//   = 176; + 2 borderline x 5 voices = 10 -> 186 main clips; + 3 overlap + 2 noise = 191 clips.
//
// ------------------------------------------------------------------------------------------------
// SCORING RULE (fixed here, before the first run)
//   * Text normalisation for comparing: lower-case, every character that is not a letter, digit or
//     apostrophe becomes a space, "o k" becomes "ok", split on whitespace.
//   * VAD miss: any clip (all contain speech) for which the gate emitted no utterance.
//   * wakeAccepted: some utterance of the clip was a wake match while not awake (matchWake).
//   * command: the request text the session would dispatch (the `rest`, or the text of the next
//     utterance after a bare wake). commandOk: normalised command equals the normalised expected.
//   * Wake FALSE REJECT: a wake-expected clip (groups wake-ok and wake-hey, say voices only) with
//     wakeAccepted false. Cause, decided mechanically from the recogniser's raw text:
//       "vad"            no utterance was emitted;
//       "no-text"        an utterance was recognised as empty text;
//       "matcher"        the first four words of the raw text DO contain the expected lead
//                        (ok|okay + "fawkes"; hey|hi + "fawkes" for wake-hey) but the matcher refused;
//       "recognition"    otherwise (the recogniser did not write the expected phrase).
//     For wake-hey a "matcher" cause means the documented rule, not a defect (see above).
//   * FALSE ACCEPT: a nonwake clip (say voices and jfk) with wakeAccepted true, per category.
//   * Intervals: Wilson score, 95% (z = 1.96). Rates are reported, never asserted.
//   * Structural assertions only: the matcher never throws; a clip yields a command only after a
//     wake was accepted; no utterance is recognised as anything but a string; no audio-like file
//     appears (per-clip filesystem diff, the flag rule of real-dictation.test.ts). Audio-like files
//     created by OTHER processes under /tmp/phoenix-* (sibling measurement runs share this machine's
//     /tmp) are counted separately as "foreign", by path prefix, and are not attributed to this
//     chain. The number of whisper-cli processes before and after is RECORDED, not asserted (other
//     runs on the machine may own some). A false accept that yields a command is a recorded
//     FINDING, not a failed assertion: the assertion is only "no command without an accepted wake".
// AMENDMENT after run 1 (recorded, not hidden): run 1 of this file (kept as
// docs/evidence/phase-66-real-wake-2026-11-11-run1-before-amendment*) failed ONE structural
// assertion because the flag rule matched three files of the vite-node SSR transform cache
// (`<tmpdir>/<random>/ssr/<40 hex>`, first bytes `__vite_ssr_exportName__`, i.e. JavaScript text,
// written by another vitest process on this machine during clip b02-Samantha). The foreign-file
// rule was therefore widened to also cover paths ending `/ssr/<40 hex>`. Nothing else was changed:
// fixtures, scoring rule, matcher, VAD and recogniser configuration are as before run 1.
// LIMITS: synthetic voices (not people) plus one real recording; the English-only tiny model;
// quiet clean clips except two synthetic-noise ones; English only; no live microphone and no
// speaker echo of Fawkes's own voice; one machine, one run; the fixture sentences are ours.
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_UTTERANCE_CONFIG,
  UtteranceGate,
  WhisperStdinRecognizer,
  matchWake,
  wipeUtterance,
  type SpeechRecognizer,
  type Utterance,
} from "../src";
import {
  diffSnapshots,
  run,
  snapshot,
  watchedRoots,
  type FsDiff,
  type Root,
} from "./support/fs-observe";
import {
  addNoise,
  decodeWav,
  fmtInterval,
  mixPcm,
  noiseRmsForSnr,
  pinkishNoise,
  rmsOf,
  wilson,
} from "./support/pcm";

const GATED = Boolean(process.env.PHOENIX_REAL_DICTATION);
const MODEL_PATH = process.env.PHOENIX_REAL_WHISPER_MODEL ?? "";
const EXPECTED_MODEL_SHA1 = "c78c86eb1a8faa21b369bcd33207cc90d64ae9df";
const JFK_PATH = "/opt/homebrew/share/whisper-cpp/jfk.wav";
const FRAME_SAMPLES = 4_096;
const LEAD_SILENCE_MS = 1_000;
const TAIL_SILENCE_MS = 1_500;
const NOISE_SNR_DB = 20;
const VOICES = ["Samantha", "Daniel", "Karen", "Moira", "Rishi"] as const;
type Voice = (typeof VOICES)[number];

type Group = "wake-ok" | "wake-hey" | "nonwake" | "borderline";
interface Fixture {
  id: string;
  group: Group;
  category: string;
  text: string;
  /** Expected command text; undefined for non-wake and borderline. */
  command?: string;
}

const FIXTURES: Fixture[] = [
  {
    id: "w01",
    group: "wake-ok",
    category: "ok-fawkes",
    text: "OK Fawkes, git status",
    command: "git status",
  },
  { id: "w02", group: "wake-ok", category: "ok-fawkes", text: "Okay Fawkes deny", command: "deny" },
  {
    id: "w03",
    group: "wake-ok",
    category: "ok-fawkes",
    text: "OK Fawkes, what is the time",
    command: "what is the time",
  },
  {
    id: "w04",
    group: "wake-ok",
    category: "ok-fawkes",
    text: "Okay Fawkes, what is my git status",
    command: "what is my git status",
  },
  { id: "w05", group: "wake-ok", category: "ok-fawkes", text: "OK Fawkes", command: "" },
  {
    id: "w06",
    group: "wake-ok",
    category: "ok-fawkes",
    text: "Okay, Fawkes, what is playing",
    command: "what is playing",
  },
  {
    id: "w07",
    group: "wake-ok",
    category: "ok-fawkes",
    text: "OK Fawkes. Please stop.",
    command: "please stop",
  },
  {
    id: "w08",
    group: "wake-ok",
    category: "ok-fawkes",
    text: "OK Fawkes, how many approvals are waiting",
    command: "how many approvals are waiting",
  },
  {
    id: "w09",
    group: "wake-ok",
    category: "ok-fawkes",
    text: "Okay Fawkes what is the weather",
    command: "what is the weather",
  },
  {
    id: "w10",
    group: "wake-ok",
    category: "ok-fawkes",
    text: "OK Fawkes, read me the last notification",
    command: "read me the last notification",
  },
  {
    id: "w11",
    group: "wake-ok",
    category: "ok-fawkes",
    text: "Hey, OK Fawkes, are you there?",
    command: "are you there",
  },
  {
    id: "w12",
    group: "wake-ok",
    category: "ok-fawkes",
    text: "Okay Fawkes, show me my calendar for today",
    command: "show me my calendar for today",
  },
  {
    id: "w13",
    group: "wake-ok",
    category: "ok-fawkes",
    text: "OK Fawkes, is the build passing",
    command: "is the build passing",
  },
  {
    id: "w14",
    group: "wake-ok",
    category: "ok-fawkes",
    text: "O.K. Fawkes, git status",
    command: "git status",
  },
  {
    id: "h01",
    group: "wake-hey",
    category: "hey-fawkes",
    text: "Hey Fawkes what is the time",
    command: "what is the time",
  },
  {
    id: "h02",
    group: "wake-hey",
    category: "hey-fawkes",
    text: "Hi Fawkes, git status",
    command: "git status",
  },
  { id: "n01", group: "nonwake", category: "near-folks", text: "OK folks, let's get started" },
  { id: "n02", group: "nonwake", category: "near-folks", text: "Okay folks, dinner is ready" },
  { id: "n03", group: "nonwake", category: "near-fox", text: "Okay fox, what does the fox say" },
  { id: "n04", group: "nonwake", category: "near-fork", text: "OK fork status" },
  {
    id: "n05",
    group: "nonwake",
    category: "near-fork",
    text: "Okay, forks and knives are in the drawer",
  },
  {
    id: "n06",
    group: "nonwake",
    category: "fawkes-mid-sentence",
    text: "The old story of Guy Fawkes is told every November",
  },
  {
    id: "n07",
    group: "nonwake",
    category: "fawkes-mid-sentence",
    text: "Remember the fifth of November, Guy Fawkes and his plot",
  },
  {
    id: "n08",
    group: "nonwake",
    category: "fawkes-mid-sentence",
    text: "He said okay and then Fawkes lit the fuse",
  },
  {
    id: "n09",
    group: "nonwake",
    category: "news",
    text: "The central bank held interest rates steady on Tuesday, citing slower inflation",
  },
  {
    id: "n10",
    group: "nonwake",
    category: "news",
    text: "Heavy rain is expected across the north of the country this weekend",
  },
  {
    id: "n11",
    group: "nonwake",
    category: "bird",
    text: "The phoenix is a bird that rises from its own ashes",
  },
  {
    id: "n12",
    group: "nonwake",
    category: "bird",
    text: "Fawkes the phoenix sings a song of healing",
  },
  { id: "n13", group: "nonwake", category: "command-without-wake", text: "Stop the video" },
  { id: "n14", group: "nonwake", category: "command-without-wake", text: "What is the time" },
  { id: "n15", group: "nonwake", category: "command-without-wake", text: "Git status please" },
  { id: "n16", group: "nonwake", category: "ok-other", text: "OK Google, what is the weather" },
  { id: "n17", group: "nonwake", category: "ok-other", text: "Okay, that sounds good to me" },
  { id: "n18", group: "nonwake", category: "ok-other", text: "OK, fine, let's go" },
  {
    id: "n19",
    group: "nonwake",
    category: "speech-long",
    text: "And so my fellow Americans, ask not what your country can do for you",
  },
  { id: "b01", group: "borderline", category: "borderline", text: "Hey Fowkes, what is the time" },
  { id: "b02", group: "borderline", category: "borderline", text: "OK Fowkes, git status" },
];

const text = (id: string) => FIXTURES.find((f) => f.id === id)!.text;

/** Special clips: overlap and noise. `expectWake` is the label of the whole clip. */
interface SpecialSpec {
  id: string;
  kind: "overlap" | "noise";
  expectWake: boolean;
  parts: { fixture: string; voice: Voice }[];
  snrDb?: number;
  seed?: number;
}
const SPECIALS: SpecialSpec[] = [
  {
    id: "ov1",
    kind: "overlap",
    expectWake: true,
    parts: [
      { fixture: "w01", voice: "Samantha" },
      { fixture: "n10", voice: "Daniel" },
    ],
  },
  {
    id: "ov2",
    kind: "overlap",
    expectWake: true,
    parts: [
      { fixture: "w02", voice: "Karen" },
      { fixture: "n09", voice: "Moira" },
    ],
  },
  {
    id: "ov3",
    kind: "overlap",
    expectWake: false,
    parts: [
      { fixture: "n01", voice: "Rishi" },
      { fixture: "n06", voice: "Samantha" },
    ],
  },
  {
    id: "nz1",
    kind: "noise",
    expectWake: true,
    parts: [{ fixture: "w02", voice: "Karen" }],
    snrDb: NOISE_SNR_DB,
    seed: 66001,
  },
  {
    id: "nz2",
    kind: "noise",
    expectWake: false,
    parts: [{ fixture: "n01", voice: "Moira" }],
    snrDb: NOISE_SNR_DB,
    seed: 66002,
  },
];

// ------------------------------------------------------------------------------------------------
// Text helpers
// ------------------------------------------------------------------------------------------------

/** The comparison form of the scoring rule: lower case, non letters/digits/apostrophes -> space. */
export const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim()
    .replace(/\bo k\b/g, "ok");
const wordsOf = (s: string): string[] => norm(s).split(" ").filter(Boolean);

/** Cause rule: do the first four words of the raw text contain the expected lead + "fawkes"? */
export function hasExpectedLead(raw: string, kind: "wake-ok" | "wake-hey"): boolean {
  const w = wordsOf(raw).slice(0, 4);
  const lead = kind === "wake-hey" ? ["hey", "hi"] : ["ok", "okay"];
  return w.some((x, i) => lead.includes(x) && w[i + 1] === "fawkes");
}

// ------------------------------------------------------------------------------------------------
// The chain: UtteranceGate -> SpeechRecognizer -> matchWake (as VoiceSessions.handle does)
// ------------------------------------------------------------------------------------------------

export interface UtteranceRecord {
  samples: number;
  ms: number;
  reason: string;
  raw: string;
  recogniseMs: number;
  recogniserError: string | null;
  /** matchWake matched while the session was not awake */
  wake: boolean;
  rest: string;
  awakeBefore: boolean;
}
export interface ChainResult {
  vadOpened: boolean;
  speakingAtEnd: boolean;
  utterances: UtteranceRecord[];
  wakeAccepted: boolean;
  awakeOpened: boolean;
  /** the rest of the first accepted wake utterance ("" for the bare phrase), else null */
  command: string | null;
  /** every request the session would have dispatched, in order */
  commands: string[];
  matcherError: string | null;
}

export async function runChain(
  padded: Int16Array,
  recognizer: SpeechRecognizer,
): Promise<ChainResult> {
  const emitted: Utterance[] = [];
  const gate = new UtteranceGate((u) => emitted.push(u), DEFAULT_UTTERANCE_CONFIG);
  let speakingAtEnd = false;
  try {
    for (let i = 0; i < padded.length; i += FRAME_SAMPLES)
      gate.push(padded.slice(i, i + FRAME_SAMPLES));
    speakingAtEnd = gate.speaking;
  } finally {
    gate.stop();
  }
  const result: ChainResult = {
    vadOpened: emitted.length > 0,
    speakingAtEnd,
    utterances: [],
    wakeAccepted: false,
    awakeOpened: false,
    command: null,
    commands: [],
    matcherError: null,
  };
  let awake = false;
  for (const u of emitted) {
    const started = Date.now();
    let raw = "";
    let recogniserError: string | null = null;
    const session = recognizer.start();
    try {
      for (const chunk of u.chunks) session.push(chunk);
      raw = (await session.finish()).text;
    } catch (e) {
      recogniserError = e instanceof Error ? e.message : String(e);
    } finally {
      session.cancel();
    }
    const recogniseMs = Date.now() - started;
    const record: UtteranceRecord = {
      samples: u.samples,
      ms: Math.round(u.samples / 16),
      reason: u.reason,
      raw,
      recogniseMs,
      recogniserError,
      wake: false,
      rest: "",
      awakeBefore: awake,
    };
    wipeUtterance(u);
    let m = { matched: false, rest: "" };
    try {
      m = matchWake(raw);
    } catch (e) {
      result.matcherError = e instanceof Error ? e.message : String(e);
    }
    if (awake) {
      awake = false;
      result.commands.push(m.matched ? m.rest : raw);
    } else if (m.matched) {
      record.wake = true;
      record.rest = m.rest;
      result.wakeAccepted = true;
      result.command ??= m.rest;
      if (m.rest.length === 0) {
        awake = true;
        result.awakeOpened = true;
      } else {
        result.commands.push(m.rest);
      }
    }
    result.utterances.push(record);
  }
  return result;
}

// ------------------------------------------------------------------------------------------------
// Recorded results
// ------------------------------------------------------------------------------------------------

type Kind = "say" | "jfk" | "overlap" | "noise";
type Cause = "vad" | "no-text" | "matcher" | "recognition";

export interface ClipRecord extends ChainResult {
  id: string;
  kind: Kind;
  fixture: string;
  group: Group | "special";
  category: string;
  voice: string;
  reference: string;
  /** null for borderline */
  expectWake: boolean | null;
  expectedCommand: string | null;
  audioSeconds: number;
  paddedSeconds: number;
  commandOk: boolean | null;
  cause: Cause | null;
  fs: {
    created: number;
    changed: number;
    flagged: number;
    foreignFlagged: number;
    flaggedPaths: string[];
  };
}

const clips: ClipRecord[] = [];
const env: Record<string, unknown> = {};
const localDate = new Date().toLocaleDateString("en-CA");

/** Other measurement runs share /tmp on this machine; their audio files are not ours. */
const FOREIGN = /^(\/private)?\/tmp\/phoenix-|\/ssr\/[0-9a-f]{40}$/;

function causeOf(chain: ChainResult, kind: "wake-ok" | "wake-hey"): Cause {
  if (chain.utterances.length === 0) return "vad";
  if (chain.utterances.every((u) => u.raw.trim() === "")) return "no-text";
  if (chain.utterances.some((u) => hasExpectedLead(u.raw, kind))) return "matcher";
  return "recognition";
}

function finishRecord(
  base: Omit<ClipRecord, keyof ChainResult | "commandOk" | "cause" | "fs">,
  chain: ChainResult,
  fsDiff: FsDiff,
  leadKind: "wake-ok" | "wake-hey",
): ClipRecord {
  const flagged = fsDiff.flagged;
  const foreign = flagged.filter((f) => FOREIGN.test(f.path));
  const ownFlagged = flagged.filter((f) => !FOREIGN.test(f.path));
  const cause = base.expectWake === true && !chain.wakeAccepted ? causeOf(chain, leadKind) : null;
  return {
    ...base,
    ...chain,
    commandOk:
      base.expectWake === true && chain.wakeAccepted && base.expectedCommand !== null
        ? norm(chain.command ?? "") === norm(base.expectedCommand)
        : null,
    cause,
    fs: {
      created: fsDiff.created.length,
      changed: fsDiff.changed.length,
      flagged: ownFlagged.length,
      foreignFlagged: foreign.length,
      flaggedPaths: flagged.map((f) => f.path),
    },
  };
}

// ------------------------------------------------------------------------------------------------
// Rendering (say -> afconvert 16 kHz mono LEI16 -> Int16 PCM)
// ------------------------------------------------------------------------------------------------

const pcmCache = new Map<string, Int16Array>();

async function renderSay(workDir: string, fixture: Fixture, voice: Voice): Promise<Int16Array> {
  const key = `${fixture.id}|${voice}`;
  const hit = pcmCache.get(key);
  if (hit) return hit;
  const aiff = join(workDir, `${fixture.id}-${voice}.aiff`);
  const wav = join(workDir, `${fixture.id}-${voice}.wav`);
  await run("say", ["-v", voice, "-o", aiff, fixture.text]);
  await run("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
  const decoded = decodeWav(new Uint8Array(await readFile(wav)));
  expect([decoded.sampleRate, decoded.channels, decoded.bits]).toEqual([16_000, 1, 16]);
  pcmCache.set(key, decoded.samples);
  return decoded.samples;
}

/** Digital silence before and after, so the VAD hangover can end the utterance. */
export function pad(pcm: Int16Array): Int16Array {
  const lead = (LEAD_SILENCE_MS * 16) | 0;
  const tail = (TAIL_SILENCE_MS * 16) | 0;
  const out = new Int16Array(lead + pcm.length + tail);
  out.set(pcm, lead);
  return out;
}

// ------------------------------------------------------------------------------------------------
// Summary (computed once; used by the report and the raw JSON)
// ------------------------------------------------------------------------------------------------

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const count = (list: ClipRecord[], pred: (c: ClipRecord) => boolean) => list.filter(pred).length;
const sayClips = () => clips.filter((c) => c.kind === "say");

function summarise() {
  const say = sayClips();
  const wakeOk = say.filter((c) => c.group === "wake-ok");
  const wakeHey = say.filter((c) => c.group === "wake-hey");
  const wakeAll = [...wakeOk, ...wakeHey];
  const non = say.filter((c) => c.group === "nonwake");
  const border = say.filter((c) => c.group === "borderline");
  const jfk = clips.filter((c) => c.kind === "jfk");
  const rej = (l: ClipRecord[]) =>
    wilson(
      count(l, (c) => !c.wakeAccepted),
      l.length,
    );
  const acc = (l: ClipRecord[]) =>
    wilson(
      count(l, (c) => c.wakeAccepted),
      l.length,
    );
  const byVoiceWake = VOICES.map((v) => ({
    voice: v,
    ok: rej(wakeOk.filter((c) => c.voice === v)),
    hey: rej(wakeHey.filter((c) => c.voice === v)),
    all: rej(wakeAll.filter((c) => c.voice === v)),
    nonwakeAccept: acc(non.filter((c) => c.voice === v)),
    borderlineAccept: acc(border.filter((c) => c.voice === v)),
  }));
  const categories = [...new Set(non.map((c) => c.category))];
  const byCategory = categories.map((cat) => ({
    category: cat,
    accept: acc(non.filter((c) => c.category === cat)),
  }));
  const wakeAccepted = wakeAll.filter((c) => c.wakeAccepted);
  const commandChecked = wakeAccepted.filter((c) => c.commandOk !== null);
  const causes: Record<string, number> = {};
  for (const c of wakeAll) if (c.cause) causes[c.cause] = (causes[c.cause] ?? 0) + 1;
  const causesOk: Record<string, number> = {};
  for (const c of wakeOk) if (c.cause) causesOk[c.cause] = (causesOk[c.cause] ?? 0) + 1;
  return {
    clipsTotal: clips.length,
    sayClips: say.length,
    wakeOkFalseReject: rej(wakeOk),
    wakeHeyFalseReject: rej(wakeHey),
    wakePooledFalseReject: rej(wakeAll),
    nonwakeFalseAccept: acc(non),
    jfkFalseAccept: acc(jfk),
    borderlineAccept: acc(border),
    byVoiceWake,
    byCategory,
    vadMisses: wilson(
      count(clips, (c) => !c.vadOpened),
      clips.length,
    ),
    vadMissIds: clips.filter((c) => !c.vadOpened).map((c) => c.id),
    speakingAtEnd: clips.filter((c) => c.speakingAtEnd).map((c) => c.id),
    commandExact: wilson(
      count(commandChecked, (c) => c.commandOk === true),
      commandChecked.length,
    ),
    causesAllWake: causes,
    causesWakeOk: causesOk,
    falseAcceptsWithCommand: non
      .concat(jfk)
      .filter((c) => c.commands.length > 0)
      .map((c) => c.id),
    flaggedFiles: clips.filter((c) => c.fs.flagged > 0).map((c) => c.id),
    foreignFlaggedClips: clips.filter((c) => c.fs.foreignFlagged > 0).length,
    meanRecogniseMs: Math.round(
      clips.flatMap((c) => c.utterances).reduce((n, u) => n + u.recogniseMs, 0) /
        Math.max(1, clips.flatMap((c) => c.utterances).length),
    ),
  };
}

// ------------------------------------------------------------------------------------------------
// Report
// ------------------------------------------------------------------------------------------------

const fence = (s: string) => "```\n" + s + "\n```";
const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
const q = (s: string) => cell(JSON.stringify(s));
const rawOf = (c: ClipRecord) =>
  c.utterances.length === 0
    ? "(no utterance)"
    : c.utterances.map((u) => JSON.stringify(u.raw)).join(" + ");

function renderReport(): string {
  const s = summarise();
  const out: string[] = [];
  const cmd = `PHOENIX_REAL_DICTATION=1 PHOENIX_REAL_WHISPER_MODEL=${MODEL_PATH} /Users/bluephoenix/.nvm/versions/node/v22.19.0/bin/node ./node_modules/vitest/vitest.mjs run ai/multimodal/test/real-wake.test.ts --testTimeout=60000`;
  out.push(
    "# Phase 66 real wake measurement",
    "",
    `Generated by \`ai/multimodal/test/real-wake.test.ts\` on ${localDate}; do not edit by hand. Raw data: \`phase-66-real-wake-${localDate}-raw.json\`. The fixture list and the scoring rule are in the header of that file and were written before the first run.`,
    "",
    "**What this is.** One run of the real wake chain (`UtteranceGate` with the default energy-VAD configuration, then the real `WhisperStdinRecognizer` with the real `whisper-cli` and the English-only tiny model, then `matchWake`) over spoken fixtures. **What it is not.** Every voice except the single jfk.wav clip is a macOS `say` system voice: **synthetic speech, not a person**. No live microphone, no speaker echo of Fawkes's own voice, English only, clean quiet clips except two with synthetic noise, one machine, one run. Rates carry Wilson 95% intervals and are not thresholds. The exit criterion 'wake detection quality measured on real speech' stays **unmet**.",
    "",
    "## Setup",
    "",
    `- Command: \`${cmd}\``,
  );
  for (const [k, v] of Object.entries(env))
    out.push(`- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  out.push(
    "",
    "## Result tables (Wilson 95% intervals; k/n = rate [low, high])",
    "",
    "| measure | result |",
    "|---|---|",
    `| clips run | ${s.clipsTotal} (${s.sayClips} say-voice clips, plus jfk, overlap and noise clips) |`,
    `| VAD gate never opened (all ${s.clipsTotal} clips contain speech) | ${fmtInterval(s.vadMisses)}${s.vadMissIds.length ? ` ids: ${s.vadMissIds.join(", ")}` : ""} |`,
    `| wake FALSE REJECT, "OK Fawkes" fixtures (documented phrase) | ${fmtInterval(s.wakeOkFalseReject)} |`,
    `| wake FALSE REJECT, "Hey/Hi Fawkes" fixtures (not a documented form) | ${fmtInterval(s.wakeHeyFalseReject)} |`,
    `| wake FALSE REJECT, both pooled | ${fmtInterval(s.wakePooledFalseReject)} |`,
    `| FALSE ACCEPT, non-wake say clips (all categories) | ${fmtInterval(s.nonwakeFalseAccept)} |`,
    `| FALSE ACCEPT, jfk.wav (long non-wake recording of a person) | ${fmtInterval(s.jfkFalseAccept)} |`,
    `| BORDERLINE accepted (b01 "Hey Fowkes", b02 "OK Fowkes"; reported separately, not an error) | ${fmtInterval(s.borderlineAccept)} |`,
    `| accepted wake whose command text equals the expected command (normalised) | ${fmtInterval(s.commandExact)} |`,
    `| clips whose gate was still speaking at the end | ${s.speakingAtEnd.length ? s.speakingAtEnd.join(", ") : "none"} |`,
    `| false accepts that went on to produce a command | ${s.falseAcceptsWithCommand.length ? s.falseAcceptsWithCommand.join(", ") : "none"} |`,
    `| mean recognition time per utterance | ${s.meanRecogniseMs} ms |`,
    "",
    `Causes of wake false rejects (rule in the file header; raw text of every miss below): all wake clips ${JSON.stringify(s.causesAllWake)}; "OK Fawkes" clips only ${JSON.stringify(s.causesWakeOk)}.`,
    "",
    "### By voice (false reject = wake clip not accepted; false accept = non-wake clip accepted)",
    "",
    "| voice | false reject, OK Fawkes | false reject, Hey/Hi Fawkes | false reject, both | false accept, non-wake | borderline accepted |",
    "|---|---|---|---|---|---|",
  );
  for (const v of s.byVoiceWake)
    out.push(
      `| ${v.voice} | ${fmtInterval(v.ok)} | ${fmtInterval(v.hey)} | ${fmtInterval(v.all)} | ${fmtInterval(v.nonwakeAccept)} | ${fmtInterval(v.borderlineAccept)} |`,
    );
  out.push(
    "",
    "### False accepts by category (non-wake say clips)",
    "",
    "| category | false accept |",
    "|---|---|",
  );
  for (const c of s.byCategory) out.push(`| ${c.category} | ${fmtInterval(c.accept)} |`);
  const isMiss = (c: ClipRecord) => c.expectWake === true && !c.wakeAccepted;
  const isFalseAccept = (c: ClipRecord) => c.expectWake === false && c.wakeAccepted;
  const misses = clips.filter(isMiss);
  out.push(
    "",
    `## Every wake miss with the recogniser's raw text (${misses.length} clips)`,
    "",
    "| clip | fixture | voice | kind | reference | raw recogniser text | gate opened | cause |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const c of misses)
    out.push(
      `| ${c.id} | ${c.group} | ${c.voice} | ${c.kind} | ${q(c.reference)} | ${cell(rawOf(c))} | ${c.vadOpened} | ${c.cause} |`,
    );
  const fas = clips.filter(isFalseAccept);
  out.push(
    "",
    `## Every false accept with the raw text and the command it produced (${fas.length} clips)`,
    "",
    "| clip | category | voice | kind | reference | raw recogniser text | command |",
    "|---|---|---|---|---|---|---|",
  );
  for (const c of fas)
    out.push(
      `| ${c.id} | ${c.category} | ${c.voice} | ${c.kind} | ${q(c.reference)} | ${cell(rawOf(c))} | ${q(c.commands.join(" / "))} |`,
    );
  const bl = clips.filter((c) => c.group === "borderline");
  out.push(
    "",
    "## Borderline clips (reported separately)",
    "",
    "| clip | voice | reference | raw recogniser text | wake accepted | command |",
    "|---|---|---|---|---|---|",
  );
  for (const c of bl)
    out.push(
      `| ${c.id} | ${c.voice} | ${q(c.reference)} | ${cell(rawOf(c))} | ${c.wakeAccepted} | ${q(c.command ?? "")} |`,
    );
  const sp = clips.filter((c) => c.kind === "overlap" || c.kind === "noise");
  out.push(
    "",
    "## Overlap and noise clips (reported separately, n too small for rates)",
    "",
    "| clip | kind | parts | expected | raw recogniser text | gate opened | wake accepted | command |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const c of sp)
    out.push(
      `| ${c.id} | ${c.kind} | ${cell(c.voice)} | ${c.expectWake ? "wake" : "non-wake"} | ${cell(rawOf(c))} | ${c.vadOpened} | ${c.wakeAccepted} | ${q(c.command ?? "")} |`,
    );
  out.push(
    "",
    "## Command extraction for accepted wake clips that did NOT match the expected command",
    "",
    "| clip | voice | expected | extracted | raw |",
    "|---|---|---|---|---|",
  );
  for (const c of clips.filter((x) => x.commandOk === false))
    out.push(
      `| ${c.id} | ${c.voice} | ${q(c.expectedCommand ?? "")} | ${q(c.command ?? "")} | ${cell(rawOf(c))} |`,
    );
  out.push(
    "",
    "## Every clip (raw recogniser text, gate, wake, command)",
    "",
    "| clip | fixture | voice | expect | audio s | utterances (ms) | raw recogniser text | wake | command |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const c of clips)
    out.push(
      `| ${c.id} | ${c.group}/${c.category} | ${cell(c.voice)} | ${c.expectWake === null ? "borderline" : c.expectWake ? "wake" : "non-wake"} | ${c.audioSeconds.toFixed(2)} | ${c.utterances.map((u) => u.ms).join("+") || "none"} | ${cell(rawOf(c))} | ${c.wakeAccepted} | ${q(c.command ?? "")} |`,
    );
  out.push(
    "",
    "## Filesystem observation (one run, one machine; not proof)",
    "",
    "Before and after each clip the OS temp dir, `/tmp`, `/var/tmp`, the cwd, and the Phoenix data directories were listed (name, size, mtime). Flag rule: a new regular file whose first bytes are `RIFF` or whose size is within 10% of the clip's audio size. Files under `/tmp/phoenix-*` are other measurement runs sharing this machine and are counted as foreign, not attributed to this chain; the synthesis work dir of this run is `/tmp/pwake-*` and is NOT excluded.",
    "",
    `- Clips with a flagged file attributable to this run: ${s.flaggedFiles.length ? s.flaggedFiles.join(", ") : "none"}`,
    `- Clips during which a foreign /tmp/phoenix-* audio-like file appeared: ${s.foreignFlaggedClips}`,
  );
  const bad = clips.filter((c) => c.fs.flagged > 0);
  if (bad.length)
    out.push(fence(bad.map((c) => `${c.id}: ${c.fs.flaggedPaths.join(", ")}`).join("\n")));
  return out.join("\n") + "\n";
}

afterAll(() => {
  if (!GATED || clips.length === 0) return;
  const dir = fileURLToPath(new URL("../../../docs/evidence/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  const base = `${dir}phase-66-real-wake-${localDate}`;
  writeFileSync(`${base}.md`, renderReport());
  writeFileSync(`${base}-raw.json`, JSON.stringify({ env, summary: summarise(), clips }, null, 2));
});

// ------------------------------------------------------------------------------------------------
// Gated measurement
// ------------------------------------------------------------------------------------------------

const whisperPids = async (): Promise<number> => {
  const out = await run("pgrep", ["-x", "whisper-cli"]).catch(() => "");
  return out.split("\n").filter((l) => /^\d+$/.test(l.trim())).length;
};

describe.skipIf(!GATED)(
  "Phase 66 real wake chain (VAD gate + whisper-cli + matchWake, synthetic voices and one recording)",
  { timeout: 1_800_000 },
  () => {
    let workDir = "";
    let roots: Root[] = [];
    let recognizer: WhisperStdinRecognizer;
    let pidsBefore = 0;
    let pidsAfter = 0;

    beforeAll(async () => {
      expect(MODEL_PATH, "set PHOENIX_REAL_WHISPER_MODEL to a ggml model file").not.toBe("");
      workDir = await mkdtemp("/tmp/pwake-");
      roots = await watchedRoots();
      recognizer = new WhisperStdinRecognizer({ modelPath: MODEL_PATH });
      const sha1 = await new Promise<string>((resolve, reject) => {
        const h = createHash("sha1");
        createReadStream(MODEL_PATH)
          .on("data", (c) => h.update(c))
          .on("end", () => resolve(h.digest("hex")))
          .on("error", reject);
      });
      const soft = (fn: () => Promise<string>) =>
        fn().then(
          (x) => x.trim(),
          (e: unknown) =>
            `(unavailable: ${e instanceof Error ? e.message.slice(0, 200) : String(e)})`,
        );
      env["Date"] = localDate;
      env["Node"] = process.version;
      env["Platform"] =
        `${process.platform}/${process.arch}; macOS ${await soft(() => run("sw_vers", ["-productVersion"]))}`;
      env["whisper-cli path"] = await soft(() => run("/usr/bin/which", ["whisper-cli"]));
      env["whisper.cpp / ggml (brew list --versions)"] = await soft(() =>
        run("brew", ["list", "--versions", "whisper-cpp", "ggml"]),
      );
      env["Model path"] = MODEL_PATH;
      env["Model size (bytes)"] = (await stat(MODEL_PATH)).size;
      env["Model sha1"] = sha1;
      env["Model sha1 equals the one recorded when downloaded"] = sha1 === EXPECTED_MODEL_SHA1;
      env["say voices used"] = await soft(() => run("say", ["-v", "?"])).then((all) =>
        all
          .split("\n")
          .filter((l) => VOICES.some((v) => l.startsWith(v)))
          .map((l) => l.replace(/\s+/g, " ").replace(/\s*#.*$/, ""))
          .join(" | "),
      );
      env["UtteranceConfig (DEFAULT_UTTERANCE_CONFIG)"] = DEFAULT_UTTERANCE_CONFIG;
      env["Frame size (samples)"] = FRAME_SAMPLES;
      env["Silence before / after the voice (ms)"] = `${LEAD_SILENCE_MS} / ${TAIL_SILENCE_MS}`;
      env["Synthesis dir (deleted afterwards)"] = workDir;
      env["Watched roots"] = roots.map((r) => `${r.label} = ${r.path} (depth ${r.depth})`);
      pidsBefore = await whisperPids();
      env["whisper-cli processes running before the run"] = pidsBefore;
    });

    afterAll(async () => {
      pidsAfter = await whisperPids();
      env["whisper-cli processes running after the run"] = pidsAfter;
      if (workDir) await rm(workDir, { recursive: true, force: true });
    });

    /** Run the chain on one padded clip, observing the filesystem around it. */
    const measure = async (
      padded: Int16Array,
      base: Omit<ClipRecord, keyof ChainResult | "commandOk" | "cause" | "fs">,
      leadKind: "wake-ok" | "wake-hey",
    ) => {
      const before = await snapshot(roots);
      const chain = await runChain(padded, recognizer);
      const after = await snapshot(roots);
      const diff = await diffSnapshots(before, after, padded.length * 2);
      clips.push(finishRecord(base, chain, diff, leadKind));
    };

    it("renders every fixture and runs the real chain on every clip", async () => {
      const availability = await recognizer.availability();
      expect(availability.available, availability.detail).toBe(true);

      // 1. say voices x fixtures
      for (const f of FIXTURES) {
        for (const voice of VOICES) {
          const pcm = await renderSay(workDir, f, voice);
          await measure(
            pad(pcm),
            {
              id: `${f.id}-${voice}`,
              kind: "say",
              fixture: f.id,
              group: f.group,
              category: f.category,
              voice,
              reference: f.text,
              expectWake: f.group === "borderline" ? null : f.group !== "nonwake",
              expectedCommand: f.command ?? null,
              audioSeconds: pcm.length / 16_000,
              paddedSeconds: (pcm.length + (LEAD_SILENCE_MS + TAIL_SILENCE_MS) * 16) / 16_000,
            },
            f.group === "wake-hey" ? "wake-hey" : "wake-ok",
          );
        }
      }

      // 2. the real recording
      const jfk = decodeWav(new Uint8Array(await readFile(JFK_PATH)));
      expect([jfk.sampleRate, jfk.channels, jfk.bits]).toEqual([16_000, 1, 16]);
      await measure(
        pad(jfk.samples),
        {
          id: "jfk",
          kind: "jfk",
          fixture: "jfk",
          group: "nonwake",
          category: "speech-long",
          voice: "(recording of a person)",
          reference: "whisper.cpp jfk.wav",
          expectWake: false,
          expectedCommand: null,
          audioSeconds: jfk.samples.length / 16_000,
          paddedSeconds: (jfk.samples.length + (LEAD_SILENCE_MS + TAIL_SILENCE_MS) * 16) / 16_000,
        },
        "wake-ok",
      );

      // 3. overlap and noise
      for (const sp of SPECIALS) {
        const parts = await Promise.all(
          sp.parts.map((p) =>
            renderSay(
              workDir,
              FIXTURES.find((f) => f.id === p.fixture)!,
              p.voice,
            ),
          ),
        );
        let voicePcm = parts.reduce((a, b) => mixPcm(a, b));
        const signalRms = rmsOf(voicePcm);
        let padded = pad(voicePcm);
        if (sp.kind === "noise") {
          const noise = pinkishNoise(padded.length, noiseRmsForSnr(signalRms, sp.snrDb!), sp.seed!);
          padded = addNoise(padded, noise);
        }
        await measure(
          padded,
          {
            id: sp.id,
            kind: sp.kind,
            fixture: sp.parts.map((p) => p.fixture).join("+"),
            group: "special",
            category: sp.kind,
            voice: sp.parts.map((p) => p.voice).join("+"),
            reference: sp.parts.map((p) => text(p.fixture)).join("  //  "),
            expectWake: sp.expectWake,
            expectedCommand: null,
            audioSeconds: voicePcm.length / 16_000,
            paddedSeconds: padded.length / 16_000,
          },
          "wake-ok",
        );
        voicePcm = new Int16Array(0);
      }
      expect(clips.length).toBe(191);
    });

    it("holds the structural properties on the recorded clips (no rate is asserted)", () => {
      expect(clips.length).toBeGreaterThanOrEqual(100);
      for (const c of clips) {
        expect(c.matcherError, `${c.id}: matchWake threw`).toBeNull();
        for (const u of c.utterances) expect(typeof u.raw).toBe("string");
        // a non-wake clip never yields a command through the chain as the session runs it
        if (!c.wakeAccepted) expect(c.commands, `${c.id}: command without a wake`).toEqual([]);
        // no audio-like file attributable to this chain
        expect(c.fs.flagged, `${c.id}: ${c.fs.flaggedPaths.join(", ")}`).toBe(0);
      }
    });

    it("never yields a command from a non-wake clip, without any rate assertion on the matcher", () => {
      // Recorded finding, not asserted away: any non-wake clip that was wake-accepted is listed in
      // the report. The structural claim here is only that a command requires an accepted wake.
      const commandsWithoutWake = clips.filter((c) => c.commands.length > 0 && !c.wakeAccepted);
      expect(commandsWithoutWake).toEqual([]);
    });

    it("leaves no whisper-cli process of this run behind (recorded; other runs may own some)", async () => {
      const after = await whisperPids();
      env["whisper-cli processes running right after the clips"] = after;
      expect(Number.isInteger(after)).toBe(true);
    });
  },
);

// ------------------------------------------------------------------------------------------------
// Ungated checks of the helpers themselves (no binary, no model)
// ------------------------------------------------------------------------------------------------

describe("real-wake helpers", () => {
  it("normalises text for comparison", () => {
    expect(norm("OK, Fawkes: git status!")).toBe("ok fawkes git status");
    expect(norm("O.K. Fawkes")).toBe("ok fawkes");
    expect(wordsOf("  Let's go ")).toEqual(["let's", "go"]);
  });

  it("decides the cause rule's lead test", () => {
    expect(hasExpectedLead("Okay, Fawkes, deny.", "wake-ok")).toBe(true);
    expect(hasExpectedLead("Hey Fawkes what", "wake-hey")).toBe(true);
    expect(hasExpectedLead("Hey Fawkes what", "wake-ok")).toBe(false);
    expect(hasExpectedLead("one two three four ok fawkes", "wake-ok")).toBe(false);
  });

  it("pads, mixes and generates noise deterministically at the requested RMS", () => {
    const p = pad(new Int16Array(160).fill(100));
    expect(p.length).toBe(16_000 + 160 + 24_000);
    expect(p[16_000]).toBe(100);
    expect(p[0]).toBe(0);
    expect(Array.from(mixPcm(Int16Array.of(100, 200), Int16Array.of(300)))).toEqual([200, 100]);
    const a = pinkishNoise(8_000, 500, 7);
    const b = pinkishNoise(8_000, 500, 7);
    expect(Array.from(a.slice(0, 5))).toEqual(Array.from(b.slice(0, 5)));
    const asPcm = Int16Array.from(a, (x) => Math.round(x));
    expect(Math.abs(rmsOf(asPcm) - 500)).toBeLessThan(2);
    expect(Math.abs(noiseRmsForSnr(1000, 20) - 100)).toBeLessThan(1e-9);
  });

  it("computes Wilson 95% intervals", () => {
    const w = wilson(0, 10);
    expect(w.low).toBe(0);
    expect(w.high!).toBeCloseTo(0.2775, 3);
    const m = wilson(5, 10);
    expect(m.low!).toBeCloseTo(0.2366, 3);
    expect(m.high!).toBeCloseTo(0.7634, 3);
    expect(wilson(0, 0).rate).toBeNull();
  });

  it("runs the chain with a fake recogniser: wake with a rest, bare wake then request, no wake", async () => {
    const say = (words: string): Int16Array => {
      const loud = new Int16Array(16_000).fill(6_000);
      return pad(loud.map((x, i) => (i % 2 === 0 ? x : -x)));
    };
    const fake = (texts: string[]): SpeechRecognizer => {
      let i = 0;
      return {
        availability: async () => ({ available: true, engine: "fake", detail: "" }),
        start: () => ({
          push: () => {},
          cancel: () => {},
          finish: async () => ({ text: texts[i++] ?? "" }),
        }),
      };
    };
    const a = await runChain(say("x"), fake(["OK Fawkes, git status"]));
    expect([a.vadOpened, a.wakeAccepted, a.command]).toEqual([true, true, "git status"]);
    const b = await runChain(say("x"), fake(["Okay Fawkes."]));
    expect([b.wakeAccepted, b.awakeOpened, b.command, b.commands]).toEqual([true, true, "", []]);
    const c = await runChain(say("x"), fake(["ok folks"]));
    expect([c.vadOpened, c.wakeAccepted, c.command, c.commands]).toEqual([true, false, null, []]);
    const silent = await runChain(new Int16Array(48_000), fake(["OK Fawkes"]));
    expect([silent.vadOpened, silent.utterances.length]).toEqual([false, 0]);
  });
});
