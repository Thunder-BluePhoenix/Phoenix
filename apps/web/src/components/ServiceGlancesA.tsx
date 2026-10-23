// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Read-only glances for Vercel, Stripe and n8n (Phase 67). Each one calls only the capability's
// `status` read command through Core and shows what service-glances-a.ts lets through: Vercel
// deployments and their state, Stripe amounts and counts (never customers, cards or receipts), and
// n8n executions with failed counts. No write command (redeploy, run_again, pause_workflow) is
// reachable from here.
import { formatAgo, formatNumber } from "../core/format";
import {
  N8N_STATE_TEXT,
  parseN8nGlance,
  parseStripeGlance,
  parseVercelGlance,
  STRIPE_STATE_TEXT,
  VERCEL_STATE_TEXT,
  type StripeTotal,
} from "../core/service-glances-a";
import { useT, type MessageKey } from "../i18n";
import { GlanceItems, ServiceGlanceFrame } from "./ServiceGlanceFrame";

const startsWith = (prefix: string) => (type: string) => type.startsWith(prefix);

const stateText =
  (t: ReturnType<typeof useT>, table: Readonly<Record<string, MessageKey>>) => (state: string) =>
    Object.hasOwn(table, state) ? t(table[state]!) : t("services.glance.state.unknown");

const amounts = (totals: readonly StripeTotal[]) => totals.map((x) => x.display).join(", ");

/** The latest Vercel deployments and their state. */
export function VercelGlance() {
  const t = useT();
  return (
    <ServiceGlanceFrame
      id="vercel"
      name="Vercel"
      parse={parseVercelGlance}
      notConfigured="services.glance.vercel.notConfigured"
      empty="services.glance.vercel.empty"
      isEmpty={(d) => d.items.length === 0}
      refreshOn={startsWith("vercel.deploy.")}
    >
      {(d) => (
        <>
          <p>
            {t("services.glance.vercel.summary", { count: formatNumber(d.items.length) })}
            {d.failed > 0 && (
              <>
                {" · "}
                <strong className="error-text">
                  {t("services.glance.vercel.failed", { count: formatNumber(d.failed) })}
                </strong>
              </>
            )}
            {d.building > 0 && (
              <>
                {" · "}
                {t("services.glance.vercel.building", { count: formatNumber(d.building) })}
              </>
            )}
          </p>
          <GlanceItems items={d.items} stateText={stateText(t, VERCEL_STATE_TEXT)} />
        </>
      )}
    </ServiceGlanceFrame>
  );
}

/** Stripe payment counts, amounts and balance. Amounts and counts only. */
export function StripeGlance() {
  const t = useT();
  return (
    <ServiceGlanceFrame
      id="stripe"
      name="Stripe"
      parse={parseStripeGlance}
      notConfigured="services.glance.stripe.notConfigured"
      empty="services.glance.stripe.empty"
      isEmpty={(d) => d.counted === 0 && d.payments.length === 0 && d.available.length === 0}
      refreshOn={startsWith("stripe.payment.")}
    >
      {(d) => (
        <>
          <p>{t("services.glance.stripe.counted", { count: formatNumber(d.counted) })}</p>
          <ul className="task-list">
            <li>
              {t("services.glance.stripe.succeeded", { count: formatNumber(d.succeeded) })}
              {d.succeededTotals.length > 0 && (
                <div className="muted small">
                  {t("services.glance.stripe.received", { amounts: amounts(d.succeededTotals) })}
                </div>
              )}
            </li>
            <li>
              {t("services.glance.stripe.failed", { count: formatNumber(d.failed) })}
              {d.failedTotals.length > 0 && (
                <div className="muted small">
                  {t("services.glance.stripe.failedAmount", { amounts: amounts(d.failedTotals) })}
                </div>
              )}
            </li>
            <li>{t("services.glance.stripe.pending", { count: formatNumber(d.pending) })}</li>
          </ul>
          {d.available.length > 0 && (
            <p>{t("services.glance.stripe.available", { amounts: d.available.join(", ") })}</p>
          )}
          {d.pendingBalance.length > 0 && (
            <p className="muted small">
              {t("services.glance.stripe.pendingBalance", {
                amounts: d.pendingBalance.join(", "),
              })}
            </p>
          )}
          <ul className="task-list service-glance-items">
            {d.payments.map((p) => (
              <li key={p.id}>
                <strong>{p.display}</strong>{" "}
                <span className="muted small">{stateText(t, STRIPE_STATE_TEXT)(p.state)}</span>
                {p.at !== undefined && <div className="muted small">{formatAgo(p.at)}</div>}
              </li>
            ))}
          </ul>
          <p className="muted small">{t("services.glance.stripe.privacy")}</p>
        </>
      )}
    </ServiceGlanceFrame>
  );
}

/** Recent n8n executions and how many of them failed. */
export function N8nGlance() {
  const t = useT();
  return (
    <ServiceGlanceFrame
      id="n8n"
      name="n8n"
      parse={parseN8nGlance}
      notConfigured="services.glance.n8n.notConfigured"
      empty="services.glance.n8n.empty"
      isEmpty={(d) => d.items.length === 0}
      refreshOn={startsWith("n8n.execution.")}
    >
      {(d) => (
        <>
          <p>
            {t("services.glance.n8n.summary", { count: formatNumber(d.items.length) })}
            {d.failed > 0 && (
              <>
                {" · "}
                <strong className="error-text">
                  {t("services.glance.n8n.failed", { count: formatNumber(d.failed) })}
                </strong>
              </>
            )}
          </p>
          <p className="muted small">
            {t("services.glance.n8n.workflows", {
              active: formatNumber(d.activeWorkflows),
              total: formatNumber(d.workflows),
            })}
          </p>
          <GlanceItems items={d.items} stateText={stateText(t, N8N_STATE_TEXT)} />
          {d.host !== undefined && (
            <p className="muted small">{t("services.glance.n8n.host", { host: d.host })}</p>
          )}
        </>
      )}
    </ServiceGlanceFrame>
  );
}
