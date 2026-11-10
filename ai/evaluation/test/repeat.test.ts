// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  ModelError,
  processedByLabel,
  type GenerateRequest,
  type GenerateResult,
  type ModelProvider,
} from "@phoenix/ai-models";
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatReport, main, parseRepeat } from "../src/cli";
import { stringifyReport } from "../src/report";
import { ALL_SCENARIOS } from "../src/scenarios";
import { HONEST_ANSWER } from "../src/scenarios/fixtures";
import { checkRepeat, runSuite } from "../src/suite";

/** A fake CI-agent model. `flaky` makes every second call return text the agent cannot use. */
function provider(flaky: boolean, wall?: { t: number }): ModelProvider & { calls: number } {
  const provenance = {
    provider: "repeat-fake",
    model: "fake-1",
    locality: "local" as const,
    processedBy: processedByLabel("Fake", "fake-1", "local"),
  };
  const p = {
    calls: 0,
    id: "repeat-fake",
    label: "Fake",
    locality: "local" as const,
    capabilities: { generate: true, stream: false, embed: false },
    costTier: 0 as const,
    typicalLatencyMs: 1,
    models: () => Promise.resolve([]),
    health: () => Promise.resolve({ available: true, detail: "fake" }),
    stream: () => {
      throw new ModelError("unsupported", "repeat-fake", "no streams");
    },
    embed: () => Promise.reject(new ModelError("unsupported", "repeat-fake", "no embeddings")),
    generate(_req: GenerateRequest): Promise<GenerateResult> {
      p.calls += 1;
      if (wall) wall.t += 7;
      const text =
        flaky && p.calls % 2 === 0 ? "sorry, no JSON here" : JSON.stringify(HONEST_ANSWER);
      return Promise.resolve({ text, provenance, usage: { inputTokens: 10, outputTokens: 5 } });
    },
  };
  return p;
}

const CASE = ALL_SCENARIOS.filter((s) => s.id === "bench-ci-honest-model");
const clock = () => 1_000;

describe("--repeat", () => {
  it("accepts 1..20 and rejects everything else", () => {
    expect(checkRepeat(1)).toBe(1);
    expect(checkRepeat(20)).toBe(20);
    for (const bad of [0, 21, -1, 1.5, Number.NaN])
      expect(() => checkRepeat(bad)).toThrow(RangeError);
    expect(parseRepeat(["run"])).toBe(1);
    expect(parseRepeat(["run", "--repeat", "7"])).toBe(7);
    expect(parseRepeat(["run", "--repeat=20"])).toBe(20);
    for (const bad of [
      ["--repeat"],
      ["--repeat", "0"],
      ["--repeat=21"],
      ["--repeat", "x"],
      ["--repeat=2.5"],
    ])
      expect(() => parseRepeat(bad)).toThrow(RangeError);
  });

  it("the CLI exits 2 for an out-of-range count and runs nothing", async () => {
    const p = provider(false);
    const lines: string[] = [];
    for (const n of ["0", "21"]) {
      const code = await main(["run", "--repeat", n], {
        provider: p,
        scenarios: CASE,
        latestPath: null,
        out: (t) => void lines.push(t),
      });
      expect(code).toBe(2);
    }
    expect(p.calls).toBe(0);
    expect(lines).toEqual([]);
  });

  it("repeat 1 is byte-identical to a plain run and carries no reliability field", async () => {
    const plain = await runSuite("x", CASE, undefined, provider(false), undefined, { now: clock });
    const one = await runSuite("x", CASE, undefined, provider(false), undefined, {
      repeat: 1,
      now: clock,
    });
    expect(stringifyReport(one.report)).toBe(stringifyReport(plain.report));
    expect(JSON.stringify(one.report)).not.toContain("reliability");
    expect(one.report.repeat).toBeUndefined();
  });

  it("runs each case N times against the same provider and reports reliability", async () => {
    const p = provider(false);
    const { report } = await runSuite("x", CASE, undefined, p, undefined, {
      repeat: 5,
      now: clock,
    });
    expect(p.calls).toBe(5);
    expect(report.repeat).toBe(5);
    expect(report.scenarios).toHaveLength(1);
    expect(report.scenarios[0]!.reliability).toEqual({
      n: 5,
      sameOutcomeRate: 1,
      recoveredRate: 1,
    });
    expect(report.categories[0]!.reliability).toEqual({
      n: 5,
      scenarios: 1,
      sameOutcomeRate: 1,
      recoveredRate: 1,
    });
  });

  it("a flaky provider lowers both rates, and the table says so", async () => {
    const { report } = await runSuite("x", CASE, undefined, provider(true), undefined, {
      repeat: 4,
      now: clock,
    });
    const r = report.scenarios[0]!.reliability!;
    expect(r.n).toBe(4);
    expect(r.sameOutcomeRate).toBe(0.5);
    expect(r.recoveredRate).toBe(0.5);
    expect(formatReport(report)).toContain("reliability same-outcome 0.50 recovered 0.50 (x4)");
  });

  it("is deterministic with an injected clock: two runs give the same bytes", async () => {
    const run = async () =>
      stringifyReport(
        (await runSuite("x", CASE, undefined, provider(true), undefined, { repeat: 6, now: clock }))
          .report,
      );
    expect(await run()).toBe(await run());
  });

  it("times a real provider's calls with the injected clock, not Date.now", async () => {
    const latency = async (step: number) => {
      const wall = { t: 5_000 };
      const p = provider(false);
      const generate = p.generate.bind(p);
      p.generate = (req) => {
        wall.t += step;
        return generate(req);
      };
      const { report } = await runSuite("x", CASE, undefined, p, undefined, {
        repeat: 2,
        now: () => wall.t,
      });
      return report.scenarios[0]!.metrics.latencyMs;
    };
    // One model call per run: the latency moves by exactly the injected step, so it is virtual
    // time from the injected clock (real elapsed time would not depend on `step` at all).
    expect((await latency(7)) - (await latency(0))).toBe(7);
    expect(await latency(7)).toBe(await latency(7));
  });

  it("the command passes its injected clock down to the provider timing", async () => {
    const latency = async (step: number) => {
      const wall = { t: 9_000 };
      const p = provider(false);
      const generate = p.generate.bind(p);
      p.generate = (req) => {
        wall.t += step;
        return generate(req);
      };
      const latestPath = join(mkdtempSync(join(tmpdir(), "phoenix-eval-")), "latest.json");
      const code = await main(["run", "--repeat", "2"], {
        provider: p,
        now: () => wall.t,
        scenarios: CASE,
        latestPath,
        out: () => undefined,
      });
      expect(code).toBe(0);
      const written = JSON.parse(readFileSync(latestPath, "utf8")) as {
        repeat: number;
        scenarios: { metrics: { latencyMs: number } }[];
      };
      expect(written.repeat).toBe(2);
      return written.scenarios[0]!.metrics.latencyMs;
    };
    expect((await latency(5)) - (await latency(0))).toBe(5);
  });

  it("the offline scripted suite repeats to a stable 1.0 and never touches the golden file", async () => {
    const small = ALL_SCENARIOS.filter((s) => s.category === "benchmark").slice(0, 3);
    const lines: string[] = [];
    const code = await main(["run", "--repeat", "3"], {
      scenarios: small,
      latestPath: null,
      out: (t) => void lines.push(t),
    });
    expect(code).toBe(0);
    expect(lines.join("")).toContain("reliability same-outcome 1.00 recovered 1.00 (x3)");
    const refused = await main(["run", "--repeat", "3", "--update-golden"], {
      scenarios: small,
      latestPath: null,
      out: () => undefined,
    });
    expect(refused).toBe(2);
  });
});
