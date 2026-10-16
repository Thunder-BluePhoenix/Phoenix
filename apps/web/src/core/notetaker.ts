// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// Wire types and fixed wording of the notetaker routes (see core/api/src/notetaker-routes.ts).

export interface NotetakerStatus {
  enabled: boolean;
  kill_switch_engaged: boolean;
  recognizer: { available: boolean; detail: string; engine?: string };
  audio_on_disk: false;
  summary: { available: boolean; locality: "local"; detail: string };
  capture: { microphone: true; system_audio: false; detail: string };
  active?: { id: string; started_at: string; elapsed_s: number };
  limits: { max_seconds: number; max_frame_bytes: number; window_seconds: number };
}

export interface NotetakerStarted {
  id: string;
  stream_path: string;
  max_seconds: number;
  max_frame_bytes: number;
  window_seconds: number;
}

/** Shown, and acknowledged with a required checkbox, before EVERY recording. */
export const CONSENT_NOTICE =
  "Tell everyone on the call that it is being recorded. Recording without consent can be illegal where you or they live.";

export const CONSENT_CHECKBOX = "I have told everyone on the call that it is being recorded";

/** The browser captures the microphone only; system audio needs the desktop app. */
export const MIC_ONLY_NOTICE =
  "Only your microphone is being recorded; other participants are not captured.";

/** The label of a meeting Phoenix recorded itself. */
export const RECORDED_HERE = "Recorded on this computer";

/** 1:05, 12:00, 1:02:03 */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
