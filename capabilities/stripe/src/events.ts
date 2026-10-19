// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Stripe charges → Phoenix events (stripe.payment.succeeded / stripe.payment.failed). Pure.
//
// History rule: a charge first seen older than `liveSince` is recorded silently, so enabling the
// capability does not replay last week's payments. A charge that was still pending then and later
// settles is announced. Pending charges and refunds produce no event.
import { ChangeTracker } from "@phoenix/service-kit";
import { formatMoney, type Charge } from "./parse";

export interface StripeEvent {
  event_type: "stripe.payment.succeeded" | "stripe.payment.failed";
  severity: "success" | "warning";
  correlation_id: string;
  subject: string;
  payload: Record<string, unknown>;
}

export function chargeTracker(liveSince: number): ChangeTracker<Charge> {
  return new ChangeTracker<Charge>({
    key: (c) => c.id,
    state: (c) => c.status,
    at: (c) => c.createdAt,
    liveSince,
  });
}

export function chargeEvent(c: Charge): StripeEvent | undefined {
  if (c.status === "pending") return undefined;
  const ok = c.status === "succeeded";
  return {
    event_type: ok ? "stripe.payment.succeeded" : "stripe.payment.failed",
    severity: ok ? "success" : "warning",
    correlation_id: `stripe-charge-${c.id}`,
    subject: formatMoney(c.amount, c.currency),
    payload: {
      charge_id: c.id,
      amount: c.amount,
      currency: c.currency,
      livemode: c.livemode,
      ...(c.failureCode ? { failure_code: c.failureCode } : {}),
      ...(c.url ? { url: c.url } : {}),
    },
  };
}

export function diffCharges(
  tracker: ChangeTracker<Charge>,
  charges: readonly Charge[],
): StripeEvent[] {
  const events: StripeEvent[] = [];
  const oldestFirst = [...charges].sort((a, b) => a.createdAt - b.createdAt);
  for (const { item } of tracker.update(oldestFirst)) {
    const event = chargeEvent(item);
    if (event) events.push(event);
  }
  return events;
}
