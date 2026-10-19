// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useConnection } from "../core/context";
import { dictationBlocked } from "../core/dictation";
import { createBrowserMicrophone, type DictationMicrophone } from "../core/dictation-mic";
import { useT } from "../i18n";
import { createPcmAnalyser, type PillAnalyser } from "./analyser";
import { useDictationSession, useDictationStatus } from "./session";
import { browserOpener, type PillShell, type RouteOpener } from "./shell";

/** Schedules `callback` for the next animation frame; returns the function that cancels it. */
export type FrameScheduler = (callback: () => void) => () => void;

const animationFrames: FrameScheduler = (callback) => {
  const id = requestAnimationFrame(callback);
  return () => cancelAnimationFrame(id);
};

/** How strongly each of the five dots follows the voice: the middle one most. */
export const DOT_SHAPE = [0.6, 0.85, 1, 0.85, 0.6];

/** The route of the call recorder (built elsewhere). The pill only ever opens it. */
export const NOTETAKER_ROUTE = "/notetaker";

/** Reads the analyser once per frame while `active`; 0 otherwise. Rounded so quiet frames do not re-render. */
function useVoiceLevel(analyser: PillAnalyser, active: boolean, schedule: FrameScheduler): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    let cancel = () => {};
    const tick = () => {
      setLevel(Math.round(analyser.level() * 100) / 100);
      cancel = schedule(tick);
    };
    cancel = schedule(tick);
    return () => cancel();
  }, [analyser, active, schedule]);
  return active ? level : 0;
}

export interface PillAppProps {
  /** The desktop shell; null in an ordinary browser. */
  shell: PillShell | null;
  /** Test seam: a fake microphone. Production uses getUserMedia through the browser. */
  createMicrophone?: () => DictationMicrophone;
  /** Test seam: a fake level meter. */
  analyser?: PillAnalyser;
  /** Test seam: drives the dots without real animation frames. */
  scheduleFrame?: FrameScheduler;
  /** Without a shell, how "Record a call" and "Open Phoenix" open the web app. */
  openInBrowser?: RouteOpener;
  /** Without a shell, whether the recognised text can be copied. Defaults to the clipboard API. */
  copyText?: ((text: string) => Promise<void>) | null;
}

const defaultCopy = () =>
  typeof navigator !== "undefined" && navigator.clipboard
    ? (text: string) => navigator.clipboard.writeText(text)
    : null;

/**
 * The Phoenix pill: a tiny always-on-top window (owned by the desktop shell) with dots that follow
 * the voice and three buttons. This page does the capture and talks to Core; the shell only owns
 * the window and hotkey and pastes the result. "Record a call" never records: it opens the call
 * recorder inside Phoenix, where consent is asked.
 */
export function PillApp({
  shell,
  createMicrophone = createBrowserMicrophone,
  analyser: injectedAnalyser,
  scheduleFrame = animationFrames,
  openInBrowser,
  copyText,
}: PillAppProps) {
  const [analyser] = useState(() => injectedAnalyser ?? createPcmAnalyser());
  const [browserOpen] = useState(() => openInBrowser ?? browserOpener());
  const t = useT();
  const connection = useConnection();
  const session = useDictationSession({ createMicrophone, analyser, shell });
  const { phase, outcome, text } = session;
  const status = useDictationStatus(phase === "idle");
  const blocked = dictationBlocked(status, connection);
  const level = useVoiceLevel(analyser, phase === "listening", scheduleFrame);
  const statusId = useId();
  const copy = copyText === undefined ? defaultCopy() : copyText;
  const [shellError, setShellError] = useState<string | null>(null);

  // The shell's commands may arrive at any time: always act through the latest session.
  const latest = useRef(session);
  latest.current = session;
  useEffect(() => {
    if (!shell) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;
    void shell.onError(setShellError).then((offError) => {
      if (disposed) return offError();
      unlistenError = offError;
      void shell
        .onDictation((command) => {
          if (command.action === "start") {
            setShellError(null);
            latest.current.start();
          } else if (command.action === "stop") latest.current.stop();
          else latest.current.cancel();
        })
        .then((off) => {
          if (disposed) return off();
          unlisten = off;
          // Only now can no command be lost.
          shell.ready();
        });
    });
    return () => {
      disposed = true;
      unlisten?.();
      unlistenError?.();
    };
  }, [shell]);
  useEffect(() => {
    if (phase !== "idle" || outcome) setShellError(null);
  }, [phase, outcome]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") latest.current.cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = (route: string) => (shell ? shell.openInPhoenix(route) : browserOpen(route));

  const message =
    phase === "starting"
      ? t("capture.pill.waiting")
      : phase === "listening"
        ? t("capture.pill.listening")
        : phase === "recognising"
          ? t("capture.pill.recognising")
          : (shellError ?? outcome?.text ?? blocked ?? t("capture.pill.ready"));
  const tone =
    phase === "idle"
      ? shellError
        ? "error"
        : (outcome?.tone ?? (blocked ? "info" : "neutral"))
      : "neutral";

  return (
    <div className="pill-root" data-state={phase} data-tone={tone}>
      <div className="pill-bar">
        <div className="pill-dots" aria-hidden="true" data-testid="pill-dots">
          {DOT_SHAPE.map((shape, index) => {
            const strength = level * shape;
            const style = {
              "--dot-scale": (1 + strength * 1.6).toFixed(2),
              "--dot-opacity": (0.35 + 0.65 * Math.min(1, strength * 1.5)).toFixed(2),
              "--dot-index": index,
            } as CSSProperties;
            return (
              <span
                key={index}
                className="pill-dot"
                data-testid="pill-dot"
                data-level={strength.toFixed(2)}
                style={style}
              />
            );
          })}
        </div>
        <p id={statusId} className="pill-status" role="status" aria-live="polite" title={message}>
          {message}
        </p>
        {phase === "listening" ? (
          <button type="button" className="pill-btn pill-primary" onClick={session.stop}>
            {t("capture.pill.stop")}
          </button>
        ) : (
          <button
            type="button"
            className="pill-btn pill-primary"
            disabled={blocked !== null || phase !== "idle"}
            aria-describedby={statusId}
            onClick={() => {
              setShellError(null);
              session.start();
            }}
          >
            {t("capture.dictation.button.start")}
          </button>
        )}
        <button
          type="button"
          className="pill-btn pill-icon"
          aria-label={t("capture.pill.recordCall")}
          title={t("capture.pill.recordCall.title")}
          onClick={() => open(NOTETAKER_ROUTE)}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M3 2h3l1 3-2 1.5a8 8 0 0 0 4.5 4.5L11 9l3 1v3a1 1 0 0 1-1 1A11 11 0 0 1 2 3a1 1 0 0 1 1-1z"
              fill="currentColor"
            />
          </svg>
        </button>
        <button
          type="button"
          className="pill-btn pill-icon"
          aria-label={t("capture.pill.openPhoenix")}
          title={t("capture.pill.openPhoenix")}
          onClick={() => open("/")}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {text !== null && (
        <div className="pill-result">
          <p className="pill-text" data-testid="pill-text">
            {text}
          </p>
          {copy && (
            <button
              type="button"
              className="pill-btn"
              onClick={() => void copy(text).catch(() => {})}
            >
              {t("common.button.copy")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
