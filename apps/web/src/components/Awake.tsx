// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useState, type KeyboardEvent } from "react";
import {
  AWAKE_DEFAULT_MAX_MINUTES,
  AWAKE_DEFAULT_MIN_MINUTES,
  formatCountdown,
  parseMinutesInput,
  realHoldTimer,
  realUiClock,
  secondsLeft,
  useAwakeStatus,
  useHoldToEnd,
  useNow,
  type AwakeUiClock,
  type AwakeSessionView,
  type HoldTimer,
} from "../core/awake";
import { formatTime } from "../core/format";
import { useCommandAction } from "../core/hooks";
import { useLocale, useT, type Translate } from "../i18n";

/** Start presets in minutes: 15 min, 1 h, 4 h, 8 h. */
const PRESETS: readonly number[] = [15, 60, 240, 480];
const EXTENDS: readonly number[] = [15, 60];
const DEFAULT_GRACE_MINUTES = 10;

/** "15 minutes" / "4 hours" for a whole number of minutes, in the language on screen. */
function duration(t: Translate, minutes: number): string {
  return minutes % 60 === 0 && minutes >= 60
    ? t("power.awake.duration.hours", { hours: minutes / 60 })
    : t("power.awake.duration.minutes", { minutes });
}

/** Seconds left in a session now, counting down between status reads. */
function useRemaining(session: AwakeSessionView | undefined, clock: AwakeUiClock): number | null {
  const now = useNow(clock, session?.ends_at != null);
  return session ? secondsLeft(session.ends_at, now) : null;
}

/**
 * The countdown on its own line, for places that only show that a session is running (the island
 * and the floating Fawkes). Renders nothing when no session runs or Keep awake is off.
 */
export function AwakeCountdown({ clock = realUiClock }: { clock?: AwakeUiClock }) {
  const t = useT();
  const { locale } = useLocale();
  const { status } = useAwakeStatus();
  const session = status?.session;
  const left = useRemaining(session, clock);
  if (!session) return null;
  return (
    <span className="awake-pill" role="status">
      <span className="awake-dot" aria-hidden="true" />{" "}
      {t("power.awake.indicator", {
        time:
          left === null
            ? t("power.awake.agents.working", { count: session.agents_working ?? 1 })
            : formatCountdown(left, locale),
      })}
    </span>
  );
}

function EndButton({ timer, onEnd, busy }: { timer: HoldTimer; onEnd: () => void; busy: boolean }) {
  const t = useT();
  const hold = useHoldToEnd(onEnd, timer);
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      hold.begin();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") hold.cancel();
  };
  return (
    <div className="awake-end">
      <button
        type="button"
        className="btn awake-hold"
        data-holding={hold.holding ? "true" : "false"}
        disabled={busy}
        aria-describedby="awake-end-hint"
        onPointerDown={hold.begin}
        onPointerUp={hold.cancel}
        onPointerLeave={hold.cancel}
        onPointerCancel={hold.cancel}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={hold.cancel}
        onClick={(e) => e.preventDefault()}
      >
        {hold.holding ? t("power.awake.end.holding") : t("power.awake.end.hold")}
      </button>
      <p id="awake-end-hint" className="muted small">
        {t("power.awake.end.hint")}
      </p>
    </div>
  );
}

export interface AwakeGlanceProps {
  /** The clock that drives the countdown; tests pass a fake. */
  clock?: AwakeUiClock;
  /** The timer behind hold-to-end; tests pass a fake. */
  holdTimer?: HoldTimer;
}

/** Keep-awake on the Overview: start, extend, hold-to-end, countdown, and what ends it. */
export function AwakeGlance({ clock = realUiClock, holdTimer = realHoldTimer }: AwakeGlanceProps) {
  const t = useT();
  const { locale } = useLocale();
  const { availability, status, error } = useAwakeStatus();
  const start = useCommandAction("awake", "start");
  const extend = useCommandAction("awake", "extend");
  const end = useCommandAction("awake", "end");
  const [minutesText, setMinutesText] = useState(String(DEFAULT_GRACE_MINUTES));
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const session = status?.session;
  const left = useRemaining(session, clock);

  if (availability === "absent") return null;
  const min = status?.min_minutes ?? AWAKE_DEFAULT_MIN_MINUTES;
  const max = status?.max_minutes ?? AWAKE_DEFAULT_MAX_MINUTES;
  const custom = parseMinutesInput(minutesText, min, max);
  const actions = [start, extend, end];
  const busy = actions.some((a) => a.busy);
  const waiting = actions.some((a) => a.state === "waiting");
  const failed = actions.find((a) => a.state === "failed")?.error ?? null;

  const begin = (minutes: number, mode?: "agents_grace") => {
    const label = reason.trim();
    void start.submit({
      minutes,
      ...(label ? { reason: label } : {}),
      ...(mode ? { mode } : {}),
    });
  };

  return (
    <section aria-labelledby="awake-h" className="awake">
      <h3 id="awake-h">{t("power.awake.heading")}</h3>
      {availability === "disabled" && <p className="muted small">{t("power.awake.disabled")}</p>}
      {(error || failed) && <p className="error-text small">{failed ?? error}</p>}
      {waiting && (
        <p className="muted small" role="status">
          {t("power.awake.waiting")}
        </p>
      )}

      {availability === "ready" && status && !session && (
        <>
          <p className="muted small">{t("power.awake.idle")}</p>
          <div className="button-row wrap" role="group" aria-label={t("power.awake.start.heading")}>
            {PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => begin(m)}
              >
                {duration(t, m)}
              </button>
            ))}
          </div>
          <div className="awake-custom">
            <label>
              {t("power.awake.custom.label")}{" "}
              <input
                type="text"
                inputMode="numeric"
                value={minutesText}
                aria-invalid={custom === null}
                onChange={(e) => {
                  setMinutesText(e.target.value);
                  setTried(false);
                }}
              />
            </label>
            <label>
              {t("power.awake.reason.label")}{" "}
              <input
                type="text"
                maxLength={80}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="button-row wrap">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => (custom === null ? setTried(true) : begin(custom))}
              >
                {t("power.awake.custom.start")}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => (custom === null ? setTried(true) : begin(custom, "agents_grace"))}
              >
                {t("power.awake.agents.start")}
              </button>
            </div>
            {tried && custom === null && (
              <p className="error-text small" role="alert">
                {t("power.awake.custom.invalid", { min, max })}
              </p>
            )}
            <p className="muted small">{t("power.awake.agents.help")}</p>
          </div>
        </>
      )}

      {availability === "ready" && session && (
        <>
          <p>
            <strong>{t("power.awake.running")}</strong>
            {session.label && <span className="muted"> · {session.label}</span>}
          </p>
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
          {session.mode === "agents_grace" && session.ends_at && (
            <p className="muted small">
              {t("power.awake.agents.grace", {
                minutes: session.grace_minutes ?? DEFAULT_GRACE_MINUTES,
              })}
            </p>
          )}
          {session.mode === "timed" && (
            <div
              className="button-row wrap"
              role="group"
              aria-label={t("power.awake.extend.label")}
            >
              {EXTENDS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void extend.submit({ minutes: m })}
                >
                  {t("power.awake.extend.button", { duration: duration(t, m) })}
                </button>
              ))}
            </div>
          )}
          <EndButton timer={holdTimer} busy={busy} onEnd={() => void end.submit({})} />
        </>
      )}

      {availability === "ready" && status && (
        <>
          <p className="muted small">
            {t("power.awake.battery", { percent: status.battery_floor_percent })}
          </p>
          <p className="muted small">{t("power.awake.lid")}</p>
        </>
      )}
    </section>
  );
}
