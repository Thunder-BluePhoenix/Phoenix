// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useAction, useAiStatus, useMeetingItems, useMemorySettings } from "../core/hooks";
import {
  editBody,
  type ItemEditBody,
  extractedByLabel,
  ITEM_ACTIONS,
  KIND_LABEL,
  MAX_DUE,
  MAX_ITEM_TEXT,
  MAX_OWNER,
  STATUS_LABEL,
  STATUS_SHORT,
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
import { Feedback } from "./Feedback";

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
    const found = validateItemEdit(item.kind, edit);
    setProblems(found);
    if (Object.keys(found).length === 0) onSave(editBody(item, edit));
  };

  return (
    <form className="review-edit" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={`${id}-text`}>
          Wording <span className="muted small">(up to {MAX_ITEM_TEXT} characters)</span>
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
              Owner <span className="muted small">(optional, up to {MAX_OWNER})</span>
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
              Due <span className="muted small">(optional, up to {MAX_DUE})</span>
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
          Save changes
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {item.status === "accepted" && (
        <p className="muted small">
          This item is accepted: saving replaces the wording Phoenix remembers.
        </p>
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
  const { run, busy, error } = useAction();
  const [editing, setEditing] = useState(false);
  const card = useRef<HTMLLIElement>(null);
  const allowed = ITEM_ACTIONS[item.status];
  const path = `/api/meeting-items/${encodeURIComponent(item.id)}`;
  const what = `${KIND_LABEL[item.kind].toLowerCase()}: ${item.text}`;

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
        <span className="mem-badge">{KIND_LABEL[item.kind]}</span>{" "}
        <strong className="review-status">{STATUS_LABEL[item.status]}</strong>{" "}
        <span className="muted">· {extractedByLabel(item.extracted_by)}</span>
      </p>
      <p id={`${item.id}-text`} className="memory-text review-text">
        {item.text}
      </p>
      {item.kind === "action_item" && (item.owner || item.due) && (
        <p className="small">
          {item.owner && <>Owner: {item.owner}</>}
          {item.owner && item.due && " · "}
          {item.due && <>Due: {item.due}</>}
        </p>
      )}
      {item.original && (
        <p className="muted small memory-text">Extracted as: {item.original.text}</p>
      )}
      {item.evidence ? (
        <figure className="review-evidence">
          <figcaption className="small muted">
            Quote from the {item.evidence.source} (stored text, shown as written):
          </figcaption>
          <blockquote className="quote">{item.evidence.quote}</blockquote>
        </figure>
      ) : (
        <p className="muted small">No quote is stored for this item.</p>
      )}
      <p className="muted small">
        Meeting <a href={`#/meetings/${encodeURIComponent(item.meeting_id)}`}>{item.meeting_id}</a>
        {item.reviewed_at && <> · reviewed by {item.reviewed_by ?? "you"}</>}
      </p>
      {editing ? (
        <EditForm
          item={item}
          busy={busy}
          error={error}
          onSave={(body) =>
            void run<MeetingReviewResult>("POST", `${path}/edit`, body).then((r) =>
              finished(r, `Saved your changes to the ${what}`),
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
              aria-label={`Accept ${what}`}
              onClick={() => void act("accept", `Accepted the ${what}`)}
            >
              Accept
            </button>
          )}
          {allowed.edit && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              aria-label={`Edit ${what}`}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          )}
          {allowed.reject && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              aria-label={`Reject ${what}`}
              onClick={() => void act("reject", `Rejected the ${what}`)}
            >
              Reject
            </button>
          )}
          {allowed.reopen && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              aria-label={`Reopen ${what}`}
              onClick={() => void act("reopen", `Reopened the ${what}; it needs review again`)}
            >
              Reopen for review
            </button>
          )}
        </div>
      )}
      {!editing && <Feedback error={error} />}
    </li>
  );
}

/** What an extraction run did, in words: what it found, what it refused, what it could not read. */
function ExtractionReport({ report }: { report: MeetingExtraction }) {
  const dropped = Object.values(report.ai?.stats.dropped ?? {}).reduce((a, b) => a + b, 0);
  return (
    <div className="small" role="status">
      <p>
        From Kage: {report.kage.imported} new, {report.kage.duplicates} already here.
      </p>
      {report.ai === null && <p>This meeting has no transcript, so no AI search was made.</p>}
      {report.ai?.unavailable && <p>{report.ai.unavailable}</p>}
      {report.ai && !report.ai.unavailable && (
        <p>AI added {report.ai.stored} proposed item(s) with a quote from the transcript.</p>
      )}
      {report.ai && report.ai.stats.chars_skipped > 0 && (
        <p>
          Part of this transcript was not analysed ({report.ai.stats.chars_skipped} characters).
        </p>
      )}
      {dropped > 0 && (
        <p>
          {dropped} suggestion(s) were discarded because their quote is not in the transcript or
          does not support them.
        </p>
      )}
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
        {busy ? "Looking through the transcript…" : "Look for more with AI"}
      </button>
      <p id={`${meetingId}-extract-note`} className="muted small">
        {aiOn
          ? "A model reads the transcript on this computer and proposes items, each with a quote that must appear in it. Nothing is accepted for you. This can take a minute."
          : "AI is off, so only the items Kage found are listed. Turn AI on in Settings to let a model look for more."}
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
      refused.length > 0 ? `${message}. Not remembered yet: ${refused.join("; ")}` : `${message}.`,
    );
    void reload();
  };

  const shown = data?.items.filter((i) => filter === "all" || i.status === filter) ?? [];
  const total = data ? data.items.length : 0;

  return (
    <section aria-labelledby="review-h" className="card review">
      <h2 id="review-h" className="h3">
        Decisions and action items
      </h2>
      {contentAllowed === false && (
        <p className="review-notice small" role="note">
          <strong>Meeting content is not allowed in memory.</strong> You can still review items
          here, but accepted items are not remembered and search cannot find them. To allow it, turn
          on “Include meeting summaries marked sensitive” in <a href="#/settings">Settings</a>.
        </p>
      )}
      {!aiOn && ai !== null && (
        <p className="review-notice small" role="note">
          <strong>AI is off.</strong> Only decisions and action items that Kage found are listed.
        </p>
      )}
      <p className="muted small">
        Nothing here is acted on until you accept it, and Phoenix never turns an item into a task by
        itself. Quotes are shown exactly as stored.
      </p>
      {hasTranscript && <Extract meetingId={meetingId} aiOn={aiOn} onDone={() => void reload()} />}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <div role="group" aria-label="Show items" className="chips wrap">
            <button
              type="button"
              className="chip"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All ({total})
            </button>
            {MEETING_ITEM_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                aria-pressed={filter === s}
                onClick={() => setFilter(s)}
              >
                {STATUS_SHORT[s]} ({data.counts[s]})
              </button>
            ))}
          </div>
          <p className="review-live small" role="status" aria-live="polite">
            {announcement}
          </p>
          {total === 0 ? (
            <p className="muted">
              No decisions or action items yet.{" "}
              {hasTranscript
                ? "Kage has not reported any for this meeting."
                : "This meeting has no transcript yet."}
            </p>
          ) : shown.length === 0 ? (
            <p className="muted">
              No {filter === "all" ? "" : STATUS_SHORT[filter].toLowerCase()} items.
            </p>
          ) : (
            <ul className="card-list" aria-label="Decisions and action items">
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
