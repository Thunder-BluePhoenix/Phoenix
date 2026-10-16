// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// NOTETAKER PROTOCOL (Phase 65): record a call on THIS computer, without a bot, into Phoenix's
// meeting records. What the web page (and, later, the desktop shell) speaks to Phoenix Core.
//
// Everything is behind the session token. None of it is a capability command or an agent tool.
// The notetaker is OFF until the user turns it on (POST /api/notetaker/settings {enabled:true}).
// Turning it on is NOT consent to record: EVERY start request must carry
// `{consent: true, notice_acknowledged: true}` - the user confirmed, each time, that everyone on the
// call was told it is being recorded ("Recording without consent can be illegal where you or they
// live"). The audit log gets a row for every start (session id, the two flags and the consent
// channel kind; no names, no text).
//
// SECURITY: the session token proves possession, not a person's agreement. So the two flags are
// necessary but NEVER sufficient: Core also needs a consent channel injected by the embedding
// process (desktop shell dialog) that a token client cannot drive. Without it (the default, and the
// browser) POST /api/notetaker/sessions answers 403 CONSENT_CHANNEL_UNAVAILABLE and nothing records:
// no recogniser is probed, no meeting record opens, no `notetaker.recording` is published.
//
// Privacy contract:
//   * Audio is NEVER written to disk by Core. PCM is buffered per channel in memory, transcribed in
//     fixed windows (30 s) by the on-device recogniser, and each window is zeroed right after its text
//     exists. Whatever is not yet transcribed when the recording stops is transcribed and then zeroed.
//     On any abort (kill switch, switching off, socket closing, a limit, an error) every buffer is
//     zeroed; the transcript already written stays.
//   * With no on-device recogniser that keeps audio off the disk, status says `recognizer.available:
//     false` and a start is refused. There is no cloud speech path.
//   * The summary is made by a model on this device only (privacy "sensitive" with a purpose that is
//     not in SENSITIVE_CLOUD_PURPOSES); if it fails there is NO summary. Decisions and action items
//     are imported through the existing review pipeline as `proposed`; nothing is accepted for you.
//   * Events carry no text: `notetaker.recording` / `notetaker.idle`, payload {session}. Fawkes shows
//     RECORDING in every view for the whole capture. Only Core may publish those two event types.
//   * Honest scope: speakers are only "You" (microphone) and "Others" (system audio, all remote people
//     together). There is no per-person diarisation. The browser captures the MICROPHONE ONLY; system
//     audio needs the desktop shell. Handing audio to Kage is not built.
//
// Sequence:
//   1. POST   /api/notetaker/sessions   {title?, consent: true, notice_acknowledged: true}
//                                       -> {id, stream_path, max_seconds, max_frame_bytes, window_seconds}
//        Refusals: 409 off / emergency stop, 400 no consent / already recording / bad title,
//        503 no recogniser.
//   2. WS     /api/notetaker/stream?session=<id>        (single use; same rules as the dictation socket:
//        loopback Host, Origin = http://<Host>, token only in the sub-protocols `phoenix.v1` +
//        `phoenix.token.<token>`, no cookie, exactly the one query parameter `session`).
//        Server -> client JSON: {"type":"ready"} | {"type":"audio_ended"} | {"type":"ended","reason"} |
//        {"type":"error","error"}.
//        Client -> server binary frame: 1 byte channel (0x01 microphone "You", 0x02 system audio
//        "Others") then 16 kHz mono signed 16-bit little-endian PCM; at most 1 MiB per frame; no faster
//        than twice real time. Text frame {"type":"end"}: no more audio.
//   3. POST   /api/notetaker/sessions/:id/stop -> {meeting_id}   transcribes what is left, writes the
//        transcript, makes the summary (if a local model answers) and imports proposed items.
//   4. DELETE /api/notetaker/sessions/:id        abort. Idempotent for a session that already ended.
//   GET /api/notetaker/status ; POST /api/notetaker/settings {enabled}
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectBoolean, expectObject, route, type Route } from "./http";
import type { CoreServices } from "./services";

export interface NotetakerStatusView {
  enabled: boolean;
  kill_switch_engaged: boolean;
  recognizer: { available: boolean; detail: string; engine?: string };
  /**
   * Whether a person-bound confirmation surface exists. Without one every start is refused with
   * 403 CONSENT_CHANNEL_UNAVAILABLE: the session token (all a browser or script has) proves no one
   * agreed, and `consent` / `notice_acknowledged` in a request are claims, not proof.
   */
  consent_channel:
    { available: true; detail: string } | { available: false; code: string; detail: string };
  /** Always false: audio is held in memory only. */
  audio_on_disk: false;
  /** Summaries use a model on this device only. */
  summary: { available: boolean; locality: "local"; detail: string };
  /** Which audio the sources of this build capture. */
  capture: { microphone: true; system_audio: false; detail: string };
  active?: { id: string; started_at: string; elapsed_s: number };
  limits: { max_seconds: number; max_frame_bytes: number; window_seconds: number };
}

export interface NotetakerSettingsView {
  enabled: boolean;
}

export interface NotetakerStartedView {
  id: string;
  stream_path: string;
  max_seconds: number;
  max_frame_bytes: number;
  window_seconds: number;
}

/** One audio stream of one session (single use). */
export interface NotetakerStreamHandle {
  push(frame: Uint8Array): void;
  end(): void;
  closed(): void;
}

/** The notetaker as the API sees it. Errors are PhoenixErrors. */
export interface NotetakerApi {
  status(): Promise<NotetakerStatusView>;
  setSettings(enabled: boolean): NotetakerSettingsView;
  start(input: {
    title?: string | undefined;
    consent: boolean;
    notice_acknowledged: boolean;
  }): Promise<NotetakerStartedView>;
  stop(id: string): Promise<{ meeting_id: string }>;
  cancel(id: string): void;
  /** True when the session exists, takes audio and no stream was opened for it yet. */
  streamAvailable(id: string): boolean;
  openStream(id: string, onEnded: (reason: string) => void): NotetakerStreamHandle;
}

export function notetakerRoutes(s: CoreServices): Route[] {
  const notetaker = () => {
    if (!s.notetaker)
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "The notetaker is unavailable");
    return s.notetaker;
  };
  const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);
  return [
    route("GET", "/api/notetaker/status", () => notetaker().status()),
    route("POST", "/api/notetaker/settings", async ({ body }) => {
      const input = expectObject(await body());
      for (const key of Object.keys(input))
        if (key !== "enabled") throw invalid("Only `enabled` is accepted");
      return notetaker().setSettings(expectBoolean(input, "enabled"));
    }),
    route("POST", "/api/notetaker/sessions", async ({ body }) => {
      const input = expectObject(await body());
      for (const key of Object.keys(input))
        if (key !== "title" && key !== "consent" && key !== "notice_acknowledged")
          throw invalid("Only `title`, `consent` and `notice_acknowledged` are accepted");
      if (input.title !== undefined && typeof input.title !== "string")
        throw invalid("`title` must be text");
      // Strictly `true`, in this request: a truthy string or an earlier answer is not consent.
      return notetaker().start({
        title: input.title as string | undefined,
        consent: input.consent === true,
        notice_acknowledged: input.notice_acknowledged === true,
      });
    }),
    route("POST", "/api/notetaker/sessions/:id/stop", async ({ params, body }) => {
      // The body is not read for meaning: nothing but the session id selects what is stopped.
      await body();
      return notetaker().stop(params.id!);
    }),
    route("DELETE", "/api/notetaker/sessions/:id", ({ params }) => {
      notetaker().cancel(params.id!);
      return { cancelled: true };
    }),
  ];
}
