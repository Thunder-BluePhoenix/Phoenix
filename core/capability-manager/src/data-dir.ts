// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { chmodSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/** The manifest schema's id rule; re-checked here because the id becomes a path component. */
const CAPABILITY_ID = /^[a-z][a-z0-9_-]{1,63}$/;
const DIR_MODE = 0o700;

/** The folder name under the Core data dir that holds every capability's own directory. */
export const CAPABILITY_DATA_FOLDER = "capabilities";

/** Throws unless `coreDataDir` is an absolute path (a relative one would follow the working directory). */
export function assertCoreDataDir(coreDataDir: string): void {
  if (typeof coreDataDir !== "string" || !isAbsolute(coreDataDir)) {
    throw new Error("the Core data directory must be an absolute path");
  }
}

/**
 * Where a built-in capability's private directory lives: `<coreDataDir>/capabilities/<id>`.
 * Pure: touches nothing. Throws for a relative Core dir or an id that is not a plain capability id.
 */
export function capabilityDataPath(coreDataDir: string, id: string): string {
  assertCoreDataDir(coreDataDir);
  if (!CAPABILITY_ID.test(id)) throw new Error("not a valid capability id");
  return join(coreDataDir, CAPABILITY_DATA_FOLDER, id);
}

/** One folder below the Core dir: a real directory (not a link), ours, closed to everyone else. */
function privateFolder(path: string): void {
  mkdirSync(path, { recursive: true, mode: DIR_MODE });
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("a capability data directory path component is not a plain directory");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error("a capability data directory path component is owned by someone else");
  }
  chmodSync(path, DIR_MODE);
}

/**
 * Makes `<coreDataDir>/capabilities/<id>` exist (mode 0700) and returns its path. Refuses, by
 * throwing, when `capabilities` or `<id>` is a symbolic link, is not a directory, belongs to
 * another user, or resolves anywhere but directly below the Core dir: a capability can never be
 * handed a directory outside the one Core owns for it. Idempotent. Never reads user input: `id`
 * is a registered manifest id and `coreDataDir` is Core's own configuration.
 */
export function ensureCapabilityDataDir(coreDataDir: string, id: string): string {
  const path = capabilityDataPath(coreDataDir, id);
  mkdirSync(coreDataDir, { recursive: true });
  privateFolder(join(coreDataDir, CAPABILITY_DATA_FOLDER));
  privateFolder(path);
  const expected = join(realpathSync(coreDataDir), CAPABILITY_DATA_FOLDER, id);
  if (realpathSync(path) !== expected) {
    throw new Error("the capability data directory resolves outside the Core data directory");
  }
  return path;
}
