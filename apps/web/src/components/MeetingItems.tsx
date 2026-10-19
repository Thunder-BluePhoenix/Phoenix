// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { formatNumber } from "../core/format";
import { useAction, useAiStatus, useMeetingItems, useMemorySettings } from "../core/hooks";
import {
  editBody,
  type ItemEditBody,
  extractedByLabel,
  ITEM_ACTIONS,
  KIND_KEY,
  KIND_LOWER_KEY,
  MAX_DUE,
  MAX_ITEM_TEXT,
  MAX_OWNER,
  STATUS_KEY,
  STATUS_LOWER_KEY,
  STATUS_SHORT_KEY,
  validateItemEdit,
  type ItemEditProblems,
} from "../core/review";
import {
  MEETING_ITEM_STATUSES,
  type MeetingExtraction,
  type MeetingItem,
  type MeetingItemStatus,
  type MeetingReviewResult,
} from "../core/types";
import { useT } from "../i18n";
import { Feedback } from "./Feedback";
import { MakePlan } from "./Plans";

type Filter = "all" | MeetingItemStatus;

function EditForm({
  item,
  busy,
  error,
  onSave,
  onCancel,
}: {
  item: MeetingItem;
  busy: boolean;
  error: string | null;
  onSave: (body: ItemEditBody) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const id = useId();
  const [text, setText] = useState(item.text);
  const [owner, setOwner] = useState(item.owner ?? "");
  const [due, setDue] = useState(item.due ?? "");
  const [problems, setProblems] = useState<ItemEditProblems>({});
  const first = useRef<HTMLTextAreaElement>(null);
  const isAction = item.kind === "action_item";
  useEffect(() => first.current?.focus(), []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const edit = { text, owner, due };
    const found = validateItemEdit(item.kind, edit, t);
    setProblems(found);
    if (Object.keys(found).length === 0) onSave(editBody(item, edit));
  };

  return (
    <form className="review-edit" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={`${id}-text`}>
          {t("memory.items.edit.wording")}{" "}
          <span className="muted small">
            {t("memory.items.edit.wordingLimit", { max: MAX_ITEM_TEXT })}
          </span>
        </label>
        <textarea
          id={`${id}-text`}
          ref={first}
          rows={3}
          value={text}
          aria-invalid={problems.text ? true : undefined}
          aria-describedby={problems.text ? `${id}-text-err` : undefined}
          onChange={(e) => setText(e.target.value)}
        />
        {problems.text && (
          <p id={`${id}-text-err`} className="error-text small" role="alert">
            {problems.text}
          </p>
        )}
      </div>
      {isAction && (
        <>
          <div className="field">
            <label htmlFor={`${id}-owner`}>
              {t("memory.items.edit.owner")}{" "}
              <span className="muted small">
                {t("memory.items.edit.ownerLimit", { max: MAX_OWNER })}
              </span>
            </label>
            <input
              id={`${id}-owner`}
              type="text"
              value={owner}
              aria-invalid={problems.owner ? true : undefined}
              aria-describedby={problems.owner ? `${id}-owner-err` : undefined}
              onChange={(e) => setOwner(e.target.value)}
            />
            {problems.owner && (
              <p id={`${id}-owner-err`} className="error-text small" role="alert">
                {problems.owner}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor={`${id}-due`}>
              {t("memory.items.edit.due")}{" "}
              <span className="muted small">
                {t("memory.items.edit.dueLimit", { max: MAX_DUE })}
              </span>
            </label>
            <input
              id={`${id}-due`}
              type="text"
              value={due}
              aria-invalid={problems.due ? true : undefined}
              aria-describedby={problems.due ? `${id}-due-err` : undefined}
              onChange={(e) => setDue(e.target.value)}
            />
            {problems.due && (
              <p id={`${id}-due-err`} className="error-text small" role="alert">
                {problems.due}
              </p>
            )}
          </div>
        </>
      )}
      <div className="button-row wrap">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {t("memory.items.edit.save")}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t("common.button.cancel")}
        </button>
      </div>
      {item.status === "accepted" && (
        <p className="muted small">{t("memory.items.edit.acceptedNote")}</p>
      )}
      <Feedback error={error} />
    </form>
  );
}

function ItemCard({
  item,
  onDone,
}: {
  item: MeetingItem;
  onDone: (result: MeetingReviewResult, message: string) => void;
}) {
  const t = useT();
  const { run, busy, error } = useAction();
  const [editing, setEditing] = useState(false);
  const card = useRef<HTMLLIElement>(null);
  const allowed = ITEM_ACTIONS[item.status];
  const path = `/api/meeting-items/${encodeURIComponent(item.id)}`;
  const what = { kind: t(KIND_LOWER_KEY[item.kind]), text: item.text };

  const finished = (result: MeetingReviewResult | undefined, message: string) => {
    if (!result) return;
    setEditing(false);
    onDone(result, message);
    // The button that was used may be gone now (an accepted item has no Accept): keep focus here.
    card.current?.focus();
  };
  const act = async (verb: "accept" | "reject" | "reopen", message: string) =>
    finished(await run<MeetingReviewResult>("POST", `${path}/${verb}`, {}), message);

  return (
    <li
      ref={card}
      tabIndex={-1}
      className={`card review-item review-${item.status}`}
      aria-labelledby={`${item.id}-text`}
    >
      <p className="review-meta small">
        <span className="mem-badge">{t(KIND_KEY[item.kind])}</span>{" "}
        <strong className="review-status">{t(STATUS_KEY[item.status])}</strong>{" "}
        <span className="muted">· {extractedByLabel(item.extracted_by, t)}</span>
      </p>
      <p id={`${item.id}-text`} className="memory-text review-text">
        {item.text}
      </p>
      {item.kind === "action_item" && (item.owner || item.due) && (
        <p className="small">
          {item.owner && item.due
            ? t("memory.items.ownerDue", { owner: item.owner, due: item.due })
            : item.owner
              ? t("memory.items.ownerOnly", { owner: item.owner })
              : t("memory.items.dueOnly", { due: item.due ?? "" })}
        </p>
      )}
      {item.original && (
        <p className="muted small memory-text">
          {t("memory.items.extractedAs", { text: item.original.text })}
        </p>
      )}
      {item.evidence ? (
        <figure className="review-evidence">
          <figcaption className="small muted">
            {item.evidence.source === "transcript"
              ? t("memory.items.quote.transcript")
              : t("memory.items.quote.summary")}
          </figcaption>
          <blockquote className="quote">{item.evidence.quote}</blockquote>
        </figure>
      ) : (
        <p className="muted small">{t("memory.items.noQuote")}</p>
      )}
      <p className="muted small">
        {t.rich(
          item.reviewed_at ? "memory.items.meetingLineReviewed" : "memory.items.meetingLine",
          {
            link: (
              <a href={`#/meetings/${encodeURIComponent(item.meeting_id)}`}>{item.meeting_id}</a>
            ),
            by: item.reviewed_by ?? t("memory.items.you"),
          },
        )}
      </p>
      {editing ? (
        <EditForm
          item={item}
          busy={busy}
          error={error}
          onSave={(body) =>
            void run<MeetingReviewResult>("POST", `${path}/edit`, body).then((r) =>
              finished(r, t("memory.items.done.edited", what)),
            )
          }
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="button-row wrap">
          {allowed.accept && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              aria-label={t("memory.items.label.accept", what)}
              onClick={() => void act("accept", t("memory.items.done.accepted", what))}
            >
              {t("memory.items.accept")}
            </button>
          )}
          {allowed.edit && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              aria-label={t("memory.items.label.edit", what)}
              onClick={() => setEditing(true)}
            >
              {t("common.button.edit")}
            </button>
          )}
          {allowed.reject && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              aria-label={t("memory.items.label.reject", what)}
              onClick={() => void act("reject", t("memory.items.done.rejected", what))}
            >
              {t("memory.items.reject")}
            </button>
          )}
          {allowed.reopen && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              aria-label={t("memory.items.label.reopen", what)}
              onClick={() => void act("reopen", t("memory.items.done.reopened", what))}
            >
              {t("memory.items.reopen")}
            </button>
          )}
        </div>
      )}
      {!editing && <Feedback error={error} />}
      {!editing && <MakePlan item={item} />}
    </li>
  );
}

/** What an extraction run did, in words: what it found, what it refused, what it could not read. */
function ExtractionReport({ report }: { report: MeetingExtraction }) {
  const t = useT();
  const dropped = Object.values(report.ai?.stats.dropped ?? {}).reduce((a, b) => a + b, 0);
  return (
    <div className="small" role="status">
      <p>
        {t("memory.items.report.summary", {
          imported: formatNumber(report.kage.imported),
          duplicates: formatNumber(report.kage.duplicates),
        })}
      </p>
      {report.ai === null && <p>{t("memory.items.report.noTranscript")}</p>}
      {report.ai?.unavailable && <p>{report.ai.unavailable}</p>}
      {report.ai && !report.ai.unavailable && (
        <p>{t("memory.items.report.aiAdded", { count: report.ai.stored })}</p>
      )}
      {report.ai && report.ai.stats.chars_skipped > 0 && (
        <p>{t("memory.items.report.skipped", { count: report.ai.stats.chars_skipped })}</p>
      )}
      {dropped > 0 && <p>{t("memory.items.report.dropped", { count: dropped })}</p>}
    </div>
  );
}

function Extract({
  meetingId,
  aiOn,
  onDone,
}: {
  meetingId: string;
  aiOn: boolean;
  onDone: () => void;
}) {
  const t = useT();
  const { run, busy, error } = useAction();
  const [report, setReport] = useState<MeetingExtraction | null>(null);
  const go = async () => {
    setReport(null);
    const r = await run<MeetingExtraction>(
      "POST",
      `/api/meetings/${encodeURIComponent(meetingId)}/items/extract`,
      {},
    );
    if (r) {
      setReport(r);
      onDone();
    }
  };
  return (
    <div>
      <button
        type="button"
        className="btn"
        disabled={busy || !aiOn}
        aria-describedby={`${meetingId}-extract-note`}
        onClick={() => void go()}
      >
        {busy ? t("memory.items.extract.busy") : t("memory.items.extract.button")}
      </button>
      <p id={`${meetingId}-extract-note`} className="muted small">
        {aiOn ? t("memory.items.extract.noteOn") : t("memory.items.extract.noteOff")}
      </p>
      <Feedback error={error} />
      {report && <ExtractionReport report={report} />}
    </div>
  );
}

/** The decisions and action items of one meeting, to accept, edit or reject (Phase 35). */
export function MeetingItemsReview({
  meetingId,
  hasTranscript,
}: {
  meetingId: string;
  hasTranscript: boolean;
}) {
  const t = useT();
  const { data, error, reload } = useMeetingItems(meetingId);
  const { data: ai } = useAiStatus();
  const { data: memorySettings } = useMemorySettings();
  const [filter, setFilter] = useState<Filter>("all");
  const [announcement, setAnnouncement] = useState("");
  const aiOn = ai?.enabled === true;
  const contentAllowed = memorySettings === null ? null : memorySettings.allow_sensitive_meetings;

  const done = (result: MeetingReviewResult, message: string) => {
    // Memory only holds accepted items, so only an accepted one can be "not remembered".
    const refused = result.item.status === "accepted" ? result.memory.refused : [];
    setAnnouncement(
      refused.length > 0
        ? t("memory.items.announceRefused", { message, refused: refused.join("; ") })
        : t("memory.items.announce", { message }),
    );
    void reload();
  };

  const shown = data?.items.filter((i) => filter === "all" || i.status === filter) ?? [];
  const total = data ? data.items.length : 0;

  return (
    <section aria-labelledby="review-h" className="card review">
      <h2 id="review-h" className="h3">
        {t("memory.items.title")}
      </h2>
      {contentAllowed === false && (
        <p className="review-notice small" role="note">
          {t.rich("memory.items.notAllowed.body", {
            lead: <strong>{t("memory.items.notAllowed.lead")}</strong>,
            setting: t("memory.common.includeSensitive"),
            settings: <a href="#/settings">{t("memory.common.settings")}</a>,
          })}
        </p>
      )}
      {!aiOn && ai !== null && (
        <p className="review-notice small" role="note">
          {t.rich("memory.items.aiOff.body", {
            lead: <strong>{t("memory.items.aiOff.lead")}</strong>,
          })}
        </p>
      )}
      <p className="muted small">{t("memory.items.intro")}</p>
      {hasTranscript && <Extract meetingId={meetingId} aiOn={aiOn} onDone={() => void reload()} />}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <div role="group" aria-label={t("memory.items.filter")} className="chips wrap">
            <button
              type="button"
              className="chip"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              {t("memory.common.countChip", {
                label: t("memory.common.all"),
                count: formatNumber(total),
              })}
            </button>
            {MEETING_ITEM_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                aria-pressed={filter === s}
                onClick={() => setFilter(s)}
              >
                {t("memory.common.countChip", {
                  label: t(STATUS_SHORT_KEY[s]),
                  count: formatNumber(data.counts[s]),
                })}
              </button>
            ))}
          </div>
          <p className="review-live small" role="status" aria-live="polite">
            {announcement}
          </p>
          {total === 0 ? (
            <p className="muted">
              {hasTranscript
                ? t("memory.items.empty.withTranscript")
                : t("memory.items.empty.noTranscript")}
            </p>
          ) : shown.length === 0 ? (
            <p className="muted">
              {t("memory.items.emptyFilter", {
                status: filter === "all" ? "" : t(STATUS_LOWER_KEY[filter]),
              })}
            </p>
          ) : (
            <ul className="card-list" aria-label={t("memory.items.title")}>
              {shown.map((item) => (
                <ItemCard key={item.id} item={item} onDone={done} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
