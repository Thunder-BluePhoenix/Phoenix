// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// Wire types of the notetaker routes (see core/api/src/notetaker-routes.ts).
import { formatNumber } from "./format";

export interface NotetakerStatus {
  enabled: boolean;
  kill_switch_engaged: boolean;
  recognizer: { available: boolean; detail: string; engine?: string };
  audio_on_disk: false;
  summary: { available: boolean; locality: "local"; detail: string };
  capture: { microphone: true; system_audio: false; detail: string };
  /**
   * Whether Core has a way to ask a PERSON before recording. The session token alone cannot
   * prove that, so without a trusted channel (the desktop shell) every start is refused.
   */
  consent_channel: { available: boolean; code?: string; detail: string };
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

/** The label of a meeting Phoenix recorded itself. */
export const RECORDED_HERE = "Recorded on this computer";

/** 1:05, 12:00, 1:02:03, with the digits of the language on screen. */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = formatNumber(s % 60, undefined, { minimumIntegerDigits: 2 });
  if (h === 0) return `${formatNumber(m)}:${ss}`;
  return `${formatNumber(h)}:${formatNumber(m, undefined, { minimumIntegerDigits: 2 })}:${ss}`;
}
