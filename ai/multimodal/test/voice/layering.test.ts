// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The voice package reaches the play-request router only through its declared workspace dependency,
// never by a relative path into another package (that bypasses the package boundary and build graph).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("voice intent layering", () => {
  it("imports routePlayRequest from the package, not by a relative path out of ai/multimodal", () => {
    const source = read("../../src/voice/intent.ts");
    expect(source).toContain('from "@phoenix/capability-youtube-music"');
    expect(source).not.toMatch(/from\s+["'](?:\.\.\/){3,}/);
  });

  it("declares the workspace dependency it imports", () => {
    const pkg = JSON.parse(read("../../package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@phoenix/capability-youtube-music"]).toBe("workspace:*");
    expect(read("../../../../pnpm-lock.yaml")).toMatch(
      /ai\/multimodal:\n(?: {4,}.*\n)*? {6}'@phoenix\/capability-youtube-music':\n {8}specifier: workspace:\*\n {8}version: link:\.\.\/\.\.\/capabilities\/youtube-music/,
    );
  });
});
