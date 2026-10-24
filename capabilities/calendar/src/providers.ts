// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Builds the real adapters from the capability's own config and secrets when it is enabled.
// Google and Microsoft Graph are read with an access token the owner stores as a secret; Phoenix
// has no OAuth flow and never refreshes a token (see README). CalDAV uses a username and app
// password. Each credential is sent only to its own fixed origin (Google, Graph) or to the one
// `caldav_url` the owner named, and no redirect is ever followed.
import { ReadOnlyClient, safeBaseUrl, ServiceError } from "@phoenix/service-kit";
import {
  caldavCalendar,
  CalendarFeedError,
  googleCalendar,
  microsoftCalendar,
  type CalendarAdapter,
  type CalendarClient,
} from "./adapters";
import { caldavClient, caldavTarget } from "./caldav";

export type ProviderName = "caldav" | "google" | "microsoft" | "macos";
/** Every provider the config can switch on, in a fixed order. */
export const PROVIDERS: readonly ProviderName[] = ["caldav", "google", "microsoft", "macos"];

export const DEFAULT_ENDPOINTS = {
  google: "https://www.googleapis.com",
  microsoft: "https://graph.microsoft.com",
} as const;

export interface ResolvedEndpoints {
  google: string;
  microsoft: string;
}

/** Where the Google and Graph tokens are sent. Code only, never config: a token goes to these hosts alone. */
export interface ProviderEndpoints {
  google?: string;
  microsoft?: string;
}

/** A GET-only JSON client for one fixed API origin. Failures become fixed, secret-free phrases. */
function bearerClient(
  service: string,
  baseUrl: string,
  token: string,
  signal: AbortSignal,
): CalendarClient {
  return {
    async get(path, headers) {
      const client = new ReadOnlyClient({
        service,
        baseUrl,
        secret: token,
        auth: (secret) => ({ authorization: `Bearer ${secret}` }),
        ...(headers ? { headers: { ...headers } } : {}),
        signal,
      });
      try {
        return await client.get(path, (body) => body);
      } catch (err) {
        throw new CalendarFeedError(
          err instanceof ServiceError ? err.message : `${service} events could not be read`,
        );
      }
    },
  };
}

/** Validates code-supplied endpoints once, at construction. */
export function resolveEndpoints(endpoints: ProviderEndpoints = {}): ResolvedEndpoints {
  const google = safeBaseUrl(endpoints.google ?? DEFAULT_ENDPOINTS.google);
  const microsoft = safeBaseUrl(endpoints.microsoft ?? DEFAULT_ENDPOINTS.microsoft);
  if (google === undefined || microsoft === undefined)
    throw new TypeError("calendar endpoints must be https, or http to loopback");
  return { google, microsoft };
}

/** The zone for all-day and floating CalDAV times; an unknown zone is an explicit error. */
function caldavZone(value: unknown): string {
  if (value === undefined) return "UTC";
  if (typeof value !== "string")
    throw new CalendarFeedError("caldav_timezone must be a time zone name");
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
  } catch {
    throw new CalendarFeedError("caldav_timezone must be a valid IANA time zone name");
  }
  return value;
}

/**
 * The production adapter for `name`, or a CalendarFeedError saying what is missing. `credential`
 * is the secret already read from the store. macOS has no reader in this build: Calendar's own
 * scripting interface does not expand recurring events, and the adapter never guesses occurrences,
 * so a host has to supply a real reader through `createCalendarCapability({ adapters: { macos } })`.
 */
export function buildAdapter(
  name: ProviderName,
  config: Readonly<Record<string, unknown>>,
  credential: string,
  endpoints: ResolvedEndpoints,
  signal: AbortSignal,
): CalendarAdapter {
  if (name === "google")
    return googleCalendar(bearerClient("Google Calendar", endpoints.google, credential, signal));
  if (name === "microsoft")
    return microsoftCalendar(
      bearerClient("Microsoft Graph", endpoints.microsoft, credential, signal),
    );
  if (name === "caldav") {
    const target = caldavTarget(config.caldav_url);
    const timezone = caldavZone(config.caldav_timezone);
    return caldavCalendar(
      caldavClient({ target, credential, timezone, signal }),
      target.collection,
    );
  }
  throw new CalendarFeedError("macos calendar reader is not available in this build");
}
