// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What the Vercel, Stripe and n8n `status` commands return, reduced to the few fields a glance may
// show. Everything is checked field by field; anything unexpected is dropped, never rendered.
// Privacy is decided HERE, before a component sees the data: Stripe is reduced to counts and
// formatted amounts (no receipt link, no description, nothing that could name a customer or a card),
// and n8n shows workflow names, execution states and times only.
import type { MessageKey } from "../i18n/en";
import {
  cleanText,
  isoTime,
  parseServiceStatus,
  rawStatus,
  type GlanceItem,
  type ServiceStatusView,
} from "./service-glances";

const MAX_COUNT = 100_000;
const count = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT ? v : undefined;

// ---- Vercel -------------------------------------------------------------------------------

/** Vercel deployment states the capability reports (lower case), and the words for them. */
export const VERCEL_STATE_TEXT: Readonly<Record<string, MessageKey>> = {
  queued: "services.glance.vercel.state.queued",
  initializing: "services.glance.vercel.state.initializing",
  building: "services.glance.vercel.state.building",
  ready: "services.glance.vercel.state.ready",
  error: "services.glance.vercel.state.error",
  canceled: "services.glance.vercel.state.canceled",
};
const VERCEL_BUILDING: Readonly<Record<string, true>> = {
  queued: true,
  initializing: true,
  building: true,
};

export interface VercelGlance extends ServiceStatusView {
  failed: number;
  building: number;
}

/** The latest deployments, newest first as the capability sends them, with failed and in-progress counts. */
export function parseVercelGlance(raw: unknown): VercelGlance | null {
  const view = parseServiceStatus(raw);
  if (view === null) return null;
  return {
    ...view,
    failed: view.items.filter((i) => i.state === "error").length,
    building: view.items.filter((i) => Object.hasOwn(VERCEL_BUILDING, i.state)).length,
  };
}

// ---- Stripe -------------------------------------------------------------------------------

/** "12.34 USD": what the capability formats from the smallest currency unit. Nothing else is shown. */
const MONEY = /^-?\d{1,15}(?:\.\d{1,3})? [A-Z]{3}$/;

const money = (v: unknown): string | undefined =>
  typeof v === "string" && MONEY.test(v) ? v : undefined;

export const STRIPE_STATE_TEXT: Readonly<Record<string, MessageKey>> = {
  succeeded: "services.glance.stripe.state.succeeded",
  failed: "services.glance.stripe.state.failed",
  pending: "services.glance.stripe.state.pending",
  refunded: "services.glance.stripe.state.refunded",
};

export interface StripeTotal {
  /** Formatted by the capability, e.g. "20.00 USD". */
  display: string;
  count: number;
}

export interface StripePayment {
  id: string;
  display: string;
  state: string;
  at?: string;
}

export interface StripeGlance {
  configured: boolean;
  counted: number;
  succeeded: number;
  failed: number;
  pending: number;
  succeededTotals: StripeTotal[];
  failedTotals: StripeTotal[];
  available: string[];
  pendingBalance: string[];
  payments: StripePayment[];
}

function totals(raw: unknown): StripeTotal[] {
  if (!Array.isArray(raw)) return [];
  const out: StripeTotal[] = [];
  for (const entry of raw.slice(0, 20)) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const display = money(e.display);
    const n = count(e.count);
    if (display !== undefined && n !== undefined) out.push({ display, count: n });
  }
  return out;
}

function moneyList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw.slice(0, 20)) {
    const display =
      typeof entry === "object" && entry !== null
        ? money((entry as Record<string, unknown>).display)
        : undefined;
    if (display !== undefined) out.push(display);
  }
  return out;
}

function bucket(raw: unknown): { count: number; totals: StripeTotal[] } {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { count: count(r.count) ?? 0, totals: totals(r.totals) };
}

/**
 * Counts, per-currency totals, the balance and the latest payments (amount, state, time). The
 * capability's own `url` (a receipt) and `detail` (a failure code) are never copied.
 */
export function parseStripeGlance(raw: unknown): StripeGlance | null {
  const status = rawStatus(raw);
  if (status === null) return null;
  const summary =
    typeof status.record.summary === "object" && status.record.summary !== null
      ? (status.record.summary as Record<string, unknown>)
      : {};
  const balance =
    typeof status.record.balance === "object" && status.record.balance !== null
      ? (status.record.balance as Record<string, unknown>)
      : {};
  const succeeded = bucket(summary.succeeded);
  const failed = bucket(summary.failed);
  const pending =
    typeof summary.pending === "object" && summary.pending !== null
      ? (count((summary.pending as Record<string, unknown>).count) ?? 0)
      : 0;
  const payments: StripePayment[] = [];
  for (const entry of status.items) {
    const id = cleanText(entry.id, 100);
    const display = money(entry.title);
    if (id === undefined || display === undefined) continue;
    const at = isoTime(entry.at);
    payments.push({
      id,
      display,
      state: (cleanText(entry.state, 20) ?? "unknown").toLowerCase(),
      ...(at === undefined ? {} : { at }),
    });
  }
  return {
    configured: status.configured,
    counted: count(summary.charges_counted) ?? 0,
    succeeded: succeeded.count,
    failed: failed.count,
    pending,
    succeededTotals: succeeded.totals,
    failedTotals: failed.totals,
    available: moneyList(balance.available),
    pendingBalance: moneyList(balance.pending),
    payments,
  };
}

// ---- n8n ----------------------------------------------------------------------------------

export const N8N_STATE_TEXT: Readonly<Record<string, MessageKey>> = {
  success: "services.glance.n8n.state.success",
  error: "services.glance.n8n.state.error",
  crashed: "services.glance.n8n.state.crashed",
  running: "services.glance.n8n.state.running",
  waiting: "services.glance.n8n.state.waiting",
  new: "services.glance.n8n.state.new",
};
const N8N_FAILED: Readonly<Record<string, true>> = { error: true, crashed: true };

/** host or host:port, as `new URL(...).host` gives it. */
const HOST = /^[A-Za-z0-9.-]{1,253}(?::\d{1,5})?$/;

export interface N8nGlance {
  configured: boolean;
  items: GlanceItem[];
  workflows: number;
  activeWorkflows: number;
  failed: number;
  /** The host the API key goes to, so a changed base_url is visible. */
  host?: string;
}

/** Recent executions (workflow name, state, time), how many failed, and how many workflows are active. */
export function parseN8nGlance(raw: unknown): N8nGlance | null {
  const view = parseServiceStatus(raw);
  const status = rawStatus(raw);
  if (view === null || status === null) return null;
  const list = Array.isArray(status.record.workflows) ? status.record.workflows.slice(0, 200) : [];
  const flags = list.filter(
    (w): w is Record<string, unknown> => typeof w === "object" && w !== null,
  );
  const host =
    typeof status.record.sends_key_to === "string" && HOST.test(status.record.sends_key_to)
      ? status.record.sends_key_to
      : undefined;
  return {
    configured: view.configured,
    // The capability sends executions without a link; none is ever taken from them.
    items: view.items.map((i) => ({
      id: i.id,
      title: i.title,
      state: i.state,
      ...(i.at === undefined ? {} : { at: i.at }),
    })),
    workflows: flags.length,
    activeWorkflows: flags.filter((w) => w.active === true).length,
    failed: view.items.filter((i) => Object.hasOwn(N8N_FAILED, i.state)).length,
    ...(host === undefined ? {} : { host }),
  };
}
