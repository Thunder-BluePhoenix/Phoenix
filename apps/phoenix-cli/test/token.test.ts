// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsageError } from "../src/errors";
import { resolveSessionToken, type TokenSources } from "../src/token";

let root: string;

const write = (dir: string, value: string, mode = 0o600): string => {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "session.token");
  writeFileSync(file, value, { mode });
  chmodSync(file, mode);
  return file;
};

const sources = (over: Partial<TokenSources> = {}): TokenSources => ({
  env: {},
  cwd: join(root, "cwd"),
  home: join(root, "home"),
  platform: "linux",
  ...over,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "phoenix-cli-token-"));
  mkdirSync(join(root, "cwd"), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("resolveSessionToken", () => {
  it("prefers PHOENIX_SESSION_TOKEN over any file", () => {
    write(join(root, "home", ".phoenix", "dev"), "from-file\n");
    const t = resolveSessionToken(sources({ env: { PHOENIX_SESSION_TOKEN: " from-env " } }));
    expect(t).toEqual({ value: "from-env", origin: "PHOENIX_SESSION_TOKEN" });
  });

  it("reads the trailing newline Core writes off the end", () => {
    write(join(root, "data"), "abc123\n");
    expect(resolveSessionToken(sources({ dataDir: join(root, "data") })).value).toBe("abc123");
  });

  it("looks in --data-dir, then PHOENIX_DATA_DIR, then ./.phoenix/<env>, then ~/.phoenix/<env>", () => {
    write(join(root, "home", ".phoenix", "dev"), "home\n");
    expect(resolveSessionToken(sources()).value).toBe("home");
    write(join(root, "cwd", ".phoenix", "dev"), "cwd\n");
    expect(resolveSessionToken(sources()).value).toBe("cwd");
    write(join(root, "envdir"), "envdir\n");
    expect(
      resolveSessionToken(sources({ env: { PHOENIX_DATA_DIR: join(root, "envdir") } })).value,
    ).toBe("envdir");
    write(join(root, "flag"), "flag\n");
    expect(
      resolveSessionToken(
        sources({ env: { PHOENIX_DATA_DIR: join(root, "envdir") }, dataDir: join(root, "flag") }),
      ).value,
    ).toBe("flag");
  });

  it("follows PHOENIX_ENV to the matching directory", () => {
    write(join(root, "home", ".phoenix", "dev"), "dev\n");
    write(join(root, "home", ".phoenix", "prod"), "prod\n");
    expect(resolveSessionToken(sources({ env: { PHOENIX_ENV: "prod" } })).value).toBe("prod");
    expect(() => resolveSessionToken(sources({ env: { PHOENIX_ENV: "../x" } }))).toThrow(
      UsageError,
    );
  });

  it("names every place it looked when there is no token, and says Core may not be running", () => {
    expect(() => resolveSessionToken(sources())).toThrow(/Is Phoenix Core running\?/);
    expect(() => resolveSessionToken(sources())).toThrow(/session\.token/);
  });

  it("treats an empty token file as unusable without leaking anything", () => {
    write(join(root, "data"), "\n");
    expect(() => resolveSessionToken(sources({ dataDir: join(root, "data") }))).toThrow(/is empty/);
  });

  it("warns, naming the file but not the token, when other users can read it", () => {
    write(join(root, "data"), "secret-value-123\n", 0o644);
    const t = resolveSessionToken(sources({ dataDir: join(root, "data") }));
    expect(t.warning).toContain("session.token");
    expect(t.warning).toContain("chmod 600");
    expect(t.warning).not.toContain("secret-value-123");
    write(join(root, "ok"), "x-value-123456\n", 0o600);
    expect(resolveSessionToken(sources({ dataDir: join(root, "ok") })).warning).toBeUndefined();
  });
});
