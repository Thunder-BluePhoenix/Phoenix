// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The documented request limit the poll interval is checked against (docs/service-terms.md). This is a
// reading of a public page on the date below, not legal advice. A test fails if the default or the
// floor poll interval would send more requests than this in its window.
export const DOCUMENTED_LIMIT = {
  source:
    "https://docs.n8n.io/connect/n8n-api/rate-limits.md (when enabled: 1,000 reads per endpoint and 1,200 reads in all, per API key, per 60 s)",
  limit: 1000,
  windowMs: 60_000,
  requestsPerCycle: 2,
  readOn: "2026-11-10",
} as const;
