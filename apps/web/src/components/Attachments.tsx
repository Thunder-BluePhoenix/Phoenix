// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 62 UI: the attachments tray, the drop zone and the "draft email" action.
//
// What the user is told, and what is true:
//   * Everything attached is visible here ("Preview" shows exactly what is stored) and removable
//     before anything is asked. Nothing is sent anywhere by attaching.
//   * Asking sends the ticked items to a model on THIS device. Attached files never go to a cloud
//     provider; the "Local only" badge says so.
//   * Names, previews and answers are rendered as text only.
//   * "Draft email" opens the user's mail app with a draft. Phoenix does not send it.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { ApiError } from "../core/client";
import { useClient } from "../core/context";
import { formatNumber } from "../core/format";
import { useT, type MessageKey } from "../i18n";
import { translate } from "../i18n/store";
import {
  ATTACHMENTS_PATH,
  DROP_LIMITS,
  MAIL_LIMITS,
  buildMailto,
  collectDropped,
  collectPasted,
  dragHasFiles,
  openMailto,
  useAttachmentUpload,
  type AttachmentAnswer,
  type AttachmentDetail,
  type AttachmentKind,
  type AttachmentOrigin,
  type AttachmentSummary,
  useAttachments,
  type AttachmentsState,
  type FileLike,
} from "../core/attachments";
import { useAction } from "../core/hooks";
import { Feedback } from "./Feedback";

/** A whole or fixed-fraction number in the digits of the language, without a grouping separator. */
const plainNumber = (n: number, digits: number): string =>
  formatNumber(n, undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });

export function formatBytes(n: number): string {
  if (n < 1024) return `${plainNumber(n, 0)} B`;
  if (n < 1024 * 1024) return `${plainNumber(n / 1024, n < 10 * 1024 ? 1 : 0)} KB`;
  return `${plainNumber(n / (1024 * 1024), 1)} MB`;
}

const KIND_LABEL: Record<AttachmentKind, MessageKey> = {
  text: "capture.attachments.kind.text",
  image: "capture.attachments.kind.image",
  folder: "capture.attachments.kind.folder",
};
const ORIGIN_LABEL: Record<AttachmentOrigin, MessageKey> = {
  drop: "capture.attachments.origin.drop",
  window: "capture.attachments.origin.window",
  paste: "capture.attachments.origin.paste",
};

// ── Drop zone ────────────────────────────────────────────────────────────────────────────────────

/**
 * Makes its children a drop target for files and folders (HTML5 drag and drop with the File API),
 * with a keyboard alternative: "Attach files…". The drop is read synchronously (the browser empties
 * it after the event), then each item is posted to Core.
 */
export function DropZone({
  children,
  label,
  onDone,
}: {
  children: ReactNode;
  /** Names the target for assistive technology and the hint, e.g. "the chat box". */
  label: string;
  onDone?: () => void;
}) {
  const t = useT();
  const { upload, busy, notice, clearNotice } = useAttachmentUpload(onDone);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  const hint = useId();

  const accepts = (e: ReactDragEvent<HTMLElement>) => dragHasFiles(e.dataTransfer);
  const onDragEnter = (e: ReactDragEvent<HTMLElement>) => {
    if (!accepts(e)) return;
    e.preventDefault();
    depth.current++;
    setOver(true);
  };
  const onDragOver = (e: ReactDragEvent<HTMLElement>) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: ReactDragEvent<HTMLElement>) => {
    if (!accepts(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const onDrop = (e: ReactDragEvent<HTMLElement>) => {
    if (!accepts(e)) return;
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    // Read now: the browser clears the DataTransfer when this handler returns.
    void upload(collectDropped(e.dataTransfer));
  };
  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    // Only a paste the user made inside this zone reaches here; the clipboard is read nowhere else.
    // Files are always taken; text only when it is long and the paste is not into a field.
    const target = e.target;
    const intoField =
      target instanceof HTMLElement &&
      (target.isContentEditable || target.closest("input, textarea, select") !== null);
    const source = collectPasted(e.clipboardData, intoField);
    if (!source) return; // an ordinary paste: leave it to the browser
    e.preventDefault();
    void upload(source, "paste");
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const files: FileLike[] = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) void upload({ files, folders: [] });
  };

  return (
    <div
      className={over ? "drop-zone drop-zone-over" : "drop-zone"}
      role="group"
      aria-label={t("capture.attachments.dropZone.label", { label })}
      aria-describedby={hint}
      aria-busy={busy}
      tabIndex={-1} // focusable by click, so a paste lands here even where there is no text box
      onDragEnter={onDragEnter}
      onPaste={onPaste}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      <p id={hint} className="muted small drop-hint">
        {over
          ? t("capture.attachments.dropZone.over")
          : t.rich("capture.attachments.dropZone.hint", {
              attach: (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => picker.current?.click()}
                >
                  {t("capture.attachments.dropZone.attachFiles")}
                </button>
              ),
            })}
      </p>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        aria-label={t("capture.attachments.dropZone.choose")}
        onChange={onPick}
      />
      {busy && (
        <p className="small" role="status">
          {t("capture.attachments.dropZone.reading")}
        </p>
      )}
      {notice && (
        <p
          className={notice.problem ? "warning-text small" : "small"}
          role={notice.problem ? "alert" : "status"}
        >
          {notice.text}{" "}
          <button type="button" className="link-button" onClick={clearNotice}>
            {t("common.button.dismiss")}
          </button>
        </p>
      )}
    </div>
  );
}

// ── Tray ─────────────────────────────────────────────────────────────────────────────────────────

function Preview({ item }: { item: AttachmentSummary }) {
  const t = useT();
  const client = useClient();
  const [detail, setDetail] = useState<AttachmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    client
      .request<AttachmentDetail>("GET", `${ATTACHMENTS_PATH}/${item.id}`)
      .then(
        (d) => live && setDetail(d),
        (err: unknown) =>
          live &&
          setError(
            err instanceof ApiError ? err.message : translate("common.error.coreUnreachable"),
          ),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [client, item.id]);

  if (loading) return <p className="muted small">{t("common.status.loading")}</p>;
  if (error)
    return (
      <p className="error-text small" role="alert">
        {error}
      </p>
    );
  if (!detail) return null;
  if (detail.kind === "image") {
    return (
      <img
        className="attachment-image"
        alt={t("capture.attachments.preview.imageAlt", { name: detail.name })}
        src={`data:${detail.mime};base64,${detail.content}`}
      />
    );
  }
  if (detail.kind === "folder") {
    let files: { path: string; bytes: number; text?: string }[] = [];
    try {
      files = (JSON.parse(detail.content) as { files: typeof files }).files;
    } catch {
      return <p className="error-text small">{t("capture.attachments.preview.listingBroken")}</p>;
    }
    return (
      <ul
        className="attachment-files"
        aria-label={t("capture.attachments.preview.filesIn", { name: detail.name })}
      >
        {files.map((f) => (
          <li key={f.path}>
            <code>{f.path}</code> <span className="muted">({formatBytes(f.bytes)})</span>
            {f.text !== undefined && <pre className="attachment-content">{f.text}</pre>}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <pre
      className="attachment-content"
      aria-label={t("capture.attachments.preview.contentsOf", { name: detail.name })}
      tabIndex={0}
    >
      {detail.content}
    </pre>
  );
}

function Chip({
  item,
  selected,
  onToggle,
  onRemove,
  busy,
}: {
  item: AttachmentSummary;
  selected: boolean;
  onToggle: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const boxId = useId();
  return (
    <li className="attachment-chip">
      <div className="attachment-row">
        <input
          id={boxId}
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={t("capture.attachments.chip.include", { name: item.name })}
        />
        <label htmlFor={boxId} className="attachment-name">
          <strong>{item.name}</strong>
        </label>
        <span className="muted small">
          {item.kind === "folder" && item.files !== null
            ? t("capture.attachments.chip.metaFiles", {
                kind: t(KIND_LABEL[item.kind]),
                files: item.files,
                size: formatBytes(item.bytes),
                origin: t(ORIGIN_LABEL[item.origin]),
              })
            : t("capture.attachments.chip.meta", {
                kind: t(KIND_LABEL[item.kind]),
                size: formatBytes(item.bytes),
                origin: t(ORIGIN_LABEL[item.origin]),
              })}
        </span>
        <button
          type="button"
          className="btn"
          aria-expanded={open}
          aria-label={t("capture.attachments.chip.previewLabel", { name: item.name })}
          onClick={() => setOpen(!open)}
        >
          {open ? t("capture.attachments.chip.hide") : t("capture.attachments.chip.preview")}
        </button>
        <button
          type="button"
          className="btn"
          aria-label={t("capture.attachments.chip.removeLabel", { name: item.name })}
          disabled={busy}
          onClick={onRemove}
        >
          {t("common.button.remove")}
        </button>
      </div>
      {!open && item.preview && <p className="muted small attachment-preview">{item.preview}</p>}
      {open && <Preview item={item} />}
    </li>
  );
}

/**
 * The attachments above the chat box. Shows nothing at all when nothing is attached. `excluded`
 * holds the ids the user unticked; everything else is included in the next question.
 */
export function AttachmentsTray({
  att,
  excluded,
  onToggle,
}: {
  att: AttachmentsState;
  excluded: Record<string, true>;
  onToggle: (id: string) => void;
}) {
  const t = useT();
  const { run, busy, error } = useAction();
  const items = att.data?.attachments ?? [];
  // A list that cannot load shows nothing: an unreachable Core is already reported everywhere else.
  if (items.length === 0) return null;
  const ticked = items.filter((i) => !excluded[i.id]);
  const ttlMin = Math.round((att.data?.limits.ttl_ms ?? 3_600_000) / 60_000);

  const remove = async (id: string) => {
    await run("DELETE", `${ATTACHMENTS_PATH}/${id}`);
    await att.reload();
  };
  const clear = async () => {
    await run("DELETE", ATTACHMENTS_PATH);
    await att.reload();
  };

  return (
    <section className="attachments-tray" aria-label={t("capture.attachments.tray.label")}>
      <div className="attachment-head">
        <h3>{t("capture.attachments.tray.heading", { n: items.length })}</h3>
        <span className="model-badge" title={t("capture.attachments.tray.localOnlyTitle")}>
          {t("capture.attachments.localOnly")}
        </span>
        {items.length > 0 && (
          <button type="button" className="btn" onClick={() => void clear()} disabled={busy}>
            {t("capture.attachments.tray.clearAll")}
          </button>
        )}
      </div>
      <ul className="attachment-list">
        {items.map((item) => (
          <Chip
            key={item.id}
            item={item}
            selected={!excluded[item.id]}
            busy={busy}
            onToggle={() => onToggle(item.id)}
            onRemove={() => void remove(item.id)}
          />
        ))}
      </ul>
      <Feedback error={error} />
      <p className="muted small" role="note">
        {ticked.length > 0
          ? t("capture.attachments.tray.noteTicked", { minutes: ttlMin, n: ticked.length })
          : t("capture.attachments.tray.noteNone", { minutes: ttlMin })}
      </p>
      {ticked.length > DROP_LIMITS.askAttachments && (
        <p className="warning-text small" role="alert">
          {t("capture.attachments.tray.tooMany", {
            max: DROP_LIMITS.askAttachments,
            n: ticked.length - DROP_LIMITS.askAttachments,
          })}
        </p>
      )}
    </section>
  );
}

// ── Draft email ──────────────────────────────────────────────────────────────────────────────────

/** An editable draft of the answer, handed to the user's own mail app. Phoenix never sends it. */
export function DraftEmail({ answer }: { answer: AttachmentAnswer }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(answer.answer);
  const [to, setTo] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const bodyId = useId();
  const toId = useId();
  const names = answer.sources.map((s) => s.name).join(", ");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const built = buildMailto({ attachmentName: names, body, to });
    if (!built.ok) return setProblem(built.reason);
    try {
      await openMailto(built.url);
      setProblem(null);
    } catch {
      setProblem(t("capture.attachments.draft.openFailed"));
    }
  };

  if (!open)
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        {t("capture.attachments.draft.open")}
      </button>
    );
  return (
    <form className="draft-email" onSubmit={(e) => void submit(e)}>
      <label htmlFor={toId} className="small">
        {t("capture.attachments.draft.to")}
      </label>
      <input
        id={toId}
        type="email"
        value={to}
        autoComplete="off"
        onChange={(e) => setTo(e.target.value)}
      />
      <label htmlFor={bodyId} className="small">
        {t("capture.attachments.draft.message")}
      </label>
      <textarea
        id={bodyId}
        rows={5}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-describedby={`${bodyId}-count`}
      />
      <p id={`${bodyId}-count`} className="muted small">
        {t("capture.attachments.draft.count", {
          n: plainNumber(body.length, 0),
          max: plainNumber(MAIL_LIMITS.bodyChars, 0),
        })}
      </p>
      {problem && (
        <p className="error-text small" role="alert">
          {problem}
        </p>
      )}
      <div className="button-row wrap">
        <button type="submit" className="btn btn-primary">
          {t("capture.attachments.draft.submit")}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          {t("common.button.cancel")}
        </button>
      </div>
    </form>
  );
}

/** A reply to "Ask about attachments", as chat text: the answer, who produced it, and its sources. */
export function AttachmentAnswerView({ answer }: { answer: AttachmentAnswer }) {
  const t = useT();
  const where = t(
    answer.locality === "local"
      ? "capture.attachments.answer.local"
      : "capture.attachments.answer.cloud",
  );
  return (
    <div className="attachment-answer">
      <p className="memory-text">{answer.answer}</p>
      <p className="muted small">
        {answer.vision_model
          ? t("capture.attachments.answer.processedVision", {
              by: answer.processed_by,
              vision: answer.vision_model,
              where,
            })
          : t("capture.attachments.answer.processed", { by: answer.processed_by, where })}
      </p>
      <p className="muted small">
        {t("capture.attachments.answer.from", {
          names: answer.sources.map((s) => s.name).join(", "),
        })}
      </p>
      <DraftEmail answer={answer} />
    </div>
  );
}

/** The Overview's drop target: give Fawkes a file here, then ask about it in the Chat tab. */
export function FawkesDropTarget() {
  const t = useT();
  const att = useAttachments();
  const count = att.data?.attachments.length ?? 0;
  return (
    <section aria-labelledby="fawkes-drop-h">
      <h3 id="fawkes-drop-h">{t("capture.attachments.fawkesDrop.heading")}</h3>
      <DropZone label="Fawkes" onDone={() => void att.reload()}>
        <p className="fawkes-drop-target">
          {t("capture.attachments.fawkesDrop.hint")}{" "}
          <span className="model-badge">{t("capture.attachments.localOnly")}</span>
          {count > 0 ? ` ${t("capture.attachments.fawkesDrop.count", { n: count })}` : ""}
        </p>
      </DropZone>
    </section>
  );
}
