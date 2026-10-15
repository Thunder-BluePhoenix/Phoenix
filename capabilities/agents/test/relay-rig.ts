// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Installer test rig: a temp "home" and a temp backup directory, never the real ones. Nothing in
// the installer tests reads or writes ~/.claude, ~/.codex or any other real agent directory.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";
import {
  adapterContext,
  AGENT_ADAPTERS,
  type AdapterContext,
  type AgentAdapter,
  type JsonAdapter,
  type PluginAdapter,
} from "../src/relay/adapters";
import { HookInstaller } from "../src/relay/installer";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export const jsonAdapters = AGENT_ADAPTERS.filter((a): a is JsonAdapter => a.kind === "json");
export const pluginAdapters = AGENT_ADAPTERS.filter((a): a is PluginAdapter => a.kind === "plugin");

export const adapterById = (id: string): AgentAdapter => AGENT_ADAPTERS.find((a) => a.id === id)!;

export interface Rig {
  home: string;
  backupDir: string;
  ctx: AdapterContext;
  installer: HookInstaller;
  /** The file the adapter writes. */
  path: string;
  adapter: AgentAdapter;
}

/** A temp home where `id` is "detected" (its config directory exists) and its file is `seed`. */
export function rig(id: string, seed: Buffer | string | null = null, mode?: number): Rig {
  const root = mkdtempSync(join(tmpdir(), "phx-inst-"));
  dirs.push(root);
  const home = join(root, "home");
  const backupDir = join(root, "backups");
  mkdirSync(home, { recursive: true });
  const env = { PATH: "" };
  const commands = { root: "/opt/phoenix" };
  const ctx = adapterContext(home, env, "linux", commands);
  const adapter = adapterById(id);
  mkdirSync(adapter.configDir(ctx), { recursive: true });
  const path = adapter.settingsPath(ctx);
  if (seed !== null) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, seed);
    if (mode !== undefined) chmodSync(path, mode);
  }
  const installer = new HookInstaller({ home, env, platform: "linux", backupDir, commands });
  return { home, backupDir, ctx, installer, path, adapter };
}

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "phx-t-"));
  dirs.push(dir);
  return dir;
}
