// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The file primitives behind the hook installer's writes. The installer verifies a plan hash and
// then writes; between those two moments another process of the same user can swap the target for
// a symlink, plant something at a predictable temp name, or edit the file. So every write here:
//  - uses a random temp name created O_CREAT|O_EXCL|O_NOFOLLOW (never a name an attacker can guess,
//    never through a link), fsyncs it, and keeps the target's mode;
//  - takes a snapshot of WHERE it writes at plan time and, immediately before the rename, re-checks
//    that the path, its link status and its parent directory still resolve to the same place and
//    that the target still holds exactly the bytes the user confirmed. Otherwise it refuses
//    (StaleFileError) and removes its temp file.
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  futimesSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { InstallError, StaleFileError } from "./errors";

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const DIRECTORY = constants.O_DIRECTORY ?? 0;
const CREATE_NEW = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NOFOLLOW;

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const errno = (err: unknown) => (err as NodeJS.ErrnoException).code;

/** Where a write for `path` goes, as seen when the plan was made. */
export interface TargetSnapshot {
  /** The configured path. */
  readonly path: string;
  /** Where bytes land: the real file behind a symlinked settings file, else `path`. */
  readonly target: string;
  readonly pathIsLink: boolean;
  /** realpath of the target's directory; null while that directory does not exist yet. */
  readonly parentReal: string | null;
}

export function snapshotTarget(path: string): TargetSnapshot {
  let pathIsLink = false;
  let target = path;
  try {
    pathIsLink = lstatSync(path).isSymbolicLink();
    if (pathIsLink) target = realpathSync(path);
  } catch {
    // missing file, or a dangling link: written in place
  }
  let parentReal: string | null = null;
  try {
    parentReal = realpathSync(dirname(target));
  } catch {
    // the directory does not exist yet
  }
  return { path, target, pathIsLink, parentReal };
}

/** Throws StaleFileError when the path no longer resolves to where the plan was made. */
export function assertUnchanged(snap: TargetSnapshot): void {
  const now = snapshotTarget(snap.path);
  const moved =
    now.pathIsLink !== snap.pathIsLink ||
    now.target !== snap.target ||
    (snap.parentReal !== null && now.parentReal !== snap.parentReal);
  if (moved)
    throw new StaleFileError("The file's location changed since the preview. Preview again.");
}

function readCurrent(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch (err) {
    if (errno(err) === "ENOENT") return null;
    throw err;
  }
}

/** Throws StaleFileError unless the target holds exactly `expectSha256` (null: no file). */
function assertContent(target: string, expectSha256: string | null): void {
  const current = readCurrent(target);
  if ((current === null ? null : sha256(current)) !== expectSha256) throw new StaleFileError();
}

export interface AtomicWriteOptions {
  /** Mode for a file that does not exist yet (an existing file keeps its own). Default 0600. */
  newFileMode?: number;
  /** The target must hold exactly these bytes (sha256; null: be absent) at the moment of rename. */
  expectSha256?: string | null;
  /** Set on the temp file before the rename, so the final file never shows another time. */
  mtime?: Date;
}

/** Temp file next to the target, then rename: readers see the old or the new file, never half. */
export function atomicWrite(
  snap: TargetSnapshot,
  bytes: Buffer,
  options: AtomicWriteOptions = {},
): void {
  const dir = dirname(snap.target);
  let temp: string | undefined;
  try {
    mkdirSync(dir, { recursive: true });
    assertUnchanged(snap);
    const existing = lstatOrNull(snap.target);
    const mode = existing ? existing.mode & 0o7777 : (options.newFileMode ?? 0o600);
    temp = join(dir, `.phoenix-${randomBytes(8).toString("hex")}.tmp`);
    const fd = openSync(temp, CREATE_NEW, 0o600);
    try {
      writeFileSync(fd, bytes);
      fchmodSync(fd, mode);
      if (options.mtime) futimesSync(fd, options.mtime, options.mtime);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    assertUnchanged(snap);
    if (options.expectSha256 !== undefined) assertContent(snap.target, options.expectSha256);
    renameSync(temp, snap.target);
    temp = undefined;
  } catch (err) {
    if (temp !== undefined) rmSync(temp, { force: true });
    if (err instanceof StaleFileError) throw err;
    throw new InstallError(
      "io",
      `Could not write ${snap.target}: ${(err as Error).message.slice(0, 120)}`,
    );
  }
}

/** Deletes the target after the same last-moment checks as `atomicWrite`. */
export function removeChecked(snap: TargetSnapshot, expectSha256: string | null): void {
  try {
    assertUnchanged(snap);
    assertContent(snap.target, expectSha256);
    unlinkSync(snap.target);
  } catch (err) {
    if (err instanceof StaleFileError) throw err;
    if (errno(err) === "ENOENT") return;
    throw new InstallError("io", `Could not remove ${snap.target}.`);
  }
}

function lstatOrNull(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** A directory only this user can use: created 0700, never a symlink, owned by the current user. */
export function ensurePrivateDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fd = openSync(dir, constants.O_RDONLY | DIRECTORY | NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      const uid = process.getuid?.();
      if (!stat.isDirectory() || (uid !== undefined && stat.uid !== uid)) {
        throw new InstallError("io", `${dir} is not a directory owned by you.`);
      }
      if ((stat.mode & 0o077) !== 0) fchmodSync(fd, 0o700);
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    if (err instanceof InstallError) throw err;
    throw new InstallError("io", `Could not prepare the backup folder ${dir}.`);
  }
}

/**
 * A content-addressed backup: created exclusively with mode 0600, never through a link. An existing
 * file with the same bytes is the same backup; anything else at that name is replaced (the link or
 * file is unlinked, not followed) and then created exclusively.
 */
export function writeBackupFile(path: string, bytes: Buffer): void {
  const create = () => {
    const fd = openSync(path, CREATE_NEW, 0o600);
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };
  try {
    try {
      create();
    } catch (err) {
      if (errno(err) !== "EEXIST") throw err;
      const found = lstatOrNull(path);
      if (found?.isFile() && readFileSync(path).equals(bytes)) {
        chmodSync(path, 0o600);
        return;
      }
      unlinkSync(path);
      create();
    }
  } catch {
    throw new InstallError("io", `Could not write the backup ${path}.`);
  }
}
