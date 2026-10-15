// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `phoenix-agent install|uninstall|repair|status|self-test` (Phase 57). The installer commands
// follow the same two steps as Settings > Agents: without --yes they only PRINT the unified diff
// and write nothing; with --yes the diff is printed and then applied, and the apply is refused if
// the file changed in between.
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  HookInstaller,
  InstallError,
  StaleFileError,
  type InstallAction,
  type InstallerOptions,
} from "./relay/installer";
import { defaultDataDir } from "./relay/protocol";
import { runSelfTest } from "./relay/self-test";

export const RELAY_COMMANDS = ["install", "uninstall", "repair", "status", "self-test"] as const;

export const RELAY_USAGE = `  phoenix-agent status
                       list the agents found on this computer and whether Phoenix's hooks are installed
  phoenix-agent install|repair|uninstall <agent> [--yes]
                       print the exact change (unified diff); with --yes apply it after a backup
  phoenix-agent self-test
                       ask Core, through the local relay, whether it answers (prints the relay version)`;

export interface RelayCliIo {
  out(text: string): void;
  err(text: string): void;
}

export interface RelayCliEnv {
  /** Installer for tests; default: the real home directory and ~/.phoenix/<env>/agent-backups. */
  installer?: HookInstaller;
  installerOptions?: Partial<InstallerOptions>;
  env?: Record<string, string | undefined>;
  socketPath?: string;
}

function defaultInstaller(
  env: Record<string, string | undefined>,
  overrides: Partial<InstallerOptions>,
) {
  return new HookInstaller({
    home: homedir(),
    env,
    backupDir: join(defaultDataDir(env), "agent-backups"),
    ...overrides,
  });
}

export async function runRelayCommand(
  sub: string,
  rest: string[],
  io: RelayCliIo,
  context: RelayCliEnv = {},
): Promise<number> {
  const env = context.env ?? process.env;
  if (sub === "self-test") {
    const result = await runSelfTest(context.socketPath ? { socketPath: context.socketPath } : {});
    io.out(`${result.pass ? "PASS" : "FAIL"}: ${result.message}\n`);
    return result.pass ? 0 : 1;
  }

  const installer = context.installer ?? defaultInstaller(env, context.installerOptions ?? {});
  if (sub === "status") {
    for (const a of installer.list()) {
      const found = a.detected ? "detected" : "not found";
      const state =
        a.state === "unsupported"
          ? `unsupported (${a.reason ?? "format unconfirmed"})`
          : a.state === "needs_repair"
            ? `needs repair, missing: ${a.missing.join(", ")}`
            : a.state.replace("_", " ");
      io.out(`${a.id.padEnd(15)} ${found.padEnd(10)} ${state}\n`);
    }
    return 0;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { yes: { type: "boolean" } },
    });
  } catch (err) {
    io.err(`${(err as Error).message}\n`);
    return 2;
  }
  const agent = parsed.positionals[0];
  if (!agent || parsed.positionals.length > 1) {
    io.err(`phoenix-agent ${sub}: name exactly one agent (see \`phoenix-agent status\`)\n`);
    return 2;
  }
  const action = sub as InstallAction;
  try {
    const preview = installer.preview(action, agent);
    io.out(`${preview.path}\n`);
    for (const note of preview.notes) io.out(`# ${note}\n`);
    if (preview.diff) io.out(preview.diff.endsWith("\n") ? preview.diff : preview.diff + "\n");
    if (!preview.changed) return 0;
    if (!parsed.values.yes) {
      io.out(`Nothing was written. Run again with --yes to apply this change.\n`);
      return 0;
    }
    const applied = installer.apply(action, agent, preview.hash);
    io.out(`${applied.summary}${applied.kept_user_edits ? " Your later edits were kept." : ""}\n`);
    return 0;
  } catch (err) {
    if (err instanceof StaleFileError || err instanceof InstallError) {
      io.err(`phoenix-agent ${sub}: ${err.message}\n`);
      return err instanceof InstallError && err.code === "nothing_to_do" ? 0 : 1;
    }
    throw err;
  }
}
