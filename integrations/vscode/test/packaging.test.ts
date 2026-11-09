// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The fields `vsce package` needs, and the .vscodeignore that decides what ships. This does not run
// vsce (it needs the network); it checks the inputs and that the icon is a real 128x128 PNG.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<
  string,
  unknown
>;
const ignore = readFileSync(join(root, ".vscodeignore"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

describe("manifest for vsce", () => {
  it("has the fields vsce and the Marketplace need", () => {
    expect(manifest.license).toBe("GPL-3.0-or-later");
    expect(manifest.repository).toMatchObject({ type: "git" });
    expect((manifest.repository as { url: string }).url).toMatch(/^https:\/\/github\.com\//);
    expect(manifest.categories).toEqual(["Other"]);
    expect((manifest.engines as { vscode: string }).vscode).toMatch(/^\^1\.\d+\.\d+$/);
    expect(manifest.icon).toBe("media/icon.png");
    expect(manifest.publisher).toBeTruthy();
    expect(manifest.main).toBe("./extension.js");
  });

  it("packages with npx vsce and does not depend on it", () => {
    const scripts = manifest.scripts as Record<string, string>;
    expect(scripts["package:vsix"]).toBe("npx --yes @vscode/vsce package");
    expect(JSON.stringify(manifest)).not.toMatch(/"(dev)?[dD]ependencies"/);
  });

  it("points at an icon that is a 128x128 PNG", () => {
    const png = readFileSync(join(root, manifest.icon as string));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(128);
    expect(png.readUInt32BE(20)).toBe(128);
  });

  it("ships a README and the licence text", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    expect(readme).toMatch(/What it never sends/);
    expect(readme).toMatch(/GPL-3\.0-or-later/);
    expect(readFileSync(join(root, "LICENSE"), "utf8")).toMatch(/GNU GENERAL PUBLIC LICENSE/);
  });
});

describe(".vscodeignore", () => {
  it.each([
    "test/**",
    "scripts/**",
    "**/*.test.*",
    "**/*.map",
    "**/*.ts",
    "*.vsix",
    "node_modules/**",
  ])("excludes %s", (pattern) => {
    expect(ignore).toContain(pattern);
  });

  it("does not exclude what the extension needs at runtime", () => {
    for (const needed of [
      "extension.js",
      "src/**",
      "media/**",
      "README.md",
      "LICENSE",
      "package.json",
    ]) {
      expect(ignore).not.toContain(needed);
    }
  });
});
