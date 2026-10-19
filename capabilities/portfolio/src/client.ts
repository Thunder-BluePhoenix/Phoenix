// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Every request this capability makes goes through here, and only through ReadOnlyClient, a client
// with no method that sends a body. One client per request: an exchange signature covers a
// timestamp and the exact path, so the headers differ each time. The credential headers are sent
// only to the `baseUrl` given (https, or http to loopback for tests).
import { ReadOnlyClient, ServiceError, safeBaseUrl } from "@phoenix/service-kit";

export interface GetOptions {
  service: string;
  baseUrl: string;
  /** Path and query, starting with "/". */
  path: string;
  /** Credential/signature headers for this one request. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** One GET, with the body parsed by `parse` (which throws when the answer is unusable). */
export async function readJson<T>(options: GetOptions, parse: (body: unknown) => T): Promise<T> {
  const baseUrl = safeBaseUrl(options.baseUrl);
  if (!baseUrl)
    throw new ServiceError(options.service, "invalid", "The endpoint URL is not allowed");
  const client = new ReadOnlyClient({
    service: options.service,
    baseUrl,
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return client.get(options.path, parse);
}
