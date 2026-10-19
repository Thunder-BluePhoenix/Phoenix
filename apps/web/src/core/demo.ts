// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** One step of the demo walkthrough, as Core's `POST /api/demo/start` sends it. */
export interface DemoStep {
  /** A scenario of the mock capability. */
  scenario: string;
  /** Translation key of the caption (core/runtime/src/demo.ts `DEMO_CAPTION_IDS`). */
  caption_id: string;
  /** The caption in English; shown when no translation exists for `caption_id`. */
  caption: string;
  /** Hash route to show while the scenario plays. */
  route: string;
}

/** A running demo: a second, isolated Core with its own token. */
export interface DemoSession {
  url: string;
  token: string;
  steps: DemoStep[];
}

/** Every string the demo UI itself shows, in one table so the translation pass has one place to look. */
export const DEMO_UI_TEXT = {
  banner: "Demo - nothing is saved",
  bannerDetail:
    "This is a scripted walkthrough on a separate, temporary Core. Your data is untouched.",
  settingsTitle: "Demo mode",
  settingsIntro:
    "Watch Fawkes react to builds, agents, deploys and meetings. The demo runs on a separate Core that keeps everything in memory, sends nothing anywhere and is deleted when you stop it. Your own data is not read or changed.",
  start: "Start demo",
  starting: "Starting demo...",
  stop: "Stop demo and go back",
  stopping: "Stopping...",
  play: "Play this step",
  next: "Next step",
  previous: "Previous step",
  playing: "Playing",
  finished: "That was the last step. Stop the demo to go back to your own Phoenix.",
  stepOf: "Step",
  startFailed: "The demo could not start",
  stopFailed: "The demo could not be stopped cleanly; it stops by itself when it is idle",
  playFailed: "The demo step could not be played",
  invalidSession: "Core sent an invalid demo address; the demo was not opened",
  demoOffline: "The demo Core is not reachable. It may have stopped after being idle.",
} as const;
export type DemoUiTextId = keyof typeof DEMO_UI_TEXT;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Checks Core's start answer before the page points its client at it: the address must be plain
 * `http://127.0.0.1:<port>` (the demo Core only ever listens there), the token a non-empty string,
 * every step well-formed with a hash route that starts with `/`. Returns null for anything else.
 */
export function parseDemoSession(raw: unknown): DemoSession | null {
  if (!isObject(raw) || typeof raw.url !== "string" || typeof raw.token !== "string") return null;
  if (!/^[A-Za-z0-9_-]{16,}$/.test(raw.token)) return null;
  let url: URL;
  try {
    url = new URL(raw.url);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port === "") return null;
  if (url.username !== "" || url.password !== "" || url.pathname !== "/") return null;
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) return null;
  const steps: DemoStep[] = [];
  for (const s of raw.steps) {
    if (
      !isObject(s) ||
      typeof s.scenario !== "string" ||
      typeof s.caption_id !== "string" ||
      typeof s.caption !== "string" ||
      typeof s.route !== "string" ||
      !s.route.startsWith("/")
    ) {
      return null;
    }
    steps.push({
      scenario: s.scenario,
      caption_id: s.caption_id,
      caption: s.caption,
      route: s.route,
    });
  }
  return { url: url.origin, token: raw.token, steps };
}
