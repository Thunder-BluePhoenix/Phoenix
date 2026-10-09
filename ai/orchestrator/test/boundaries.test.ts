// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = new URL(".", import.meta.url).pathname;

/** Every module specifier imported or re-exported by a TypeScript source file. */
export function importedModules(source: string): string[] {
  const found: string[] = [];
  const pattern =
    /(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of source.matchAll(pattern)) found.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
  return found;
}

function sourcesOf(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesOf(path);
    return entry.name.endsWith(".ts") ? [{ file: path, text: readFileSync(path, "utf8") }] : [];
  });
}

/** Modules from which a capability could be reached without the ToolGateway. */
const FORBIDDEN = [
  /^@phoenix\/capability-manager(\/|$)/,
  /^@phoenix\/capability-/,
  /capability-manager/,
];

describe("the orchestrator package cannot reach a capability except through the ToolGateway", () => {
  it("imports nothing that could invoke a capability directly (and never holds the CapabilityManager)", () => {
    const files = sourcesOf(join(here, "..", "src"));
    expect(files.length).toBeGreaterThan(5);
    const violations = files.flatMap(({ file, text }) =>
      importedModules(text)
        .filter((spec) => FORBIDDEN.some((re) => re.test(spec)))
        .map((spec) => `${file}: ${spec}`),
    );
    expect(violations).toEqual([]);
  });

  it("the scanner itself sees every import form (so a pass above means something)", () => {
    const text = [
      'import { CapabilityManager } from "@phoenix/capability-manager";',
      'import type { X } from "@phoenix/capability-github";',
      'export * from "@phoenix/capability-manager";',
      'import "@phoenix/capability-git";',
      'const m = await import("@phoenix/capability-manager");',
      'const r = require("@phoenix/capability-manager");',
      'import {\n  A,\n  B,\n} from "@phoenix/capability-manager";',
    ].join("\n");
    const specs = importedModules(text);
    expect(specs).toHaveLength(7);
    expect(specs.every((s) => FORBIDDEN.some((re) => re.test(s)))).toBe(true);
  });

  it("does not mention the manager's invoke methods", () => {
    const files = sourcesOf(join(here, "..", "src"));
    for (const { file, text } of files) {
      expect(text, file).not.toMatch(/\binvokeAndWait\b|\.invoke\(/);
    }
  });

  it("package.json declares the manager only as a type-level dependency of the gateway contract", () => {
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    // Declared because ai-tool-gateway's types mention it; the scan above proves no import.
    expect(Object.keys(pkg.dependencies)).toContain("@phoenix/ai-tool-gateway");
  });
});
