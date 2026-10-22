// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../core/client";
import { useClient } from "../core/context";
import { formatDate, formatTime, safeHttpsUrl } from "../core/format";
import {
  deliveryKey,
  HANDOFF_TARGETS,
  outcomeKey,
  readApplied,
  readNoteDetail,
  readPreview,
  readSettings,
  REPOSITORY_PATTERN,
  useHandoffNotes,
  useHandoffSettings,
  useSecretGuard,
  type HandoffAttachAppliedView,
  type HandoffAttachPreviewView,
  type HandoffNoteDetailView,
  type HandoffNoteView,
  type HandoffTarget,
} from "../core/handoff";
import { useAgentLiveSessions } from "../core/hooks";
import { useT } from "../i18n";
import { Feedback } from "./Feedback";

/** A preview the user can confirm: it remembers what was asked, so the confirmation repeats it. */
interface OpenPreview {
  noteId: string;
  target: HandoffTarget;
  repository: string | undefined;
  data: HandoffAttachPreviewView;
  /** The note changed after the preview, so its hash can no longer be confirmed. */
  stale: boolean;
}

/** What happened to the text after a confirmed attach. */
type Outcome =
  | { kind: "copied" }
  | { kind: "by-hand"; text: string }
  | { kind: "issue"; issue: NonNullable<HandoffAttachAppliedView["issue"]> };

/** Settings section: handoff notes (write, summarise, attach) and the secret guard's results. */
export function HandoffNotesSection() {
  const t = useT();
  const client = useClient();
  const ids = useId();
  const notes = useHandoffNotes();
  const settings = useHandoffSettings();
  const guard = useSecretGuard();
  const { sessions } = useAgentLiveSessions();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HandoffNoteDetailView | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [target, setTarget] = useState<HandoffTarget>("commit_message");
  const [repository, setRepository] = useState("");
  const [preview, setPreview] = useState<OpenPreview | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inFlight = useRef(false);
  const detailRef = useRef(detail);
  detailRef.current = detail;

  /** One request at a time; a 409 also runs `onConflict`. Other failures become the error text. */
  const call = useCallback(
    async (
      method: string,
      path: string,
      body?: unknown,
      onConflict?: () => void,
    ): Promise<{ value: unknown } | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      setSaved(null);
      try {
        return { value: await client.request<unknown>(method, path, body) };
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
          if (err.status === 409) onConflict?.();
        } else {
          setError(t("common.error.requestFailed"));
        }
        return null;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [client, t],
  );

  // The selected note's text and summary. A note this component just wrote or changed is already in
  // `detail`, so it is not fetched again.
  useEffect(() => {
    if (!selectedId || detailRef.current?.id === selectedId) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await client.request<unknown>(
          "GET",
          `/api/handoff/notes/${encodeURIComponent(selectedId)}`,
        );
        if (!cancelled) setDetail(readNoteDetail(raw));
      } catch (err) {
        if (!cancelled)
          setError(err instanceof ApiError ? err.message : t("common.error.requestFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, selectedId, t]);

  const select = (id: string) => {
    if (id === selectedId) return;
    setSelectedId(id);
    setDetail(null);
    setPreview(null);
    setOutcome(null);
    setError(null);
    setSaved(null);
  };

  const show = (next: HandoffNoteDetailView) => {
    setSelectedId(next.id);
    setDetail(next);
    setPreview(null);
    setOutcome(null);
  };

  const changeSetting = async (patch: { auto?: boolean; allow_cloud?: boolean }) => {
    const res = await call("POST", "/api/handoff/settings", patch);
    if (!res) return;
    settings.set(readSettings(res.value));
    setSaved(t("handoff.settings.saved"));
  };

  const generate = async () => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const res = await call("POST", "/api/handoff/notes", {
      session_id: session.id,
      agent: session.agent,
    });
    const made = res && readNoteDetail(res.value);
    if (!made) return;
    show(made);
    setSaved(t("handoff.generate.done"));
    void notes.reload();
  };

  const summarise = async (note: HandoffNoteDetailView) => {
    const res = await call("POST", `/api/handoff/notes/${encodeURIComponent(note.id)}/summary`, {});
    const next = res && readNoteDetail(res.value);
    if (!next) return;
    setDetail(next);
    setSaved(t("handoff.summary.added"));
    void notes.reload();
  };

  const remove = async (note: HandoffNoteDetailView) => {
    const res = await call("DELETE", `/api/handoff/notes/${encodeURIComponent(note.id)}`);
    if (!res) return;
    setSelectedId(null);
    setDetail(null);
    setPreview(null);
    setOutcome(null);
    setSaved(t("handoff.delete.done"));
    void notes.reload();
  };

  const startPreview = async (note: HandoffNoteDetailView) => {
    const repo = repository.trim();
    if (target === "task" && !REPOSITORY_PATTERN.test(repo)) {
      setError(t("handoff.attach.repositoryInvalid"));
      return;
    }
    const repositoryField = target === "task" ? repo : undefined;
    setOutcome(null);
    const res = await call("POST", `/api/handoff/notes/${encodeURIComponent(note.id)}/attach`, {
      target,
      ...(repositoryField ? { repository: repositoryField } : {}),
    });
    const data = res && readPreview(res.value);
    if (data) {
      setPreview({ noteId: note.id, target, repository: repositoryField, data, stale: false });
    }
  };

  const confirm = async (open: OpenPreview) => {
    const res = await call(
      "POST",
      `/api/handoff/notes/${encodeURIComponent(open.noteId)}/attach`,
      {
        target: open.target,
        ...(open.repository ? { repository: open.repository } : {}),
        confirm_hash: open.data.hash,
      },
      () => setPreview({ ...open, stale: true }),
    );
    const applied = res && readApplied(res.value);
    if (!applied) return;
    setPreview(null);
    if (applied.issue) {
      setOutcome({ kind: "issue", issue: applied.issue });
      void notes.reload();
      return;
    }
    try {
      await navigator.clipboard.writeText(applied.text);
      setOutcome({ kind: "copied" });
      setSaved(t("handoff.attach.copied"));
    } catch {
      setOutcome({ kind: "by-hand", text: applied.text });
    }
  };

  const cancelPreview = () => {
    setPreview(null);
    setError(null);
  };

  const changeTarget = (next: HandoffTarget) => {
    setTarget(next);
    setPreview(null);
    setOutcome(null);
  };

  const changeRepository = (next: string) => {
    setRepository(next);
    setPreview(null);
    setOutcome(null);
  };

  const summary = detail?.summary ?? null;
  const issueUrl = outcome?.kind === "issue" ? safeHttpsUrl(outcome.issue.url) : null;

  return (
    <section aria-labelledby="handoff-notes-h" className="card handoff-notes">
      <h2 id="handoff-notes-h" className="h3">
        {t("handoff.title")}
      </h2>
      <p className="muted small">{t("handoff.intro")}</p>
      <Feedback error={error} saved={saved} />

      <fieldset>
        <legend className="small">{t("handoff.settings.legend")}</legend>
        {settings.data ? (
          <>
            <label className="choice">
              <input
                type="checkbox"
                checked={settings.data.auto}
                disabled={busy}
                onChange={(e) => void changeSetting({ auto: e.target.checked })}
              />
              {t("handoff.settings.auto")}
            </label>
            <label className="choice">
              <input
                type="checkbox"
                checked={settings.data.allow_cloud}
                disabled={busy}
                aria-describedby={`${ids}-cloud`}
                onChange={(e) => void changeSetting({ allow_cloud: e.target.checked })}
              />
              {t("handoff.settings.allowCloud")}
            </label>
            <p id={`${ids}-cloud`} className="small handoff-warning">
              {t("handoff.settings.cloudWarning")}
            </p>
          </>
        ) : (
          settings.error && <p className="muted small">{t("handoff.settings.unavailable")}</p>
        )}
      </fieldset>

      <h3 className="h3">{t("handoff.notes.title")}</h3>
      {notes.error && <p className="muted small">{t("handoff.notes.unavailable")}</p>}
      {notes.data.length === 0 ? (
        <p className="muted small">{t("handoff.notes.empty")}</p>
      ) : (
        <ul className="card-list" aria-label={t("handoff.notes.listLabel")}>
          {notes.data.map((n: HandoffNoteView) => (
            <li key={n.id} className="card">
              <button
                type="button"
                className="btn"
                aria-pressed={n.id === selectedId}
                onClick={() => select(n.id)}
              >
                {t("handoff.notes.open", {
                  date: formatDate(n.created_at),
                  time: formatTime(n.created_at),
                  agent: n.agent,
                })}
              </button>
              <p className="small">
                {t("handoff.notes.meta", {
                  project: n.project || t("handoff.notes.noProject"),
                  files: t("handoff.notes.files", { count: n.files_total }),
                  lines: t("handoff.notes.lines", { added: n.added, removed: n.removed }),
                })}
                {n.summary && (
                  <>
                    {" "}
                    <span className="chip">{t("handoff.notes.hasSummary")}</span>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      {selectedId && (
        <div role="region" aria-label={t("handoff.notes.detailLabel")}>
          {detail ? (
            <>
              <p className="small">
                {t(
                  detail.trigger === "user"
                    ? "handoff.notes.trigger.user"
                    : "handoff.notes.trigger.auto",
                )}
              </p>
              <pre className="memory-text" tabIndex={0} aria-label={t("handoff.notes.textLabel")}>
                {detail.text}
              </pre>
              {summary && (
                <div className="handoff-summary">
                  <h4 className="h3">{t("handoff.summary.title")}</h4>
                  <p className="small">
                    {t("handoff.summary.processedBy", { by: summary.processed_by })}
                  </p>
                  <pre className="memory-text" tabIndex={0}>
                    {summary.text}
                  </pre>
                  <p className="small handoff-warning">{t("handoff.summary.warning")}</p>
                </div>
              )}
              <div className="button-row wrap">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void summarise(detail)}
                >
                  {t("handoff.summary.add")}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void remove(detail)}
                >
                  {t("handoff.delete.button")}
                </button>
              </div>
              <p className="muted small">{t("handoff.summary.note")}</p>

              <h4 className="h3">{t("handoff.attach.title")}</h4>
              <label className="field" htmlFor={`${ids}-target`}>
                {t("handoff.attach.targetLabel")}
                <select
                  id={`${ids}-target`}
                  value={target}
                  disabled={busy}
                  onChange={(e) =>
                    changeTarget(
                      HANDOFF_TARGETS.find(([value]) => value === e.target.value)?.[0] ??
                        "commit_message",
                    )
                  }
                >
                  {HANDOFF_TARGETS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {t(label)}
                    </option>
                  ))}
                </select>
              </label>
              {target === "task" && (
                <label className="field" htmlFor={`${ids}-repo`}>
                  {t("handoff.attach.repositoryLabel")}
                  <input
                    id={`${ids}-repo`}
                    type="text"
                    value={repository}
                    disabled={busy}
                    required
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => changeRepository(e.target.value)}
                  />
                </label>
              )}
              <div className="button-row">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void startPreview(detail)}
                >
                  {t("handoff.attach.preview")}
                </button>
              </div>
              {preview && preview.noteId === detail.id && (
                <div role="region" aria-label={t("handoff.attach.previewLabel")}>
                  {preview.data.title !== undefined && (
                    <p className="small">
                      {t("handoff.attach.issueTitle", { title: preview.data.title })}
                    </p>
                  )}
                  <p className="small">{t("handoff.attach.textLabel")}</p>
                  <pre className="memory-text" tabIndex={0}>
                    {preview.data.text}
                  </pre>
                  {preview.data.notes.length > 0 && (
                    <ul className="small">
                      {preview.data.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  )}
                  <p className="small">
                    {t(deliveryKey(preview.data), { repository: preview.repository ?? "" })}
                  </p>
                  {preview.stale && (
                    <p className="small handoff-warning">{t("handoff.attach.stale")}</p>
                  )}
                  <div className="button-row">
                    {preview.stale ? (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => void startPreview(detail)}
                      >
                        {t("handoff.attach.previewAgain")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => void confirm(preview)}
                      >
                        {t("handoff.attach.confirm")}
                      </button>
                    )}
                    <button type="button" className="btn" disabled={busy} onClick={cancelPreview}>
                      {t("common.button.cancel")}
                    </button>
                  </div>
                </div>
              )}
              {outcome?.kind === "by-hand" && (
                <div>
                  <p className="small">{t("handoff.attach.copyByHand")}</p>
                  <pre className="memory-text" tabIndex={0}>
                    {outcome.text}
                  </pre>
                </div>
              )}
              {outcome?.kind === "issue" && (
                <div role="status">
                  <p className="small">
                    {t(
                      outcome.issue.status === "existing"
                        ? "handoff.attach.issueExisting"
                        : "handoff.attach.issueCreated",
                      { number: outcome.issue.number, repository: outcome.issue.repository },
                    )}
                  </p>
                  <p className="small">
                    {t.rich("handoff.attach.issueAddress", {
                      url: issueUrl ? (
                        <a href={issueUrl} target="_blank" rel="noreferrer">
                          {outcome.issue.url}
                        </a>
                      ) : (
                        outcome.issue.url
                      ),
                    })}
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="muted small">{t("handoff.notes.loading")}</p>
          )}
        </div>
      )}

      <h3 className="h3">{t("handoff.generate.title")}</h3>
      {sessions.length === 0 ? (
        <p className="muted small">{t("handoff.generate.none")}</p>
      ) : (
        <div className="memory-form">
          <label className="field" htmlFor={`${ids}-session`}>
            {t("handoff.generate.sessionLabel")}
            <select
              id={`${ids}-session`}
              value={sessionId}
              disabled={busy}
              onChange={(e) => setSessionId(e.target.value)}
            >
              <option value="">{t("handoff.generate.choose")}</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {t("handoff.generate.option", {
                    agent: s.agent,
                    repository: s.repository || s.project,
                    time: `${formatDate(s.last_seen)} ${formatTime(s.last_seen)}`.trim(),
                  })}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button
              type="button"
              className="btn"
              disabled={busy || !sessionId}
              onClick={() => void generate()}
            >
              {t("handoff.generate.button")}
            </button>
          </div>
        </div>
      )}

      <h3 className="h3">{t("handoff.guard.title")}</h3>
      <p className="muted small">{t("handoff.guard.intro")}</p>
      <p className="muted small">{t("handoff.guard.override")}</p>
      <p className="muted small">{t("handoff.guard.heuristic")}</p>
      <p className="muted small">{t("handoff.guard.failOpen")}</p>
      {guard.data ? (
        <>
          <ul className="small handoff-counts" aria-label={t("handoff.guard.countsLabel")}>
            <li>{t("handoff.guard.allowed", { count: guard.data.allowed })}</li>
            <li>{t("handoff.guard.blocked", { count: guard.data.blocked })}</li>
            <li>{t("handoff.guard.overridden", { count: guard.data.overridden })}</li>
          </ul>
          <p className="small">
            {guard.data.since
              ? t("handoff.guard.since", {
                  date: formatDate(guard.data.since),
                  time: formatTime(guard.data.since),
                })
              : t("handoff.guard.noResults")}
          </p>
          {guard.data.recent.length > 0 && (
            <ul className="card-list" aria-label={t("handoff.guard.recentLabel")}>
              {guard.data.recent.map((r, i) => (
                <li key={`${r.at}-${i}`} className="card">
                  <p className="small">
                    {t("handoff.guard.row", {
                      date: formatDate(r.at),
                      time: formatTime(r.at),
                      agent: r.agent,
                      tool: r.tool,
                    })}
                  </p>
                  <p className="small">{t(outcomeKey(r.outcome))}</p>
                  <ul className="small">
                    {r.findings.map((f, j) => (
                      <li key={`${f.kind}-${f.location}-${j}`}>
                        {t("handoff.guard.finding", { kind: f.kind, location: f.location })}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        guard.error && <p className="muted small">{t("handoff.guard.unavailable")}</p>
      )}
    </section>
  );
}
