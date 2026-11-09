// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 68 exit criterion: "Portfolio code has no write endpoints (checked by test)". This test
// reads the capability's own source and fails when anything could change an account at a remote
// service. See `scan()`: the mutation-check of it is in test/read-only-scan.test.ts.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scan } from "./scan";

const SRC = join(import.meta.dirname, "..", "src");

/**
 * The one file allowed to POST: the pinned getBalance client. It is NOT skipped silently: it must
 * produce exactly the findings listed in solana.test.ts, and nothing else may mention it as a sender.
 */
const SOLANA_FILE = "solana.ts";

function sources(): { name: string; text: string }[] {
  return readdirSync(SRC)
    .filter((f) => f.endsWith(".ts") && f !== SOLANA_FILE)
    .map((f) => ({ name: f, text: readFileSync(join(SRC, f), "utf8") }));
}

describe("portfolio source is read-only by construction", () => {
  it("has source files to scan", () => {
    expect(sources().map((s) => s.name)).toEqual(
      expect.arrayContaining([
        "client.ts",
        "collect.ts",
        "exchanges.ts",
        "index.ts",
        "networks.ts",
        "prices.ts",
      ]),
    );
  });

  it("contains no write method, no ServiceClient and no money-moving verb", () => {
    const problems = sources().flatMap((s) => scan(s.name, s.text));
    expect(problems).toEqual([]);
  });
});
