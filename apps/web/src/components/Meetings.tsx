// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../core/client";
import { useClient } from "../core/context";
import { formatNumber } from "../core/format";
import { useAction, useCapabilities, useMeeting, useMeetings } from "../core/hooks";
import type { ActionItem, Meeting, PetState, Summary, Transcript } from "../core/types";
import { useT, type MessageKey, type Vars } from "../i18n";
import { getActive, translate } from "../i18n/store";
import { intlLocale } from "../i18n/supported";
import { Approvals } from "./Approvals";
import { MeetingItemsReview } from "./MeetingItems";
import { NotetakerBanner, RecordCall } from "./Notetaker";
import { MeetingSearch } from "./MeetingSearch";
import { MeetingPlans } from "./Plans";

/** Anything that turns a message key into text: `useT()`'s result or the store's `translate`. */
type Say = (key: MessageKey, vars?: Vars) => string;

/** Phoenix lifecycle status → message; `step` marks processing progress (of 3). */
const STATUS: Record<string, { key: MessageKey; step?: number }> = {
  in_progress: { key: "memory.meetings.status.in_progress" },
  processing: { key: "memory.meetings.status.processing", step: 1 },
  transcribing: { key: "memory.meetings.status.transcribing", step: 2 },
  summarizing: { key: "memory.meetings.status.summarizing", step: 3 },
  transcribed: { key: "memory.meetings.status.transcribed" },
  ready: { key: "memory.meetings.status.ready" },
  failed: { key: "memory.meetings.status.failed" },
};

const meetingHref = (id: string) => `#/meetings/${encodeURIComponent(id)}`;
const title = (m: Meeting, t: Say) =>
  m.title ?? t("memory.meetings.untitled", { id: m.external_id });
/** A call Phoenix recorded on this computer (not one a capability such as Kage captured). */
const recordedHere = (m: Meeting) => m.capability_id === "notetaker";

/** "Oct 4, 2026, 9:00 AM" in the language on screen; "" for a missing or bad date. */
function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(intlLocale(getActive().locale), { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(seconds: number | null, t: Say): string {
  if (!seconds) return "";
  const m = Math.round(seconds / 60);
  return m < 60
    ? t("memory.meetings.duration.minutes", { minutes: formatNumber(m) })
    : t("memory.meetings.duration.hoursMinutes", {
        hours: formatNumber(Math.floor(m / 60)),
        minutes: formatNumber(m % 60),
      });
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${formatNumber(Math.floor(s / 60))}:${formatNumber(s % 60, undefined, { minimumIntegerDigits: 2 })}`;
};

const itemText = (a: ActionItem, t: Say) =>
  typeof a === "string"
    ? a
    : [a.text, a.owner && `(${a.owner})`, a.due && t("memory.meetings.item.due", { due: a.due })]
        .filter(Boolean)
        .join(" ");

export function MeetingStatus({ status }: { status: string }) {
  const t = useT();
  const known = STATUS[status];
  const label = known ? t(known.key) : status;
  return (
    <span className={`meeting-status status-${status}`}>
      {label}
      {known?.step && (
        <progress
          max={3}
          value={known.step}
          aria-label={t("memory.meetings.stepOf", {
            step: known.step,
            total: 3,
            label: label.replace("…", ""),
          })}
        />
      )}
    </span>
  );
}

export function RecordingBanner({ recording }: { recording: boolean }) {
  const t = useT();
  if (!recording) return null;
  return (
    <div className="recording-banner" role="status">
      <strong>
        <span className="rec-dot" aria-hidden="true" /> {t("memory.meetings.recordingActive")}
      </strong>
      <span className="small">{t("memory.meetings.recordingStop")}</span>
    </div>
  );
}

/** Starts a Kage capture. Core asks for approval before anything runs. */
function StartMeeting() {
  const t = useT();
  const client = useClient();
  const { data: caps } = useCapabilities();
  const { run, busy, error } = useAction();
  const [meetUrl, setMeetUrl] = useState("");
  const [name, setName] = useState("");
  const [opId, setOpId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const kage = caps.find((c) => c.id === "kage");
  const canStart =
    kage?.status === "enabled" && kage.commands.some((c) => c.name === "meeting.start");

  // Follow the operation: it waits for approval, then starts the bot (or fails).
  useEffect(() => {
    if (!opId) return;
    let stop = false;
    const tick = async () => {
      try {
        const op = await client.request<{ status: string; error?: { message: string } }>(
          "GET",
          `/api/operations/${encodeURIComponent(opId)}`,
        );
        if (op.status === "succeeded")
          return setOutcome(translate("memory.meetings.start.captureStarted"));
        if (op.status === "failed")
          return setOutcome(op.error?.message ?? translate("memory.meetings.start.couldNotStart"));
      } catch (err) {
        if (err instanceof ApiError) return setOutcome(err.message);
      }
      if (!stop) setTimeout(() => void tick(), 750);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [client, opId]);

  if (!canStart) {
    return (
      <p className="muted">
        {t.rich("memory.meetings.start.needKage", { kage: <strong>Kage</strong> })}
      </p>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setOutcome(null);
    const op = (await run("POST", "/api/capabilities/kage/commands/meeting.start", {
      input: { meet_url: meetUrl.trim(), ...(name.trim() ? { title: name.trim() } : {}) },
    })) as { id: string } | undefined;
    if (op) setOpId(op.id);
  };

  return (
    <form className="card start-meeting" onSubmit={(e) => void submit(e)}>
      <h2 className="h3">{t("memory.meetings.start.title")}</h2>
      <label>
        {t("memory.meetings.start.meetLink")}
        <input
          type="url"
          required
          pattern="https://meet\.google\.com/.+"
          placeholder="https://meet.google.com/abc-defg-hij"
          value={meetUrl}
          onChange={(e) => setMeetUrl(e.target.value)}
        />
      </label>
      <label>
        {t("memory.meetings.start.titleField")}{" "}
        <span className="muted small">{t("memory.common.optional")}</span>
        <input type="text" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <p className="muted small">{t("memory.meetings.start.approveFirst")}</p>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {t("memory.meetings.start.button")}
      </button>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {opId && <Approvals />}
      {outcome && (
        <p className="small" role="status">
          {outcome}
        </p>
      )}
    </form>
  );
}

export function MeetingsPage({ state }: { state: PetState }) {
  const t = useT();
  const [archived, setArchived] = useState(false);
  const { data: meetings, error } = useMeetings(archived);
  return (
    <div className="meetings">
      <h1>{t("memory.meetings.title")}</h1>
      <RecordingBanner recording={state.recording} />
      <NotetakerBanner />
      <StartMeeting />
      <RecordCall />
      <MeetingSearch />
      <div className="list-head">
        <h2 className="h3">
          {archived ? t("memory.meetings.archivedTitle") : t("memory.meetings.recentTitle")}
        </h2>
        <button type="button" className="btn" onClick={() => setArchived(!archived)}>
          {archived ? t("memory.meetings.showRecent") : t("memory.meetings.showArchived")}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {!error && meetings.length === 0 && (
        <p className="muted">
          {archived ? t("memory.meetings.noneArchived") : t("memory.meetings.noneYet")}
        </p>
      )}
      <ul className="card-list">
        {meetings.map((m) => (
          <li key={m.id} className="card meeting-row">
            <a href={meetingHref(m.id)}>
              <strong>{title(m, t)}</strong>
            </a>
            <MeetingStatus status={m.status} />
            {recordedHere(m) && <span className="chip">{t("memory.meetings.recordedHere")}</span>}
            <span className="muted small">
              {[formatDate(m.started_at), formatDuration(m.duration_seconds, t)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SummaryView({ summary }: { summary: Summary }) {
  const t = useT();
  const list = (items: string[] | undefined, heading: string) =>
    items && items.length > 0 ? (
      <>
        <h3>{heading}</h3>
        <ul>
          {items.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      </>
    ) : null;
  return (
    <section aria-labelledby="summary-h" className="card">
      <h2 id="summary-h" className="h3">
        {t("memory.meetings.summary.title")}{" "}
        {summary.generated_by && (
          <span className="muted small">
            {summary.generated_by === "ai"
              ? t("memory.meetings.summary.generatedAi")
              : t("memory.meetings.summary.generatedRules")}
          </span>
        )}
      </h2>
      {summary.topics && summary.topics.length > 0 && (
        <p className="topics">
          {summary.topics.map((topic) => (
            <span key={topic} className="chip">
              {topic}
            </span>
          ))}
        </p>
      )}
      <p className="prose">{summary.text}</p>
      {list(summary.decisions, t("memory.meetings.summary.decisions"))}
      {summary.action_items && summary.action_items.length > 0 && (
        <>
          <h3>{t("memory.meetings.summary.actionItems")}</h3>
          <ul>
            {summary.action_items.map((a, i) => (
              <li key={i}>{itemText(a, t)}</li>
            ))}
          </ul>
          <p className="muted small">{t("memory.meetings.summary.actionNote")}</p>
        </>
      )}
      {list(summary.follow_up_questions, t("memory.meetings.summary.followUp"))}
    </section>
  );
}

function TranscriptView({ transcript }: { transcript: Transcript }) {
  const t = useT();
  return (
    <section aria-labelledby="transcript-h" className="card">
      <h2 id="transcript-h" className="h3">
        {t("memory.meetings.transcript.title")}
      </h2>
      {transcript.segments?.length ? (
        <ol className="transcript">
          {transcript.segments.map((s, i) => (
            <li key={i}>
              <span className="muted small">{clock(s.start_ms)}</span>{" "}
              {s.speaker && <strong>{s.speaker}: </strong>}
              {s.text}
            </li>
          ))}
        </ol>
      ) : (
        <p className="prose">{transcript.text}</p>
      )}
    </section>
  );
}

/** The meeting as a Markdown file, in the language on screen unless `say` is given. */
export function toMarkdown(
  m: Meeting,
  transcript: Transcript | null,
  summary: Summary | null,
  say: Say = translate,
) {
  const out = [`# ${title(m, say)}`, ""];
  if (m.started_at) out.push(`- ${say("memory.meetings.md.date", { value: m.started_at })}`);
  if (m.duration_seconds) {
    out.push(
      `- ${say("memory.meetings.md.duration", { value: formatDuration(m.duration_seconds, say) })}`,
    );
  }
  if (m.participants?.length) {
    out.push(`- ${say("memory.meetings.md.participants", { value: m.participants.join(", ") })}`);
  }
  if (summary) {
    out.push("", `## ${say("memory.meetings.summary.title")}`, "", summary.text);
    const section = (h: string, items: string[] | undefined) =>
      items?.length && out.push("", `## ${h}`, "", ...items.map((i) => `- ${i}`));
    section(say("memory.meetings.summary.decisions"), summary.decisions);
    section(
      say("memory.meetings.summary.actionItems"),
      summary.action_items?.map((a) => itemText(a, say)),
    );
    section(say("memory.meetings.summary.followUp"), summary.follow_up_questions);
  }
  if (transcript) {
    out.push("", `## ${say("memory.meetings.transcript.title")}`, "", transcript.text);
  }
  return out.join("\n") + "\n";
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export function MeetingDetail({ id, state }: { id: string; state: PetState }) {
  const t = useT();
  const { meeting: m, transcript, summary, error, missing, reload, content } = useMeeting(id);
  const { run, busy, error: actionError } = useAction();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (missing) {
    return (
      <div className="meetings">
        <p>
          {t("memory.meetings.missing")} <a href="#/meetings">{t("memory.meetings.all")}</a>
        </p>
      </div>
    );
  }
  if (error) return <p className="error-text">{error}</p>;
  if (!m) return <p className="muted">{t("common.status.loading")}</p>;

  const path = `/api/meetings/${encodeURIComponent(m.id)}`;
  const remove = async () => {
    if (await run("DELETE", path, { confirm: true })) window.location.hash = "#/meetings";
  };
  const archive = async () => {
    await run("POST", `${path}/archive`, { archived: !m.archived_at });
    await reload();
  };
  const processing = STATUS[m.status]?.step !== undefined;

  return (
    <div className="meetings">
      <p>
        <a href="#/meetings">{t("memory.meetings.backToAll")}</a>
      </p>
      <h1>{title(m, t)}</h1>
      <RecordingBanner recording={state.recording} />
      <p className="meeting-meta">
        <MeetingStatus status={m.status} />
        {recordedHere(m) && <span className="chip">{t("memory.meetings.recordedHere")}</span>}
        <span className="muted small">
          {[
            formatDate(m.started_at),
            formatDuration(m.duration_seconds, t),
            m.participants?.join(", "),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </p>
      {m.status === "failed" && (
        <p className="error-text">
          {recordedHere(m)
            ? t("memory.meetings.failed.recorded")
            : t("memory.meetings.failed.kage")}
        </p>
      )}
      {recordedHere(m) && m.status === "in_progress" && (
        <p className="muted" role="status">
          {t("memory.meetings.recordingNow")}
        </p>
      )}
      {!recordedHere(m) && processing && (
        <p className="muted">{t("memory.meetings.kageWorking")}</p>
      )}
      {!recordedHere(m) && content === "fetching" && (
        <p className="muted" role="status">
          {t("memory.meetings.fetching")}
        </p>
      )}
      {!recordedHere(m) && content === "unavailable" && (
        <p className="error-text" role="alert">
          {t("memory.meetings.fetchFailed")}
        </p>
      )}

      {summary && <SummaryView summary={summary} />}
      <MeetingItemsReview meetingId={m.id} hasTranscript={m.has_transcript} />
      <MeetingPlans meetingId={m.id} />
      <p className="small">
        <a href={`#/provenance/${encodeURIComponent(`Meeting:${m.id}`)}`}>
          {t("memory.meetings.provenanceLink")}
        </a>
      </p>
      {transcript && <TranscriptView transcript={transcript} />}

      <section aria-labelledby="storage-h" className="card">
        <h2 id="storage-h" className="h3">
          {t("memory.meetings.storage.title")}
        </h2>
        {m.recording ? (
          <p className="small">
            {t.rich("memory.meetings.storage.recording", {
              location: <code className="break">{m.recording.location}</code>,
            })}
            <br />
            {m.recording.retention}.
          </p>
        ) : (
          <p className="muted small">{t("memory.meetings.storage.noRecording")}</p>
        )}
        <p className="muted small">
          {recordedHere(m)
            ? t("memory.meetings.storage.noteLocal")
            : t("memory.meetings.storage.noteRemote", {
                where: m.capability_id === "kage" ? "Kage" : m.capability_id,
              })}
        </p>
        <div className="button-row wrap">
          <button
            type="button"
            className="btn"
            disabled={!transcript && !summary}
            onClick={() =>
              download(
                `${title(m, t).replace(/[^\w-]+/g, "-")}.md`,
                toMarkdown(m, transcript, summary, t),
              )
            }
          >
            {t("memory.meetings.export")}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void archive()}>
            {m.archived_at ? t("memory.meetings.unarchive") : t("memory.meetings.archive")}
          </button>
          {confirmDelete ? (
            <>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                {t("memory.meetings.confirmDelete")}
              </button>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                {t("common.button.cancel")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={() => setConfirmDelete(true)}
            >
              {t("memory.meetings.delete")}
            </button>
          )}
        </div>
        {actionError && (
          <p className="error-text" role="alert">
            {actionError}
          </p>
        )}
      </section>
    </div>
  );
}

/** Compact list for the Pet Panel. */
export function MeetingsGlance() {
  const t = useT();
  const { data: meetings } = useMeetings();
  if (meetings.length === 0) return null;
  return (
    <section aria-labelledby="meetings-glance-h">
      <h3 id="meetings-glance-h">{t("memory.meetings.title")}</h3>
      <ul className="task-list">
        {meetings.slice(0, 3).map((m) => (
          <li key={m.id}>
            <a href={meetingHref(m.id)}>{title(m, t)}</a> <MeetingStatus status={m.status} />
          </li>
        ))}
      </ul>
      <a href="#/meetings" className="small">
        {t("memory.meetings.all")}
      </a>
    </section>
  );
}
