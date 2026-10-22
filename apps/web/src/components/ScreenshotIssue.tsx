// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  ScreenshotDraft,
  ScreenshotPermissionError,
  type Annotation,
  type IssueDraft,
  type IssueTracker,
} from "../core/screenshot";
import { useT } from "../i18n";

type Tool = Annotation["kind"];

/** Capture happens only on the button click; image remains in memory until approval and creation. */
export function ScreenshotIssue({ workflow }: { workflow: ScreenshotDraft }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(workflow.size);
  const [tool, setTool] = useState<Tool>("redact");
  const [text, setText] = useState("");
  const [tracker, setTracker] = useState<IssueTracker>("github");
  const [project, setProject] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState<IssueDraft | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (size && canvas.current) workflow.render(canvas.current);
  }, [workflow, size]);

  const capture = async () => {
    setBusy(true);
    setError("");
    setDraft(null);
    setResult("");
    try {
      if (await workflow.captureOnAction()) setSize(workflow.size);
    } catch (reason) {
      setError(
        reason instanceof ScreenshotPermissionError
          ? t("focus.screenshot.permission")
          : t("focus.screenshot.error", {
              error: reason instanceof Error ? reason.message : String(reason),
            }),
      );
    } finally {
      setBusy(false);
    }
  };

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          event.currentTarget.width,
          ((event.clientX - bounds.left) * event.currentTarget.width) / bounds.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          event.currentTarget.height,
          ((event.clientY - bounds.top) * event.currentTarget.height) / bounds.height,
        ),
      ),
    };
  };

  const finish = (event: PointerEvent<HTMLCanvasElement>) => {
    const start = origin.current;
    origin.current = null;
    if (!start) return;
    const end = point(event);
    try {
      if (tool === "text") workflow.annotate({ kind: "text", ...start, text });
      else workflow.annotate({ kind: tool, ...start, toX: end.x, toY: end.y });
      if (canvas.current) workflow.render(canvas.current);
      setDraft(null);
      setResult("");
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("focus.screenshot.error", { error: "" }),
      );
    }
  };

  const preview = async () => {
    setBusy(true);
    setError("");
    try {
      setDraft(await workflow.preview(tracker, project, title, body));
    } catch (reason) {
      setDraft(null);
      setError(
        reason instanceof Error ? reason.message : t("focus.screenshot.error", { error: "" }),
      );
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const issue = await workflow.createApproved(draft);
      setResult(
        issue ? t("focus.screenshot.created", { url: issue.url }) : t("focus.screenshot.declined"),
      );
      if (issue) setDraft(null);
    } catch (reason) {
      setError(
        t("focus.screenshot.error", {
          error: reason instanceof Error ? reason.message : String(reason),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={t("focus.screenshot.title")}>
      <h2>{t("focus.screenshot.title")}</h2>
      <button type="button" disabled={busy} onClick={() => void capture()}>
        {t("focus.screenshot.capture")}
      </button>
      {size && (
        <>
          <fieldset disabled={busy}>
            {(["redact", "arrow", "box", "text"] as const).map((choice) => (
              <label key={choice}>
                <input type="radio" checked={tool === choice} onChange={() => setTool(choice)} />
                {t(`focus.screenshot.${choice}`)}
              </label>
            ))}
            {tool === "text" && (
              <label>
                {t("focus.screenshot.annotationText")}
                <input
                  maxLength={500}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
            )}
          </fieldset>
          <canvas
            ref={canvas}
            width={size.width}
            height={size.height}
            style={{ maxWidth: "100%", touchAction: "none" }}
            onPointerDown={(event) => {
              origin.current = point(event);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={finish}
            onPointerCancel={() => {
              origin.current = null;
            }}
            aria-label={t("focus.screenshot.title")}
          />
          <label>
            {t("focus.screenshot.project")}
            <input
              value={project}
              onChange={(event) => {
                setProject(event.target.value);
                setDraft(null);
              }}
            />
          </label>
          <label>
            {t("focus.screenshot.issueTitle")}
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setDraft(null);
              }}
            />
          </label>
          <label>
            {t("focus.screenshot.body")}
            <textarea
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
                setDraft(null);
              }}
            />
          </label>
          <label>
            {t("focus.screenshot.tracker")}
            <select
              value={tracker}
              onChange={(event) => {
                setTracker(event.target.value as IssueTracker);
                setDraft(null);
              }}
            >
              {(["github", "linear", "jira"] as const).map((choice) => (
                <option key={choice} value={choice}>
                  {t(`focus.screenshot.tracker.${choice}`)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => void preview()}>
            {t("focus.screenshot.preview")}
          </button>
          {draft && (
            <div aria-label={t("focus.screenshot.draft")}>
              <h3>{draft.title}</h3>
              <p>
                {t(`focus.screenshot.tracker.${draft.tracker}`)} · {draft.project}
              </p>
              <p>{draft.body}</p>
              <p>
                {t(
                  draft.attachment
                    ? "focus.screenshot.attachment"
                    : "focus.screenshot.noAttachment",
                )}
              </p>
              <button type="button" disabled={busy} onClick={() => void create()}>
                {t("focus.screenshot.create")}
              </button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {result && <p role="status">{result}</p>}
    </section>
  );
}
