// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Resend is watched, never driven: this client is a ReadOnlyClient, which has no method that
// sends a body, so nothing in this capability can send an email.
import { ReadOnlyClient } from "@phoenix/service-kit";
import { PAGE_SIZE } from "./parse";

export const SERVICE = "Resend";
export const DEFAULT_BASE_URL = "https://api.resend.com";
export const SECRET_NAME = "api_key";

/** Built from a base URL that already passed safeBaseUrl; the key goes only to that host. */
export function resendClient(baseUrl: string, apiKey: string, signal: AbortSignal): ReadOnlyClient {
  return new ReadOnlyClient({
    service: SERVICE,
    baseUrl,
    secret: apiKey,
    auth: (key) => ({ authorization: `Bearer ${key}` }),
    signal,
  });
}

/** GET /emails, newest first. */
export const EMAILS_PATH = `/emails?limit=${PAGE_SIZE}`;
