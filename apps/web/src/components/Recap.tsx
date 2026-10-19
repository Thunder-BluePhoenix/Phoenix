// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useState } from "react";
import { useClient } from "../core/context";
import { useAction } from "../core/hooks";
import {
  formatCodingTime,
  formatDayKey,
  formatWeek,
  gridLevel,
  isEmptyWeek,
  type Recap,
} from "../core/recap";
import { downloadRecapPng } from "../core/recap-image";
import { formatNumber } from "../core/format";
import { useT } from "../i18n";
import { Feedback } from "./Feedback";

/** The same week, a number of weeks earlier (negative) or later, as a day key the API accepts. */
function shiftWeek(start: string, weeks: number): string {
  const [y, m, d] = start.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + weeks * 7)).toISOString().slice(0, 10);
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="recap-stat">
      <dt className="muted small">{label}</dt>
      <dd>
        <strong>{value}</strong>
      </dd>
    </div>
  );
}

/** Commits per local day, one column per week. A table for assistive tech; colour is never the only cue. */
function ContributionGrid({ grid }: { grid: Recap["grid"] }) {
  const t = useT();
  return (
    <section aria-labelledby="recap-grid-h">
      <h3 id="recap-grid-h" className="h3">
        {t("memory.recap.grid.title")}
      </h3>
      <div
        className="recap-grid"
        role="img"
        aria-label={t("memory.recap.grid.label", { commits: grid.total, weeks: grid.weeks.length })}
      >
        {grid.weeks.map((week) => (
          <div key={week.start} className="recap-grid-week">
            {week.days.map((d) => (
              <span
                key={d.day}
                className={`recap-cell recap-level-${gridLevel(d.count, grid.max)}`}
                title={t("memory.recap.grid.cell", { day: formatDayKey(d.day), count: d.count })}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="muted small">{t("memory.recap.grid.note")}</p>
    </section>
  );
}

/** The weekly recap: numbers kept on this computer, a share image and a delete button. */
export function RecapPage({
  download = downloadRecapPng,
}: {
  /** Test seam: production draws the PNG on a canvas. */
  download?: typeof downloadRecapPng;
}) {
  const client = useClient();
  const t = useT();
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showProjects, setShowProjects] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const { run, busy, error } = useAction();

  const load = useCallback(async () => {
    try {
      const query = week ? `?week=${encodeURIComponent(week)}` : "";
      setRecap(await client.request<Recap>("GET", `/api/recap${query}`));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t("common.error.coreUnreachable"));
    }
  }, [client, week, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    const r = await run<{ deleted: number }>("DELETE", "/api/recap?confirm=true");
    setConfirm(false);
    if (r) setSaved(t("memory.recap.deleted", { count: r.deleted }));
    await load();
  };

  const exportImage = async () => {
    if (!recap) return;
    setExportError(null);
    try {
      await download(recap, { showProjects });
      setSaved(t("memory.recap.saved"));
    } catch (err) {
      setExportError(err instanceof Error ? err.message : t("memory.recap.exportFailed"));
    }
  };

  return (
    <section aria-labelledby="recap-h" className="card recap">
      <h2 id="recap-h" className="h3">
        {t("memory.recap.title")}
      </h2>
      {loadError && (
        <p className="error-text" role="alert">
          {loadError}
        </p>
      )}
      {!recap && !loadError && <p className="muted small">{t("common.status.loading")}</p>}
      {recap && (
        <>
          <div className="button-row wrap">
            <button
              type="button"
              className="btn"
              onClick={() => setWeek(shiftWeek(recap.week.start, -1))}
            >
              {t("memory.recap.previousWeek")}
            </button>
            <strong aria-live="polite">{formatWeek(recap.week)}</strong>
            <button
              type="button"
              className="btn"
              disabled={recap.week.current}
              onClick={() => setWeek(shiftWeek(recap.week.start, 1))}
            >
              {t("memory.recap.nextWeek")}
            </button>
          </div>
          {isEmptyWeek(recap) && (
            <p className="muted" role="status">
              {t("memory.recap.empty")}
            </p>
          )}
          <dl className="recap-stats">
            <Stat
              label={t("memory.recap.stat.timeCoding")}
              value={formatCodingTime(recap.coding.seconds)}
            />
            <Stat
              label={t("memory.recap.stat.sessions")}
              value={formatNumber(recap.coding.sessions)}
            />
            <Stat label={t("memory.recap.stat.files")} value={formatNumber(recap.coding.files)} />
            <Stat
              label={t("memory.recap.stat.linesChanged")}
              value={formatNumber(recap.coding.lines_changed)}
            />
            <Stat
              label={t("memory.recap.stat.commands")}
              value={formatNumber(recap.coding.commands)}
            />
            <Stat
              label={t("memory.recap.stat.permissionsGranted")}
              value={formatNumber(recap.permissions.granted)}
            />
            <Stat
              label={t("memory.recap.stat.permissionsDenied")}
              value={formatNumber(recap.permissions.denied)}
            />
            <Stat
              label={t("memory.recap.stat.longestSession")}
              value={formatCodingTime(recap.coding.longest_session_seconds)}
            />
            <Stat
              label={t("memory.recap.stat.topAgent")}
              value={recap.top_agent?.name ?? t("memory.recap.value.none")}
            />
            <Stat
              label={t("memory.recap.stat.topProject")}
              value={recap.top_project ? recap.top_project.name : t("memory.recap.value.none")}
            />
            <Stat
              label={t("memory.recap.stat.busiestDay")}
              value={
                recap.busiest_day
                  ? formatDayKey(recap.busiest_day.day)
                  : t("memory.recap.value.none")
              }
            />
            <Stat label={t("memory.recap.stat.commits")} value={formatNumber(recap.commits)} />
            <Stat
              label={t("memory.recap.stat.ci")}
              value={`${formatNumber(recap.ci.passed)} / ${formatNumber(recap.ci.failed)}`}
            />
            <Stat
              label={t("memory.recap.stat.meetings")}
              value={
                recap.meetings
                  ? `${formatNumber(recap.meetings.count)} / ${formatNumber(recap.meetings.decisions)}`
                  : t("memory.recap.value.off")
              }
            />
          </dl>
          {!recap.meetings_allowed && (
            <p className="muted small">{t("memory.recap.meetingsHidden")}</p>
          )}
          <ContributionGrid grid={recap.grid} />
          <div className="button-row wrap">
            <label className="check">
              <input
                type="checkbox"
                checked={showProjects}
                onChange={(e) => setShowProjects(e.target.checked)}
              />{" "}
              {t("memory.recap.showProjects")}
            </label>
            <button type="button" className="btn btn-primary" onClick={() => void exportImage()}>
              {t("memory.recap.saveImage")}
            </button>
          </div>
          <p className="muted small">{t("memory.recap.countsNote")}</p>
          {confirm ? (
            <div className="button-row wrap">
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                {t("memory.recap.confirmDelete")}
              </button>
              <button type="button" className="btn" onClick={() => setConfirm(false)}>
                {t("common.button.cancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={() => setConfirm(true)}
            >
              {t("memory.recap.deleteAll")}
            </button>
          )}
          <Feedback error={error ?? exportError} saved={saved} />
        </>
      )}
    </section>
  );
}
