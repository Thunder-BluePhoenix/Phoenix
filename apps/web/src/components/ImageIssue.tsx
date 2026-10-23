// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { collectDropped, collectPasted, dragHasFiles, type FileLike } from "../core/attachments";
import { safeHttpsUrl } from "../core/format";
import { useCapabilities, useCommandAction } from "../core/hooks";
import {
  buildImageIssueDraft,
  createUnavailable,
  GITHUB_CAPABILITY,
  imageSource,
  ISSUE_COMMAND,
  newIdempotencyKey,
  readCreated,
  readIssueImage,
  watchedRepositories,
  type CreatedIssue,
  type ImageIssueDraft,
  type ImageRead,
  type IssueImage,
} from "../core/image-issue";
import { useT, type MessageKey } from "../i18n";

/**
 * A GitHub issue drafted from an image the user already has (dropped, pasted or chosen). There is no
 * screen capture. The image never leaves this page: `issue.create` takes text only, and the preview
 * says so. Core decides the confirmation (an `external` command, answered in Approvals); this view
 * only waits and reports what Core's operation says.
 */
export function ImageIssueSection() {
  const t = useT();
  const ids = useId();
  const caps = useCapabilities();
  const create = useCommandAction(GITHUB_CAPABILITY, ISSUE_COMMAND);
  const picker = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const reading = useRef(0);
  const [over, setOver] = useState(false);
  const [image, setImage] = useState<IssueImage | null>(null);
  const [repository, setRepository] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState<ImageIssueDraft | null>(null);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [problemText, setProblemText] = useState("");
  const [problemMax, setProblemMax] = useState<number | null>(null);
  const [made, setMade] = useState<CreatedIssue | null>(null);

  const unavailable = createUnavailable(caps.data);
  const repositories = watchedRepositories(caps.data);

  /** Any edit makes the old preview wrong: drop it (and the last outcome) so nothing stale is sent. */
  const edited = () => {
    setDraft(null);
    setProblem(null);
    setProblemText("");
    setProblemMax(null);
    setMade(null);
    create.reset();
  };

  const take = async (read: Promise<ImageRead | null>) => {
    const mine = ++reading.current;
    const result = await read;
    if (mine !== reading.current || result === null) return;
    edited();
    if (result.ok) {
      setImage(result.image);
      setProblemText("");
    } else {
      setProblemText(result.message);
    }
  };

  const onDragEnter = (e: DragEvent<HTMLElement>) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    depth.current++;
    setOver(true);
  };
  const onDragOver = (e: DragEvent<HTMLElement>) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: DragEvent<HTMLElement>) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    // Read now: the browser empties the DataTransfer when this handler returns.
    void take(readIssueImage(collectDropped(e.dataTransfer), "drop"));
  };
  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    // Files only: pasted text is never taken (the second argument says the paste is into a field).
    const source = collectPasted(e.clipboardData, true);
    if (!source) return;
    e.preventDefault();
    void take(readIssueImage(source, "paste"));
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const files: FileLike[] = Array.from(e.target.files ?? []);
    e.target.value = "";
    void take(readIssueImage({ files, folders: [] }, "drop"));
  };

  const preview = () => {
    create.reset();
    setMade(null);
    const built = buildImageIssueDraft(
      { image, repository, title, body },
      draft?.input.idempotency_key ?? newIdempotencyKey(),
    );
    if (built.ok) {
      setProblem(null);
      setProblemText("");
      setDraft(built.draft);
      return;
    }
    setDraft(null);
    setProblem(built.problem.key);
    const max = built.problem.vars?.max;
    setProblemMax(typeof max === "number" ? max : null);
  };

  const confirm = () => {
    // The exact object the preview shows; Core validates it again and asks the person.
    if (draft && unavailable === null && !create.busy) void create.submit(draft.input);
  };

  // A created issue clears the form: a second press would be a second issue.
  const result = create.state === "succeeded" ? readCreated(create.result) : null;
  useEffect(() => {
    if (!result) return;
    setMade(result);
    setDraft(null);
    setImage(null);
    setTitle("");
    setBody("");
    create.reset();
    // `result` is a new object per render; the run state is what changes once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [create.state]);

  const outcome = () => {
    if (create.busy) {
      return (
        <p className="muted small" role="status">
          {t("focus.issueDraft.waiting")}
        </p>
      );
    }
    if (create.state === "failed") {
      const text =
        create.code === "PERMISSION_DENIED"
          ? t("focus.issueDraft.denied")
          : create.code === "SECURITY_POLICY_BLOCKED"
            ? t("focus.issueDraft.blocked")
            : create.code === "OPERATION_TIMEOUT"
              ? t("focus.issueDraft.timeout")
              : t("focus.issueDraft.failed", { message: create.error ?? "" });
      return (
        <p className="error-text small" role="alert">
          {text}
        </p>
      );
    }
    if (create.state === "succeeded" && !result) {
      return (
        <p className="error-text small" role="alert">
          {t("focus.issueDraft.failed", { message: "" })}
        </p>
      );
    }
    if (made) {
      const url = safeHttpsUrl(made.url);
      return (
        <p className="small" role="status">
          {t(
            made.status === "existing"
              ? "handoff.attach.issueExisting"
              : "handoff.attach.issueCreated",
            {
              number: made.number,
              repository: made.repository,
            },
          )}{" "}
          {t.rich("handoff.attach.issueAddress", {
            url: url ? (
              <a href={url} target="_blank" rel="noreferrer">
                {made.url}
              </a>
            ) : (
              made.url
            ),
          })}
        </p>
      );
    }
    return null;
  };

  return (
    <section className="card" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`} className="h3">
        {t("focus.issueDraft.title")}
      </h2>
      <p className="small">{t("focus.issueDraft.intro")}</p>
      {unavailable && (
        <p className="warning-text small" role="note">
          {t(unavailable)}
        </p>
      )}

      <div
        className={over ? "drop-zone drop-zone-over" : "drop-zone"}
        role="group"
        aria-label={t("focus.issueDraft.dropLabel")}
        tabIndex={-1}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onPaste={onPaste}
      >
        {image ? (
          <>
            <img
              src={imageSource(image)}
              alt={t("focus.issueDraft.imageAlt", { name: image.name })}
              style={{ maxWidth: "100%", maxHeight: 240, objectFit: "contain" }}
            />
            <div className="button-row">
              <button
                type="button"
                className="btn"
                disabled={create.busy}
                onClick={() => {
                  reading.current++;
                  edited();
                  setImage(null);
                }}
              >
                {t("focus.issueDraft.imageRemove")}
              </button>
            </div>
          </>
        ) : (
          <p className="muted small drop-hint">
            {t.rich("focus.issueDraft.dropHint", {
              choose: (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => picker.current?.click()}
                >
                  {t("focus.issueDraft.choose")}
                </button>
              ),
            })}
          </p>
        )}
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          aria-label={t("focus.issueDraft.chooseLabel")}
          onChange={onPick}
        />
      </div>
      {problemText && (
        <p className="warning-text small" role="alert">
          {problemText}
        </p>
      )}

      <label className="field" htmlFor={`${ids}-repo`}>
        {t("handoff.attach.repositoryLabel")}
        <input
          id={`${ids}-repo`}
          type="text"
          list={`${ids}-repos`}
          value={repository}
          disabled={create.busy}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            edited();
            setRepository(e.target.value);
          }}
        />
        <datalist id={`${ids}-repos`}>
          {repositories.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </label>
      <label className="field" htmlFor={`${ids}-title`}>
        {t("focus.screenshot.issueTitle")}
        <input
          id={`${ids}-title`}
          type="text"
          value={title}
          disabled={create.busy}
          autoComplete="off"
          onChange={(e) => {
            edited();
            setTitle(e.target.value);
          }}
        />
      </label>
      <label className="field" htmlFor={`${ids}-body`}>
        {t("focus.screenshot.body")}
        <textarea
          id={`${ids}-body`}
          rows={5}
          value={body}
          disabled={create.busy}
          onChange={(e) => {
            edited();
            setBody(e.target.value);
          }}
        />
      </label>
      <div className="button-row">
        <button type="button" className="btn" disabled={create.busy} onClick={preview}>
          {t("focus.screenshot.preview")}
        </button>
      </div>
      {problem && (
        <p className="error-text small" role="alert">
          {problem === "focus.issueDraft.titleTooLong" || problem === "focus.issueDraft.bodyTooLong"
            ? t(problem, { max: problemMax ?? 0 })
            : t(problem)}
        </p>
      )}

      {draft && (
        <div role="region" aria-label={t("focus.screenshot.draft")}>
          <p className="small">
            {t("focus.issueDraft.previewRepository", { repository: draft.input.repository })}
          </p>
          <p className="small">
            {t("focus.issueDraft.previewTitle", { title: draft.input.title })}
          </p>
          <p className="small">{t("focus.issueDraft.previewBody")}</p>
          {draft.input.body ? (
            <pre className="memory-text" tabIndex={0}>
              {draft.input.body}
            </pre>
          ) : (
            <p className="muted small">{t("focus.issueDraft.previewNoBody")}</p>
          )}
          <p className="small handoff-warning">
            {t("focus.issueDraft.imageLocal", { name: draft.image.name })}
          </p>
          <p className="small">{t("focus.issueDraft.approval")}</p>
          <div className="button-row">
            <button
              type="button"
              className="btn"
              disabled={create.busy || unavailable !== null}
              onClick={confirm}
            >
              {t("focus.issueDraft.create")}
            </button>
            <button type="button" className="btn" disabled={create.busy} onClick={edited}>
              {t("common.button.cancel")}
            </button>
          </div>
        </div>
      )}
      {outcome()}
    </section>
  );
}
