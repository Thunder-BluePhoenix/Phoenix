// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Hooks attach the Phoenix session token to their requests. The Core address can come from the
// environment (`PHOENIX_CORE_URL`), and a project's agent settings can set environment variables
// for a hook, so the address is NOT trusted: the token is only ever sent to this machine.
import { DEFAULT_CORE_URL } from "@phoenix/sdk";

const LOOPBACK_HOSTS: Readonly<Record<string, true>> = {
  "127.0.0.1": true,
  localhost: true,
  "[::1]": true,
};

/** True for an http(s) URL whose host is this machine, with no credentials in it. */
export function isLoopbackUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  return LOOPBACK_HOSTS[url.hostname] === true || LOOPBACK_HOSTS[`[${url.hostname}]`] === true;
}

/**
 * The Core base URL a hook may send the token to: the explicit option or `PHOENIX_CORE_URL` or the
 * default, without a trailing slash. Null when it is not a loopback address; the caller reports
 * nothing and sends nothing (a hook must never fail the agent).
 */
export function trustedCoreUrl(explicit?: string): string | null {
  const candidate = (explicit ?? process.env.PHOENIX_CORE_URL ?? DEFAULT_CORE_URL).replace(
    /\/$/,
    "",
  );
  return isLoopbackUrl(candidate) ? candidate : null;
}
