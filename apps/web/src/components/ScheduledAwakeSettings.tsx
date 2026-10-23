// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useState, type FormEvent } from "react";
import { useAction } from "../core/hooks";
import {
  formatCalendarDate,
  formatMoment,
  readScheduledAwake,
  SCHEDULED_AWAKE_PATH,
  useCoreResource,
  weekdayName,
  type AwakeSchedule,
  type ScheduledAwake,
} from "../core/schedule";
import { useLocale, useT, type MessageKey } from "../i18n";
import { Feedback } from "./Feedback";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

const WAITING_REASONS: Record<string, MessageKey> = {
  needs_charger: "awakeSchedule.waiting.needs_charger",
  battery_low: "awakeSchedule.waiting.battery_low",
  low_power_mode: "awakeSchedule.waiting.low_power_mode",
  power_unknown: "awakeSchedule.waiting.power_unknown",
  busy: "awakeSchedule.waiting.busy",
  battery_floor: "awakeSchedule.waiting.battery_floor",
  start_failed: "awakeSchedule.waiting.start_failed",
};

/**
 * Scheduled keep-awake (Phase 90). Off by default. Turning it on and saving a window each make Core
 * ask the user in Approvals, and that request does not answer until they have: `asking` shows it.
 */
export function ScheduledAwakeSection() {
  const t = useT();
  const { locale } = useLocale();
  const { data, status, apply } = useCoreResource(SCHEDULED_AWAKE_PATH, readScheduledAwake);
  const { run, busy, error } = useAction();
  const [asking, setAsking] = useState(false);
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [timeZone, setTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [start, setStart] = useState("22:00");
  const [end, setEnd] = useState("06:00");
  const [days, setDays] = useState<readonly number[]>([]);
  const [requireCharger, setRequireCharger] = useState(false);
  const [minBattery, setMinBattery] = useState("20");

  const change = async (method: string, path: string, body?: unknown) => {
    const saved = await run(method, path, body);
    if (saved === undefined) return false;
    apply(saved);
    return true;
  };

  const setEnabled = async (enabled: boolean) => {
    setAsking(enabled);
    await change("PUT", SCHEDULED_AWAKE_PATH, { enabled });
    setAsking(false);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const name = label.trim();
    setAsking(true);
    const saved = await change("POST", `${SCHEDULED_AWAKE_PATH}/schedules`, {
      id,
      ...(name === "" ? {} : { label: name }),
      timeZone,
      start,
      end,
      days: [...days].sort((a, b) => a - b),
      requireCharger,
      ...(minBattery.trim() === "" ? {} : { minBatteryPercent: Number(minBattery) }),
    });
    setAsking(false);
    if (saved) {
      setId("");
      setLabel("");
      setDays([]);
    }
  };

  const cancelCurrent = async () => {
    const result = await run<{ status?: unknown }>(
      "POST",
      `${SCHEDULED_AWAKE_PATH}/cancel-current`,
    );
    if (result !== undefined) apply(result.status);
  };

  const toggleDay = (day: number, on: boolean) =>
    setDays(on ? [...days, day] : days.filter((d) => d !== day));

  const when = (schedule: AwakeSchedule) =>
    schedule.recurrence.kind === "once"
      ? formatCalendarDate(schedule.recurrence.date, locale)
      : schedule.recurrence.days.map((day) => weekdayName(day, locale)).join(", ");

  const describeState = (view: ScheduledAwake) => {
    if (view.state === "holding")
      return view.holdEndsAt === null
        ? t("awakeSchedule.state.holding")
        : t("awakeSchedule.state.holdingUntil", { time: formatMoment(view.holdEndsAt, locale) });
    if (view.state === "waiting")
      return t("awakeSchedule.state.waiting", {
        reason: t(
          view.waitingReason !== null && Object.hasOwn(WAITING_REASONS, view.waitingReason)
            ? WAITING_REASONS[view.waitingReason]!
            : "awakeSchedule.waiting.unknown",
        ),
      });
    return t(view.state === "idle" ? "awakeSchedule.state.idle" : "awakeSchedule.state.off");
  };

  const nameOf = (schedules: readonly AwakeSchedule[], scheduleId: string) =>
    schedules.find((s) => s.id === scheduleId)?.label ?? scheduleId;

  return (
    <section className="card" aria-labelledby="scheduled-awake-h">
      <h2 id="scheduled-awake-h">{t("awakeSchedule.schedule.title")}</h2>
      {status === "absent" && <p className="muted">{t("awakeSchedule.schedule.notAvailable")}</p>}
      {status === "failed" && data === null && (
        <p className="error-text small" role="alert">
          {t("awakeSchedule.schedule.loadFailed")}
        </p>
      )}
      {status === "loading" && <p className="muted small">{t("awakeSchedule.loading")}</p>}
      {data !== null && (
        <>
          <p>{t("awakeSchedule.schedule.intro")}</p>
          {!data.awakeAvailable && (
            <p className="warning-text small" role="note">
              {t("awakeSchedule.schedule.awakeOff")}
            </p>
          )}
          <p role="status">{describeState(data)}</p>
          <label>
            <input
              type="checkbox"
              checked={data.enabled}
              disabled={busy}
              onChange={(event) => void setEnabled(event.target.checked)}
            />{" "}
            {t("awakeSchedule.schedule.enable")}
          </label>
          {asking && busy && (
            <p className="small" role="status">
              {t("awakeSchedule.schedule.confirming")}
            </p>
          )}
          {data.state === "holding" && (
            <p>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void cancelCurrent()}
              >
                {t("awakeSchedule.cancel.button")}
              </button>
            </p>
          )}

          <h3 className="h3">{t("awakeSchedule.list.title")}</h3>
          {data.schedules.length === 0 ? (
            <p className="muted small">{t("awakeSchedule.list.empty")}</p>
          ) : (
            <ul className="card-list">
              {data.schedules.map((schedule) => (
                <li key={schedule.id}>
                  <strong>{schedule.label ?? schedule.id}</strong>{" "}
                  <span className="small">
                    {t("awakeSchedule.list.line", {
                      when: when(schedule),
                      start: schedule.start,
                      end: schedule.end,
                      zone: schedule.timeZone,
                    })}
                  </span>{" "}
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    aria-label={t("awakeSchedule.list.removeNamed", {
                      name: schedule.label ?? schedule.id,
                    })}
                    onClick={() =>
                      void change(
                        "DELETE",
                        `${SCHEDULED_AWAKE_PATH}/schedules/${encodeURIComponent(schedule.id)}`,
                      )
                    }
                  >
                    {t("awakeSchedule.list.remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3 className="h3">{t("awakeSchedule.upcoming.title")}</h3>
          {data.upcoming.length === 0 ? (
            <p className="muted small">{t("awakeSchedule.upcoming.empty")}</p>
          ) : (
            <ul className="card-list">
              {data.upcoming.map((window) => {
                const name = nameOf(data.schedules, window.scheduleId);
                const from = formatMoment(window.startsAt, locale);
                return (
                  <li key={window.key}>
                    <span className="small">
                      {t("awakeSchedule.upcoming.line", {
                        name,
                        from,
                        to: formatMoment(window.endsAt, locale),
                      })}
                    </span>{" "}
                    {window.skipped && (
                      <span className="muted small">{t("awakeSchedule.upcoming.skipped")}</span>
                    )}{" "}
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      aria-label={t(
                        window.skipped
                          ? "awakeSchedule.upcoming.unskipNamed"
                          : "awakeSchedule.upcoming.skipNamed",
                        { name, time: from },
                      )}
                      onClick={() =>
                        void (window.skipped
                          ? change(
                              "DELETE",
                              `${SCHEDULED_AWAKE_PATH}/skips/${encodeURIComponent(window.key)}`,
                            )
                          : change("POST", `${SCHEDULED_AWAKE_PATH}/skips`, { key: window.key }))
                      }
                    >
                      {t(
                        window.skipped
                          ? "awakeSchedule.upcoming.unskip"
                          : "awakeSchedule.upcoming.skip",
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <h3 className="h3">{t("awakeSchedule.add.title")}</h3>
          <form onSubmit={(event) => void save(event)}>
            <p>
              <label>
                {t("awakeSchedule.add.id")}{" "}
                <input
                  type="text"
                  value={id}
                  maxLength={40}
                  onChange={(event) => setId(event.target.value)}
                />
              </label>{" "}
              <label>
                {t("awakeSchedule.add.label")}{" "}
                <input
                  type="text"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                {t("awakeSchedule.add.zone")}{" "}
                <input
                  type="text"
                  value={timeZone}
                  onChange={(event) => setTimeZone(event.target.value)}
                />
              </label>{" "}
              <label>
                {t("awakeSchedule.add.start")}{" "}
                <input
                  type="time"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>{" "}
              <label>
                {t("awakeSchedule.add.end")}{" "}
                <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
              </label>
            </p>
            <fieldset>
              <legend>{t("awakeSchedule.add.days")}</legend>
              {WEEKDAYS.map((day) => (
                <label key={day}>
                  <input
                    type="checkbox"
                    checked={days.includes(day)}
                    onChange={(event) => toggleDay(day, event.target.checked)}
                  />{" "}
                  {weekdayName(day, locale)}{" "}
                </label>
              ))}
            </fieldset>
            <p>
              <label>
                <input
                  type="checkbox"
                  checked={requireCharger}
                  onChange={(event) => setRequireCharger(event.target.checked)}
                />{" "}
                {t("awakeSchedule.add.charger")}
              </label>{" "}
              <label>
                {t("awakeSchedule.add.minBattery")}{" "}
                <input
                  type="number"
                  min={5}
                  max={90}
                  value={minBattery}
                  onChange={(event) => setMinBattery(event.target.value)}
                />
              </label>
            </p>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t("awakeSchedule.add.submit")}
            </button>
          </form>
        </>
      )}
      <Feedback error={error} />
    </section>
  );
}
