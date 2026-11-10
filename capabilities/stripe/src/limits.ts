// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The documented request limit the poll interval is checked against (docs/service-terms.md). This is a
// reading of a public page on the date below, not legal advice. A test fails if the default or the
// floor poll interval would send more requests than this in its window.
export const DOCUMENTED_LIMIT = {
  source:
    "https://docs.stripe.com/rate-limits (API read request allocations: every account has at least 10,000 read requests per month)",
  limit: 10_000,
  windowMs: 30 * 24 * 3_600_000,
  requestsPerCycle: 1,
  readOn: "2026-11-10",
} as const;
