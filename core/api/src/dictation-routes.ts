// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// DICTATION PROTOCOL (Phase 64): what the web page and the desktop shell speak to Phoenix Core.
//
// Everything is behind the session token. None of it is a capability command or an agent tool.
// Dictation is OFF until the user turns it on (POST /api/dictation/settings {enabled:true}); while
// it is off, or while the emergency stop is engaged, every call below is refused.
//
// Privacy contract:
//   * Audio is never written to disk by Core: PCM lives in Core's memory for the length of one
//     session, is handed to the speech recogniser in memory, and is zeroed when the session ends
//     for ANY reason. The recogniser is on this device; there is no cloud speech path.
//     ONE exception, only when the owner opts in to Parakeet (PHOENIX_SPEECH_ENGINES lists it and
//     PHOENIX_PARAKEET_MODEL_DIR is set): sherpa-onnx-offline reads only WAV files, so that engine
//     writes a private (0700 directory, 0600 file) temporary file for the recognition and erases it on
//     every path. `audio_on_disk` is true exactly while that engine is the active one.
//   * Optional AI clean-up is local-only by construction (privacy "sensitive", a purpose that is not
//     in SENSITIVE_CLOUD_PURPOSES) and falls back to the text as recognised.
//   * Core stores only aggregate counts (day, app id, words, speech ms, sessions). Never text or audio.
//   * Events carry no text and no app id: `dictation.listening` / `dictation.idle`, payload
//     { session }. Fawkes shows LISTENING in every view from `dictation.listening` until
//     `dictation.idle`, i.e. for the whole time audio can arrive. The audit log gets start / finish /
//     abort with ids, word counts and reasons - no text.
//
// Sequence (desktop hold-to-talk, hands-free, Esc and paste are the desktop's own work):
//   1. POST   /api/dictation/sessions            {app?: string}   -> {id, max_seconds, max_bytes, max_frame_bytes}
//        `app` is the focused app's bundle id / executable name ([A-Za-z0-9][A-Za-z0-9._-]{0,99}); it picks
//        the clean-up mode and the statistics row. Refusals: 400 bad app, 400 "already in progress" (one
//        session at a time), 400 too many starts (30 per minute), 409 dictation off or emergency stop
//        engaged, 503 no recogniser.
//   2. WS     /api/dictation/stream?session=<id>                    (single use)
//        Upgrade must carry: Host = a loopback name, Origin = http://<Host> (same origin), the token as
//        the sub-protocols `phoenix.v1` + `phoenix.token.<token>`, no cookie, exactly the one query
//        parameter `session`. A used, unknown or ended session is refused before the upgrade (404 / 409).
//        Server -> client JSON text frames:
//          {"type":"ready"}                      you may send audio now
//          {"type":"audio_ended"}                answer to {"type":"end"}; now call finish
//          {"type":"ended","reason":"..."}       the session is over (limit, kill switch, disabled, closed...)
//          {"type":"error","error":"..."}        a frame was refused; the session is discarded; the socket closes
//        Client -> server:
//          binary frame: 16 kHz, mono, signed 16-bit little-endian PCM, 2..65536 bytes (even length). Audio
//                        may not arrive faster than twice real time; a session holds at most 120 s / 3,840,000 bytes.
//          text frame {"type":"end"}: no more audio (wait for audio_ended before step 3; a frame sent after
//                        `end` is dropped).
//        Closing the socket before `end` cancels the session and zeroes the audio.
//   3. POST   /api/dictation/sessions/:id/finish -> {text, words, steps}
//        Runs recognition and the text pipeline (normalise, dictionary, replacements, snippets, optional clean-up).
//        `steps` holds counts and flags only. The desktop pastes `text`; Core keeps no copy.
//   4. DELETE /api/dictation/sessions/:id        cancel (Esc). Idempotent for a session that already ended.
//
// Other routes:
//   GET    /api/dictation/status    enabled, recogniser availability, limits, AI clean-up availability
//   GET    /api/dictation/settings  POST /api/dictation/settings {enabled?, typing_wpm?, default_mode?, app_modes?, vocabulary?}
//   GET    /api/dictation/stats     aggregates + words, time saved, average WPM, streak, top apps
//   DELETE /api/dictation/stats     delete every statistics row ("delete all dictation statistics")
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";
import type { CoreServices } from "./services";

export type DictationCleanupMode = "as_said" | "natural" | "polished";

export interface DictationVocabularyView {
  dictionary: { term: string; sounds_like?: string }[];
  replacements: { from: string; to: string }[];
  snippets: { trigger: string; text: string }[];
}

export interface DictationSettingsView {
  enabled: boolean;
  typing_wpm: number;
  default_mode: DictationCleanupMode;
  app_modes: Record<string, DictationCleanupMode>;
  vocabulary: DictationVocabularyView;
}

export interface DictationStatusView {
  enabled: boolean;
  kill_switch_engaged: boolean;
  recognizer: {
    available: boolean;
    detail: string;
    engine?: string;
    /** The engines the owner opted in to, in order, and which one runs the next session. */
    engines?: { id: string; available: boolean; active: boolean; detail: string }[];
  };
  /** True only while an owner-chosen engine (Parakeet) is the active one: it writes a private temporary WAV file for the recognition and erases it straight after. */
  audio_on_disk: boolean;
  /** Whether AI clean-up can run now. It is always local-only. */
  cleanup: { available: boolean; detail: string; locality: "local" };
  active: { id: string; phase: "listening" | "recognising" } | null;
  limits: { max_seconds: number; max_bytes: number; max_frame_bytes: number };
  /** The limits the vocabulary editor enforces (Core validates them again on save). */
  vocabulary_limits: {
    dictionary: number;
    replacements: number;
    snippets: number;
    phrase_words: number;
    phrase_chars: number;
    term_chars: number;
    replacement_chars: number;
    snippet_chars: number;
    app_modes: number;
  };
}

export interface DictationStatsView {
  words: number;
  sessions: number;
  speech_ms: number;
  typing_ms: number;
  saved_ms: number;
  typing_wpm: number;
  average_wpm: number;
  streak_days: number;
  top_apps: { app: string; words: number; sessions: number }[];
}

export interface DictationStartedView {
  id: string;
  max_seconds: number;
  max_bytes: number;
  max_frame_bytes: number;
}

export interface DictationResultView {
  text: string;
  words: number;
  steps: {
    dictionary: number;
    replacements: number;
    snippet: boolean;
    cleanup: "used" | "off" | "skipped";
  };
}

/** One audio stream of one session (single use). */
export interface DictationStreamHandle {
  push(frame: Uint8Array): void;
  end(): void;
  closed(): void;
}

/** Dictation as the API sees it. Errors are PhoenixErrors. */
export interface DictationApi {
  status(): Promise<DictationStatusView>;
  settings(): DictationSettingsView;
  setSettings(patch: unknown): DictationSettingsView;
  start(app: string | undefined): Promise<DictationStartedView>;
  finish(id: string): Promise<DictationResultView>;
  cancel(id: string): void;
  stats(): DictationStatsView;
  deleteStats(): { deleted: number };
  /** True when the session exists, takes audio and no stream was opened for it yet. */
  streamAvailable(id: string): boolean;
  openStream(id: string, onEnded: (reason: string) => void): DictationStreamHandle;
}

export function dictationRoutes(s: CoreServices): Route[] {
  const dictation = () => {
    if (!s.dictation)
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Dictation is unavailable");
    return s.dictation;
  };
  return [
    route("GET", "/api/dictation/status", () => dictation().status()),
    route("GET", "/api/dictation/settings", () => dictation().settings()),
    route("POST", "/api/dictation/settings", async ({ body }) =>
      dictation().setSettings(expectObject(await body())),
    ),
    route("POST", "/api/dictation/sessions", async ({ body }) => {
      const input = expectObject(await body());
      for (const key of Object.keys(input))
        if (key !== "app")
          throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Only `app` is accepted");
      if (input.app !== undefined && typeof input.app !== "string")
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, "`app` must be text");
      return dictation().start(input.app as string | undefined);
    }),
    route("POST", "/api/dictation/sessions/:id/finish", async ({ params, body }) => {
      // The body is not read for meaning: nothing but the session id selects what is finished.
      await body();
      return dictation().finish(params.id!);
    }),
    route("DELETE", "/api/dictation/sessions/:id", ({ params }) => {
      dictation().cancel(params.id!);
      return { cancelled: true };
    }),
    route("GET", "/api/dictation/stats", () => dictation().stats()),
    route("DELETE", "/api/dictation/stats", () => dictation().deleteStats()),
  ];
}
