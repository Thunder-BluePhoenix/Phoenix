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
import { formatElapsed, type NotetakerStatus } from "../core/notetaker";
import { recorderFor } from "../core/notetaker-recorder";
import { useT } from "../i18n";
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
  const t = useT();
  const { run, busy, error } = useAction();
  const { status, refresh } = useNotetakerStatus();
  const [saved, setSaved] = useState<string | null>(null);

  const toggle = async (enabled: boolean) => {
    setSaved(null);
    if (await run("POST", "/api/notetaker/settings", { enabled })) {
      setSaved(
        enabled
          ? t("capture.notetaker.settings.savedOn")
          : t("capture.notetaker.settings.savedOff"),
      );
      void refresh();
    }
  };

  if (!status)
    return (
      <section className="card" aria-labelledby="notetaker-h">
        <h2 id="notetaker-h" className="h3">
          {t("capture.notetaker.settings.title")}
        </h2>
        <p className="muted small">{t("common.status.loading")}</p>
      </section>
    );
  return (
    <section className="card notetaker-settings" aria-labelledby="notetaker-h">
      <h2 id="notetaker-h" className="h3">
        {t("capture.notetaker.settings.title")}
      </h2>
      <p className="small">
        {t.rich("capture.notetaker.settings.intro", {
          off: <strong>{t("capture.notetaker.settings.introOff")}</strong>,
          not: <strong>{t("capture.notetaker.settings.introNot")}</strong>,
        })}
      </p>
      <ul className="small">
        <li>
          <strong>{t("capture.notetaker.settings.audio.lead")}</strong>{" "}
          {t("capture.notetaker.settings.audio.body")}
        </li>
        <li>
          <strong>{t("capture.notetaker.settings.kept.lead")}</strong>{" "}
          {t("capture.notetaker.settings.kept.body")}
        </li>
        <li>
          <strong>{t("capture.notetaker.settings.speakers.lead")}</strong>{" "}
          {t("capture.notetaker.settings.speakers.body")}
        </li>
        <li>
          <strong>{t("capture.notetaker.settings.captured.lead")}</strong> {status.capture.detail}
        </li>
        <li>{t("capture.notetaker.settings.banner")}</li>
      </ul>
      <label className="choice">
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        {t("capture.notetaker.settings.toggle")}
      </label>
      <p className="small" role="status">
        {t(
          status.recognizer.available
            ? "capture.audio.recognizerAvailable"
            : "capture.audio.recognizerUnavailable",
          { detail: status.recognizer.detail },
        )}
      </p>
      <p className="muted small">{status.summary.detail}</p>
      {status.kill_switch_engaged && (
        <p role="status">{t("capture.notetaker.settings.killSwitch")}</p>
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
  const t = useT();
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
        <span className="rec-dot" aria-hidden="true" /> {t("capture.notetaker.banner.title")}
      </strong>
      <span className="notetaker-elapsed" data-testid="notetaker-elapsed">
        {formatElapsed(elapsed)}
      </span>
      <span className="small">
        {mine || local.phase === "recording"
          ? t("capture.notetaker.micOnly")
          : status?.capture.detail}
      </span>
      <button
        type="button"
        className="btn btn-danger"
        disabled={stopping}
        onClick={() => void stop()}
      >
        {stopping ? t("capture.notetaker.banner.stopping") : t("capture.notetaker.banner.stop")}
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
  const t = useT();
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
        {t("capture.notetaker.consent.title")}
      </h3>
      <p role="note">
        <strong>{t("capture.notetaker.consent.notice")}</strong>
      </p>
      <p className="small">{t("capture.notetaker.micOnly")}</p>
      <label className="choice">
        <input
          type="checkbox"
          required
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        {t("capture.notetaker.consent.checkbox")}
      </label>
      <label htmlFor={`${titleId}-title`}>
        {t.rich("capture.notetaker.consent.titleField", {
          optional: <span className="muted small">{t("capture.notetaker.consent.optional")}</span>,
        })}
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
          {t("capture.notetaker.consent.start")}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t("common.button.cancel")}
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
  const t = useT();
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
    ? t("capture.notetaker.blocked.unavailable")
    : !status.enabled
      ? t("capture.notetaker.blocked.off")
      : status.kill_switch_engaged
        ? t("capture.audio.emergencyStop")
        : !status.recognizer.available
          ? status.recognizer.detail
          : !status.consent_channel.available
            ? t("capture.notetaker.blocked.noConsentChannel", {
                detail: status.consent_channel.detail,
              })
            : connection !== "online"
              ? t("capture.audio.coreNotConnected")
              : status.active || local.phase !== "idle"
                ? t("capture.notetaker.blocked.inProgress")
                : null;

  return (
    <section className="card notetaker-record" aria-labelledby="record-call-h">
      <h2 id="record-call-h" className="h3">
        {t("capture.notetaker.record.title")}
      </h2>
      <p className="muted small">{t("capture.notetaker.record.intro")}</p>
      {!asking && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={blocked !== null}
          onClick={() => setAsking(true)}
        >
          {t("capture.notetaker.record.title")}
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
          {t("capture.audio.waitingForPermission")}
        </p>
      )}
      <Feedback error={local.error} />
      {local.meetingId && (
        <p className="small" role="status">
          {t("capture.notetaker.record.saved")}{" "}
          <a href={`#/meetings/${encodeURIComponent(local.meetingId)}`}>
            {t("capture.notetaker.record.openMeeting")}
          </a>
        </p>
      )}
    </section>
  );
}
