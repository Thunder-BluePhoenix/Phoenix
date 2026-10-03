// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  FAKE_BEARER,
  FAKE_GITHUB_TOKEN,
  FAKE_OPENAI_KEY,
  GITHUB_TOKEN_PREFIX,
} from "@phoenix/protocol/testing";
import { describe, expect, it } from "vitest";
import { createLogger, REDACTED, redact, type LogRecord } from "../src";

describe("redact", () => {
  it("redacts secret keys at any depth", () => {
    expect(redact({ user: "a", nested: [{ password: "p", ok: 1 }], apiKey: "k" })).toEqual({
      user: "a",
      nested: [{ password: REDACTED, ok: 1 }],
      apiKey: REDACTED,
    });
  });

  it("redacts token-looking values inside strings", () => {
    const out = redact(`curl -H 'Authorization: ${FAKE_BEARER}' and ${FAKE_GITHUB_TOKEN}`);
    expect(out).not.toContain("abcdefghijklmnop");
    expect(out).not.toContain(GITHUB_TOKEN_PREFIX);
  });

  it("handles errors and primitives", () => {
    expect(redact(5)).toBe(5);
    expect(redact(null)).toBe(null);
    expect(redact(new Error(`${FAKE_OPENAI_KEY} leaked`))).toMatchObject({
      message: `${REDACTED} leaked`,
    });
  });
});

describe("logger", () => {
  it("never writes secrets to the sink", () => {
    const records: LogRecord[] = [];
    const log = createLogger({ level: "debug", sink: (r) => records.push(r) });
    log.info(`connecting with token ${FAKE_GITHUB_TOKEN}`, {
      token: "plain-secret",
      host: "github.com",
    });
    const line = JSON.stringify(records);
    expect(line).not.toContain("plain-secret");
    expect(line).not.toContain(GITHUB_TOKEN_PREFIX);
    expect(records[0]).toMatchObject({ level: "info", component: "core", host: "github.com" });
  });

  it("filters by level and namespaces children", () => {
    const records: LogRecord[] = [];
    const log = createLogger({ level: "warn", sink: (r) => records.push(r) }).child("bus");
    log.info("skip");
    log.error("keep");
    expect(records).toHaveLength(1);
    expect(records[0]?.component).toBe("core.bus");
  });

  it("does not let fields override reserved keys", () => {
    const records: LogRecord[] = [];
    createLogger({ sink: (r) => records.push(r) }).info("real", { msg: "fake", level: "debug" });
    expect(records[0]).toMatchObject({ msg: "real", level: "info" });
  });
});
