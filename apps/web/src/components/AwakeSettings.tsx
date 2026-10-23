// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useState, type FormEvent } from "react";
import {
  AWAKE_DEFAULT_MAX_MINUTES,
  AWAKE_DEFAULT_MIN_MINUTES,
  AWAKE_MAX_LABEL_LENGTH,
  formatCountdown,
  parseAwakeLabel,
  parseMinutesInput,
  realUiClock,
  useAwakeStatus,
  type AwakeUiClock,
} from "../core/awake";
import { formatTime } from "../core/format";
import { useAction, useCommandAction } from "../core/hooks";
import { useLocale, useT, type MessageKey } from "../i18n";
import { duration, useRemaining } from "./Awake";
import { Feedback } from "./Feedback";

/** Start presets in minutes: 30 min, 1 h, 2 h, 4 h. */
const PRESETS: readonly number[] = [30, 60, 120, 240];
const EXTENDS: readonly number[] = [30, 60];
const DEFAULT_MINUTES = 60;

type AwakeAction = "start" | "extend" | "end";

const SUCCEEDED: Record<AwakeAction, MessageKey> = {
  start: "awakeSettings.outcome.succeeded.start",
  extend: "awakeSettings.outcome.succeeded.extend",
  end: "awakeSettings.outcome.succeeded.end",
};

export interface AwakeSettingsProps {
  /** The clock that drives the countdown; tests pass a fake. */
  clock?: AwakeUiClock;
}

/**
 * Settings → Keep awake (Phase 72). Shows the session, and sends start, extend and end to Core's
 * capability command route like the Overview and the `phoenix awake` CLI do. Each of those is an
 * `execute` command, so Core raises its own confirmation; this section only waits for it and
 * reports what Core says happened. It never approves or denies anything itself.
 */
export function AwakeSettingsSection({ clock = realUiClock }: AwakeSettingsProps) {
  const t = useT();
  const { locale } = useLocale();
  const { availability, capabilityStatus, status, error, reload, reloadCapabilities } =
    useAwakeStatus();
  const enable = useAction();
  const start = useCommandAction("awake", "start");
  const extend = useCommandAction("awake", "extend");
  const end = useCommandAction("awake", "end");
  const [minutesText, setMinutesText] = useState(String(DEFAULT_MINUTES));
  const [labelText, setLabelText] = useState("");
  const [tried, setTried] = useState(false);
  const [last, setLast] = useState<AwakeAction | null>(null);
  const session = status?.session;
  const left = useRemaining(session, clock);

  const runs = { start, extend, end };
  const run = last === null ? null : runs[last];
  const runState = run?.state;
  useEffect(() => {
    if (runState === "succeeded") void reload();
  }, [runState, reload]);

  if (availability === "absent") return null;

  const min = status?.min_minutes ?? AWAKE_DEFAULT_MIN_MINUTES;
  const max = status?.max_minutes ?? AWAKE_DEFAULT_MAX_MINUTES;
  const minutes = parseMinutesInput(minutesText, min, max);
  const label = parseAwakeLabel(labelText);
  const busy = start.busy || extend.busy || end.busy;

  const submitStart = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    // Nothing is sent for a duration or label Core would refuse.
    if (minutes === null || label === null || busy) return;
    setLast("start");
    void start.submit({ minutes, ...(label === undefined ? {} : { reason: label }) });
  };

  const turnOn = async () => {
    await enable.run("POST", "/api/capabilities/awake/enable");
    await reloadCapabilities();
  };

  const outcome = () => {
    if (run === null || last === null) return null;
    if (run.busy) {
      return (
        <p className="muted small" role="status">
          {t("awakeSettings.outcome.waiting")}
        </p>
      );
    }
    if (run.state === "succeeded") {
      return (
        <p className="small" role="status">
          {t(SUCCEEDED[last])}
        </p>
      );
    }
    if (run.state !== "failed") return null;
    const text =
      run.code === "PERMISSION_DENIED"
        ? t("awakeSettings.outcome.denied")
        : run.code === "SECURITY_POLICY_BLOCKED"
          ? t("awakeSettings.outcome.blocked")
          : run.code === "OPERATION_TIMEOUT"
            ? t("awakeSettings.outcome.timeout")
            : t("awakeSettings.outcome.failed", { message: run.error ?? "" });
    return (
      <p className="error-text small" role="alert">
        {text}
      </p>
    );
  };

  return (
    <section className="card" aria-labelledby="awake-settings-h">
      <h2 id="awake-settings-h">{t("awakeSettings.title")}</h2>
      <p>{t("awakeSettings.intro")}</p>
      <p className="small">{t("awakeSettings.approval")}</p>
      <p className="small">{t("power.awake.lid")}</p>

      {availability === "disabled" && (
        <>
          <p className="warning-text small" role="note">
            {t("awakeSettings.off")}{" "}
            {capabilityStatus !== "disconnected" && (
              <button
                type="button"
                className="btn"
                disabled={enable.busy}
                onClick={() => void turnOn()}
              >
                {t("awakeSettings.enable")}
              </button>
            )}
          </p>
          <Feedback error={enable.error} />
        </>
      )}

      {availability === "ready" && (
        <>
          {error && (
            <p className="error-text small" role="alert">
              {error}
            </p>
          )}
          {status === null ? (
            <p className="muted small">{t("awakeSettings.status.unreadable")}</p>
          ) : session === undefined ? (
            <p className="muted" role="status">
              {t("awakeSettings.status.idle")}
            </p>
          ) : (
            <div role="group" aria-label={t("awakeSettings.status.title")}>
              <p>
                <strong>{t("power.awake.running")}</strong>{" "}
                <span className="muted">
                  {t(
                    session.mode === "timed"
                      ? "awakeSettings.status.mode.timed"
                      : "awakeSettings.status.mode.agents_grace",
                  )}
                </span>
              </p>
              {session.label && (
                <p className="muted small">
                  {t("awakeSettings.status.label", { label: session.label })}
                </p>
              )}
              {left !== null ? (
                <p
                  className="awake-clock"
                  role="timer"
                  aria-label={t("power.awake.remaining", { time: formatCountdown(left, locale) })}
                >
                  {formatCountdown(left, locale)}
                </p>
              ) : (
                <p className="muted" role="status">
                  {t("power.awake.agents.working", { count: session.agents_working ?? 1 })}
                </p>
              )}
              {session.ends_at && (
                <p className="muted small">
                  {t("power.awake.endsAt", { time: formatTime(session.ends_at, locale) })}
                </p>
              )}
              <div className="button-row wrap">
                {session.mode === "timed" &&
                  EXTENDS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        setLast("extend");
                        void extend.submit({ minutes: m });
                      }}
                    >
                      {t("power.awake.extend.button", { duration: duration(t, m) })}
                    </button>
                  ))}
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setLast("end");
                    void end.submit({});
                  }}
                >
                  {t("awakeSettings.end.button")}
                </button>
              </div>
            </div>
          )}
          {status !== null && (
            <p className="muted small">
              {t("power.awake.battery", { percent: status.battery_floor_percent })}
            </p>
          )}

          {status !== null && session === undefined && (
            <form className="awake-custom" onSubmit={submitStart}>
              <h3 className="h3">{t("awakeSettings.start.title")}</h3>
              <div
                className="button-row wrap"
                role="group"
                aria-label={t("awakeSettings.start.durations")}
              >
                {PRESETS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="btn"
                    aria-pressed={minutesText === String(m)}
                    onClick={() => setMinutesText(String(m))}
                  >
                    {duration(t, m)}
                  </button>
                ))}
              </div>
              <label>
                {t("awakeSettings.start.minutes")}{" "}
                <input
                  type="text"
                  inputMode="numeric"
                  value={minutesText}
                  aria-invalid={tried && minutes === null}
                  onChange={(e) => {
                    setMinutesText(e.target.value);
                    setTried(false);
                  }}
                />
              </label>
              <label>
                {t("awakeSettings.start.label")}{" "}
                <input
                  type="text"
                  value={labelText}
                  aria-invalid={tried && label === null}
                  onChange={(e) => {
                    setLabelText(e.target.value);
                    setTried(false);
                  }}
                />
              </label>
              {tried && minutes === null && (
                <p className="error-text small" role="alert">
                  {t("power.awake.custom.invalid", { min, max })}
                </p>
              )}
              {tried && label === null && (
                <p className="error-text small" role="alert">
                  {t("awakeSettings.start.labelInvalid", { max: AWAKE_MAX_LABEL_LENGTH })}
                </p>
              )}
              <div className="button-row wrap">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {t("awakeSettings.start.submit")}
                </button>
              </div>
            </form>
          )}
          {outcome()}
        </>
      )}
    </section>
  );
}
