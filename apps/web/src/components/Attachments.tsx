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
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { ApiError } from "../core/client";
import { useClient } from "../core/context";
import {
  ATTACHMENTS_PATH,
  DROP_LIMITS,
  MAIL_LIMITS,
  buildMailto,
  collectDropped,
  dragHasFiles,
  openMailto,
  useAttachmentUpload,
  type AttachmentAnswer,
  type AttachmentDetail,
  type AttachmentSummary,
  useAttachments,
  type AttachmentsState,
  type FileLike,
} from "../core/attachments";
import { useAction } from "../core/hooks";
import { Feedback } from "./Feedback";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const KIND_LABEL = { text: "Text", image: "Image", folder: "Folder" } as const;
const ORIGIN_LABEL = {
  drop: "dropped",
  window: "window",
  paste: "pasted",
} as const;

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
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const files: FileLike[] = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) void upload({ files, folders: [] });
  };

  return (
    <div
      className={over ? "drop-zone drop-zone-over" : "drop-zone"}
      role="group"
      aria-label={`Drop files on ${label}`}
      aria-describedby={hint}
      aria-busy={busy}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      <p id={hint} className="muted small drop-hint">
        {over ? "Drop to attach." : "Drop text files, PNG/JPEG images or a folder here, or "}
        {!over && (
          <button type="button" className="link-button" onClick={() => picker.current?.click()}>
            attach files…
          </button>
        )}
        {!over && " Attaching sends nothing."}
      </p>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        aria-label="Choose files to attach"
        onChange={onPick}
      />
      {busy && (
        <p className="small" role="status">
          Reading what you dropped…
        </p>
      )}
      {notice && (
        <p
          className={notice.problem ? "warning-text small" : "small"}
          role={notice.problem ? "alert" : "status"}
        >
          {notice.text}{" "}
          <button type="button" className="link-button" onClick={clearNotice}>
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}

// ── Tray ─────────────────────────────────────────────────────────────────────────────────────────

function Preview({ item }: { item: AttachmentSummary }) {
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
          live && setError(err instanceof ApiError ? err.message : "Phoenix Core is unreachable"),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [client, item.id]);

  if (loading) return <p className="muted small">Loading…</p>;
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
        alt={`Preview of ${detail.name}`}
        src={`data:${detail.mime};base64,${detail.content}`}
      />
    );
  }
  if (detail.kind === "folder") {
    let files: { path: string; bytes: number; text?: string }[] = [];
    try {
      files = (JSON.parse(detail.content) as { files: typeof files }).files;
    } catch {
      return <p className="error-text small">The stored listing cannot be shown.</p>;
    }
    return (
      <ul className="attachment-files" aria-label={`Files in ${detail.name}`}>
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
    <pre className="attachment-content" aria-label={`Contents of ${detail.name}`} tabIndex={0}>
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
          aria-label={`Include ${item.name} in the question`}
        />
        <label htmlFor={boxId} className="attachment-name">
          <strong>{item.name}</strong>
        </label>
        <span className="muted small">
          {KIND_LABEL[item.kind]}
          {item.kind === "folder" && item.files !== null ? `, ${item.files} files` : ""} ·{" "}
          {formatBytes(item.bytes)} · {ORIGIN_LABEL[item.origin]}
        </span>
        <button
          type="button"
          className="btn"
          aria-expanded={open}
          aria-label={`Preview ${item.name}`}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide" : "Preview"}
        </button>
        <button
          type="button"
          className="btn"
          aria-label={`Remove ${item.name}`}
          disabled={busy}
          onClick={onRemove}
        >
          Remove
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
    <section className="attachments-tray" aria-label="Attachments">
      <div className="attachment-head">
        <h3>Attachments ({items.length})</h3>
        <span
          className="model-badge"
          title="Attached files are only ever read by a model on this device"
        >
          Local only
        </span>
        {items.length > 0 && (
          <button type="button" className="btn" onClick={() => void clear()} disabled={busy}>
            Clear all
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
        Kept in Phoenix Core&apos;s memory only (never saved to disk) for up to {ttlMin} minutes.
        {ticked.length > 0
          ? ` Pressing "Ask about attachments" sends ${ticked.length === 1 ? "the ticked item" : `the ${ticked.length} ticked items`}, in full, to a model on this device. Nothing leaves this device.`
          : " Nothing is sent until you ask."}
      </p>
      {ticked.length > DROP_LIMITS.askAttachments && (
        <p className="warning-text small" role="alert">
          A question can use at most {DROP_LIMITS.askAttachments} items. Untick{" "}
          {ticked.length - DROP_LIMITS.askAttachments} to ask.
        </p>
      )}
    </section>
  );
}

// ── Draft email ──────────────────────────────────────────────────────────────────────────────────

/** An editable draft of the answer, handed to the user's own mail app. Phoenix never sends it. */
export function DraftEmail({ answer }: { answer: AttachmentAnswer }) {
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
      setProblem("Could not open your mail app.");
    }
  };

  if (!open)
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Draft email
      </button>
    );
  return (
    <form className="draft-email" onSubmit={(e) => void submit(e)}>
      <label htmlFor={toId} className="small">
        To (optional)
      </label>
      <input
        id={toId}
        type="email"
        value={to}
        autoComplete="off"
        onChange={(e) => setTo(e.target.value)}
      />
      <label htmlFor={bodyId} className="small">
        Message (this exact text goes in the draft)
      </label>
      <textarea
        id={bodyId}
        rows={5}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-describedby={`${bodyId}-count`}
      />
      <p id={`${bodyId}-count`} className="muted small">
        {body.length} / {MAIL_LIMITS.bodyChars} characters. Opens your mail app with a draft.
        Phoenix does not send it.
      </p>
      {problem && (
        <p className="error-text small" role="alert">
          {problem}
        </p>
      )}
      <div className="button-row wrap">
        <button type="submit" className="btn btn-primary">
          Open mail draft
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A reply to "Ask about attachments", as chat text: the answer, who produced it, and its sources. */
export function AttachmentAnswerView({ answer }: { answer: AttachmentAnswer }) {
  return (
    <div className="attachment-answer">
      <p className="memory-text">{answer.answer}</p>
      <p className="muted small">
        Processed by {answer.processed_by}
        {answer.vision_model
          ? ` · images read by ${answer.vision_model} on this device`
          : ""} · {answer.locality === "local" ? "free, on this device" : "cloud"}
      </p>
      <p className="muted small">
        From: {answer.sources.map((s) => s.name).join(", ")}. Generated text, not a stored fact.
      </p>
      <DraftEmail answer={answer} />
    </div>
  );
}

/** The Overview's drop target: give Fawkes a file here, then ask about it in the Chat tab. */
export function FawkesDropTarget() {
  const att = useAttachments();
  const count = att.data?.attachments.length ?? 0;
  return (
    <section aria-labelledby="fawkes-drop-h">
      <h3 id="fawkes-drop-h">Give Fawkes a file</h3>
      <DropZone label="Fawkes" onDone={() => void att.reload()}>
        <p className="fawkes-drop-target">
          Drop a file, image or folder on Fawkes, then ask about it in the Chat tab.{" "}
          <span className="model-badge">Local only</span>
          {count > 0 ? ` ${count} attached.` : ""}
        </p>
      </DropZone>
    </section>
  );
}
