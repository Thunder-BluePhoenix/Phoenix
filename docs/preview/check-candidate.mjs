// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// Inspect local artifacts; never signs, publishes, or treats inspection as a release gate.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error(
    "Usage: node docs/preview/check-candidate.mjs <locally-built-desktop-bundle> [sdk-tarball]",
  );
  process.exitCode = 2;
} else {
  const bundleRoot = resolve(root, "apps/desktop/src-tauri/target/release/bundle");
  const first = relative(bundleRoot, resolve(paths[0]));
  if (first === "" || first === ".." || first.startsWith("../") || paths[0].endsWith(".tgz")) {
    console.error(
      "First argument must be a locally built desktop release installer under target/release/bundle/",
    );
    process.exit(2);
  }
  for (const input of paths) {
    const file = resolve(input);
    const location = relative(root, file);
    if (location === "" || location === ".." || location.startsWith("../")) {
      console.error(`Outside checkout, refusing candidate: ${input}`);
      process.exitCode = 2;
      continue;
    }
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size === 0) throw new Error("not a nonempty file");
      const suffix = extname(file);
      if (
        (input === paths[0] &&
          ![".dmg", ".deb", ".rpm", ".AppImage", ".msi", ".exe"].includes(suffix)) ||
        (input !== paths[0] && !input.endsWith(".tgz"))
      ) {
        throw new Error("not a recognized desktop installer or SDK .tgz archive");
      }
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      console.log(`${hash.digest("hex")}  ${relative(root, file)}  ${info.size} bytes`);
    } catch (error) {
      console.error(`Unavailable candidate ${input}: ${error.message}`);
      process.exitCode = 1;
    }
  }
  console.log(
    "Inspection only: review platform install/rollback, matching source, GPL notices, code-signing and owner approval separately.",
  );
}
