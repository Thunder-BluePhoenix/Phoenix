// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The documented request limit the poll interval is checked against (docs/service-terms.md). This is a
// reading of a public page on the date below, not legal advice. A test fails if the default or the
// floor poll interval would send more requests than this in its window.
export const DOCUMENTED_LIMIT = {
  source:
    "https://developers.notion.com/reference/request-limits (per connection: 180 requests per minute outside Business and Enterprise)",
  limit: 180,
  windowMs: 60_000,
  // The bot check (once) plus one read for every watched page or database.
  requestsPerCycle: 21,
  readOn: "2026-11-10",
} as const;
