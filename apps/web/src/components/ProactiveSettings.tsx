// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useRef, useState } from "react";
import { useClient } from "../core/context";
import type { ProactiveInsight, ProactiveNoise, ProactiveStatus } from "../core/types";
import { Feedback } from "./Feedback";

const bounded = (text: string, limit = 500) => text.slice(0, limit);

/** Opt-in Kage suggestions with an optional local evaluation cadence. */
export function ProactiveSettingsSection() {
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
          setError(bounded(reason instanceof Error ? reason.message : "Request failed", 300));
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
      setError(bounded(reason instanceof Error ? reason.message : "Request failed", 300));
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
      setMessage("Suggestion preferences saved.");
    });
  const optedIn = !!status?.preferences.enabled && status.preferences.capabilities.includes("kage");
  const available = status?.source.capability_id === "kage" && status.source.available;
  const quiet = status?.preferences.quietHours;
  return (
    <section className="card" aria-labelledby="proactive-h">
      <h2 id="proactive-h" className="h3">
        Proactive suggestions
      </h2>
      <p className="muted small">
        Off by default. The only supported source is accepted, unassigned action items from Kage
        meetings. Kage must be available. No deployment prediction, incident or dependency provider
        is available. Evaluation is manual unless you explicitly select a cadence after opting in.
        Scheduled evaluation runs locally and respects quiet hours, rate limits and emergency stop.
      </p>
      {status && (
        <>
          <p role="status">
            Kage source: {available ? "available" : "unavailable"}. Suggestions are{" "}
            {optedIn ? "on" : "off"} (
            {status.preferences.cadenceMinutes
              ? `every ${status.preferences.cadenceMinutes} minutes`
              : "manual only"}
            ).
          </p>
          <fieldset disabled={busy}>
            <legend>Opt in</legend>
            <label className="choice">
              <input
                type="checkbox"
                checked={status.preferences.enabled}
                onChange={(event) => void save({ enabled: event.target.checked })}
              />
              Enable proactive suggestions
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
              Kage accepted, unassigned action items
            </label>
          </fieldset>
          <label className="field">
            Automatic evaluation cadence
            <select
              disabled={busy || !optedIn || !available}
              value={status.preferences.cadenceMinutes ?? ""}
              onChange={(event) =>
                void save({
                  cadenceMinutes: event.target.value ? Number(event.target.value) : null,
                })
              }
            >
              <option value="">Manual only (off)</option>
              <option value="15">Every 15 minutes</option>
              <option value="30">Every 30 minutes</option>
              <option value="60">Every hour</option>
              <option value="1440">Every day</option>
            </select>
          </label>
          <fieldset disabled={busy}>
            <legend>Quiet hours</legend>
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
              Use quiet hours
            </label>
            {quiet && (
              <div className="settings-form">
                <label className="field">
                  Time zone (IANA)
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
                  Quiet from
                  <input
                    type="time"
                    value={quiet.start}
                    onChange={(event) =>
                      void save({ quietHours: { ...quiet, start: event.target.value } })
                    }
                  />
                </label>
                <label className="field">
                  Quiet until
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
            Maximum suggestions per hour
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
                  setMessage(`${result.insights.length} grounded suggestion(s) in preview.`);
                })
              }
            >
              Preview suggestions
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
                    `${result.delivered.length} delivered; ${result.suppressed} suppressed.`,
                  );
                  setNoise(await client.request<ProactiveNoise>("GET", "/api/proactive/noise"));
                })
              }
            >
              Evaluate now
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
              Refresh noise metrics
            </button>
          </div>
          {delivered.length > 0 && (
            <div aria-label="Delivered suggestions">
              <h3>Delivered suggestions</h3>
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
                          setMessage("Suggestion dismissed.");
                        })
                      }
                    >
                      Dismiss {bounded(entry.notification.title, 80)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {insights !== null && (
            <div aria-label="Suggestion preview">
              <h3>Grounded preview</h3>
              {insights.length === 0 && <p>No eligible accepted, unassigned Kage action items.</p>}
              <ul>
                {insights.map((insight) => (
                  <li key={insight.id}>
                    <strong>{bounded(insight.title)}</strong> — {bounded(insight.body)}
                    <p className="memory-text">
                      Evidence: meeting {bounded(insight.evidence.meeting_id, 120)}, item{" "}
                      {bounded(insight.evidence.item_id, 120)} (
                      {insight.evidence.source === "transcript" ? "transcript" : "summary"}): “
                      {bounded(insight.evidence.quote)}”
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {noise && (
            <dl className="approval-facts small" aria-label="Suggestion noise metrics">
              <dt>Delivered</dt>
              <dd>{noise.delivered}</dd>
              <dt>Dismissed</dt>
              <dd>{noise.dismissed}</dd>
              <dt>Suppressed</dt>
              <dd>{noise.suppressed}</dd>
              <dt>Dismissal rate</dt>
              <dd>{(noise.dismissalRate * 100).toFixed(1)}%</dd>
            </dl>
          )}
        </>
      )}
      <Feedback error={error} saved={message} />
    </section>
  );
}
