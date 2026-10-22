// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EngineeringSignals,
  createEngineeringDelivery,
  type Advisory,
  type Dependency,
  type HistoryRun,
  ProviderUnavailableError,
} from "../src/engineering";

const now = Date.parse("2026-10-22T12:00:00Z");
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders) await rm(folder, { recursive: true, force: true });
});
async function repo() {
  const folder = await mkdtemp(join(tmpdir(), "phoenix-signals-"));
  folders.push(folder);
  return await realpath(folder);
}
function fixture(advisories: Advisory[] = [], runs: HistoryRun[] = []) {
  let permitted = true;
  const lookup = vi.fn(async (_dependencies: readonly Dependency[]) => advisories);
  const consider = vi.fn();
  const timer = { set: vi.fn(() => 1), clear: vi.fn() };
  const source = new EngineeringSignals({
    advisories: { lookup },
    history: { list: async () => runs },
    delivery: { enabled: () => permitted, consider },
    clock: { now: () => now },
    timer,
    cadenceMs: 60_000,
  });
  return {
    source,
    lookup,
    consider,
    timer,
    revoke: () => {
      permitted = false;
    },
  };
}

describe("engineering signals", () => {
  it("reads only configured repos and matches exact pinned versions for four ecosystems", async () => {
    const watched = await repo();
    const unrelated = await repo();
    await writeFile(
      join(watched, "package.json"),
      JSON.stringify({ dependencies: { alpha: "1.2.3", excluded: "^1.0.0" } }),
    );
    await writeFile(
      join(watched, "Cargo.lock"),
      '[[package]]\nname = "bravo"\nversion = "2.0.0"\n',
    );
    await writeFile(join(watched, "requirements.txt"), "charlie==3.0.0\n");
    await writeFile(
      join(watched, "go.mod"),
      "module example.org/app\nrequire example.org/delta v4.0.0\n",
    );
    await writeFile(
      join(unrelated, "package.json"),
      JSON.stringify({ dependencies: { secret: "1.0.0" } }),
    );
    const advisories: Advisory[] = [
      {
        id: "CVE-1",
        ecosystem: "npm",
        name: "alpha",
        affectedVersion: "1.2.3",
        summary: "npm issue",
      },
      {
        id: "CVE-2",
        ecosystem: "cargo",
        name: "bravo",
        affectedVersion: "2.0.0",
        summary: "cargo issue",
      },
      {
        id: "CVE-3",
        ecosystem: "pip",
        name: "charlie",
        affectedVersion: "3.0.0",
        summary: "pip issue",
      },
      {
        id: "CVE-4",
        ecosystem: "go",
        name: "example.org/delta",
        affectedVersion: "v4.0.0",
        summary: "go issue",
      },
      {
        id: "CVE-5",
        ecosystem: "npm",
        name: "excluded",
        affectedVersion: "1.0.0",
        summary: "not pinned",
      },
    ];
    const f = fixture(advisories);
    await f.source.setWatchedRoots([watched]);
    const result = await f.source.scan();
    expect(f.lookup).toHaveBeenCalledWith(
      expect.arrayContaining([
        { ecosystem: "npm", name: "alpha", version: "1.2.3" },
        { ecosystem: "cargo", name: "bravo", version: "2.0.0" },
        { ecosystem: "pip", name: "charlie", version: "3.0.0" },
        { ecosystem: "go", name: "example.org/delta", version: "v4.0.0" },
      ]),
    );
    expect(result.filter((s) => s.kind === "advisory")).toHaveLength(4);
    expect(result.some((s) => s.subject === "secret" || s.subject === "excluded")).toBe(false);
  });

  it("detects flaky test identity and median duration regression in terminal and CI histories", async () => {
    const root = await repo();
    const runs: HistoryRun[] = [1, 2, 3, 4, 5, 6].map((n) => ({
      repo: root,
      source: "ci",
      job: "unit",
      test: "suite > behaves",
      outcome: n === 4 ? "failed" : "passed",
      durationMs: n <= 3 ? 1200 : 2900,
      finishedAt: now - (7 - n) * 1000,
    }));
    runs.push({ ...runs[0]!, source: "terminal", test: "different", outcome: "failed" });
    const f = fixture([], runs);
    await f.source.setWatchedRoots([root]);
    const results = await f.source.scan();
    expect(results.map((s) => s.kind)).toEqual(["duration_trend", "flaky_test"]);
    expect(results.find((s) => s.kind === "duration_trend")?.detail).toContain("1200 ms → 2900 ms");
    expect((await f.source.scan()).map((s) => s.id)).toEqual(results.map((s) => s.id));
  });

  it("raises terminal flakiness and CI build duration from distinct history identities", async () => {
    const root = await repo();
    const terminal: HistoryRun[] = ["passed", "failed", "passed"].map((outcome, index) => ({
      repo: root,
      source: "terminal",
      job: "npm test",
      test: "suite > retry",
      outcome: outcome as "passed" | "failed",
      durationMs: 1200,
      finishedAt: now - (3 - index) * 1000,
    }));
    const ci: HistoryRun[] = [1000, 1100, 1200, 2600, 2700, 2800].map((durationMs, index) => ({
      repo: root,
      source: "ci",
      job: "build",
      test: null,
      outcome: "passed",
      durationMs,
      finishedAt: now - (6 - index) * 1000,
    }));
    const f = fixture([], [...terminal, ...ci]);
    await f.source.setWatchedRoots([root]);
    const signals = await f.source.scan();
    expect(signals.map((signal) => signal.kind)).toEqual(["duration_trend", "flaky_test"]);
    expect(signals.find((signal) => signal.kind === "duration_trend")?.subject).toBe("build");
    expect(signals.find((signal) => signal.kind === "flaky_test")?.subject).toBe("suite > retry");
  });

  it("streams env names without exposing values and refuses a symlinked env file", async () => {
    const root = await repo();
    const outside = await repo();
    await writeFile(
      join(root, ".env.example"),
      "PRESENT=template-data\nMISSING=example-data\nexport SECOND=template-secret\n",
    );
    await writeFile(join(root, ".env"), "PRESENT=real-secret\nSECOND=another-secret\n");
    const f = fixture();
    await f.source.setWatchedRoots([root]);
    const signals = await f.source.scan();
    expect(signals.map((s) => s.subject)).toEqual(["MISSING"]);
    expect(JSON.stringify(signals)).not.toMatch(/secret|template-data|example-data/i);
    await rm(join(root, ".env"));
    await writeFile(join(outside, "hidden"), "SECRET=private\n");
    await symlink(join(outside, "hidden"), join(root, ".env"));
    expect(await f.source.scan()).toEqual([]);
  });

  it("requires opt-in, cancels scheduled work, and invalidates a revoked source before delivery", async () => {
    const root = await repo();
    await writeFile(join(root, ".env.example"), "MISSING=\n");
    await writeFile(join(root, ".env"), "");
    const f = fixture();
    await f.source.setWatchedRoots([root]);
    expect(f.timer.set).toHaveBeenCalledTimes(1);
    expect(await f.source.evaluate()).toHaveLength(1);
    expect(f.consider).toHaveBeenCalledTimes(1);
    expect(f.consider.mock.calls[0]?.[1]()).toBe(true);
    f.revoke();
    expect(f.consider.mock.calls[0]?.[1]()).toBe(false);
    expect(await f.source.evaluate()).toEqual([]);
    f.source.stop();
    expect(f.timer.clear).toHaveBeenCalled();
    expect(
      () =>
        new EngineeringSignals({
          advisories: { lookup: async () => [] },
          history: { list: async () => [] },
          delivery: { enabled: () => false, consider: () => {} },
          clock: { now: () => now },
          timer: f.timer,
          cadenceMs: 1000,
        }),
    ).toThrow("invalid cadence");
  });
  it("invalidates retained callbacks on newer evidence and watched-root revision", async () => {
    const root = await repo();
    await writeFile(join(root, ".env.example"), "MISSING=template-secret\n");
    await writeFile(join(root, ".env"), "EXISTING=private-secret\n");
    const f = fixture();
    await f.source.setWatchedRoots([root]);
    await f.source.evaluate();
    const current = f.consider.mock.calls[0]![1] as () => boolean;
    expect(current()).toBe(true);
    await writeFile(join(root, ".env"), "MISSING=actual-private-secret\n");
    expect(await f.source.evaluate()).toEqual([]);
    expect(current()).toBe(false);
    await f.source.setWatchedRoots([]);
    expect(current()).toBe(false);
  });

  it("shows opt-in-independent dashboard results while suppressing automatic delivery", async () => {
    const root = await repo();
    await writeFile(join(root, ".env.example"), "MISSING=template-secret\n");
    await writeFile(join(root, ".env"), "PRESENT=private-secret\n");
    const f = fixture();
    await f.source.setWatchedRoots([root]);
    f.revoke();
    expect((await f.source.scan()).map((signal) => signal.subject)).toEqual(["MISSING"]);
    expect(await f.source.evaluate()).toEqual([]);
    expect(f.consider).not.toHaveBeenCalled();
  });

  it("extracts Go block requirements without interpreting replace clauses", async () => {
    const root = await repo();
    await writeFile(
      join(root, "go.mod"),
      "module example.org/app\nrequire (\n example.org/direct v1.2.3\n example.org/indirect v2.3.4 // indirect\n)\nreplace example.org/other v1.0.0 => example.org/other v1.1.0\n",
    );
    const f = fixture([
      {
        id: "GO-1",
        ecosystem: "go",
        name: "example.org/direct",
        affectedVersion: "v1.2.3",
        summary: "issue",
      },
    ]);
    await f.source.setWatchedRoots([root]);
    expect(f.lookup).not.toHaveBeenCalled();
    expect((await f.source.scan()).map((signal) => signal.kind)).toEqual(["advisory"]);
    expect(f.lookup.mock.calls[0]![0]).toEqual([
      { ecosystem: "go", name: "example.org/direct", version: "v1.2.3" },
      { ecosystem: "go", name: "example.org/indirect", version: "v2.3.4" },
    ]);
  });
  it("scans a pathological go.mod whitespace line in linear time and still parses comments", async () => {
    const root = await repo();
    await writeFile(
      join(root, "go.mod"),
      `module example.org/app\nrequire (\n example.org/direct v1.2.3 // indirect\n${" ".repeat(
        128 * 1024,
      )}x\n)\n`,
    );
    const f = fixture();
    await f.source.setWatchedRoots([root]);
    const started = performance.now();
    await f.source.scan();
    expect(performance.now() - started).toBeLessThan(1000);
    expect(f.lookup.mock.calls[0]![0]).toEqual([
      { ecosystem: "go", name: "example.org/direct", version: "v1.2.3" },
    ]);
  });
  it("bounds config drift names, name length and signals for a hostile .env.example", async () => {
    const root = await repo();
    const names = Array.from({ length: 5000 }, (_, index) => `KEY_${index}=x`);
    names.push(`${"L".repeat(200)}=x`);
    await writeFile(join(root, ".env.example"), names.join("\n"));
    await writeFile(join(root, ".env"), "");
    const f = fixture();
    await f.source.setWatchedRoots([root]);
    const signals = await f.source.scan();
    expect(signals.length).toBeLessThanOrEqual(500);
    expect(signals.every((signal) => signal.subject.length <= 128)).toBe(true);
  });
  it("does not report a name present in .env beyond the example cap as missing", async () => {
    const root = await repo();
    await writeFile(join(root, ".env.example"), "WANTED=x\n");
    await writeFile(
      join(root, ".env"),
      `${Array.from({ length: 1000 }, (_, index) => `PAD_${index}=x`).join("\n")}\nWANTED=y\n`,
    );
    const f = fixture();
    await f.source.setWatchedRoots([root]);
    expect(await f.source.scan()).toEqual([]);
  });
  it("rescans exactly once per evaluation regardless of candidate count", async () => {
    const root = await repo();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { alpha: "1.2.3" } }),
    );
    await writeFile(join(root, ".env.example"), "A=1\nB=1\nC=1\nD=1\n");
    await writeFile(join(root, ".env"), "");
    const f = fixture();
    await f.source.setWatchedRoots([root]);
    const candidates = await f.source.evaluate();
    expect(candidates).toHaveLength(4);
    expect(f.consider).toHaveBeenCalledTimes(4);
    expect(f.lookup).toHaveBeenCalledTimes(2);
  });
  it("continues manual drift after explicitly unavailable providers, without hiding unexpected errors", async () => {
    const root = await repo();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { alpha: "1.2.3" } }),
    );
    await writeFile(join(root, ".env.example"), "MISSING=private-value\n");
    await writeFile(join(root, ".env"), "");
    const unavailable = new EngineeringSignals({
      advisories: {
        lookup: async () => {
          throw new ProviderUnavailableError("No local advisory database");
        },
      },
      history: {
        list: async () => {
          throw new ProviderUnavailableError("History unavailable");
        },
      },
      delivery: { enabled: () => false, consider: () => {} },
      clock: { now: () => now },
      timer: { set: () => 1, clear: () => {} },
      cadenceMs: 60_000,
    });
    await unavailable.setWatchedRoots([root]);
    expect((await unavailable.scan()).map((signal) => signal.kind)).toEqual(["config_drift"]);
    expect(unavailable.providerAvailability()).toEqual({
      advisories: { available: false, reason: "No local advisory database" },
      history: { available: false, reason: "History unavailable" },
    });
    const unexpected = new EngineeringSignals({
      advisories: {
        lookup: async () => {
          throw new Error("unexpected advisory failure");
        },
      },
      history: { list: async () => [] },
      delivery: { enabled: () => false, consider: () => {} },
      clock: { now: () => now },
      timer: { set: () => 1, clear: () => {} },
      cadenceMs: 60_000,
    });
    await unexpected.setWatchedRoots([root]);
    await expect(unexpected.scan()).rejects.toThrow("unexpected advisory failure");
  });
  it("delegates notifications to Phase 52 policy with current evidence and explicit consent", () => {
    let optedIn = false;
    let current = true;
    let killed = false;
    const considerInsight = vi.fn((_user: string, _insight: unknown, check: () => boolean) =>
      check(),
    );
    const delivery = createEngineeringDelivery({
      notifications: {
        proactivePreferences: () => ({
          enabled: optedIn,
          capabilities: ["engineering-signals"],
          cadenceMinutes: 60,
        }),
        considerInsight,
      },
      userId: "user",
      killSwitchEngaged: () => killed,
      capabilityEnabled: () => true,
    });
    const signal = {
      id: "engineering.config_drift.abc",
      kind: "config_drift" as const,
      repo: "repo",
      subject: "MISSING",
      detail: "MISSING",
      evidenceIds: ["evidence"],
      observedAt: now,
    };
    delivery.consider(signal, () => current);
    expect(considerInsight).not.toHaveBeenCalled();
    optedIn = true;
    delivery.consider(signal, () => current);
    expect(considerInsight).toHaveBeenCalledTimes(1);
    expect(considerInsight.mock.calls[0]![1]).toMatchObject({
      capabilityId: "engineering-signals",
      id: signal.id,
    });
    current = false;
    expect(considerInsight.mock.calls[0]![2]()).toBe(false);
    killed = true;
    delivery.consider(signal, () => true);
    expect(considerInsight).toHaveBeenCalledTimes(1);
  });
});
