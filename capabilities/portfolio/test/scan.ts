// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The static check behind "no write endpoints". It looks at the raw SOURCE TEXT, comments and
// strings included (stripping comments would let `"a // b"; client.post()` hide a call), so it also
// catches code that is never executed in a test. The cost: src/ may not even mention the words.

/** Words that name an action on funds or an account. None may appear anywhere in src/. */
const FORBIDDEN_VERBS =
  /\b(?:orders?|transfers?|withdraw\w*|deposit\w*|trad(?:e|es|ing|er)|swaps?|sendTransaction|signTransaction|broadcast\w*|submit\w*|placeOrder|createOrder|cancelOrder|buy|sell)\b/i;

/** HTTP verbs other than GET, as a method option, a client call or a request line. */
const WRITE_METHODS =
  /(?:method\s*[:=]\s*["'`](?!GET["'`])[A-Za-z]+["'`])|(?:\.(?:post|put|patch|delete)\s*[(<])|(?:["'`](?:POST|PUT|PATCH|DELETE)["'`])/;

const SERVICE_CLIENT = /\bServiceClient\b/;

/** Imports that could send a body without going through ReadOnlyClient. */
const RAW_HTTP =
  /\bfetch\s*\(|from\s+["']node:(?:http|https|net|tls|http2)["']|\bXMLHttpRequest\b|\baxios\b/;

/** Problems found in one file; an empty list means the file passes. */
export function scan(name: string, text: string): string[] {
  const code = text;
  const problems: string[] = [];
  const check = (re: RegExp, what: string) => {
    const hit = re.exec(code);
    if (hit) problems.push(`${name}: ${what} (${JSON.stringify(hit[0])})`);
  };
  check(SERVICE_CLIENT, "uses ServiceClient (it can POST)");
  check(WRITE_METHODS, "uses a non-GET HTTP method");
  check(FORBIDDEN_VERBS, "names an order, transfer or trade action");
  check(RAW_HTTP, "makes a request outside ReadOnlyClient");
  return problems;
}
