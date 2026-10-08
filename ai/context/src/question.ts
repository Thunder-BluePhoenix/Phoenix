// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The pure part of "what did we decide about X yesterday?": split a question into a topic and a
// time window. Windows are calendar days in the user's time zone, from an injected clock.
//
//   yesterday | today | this week | last week | last/past N days | on <weekday> | last <weekday>
//
// "last week" is the previous calendar week (Monday to Sunday). "this week" runs from this
// Monday to the end of today. "on <weekday>" is the most recent such day BEFORE today, so on a
// Monday "on Monday" means a week ago. "the last N days" are the N calendar days before today
// plus today.
import { contentWords } from "@phoenix/ai-memory";
import {
  WEEKDAY_PATTERN,
  addDays,
  calendarDay,
  dayOfWeek,
  dayRange,
  weekdayIndex,
  type Clock,
  type TimeWindow,
} from "./time";

export interface ParsedQuestion {
  /** The question with the time phrase removed. */
  topicText: string;
  /** Searchable words left over, without filler such as "what did we decide". */
  topicWords: string[];
  /** Null when the question names no time. */
  window: TimeWindow | null;
}

export const MAX_RELATIVE_DAYS = 365;

interface Phrase {
  pattern: RegExp;
  window(match: RegExpExecArray, clock: Clock): TimeWindow | null;
}

const PHRASES: Phrase[] = [
  {
    pattern:
      /\b(?:in\s+)?the\s+(?:last|past)\s+(\d{1,4})\s+days?\b|\b(?:last|past)\s+(\d{1,4})\s+days?\b/i,
    window(m, clock) {
      const n = Number(m[1] ?? m[2]);
      if (n < 1 || n > MAX_RELATIVE_DAYS) return null;
      const today = calendarDay(clock.now(), clock.timeZone);
      return dayRange(
        addDays(today, -n),
        addDays(today, 1),
        clock.timeZone,
        `the last ${n} day${n === 1 ? "" : "s"}`,
      );
    },
  },
  {
    pattern: /\blast\s+week\b/i,
    window(_m, clock) {
      const today = calendarDay(clock.now(), clock.timeZone);
      const sinceMonday = (dayOfWeek(today) + 6) % 7;
      const thisMonday = addDays(today, -sinceMonday);
      return dayRange(addDays(thisMonday, -7), thisMonday, clock.timeZone, "last week");
    },
  },
  {
    pattern: /\bthis\s+week\b/i,
    window(_m, clock) {
      const today = calendarDay(clock.now(), clock.timeZone);
      const thisMonday = addDays(today, -((dayOfWeek(today) + 6) % 7));
      return dayRange(thisMonday, addDays(today, 1), clock.timeZone, "this week");
    },
  },
  {
    pattern: /\byesterday\b/i,
    window(_m, clock) {
      const today = calendarDay(clock.now(), clock.timeZone);
      return dayRange(addDays(today, -1), today, clock.timeZone, "yesterday");
    },
  },
  {
    pattern: /\btoday\b/i,
    window(_m, clock) {
      const today = calendarDay(clock.now(), clock.timeZone);
      return dayRange(today, addDays(today, 1), clock.timeZone, "today");
    },
  },
  {
    pattern: new RegExp(`\\b(?:on|last)\\s+(${WEEKDAY_PATTERN})\\b`, "i"),
    window(m, clock) {
      const today = calendarDay(clock.now(), clock.timeZone);
      const target = weekdayIndex(m[1] ?? "");
      const back = (dayOfWeek(today) - target + 7) % 7 || 7;
      const day = addDays(today, -back);
      return dayRange(day, addDays(day, 1), clock.timeZone, `on ${m[1]?.toLowerCase()}`);
    },
  },
];

export function parseQuestion(question: string, clock: Clock): ParsedQuestion {
  for (const phrase of PHRASES) {
    const match = phrase.pattern.exec(question);
    if (!match) continue;
    const window = phrase.window(match, clock);
    if (!window) continue;
    const topicText = question.replace(match[0], " ").replace(/\s+/g, " ").trim();
    return { topicText, topicWords: contentWords(topicText), window };
  }
  const topicText = question.replace(/\s+/g, " ").trim();
  return { topicText, topicWords: contentWords(topicText), window: null };
}
