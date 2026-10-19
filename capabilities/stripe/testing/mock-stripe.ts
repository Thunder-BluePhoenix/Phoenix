// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for api.stripe.com shaped from Stripe's public API reference: list endpoints answer
// `{ object: "list", data: [...], has_more }`, amounts are integers in the smallest currency unit,
// `created` is epoch seconds, a charge has `status` succeeded | pending | failed, failures carry
// `failure_code`. Authentication is a Bearer key. The mock answers 405 to anything but GET and
// records it, so a test can prove nothing else was ever sent. Nothing here talks to real Stripe.
import { startMockService, type MockReply, type MockService } from "@phoenix/service-kit/testing";

/** Built at runtime so no key-shaped literal sits in the source tree. */
export const MOCK_KEY = ["fake", "stripe", "credential", "0042"].join("-");
/** Placed in hostile bodies; no error, event, log or audit row may contain it. */
export const REMOTE_MARKER = "REMOTE-TEXT-MUST-NOT-LEAK";

export interface MockCharge {
  id: string;
  object: "charge";
  amount: number;
  currency: string;
  status: string;
  created: number;
  paid?: boolean;
  refunded?: boolean;
  livemode?: boolean;
  failure_code?: string | null;
  failure_message?: string | null;
  receipt_url?: string | null;
  receipt_email?: string | null;
  description?: string | null;
  billing_details?: Record<string, unknown>;
  [extra: string]: unknown;
}

export interface MockStripe {
  service: MockService;
  url: string;
  charges: MockCharge[];
  balance: {
    available: { amount: number; currency: string }[];
    pending: { amount: number; currency: string }[];
  };
  override: { current: ((path: string, method: string) => MockReply | undefined) | undefined };
  /** Every request that was not a GET. */
  nonGet: { method: string; path: string }[];
  close(): Promise<void>;
}

export function charge(over: Partial<MockCharge> = {}): MockCharge {
  const id = over.id ?? "ch_3Abc123";
  return {
    id,
    object: "charge",
    amount: 2000,
    currency: "usd",
    status: "succeeded",
    created: Date.parse("2026-10-05T10:00:00Z") / 1000,
    paid: true,
    refunded: false,
    livemode: false,
    failure_code: null,
    failure_message: null,
    receipt_url: `https://pay.stripe.com/receipts/${id}`,
    receipt_email: "customer@example.com",
    description: "Order 42 for Ada Lovelace",
    billing_details: { name: "Ada Lovelace", email: "customer@example.com" },
    ...over,
  };
}

export async function startMockStripe(): Promise<MockStripe> {
  const charges: MockCharge[] = [];
  const nonGet: MockStripe["nonGet"] = [];
  const balance: MockStripe["balance"] = {
    available: [{ amount: 123456, currency: "usd" }],
    pending: [{ amount: 7800, currency: "usd" }],
  };
  const override: MockStripe["override"] = { current: undefined };
  const service = await startMockService((req) => {
    if (req.method !== "GET") {
      nonGet.push({ method: req.method, path: req.path });
      return { status: 405, body: { error: { message: "method not allowed" } } };
    }
    const reply = override.current?.(req.path, req.method);
    if (reply) return reply;
    if (req.headers.authorization !== `Bearer ${MOCK_KEY}`) {
      return {
        status: 401,
        body: { error: { type: "invalid_request_error", message: "Invalid API Key provided" } },
      };
    }
    const path = req.path.split("?")[0] ?? "";
    if (path === "/v1/charges") {
      const sorted = [...charges].sort((a, b) => b.created - a.created);
      return { body: { object: "list", url: "/v1/charges", has_more: false, data: sorted } };
    }
    if (path === "/v1/balance") return { body: { object: "balance", livemode: false, ...balance } };
    return undefined;
  });
  return {
    service,
    url: service.url,
    charges,
    balance,
    override,
    nonGet,
    close: () => service.close(),
  };
}
