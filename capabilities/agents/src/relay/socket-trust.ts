// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Whether a hook may connect to a relay socket path. The path can come from the environment
// ($PHOENIX_RELAY_SOCKET, $PHOENIX_DATA_DIR), so a process that controls our environment, or a
// path component another user can replace, must not be able to point a hook (which sends command
// lines and file paths) at a socket it owns. The check is on file metadata only; it is the client
// half of the server's own 0700-directory rule (see server.ts).
import { lstatSync, type Stats } from "node:fs";
import { dirname, isAbsolute } from "node:path";

export type TrustStat = Pick<Stats, "isSocket" | "isSymbolicLink" | "isDirectory" | "uid" | "mode">;

export interface SocketTrustOptions {
  /** Expected owner. Default: process.getuid(). Without any uid (Windows) the check is skipped. */
  uid?: number;
  /** Default: fs.lstatSync. Injected by tests. */
  lstat?: (path: string) => TrustStat;
  platform?: NodeJS.Platform;
}

/** Why `path` must not be connected to, or null when it is trusted. */
export function untrustedSocketReason(
  path: string,
  options: SocketTrustOptions = {},
): string | null {
  if ((options.platform ?? process.platform) === "win32") return null;
  const uid = options.uid ?? process.getuid?.();
  if (uid === undefined) return null;
  const lstat = options.lstat ?? lstatSync;
  if (!isAbsolute(path)) return "the relay socket path is not absolute";

  const stat = (target: string): TrustStat | string => {
    try {
      return lstat(target);
    } catch {
      return `cannot inspect ${target}`;
    }
  };

  const socket = stat(path);
  if (typeof socket === "string") return socket;
  if (socket.isSymbolicLink()) return `${path} is a symlink`;
  if (!socket.isSocket()) return `${path} is not a socket`;
  if (socket.uid !== uid) return `${path} is not owned by the current user`;

  const parentPath = dirname(path);
  const parent = stat(parentPath);
  if (typeof parent === "string") return parent;
  if (parent.isSymbolicLink()) return `${parentPath} is a symlink`;
  if (!parent.isDirectory()) return `${parentPath} is not a directory`;
  if (parent.uid !== uid) return `${parentPath} is not owned by the current user`;
  if ((parent.mode & 0o077) !== 0) return `${parentPath} is accessible to other users`;

  // Further up, a symlink is only acceptable when root or this user made it (/var → /private/var).
  for (let dir = dirname(parentPath); ; dir = dirname(dir)) {
    const ancestor = stat(dir);
    if (typeof ancestor === "string") return ancestor;
    if (ancestor.isSymbolicLink() && ancestor.uid !== 0 && ancestor.uid !== uid) {
      return `${dir} is a symlink made by another user`;
    }
    if (dirname(dir) === dir) return null;
  }
}
