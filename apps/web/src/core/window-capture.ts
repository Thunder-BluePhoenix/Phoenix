// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 62, web side of "attach a window as context" (macOS). The page asks Core to read the window
// the user brings to the front (Core first asks the user to confirm), shows what came back, and
// posts it to the tray (origin "window") ONLY when the user presses Accept. Nothing here runs on a
// timer, on load or on an event: every capture starts from one button press.
import { useCallback, useRef, useState } from "react";
import { ApiError } from "./client";
import { useClient } from "./context";
import { ATTACHMENTS_PATH, DROP_LIMITS } from "./attachments";
import { translate } from "../i18n/store";

export const WINDOW_CAPTURE_PATH = `${ATTACHMENTS_PATH}/window/capture`;

/** What `POST /api/attachments/window/capture` answers (core/api/src/attachment-routes.ts). */
export type WindowCapture =
  | {
      status: "captured";
      app: string;
      title: string;
      text: string;
      truncated: boolean;
      secret_kinds: string[];
    }
  | { status: "accessibility_not_granted" }
  | { status: "phoenix_window" }
  | { status: "no_window" };

export type CapturedWindow = Extract<WindowCapture, { status: "captured" }>;

/** Core's character cap on one window's text. */
export const WINDOW_TEXT_MAX_CHARS = 100_000;

/**
 * The tray label for a captured window: "App — Title", cut to the name limit, with path separators and
 * `..` removed because Core refuses a name that looks like a path.
 */
export function windowAttachmentName(app: string, title: string): string {
  const raw = title ? `${app} — ${title}` : app;
  const flat = raw.replace(/[\\/]/gu, " ").replace(/\.\./gu, "…").replace(/\s+/gu, " ").trim();
  return Array.from(flat).slice(0, DROP_LIMITS.nameChars).join("") || "window";
}

export type WindowCapturePhase =
  | { kind: "idle" }
  /** Core is waiting for the user's confirmation, then reads the window. */
  | { kind: "waiting" }
  /** The user is looking at the captured text and has not decided. */
  | { kind: "review"; capture: CapturedWindow }
  /** A refusal or a result that holds no text; `message` is shown as it is. */
  | { kind: "notice"; message: string; problem: boolean };

const reason = (err: unknown): string =>
  err instanceof ApiError || err instanceof Error
    ? err.message
    : translate("common.error.requestFailed");

export function useWindowCapture(onAttached: () => void) {
  const client = useClient();
  const [phase, setPhase] = useState<WindowCapturePhase>({ kind: "idle" });
  const [accepting, setAccepting] = useState(false);
  // Bumped by "stop waiting" and by every new start: an answer for an older start is ignored.
  const ticket = useRef(0);

  const start = useCallback(async () => {
    if (phase.kind === "waiting") return;
    const mine = ++ticket.current;
    setPhase({ kind: "waiting" });
    try {
      const got = await client.request<WindowCapture>("POST", WINDOW_CAPTURE_PATH);
      if (ticket.current !== mine) return;
      if (got.status === "captured") return setPhase({ kind: "review", capture: got });
      const key = {
        accessibility_not_granted: "windowCapture.result.notGranted",
        phoenix_window: "windowCapture.result.phoenixWindow",
        no_window: "windowCapture.result.noWindow",
      } as const;
      setPhase({ kind: "notice", message: translate(key[got.status]), problem: true });
    } catch (err) {
      if (ticket.current !== mine) return;
      setPhase({ kind: "notice", message: reason(err), problem: true });
    }
  }, [client, phase.kind]);

  const stopWaiting = useCallback(() => {
    ticket.current++;
    setPhase({ kind: "idle" });
  }, []);

  const discard = useCallback(() => {
    setPhase({ kind: "notice", message: translate("windowCapture.discarded"), problem: false });
  }, []);

  const accept = useCallback(async () => {
    if (phase.kind !== "review" || accepting) return;
    const { capture } = phase;
    setAccepting(true);
    try {
      const name = windowAttachmentName(capture.app, capture.title);
      await client.request("POST", ATTACHMENTS_PATH, {
        name,
        kind: "text",
        mime: "text/plain",
        origin: "window",
        content: capture.text,
      });
      setPhase({
        kind: "notice",
        message: translate("windowCapture.attached", { name }),
        problem: false,
      });
      onAttached();
    } catch (err) {
      // Stay on the review: the user can discard, or remove a window from the tray and try again.
      setPhase({
        kind: "notice",
        message: translate("windowCapture.acceptFailed", { reason: reason(err) }),
        problem: true,
      });
    } finally {
      setAccepting(false);
    }
  }, [accepting, client, onAttached, phase]);

  const dismiss = useCallback(() => setPhase({ kind: "idle" }), []);
  return { phase, accepting, start, stopWaiting, discard, accept, dismiss };
}
