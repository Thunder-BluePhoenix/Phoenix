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
  return (
    <section aria-labelledby="recap-grid-h">
      <h3 id="recap-grid-h" className="h3">
        Commit grid
      </h3>
      <div
        className="recap-grid"
        role="img"
        aria-label={`${grid.total} commits in ${grid.weeks.length} weeks`}
      >
        {grid.weeks.map((week) => (
          <div key={week.start} className="recap-grid-week">
            {week.days.map((d) => (
              <span
                key={d.day}
                className={`recap-cell recap-level-${gridLevel(d.count, grid.max)}`}
                title={`${formatDayKey(d.day)}: ${d.count} ${d.count === 1 ? "commit" : "commits"}`}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="muted small">
        Counted on this computer from the commits Phoenix saw in the repositories it watches. This
        is not your GitHub contribution calendar.
      </p>
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
      setLoadError(err instanceof Error ? err.message : "Phoenix Core is unreachable");
    }
  }, [client, week]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    const r = await run<{ deleted: number }>("DELETE", "/api/recap?confirm=true");
    setConfirm(false);
    if (r) setSaved(`Deleted ${r.deleted} recap records.`);
    await load();
  };

  const exportImage = async () => {
    if (!recap) return;
    setExportError(null);
    try {
      await download(recap, { showProjects });
      setSaved("Recap image saved.");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "The recap image could not be saved");
    }
  };

  return (
    <section aria-labelledby="recap-h" className="card recap">
      <h2 id="recap-h" className="h3">
        Weekly recap
      </h2>
      {loadError && (
        <p className="error-text" role="alert">
          {loadError}
        </p>
      )}
      {!recap && !loadError && <p className="muted small">Loading…</p>}
      {recap && (
        <>
          <div className="button-row wrap">
            <button
              type="button"
              className="btn"
              onClick={() => setWeek(shiftWeek(recap.week.start, -1))}
            >
              Previous week
            </button>
            <strong aria-live="polite">{formatWeek(recap.week)}</strong>
            <button
              type="button"
              className="btn"
              disabled={recap.week.current}
              onClick={() => setWeek(shiftWeek(recap.week.start, 1))}
            >
              Next week
            </button>
          </div>
          {isEmptyWeek(recap) && (
            <p className="muted" role="status">
              Nothing was recorded this week.
            </p>
          )}
          <dl className="recap-stats">
            <Stat label="Time coding" value={formatCodingTime(recap.coding.seconds)} />
            <Stat label="Sessions" value={recap.coding.sessions} />
            <Stat label="Files" value={recap.coding.files} />
            <Stat label="Lines changed" value={recap.coding.lines_changed} />
            <Stat label="Commands" value={recap.coding.commands} />
            <Stat label="Permissions granted" value={recap.permissions.granted} />
            <Stat label="Permissions denied" value={recap.permissions.denied} />
            <Stat
              label="Longest session"
              value={formatCodingTime(recap.coding.longest_session_seconds)}
            />
            <Stat label="Top agent" value={recap.top_agent?.name ?? "none"} />
            <Stat label="Top project" value={recap.top_project ? recap.top_project.name : "none"} />
            <Stat
              label="Busiest day"
              value={recap.busiest_day ? formatDayKey(recap.busiest_day.day) : "none"}
            />
            <Stat label="Commits" value={recap.commits} />
            <Stat label="CI passed / failed" value={`${recap.ci.passed} / ${recap.ci.failed}`} />
            <Stat
              label="Meetings / decisions"
              value={
                recap.meetings ? `${recap.meetings.count} / ${recap.meetings.decisions}` : "off"
              }
            />
          </dl>
          {!recap.meetings_allowed && (
            <p className="muted small">
              Meetings and decisions stay out of the recap while sensitive meeting data is off in
              Memory settings.
            </p>
          )}
          <ContributionGrid grid={recap.grid} />
          <div className="button-row wrap">
            <label className="check">
              <input
                type="checkbox"
                checked={showProjects}
                onChange={(e) => setShowProjects(e.target.checked)}
              />{" "}
              Show the project name in the image
            </label>
            <button type="button" className="btn btn-primary" onClick={() => void exportImage()}>
              Save image (1080 × 1920)
            </button>
          </div>
          <p className="muted small">
            Everything here is counted on this computer. Phoenix keeps counts only, never file
            names, commands or text, and no AI is used.
          </p>
          {confirm ? (
            <div className="button-row wrap">
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                Confirm: delete all recap statistics
              </button>
              <button type="button" className="btn" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={() => setConfirm(true)}
            >
              Delete all recap statistics…
            </button>
          )}
          <Feedback error={error ?? exportError} saved={saved} />
        </>
      )}
    </section>
  );
}
