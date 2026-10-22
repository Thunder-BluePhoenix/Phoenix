// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Which project a process belongs to: the nearest ancestor of its working directory that holds a
// `.git`. Only the folder NAME leaves the capability; the path stays here.
import { posix } from "node:path";
import type { PortsFs } from "./types";

const MAX_DEPTH = 40;

export interface ProjectRoot {
  /** Absolute path of the repository root. Never sent to the web. */
  root: string;
  /** The repository's folder name: the only thing the web sees. */
  name: string;
}

/**
 * Walks up from `cwd` looking for `.git`. The user's home directory itself never counts as a
 * project (a dotfiles repo there would claim every process), and neither does `/`. A cwd that is
 * not an absolute path, or has no repository above it, is "no project".
 */
export async function findProject(
  cwd: string | undefined,
  home: string,
  fs: PortsFs,
): Promise<ProjectRoot | undefined> {
  if (cwd === undefined || !cwd.startsWith("/")) return undefined;
  let dir = posix.normalize(cwd);
  const stop = posix.normalize(home);
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (dir === "/" || dir === stop) return undefined;
    if (await fs.exists(posix.join(dir, ".git"))) {
      const name = posix.basename(dir);
      return name === "" ? undefined : { root: dir, name };
    }
    const parent = posix.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}
