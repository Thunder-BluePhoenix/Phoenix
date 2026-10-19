// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useRef, useState } from "react";
import { useClient } from "../core/context";
import { formatNumber } from "../core/format";
import { useT } from "../i18n";
import { translate } from "../i18n/store";
import type { ProactiveInsight, ProactiveNoise, ProactiveStatus } from "../core/types";
import { Feedback } from "./Feedback";

const bounded = (text: string, limit = 500) => text.slice(0, limit);

/** Opt-in Kage suggestions with an optional local evaluation cadence. */
export function ProactiveSettingsSection() {
  const t = useT();
  const client = useClient();
  const pending = useRef(false);
  const [status, setStatus] = useState<ProactiveStatus | null>(null);
  const [noise, setNoise] = useState<ProactiveNoise | null>(null);
  const [delivered, setDelivered] = useState<
    { insight_id: string; notification: { title: string } }[]
  >([]);
  const [timezoneDraft, setTimezoneDraft] = useState<string | null>(null);
  const [insights, setInsights] = useState<ProactiveInsight[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client.request<ProactiveStatus>("GET", "/api/proactive").then(
      (result) => {
        if (active) {
          setStatus(result);
          setNoise(result.noise);
        }
      },
      (reason) => {
        if (active)
          setError(
            bounded(
              reason instanceof Error ? reason.message : translate("common.error.requestFailed"),
              300,
            ),
          );
      },
    );
    return () => {
      active = false;
    };
  }, [client]);

  const run = async (operation: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await operation();
    } catch (reason) {
      setError(
        bounded(
          reason instanceof Error ? reason.message : translate("common.error.requestFailed"),
          300,
        ),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const save = (change: object) =>
    run(async () => {
      const next = await client.request<ProactiveStatus>(
        "POST",
        "/api/proactive/preferences",
        change,
      );
      setStatus(next);
      setNoise(next.noise);
      if (!next.preferences.enabled || !next.preferences.capabilities.includes("kage")) {
        setInsights(null);
        setDelivered([]);
      }
      setMessage(t("automation.proactive.saved"));
    });
  const optedIn = !!status?.preferences.enabled && status.preferences.capabilities.includes("kage");
  const available = status?.source.capability_id === "kage" && status.source.available;
  const quiet = status?.preferences.quietHours;
  return (
    <section className="card" aria-labelledby="proactive-h">
      <h2 id="proactive-h" className="h3">
        {t("automation.proactive.title")}
      </h2>
      <p className="muted small">{t("automation.proactive.intro")}</p>
      {status && (
        <>
          <p role="status">
            {t("automation.proactive.status", {
              source: available
                ? t("automation.proactive.sourceAvailable")
                : t("automation.proactive.sourceUnavailable"),
              state: optedIn
                ? t("automation.proactive.stateOn")
                : t("automation.proactive.stateOff"),
              cadence: status.preferences.cadenceMinutes
                ? t("automation.proactive.cadenceEvery", {
                    minutes: status.preferences.cadenceMinutes,
                  })
                : t("automation.proactive.cadenceManual"),
            })}
          </p>
          <fieldset disabled={busy}>
            <legend>{t("automation.proactive.optIn")}</legend>
            <label className="choice">
              <input
                type="checkbox"
                checked={status.preferences.enabled}
                onChange={(event) => void save({ enabled: event.target.checked })}
              />
              {t("automation.proactive.enable")}
            </label>
            <label className="choice">
              <input
                type="checkbox"
                checked={status.preferences.capabilities.includes("kage")}
                disabled={!available && !status.preferences.capabilities.includes("kage")}
                onChange={(event) =>
                  void save({ capabilities: event.target.checked ? ["kage"] : [] })
                }
              />
              {t("automation.proactive.kageItems")}
            </label>
          </fieldset>
          <label className="field">
            {t("automation.proactive.cadence")}
            <select
              disabled={busy || !optedIn || !available}
              value={status.preferences.cadenceMinutes ?? ""}
              onChange={(event) =>
                void save({
                  cadenceMinutes: event.target.value ? Number(event.target.value) : null,
                })
              }
            >
              <option value="">{t("automation.proactive.cadenceOff")}</option>
              <option value="15">{t("automation.proactive.cadence15")}</option>
              <option value="30">{t("automation.proactive.cadence30")}</option>
              <option value="60">{t("automation.proactive.cadence60")}</option>
              <option value="1440">{t("automation.proactive.cadence1440")}</option>
            </select>
          </label>
          <fieldset disabled={busy}>
            <legend>{t("automation.proactive.quietHours")}</legend>
            <label className="choice">
              <input
                type="checkbox"
                checked={quiet !== null}
                onChange={(event) =>
                  void save({
                    quietHours: event.target.checked
                      ? {
                          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                          start: "22:00",
                          end: "08:00",
                        }
                      : null,
                  })
                }
              />
              {t("automation.proactive.useQuiet")}
            </label>
            {quiet && (
              <div className="settings-form">
                <label className="field">
                  {t("automation.proactive.timezone")}
                  <input
                    value={timezoneDraft ?? quiet.timezone}
                    onChange={(event) => setTimezoneDraft(event.target.value)}
                    onBlur={() => {
                      if (timezoneDraft !== null && timezoneDraft !== quiet.timezone)
                        void save({ quietHours: { ...quiet, timezone: timezoneDraft } });
                      setTimezoneDraft(null);
                    }}
                  />
                </label>
                <label className="field">
                  {t("automation.proactive.quietFrom")}
                  <input
                    type="time"
                    value={quiet.start}
                    onChange={(event) =>
                      void save({ quietHours: { ...quiet, start: event.target.value } })
                    }
                  />
                </label>
                <label className="field">
                  {t("automation.proactive.quietUntil")}
                  <input
                    type="time"
                    value={quiet.end}
                    onChange={(event) =>
                      void save({ quietHours: { ...quiet, end: event.target.value } })
                    }
                  />
                </label>
              </div>
            )}
          </fieldset>
          <label className="field">
            {t("automation.proactive.maxPerHour")}
            <input
              type="number"
              min="1"
              max="20"
              step="1"
              disabled={busy}
              value={status.preferences.maxPerHour}
              onChange={(event) => {
                const number = Number(event.target.value);
                if (Number.isInteger(number) && number >= 1 && number <= 20)
                  void save({ maxPerHour: number });
              }}
            />
          </label>
          <div className="button-row wrap">
            <button
              type="button"
              className="btn"
              disabled={busy || !optedIn || !available}
              onClick={() =>
                void run(async () => {
                  const result = await client.request<{ insights: ProactiveInsight[] }>(
                    "GET",
                    "/api/proactive/preview",
                  );
                  setInsights(result.insights);
                  setMessage(
                    t("automation.proactive.previewCount", { count: result.insights.length }),
                  );
                })
              }
            >
              {t("automation.proactive.preview")}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !optedIn || !available}
              onClick={() =>
                void run(async () => {
                  const result = await client.request<{
                    delivered: { insight_id: string; notification: { title: string } }[];
                    suppressed: number;
                  }>("POST", "/api/proactive/evaluate", {});
                  setDelivered(result.delivered);
                  setMessage(
                    t("automation.proactive.evaluated", {
                      delivered: formatNumber(result.delivered.length),
                      suppressed: formatNumber(result.suppressed),
                    }),
                  );
                  setNoise(await client.request<ProactiveNoise>("GET", "/api/proactive/noise"));
                })
              }
            >
              {t("automation.proactive.evaluate")}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setNoise(await client.request<ProactiveNoise>("GET", "/api/proactive/noise"));
                })
              }
            >
              {t("automation.proactive.refreshNoise")}
            </button>
          </div>
          {delivered.length > 0 && (
            <div aria-label={t("automation.proactive.delivered")}>
              <h3>{t("automation.proactive.delivered")}</h3>
              <ul>
                {delivered.map((entry) => (
                  <li key={entry.insight_id}>
                    {bounded(entry.notification.title)}{" "}
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await client.request("POST", "/api/proactive/dismiss", {
                            id: entry.insight_id,
                          });
                          setDelivered((previous) =>
                            previous.filter((item) => item.insight_id !== entry.insight_id),
                          );
                          setNoise(
                            await client.request<ProactiveNoise>("GET", "/api/proactive/noise"),
                          );
                          setMessage(t("automation.proactive.dismissed"));
                        })
                      }
                    >
                      {t("automation.proactive.dismiss", {
                        title: bounded(entry.notification.title, 80),
                      })}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {insights !== null && (
            <div aria-label={t("automation.proactive.previewLabel")}>
              <h3>{t("automation.proactive.previewHeading")}</h3>
              {insights.length === 0 && <p>{t("automation.proactive.previewEmpty")}</p>}
              <ul>
                {insights.map((insight) => (
                  <li key={insight.id}>
                    <strong>{bounded(insight.title)}</strong> — {bounded(insight.body)}
                    <p className="memory-text">
                      {t("automation.proactive.evidence", {
                        meeting: bounded(insight.evidence.meeting_id, 120),
                        item: bounded(insight.evidence.item_id, 120),
                        source:
                          insight.evidence.source === "transcript"
                            ? t("automation.proactive.sourceTranscript")
                            : t("automation.proactive.sourceSummary"),
                        quote: bounded(insight.evidence.quote),
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {noise && (
            <dl className="approval-facts small" aria-label={t("automation.proactive.noiseLabel")}>
              <dt>{t("automation.proactive.noiseDelivered")}</dt>
              <dd>{formatNumber(noise.delivered)}</dd>
              <dt>{t("automation.proactive.noiseDismissed")}</dt>
              <dd>{formatNumber(noise.dismissed)}</dd>
              <dt>{t("automation.proactive.noiseSuppressed")}</dt>
              <dd>{formatNumber(noise.suppressed)}</dd>
              <dt>{t("automation.proactive.noiseRate")}</dt>
              <dd>
                {formatNumber(noise.dismissalRate * 100, undefined, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}
                %
              </dd>
            </dl>
          )}
        </>
      )}
      <Feedback error={error} saved={message} />
    </section>
  );
}
