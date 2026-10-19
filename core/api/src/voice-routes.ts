// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// VOICE PROTOCOL (Phase 66, "OK Fawkes"): what the web page speaks to Phoenix Core.
//
// Everything is behind the session token. None of it is a capability command or an agent tool.
// The assistant is OFF until the user turns it on (POST /api/voice/settings {enabled:true}); while
// it is off, or while the emergency stop is engaged, every call below is refused.
//
// Privacy contract:
//   * Audio is never written to disk by Core and Core produces no audio. PCM lives in Core's memory
//     in a short pre-roll ring and, once an energy gate hears speech, in one utterance that goes to
//     the on-device recogniser. Everything is zeroed when the session ends for ANY reason.
//   * The page speaks Core's reply text with the browser's own speech synthesis.
//   * Voice never approves anything: it may deny waiting confirmations ("deny"), nothing else.
//   * The audit log gets voice.start / voice.wake / voice.request / voice.action / voice.stop with
//     ids, intent kinds, tool names and outcomes. Never the transcript, never audio.
//   * Events carry no text: `voice.listening` (the awake window; Fawkes shows LISTENING) and
//     `voice.idle`, payload { session }.
//
// Sequence:
//   1. POST   /api/voice/sessions            {}  -> {id}
//        Refusals: 409 off or emergency stop, 400 already listening / too many starts, 503 no recogniser.
//   2. WS     /api/voice/stream?session=<id>                    (single use; open it within 15 s)
//        Same upgrade rules as the dictation stream (loopback Host, same-origin Origin, token as the
//        sub-protocols `phoenix.v1` + `phoenix.token.<token>`, no cookie, exactly one query
//        parameter `session`). Server -> client JSON text frames:
//          {"type":"ready"}
//          {"type":"state","state":"waiting|awake|thinking"}
//          {"type":"reply","text":"...","outcome":"ok|refused|unavailable|failed|denied",
//             "intent":"...","action"?:{"type":"switch_pill"}|{"type":"mailto","url":"mailto:..."}}
//          {"type":"ended","reason":"..."}      (sent by the socket) the session is over (stop, kill switch, disabled, ...)
//          {"type":"error","error":"..."}       a frame was refused; the session is discarded
//        Client -> server: binary frames only, 16 kHz mono signed 16-bit little-endian PCM, 2..65536
//        bytes, no faster than twice real time. There is no text message a client can send.
//   3. DELETE /api/voice/sessions/:id        stop. Idempotent.
//
// Other routes:
//   GET  /api/voice/status    enabled, recogniser availability, kill switch, active session, limits
//   GET  /api/voice/settings  POST /api/voice/settings {enabled}
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";
import type { CoreServices } from "./services";

export interface VoiceSettingsView {
  enabled: boolean;
}

export interface VoiceStatusView {
  enabled: boolean;
  kill_switch_engaged: boolean;
  recognizer: { available: boolean; detail: string; engine?: string };
  audio_on_disk: false;
  active: { id: string; phase: "waiting" | "awake" | "thinking" } | null;
  limits: { max_frame_bytes: number; awake_window_ms: number };
}

export interface VoiceStartedView {
  id: string;
}

export type VoiceStreamMessageView =
  | { type: "state"; state: "waiting" | "awake" | "thinking" }
  | {
      type: "reply";
      text: string;
      outcome: string;
      intent: string;
      action?: { type: "switch_pill" } | { type: "mailto"; url: string };
    };

export interface VoiceStreamHandle {
  push(frame: Uint8Array): void;
  closed(): void;
}

/** Voice as the API sees it. Errors are PhoenixErrors. */
export interface VoiceApi {
  status(): Promise<VoiceStatusView>;
  settings(): VoiceSettingsView;
  setSettings(patch: unknown): VoiceSettingsView;
  start(): Promise<VoiceStartedView>;
  stop(id: string): void;
  streamAvailable(id: string): boolean;
  openStream(
    id: string,
    send: (message: VoiceStreamMessageView) => void,
    onEnded: (reason: string) => void,
  ): VoiceStreamHandle;
}

export function voiceRoutes(s: CoreServices): Route[] {
  const voice = () => {
    if (!s.voice) throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Voice is unavailable");
    return s.voice;
  };
  return [
    route("GET", "/api/voice/status", () => voice().status()),
    route("GET", "/api/voice/settings", () => voice().settings()),
    route("POST", "/api/voice/settings", async ({ body }) =>
      voice().setSettings(expectObject(await body())),
    ),
    route("POST", "/api/voice/sessions", async ({ body }) => {
      const input = expectObject(await body());
      if (Object.keys(input).length > 0)
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, "No fields are accepted");
      return voice().start();
    }),
    route("DELETE", "/api/voice/sessions/:id", ({ params }) => {
      voice().stop(params.id!);
      return { stopped: true };
    }),
  ];
}
