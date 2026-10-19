// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Stripe REST client, READ-ONLY BY CONSTRUCTION: it is built on `ReadOnlyClient`, which has no
// method that sends a body, and this module (and the whole capability) never imports
// `ServiceClient`. No code path here can create, refund, capture or otherwise move money.
import { ReadOnlyClient } from "@phoenix/service-kit";
import { parseBalance, parseCharges, type Balance, type Charge } from "./parse";

export const STRIPE_API = "https://api.stripe.com";
export const SERVICE = "Stripe";

export interface StripeClientOptions {
  /** Already checked with `safeBaseUrl`. */
  baseUrl: string;
  secret: string | undefined;
  signal: AbortSignal;
}

export function createStripeClient(o: StripeClientOptions): ReadOnlyClient {
  return new ReadOnlyClient({
    service: SERVICE,
    baseUrl: o.baseUrl,
    secret: o.secret,
    // A restricted key is sent as a Bearer credential, only to the configured base_url.
    auth: (secret) => ({ authorization: `Bearer ${secret}` }),
    signal: o.signal,
  });
}

export function listCharges(client: ReadOnlyClient, limit: number): Promise<Charge[]> {
  return client.get(`/v1/charges?limit=${limit}`, parseCharges);
}

export function getBalance(client: ReadOnlyClient): Promise<Balance> {
  return client.get("/v1/balance", parseBalance);
}
