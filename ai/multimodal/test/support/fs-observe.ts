// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Filesystem observation for the real-run measurements: list the directories in which the code under
// test (or the tools it starts) could leave a file, before and after, and diff them. A copy of the
// helper in `real-dictation.test.ts` (that file registers tests when imported, so it cannot be
// imported); the logic and the flag rule are the same: a new regular file whose first bytes are
// `RIFF`, or whose size is within 10% of the audio size, is flagged.
import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const WAV_NEAR_FRACTION = 0.1;

export interface FsEntry {
  size: number;
  mtimeMs: number;
  kind: "file" | "dir" | "other";
}
export type Listing = Map<string, FsEntry>;
export interface Root {
  label: string;
  path: string;
  depth: number;
}

async function walk(dir: string, depth: number, out: Listing): Promise<void> {
  let names: Dirent[];
  try {
    names = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (let i = 0; i < names.length; i += 256) {
    const batch = names.slice(i, i + 256);
    const stats = await Promise.all(
      batch.map((d) => lstat(join(dir, d.name)).catch(() => undefined)),
    );
    for (let k = 0; k < batch.length; k++) {
      const s = stats[k];
      if (!s) continue;
      const path = join(dir, batch[k]!.name);
      const kind = s.isDirectory() ? "dir" : s.isFile() ? "file" : "other";
      out.set(path, { size: s.size, mtimeMs: s.mtimeMs, kind });
    }
  }
  if (depth > 1) {
    for (const d of names) {
      if (d.isDirectory()) await walk(join(dir, d.name), depth - 1, out);
    }
  }
}

/** Every directory in which this code (or the tools it starts) could put a file. */
export async function watchedRoots(): Promise<Root[]> {
  const candidates: Root[] = [
    { label: "os.tmpdir()", path: tmpdir(), depth: 1 },
    { label: "/tmp", path: "/tmp", depth: 1 },
    { label: "/var/tmp", path: "/var/tmp", depth: 1 },
    { label: "process.cwd()", path: process.cwd(), depth: 1 },
    { label: "<repo>/.phoenix (dev data dir)", path: join(process.cwd(), ".phoenix"), depth: 4 },
    { label: "~/.phoenix (default data dir)", path: join(homedir(), ".phoenix"), depth: 4 },
    {
      label: "~/Library/Application Support/dev.phoenix.desktop",
      path: join(homedir(), "Library", "Application Support", "dev.phoenix.desktop"),
      depth: 3,
    },
  ];
  if (process.env.PHOENIX_DATA_DIR) {
    candidates.push({ label: "$PHOENIX_DATA_DIR", path: process.env.PHOENIX_DATA_DIR, depth: 4 });
  }
  const seen = new Set<string>();
  const roots: Root[] = [];
  for (const c of candidates) {
    const key = (await realpath(c.path).catch(() => c.path)) + `#${c.depth}`;
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(c);
  }
  return roots;
}

export type Snapshot = {
  at: string;
  roots: { root: Root; present: boolean; entries: Listing }[];
};

export async function snapshot(roots: Root[]): Promise<Snapshot> {
  const out: Snapshot = { at: new Date().toISOString(), roots: [] };
  for (const root of roots) {
    const entries: Listing = new Map();
    const present = await stat(root.path).then(
      () => true,
      () => false,
    );
    if (present) await walk(root.path, root.depth, entries);
    out.roots.push({ root, present, entries });
  }
  return out;
}

export interface ObservedFile {
  root: string;
  path: string;
  kind: string;
  size: number;
  mtime: string;
  growth?: number;
  riff?: boolean;
  nearAudioSize?: boolean;
}

async function startsWithRiff(path: string): Promise<boolean> {
  try {
    const fh = await open(path, "r");
    try {
      const head = Buffer.alloc(12);
      const { bytesRead } = await fh.read(head, 0, 12, 0);
      return bytesRead >= 12 && head.toString("ascii", 0, 4) === "RIFF";
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

const near = (n: number, audioBytes: number) =>
  audioBytes > 0 && Math.abs(n - audioBytes) <= audioBytes * WAV_NEAR_FRACTION;

export interface FsDiff {
  before: string;
  after: string;
  counts: { root: string; before: number; after: number; present: boolean }[];
  created: ObservedFile[];
  changed: ObservedFile[];
  removed: number;
  flagged: ObservedFile[];
}

export async function diffSnapshots(
  before: Snapshot,
  after: Snapshot,
  audioBytes: number,
): Promise<FsDiff> {
  const created: ObservedFile[] = [];
  const changed: ObservedFile[] = [];
  const counts: FsDiff["counts"] = [];
  let removed = 0;
  const describe = (root: string, path: string, e: FsEntry, growth?: number): ObservedFile => ({
    root,
    path,
    kind: e.kind,
    size: e.size,
    mtime: new Date(e.mtimeMs).toISOString(),
    ...(growth === undefined ? {} : { growth }),
  });
  for (let i = 0; i < after.roots.length; i++) {
    const a = after.roots[i]!;
    const b = before.roots[i]!;
    counts.push({
      root: a.root.label,
      before: b.entries.size,
      after: a.entries.size,
      present: a.present,
    });
    for (const key of b.entries.keys()) if (!a.entries.has(key)) removed++;
    for (const [path, e] of a.entries) {
      const was = b.entries.get(path);
      if (!was) {
        created.push(describe(a.root.label, path, e));
        if (e.kind === "dir") {
          const inner: Listing = new Map();
          await walk(path, 3, inner);
          for (const [p, ie] of inner) created.push(describe(a.root.label, p, ie));
        }
      } else if (e.kind === "file" && (e.size !== was.size || e.mtimeMs !== was.mtimeMs)) {
        changed.push(describe(a.root.label, path, e, e.size - was.size));
      }
    }
  }
  const flagged: ObservedFile[] = [];
  for (const f of created) {
    if (f.kind !== "file") continue;
    f.riff = await startsWithRiff(f.path);
    f.nearAudioSize = near(f.size, audioBytes);
    if (f.riff || f.nearAudioSize) flagged.push(f);
  }
  for (const f of changed) {
    f.riff = await startsWithRiff(f.path);
    f.nearAudioSize = near(f.growth ?? 0, audioBytes);
    if (f.nearAudioSize) flagged.push(f);
  }
  return { before: before.at, after: after.at, counts, created, changed, removed, flagged };
}

/** execFile as a promise (stdout), for `say`, `afconvert`, `sw_vers`, `brew`. */
export function run(file: string, args: string[], timeoutMs = 60_000): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(file, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, out, errOut) =>
    err ? reject(new Error(`${file}: ${err.message} ${errOut}`)) : resolve(out),
  );
  return promise;
}
