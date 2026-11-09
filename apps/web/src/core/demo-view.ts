// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 70: how the floating window and the island follow a demo that the main window started.
// The real Core reports the running demo's Fawkes state and active tasks on `GET /api/demo/view`.
// The answer carries no URL and no token: these windows keep talking to the real Core with the
// connection they already have and never learn the demo Core's address or token.
import { createContext, useContext } from "react";
import type { ActiveTask, PetState } from "./types";

/** A validated demo view: what a window displays instead of the real state while a demo runs. */
export interface DemoViewData {
  state: PetState;
  tasks: ActiveTask[];
}

export const DEMO_VIEW_PATH = "/api/demo/view";
const MAX_TASKS = 20;
const MAX_TEXT = 500;
const DISPLAY_STATE = /^[A-Z_]{1,24}$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TEXT;

function parseTask(raw: unknown): ActiveTask | null {
  if (!isObject(raw)) return null;
  const { key, state, title, source, since, updatedAt, progress } = raw;
  if (!text(key) || !text(title) || !text(source) || !text(since) || !text(updatedAt)) return null;
  if (typeof state !== "string" || !DISPLAY_STATE.test(state)) return null;
  if (progress !== undefined && (typeof progress !== "number" || !Number.isFinite(progress))) {
    return null;
  }
  return {
    key,
    state,
    title,
    source,
    since,
    updatedAt,
    ...(progress !== undefined ? { progress } : {}),
  };
}

/**
 * Checks Core's answer. Returns null for "no demo running" AND for anything malformed, oversized
 * or carrying an unexpected shape, so a bad answer can only ever mean "show the real Core".
 * Only known fields are copied out; anything else (such as an address or a token) is dropped.
 */
export function parseDemoView(raw: unknown): DemoViewData | null {
  if (!isObject(raw) || raw.running !== true || !isObject(raw.state) || !Array.isArray(raw.tasks)) {
    return null;
  }
  const { state, explanation, since, recording, sleeping } = raw.state;
  if (typeof state !== "string" || !DISPLAY_STATE.test(state)) return null;
  if (!text(explanation) || !text(since)) return null;
  if (typeof recording !== "boolean" || typeof sleeping !== "boolean") return null;
  if (raw.tasks.length > MAX_TASKS) return null;
  const tasks: ActiveTask[] = [];
  for (const t of raw.tasks) {
    const task = parseTask(t);
    if (!task) return null;
    tasks.push(task);
  }
  return { state: { state, explanation, since, recording, sleeping }, tasks };
}

/** Set only by `DemoFollowProvider`; the main window has none, so it is never affected. */
export const DemoViewContext = createContext<DemoViewData | null>(null);

/** The demo view to display instead of the real state, or null. */
export function useDemoView(): DemoViewData | null {
  return useContext(DemoViewContext);
}
