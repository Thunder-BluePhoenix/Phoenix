// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The poll defaults must stay inside the documented request limit (docs/service-terms.md).
import { describe, expect, it } from "vitest";
import { DEFAULT_POLL_MS, MIN_POLL_MS } from "../src";
import { DOCUMENTED_LIMIT } from "../src/limits";

function requestsInWindow(intervalMs: number): number {
  return (DOCUMENTED_LIMIT.requestsPerCycle * DOCUMENTED_LIMIT.windowMs) / intervalMs;
}

describe("Calcom poll interval against the documented limit", () => {
  it("the default interval sends no more than the documented limit", () => {
    expect(requestsInWindow(DEFAULT_POLL_MS)).toBeLessThanOrEqual(DOCUMENTED_LIMIT.limit);
  });

  it("the floor (the lowest a user can set) sends no more than the documented limit", () => {
    expect(requestsInWindow(MIN_POLL_MS)).toBeLessThanOrEqual(DOCUMENTED_LIMIT.limit);
  });

  it("the default is not below the floor", () => {
    expect(DEFAULT_POLL_MS).toBeGreaterThanOrEqual(MIN_POLL_MS);
  });

  it("records where and when the limit was read", () => {
    expect(DOCUMENTED_LIMIT.source).toMatch(/^https:\/\//);
    expect(DOCUMENTED_LIMIT.readOn).toBe("2026-11-10");
  });
});
