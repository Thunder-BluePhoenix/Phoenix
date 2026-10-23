// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { ApiError } from "../core/client";
import { useClient } from "../core/context";
import { formatAgo, formatNumber } from "../core/format";
import {
  MISSION_STATES,
  NO_FILTER,
  REASON_TEXT,
  STATE_TEXT,
  STUCK_REASON_TEXT,
  distinct,
  filterSessions,
  formatTokens,
  formatUsd,
  type BoardFilter,
  type Mission,
  type MissionBudget,
  type MissionBudgetInput,
  type MissionConfig,
  type MissionConfigUpdate,
  type MissionSession,
  type MissionState,
  type MissionTotals,
} from "../core/mission";
import { useT, type Translate } from "../i18n";
import { Feedback } from "./Feedback";

const WINDOW_DAYS = 14;

/** A cost for display: the amount, "or more" when partly unknown, or the word for unknown. Never "$0" for null. */
function costText(t: Translate, totals: MissionTotals, style: "card" | "table"): string {
  const cost = formatUsd(totals.cost_usd);
  if (cost === null)
    return style === "card" ? t("mission.card.costUnknown") : t("mission.totals.unknown");
  if (totals.cost_partial)
    return style === "card"
      ? t("mission.card.costPartial", { cost })
      : t("mission.totals.partial", { cost });
  return style === "card" ? t("mission.card.cost", { cost }) : cost;
}

function tokenText(t: Translate, totals: MissionTotals): string {
  return totals.tokens_reported
    ? t("mission.card.tokens", {
        input: formatTokens(totals.input_tokens),
        output: formatTokens(totals.output_tokens),
      })
    : t("mission.card.noTokens");
}

function SessionCard({
  session,
  onFocus,
  busy,
  focused,
}: {
  session: MissionSession;
  onFocus: (s: MissionSession) => void;
  busy: boolean;
  focused: boolean;
}) {
  const t = useT();
  const detail =
    session.state === "waiting" && session.reason ? REASON_TEXT[session.reason] : undefined;
  const stuck = session.stuck_reason ? STUCK_REASON_TEXT[session.stuck_reason] : undefined;
  return (
    <li className="mission-card">
      <p>
        <strong>{session.agent}</strong>{" "}
        <span className="muted">{session.project || t("mission.card.unnamedProject")}</span>
      </p>
      {(detail ?? stuck) && <p className="small">{detail ?? stuck}</p>}
      <p className="small">{tokenText(t, session.usage)}</p>
      <p className="small">{costText(t, session.usage, "card")}</p>
      <p className="muted small">
        {session.last_seen
          ? t("mission.card.lastSeen", { ago: formatAgo(session.last_seen) })
          : null}
        {session.steps !== undefined
          ? ` ${t("mission.card.steps", { count: session.steps })}`
          : null}
      </p>
      <div className="button-row wrap">
        {session.can_open && (
          <a className="btn" href={`#/agents/${encodeURIComponent(session.id)}`}>
            {t("mission.card.open")}
          </a>
        )}
        {session.can_focus && (
          <button type="button" className="btn" disabled={busy} onClick={() => onFocus(session)}>
            {t("mission.card.focus")}
          </button>
        )}
      </div>
      {focused && (
        <p className="small" role="status">
          {t("mission.card.focused")}
        </p>
      )}
    </li>
  );
}

function Column({
  state,
  sessions,
  onFocus,
  focusing,
  focused,
}: {
  state: MissionState;
  sessions: MissionSession[];
  onFocus: (s: MissionSession) => void;
  focusing: string | null;
  focused: string | null;
}) {
  const t = useT();
  const id = useId();
  return (
    <section aria-labelledby={id} className={`mission-column mission-${state}`}>
      <h3 id={id} className="h3">
        {STATE_TEXT[state]}{" "}
        <span className="muted small">{t("mission.column.count", { count: sessions.length })}</span>
      </h3>
      {sessions.length === 0 ? (
        <p className="muted small">{t("mission.column.empty")}</p>
      ) : (
        <ul className="mission-list">
          {sessions.map((s) => (
            <SessionCard
              key={s.key}
              session={s}
              onFocus={onFocus}
              busy={focusing !== null}
              focused={focused === s.key}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Filters({
  filter,
  onChange,
  sessions,
}: {
  filter: BoardFilter;
  onChange: (f: BoardFilter) => void;
  sessions: MissionSession[];
}) {
  const t = useT();
  const id = useId();
  const agents = distinct(sessions.map((s) => s.agent));
  const projects = distinct(sessions.map((s) => s.project));
  const active = JSON.stringify(filter) !== JSON.stringify(NO_FILTER);
  return (
    <div className="mission-filters button-row wrap">
      <label htmlFor={`${id}-q`}>{t("mission.filter.search")}</label>
      <input
        id={`${id}-q`}
        type="search"
        value={filter.query}
        placeholder={t("mission.filter.searchPlaceholder")}
        onChange={(e) => onChange({ ...filter, query: e.target.value })}
      />
      <label htmlFor={`${id}-a`}>{t("mission.filter.agent")}</label>
      <select
        id={`${id}-a`}
        value={filter.agent}
        onChange={(e) => onChange({ ...filter, agent: e.target.value })}
      >
        <option value="">{t("mission.filter.all")}</option>
        {agents.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-p`}>{t("mission.filter.project")}</label>
      <select
        id={`${id}-p`}
        value={filter.project}
        onChange={(e) => onChange({ ...filter, project: e.target.value })}
      >
        <option value="">{t("mission.filter.all")}</option>
        {projects.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-s`}>{t("mission.filter.state")}</label>
      <select
        id={`${id}-s`}
        value={filter.state}
        onChange={(e) => onChange({ ...filter, state: e.target.value as BoardFilter["state"] })}
      >
        <option value="">{t("mission.filter.all")}</option>
        {MISSION_STATES.map((s) => (
          <option key={s} value={s}>
            {STATE_TEXT[s]}
          </option>
        ))}
      </select>
      {active && (
        <button type="button" className="btn" onClick={() => onChange(NO_FILTER)}>
          {t("mission.filter.clear")}
        </button>
      )}
    </div>
  );
}

function UsageTable({
  title,
  rows,
  first,
}: {
  title: string;
  rows: { key: string; name: string; totals: MissionTotals }[];
  first: string;
}) {
  const t = useT();
  if (rows.length === 0) return null;
  return (
    <section>
      <h4 className="h3">{title}</h4>
      <table className="mission-table">
        <thead>
          <tr>
            <th scope="col">{first}</th>
            <th scope="col">{t("mission.col.input")}</th>
            <th scope="col">{t("mission.col.output")}</th>
            <th scope="col">{t("mission.col.cost")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.name}</th>
              <td>{r.totals.tokens_reported ? formatTokens(r.totals.input_tokens) : "–"}</td>
              <td>{r.totals.tokens_reported ? formatTokens(r.totals.output_tokens) : "–"}</td>
              <td>{costText(t, r.totals, "table")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Totals({ mission }: { mission: Mission }) {
  const t = useT();
  const { totals } = mission;
  const empty = !totals.tokens_reported && totals.cost_usd === null;
  const costStat = costText(t, totals, "table");
  return (
    <section aria-labelledby="mission-totals-h" className="card">
      <h3 id="mission-totals-h" className="h3">
        {t("mission.totals.title")}
      </h3>
      <p className="muted small">{t("mission.totals.window", { days: mission.days.length })}</p>
      {empty ? (
        <p className="muted">{t("mission.totals.empty")}</p>
      ) : (
        <dl className="recap-stats">
          <div className="recap-stat">
            <dt className="muted small">{t("mission.totals.input")}</dt>
            <dd>
              <strong>{formatTokens(totals.input_tokens)}</strong>
            </dd>
          </div>
          <div className="recap-stat">
            <dt className="muted small">{t("mission.totals.output")}</dt>
            <dd>
              <strong>{formatTokens(totals.output_tokens)}</strong>
            </dd>
          </div>
          <div className="recap-stat">
            <dt className="muted small">{t("mission.totals.cost")}</dt>
            <dd>
              <strong>{costStat}</strong>
            </dd>
          </div>
        </dl>
      )}
      {mission.unpriced_models.length > 0 && (
        <p className="small" role="status">
          {t("mission.totals.unpriced", { models: mission.unpriced_models.join(", ") })}
        </p>
      )}
      <UsageTable
        title={t("mission.by.day")}
        first={t("mission.col.day")}
        rows={mission.by_day
          .filter((d) => d.tokens_reported || d.cost_usd !== null)
          .map((d) => ({ key: d.day, name: d.day, totals: d }))}
      />
      <UsageTable
        title={t("mission.by.agent")}
        first={t("mission.col.agent")}
        rows={mission.by_agent.map((a) => ({ key: a.agent, name: a.agent, totals: a }))}
      />
      <UsageTable
        title={t("mission.by.project")}
        first={t("mission.col.project")}
        rows={mission.by_project.map((p) => ({
          key: p.project,
          name: p.project || t("mission.card.unnamedProject"),
          totals: p,
        }))}
      />
      <UsageTable
        title={t("mission.by.session")}
        first={t("mission.col.session")}
        rows={mission.by_session.map((s) => ({
          key: `${s.agent}:${s.session_id}`,
          name: `${s.agent} ${s.project || t("mission.card.unnamedProject")}`,
          totals: s,
        }))}
      />
    </section>
  );
}

const positive = (text: string): number | undefined => {
  const n = Number(text);
  return text.trim() !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
};
const nonNegative = (text: string): number | undefined => {
  const n = Number(text);
  return text.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : undefined;
};

function Budgets({
  mission,
  config,
  save,
  busy,
}: {
  mission: Mission;
  config: MissionConfig;
  save: (body: MissionConfigUpdate) => Promise<boolean>;
  busy: boolean;
}) {
  const t = useT();
  const id = useId();
  const [scope, setScope] = useState<MissionBudget["scope"]>("daily");
  const [metric, setMetric] = useState<MissionBudget["metric"]>("tokens");
  const [limit, setLimit] = useState("");
  const [agent, setAgent] = useState("");
  const [problem, setProblem] = useState(false);
  const plain = (b: MissionBudget): MissionBudgetInput => ({
    id: b.id,
    scope: b.scope,
    metric: b.metric,
    limit: b.limit,
    ...(b.agent ? { agent: b.agent } : {}),
  });
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const value = positive(limit);
    if (value === undefined) return setProblem(true);
    setProblem(false);
    const next: MissionBudgetInput = {
      scope,
      metric,
      limit: value,
      ...(agent.trim() ? { agent: agent.trim() } : {}),
    };
    // A budget without an id gets one in Core; the list sent back keeps the ids it already has.
    if (await save({ budgets: [...config.budgets.map(plain), next] })) {
      setLimit("");
      setAgent("");
    }
  };
  const used = (value: number | null, metricOf: MissionBudget["metric"]): string =>
    value === null ? "" : metricOf === "cost" ? (formatUsd(value) ?? "") : formatNumber(value);
  return (
    <section aria-labelledby={`${id}-h`} className="card">
      <h3 id={`${id}-h`} className="h3">
        {t("mission.budgets.title")}
      </h3>
      <p className="muted small">
        {t("mission.budgets.note", {
          thresholds: mission.thresholds.map((p) => `${p}%`).join(", "),
        })}
      </p>
      {mission.budgets.length === 0 ? (
        <p className="muted small">{t("mission.budgets.none")}</p>
      ) : (
        <ul className="mission-list">
          {mission.budgets.map((b) => {
            const vars = {
              scope: t(`mission.budgets.scope.${b.scope}`),
              metric: t(`mission.budgets.metric.${b.metric}`),
              agent: b.agent ? t("mission.budgets.agentSuffix", { agent: b.agent }) : "",
              limit: used(b.limit, b.metric),
            };
            return (
              <li key={b.id}>
                {b.used === null || b.pct === null
                  ? t("mission.budgets.lineUnknown", vars)
                  : t(
                      b.metric === "cost" && b.unpriced_rows > 0
                        ? "mission.budgets.lineAtLeast"
                        : "mission.budgets.line",
                      {
                        ...vars,
                        used: used(b.used, b.metric),
                        pct: formatNumber(b.pct),
                      },
                    )}{" "}
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  aria-label={t("mission.budgets.remove", { id: b.id })}
                  onClick={() =>
                    void save({ budgets: config.budgets.filter((x) => x.id !== b.id).map(plain) })
                  }
                >
                  {t("common.button.remove")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={(e) => void add(e)} className="button-row wrap">
        <label htmlFor={`${id}-scope`}>{t("mission.budgets.scope")}</label>
        <select
          id={`${id}-scope`}
          value={scope}
          onChange={(e) => setScope(e.target.value as MissionBudget["scope"])}
        >
          <option value="daily">{t("mission.budgets.scope.daily")}</option>
          <option value="session">{t("mission.budgets.scope.session")}</option>
        </select>
        <label htmlFor={`${id}-metric`}>{t("mission.budgets.metric")}</label>
        <select
          id={`${id}-metric`}
          value={metric}
          onChange={(e) => setMetric(e.target.value as MissionBudget["metric"])}
        >
          <option value="tokens">{t("mission.budgets.metric.tokens")}</option>
          <option value="cost">{t("mission.budgets.metric.cost")}</option>
        </select>
        <label htmlFor={`${id}-limit`}>{t("mission.budgets.limit")}</label>
        <input
          id={`${id}-limit`}
          inputMode="decimal"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
        <label htmlFor={`${id}-agent`}>{t("mission.budgets.agent")}</label>
        <input id={`${id}-agent`} value={agent} onChange={(e) => setAgent(e.target.value)} />
        <button type="submit" className="btn" disabled={busy}>
          {t("mission.budgets.add")}
        </button>
      </form>
      {problem && (
        <p className="error-text small" role="alert">
          {t("mission.budgets.invalid")}
        </p>
      )}
    </section>
  );
}

function Prices({
  config,
  save,
  busy,
}: {
  config: MissionConfig;
  save: (body: MissionConfigUpdate) => Promise<boolean>;
  busy: boolean;
}) {
  const t = useT();
  const id = useId();
  const [model, setModel] = useState("");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [problem, setProblem] = useState(false);
  const entries = Object.entries(config.prices);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const i = nonNegative(input);
    const o = nonNegative(output);
    if (model.trim() === "" || i === undefined || o === undefined) return setProblem(true);
    setProblem(false);
    const ok = await save({
      prices: { ...config.prices, [model.trim()]: { input_per_mtok: i, output_per_mtok: o } },
    });
    if (ok) {
      setModel("");
      setInput("");
      setOutput("");
    }
  };
  return (
    <section aria-labelledby={`${id}-h`} className="card">
      <h3 id={`${id}-h`} className="h3">
        {t("mission.prices.title")}
      </h3>
      <p className="muted small">{t("mission.prices.note")}</p>
      {config.ai_price_models.length > 0 && (
        <p className="muted small">
          {t("mission.prices.aiNote", { models: config.ai_price_models.join(", ") })}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="muted small">{t("mission.prices.none")}</p>
      ) : (
        <ul className="mission-list">
          {entries.map(([name, price]) => (
            <li key={name}>
              {t("mission.prices.line", {
                model: name,
                input: formatNumber(price.input_per_mtok),
                output: formatNumber(price.output_per_mtok),
              })}{" "}
              <button
                type="button"
                className="btn"
                disabled={busy}
                aria-label={t("mission.prices.remove", { model: name })}
                onClick={() =>
                  void save({
                    prices: Object.fromEntries(entries.filter(([key]) => key !== name)),
                  })
                }
              >
                {t("common.button.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => void add(e)} className="button-row wrap">
        <label htmlFor={`${id}-model`}>{t("mission.prices.model")}</label>
        <input id={`${id}-model`} value={model} onChange={(e) => setModel(e.target.value)} />
        <label htmlFor={`${id}-in`}>{t("mission.prices.input")}</label>
        <input
          id={`${id}-in`}
          inputMode="decimal"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <label htmlFor={`${id}-out`}>{t("mission.prices.output")}</label>
        <input
          id={`${id}-out`}
          inputMode="decimal"
          value={output}
          onChange={(e) => setOutput(e.target.value)}
        />
        <button type="submit" className="btn" disabled={busy}>
          {t("mission.prices.add")}
        </button>
      </form>
      {problem && (
        <p className="error-text small" role="alert">
          {t("mission.prices.invalid")}
        </p>
      )}
    </section>
  );
}

function StallLimit({
  config,
  save,
  busy,
}: {
  config: MissionConfig;
  save: (body: MissionConfigUpdate) => Promise<boolean>;
  busy: boolean;
}) {
  const t = useT();
  const id = useId();
  const [minutes, setMinutes] = useState(String(config.stuck_after_min));
  useEffect(() => setMinutes(String(config.stuck_after_min)), [config.stuck_after_min]);
  return (
    <form
      className="button-row wrap"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(minutes);
        if (Number.isInteger(n)) void save({ stuck_after_min: n });
      }}
    >
      <label htmlFor={id}>{t("mission.stall.label")}</label>
      <input
        id={id}
        inputMode="numeric"
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
      />
      <button type="submit" className="btn" disabled={busy}>
        {t("mission.stall.save")}
      </button>
    </form>
  );
}

function KeepDays({
  config,
  save,
  busy,
}: {
  config: MissionConfig;
  save: (body: MissionConfigUpdate) => Promise<boolean>;
  busy: boolean;
}) {
  const t = useT();
  const id = useId();
  const [days, setDays] = useState(String(config.keep_days));
  useEffect(() => setDays(String(config.keep_days)), [config.keep_days]);
  return (
    <form
      className="button-row wrap"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(days);
        if (Number.isInteger(n)) void save({ keep_days: n });
      }}
    >
      <label htmlFor={id}>{t("mission.keep.label")}</label>
      <input id={id} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
      <button type="submit" className="btn" disabled={busy}>
        {t("mission.keep.save")}
      </button>
    </form>
  );
}

/** Mission control: every agent session by state, what the agents report they cost, budgets. */
export function MissionPage() {
  const client = useClient();
  const t = useT();
  const [mission, setMission] = useState<Mission | null>(null);
  const [config, setConfig] = useState<MissionConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<BoardFilter>(NO_FILTER);
  const [focusing, setFocusing] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, c] = await Promise.all([
        client.request<Mission>("GET", `/api/mission?days=${WINDOW_DAYS}`),
        client.request<MissionConfig>("GET", "/api/mission/config"),
      ]);
      setMission(m);
      setConfig(c);
      setLoadError(null);
    } catch {
      setLoadError(t("mission.loadFailed"));
    }
  }, [client, t]);

  useEffect(() => {
    void load();
    const off = client.eventCreated.on(({ event }) => {
      if (event.event_type.startsWith("agent.")) void load();
    });
    const offStatus = client.statusChanged.on((s) => s === "online" && void load());
    return () => {
      off();
      offStatus();
    };
  }, [client, load]);

  const message = (err: unknown) =>
    err instanceof ApiError ? err.message : t("common.error.requestFailed");

  const save = async (body: MissionConfigUpdate): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    setSaved(null);
    try {
      setConfig(await client.request<MissionConfig>("POST", "/api/mission/config", body));
      setSaved(t("mission.saved"));
      await load();
      return true;
    } catch (err) {
      setActionError(message(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const focus = async (s: MissionSession) => {
    setFocusing(s.key);
    setFocused(null);
    setActionError(null);
    try {
      await client.request(
        "POST",
        // `<agent>:<id>`: two agents may use the same session id, so the agent is named.
        `/api/agent/sessions/${encodeURIComponent(s.key)}/focus-terminal`,
        {},
      );
      setFocused(s.key);
    } catch (err) {
      setActionError(message(err));
    } finally {
      setFocusing(null);
    }
  };

  const remove = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const r = await client.request<{ deleted: number }>(
        "DELETE",
        "/api/mission/usage?confirm=true",
      );
      setSaved(t("mission.delete.done", { count: r.deleted }));
      setConfirmDelete(false);
      await load();
    } catch (err) {
      setActionError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(
    () => (mission ? filterSessions(mission.sessions, filter) : []),
    [mission, filter],
  );

  return (
    <section aria-labelledby="mission-h" className="card mission">
      <h2 id="mission-h" className="h3">
        {t("mission.title")}
      </h2>
      <p className="muted small" role="note">
        {t("mission.note")}
      </p>
      {loadError && (
        <p className="error-text" role="alert">
          {loadError}
        </p>
      )}
      {!mission && !loadError && <p className="muted small">{t("common.status.loading")}</p>}
      {mission && config && (
        <>
          {(!mission.sources.reported || !mission.sources.orchestrated) && (
            <p className="warning-text small" role="status">
              {t("mission.sourceMissing")}
            </p>
          )}
          <div className="button-row wrap">
            <button type="button" className="btn" onClick={() => void load()}>
              {t("mission.refresh")}
            </button>
          </div>
          <section aria-labelledby="mission-board-h">
            <h3 id="mission-board-h" className="h3">
              {t("mission.board.title")}
            </h3>
            <Filters filter={filter} onChange={setFilter} sessions={mission.sessions} />
            {mission.sessions.length === 0 ? (
              <p className="muted">{t("mission.board.empty")}</p>
            ) : (
              <>
                {visible.length === 0 && <p className="muted">{t("mission.board.noMatch")}</p>}
                <div className="mission-board">
                  {MISSION_STATES.map((state) => (
                    <Column
                      key={state}
                      state={state}
                      sessions={visible.filter((s) => s.state === state)}
                      onFocus={(s) => void focus(s)}
                      focusing={focusing}
                      focused={focused}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
          <Feedback error={actionError} saved={saved} />
          <Totals mission={mission} />
          {(mission.ingest.clamped > 0 || mission.ingest.refused > 0) && (
            <p className="small" role="status">
              {t("mission.ingest.notice", {
                clamped: mission.ingest.clamped,
                refused: mission.ingest.refused,
                agents: mission.ingest.by_agent
                  .map((a) => `${a.agent} (${a.clamped + a.refused})`)
                  .join(", "),
              })}
            </p>
          )}
          <Budgets mission={mission} config={config} save={save} busy={busy} />
          <Prices config={config} save={save} busy={busy} />
          <StallLimit config={config} save={save} busy={busy} />
          <KeepDays config={config} save={save} busy={busy} />
          <div className="button-row wrap">
            {confirmDelete ? (
              <>
                <p className="small" role="alert">
                  {t("mission.delete.warning")}
                </p>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  {t("mission.delete.confirm")}
                </button>
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                  {t("common.button.cancel")}
                </button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => setConfirmDelete(true)}>
                {t("mission.delete.button")}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
