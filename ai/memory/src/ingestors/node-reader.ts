// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { GIT_LOG_FORMAT, parseGitLog, type CommitRecord } from "./git";
import type { DocReader } from "./docs";

const run = promisify(execFile);

/** Reads docs from the local filesystem. Only called for paths the user listed. */
export const nodeDocReader: DocReader = {
  async stat(path) {
    try {
      const s = await stat(path);
      return s.isFile() ? { size: s.size, modifiedAt: s.mtime.toISOString() } : null;
    } catch {
      return null;
    }
  },
  read: (path) => readFile(path, "utf8"),
};

/**
 * Reads the most recent commits of a repository with a read-only `git log`.
 * `repository` is the name stored in memory (the git capability uses the folder name).
 */
export async function readGitLog(
  repoPath: string,
  repository: string,
  limit: number,
): Promise<CommitRecord[]> {
  const { stdout } = await run(
    "git",
    ["-C", repoPath, "log", `--max-count=${limit}`, GIT_LOG_FORMAT],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return parseGitLog(repository, stdout);
}
