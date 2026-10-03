// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Fails if a source file is missing the GPL SPDX header.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".rs"];
const IGNORE_DIRS = new Set(["node_modules", "dist", ".git", "coverage", "target"]);
const HEADER = "SPDX-License-Identifier: GPL-3.0-or-later";

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (EXTENSIONS.some((ext) => name.endsWith(ext))) yield path;
  }
}

const missing = [];
for (const file of walk(ROOT)) {
  const head = readFileSync(file, "utf8").split("\n").slice(0, 5).join("\n");
  if (!head.includes(HEADER)) missing.push(relative(ROOT, file));
}

if (missing.length > 0) {
  console.error(`Missing "${HEADER}" header in:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}
console.log("License headers OK");
