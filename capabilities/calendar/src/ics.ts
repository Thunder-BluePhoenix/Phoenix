// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Reads the VEVENTs of a CalDAV `calendar-query` answer that the SERVER already expanded (RFC 4791
// `<C:expand>`). Phoenix never expands a recurrence rule itself: a VEVENT that still carries a
// recurrence rule means the server did not expand, and the read fails closed (a guessed or missing
// occurrence could hide a deploy freeze). Everything here is untrusted text: nothing is executed,
// and a value that cannot be read becomes an empty time so the adapter rejects the whole feed.
import { CalendarFeedError } from "./adapters";
import { instantIn } from "./events";

const UNREADABLE = "caldav events could not be read";

/** One event in the shape `caldavCalendar` reads. */
export interface CalDavRow {
  uid: string;
  recurrenceId?: string;
  summary: string;
  start: string;
  end: string;
  timezone: string;
  attendees: string[];
  url: string;
  class: string;
  status: string;
  categories: string[];
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Splits on `sep` outside double quotes. */
function splitUnquoted(text: string, sep: string): string[] {
  const parts: string[] = [];
  let quoted = false;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === sep && !quoted) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

function parseLine(line: string): Prop | undefined {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 1) return undefined;
  const [rawName, ...rawParams] = splitUnquoted(line.slice(0, colon), ";");
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const eq = raw.indexOf("=");
    if (eq > 0)
      params[raw.slice(0, eq).toUpperCase()] = raw.slice(eq + 1).replace(/^"(.*)"$/, "$1");
  }
  return { name: (rawName ?? "").toUpperCase(), params, value: line.slice(colon + 1) };
}

/** RFC 5545 TEXT unescape. */
function text(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

const DATE_VALUE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;

interface IcsTime {
  /** `2026-10-22T12:00:00Z`, `2026-10-22T12:00:00` or `2026-12-24` (instantIn forms). */
  local: string;
  utc: boolean;
  allDay: boolean;
  zone: string | undefined;
}

function icsTime(prop: Prop): IcsTime | undefined {
  const m = DATE_VALUE.exec(prop.value.trim());
  if (!m) return undefined;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] === undefined) return { local: day, utc: false, allDay: true, zone: prop.params.TZID };
  return {
    local: `${day}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ""}`,
    utc: m[7] === "Z",
    allDay: false,
    zone: prop.params.TZID,
  };
}

/** The absolute ISO instant of an iCalendar time; "" when it or its zone is unusable. A floating or
 * all-day value has no zone of its own and is read in `fallbackZone`, never the host's. */
function instant(time: IcsTime, fallbackZone: string): string {
  return instantIn(time.local, time.utc ? "UTC" : (time.zone ?? fallbackZone));
}

const DURATION = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

function durationMs(value: string): number | undefined {
  const m = DURATION.exec(value.trim());
  if (!m || value.trim() === "P" || value.trim().endsWith("T")) return undefined;
  const [w, d, h, min, s] = m.slice(1, 6).map((part) => Number(part ?? 0));
  return (((w! * 7 + d!) * 24 + h!) * 60 + min!) * 60_000 + s! * 1000;
}

function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}

function row(props: readonly Prop[], defaultZone: string): CalDavRow {
  const first = (name: string): Prop | undefined => props.find((p) => p.name === name);
  if (props.some((p) => p.name === "RRULE" || p.name === "RDATE"))
    throw new CalendarFeedError("caldav server did not expand recurring events");
  const dtstart = first("DTSTART");
  const startTime = dtstart && icsTime(dtstart);
  const startIso = startTime ? instant(startTime, defaultZone) : "";
  let endIso = "";
  const dtend = first("DTEND");
  const duration = first("DURATION");
  if (startIso) {
    if (dtend) {
      const endTime = icsTime(dtend);
      endIso = endTime ? instant(endTime, defaultZone) : "";
    } else if (duration) {
      const ms = durationMs(duration.value);
      endIso = ms === undefined ? "" : new Date(Date.parse(startIso) + ms).toISOString();
    } else if (startTime?.allDay) {
      // RFC 5545: a DATE start without an end lasts one day.
      endIso = instantIn(nextDay(startTime.local), startTime.zone ?? defaultZone);
    }
    // A timed event with no end lasts zero time; the adapter rejects it rather than guess a length.
  }
  const categories = props
    .filter((p) => p.name === "CATEGORIES")
    .flatMap((p) => splitUnquoted(p.value, ",").map((c) => text(c).trim()));
  return {
    uid: text(first("UID")?.value ?? ""),
    ...(first("RECURRENCE-ID") ? { recurrenceId: first("RECURRENCE-ID")!.value.trim() } : {}),
    summary: text(first("SUMMARY")?.value ?? ""),
    start: startIso,
    end: endIso,
    timezone: startTime?.utc ? "UTC" : (startTime?.zone ?? defaultZone),
    attendees: props
      .filter((p) => p.name === "ATTENDEE")
      .map((p) => p.value.trim().replace(/^mailto:/i, "")),
    url: text(first("URL")?.value ?? "").trim(),
    class: (first("CLASS")?.value ?? "").trim().toUpperCase(),
    status: (first("STATUS")?.value ?? "").trim().toUpperCase(),
    categories,
  };
}

/**
 * The events of one iCalendar object. `defaultZone` reads all-day and floating times (they carry no
 * zone of their own). Events inside VALARM or other nested components are not read.
 */
export function parseIcsEvents(ics: string, defaultZone: string): CalDavRow[] {
  const lines = ics
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
  const rows: CalDavRow[] = [];
  let current: Prop[] | undefined;
  let nested = 0;
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === "BEGIN") {
      const kind = prop.value.trim().toUpperCase();
      if (current === undefined) {
        if (kind === "VEVENT") current = [];
      } else nested++;
    } else if (prop.name === "END") {
      if (current === undefined) continue;
      if (nested > 0) nested--;
      else {
        rows.push(row(current, defaultZone));
        current = undefined;
      }
    } else if (current !== undefined && nested === 0) current.push(prop);
  }
  if (current !== undefined) throw new CalendarFeedError(UNREADABLE);
  return rows;
}

function codePoint(value: number): string {
  const valid =
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0x10ffff &&
    !(value >= 0xd800 && value <= 0xdfff);
  return valid ? String.fromCodePoint(value) : "";
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function unescapeXml(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, entity: string) => {
    if (!entity.startsWith("#")) return ENTITIES[entity] ?? "";
    return entity.startsWith("#x")
      ? codePoint(parseInt(entity.slice(2), 16))
      : codePoint(Number(entity.slice(1)));
  });
}

type XmlToken = { kind: "open" | "close"; name: string } | { kind: "text"; text: string };

const TAG_NAME = /^\/?\s*(?:[A-Za-z0-9_.-]+:)?([A-Za-z0-9_.-]+)/;

/**
 * A linear scan (no backtracking, so a hostile body cannot cost more than its size) into open, close
 * and text tokens. Namespace prefixes are dropped; comments, processing instructions and doctypes are
 * skipped and no custom entity is ever resolved. CDATA is text taken as is.
 */
function* xmlTokens(xml: string): Generator<XmlToken> {
  let at = 0;
  while (at < xml.length) {
    const lt = xml.indexOf("<", at);
    if (lt === -1) {
      yield { kind: "text", text: unescapeXml(xml.slice(at)) };
      return;
    }
    if (lt > at) yield { kind: "text", text: unescapeXml(xml.slice(at, lt)) };
    if (xml.startsWith("<![CDATA[", lt) || xml.startsWith("<!--", lt)) {
      const cdata = xml.startsWith("<![CDATA[", lt);
      const close = cdata ? "]]>" : "-->";
      const from = lt + (cdata ? 9 : 4);
      const end = xml.indexOf(close, from);
      if (end === -1) throw new CalendarFeedError(UNREADABLE);
      if (cdata) yield { kind: "text", text: xml.slice(from, end) };
      at = end + close.length;
      continue;
    }
    const gt = xml.indexOf(">", lt);
    if (gt === -1) throw new CalendarFeedError(UNREADABLE);
    const inner = xml.slice(lt + 1, gt);
    at = gt + 1;
    if (inner.startsWith("?") || inner.startsWith("!")) continue;
    const name = TAG_NAME.exec(inner)?.[1] ?? "";
    if (inner.startsWith("/")) yield { kind: "close", name };
    else {
      yield { kind: "open", name };
      if (inner.endsWith("/")) yield { kind: "close", name };
    }
  }
}

const OK_STATUS = /^\s*HTTP\/\d(?:\.\d)?\s+200\b/;

/**
 * The calendar-data bodies of a 207 multistatus answer. Anything that suggests a partial answer
 * (a status other than 200, a result without calendar data, an unclosed element) makes the read
 * fail rather than return fewer events than the server holds.
 */
export function multistatusCalendarData(xml: string): string[] {
  const bodies: string[] = [];
  let responses = 0;
  let capture: "status" | "calendar-data" | undefined;
  let buffer = "";
  for (const token of xmlTokens(xml)) {
    if (token.kind === "text") {
      if (capture) buffer += token.text;
    } else if (token.kind === "open") {
      if (token.name === "response") responses++;
      else if (token.name === "status" || token.name === "calendar-data") {
        capture = token.name;
        buffer = "";
      }
    } else if (capture !== undefined && token.name === capture) {
      if (capture === "status") {
        if (!OK_STATUS.test(buffer))
          throw new CalendarFeedError(
            "caldav feed incomplete: the server reported a partial result",
          );
      } else bodies.push(buffer);
      capture = undefined;
    }
  }
  if (capture !== undefined || bodies.length !== responses || bodies.some((b) => b.trim() === ""))
    throw new CalendarFeedError(UNREADABLE);
  return bodies;
}
