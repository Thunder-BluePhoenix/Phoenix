// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src";

const tmp = () => mkdtempSync(join(tmpdir(), "phoenix-config-"));

describe("loadConfig", () => {
  it("uses safe defaults", () => {
    const c = loadConfig({ env: {}, configDir: tmp() });
    expect(c.env).toBe("dev");
    expect(c.host).toBe("127.0.0.1");
    expect(c.allowRemote).toBe(false);
  });

  it("layers file then environment", () => {
    const dir = tmp();
    writeFileSync(join(dir, "staging.json"), JSON.stringify({ port: 5000, dataDir: "data" }));
    const c = loadConfig({
      env: { PHOENIX_ENV: "staging", PHOENIX_PORT: "6000" },
      configDir: dir,
      cwd: "/srv",
    });
    expect(c.env).toBe("staging");
    expect(c.port).toBe(6000);
    expect(c.dataDir).toBe("/srv/data");
  });

  it("refuses non-loopback hosts unless allowRemote", () => {
    expect(() => loadConfig({ env: { PHOENIX_HOST: "0.0.0.0" }, configDir: tmp() })).toThrow(
      ConfigError,
    );
    expect(
      loadConfig({
        env: { PHOENIX_HOST: "0.0.0.0", PHOENIX_ALLOW_REMOTE: "true" },
        configDir: tmp(),
      }).host,
    ).toBe("0.0.0.0");
  });

  it("parses allowed origins and rejects malformed ones", () => {
    expect(
      loadConfig({ env: { PHOENIX_ALLOWED_ORIGINS: "http://a:1, https://b" }, configDir: tmp() })
        .allowedOrigins,
    ).toEqual(["http://a:1", "https://b"]);
    expect(() =>
      loadConfig({ env: { PHOENIX_ALLOWED_ORIGINS: "http://a/path" }, configDir: tmp() }),
    ).toThrow(ConfigError);
  });

  it("always trusts the desktop shell's webview origin, in every environment", () => {
    for (const PHOENIX_ENV of ["dev", "staging", "prod"]) {
      const origins = loadConfig({ env: { PHOENIX_ENV }, configDir: tmp() }).allowedOrigins;
      expect(origins).toContain("tauri://localhost");
      expect(origins).toContain("http://tauri.localhost");
    }
    // The Vite dev server stays a development-only origin.
    expect(
      loadConfig({ env: { PHOENIX_ENV: "prod" }, configDir: tmp() }).allowedOrigins,
    ).not.toContain("http://localhost:5173");
  });

  it("rejects bad values", () => {
    expect(() => loadConfig({ env: { PHOENIX_ENV: "qa" }, configDir: tmp() })).toThrow();
    expect(() => loadConfig({ env: { PHOENIX_PORT: "abc" }, configDir: tmp() })).toThrow();
    expect(() => loadConfig({ env: { PHOENIX_LOG_LEVEL: "loud" }, configDir: tmp() })).toThrow();
  });
});
