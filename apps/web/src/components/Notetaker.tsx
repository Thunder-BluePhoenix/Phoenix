// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  useCallback,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { useClient, useConnection } from "../core/context";
import { createBrowserMicrophone, type DictationMicrophone } from "../core/dictation-mic";
import { useAction } from "../core/hooks";
import {
  CONSENT_CHECKBOX,
  CONSENT_NOTICE,
  MIC_ONLY_NOTICE,
  formatElapsed,
  type NotetakerStatus,
} from "../core/notetaker";
import { recorderFor } from "../core/notetaker-recorder";
import { Feedback } from "./Feedback";

/** The status of the notetaker, kept current while Core says a recording starts or ends. */
function useNotetakerStatus() {
  const client = useClient();
  const [status, setStatus] = useState<NotetakerStatus | null>(null);
  const refresh = useCallback(async () => {
    try {
      setStatus(await client.request<NotetakerStatus>("GET", "/api/notetaker/status"));
    } catch {
      setStatus(null);
    }
  }, [client]);
  useEffect(() => {
    void refresh();
    const offStatus = client.statusChanged.on(() => void refresh());
    // RECORDING appears and clears with the state engine: a start or stop elsewhere changes it.
    const offState = client.stateChanged.on(() => void refresh());
    return () => {
      offStatus();
      offState();
    };
  }, [client, refresh]);
  return { status, refresh };
}

/** Seconds since `startedAtMs`, updated every second (a clock the tests can fake). */
function useElapsedSeconds(startedAtMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAtMs === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAtMs]);
  return startedAtMs === null ? 0 : Math.max(0, (now - startedAtMs) / 1000);
}

// ── Settings ─────────────────────────────────────────────────────────────────────────────────────

/** Settings > Notetaker: the switch (off by default) and what recording does and does not do. */
export function NotetakerSettingsSection() {
  const { run, busy, error } = useAction();
  const { status, refresh } = useNotetakerStatus();
  const [saved, setSaved] = useState<string | null>(null);

  const toggle = async (enabled: boolean) => {
    setSaved(null);
    if (await run("POST", "/api/notetaker/settings", { enabled })) {
      setSaved(enabled ? "The notetaker is on." : "The notetaker is off.");
      void refresh();
    }
  };

  if (!status)
    return (
      <section className="card" aria-labelledby="notetaker-h">
        <h2 id="notetaker-h" className="h3">
          Notetaker
        </h2>
        <p className="muted small">Loading…</p>
      </section>
    );
  return (
    <section className="card notetaker-settings" aria-labelledby="notetaker-h">
      <h2 id="notetaker-h" className="h3">
        Notetaker
      </h2>
      <p className="small">
        The notetaker records a call on this computer, with no bot joining, and turns it into a
        transcript, a summary and to-dos you can review. It is <strong>off</strong> until you turn
        it on here. Turning it on is <strong>not</strong> consent to record anyone: every recording
        asks you again.
      </p>
      <ul className="small">
        <li>
          <strong>Audio is never stored.</strong> It is kept in memory only, turned into text in
          short pieces on this device, and erased as soon as each piece is done or the recording
          stops.
        </li>
        <li>
          <strong>What is kept:</strong> the transcript, written as the call goes on, and a summary
          made by a model on this device. If no model answers, you get the transcript without a
          summary.
        </li>
        <li>
          <strong>Speakers:</strong> only “You” and “Others”. Phoenix does not tell the other people
          apart.
        </li>
        <li>
          <strong>What is captured:</strong> {status.capture.detail}
        </li>
        <li>Fawkes shows “Recording” in every view, and a Stop button, for the whole recording.</li>
      </ul>
      <label className="choice">
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        Turn on the notetaker
      </label>
      <p className="small" role="status">
        Speech recogniser: {status.recognizer.available ? "available" : "unavailable"}.{" "}
        {status.recognizer.detail}
      </p>
      <p className="muted small">{status.summary.detail}</p>
      {status.kill_switch_engaged && (
        <p role="status">The emergency stop is engaged: recording is blocked.</p>
      )}
      <Feedback error={error} saved={saved} />
    </section>
  );
}

// ── The banner ───────────────────────────────────────────────────────────────────────────────────

/**
 * A persistent banner for as long as Core is recording: elapsed time and a Stop button. It follows
 * Core (not this page), so a recording started by the desktop app is shown and stoppable here too.
 */
export function NotetakerBanner({
  createMicrophone = createBrowserMicrophone,
}: {
  /** Test seam: a fake microphone. Production uses getUserMedia through the browser. */
  createMicrophone?: () => DictationMicrophone;
}) {
  const client = useClient();
  const { status } = useNotetakerStatus();
  const recorder = recorderFor(client, createMicrophone);
  const local = useSyncExternalStore(recorder.subscribe, recorder.getState);
  const active = status?.active;
  const startedAtMs = active ? Date.parse(active.started_at) : local.startedAtMs;
  const elapsed = useElapsedSeconds(startedAtMs);
  const [error, setError] = useState<string | null>(null);

  if (!active && local.phase !== "starting" && local.phase !== "recording") return null;
  // Decided by this page's own recorder: a status poll that lags behind must never leave Stop dead.
  const mine = local.sessionId !== null;
  const stopping = local.phase === "stopping";
  const stop = async () => {
    setError(null);
    if (mine) await recorder.stop();
    else if (active) await recorder.stopById(active.id);
    if (recorder.getState().error) setError(recorder.getState().error);
  };
  return (
    <div className="recording-banner notetaker-banner" role="status" data-testid="notetaker-banner">
      <strong>
        <span className="rec-dot" aria-hidden="true" /> Recording a call
      </strong>
      <span className="notetaker-elapsed" data-testid="notetaker-elapsed">
        {formatElapsed(elapsed)}
      </span>
      <span className="small">
        {mine || local.phase === "recording" ? MIC_ONLY_NOTICE : status?.capture.detail}
      </span>
      <button
        type="button"
        className="btn btn-danger"
        disabled={stopping}
        onClick={() => void stop()}
      >
        {stopping ? "Stopping…" : "Stop recording"}
      </button>
      {(error ?? local.error) && (
        <span className="error-text" role="alert">
          {error ?? local.error}
        </span>
      )}
    </div>
  );
}

// ── The Record button and the consent dialog ─────────────────────────────────────────────────────

/** The dialog shown before EVERY recording. Its tick is not remembered. */
function ConsentDialog({
  busy,
  onStart,
  onCancel,
}: {
  busy: boolean;
  onStart: (title: string) => void;
  onCancel: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [title, setTitle] = useState("");
  const titleId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (agreed) onStart(title.trim());
  };
  return (
    <form
      className="card notetaker-consent"
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${titleId}-h`}
      onSubmit={submit}
    >
      <h3 id={`${titleId}-h`} className="h3">
        Before you record
      </h3>
      <p role="note">
        <strong>{CONSENT_NOTICE}</strong>
      </p>
      <p className="small">{MIC_ONLY_NOTICE}</p>
      <label className="choice">
        <input
          type="checkbox"
          required
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        {CONSENT_CHECKBOX}
      </label>
      <label htmlFor={`${titleId}-title`}>
        Title <span className="muted small">(optional)</span>
      </label>
      <input
        id={`${titleId}-title`}
        type="text"
        maxLength={120}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="button-row wrap">
        <button type="submit" className="btn btn-primary" disabled={!agreed || busy}>
          Start recording
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** “Record a call”: opens the consent dialog; nothing is recorded until the box is ticked. */
export function RecordCall({
  createMicrophone = createBrowserMicrophone,
}: {
  /** Test seam: a fake microphone. Production uses getUserMedia through the browser. */
  createMicrophone?: () => DictationMicrophone;
}) {
  const client = useClient();
  const connection = useConnection();
  const { status, refresh } = useNotetakerStatus();
  const recorder = recorderFor(client, createMicrophone);
  const local = useSyncExternalStore(recorder.subscribe, recorder.getState);
  const [asking, setAsking] = useState(false);
  // Core answered the start; the status (RECORDING, elapsed) follows.
  useEffect(() => {
    void refresh();
  }, [local.phase, refresh]);

  const blocked = !status
    ? "The notetaker status is not available."
    : !status.enabled
      ? "The notetaker is off. Turn it on in Settings, under Notetaker."
      : status.kill_switch_engaged
        ? "The emergency stop is engaged."
        : !status.recognizer.available
          ? status.recognizer.detail
          : connection !== "online"
            ? "Phoenix Core is not connected."
            : status.active || local.phase !== "idle"
              ? "A recording is already in progress."
              : null;

  return (
    <section className="card notetaker-record" aria-labelledby="record-call-h">
      <h2 id="record-call-h" className="h3">
        Record a call
      </h2>
      <p className="muted small">
        Records this computer’s microphone, with no bot. Audio is never stored; you get a transcript
        and, if a model on this device answers, a summary.
      </p>
      {!asking && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={blocked !== null}
          onClick={() => setAsking(true)}
        >
          Record a call
        </button>
      )}
      {blocked && <p className="muted small">{blocked}</p>}
      {asking && (
        <ConsentDialog
          busy={local.phase === "starting"}
          onCancel={() => setAsking(false)}
          onStart={(title) => {
            // The tick belongs to this recording only: the dialog is gone, and so is the tick.
            setAsking(false);
            void recorder.start(title || undefined);
          }}
        />
      )}
      {local.phase === "starting" && (
        <p className="small" role="status">
          Waiting for the microphone permission…
        </p>
      )}
      <Feedback error={local.error} />
      {local.meetingId && (
        <p className="small" role="status">
          The recording was saved.{" "}
          <a href={`#/meetings/${encodeURIComponent(local.meetingId)}`}>Open the meeting</a>
        </p>
      )}
    </section>
  );
}
