// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { formatAgo } from "../core/format";
import { useCapabilities, useCommandResult } from "../core/hooks";
import {
  changeDirection,
  formatAmount,
  formatPct,
  formatUsd,
  readSnapshot,
  sparklinePath,
} from "../core/portfolio";

const CHART_WIDTH = 120;
const CHART_HEIGHT = 32;

const DIRECTION_CLASS = { up: "success-text", down: "error-text", flat: "muted" } as const;

/** A change with its sign in the text, tinted by direction: the colour is never the only cue. */
function Change({ pct }: { pct: number | undefined }) {
  return <span className={DIRECTION_CLASS[changeDirection(pct)]}>{formatPct(pct)}</span>;
}

/** What the portfolio capability knows: total, 24 h change, 7-day line and holdings. Display only. */
export function PortfolioGlance() {
  const { data: caps } = useCapabilities();
  const on = caps.find((c) => c.id === "portfolio")?.status === "enabled";
  const { data, error } = useCommandResult<unknown>(
    "portfolio",
    "snapshot",
    on,
    (t) => t === "portfolio.snapshot.updated",
  );
  if (!on) return null;
  const snapshot = readSnapshot(data);
  const path = sparklinePath(snapshot?.sparkline ?? [], CHART_WIDTH, CHART_HEIGHT);
  const loaded = snapshot !== null && snapshot.updated_at !== null;
  return (
    <section aria-labelledby="portfolio-h" className="portfolio">
      <h3 id="portfolio-h">Portfolio</h3>
      {error && <p className="error-text small">{error}</p>}
      {!loaded && !error && <p className="muted small">Not yet loaded.</p>}
      {snapshot && loaded && (
        <>
          <p className="portfolio-total">
            <strong>{formatUsd(snapshot.total_usd)}</strong>{" "}
            <span className="muted small">24 h </span>
            <Change pct={snapshot.change_24h_pct} />
          </p>
          {path && (
            <svg
              role="img"
              aria-label="7-day value"
              className="portfolio-chart"
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              width={CHART_WIDTH}
              height={CHART_HEIGHT}
            >
              <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          )}
          {snapshot.holdings.length > 0 && (
            <ul className="task-list">
              {snapshot.holdings.map((h) => (
                <li key={`${h.source}:${h.label}:${h.asset}`}>
                  <strong>{h.label}</strong> <span className="muted">{h.asset}</span>
                  <span className="muted small"> · {formatAmount(h.amount)}</span>
                  <span> · {formatUsd(h.value_usd)}</span>
                  <span className="small">
                    {" "}
                    · <Change pct={h.change_24h_pct} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {snapshot.unpriced > 0 && (
            <p className="muted small">{snapshot.unpriced} without a price, not in the total.</p>
          )}
        </>
      )}
      {snapshot?.sources
        .filter((s) => !s.ok)
        .map((s) => (
          <p key={s.id} className="error-text small">
            {s.name}: {s.error ?? "could not be read"}
          </p>
        ))}
      {snapshot && loaded && (
        <p className="muted small">
          {snapshot.price_source && `Prices: ${snapshot.price_source}. `}
          {snapshot.note}
          {snapshot.updated_at && ` Updated ${formatAgo(snapshot.updated_at)}.`}
        </p>
      )}
    </section>
  );
}
