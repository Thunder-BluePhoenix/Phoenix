// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The client-side socket verifier, driven by injected lstat results (no real files, no sockets).
import { describe, expect, it } from "vitest";
import { untrustedSocketReason, type TrustStat } from "../src/relay/socket-trust";

const ME = 501;
type Kind = "socket" | "dir" | "link" | "file";
const entry = (kind: Kind, uid = ME, mode = 0o700): TrustStat => ({
  isSocket: () => kind === "socket",
  isDirectory: () => kind === "dir",
  isSymbolicLink: () => kind === "link",
  uid,
  mode,
});

/** A filesystem of `/d` (relay dir), `/d/relay.sock`, and plain ancestors, with overrides. */
function check(overrides: Record<string, TrustStat | "missing"> = {}, path = "/d/relay.sock") {
  const table: Record<string, TrustStat | "missing"> = {
    "/d/relay.sock": entry("socket", ME, 0o600),
    "/d": entry("dir"),
    "/": entry("dir", 0, 0o755),
    ...overrides,
  };
  return untrustedSocketReason(path, {
    uid: ME,
    platform: "linux",
    lstat: (p) => {
      const found = table[p] ?? entry("dir", 0, 0o755);
      if (found === "missing") throw new Error("ENOENT");
      return found;
    },
  });
}

describe("untrustedSocketReason", () => {
  it("trusts an owned socket in an owned 0700 directory", () => {
    expect(check()).toBeNull();
  });

  it("refuses a missing path, a non-absolute path, a symlink and a regular file", () => {
    expect(check({ "/d/relay.sock": "missing" })).toMatch(/cannot inspect/);
    expect(untrustedSocketReason("relay.sock", { uid: ME, platform: "linux" })).toMatch(/absolute/);
    expect(check({ "/d/relay.sock": entry("link") })).toMatch(/symlink/);
    expect(check({ "/d/relay.sock": entry("file") })).toMatch(/not a socket/);
  });

  it("refuses a socket owned by someone else", () => {
    expect(check({ "/d/relay.sock": entry("socket", 0, 0o600) })).toMatch(/not owned/);
  });

  it("refuses a parent that is not owned, is a link, or is group/world accessible", () => {
    expect(check({ "/d": entry("dir", 0, 0o700) })).toMatch(/not owned/);
    expect(check({ "/d": entry("link") })).toMatch(/symlink/);
    expect(check({ "/d": entry("dir", ME, 0o750) })).toMatch(/accessible to other users/);
    expect(check({ "/d": entry("dir", ME, 0o707) })).toMatch(/accessible to other users/);
  });

  it("refuses a symlink further up made by another user, but allows root's or ours", () => {
    const deep = "/a/b/relay.sock";
    const base = { "/a/b": entry("dir"), "/a/b/relay.sock": entry("socket", ME, 0o600) };
    expect(check({ ...base, "/a": entry("link", 999) }, deep)).toMatch(/another user/);
    expect(check({ ...base, "/a": entry("link", 0) }, deep)).toBeNull();
    expect(check({ ...base, "/a": entry("link", ME) }, deep)).toBeNull();
  });

  it("is skipped where there is no uid (Windows named pipes)", () => {
    expect(untrustedSocketReason("\\\\.\\pipe\\x", { platform: "win32" })).toBeNull();
  });
});
