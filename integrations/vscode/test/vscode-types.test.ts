// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// types/vscode.d.ts is a hand-written subset of the VS Code API (no @types/vscode dependency). This
// checks it still declares every `vscode.<member>` the extension sources reference, so adding a new
// API call without declaring it fails here as well as in `tsc -p integrations/vscode`.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

/** The d.ts text of `declare module "vscode" { ... }` with comments removed. */
function declared(dts: string): { top: Set<string>; namespaces: Map<string, Set<string>> } {
  const text = dts.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const top = new Set<string>();
  const namespaces = new Map<string, Set<string>>();
  for (const m of text.matchAll(/^ {2}export (?:class|interface|enum|namespace) (\w+)/gm)) {
    top.add(m[1]!);
  }
  for (const m of text.matchAll(/^ {2}export namespace (\w+) \{\n([\s\S]*?)\n {2}\}/gm)) {
    const members = new Set<string>();
    for (const n of m[2]!.matchAll(/^ {4}(?:function|const|let|namespace) (\w+)/gm)) {
      members.add(n[1]!);
    }
    namespaces.set(m[1]!, members);
  }
  return { top, namespaces };
}

/** `vscode.a` and `vscode.a.b` references (code and JSDoc types) in the extension's JS. */
function referenced(): Map<string, string[]> {
  const files = [
    "extension.js",
    ...readdirSync(join(root, "src"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => `src/${f}`),
  ];
  const refs = new Map<string, string[]>();
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    for (const m of text.matchAll(/\bvscode\.(\w+)(?:\.(\w+))?/g)) {
      const ref = m[2] ? `${m[1]}.${m[2]}` : m[1]!;
      refs.set(ref, [...(refs.get(ref) ?? []), file]);
    }
  }
  return refs;
}

describe("types/vscode.d.ts", () => {
  const dts = readFileSync(join(root, "types", "vscode.d.ts"), "utf8");

  it("says it is a minimal local subset that can drift", () => {
    expect(dts).toMatch(/MINIMAL LOCAL SUBSET/);
    expect(dts).toMatch(/NOT the official typings/);
    expect(dts).toContain("https://code.visualstudio.com/api/references/vscode-api");
  });

  it("declares every vscode member the extension sources use", () => {
    const { top, namespaces } = declared(dts);
    const refs = referenced();
    expect(refs.size).toBeGreaterThan(10); // the scan itself found the extension's API use
    const missing: string[] = [];
    for (const [ref, files] of refs) {
      const [head, member] = ref.split(".") as [string, string | undefined];
      const ns = namespaces.get(head);
      const ok = ns ? member === undefined || ns.has(member) : top.has(head);
      if (!ok) missing.push(`vscode.${ref} (${[...new Set(files)].join(", ")})`);
    }
    expect(missing).toEqual([]);
  });

  it("detects a missing declaration", () => {
    const without = dts.replace("function registerCommand", "function renamedCommand");
    const { namespaces } = declared(without);
    expect(namespaces.get("commands")?.has("registerCommand")).toBe(false);
    expect(namespaces.get("commands")?.has("renamedCommand")).toBe(true);
  });
});
