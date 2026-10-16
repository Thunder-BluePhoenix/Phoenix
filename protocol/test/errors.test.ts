// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { ERROR_DESCRIPTIONS, ERROR_HTTP_STATUS, ErrorCode, PhoenixError } from "../src";

describe("CONSENT_CHANNEL_UNAVAILABLE", () => {
  it("is a distinct code with a description and HTTP 403 (not a generic 500 or 400)", () => {
    expect(ErrorCode.CONSENT_CHANNEL_UNAVAILABLE).toBe("CONSENT_CHANNEL_UNAVAILABLE");
    expect(ERROR_HTTP_STATUS.CONSENT_CHANNEL_UNAVAILABLE).toBe(403);
    expect(ERROR_DESCRIPTIONS.CONSENT_CHANNEL_UNAVAILABLE.length).toBeGreaterThan(0);
    expect(new PhoenixError(ErrorCode.CONSENT_CHANNEL_UNAVAILABLE).toJSON().code).toBe(
      "CONSENT_CHANNEL_UNAVAILABLE",
    );
  });

  it("every code has a description and a status", () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ERROR_DESCRIPTIONS[code], code).toBeTruthy();
      expect(ERROR_HTTP_STATUS[code], code).toBeGreaterThanOrEqual(400);
    }
  });
});
