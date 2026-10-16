// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// URL rules shared by the adapters that send an API key. Locality is DERIVED from the URL and is
// never something a user (or a settings file) can claim: a loopback host is on this device, every
// other host is a cloud service and the key may only travel to it over https.
import { ModelError } from "./errors";
import type { Locality } from "./types";

const LOOPBACK_HOSTS: Record<string, true> = { "127.0.0.1": true, localhost: true, "[::1]": true };

/** True for http(s) URLs whose host is this machine. */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS[hostname] === true;
}

/** "local" for a loopback host, "cloud" for everything else. Throws on an unparsable URL. */
export function localityOfUrl(raw: string): Locality {
  return isLoopbackHost(new URL(raw).hostname) ? "local" : "cloud";
}

/**
 * Validates a base URL that will receive an API key and returns it without a trailing slash.
 * The key is only ever sent over https (plain http is allowed to loopback only), never to a URL
 * that carries credentials, and never to a URL with a query string or fragment (a key must not be
 * able to end up in a logged URL, and a path suffix would hide the real endpoint).
 */
export function assertSafeBaseUrl(raw: string, providerId: string, label: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ModelError("config", providerId, `The ${label} URL is not a valid URL`);
  }
  const loopbackHttp = url.protocol === "http:" && isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) {
    throw new ModelError(
      "config",
      providerId,
      `The ${label} URL must use https (plain http is only allowed for this computer)`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new ModelError("config", providerId, `The ${label} URL must not contain credentials`);
  }
  if (url.search !== "" || url.hash !== "") {
    throw new ModelError(
      "config",
      providerId,
      `The ${label} URL must not contain a query string or fragment`,
    );
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}
