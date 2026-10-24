// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 62 UI: "Attach a window" (macOS). One button starts one capture; Core asks the user to
// confirm, waits a few seconds so the user can bring the window to the front, reads it once, and the
// text comes back HERE. It enters the tray only when the user presses "Attach this text"; "Discard"
// drops it. The text is rendered as text, never as markup, and is never treated as an instruction.
import { useId } from "react";
import { useT } from "../i18n";
import { useWindowCapture } from "../core/window-capture";
import { formatNumber } from "../core/format";

export function WindowCapture({ onAttached }: { onAttached: () => void }) {
  const t = useT();
  const { phase, accepting, start, stopWaiting, discard, accept, dismiss } =
    useWindowCapture(onAttached);
  const headingId = useId();
  const noteId = useId();

  return (
    <section className="window-capture" aria-labelledby={headingId}>
      <h3 id={headingId}>{t("windowCapture.heading")}</h3>
      {phase.kind !== "review" && (
        <p id={noteId} className="muted small">
          {t("windowCapture.intro")}
        </p>
      )}
      {(phase.kind === "idle" || phase.kind === "notice") && (
        <div className="button-row wrap">
          <button
            type="button"
            className="btn"
            aria-describedby={noteId}
            onClick={() => void start()}
          >
            {t("windowCapture.start")}
          </button>
        </div>
      )}
      {phase.kind === "waiting" && (
        <>
          <p className="small" role="status">
            {t("windowCapture.waiting")}
          </p>
          <button type="button" className="btn" onClick={stopWaiting}>
            {t("windowCapture.stopWaiting")}
          </button>
        </>
      )}
      {phase.kind === "notice" && (
        <p
          className={phase.problem ? "warning-text small" : "small"}
          role={phase.problem ? "alert" : "status"}
        >
          {phase.message}{" "}
          <button type="button" className="link-button" onClick={dismiss}>
            {t("common.button.dismiss")}
          </button>
        </p>
      )}
      {phase.kind === "review" && (
        <div className="window-capture-review">
          <p className="small">
            <strong>{t("windowCapture.review.heading")}</strong>{" "}
            {t("windowCapture.review.from", {
              app: phase.capture.app,
              title: phase.capture.title || t("windowCapture.review.untitled"),
            })}
          </p>
          <p className="muted small">
            {t("windowCapture.review.size", {
              n: formatNumber(phase.capture.text.length),
            })}
            {phase.capture.truncated ? ` ${t("windowCapture.review.truncated")}` : ""}
          </p>
          <pre
            className="attachment-content"
            tabIndex={0}
            aria-label={t("windowCapture.review.textLabel")}
          >
            {phase.capture.text || t("windowCapture.review.noText")}
          </pre>
          {phase.capture.secret_kinds.length > 0 && (
            <p className="warning-text small" role="alert">
              {t("windowCapture.review.secrets", { kinds: phase.capture.secret_kinds.join(", ") })}
            </p>
          )}
          <p className="muted small">{t("windowCapture.review.note")}</p>
          <div className="button-row wrap">
            <button
              type="button"
              className="btn btn-primary"
              disabled={accepting || phase.capture.text.length === 0}
              onClick={() => void accept()}
            >
              {t("windowCapture.review.accept")}
            </button>
            <button type="button" className="btn" disabled={accepting} onClick={discard}>
              {t("windowCapture.review.discard")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
