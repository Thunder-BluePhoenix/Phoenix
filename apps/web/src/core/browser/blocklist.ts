// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { isThirdParty } from "./site";

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

/** A rule line longer than this is dropped: it is a sign of a corrupt list. Real `domain=` lists reach about 6.5 KiB. */
const MAX_RULE_LENGTH = 16 * 1024;
/** The URL pattern itself (before `$options`) is held to this, which bounds every piece the matcher scans. */
const MAX_PATTERN_LENGTH = 512;
const MAX_WILDCARDS = 8;
/** A `domain=` list longer than this is dropped with its rule: cutting it short would change what it means. */
const MAX_DOMAINS_PER_RULE = 1024;
/** Rules are matched against at most this many characters of a URL, so one huge URL cannot cost much. */
const MAX_MATCH_URL = 2048;
/** Rules one blocker holds. EasyList plus EasyPrivacy are about 117,000 network rules; this leaves room to grow. */
export const DEFAULT_MAX_RULES = 300_000;

/**
 * An Adblock pattern compiled to plain pieces instead of a regular expression. A regex built from
 * `a*a*a*b` backtracks exponentially on a URL of many `a`s, which a hostile list could use to hang
 * the browser; the pieces are matched left to right, each at its earliest place, which is linear
 * in the URL for every piece.
 */
interface PatternPart {
  /** Lower-case literal text; `^` inside it is a separator. */
  readonly text: string;
  /** The text before its first `^` (the whole text when it has none): a native `indexOf` finds it. */
  readonly head: string;
  readonly hasSeparator: boolean;
}

interface CompiledPattern {
  /** `|` anchors the first piece to the URL start, `||` to a host-label boundary. */
  readonly anchor: "none" | "start" | "host";
  readonly endAnchor: boolean;
  readonly parts: readonly PatternPart[];
}

export interface FilterRule {
  /** The line as written, for the "why was this blocked" panel. */
  readonly text: string;
  readonly exception: boolean;
  readonly pattern: CompiledPattern;
  /** `true` third-party only, `false` first-party only, `null` either. */
  readonly thirdParty: boolean | null;
  /** Empty means every type except `document`, as in Adblock syntax. */
  readonly types: readonly ResourceType[];
  readonly notTypes: readonly ResourceType[];
  readonly includeDomains: readonly string[];
  readonly excludeDomains: readonly string[];
  readonly includeSet: ReadonlySet<string>;
  readonly excludeSet: ReadonlySet<string>;
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

function compilePattern(pattern: string): CompiledPattern | null {
  let rest = pattern;
  let anchor: CompiledPattern["anchor"] = "none";
  if (rest.startsWith("||")) {
    anchor = "host";
    rest = rest.slice(2);
  } else if (rest.startsWith("|")) {
    anchor = "start";
    rest = rest.slice(1);
  }
  let endAnchor = false;
  if (rest.endsWith("|")) {
    endAnchor = true;
    rest = rest.slice(0, -1);
  }
  rest = rest.replace(/\*{2,}/g, "*").toLowerCase();
  if (rest.split("*").length - 1 > MAX_WILDCARDS) return null;
  const texts = rest.split("*");
  // A pattern of nothing but anchors and wildcards would match every URL.
  if (texts.every((text) => text === "")) return null;
  const parts = texts.map((text): PatternPart => {
    const caret = text.indexOf("^");
    return {
      text,
      head: caret === -1 ? text : text.slice(0, caret),
      hasSeparator: caret !== -1,
    };
  });
  return { anchor, endAnchor, parts };
}

/** "^" matches anything but a letter, digit, "_", "-", "." or "%" (or the end of the URL). */
function isSeparator(code: number): boolean {
  return !(
    (code >= 48 && code <= 57) ||
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    code === 95 ||
    code === 45 ||
    code === 46 ||
    code === 37
  );
}

/**
 * Work one `match()` call may spend, in characters compared plus a charge per rule tried. A list
 * that would need more is cut off (the request is then allowed and counted in `budgetExhausted`):
 * bounded latency is worth more than the last unusual rule.
 */
const MATCH_BUDGET = 4_000_000;
let spent = 0;

/** End of `part` matched exactly at `at`, or -1. */
function matchPartAt(part: PatternPart, url: string, at: number): number {
  const text = part.text;
  spent += text.length + 1;
  let i = at;
  for (let k = 0; k < text.length; k++) {
    const wanted = text.charCodeAt(k);
    if (wanted === 94) {
      if (i === url.length) continue;
      if (!isSeparator(url.charCodeAt(i))) return -1;
      i++;
    } else {
      if (url.charCodeAt(i) !== wanted) return -1;
      i++;
    }
  }
  return i;
}

/** Start of the earliest place at or after `from` where `part` matches, or -1. */
function findPart(part: PatternPart, url: string, from: number): number {
  spent += 16;
  if (!part.hasSeparator) return url.indexOf(part.text, from);
  let start = from;
  while (start <= url.length && spent <= MATCH_BUDGET) {
    if (part.head !== "") {
      start = url.indexOf(part.head, start);
      if (start === -1) return -1;
    }
    if (matchPartAt(part, url, start) !== -1) return start;
    start++;
  }
  return -1;
}

/** Where a `||` pattern may begin: the host start and just after each dot of the host name. */
function hostStarts(url: string): number[] {
  const scheme = url.indexOf("://");
  if (scheme < 1 || scheme > 24) return [];
  let end = url.length;
  for (let i = scheme + 3; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c === 47 || c === 63 || c === 35) {
      end = i;
      break;
    }
  }
  const authority = url.slice(scheme + 3, end);
  const at = authority.lastIndexOf("@");
  const first = scheme + 3 + at + 1;
  const starts = [first];
  for (let i = first; i < end; i++) {
    const c = url.charCodeAt(i);
    if (c === 58) break;
    if (c === 46) starts.push(i + 1);
  }
  return starts;
}

function patternMatches(pattern: CompiledPattern, target: MatchTarget): boolean {
  const url = target.url;
  // A cut-off URL has no real end, so a rule that ends with "|" cannot be judged.
  if (target.truncated && pattern.endAnchor) return false;
  const parts = pattern.parts;
  const last = parts.length - 1;
  let pos = 0;
  for (let k = 0; k <= last; k++) {
    if (spent > MATCH_BUDGET) return false;
    const part = parts[k] as PatternPart;
    if (part.text === "") continue;
    const mustEnd = k === last && pattern.endAnchor;
    if (k === 0 && pattern.anchor !== "none") {
      const starts = pattern.anchor === "start" ? [0] : target.hostStarts();
      let end = -1;
      for (const start of starts) {
        const e = matchPartAt(part, url, start);
        if (e !== -1 && (!mustEnd || e === url.length)) {
          end = e;
          break;
        }
      }
      if (end === -1) return false;
      pos = end;
    } else if (mustEnd) {
      let matched = false;
      for (let s = Math.max(pos, url.length - part.text.length); s <= url.length; s++) {
        if (matchPartAt(part, url, s) === url.length) {
          matched = true;
          break;
        }
      }
      if (!matched) return false;
    } else {
      const start = findPart(part, url, pos);
      if (start === -1) return false;
      pos = matchPartAt(part, url, start);
    }
  }
  return true;
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
  if (body.length > MAX_PATTERN_LENGTH) {
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
        if (includeDomains.length + excludeDomains.length > MAX_DOMAINS_PER_RULE) {
          report.unsupported++;
          return null;
        }
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
  const pattern = compilePattern(body);
  if (pattern === null) {
    report.unsupported++;
    return null;
  }
  const anchor = /^\|\|([a-z0-9.-]+)[\^/]/i.exec(body);
  const rule: FilterRule = {
    text,
    exception,
    pattern,
    thirdParty,
    types: [...types],
    notTypes: [...notTypes],
    includeDomains,
    excludeDomains,
    includeSet: new Set(includeDomains),
    excludeSet: new Set(excludeDomains),
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

/** True when `host` or one of its parent domains is in `set` (`hostMatchesSite` for a whole list). */
function inDomainSet(set: ReadonlySet<string>, host: string): boolean {
  let rest = host;
  for (;;) {
    if (set.has(rest)) return true;
    const dot = rest.indexOf(".");
    if (dot === -1) return false;
    rest = rest.slice(dot + 1);
  }
}

/** The URL a request is matched on: lower-case, and cut at {@link MAX_MATCH_URL} characters. */
interface MatchTarget {
  readonly url: string;
  readonly truncated: boolean;
  /** Every run of three or more letters and digits in the URL. */
  readonly tokens: ReadonlySet<string>;
  /** Where a `||` pattern may start in this URL; computed once, on first use. */
  hostStarts(): readonly number[];
}

function matchTarget(rawUrl: string): MatchTarget {
  const truncated = rawUrl.length > MAX_MATCH_URL;
  const url = (truncated ? rawUrl.slice(0, MAX_MATCH_URL) : rawUrl).toLowerCase();
  const tokens = new Set<string>();
  for (const run of url.match(/[a-z0-9]{3,}/g) ?? []) tokens.add(run);
  let starts: number[] | null = null;
  return { url, truncated, tokens, hostStarts: () => (starts ??= hostStarts(url)) };
}

function ruleApplies(
  rule: FilterRule,
  request: RequestInfo,
  target: MatchTarget,
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
  if (rule.includeSet.size > 0 && !inDomainSet(rule.includeSet, documentHost)) return false;
  if (rule.excludeSet.size > 0 && inDomainSet(rule.excludeSet, documentHost)) return false;
  spent += 4;
  return spent <= MATCH_BUDGET && patternMatches(rule.pattern, target);
}

function hostSuffixes(host: string): string[] {
  const labels = host.split(".");
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) out.push(labels.slice(i).join("."));
  return out.length === 0 ? [host] : out;
}

const ALNUM = /[a-z0-9]/;

/**
 * A word of the pattern that must also be a whole word of any URL it matches, or `null`. A run of
 * letters and digits qualifies when both neighbours inside the pattern are other characters, or
 * the pattern is anchored there. It lets the blocker look a rule up by the words of the URL
 * instead of trying every rule that has no host.
 */
function indexToken(pattern: CompiledPattern): string | null {
  let best: string | null = null;
  const last = pattern.parts.length - 1;
  pattern.parts.forEach((part, k) => {
    const text = part.text;
    for (const m of text.matchAll(/[a-z0-9]{3,}/g)) {
      const start = m.index;
      const end = start + m[0].length;
      const leftOk =
        start > 0 ? !ALNUM.test(text.charAt(start - 1)) : k === 0 && pattern.anchor !== "none";
      const rightOk =
        end < text.length ? !ALNUM.test(text.charAt(end)) : k === last && pattern.endAnchor;
      if (leftOk && rightOk && (best === null || m[0].length > best.length)) best = m[0];
    }
  });
  return best;
}

/** Most rules one host bucket or one word bucket keeps; EasyList's largest is about 60. */
const MAX_BUCKET = 2_000;
/** Rules with neither a host nor a usable word are tried on every request, so there are few of them. */
const MAX_UNINDEXED = 25_000;

/** Rules of one kind (blocking or exception), found by host, by word of the URL, or tried always. */
class RuleIndex {
  readonly #byHost = new Map<string, FilterRule[]>();
  readonly #byToken = new Map<string, FilterRule[]>();
  readonly #always: FilterRule[] = [];

  /** False when a cap refused the rule. */
  add(rule: FilterRule): boolean {
    if (rule.anchorHost !== null) return this.#push(this.#byHost, rule.anchorHost, rule);
    const token = indexToken(rule.pattern);
    if (token !== null) return this.#push(this.#byToken, token, rule);
    if (this.#always.length >= MAX_UNINDEXED) return false;
    this.#always.push(rule);
    return true;
  }

  #push(map: Map<string, FilterRule[]>, key: string, rule: FilterRule): boolean {
    const bucket = map.get(key);
    if (bucket === undefined) {
      map.set(key, [rule]);
      return true;
    }
    if (bucket.length >= MAX_BUCKET) return false;
    bucket.push(rule);
    return true;
  }

  find(
    request: RequestInfo,
    target: MatchTarget,
    requestHost: string,
    documentHost: string,
  ): FilterRule | null {
    for (const suffix of hostSuffixes(requestHost)) {
      for (const rule of this.#byHost.get(suffix) ?? []) {
        if (ruleApplies(rule, request, target, requestHost, documentHost)) return rule;
      }
    }
    for (const token of target.tokens) {
      for (const rule of this.#byToken.get(token) ?? []) {
        if (ruleApplies(rule, request, target, requestHost, documentHost)) return rule;
      }
    }
    for (const rule of this.#always) {
      if (ruleApplies(rule, request, target, requestHost, documentHost)) return rule;
    }
    return null;
  }
}

export interface LoadOptions {
  /** Rules this blocker may hold in all. Further network rules are counted in `droppedRules`. */
  maxRules?: number;
}

/**
 * Request blocking from Adblock-syntax rules. It implements the part of EasyList/EasyPrivacy
 * syntax that decides "block or allow this URL": `||host^`, `|` anchors, `*`, `^`, `@@`,
 * `$third-party`, resource-type and `domain=` options. Cosmetic rules are counted and ignored.
 * Matching never uses a regular expression, and the number of rules, the size of a bucket and the
 * length of a rule, a `domain=` list and a URL are all capped, so a hostile list can make the
 * blocker block less or more but not slow.
 */
export class RequestBlocker {
  readonly #block = new RuleIndex();
  readonly #allow = new RuleIndex();
  #dropped = 0;
  #exhausted = 0;
  readonly report: ParseReport = emptyReport();

  /** Add a list's text. May be called for several lists; the report is cumulative. */
  load(listText: string, options: LoadOptions = {}): void {
    const maxRules = options.maxRules ?? DEFAULT_MAX_RULES;
    for (const line of listText.split(/\r?\n/)) {
      const before = { ...this.report };
      const rule = parseFilterRule(line, this.report);
      if (rule === null) continue;
      if (this.report.rules > maxRules || !(rule.exception ? this.#allow : this.#block).add(rule)) {
        // Undo the count so `ruleCount` is what is really loaded.
        Object.assign(this.report, before);
        this.#dropped++;
      }
    }
  }

  get ruleCount(): number {
    return this.report.rules;
  }

  /** Network rules refused because of a cap (rule count, bucket size). They do not take part in matching. */
  get droppedRules(): number {
    return this.#dropped;
  }

  /** Requests let through because matching them would have cost more than the per-request budget. */
  get budgetExhausted(): number {
    return this.#exhausted;
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
    const target = matchTarget(request.url);
    spent = 0;
    const hit = this.#block.find(request, target, requestHost, documentHost);
    if (hit === null) return this.#settle(NO_MATCH);
    const exception = this.#allow.find(request, target, requestHost, documentHost);
    if (spent > MATCH_BUDGET) return this.#settle(NO_MATCH);
    if (exception !== null) return { blocked: false, rule: exception.text, excepted: true };
    return { blocked: true, rule: hit.text, excepted: false };
  }

  #settle(result: BlockMatch): BlockMatch {
    if (spent > MATCH_BUDGET) this.#exhausted++;
    return result;
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
