// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { hostMatchesSite, isThirdParty } from "./site";

export type ResourceType =
  | "document"
  | "subdocument"
  | "script"
  | "stylesheet"
  | "image"
  | "font"
  | "media"
  | "xhr"
  | "websocket"
  | "ping"
  | "other";

/** Adblock option names this matcher understands, mapped to the type they select. */
const TYPE_OPTIONS: Readonly<Record<string, ResourceType>> = {
  document: "document",
  subdocument: "subdocument",
  script: "script",
  stylesheet: "stylesheet",
  image: "image",
  font: "font",
  media: "media",
  xmlhttprequest: "xhr",
  xhr: "xhr",
  websocket: "websocket",
  ping: "ping",
  other: "other",
};

/** A rule longer than this is dropped: it is a sign of a corrupt list, and bounds regex cost. */
const MAX_RULE_LENGTH = 512;
const MAX_WILDCARDS = 8;

export interface FilterRule {
  /** The line as written, for the "why was this blocked" panel. */
  readonly text: string;
  readonly exception: boolean;
  readonly regex: RegExp;
  /** `true` third-party only, `false` first-party only, `null` either. */
  readonly thirdParty: boolean | null;
  /** Empty means every type except `document`, as in Adblock syntax. */
  readonly types: readonly ResourceType[];
  readonly notTypes: readonly ResourceType[];
  readonly includeDomains: readonly string[];
  readonly excludeDomains: readonly string[];
  /** Host a `||host^` rule is anchored to; used to index the rule. */
  readonly anchorHost: string | null;
}

export interface ParseReport {
  rules: number;
  exceptions: number;
  /** Cosmetic (`##`), scriptlet and HTML-filter rules: they need page access, which this matcher never has. */
  cosmetic: number;
  /** Regex rules, `$important`, `$redirect`, `$csp` and other options this matcher does not model. */
  unsupported: number;
  /** Comments, headers and blank lines. */
  ignored: number;
}

function emptyReport(): ParseReport {
  return { rules: 0, exceptions: 0, cosmetic: 0, unsupported: 0, ignored: 0 };
}

const COSMETIC = /#[@?$%]?#|#@?\$#|\$\$/;

function escapeRegex(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function patternToRegex(pattern: string): RegExp | null {
  let rest = pattern;
  let prefix = "";
  if (rest.startsWith("||")) {
    prefix = "^[a-z][a-z0-9+.-]*:\\/\\/(?:[^/?#@]*\\.)?";
    rest = rest.slice(2);
  } else if (rest.startsWith("|")) {
    prefix = "^";
    rest = rest.slice(1);
  }
  let suffix = "";
  if (rest.endsWith("|")) {
    suffix = "$";
    rest = rest.slice(0, -1);
  }
  rest = rest.replace(/\*{2,}/g, "*");
  if (rest.split("*").length - 1 > MAX_WILDCARDS) return null;
  let body = "";
  for (const ch of rest) {
    if (ch === "*") body += "[^]*";
    // "^" is a separator: anything but a letter, digit, "_", "-", "." or "%", or the end.
    else if (ch === "^") body += "(?:[^\\w\\-.%]|$)";
    else body += escapeRegex(ch);
  }
  if (body === "" && prefix === "") return null;
  try {
    return new RegExp(prefix + body + suffix, "i");
  } catch {
    return null;
  }
}

/** Parse one filter line. `null` means it was skipped; the report says why. */
export function parseFilterRule(
  line: string,
  report: ParseReport = emptyReport(),
): FilterRule | null {
  const text = line.trim();
  if (text === "" || text.startsWith("!") || /^\[.*\]$/.test(text)) {
    report.ignored++;
    return null;
  }
  if (COSMETIC.test(text)) {
    report.cosmetic++;
    return null;
  }
  if (text.length > MAX_RULE_LENGTH) {
    report.unsupported++;
    return null;
  }
  let body = text;
  const exception = body.startsWith("@@");
  if (exception) body = body.slice(2);
  let options = "";
  // The option separator is the last "$" (a pattern may hold "$" only inside a regex rule).
  const dollar = body.lastIndexOf("$");
  if (dollar !== -1 && !(body.startsWith("/") && body.endsWith("/"))) {
    options = body.slice(dollar + 1);
    body = body.slice(0, dollar);
  }
  if (body.startsWith("/") && body.endsWith("/") && body.length > 1) {
    report.unsupported++;
    return null;
  }
  let thirdParty: boolean | null = null;
  const types = new Set<ResourceType>();
  const notTypes = new Set<ResourceType>();
  const includeDomains: string[] = [];
  const excludeDomains: string[] = [];
  for (const option of options === "" ? [] : options.split(",")) {
    const name = option.trim().toLowerCase();
    if (name === "third-party" || name === "3p") thirdParty = true;
    else if (name === "~third-party" || name === "~3p" || name === "first-party")
      thirdParty = false;
    else if (name === "match-case" || name === "") continue;
    else if (name.startsWith("domain=")) {
      for (const domain of name.slice(7).split("|")) {
        if (domain === "") continue;
        if (domain.startsWith("~")) excludeDomains.push(domain.slice(1));
        else includeDomains.push(domain);
      }
    } else if (Object.hasOwn(TYPE_OPTIONS, name)) types.add(TYPE_OPTIONS[name] as ResourceType);
    else if (name.startsWith("~") && Object.hasOwn(TYPE_OPTIONS, name.slice(1))) {
      notTypes.add(TYPE_OPTIONS[name.slice(1)] as ResourceType);
    } else {
      // important, redirect, csp, removeparam, popup... Dropping the option would widen the rule.
      report.unsupported++;
      return null;
    }
  }
  const regex = patternToRegex(body);
  if (regex === null) {
    report.unsupported++;
    return null;
  }
  const anchor = /^\|\|([a-z0-9.-]+)[\^/]/i.exec(body);
  const rule: FilterRule = {
    text,
    exception,
    regex,
    thirdParty,
    types: [...types],
    notTypes: [...notTypes],
    includeDomains,
    excludeDomains,
    anchorHost: anchor ? (anchor[1] as string).toLowerCase() : null,
  };
  report.rules++;
  if (exception) report.exceptions++;
  return rule;
}

export interface RequestInfo {
  url: string;
  /** URL of the top-level document the request belongs to. */
  documentUrl: string;
  type: ResourceType;
}

export interface BlockMatch {
  blocked: boolean;
  /** The rule that decided it: the blocking rule, or the exception that overrode one. */
  rule: string | null;
  /** True when a blocking rule matched but an exception allowed the request. */
  excepted: boolean;
}

const NO_MATCH: BlockMatch = { blocked: false, rule: null, excepted: false };

function ruleApplies(
  rule: FilterRule,
  request: RequestInfo,
  requestHost: string,
  documentHost: string,
): boolean {
  if (rule.types.length === 0) {
    if (request.type === "document") return false;
  } else if (!rule.types.includes(request.type)) return false;
  if (rule.notTypes.includes(request.type)) return false;
  if (rule.thirdParty !== null && rule.thirdParty !== isThirdParty(requestHost, documentHost)) {
    return false;
  }
  if (
    rule.includeDomains.length > 0 &&
    !rule.includeDomains.some((d) => hostMatchesSite(documentHost, d))
  ) {
    return false;
  }
  if (rule.excludeDomains.some((d) => hostMatchesSite(documentHost, d))) return false;
  return rule.regex.test(request.url);
}

function hostSuffixes(host: string): string[] {
  const labels = host.split(".");
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) out.push(labels.slice(i).join("."));
  return out.length === 0 ? [host] : out;
}

/**
 * Request blocking from Adblock-syntax rules. It implements the part of EasyList/EasyPrivacy
 * syntax that decides "block or allow this URL": `||host^`, `|` anchors, `*`, `^`, `@@`,
 * `$third-party`, resource-type and `domain=` options. Cosmetic rules are counted and ignored.
 */
export class RequestBlocker {
  #byHost = new Map<string, FilterRule[]>();
  #generic: FilterRule[] = [];
  #exceptionsByHost = new Map<string, FilterRule[]>();
  #genericExceptions: FilterRule[] = [];
  readonly report: ParseReport = emptyReport();

  /** Add a list's text. May be called for several lists; the report is cumulative. */
  load(listText: string): void {
    for (const line of listText.split(/\r?\n/)) {
      const rule = parseFilterRule(line, this.report);
      if (rule === null) continue;
      const [hosts, generic] = rule.exception
        ? [this.#exceptionsByHost, this.#genericExceptions]
        : [this.#byHost, this.#generic];
      if (rule.anchorHost === null) {
        generic.push(rule);
        continue;
      }
      const bucket = hosts.get(rule.anchorHost);
      if (bucket) bucket.push(rule);
      else hosts.set(rule.anchorHost, [rule]);
    }
  }

  get ruleCount(): number {
    return this.report.rules;
  }

  #find(
    request: RequestInfo,
    requestHost: string,
    documentHost: string,
    hosts: Map<string, FilterRule[]>,
    generic: readonly FilterRule[],
  ): FilterRule | null {
    for (const suffix of hostSuffixes(requestHost)) {
      for (const rule of hosts.get(suffix) ?? []) {
        if (ruleApplies(rule, request, requestHost, documentHost)) return rule;
      }
    }
    for (const rule of generic) {
      if (ruleApplies(rule, request, requestHost, documentHost)) return rule;
    }
    return null;
  }

  match(request: RequestInfo): BlockMatch {
    let requestHost: string;
    let documentHost: string;
    try {
      requestHost = new URL(request.url).hostname.toLowerCase();
      documentHost = new URL(request.documentUrl).hostname.toLowerCase();
    } catch {
      return NO_MATCH;
    }
    const hit = this.#find(request, requestHost, documentHost, this.#byHost, this.#generic);
    if (hit === null) return NO_MATCH;
    const exception = this.#find(
      request,
      requestHost,
      documentHost,
      this.#exceptionsByHost,
      this.#genericExceptions,
    );
    if (exception !== null) return { blocked: false, rule: exception.text, excepted: true };
    return { blocked: true, rule: hit.text, excepted: false };
  }
}

/**
 * Phoenix-authored starter rules: well-known advertising and analytics hosts, written by hand.
 * It is deliberately NOT a copy of EasyList or EasyPrivacy (those are GPL-3.0/CC BY-SA and must
 * be fetched by the filter-list updater with their licence recorded). It exists so a profile
 * blocks the obvious hosts before the first list has been downloaded.
 */
export const STARTER_RULES = [
  "||doubleclick.net^",
  "||googlesyndication.com^",
  "||googleadservices.com^",
  "||google-analytics.com^",
  "||googletagmanager.com^$third-party",
  "||googletagservices.com^",
  "||adservice.google.com^",
  "||connect.facebook.net^$third-party",
  "||facebook.com/tr^$third-party",
  "||scorecardresearch.com^",
  "||quantserve.com^",
  "||hotjar.com^$third-party",
  "||amplitude.com^$third-party",
  "||mixpanel.com^$third-party",
  "||segment.io^$third-party",
  "||adnxs.com^",
  "||criteo.com^",
  "||taboola.com^$third-party",
  "||outbrain.com^$third-party",
  "||ads-twitter.com^",
  "||analytics.tiktok.com^",
].join("\n");
