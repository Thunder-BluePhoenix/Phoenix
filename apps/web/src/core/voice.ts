// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// Wire types of the voice routes (see core/api/src/voice-routes.ts for the protocol).

export interface VoiceSettings {
  enabled: boolean;
}

export type VoicePhase = "waiting" | "awake" | "thinking";

export interface VoiceStatus {
  enabled: boolean;
  kill_switch_engaged: boolean;
  recognizer: { available: boolean; detail: string; engine?: string };
  audio_on_disk: false;
  active: { id: string; phase: VoicePhase } | null;
  limits: { max_frame_bytes: number; awake_window_ms: number };
}

export interface VoiceStarted {
  id: string;
}

export type VoiceAction = { type: "switch_pill" } | { type: "mailto"; url: string };

export interface VoiceReply {
  text: string;
  outcome: "ok" | "refused" | "unavailable" | "failed" | "denied";
  intent: string;
  action?: VoiceAction;
}

/** Why voice cannot start now, in plain words; null when it can. */
export function voiceBlocked(status: VoiceStatus | null, online: boolean): string | null {
  if (!status) return "The voice assistant status is not available.";
  if (!status.enabled) return "The voice assistant is off. Turn it on in Settings, under Voice.";
  if (status.kill_switch_engaged) return "The emergency stop is engaged.";
  if (!status.recognizer.available) return status.recognizer.detail;
  if (!online) return "Phoenix Core is not connected.";
  return null;
}

/** A mailto link Core made is the only link voice opens, and only when the user clicks it. */
export const isMailtoDraft = (url: string): boolean =>
  /^mailto:\?(?:subject|body)=[A-Za-z0-9%._~!*'()-]*(?:&body=[A-Za-z0-9%._~!*'()-]*)?$/u.test(url);
