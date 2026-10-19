// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { MessageKey } from "../i18n/en";
import { isMessageKey, translate, type Translate } from "../i18n/store";
import type { ActiveLocale } from "../i18n/supported";

/** One step of the demo walkthrough, as Core's `POST /api/demo/start` sends it. */
export interface DemoStep {
  /** A scenario of the mock capability. */
  scenario: string;
  /** Translation key of the caption (core/runtime/src/demo.ts `DEMO_CAPTION_IDS`). */
  caption_id: string;
  /** The caption in English, as Core sends it; shown when no translation exists for `caption_id`. */
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

/** The demo UI's own messages, by the name the controller and the walkthrough use. */
const DEMO_UI_KEYS = {
  banner: "services.demo.banner",
  bannerDetail: "services.demo.bannerDetail",
  settingsTitle: "services.demo.settingsTitle",
  settingsIntro: "services.demo.settingsIntro",
  start: "services.demo.start",
  starting: "services.demo.starting",
  stop: "services.demo.stop",
  play: "services.demo.play",
  next: "services.demo.next",
  previous: "services.demo.previous",
  playing: "services.demo.playing",
  finished: "services.demo.finished",
  startFailed: "services.demo.startFailed",
  stopFailed: "services.demo.stopFailed",
  playFailed: "services.demo.playFailed",
  invalidSession: "services.demo.invalidSession",
  demoOffline: "services.demo.offline",
} as const satisfies Record<string, MessageKey>;
export type DemoUiTextId = keyof typeof DEMO_UI_KEYS;

/**
 * Every string the demo UI itself shows, in one table. Each value is read through `translate` when
 * it is used, so it is always in the language on screen (a component re-renders on a language
 * change through `useT()`).
 */
export const DEMO_UI_TEXT: Readonly<Record<DemoUiTextId, string>> = (() => {
  const table: Partial<Record<DemoUiTextId, string>> = {};
  for (const [name, key] of Object.entries(DEMO_UI_KEYS)) {
    Object.defineProperty(table, name, { enumerable: true, get: () => translate(key) });
  }
  return table as Record<DemoUiTextId, string>;
})();

/**
 * The caption of a step in the language on screen. English is what Core sends, so it is shown as
 * sent; any other language uses the translation of `caption_id` and falls back to Core's English
 * when the id is one this build does not know.
 */
export function demoCaption(step: DemoStep, t: Translate, locale: ActiveLocale): string {
  if (locale === "en") return step.caption;
  const key = `services.demo.caption.${step.caption_id.replace(/^demo\./, "")}`;
  return isMessageKey(key) ? t(key) : step.caption;
}

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
