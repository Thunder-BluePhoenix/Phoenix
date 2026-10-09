// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../core/client";
import { useClient } from "../core/context";
import { useAction, useCapabilities, useMeeting, useMeetings } from "../core/hooks";
import type { ActionItem, Meeting, PetState, Summary, Transcript } from "../core/types";
import { Approvals } from "./Approvals";

/** Phoenix lifecycle status → label; `step` marks processing progress (of 3). */
const STATUS: Record<string, { label: string; step?: number }> = {
  processing: { label: "Processing", step: 1 },
  transcribing: { label: "Transcribing…", step: 2 },
  summarizing: { label: "Summarising…", step: 3 },
  transcribed: { label: "Transcript ready" },
  ready: { label: "Ready" },
  failed: { label: "Failed" },
};

const meetingHref = (id: string) => `#/meetings/${encodeURIComponent(id)}`;
const title = (m: Meeting) => m.title ?? `Meeting ${m.external_id}`;

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const itemText = (a: ActionItem) =>
  typeof a === "string"
    ? a
    : [a.text, a.owner && `(${a.owner})`, a.due && `due ${a.due}`].filter(Boolean).join(" ");

export function MeetingStatus({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status };
  return (
    <span className={`meeting-status status-${status}`}>
      {s.label}
      {s.step && (
        <progress
          max={3}
          value={s.step}
          aria-label={`Step ${s.step} of 3: ${s.label.replace("…", "")}`}
        />
      )}
    </span>
  );
}

export function RecordingBanner({ recording }: { recording: boolean }) {
  if (!recording) return null;
  return (
    <div className="recording-banner" role="status">
      <strong>
        <span className="rec-dot" aria-hidden="true" /> Recording is active
      </strong>
      <span className="small">
        Kage's bot stops on its own when the call ends. To stop sooner, remove the bot from the
        call. Phoenix cannot stop it safely yet.
      </span>
    </div>
  );
}

/** Starts a Kage capture. Core asks for approval before anything runs. */
function StartMeeting() {
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
          return setOutcome("Capture started. Fawkes shows the recording.");
        if (op.status === "failed")
          return setOutcome(op.error?.message ?? "Could not start the capture.");
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
        To capture meetings, enable <strong>Kage</strong> under Capabilities in the Pet Panel and
        set its server and API key.
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
      <h2 className="h3">Capture a meeting</h2>
      <label>
        Google Meet link
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
        Title <span className="muted small">(optional)</span>
        <input type="text" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <p className="muted small">
        Kage's bot joins the call and records its audio. You will be asked to approve first.
      </p>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        Start capture…
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
  const [archived, setArchived] = useState(false);
  const { data: meetings, error } = useMeetings(archived);
  return (
    <div className="meetings">
      <h1>Meetings</h1>
      <RecordingBanner recording={state.recording} />
      <StartMeeting />
      <div className="list-head">
        <h2 className="h3">{archived ? "Archived meetings" : "Recent meetings"}</h2>
        <button type="button" className="btn" onClick={() => setArchived(!archived)}>
          {archived ? "Show recent" : "Show archived"}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {!error && meetings.length === 0 && (
        <p className="muted">
          {archived ? "Nothing archived." : "No meetings yet. Captured meetings appear here."}
        </p>
      )}
      <ul className="card-list">
        {meetings.map((m) => (
          <li key={m.id} className="card meeting-row">
            <a href={meetingHref(m.id)}>
              <strong>{title(m)}</strong>
            </a>
            <MeetingStatus status={m.status} />
            <span className="muted small">
              {[formatDate(m.started_at), formatDuration(m.duration_seconds)]
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
  const list = (items: string[] | undefined, heading: string) =>
    items && items.length > 0 ? (
      <>
        <h3>{heading}</h3>
        <ul>
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </>
    ) : null;
  return (
    <section aria-labelledby="summary-h" className="card">
      <h2 id="summary-h" className="h3">
        Summary{" "}
        {summary.generated_by && (
          <span className="muted small">
            ({summary.generated_by === "ai" ? "AI summary" : "key sentences"})
          </span>
        )}
      </h2>
      {summary.topics && summary.topics.length > 0 && (
        <p className="topics">
          {summary.topics.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </p>
      )}
      <p className="prose">{summary.text}</p>
      {list(summary.decisions, "Decisions")}
      {summary.action_items && summary.action_items.length > 0 && (
        <>
          <h3>Action items</h3>
          <ul>
            {summary.action_items.map((a, i) => (
              <li key={i}>{itemText(a)}</li>
            ))}
          </ul>
          <p className="muted small">
            Phoenix never acts on these by itself. Turning them into tasks comes with issue-tracker
            capabilities and will always ask for your approval first.
          </p>
        </>
      )}
      {list(summary.follow_up_questions, "Follow-up questions")}
    </section>
  );
}

function TranscriptView({ transcript }: { transcript: Transcript }) {
  return (
    <section aria-labelledby="transcript-h" className="card">
      <h2 id="transcript-h" className="h3">
        Transcript
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

export function toMarkdown(m: Meeting, transcript: Transcript | null, summary: Summary | null) {
  const out = [`# ${title(m)}`, ""];
  if (m.started_at) out.push(`- Date: ${m.started_at}`);
  if (m.duration_seconds) out.push(`- Duration: ${formatDuration(m.duration_seconds)}`);
  if (m.participants?.length) out.push(`- Participants: ${m.participants.join(", ")}`);
  if (summary) {
    out.push("", "## Summary", "", summary.text);
    const section = (h: string, items: string[] | undefined) =>
      items?.length && out.push("", `## ${h}`, "", ...items.map((i) => `- ${i}`));
    section("Decisions", summary.decisions);
    section("Action items", summary.action_items?.map(itemText));
    section("Follow-up questions", summary.follow_up_questions);
  }
  if (transcript) out.push("", "## Transcript", "", transcript.text);
  return out.join("\n") + "\n";
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export function MeetingDetail({ id, state }: { id: string; state: PetState }) {
  const { meeting: m, transcript, summary, error, missing, reload, content } = useMeeting(id);
  const { run, busy, error: actionError } = useAction();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (missing) {
    return (
      <div className="meetings">
        <p>
          This meeting is not in Phoenix (it may have been deleted).{" "}
          <a href="#/meetings">All meetings</a>
        </p>
      </div>
    );
  }
  if (error) return <p className="error-text">{error}</p>;
  if (!m) return <p className="muted">Loading…</p>;

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
        <a href="#/meetings">← All meetings</a>
      </p>
      <h1>{title(m)}</h1>
      <RecordingBanner recording={state.recording} />
      <p className="meeting-meta">
        <MeetingStatus status={m.status} />
        <span className="muted small">
          {[
            formatDate(m.started_at),
            formatDuration(m.duration_seconds),
            m.participants?.join(", "),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </p>
      {m.status === "failed" && (
        <p className="error-text">Kage could not process this meeting. Check Kage for details.</p>
      )}
      {processing && (
        <p className="muted">Kage is still working on this meeting; this page updates by itself.</p>
      )}
      {content === "fetching" && (
        <p className="muted" role="status">
          Fetching the transcript from Kage…
        </p>
      )}
      {content === "unavailable" && (
        <p className="error-text" role="alert">
          Phoenix could not fetch this meeting's transcript from Kage. It is still in Kage.
        </p>
      )}

      {summary && <SummaryView summary={summary} />}
      {transcript && <TranscriptView transcript={transcript} />}

      <section aria-labelledby="storage-h" className="card">
        <h2 id="storage-h" className="h3">
          Storage
        </h2>
        {m.recording ? (
          <p className="small">
            Recording: <code className="break">{m.recording.location}</code>
            <br />
            {m.recording.retention}.
          </p>
        ) : (
          <p className="muted small">No recording reference.</p>
        )}
        <p className="muted small">
          Phoenix keeps a local copy of the details, transcript and summary. Deleting here removes
          Phoenix's copy only; delete the recording in{" "}
          {m.capability_id === "kage" ? "Kage" : m.capability_id}.
        </p>
        <div className="button-row wrap">
          <button
            type="button"
            className="btn"
            disabled={!transcript && !summary}
            onClick={() =>
              download(
                `${title(m).replace(/[^\w-]+/g, "-")}.md`,
                toMarkdown(m, transcript, summary),
              )
            }
          >
            Export Markdown
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void archive()}>
            {m.archived_at ? "Unarchive" : "Archive"}
          </button>
          {confirmDelete ? (
            <>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                Confirm: delete Phoenix's copy
              </button>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={() => setConfirmDelete(true)}
            >
              Delete…
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
  const { data: meetings } = useMeetings();
  if (meetings.length === 0) return null;
  return (
    <section aria-labelledby="meetings-glance-h">
      <h3 id="meetings-glance-h">Meetings</h3>
      <ul className="task-list">
        {meetings.slice(0, 3).map((m) => (
          <li key={m.id}>
            <a href={meetingHref(m.id)}>{title(m)}</a> <MeetingStatus status={m.status} />
          </li>
        ))}
      </ul>
      <a href="#/meetings" className="small">
        All meetings
      </a>
    </section>
  );
}
