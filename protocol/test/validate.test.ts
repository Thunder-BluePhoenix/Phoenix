// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createEvent,
  ErrorCode,
  eventNamespace,
  findSecrets,
  isExpired,
  type PhoenixEvent,
  PROTOCOL_VERSION,
  validateEvent,
} from "../src";
import { FAKE_BEARER, FAKE_GITHUB_TOKEN } from "../testing/fake-secrets";

const fixtures = JSON.parse(
  readFileSync(new URL("../fixtures/appendix-a.events.json", import.meta.url), "utf8"),
) as PhoenixEvent[];

const valid = (): PhoenixEvent =>
  createEvent({ event_type: "build.started", source: "terminal", severity: "info" });

describe("event schema v1", () => {
  it.each(fixtures.map((f) => [f.event_type, f] as const))("accepts fixture %s", (_t, f) => {
    expect(validateEvent(f)).toMatchObject({ ok: true });
  });

  it("createEvent produces a valid envelope", () => {
    const e = valid();
    expect(e.event_id).toMatch(/^evt_/);
    expect(e.version).toBe(PROTOCOL_VERSION);
    expect(validateEvent(e).ok).toBe(true);
  });

  it("stays compatible with every 1.x minor version", () => {
    for (const version of ["1.0", "1.1", "1.42"]) {
      expect(validateEvent({ ...valid(), version }).ok).toBe(true);
    }
  });

  it("tolerates unknown future fields", () => {
    expect(validateEvent({ ...valid(), future_field: { x: 1 } }).ok).toBe(true);
  });

  it.each([
    ["missing event_id", { event_id: undefined }],
    ["un-namespaced type", { event_type: "started" }],
    ["upper-case type", { event_type: "Build.Started" }],
    ["unknown severity", { severity: "fatal" }],
    ["bad timestamp", { timestamp: "yesterday" }],
    ["major version 2", { version: "2.0" }],
    ["payload not object", { payload: "x" }],
    ["negative ttl", { ttl_ms: -1 }],
  ])("rejects %s with INVALID_EVENT", (_name, patch) => {
    const result = validateEvent({ ...valid(), ...patch });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.INVALID_EVENT);
      expect(result.error.details.length).toBeGreaterThan(0);
    }
  });

  it("rejects non-objects without throwing", () => {
    for (const v of [null, undefined, 42, "evt", []]) expect(validateEvent(v).ok).toBe(false);
  });
});

describe("no secrets in events", () => {
  it("blocks secret keys in payload", () => {
    const result = validateEvent({ ...valid(), payload: { repo: "x", apiKey: "abc" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.SECURITY_POLICY_BLOCKED);
      expect(result.error.details).toEqual(["$.payload.apiKey"]);
    }
  });

  it("blocks token-looking values anywhere", () => {
    const result = validateEvent({
      ...valid(),
      metadata: { note: `Authorization: ${FAKE_BEARER}` },
    });
    expect(result.ok).toBe(false);
  });

  it("finds nested secrets", () => {
    expect(findSecrets({ a: [{ password: "x" }], b: FAKE_GITHUB_TOKEN })).toEqual([
      "$.a[0].password",
      "$.b",
    ]);
  });

  it("does not flag ordinary words", () => {
    expect(findSecrets({ tokens_used: 12, author: "fawkes", summary: "token budget" })).toEqual([]);
  });
});

describe("helpers", () => {
  it("eventNamespace", () => {
    expect(eventNamespace("kage.meeting.started")).toBe("kage.meeting");
    expect(eventNamespace("build.failed")).toBe("build");
  });

  it("isExpired", () => {
    const t = "2026-10-03T12:00:00.000Z";
    const base = Date.parse(t);
    expect(isExpired({ timestamp: t }, base + 1e9)).toBe(false);
    expect(isExpired({ timestamp: t, ttl_ms: 1000 }, base + 999)).toBe(false);
    expect(isExpired({ timestamp: t, ttl_ms: 1000 }, base + 1000)).toBe(true);
  });
});
