// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { resolveCoreUrl, resolveSessionToken, tokenFileCandidates } from "../src/core-discovery.js";
import { countDiagnostics, createDiagnosticsReporter } from "../src/diagnostics.js";

describe("Core URL", () => {
  it("prefers the setting, then PHOENIX_CORE_URL, then the default", () => {
    expect(
      resolveCoreUrl({
        setting: "http://localhost:5000/",
        env: { PHOENIX_CORE_URL: "http://127.0.0.1:1" },
      }),
    ).toBe("http://localhost:5000");
    expect(resolveCoreUrl({ setting: "  ", env: { PHOENIX_CORE_URL: "http://127.0.0.1:1" } })).toBe(
      "http://127.0.0.1:1",
    );
    expect(resolveCoreUrl()).toBe("http://127.0.0.1:4870");
    expect(resolveCoreUrl({ setting: "http://[::1]:4870" })).toBe("http://[::1]:4870");
  });
  it.each([
    "http://192.168.1.5:4870",
    "http://evil.example",
    "http://127.0.0.1.evil.example",
    "http://localhost.evil.example:4870",
    "https://127.0.0.1:4870",
    "ftp://127.0.0.1",
    "not a url",
  ])("refuses %s (the session token must not leave this machine)", (url) => {
    expect(() => resolveCoreUrl({ setting: url })).toThrow();
  });
});

describe("session token", () => {
  const files: Record<string, string> = {};
  const readFile = (f: string) => files[f];
  const home = "/home/u";
  it("uses PHOENIX_SESSION_TOKEN first, then the data dir, workspace, then home (same order as the SDK, plus workspace folders)", () => {
    expect(resolveSessionToken({ env: { PHOENIX_SESSION_TOKEN: "env-tok" }, home, readFile })).toBe(
      "env-tok",
    );
    expect(
      tokenFileCandidates({
        env: { PHOENIX_DATA_DIR: "/d", PHOENIX_ENV: "prod" },
        workspaceFolders: ["/w"],
        home,
      }),
    ).toEqual([
      "/d/session.token",
      "/w/.phoenix/prod/session.token",
      "/home/u/.phoenix/prod/session.token",
    ]);
    files["/home/u/.phoenix/dev/session.token"] = "home-tok\n";
    expect(resolveSessionToken({ home, readFile })).toBe("home-tok");
    files["/w/.phoenix/dev/session.token"] = "  ws-tok  ";
    expect(resolveSessionToken({ home, workspaceFolders: ["/w"], readFile })).toBe("ws-tok");
    files["/d/session.token"] = "data-tok";
    expect(
      resolveSessionToken({
        env: { PHOENIX_DATA_DIR: "/d" },
        workspaceFolders: ["/w"],
        home,
        readFile,
      }),
    ).toBe("data-tok");
  });
  it("skips empty token files and explains where it looked when there is none", () => {
    expect(() => resolveSessionToken({ home: "/nowhere", readFile: () => "  \n" })).toThrow(
      /\/nowhere\/\.phoenix\/dev\/session\.token.*Is Phoenix Core running/,
    );
  });
});

describe("countDiagnostics", () => {
  it("counts errors and warnings only; hints and information are ignored", () => {
    const uri = "file:///secret/path.ts";
    expect(
      countDiagnostics([
        [
          uri,
          [{ severity: 0 }, { severity: 0 }, { severity: 1 }, { severity: 2 }, { severity: 3 }],
        ],
        ["file:///b.ts", [{ severity: 1 }]],
        ["file:///c.ts", []],
      ]),
    ).toEqual({ errors: 2, warnings: 2 });
  });
});

describe("diagnostics reporter", () => {
  /** A hand-driven clock and timer so no real time passes. */
  function rig(
    initial = { errors: 0, warnings: 0 },
    opts: { quietMs?: number; maxWaitMs?: number } = {},
  ) {
    let now = 0;
    let totals = initial;
    let pending: { at: number; fn: () => void } | undefined;
    const reports: unknown[] = [];
    const reporter = createDiagnosticsReporter({
      read: () => totals,
      report: (c) => reports.push(c),
      setTimer: (fn, ms) => (pending = { at: now + ms, fn }),
      clearTimer: () => (pending = undefined),
      clock: () => now,
      ...opts,
    });
    return {
      reports,
      reporter,
      set: (t: { errors: number; warnings: number }) => (totals = t),
      /** Advances time, firing the timer if due. */
      advance(ms: number) {
        now += ms;
        if (pending && pending.at <= now) {
          const { fn } = pending;
          pending = undefined;
          fn();
        }
      },
      get pending() {
        return pending !== undefined;
      },
    };
  }

  it("reports once after a burst of notifications goes quiet, with previous totals", () => {
    const r = rig({ errors: 1, warnings: 0 });
    r.set({ errors: 4, warnings: 2 });
    for (let i = 0; i < 20; i++) {
      r.reporter.changed();
      r.advance(100);
    }
    expect(r.reports).toEqual([]);
    r.advance(3_000);
    expect(r.reports).toEqual([{ errors: 4, warnings: 2, previousErrors: 1, previousWarnings: 0 }]);
  });
  it("stays silent when the totals did not change (editing inside an already-broken file)", () => {
    const r = rig({ errors: 2, warnings: 1 });
    r.reporter.changed();
    r.advance(3_000);
    expect(r.reports).toEqual([]);
  });
  it("still reports during a never-ending burst, at the maximum wait", () => {
    const r = rig({ errors: 0, warnings: 0 }, { quietMs: 3_000, maxWaitMs: 10_000 });
    r.set({ errors: 1, warnings: 0 });
    for (let t = 0; t < 10_000; t += 1_000) {
      r.reporter.changed();
      r.advance(1_000);
    }
    expect(r.reports).toHaveLength(1);
  });
  it("a second change after the first report is reported against the new baseline; dispose drops a pending report", () => {
    const r = rig();
    r.set({ errors: 1, warnings: 0 });
    r.reporter.changed();
    r.advance(3_000);
    r.set({ errors: 0, warnings: 0 });
    r.reporter.changed();
    r.advance(3_000);
    expect(r.reports[1]).toEqual({
      errors: 0,
      warnings: 0,
      previousErrors: 1,
      previousWarnings: 0,
    });
    r.set({ errors: 9, warnings: 9 });
    r.reporter.changed();
    r.reporter.dispose();
    expect(r.pending).toBe(false);
    r.advance(60_000);
    expect(r.reports).toHaveLength(2);
  });
});
