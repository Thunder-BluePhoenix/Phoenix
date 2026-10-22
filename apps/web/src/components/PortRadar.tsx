// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useState } from "react";
import { useClient } from "../core/context";
import { formatDate, formatNumber, formatTime } from "../core/format";
import { useAction, useCommandAction } from "../core/hooks";
import {
  ageParts,
  localhostUrl,
  readPortsSnapshot,
  readStopResult,
  usePortsAvailability,
  type PortView,
  type PortsSnapshotView,
  type StopResultView,
} from "../core/ports";
import { useLocale, useT, type MessageKey } from "../i18n";
import { Feedback } from "./Feedback";

const AGE_TEXT: Record<"minutes" | "hours" | "days", MessageKey> = {
  minutes: "ports.age.minutes",
  hours: "ports.age.hours",
  days: "ports.age.days",
};

const EXPOSURE_TEXT: Record<PortView["exposure"], MessageKey> = {
  all: "ports.exposure.all",
  loopback: "ports.exposure.loopback",
  interface: "ports.exposure.interface",
};

const REFUSAL_TEXT: Record<NonNullable<PortView["refusal"]>, MessageKey> = {
  self: "ports.refusal.self",
  other_user: "ports.refusal.other_user",
  system: "ports.refusal.system",
  not_dev_tool: "ports.refusal.not_dev_tool",
  unsupported: "ports.refusal.unsupported",
  unknown: "ports.refusal.unknown",
};

/** What the user is being asked about: one process on one port, with which signal. */
interface Pending {
  port: PortView;
  force: boolean;
}

/**
 * Port & process radar: the programs listening on this computer, their project folder and age,
 * flags for forgotten and heavy ones, and a guarded Stop. Scanning is on request (or on Core's
 * change announcement when the user turned background refresh on); stopping goes through Core's
 * approval prompt every time, and "force stop" is a second, separate request.
 */
export function PortRadar() {
  const t = useT();
  const { locale } = useLocale();
  const client = useClient();
  const ids = useId();
  const { availability, watching, config } = usePortsAvailability();
  const scan = useCommandAction("ports", "list");
  const stop = useCommandAction("ports", "stop_process");
  const force = useCommandAction("ports", "force_stop");
  const settings = useAction();
  const [pending, setPending] = useState<Pending | null>(null);
  const [last, setLast] = useState<StopResultView | null>(null);

  const snapshot: PortsSnapshotView | null = readPortsSnapshot(scan.result);
  const scanFailed = scan.state === "failed" || (scan.state === "succeeded" && snapshot === null);
  const submitScan = scan.submit;
  const resetStop = stop.reset;
  const resetForce = force.reset;

  // Core announces a changed list only while the user has background refresh on.
  useEffect(() => {
    if (availability !== "ready" || !watching) return;
    return client.eventCreated.on(({ event }) => {
      if (event.event_type === "ports.radar.changed") void submitScan({});
    });
  }, [client, availability, watching, submitScan]);

  // A finished stop or force stop: show what happened and read the list again.
  const stopped = readStopResult(stop.result);
  const forced = readStopResult(force.result);
  useEffect(() => {
    if (stop.state === "succeeded" && stopped) {
      setLast(stopped);
      setPending(null);
      resetStop();
      void submitScan({});
    }
  }, [stop.state, stopped, resetStop, submitScan]);
  useEffect(() => {
    if (force.state === "succeeded" && forced) {
      setLast(forced);
      setPending(null);
      resetForce();
      void submitScan({});
    }
  }, [force.state, forced, resetForce, submitScan]);

  if (availability === "absent") return null;
  const busy = scan.busy || stop.busy || force.busy;
  const requestError = stop.error ?? force.error;

  const ask = (port: PortView, isForce: boolean) => {
    resetStop();
    resetForce();
    setLast(null);
    setPending({ port, force: isForce });
  };
  const confirm = () => {
    if (!pending) return;
    const { port } = pending;
    if (port.command === null || port.start === null || port.uid === null) return;
    const body = {
      pid: port.pid,
      port: port.port,
      start: port.start,
      command: port.command,
      uid: port.uid,
    };
    void (pending.force ? force.submit(body) : stop.submit(body));
  };
  const toggleWatch = async (on: boolean) => {
    const next = { ...config };
    if (on) next.watch = true;
    else delete next.watch;
    await settings.run("POST", "/api/capabilities/ports/config", { config: next });
  };

  const rows = snapshot?.ports ?? [];
  const when = snapshot
    ? `${formatDate(snapshot.scanned_at, locale)} ${formatTime(snapshot.scanned_at, locale)}`
    : "";

  return (
    <section aria-labelledby={`${ids}-h`} className="card port-radar">
      <h2 id={`${ids}-h`} className="h3">
        {t("ports.title")}
      </h2>
      <p className="muted small">{t("ports.intro")}</p>
      {availability === "disabled" ? (
        <p className="muted small" role="status">
          {t("ports.disabled")}
        </p>
      ) : (
        <>
          <div className="button-row wrap">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void submitScan({})}
            >
              {scan.busy ? t("ports.scanning") : t("ports.scan")}
            </button>
          </div>
          <label className="choice">
            <input
              type="checkbox"
              checked={watching}
              disabled={settings.busy}
              aria-describedby={`${ids}-watch`}
              onChange={(e) => void toggleWatch(e.target.checked)}
            />
            {t("ports.watch.label")}
          </label>
          <p id={`${ids}-watch`} className="muted small">
            {t("ports.watch.help")}
          </p>
          <Feedback error={settings.error} />
          {scanFailed && <Feedback error={scan.error ?? t("ports.loadError")} />}

          {snapshot === null && !scanFailed && scan.state === "idle" && (
            <p className="muted small">{t("ports.notScanned")}</p>
          )}

          {snapshot && (
            <>
              <p className="small" role="status">
                {t("ports.count", { count: rows.length })} · {t("ports.scannedAt", { time: when })}
              </p>
              {!snapshot.process_table && (
                <p className="port-warning small">{t("ports.noProcessTable")}</p>
              )}
              {snapshot.parse_warnings > 0 && (
                <p className="port-warning small">{t("ports.parseWarnings")}</p>
              )}
              {snapshot.platform === "win32" && (
                <p className="muted small">{t("ports.windows.note")}</p>
              )}
              {rows.length === 0 ? (
                <p className="muted small">{t("ports.empty")}</p>
              ) : (
                <table className="port-table small">
                  <caption className="muted">{t("ports.table.caption")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("ports.col.port")}</th>
                      <th scope="col">{t("ports.col.process")}</th>
                      <th scope="col">{t("ports.col.project")}</th>
                      <th scope="col">{t("ports.col.age")}</th>
                      <th scope="col">{t("ports.col.notes")}</th>
                      <th scope="col">{t("ports.col.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const age = ageParts(row.age_seconds);
                      const url = localhostUrl(row.port, row.reachable);
                      return (
                        <tr key={`${row.pid}:${row.port}`}>
                          <td>
                            <code className="port-mono">
                              {formatNumber(row.port, locale, { useGrouping: false })}
                            </code>
                          </td>
                          <td>
                            {row.name}
                            <br />
                            <span className="muted">{t("ports.pid", { pid: row.pid })}</span>
                          </td>
                          <td>
                            {row.project ?? (
                              <span className="muted">{t("ports.project.none")}</span>
                            )}
                          </td>
                          <td>
                            {age ? (
                              t(AGE_TEXT[age.unit], { count: age.count })
                            ) : (
                              <span className="muted">{t("ports.age.unknown")}</span>
                            )}
                          </td>
                          <td>
                            <ul className="port-notes">
                              <li className="muted">{t(EXPOSURE_TEXT[row.exposure])}</li>
                              {row.is_core && <li>{t("ports.flag.core")}</li>}
                              {row.forgotten && (
                                <li className="port-flag">{t("ports.flag.forgotten")}</li>
                              )}
                              {row.heavy && <li className="port-flag">{t("ports.flag.heavy")}</li>}
                              {row.cpu_percent !== null && row.rss_mb !== null && (
                                <li className="muted">
                                  {t("ports.usage", {
                                    percent: formatNumber(row.cpu_percent, locale, {
                                      maximumFractionDigits: 1,
                                    }),
                                    mb: formatNumber(row.rss_mb, locale),
                                  })}
                                </li>
                              )}
                            </ul>
                          </td>
                          <td>
                            <div className="button-row wrap">
                              {url && (
                                <a
                                  className="btn"
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={t("ports.open.label", {
                                    name: row.name,
                                    port: row.port,
                                  })}
                                >
                                  {t("ports.open")}
                                </a>
                              )}
                              {row.stoppable ? (
                                <button
                                  type="button"
                                  className="btn btn-danger-outline"
                                  disabled={busy}
                                  aria-label={t("ports.stop.label", {
                                    name: row.name,
                                    port: row.port,
                                  })}
                                  onClick={() => ask(row, false)}
                                >
                                  {t("ports.stop")}
                                </button>
                              ) : (
                                row.refusal && (
                                  <span className="muted">{t(REFUSAL_TEXT[row.refusal])}</span>
                                )
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <p className="muted small">
                {t("ports.help.forgotten", { hours: snapshot.thresholds.forgottenHours })}
              </p>
              <p className="muted small">
                {t("ports.help.heavy", {
                  cpu: snapshot.thresholds.heavyCpuPercent,
                  mb: formatNumber(snapshot.thresholds.heavyRssMb, locale),
                })}
              </p>
              {rows.some((r) => r.reachable) && (
                <p className="muted small">{t("ports.openNote")}</p>
              )}
            </>
          )}

          {pending && (
            <div className="card port-confirm" role="group" aria-labelledby={`${ids}-confirm`}>
              <p id={`${ids}-confirm`}>
                <strong>
                  {t(pending.force ? "ports.force.label" : "ports.confirm.title", {
                    name: pending.port.name,
                    port: pending.port.port,
                  })}
                </strong>
              </p>
              <p className="small">
                {t("ports.confirm.body", {
                  name: pending.port.name,
                  pid: pending.port.pid,
                })}
              </p>
              {pending.force && <p className="port-warning small">{t("ports.force.hint")}</p>}
              {(stop.state === "waiting" || force.state === "waiting") && (
                <p className="small" role="status">
                  {t("ports.stop.waiting")}
                </p>
              )}
              <Feedback error={requestError} />
              <div className="button-row wrap">
                <button
                  type="button"
                  className={pending.force ? "btn btn-danger" : "btn btn-primary"}
                  disabled={busy}
                  onClick={confirm}
                >
                  {pending.force ? t("ports.force.confirm") : t("ports.confirm.go")}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => setPending(null)}
                >
                  {t("ports.confirm.cancel")}
                </button>
              </div>
            </div>
          )}

          {last && !pending && (
            <div role="status" className="small">
              <p>
                {last.exited
                  ? t("ports.stop.exited", { name: last.name })
                  : t("ports.stop.stillRunning", { name: last.name })}
              </p>
              {last.can_force && !last.exited && (
                <button
                  type="button"
                  className="btn btn-danger-outline"
                  disabled={busy}
                  aria-label={t("ports.force.label", { name: last.name, port: last.port })}
                  onClick={() => {
                    const again = rows.find((r) => r.pid === last.pid && r.port === last.port);
                    if (again) ask(again, true);
                  }}
                >
                  {t("ports.force")}
                </button>
              )}
            </div>
          )}
          <p className="muted small">{t("ports.restart.note")}</p>
        </>
      )}
    </section>
  );
}
