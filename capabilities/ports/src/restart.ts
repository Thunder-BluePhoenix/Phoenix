// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `restart_process`: stop a listening dev process through the guarded stop path, then start the
// owner's matching restart recipe. The rules, each pinned by a test:
//   - what is started comes ONLY from the owner's config (`recipes.ts`); nothing is read back from
//     `ps` or `lsof` and nothing the process says about itself reaches a command line;
//   - the recipe is found by a port the owner declared for it, and the caller must present the
//     recipe name, argv and folder exactly as the radar showed them (they are in the approval
//     prompt); a config that changed since is `changed`, nothing happens;
//   - the process is stopped by `Stopper.stop` (SIGTERM only, same identity proof and stop rules as
//     `stop_process`): a protected, system, other-user or Core-related process is refused before
//     anything is signalled or started; there is no SIGKILL in a restart;
//   - the executable and folder are checked BEFORE the stop and again right before the start, so a
//     recipe that cannot start never stops the program;
//   - if the program does not exit after SIGTERM nothing is started (its port is still in use) and
//     the answer says so; if the start fails after the stop, the error says the program WAS stopped;
//   - the new process is argv-only, detached, with a minimal environment and a checked folder.
import { renderArgv, resolvePlan, restartEnv, type RecipeTable } from "./recipes";
import type { Stopper, StopTarget } from "./stop";
import { PortsError, type PortsEnv } from "./types";

export interface RestartTarget extends StopTarget {
  recipe: string;
  /** `renderArgv(recipe.argv)` exactly as shown in the approval prompt. */
  argv: string;
  cwd: string;
}

export interface RestartResult {
  /** The pid that was stopped. */
  pid: number;
  port: number;
  /** Executable file name only. */
  name: string;
  recipe: string;
  /** Whether the old process was gone when the wait ended. */
  exited: boolean;
  /** True when the recipe was started (the new process may still fail to listen). */
  started: boolean;
  /** The new process's pid; null when nothing was started. */
  new_pid: number | null;
  /** True when SIGTERM did not end the process, so nothing was started and `force_stop` is the next explicit step. */
  can_force: boolean;
}

export interface Restarter {
  restart(
    target: RestartTarget,
    recipes: RecipeTable,
    roots: readonly string[],
    signal: AbortSignal,
  ): Promise<RestartResult>;
}

const fileName = (command: string): string => command.slice(command.lastIndexOf("/") + 1);

/**
 * `onFinished` is told about every restart that stopped or tried to stop the program, with
 * `spawnFailed` true when the old process is gone but the new one did not start, so the capability
 * can announce it; the same failure is also thrown to the caller.
 */
export function createRestarter(
  env: PortsEnv,
  stopper: Stopper,
  onFinished: (r: RestartResult, spawnFailed: boolean) => void,
): Restarter {
  return {
    async restart(target, recipes, roots, signal) {
      const recipe = recipes[target.recipe];
      if (recipe === undefined) {
        throw new PortsError("refused", "There is no usable restart recipe with that name.");
      }
      if (!recipe.ports.includes(target.port)) {
        throw new PortsError("refused", "That recipe is not declared for this port.");
      }
      if (renderArgv(recipe.argv) !== target.argv || recipe.cwd !== target.cwd) {
        throw new PortsError(
          "changed",
          "The restart recipe is no longer what the radar showed. Refresh and look again.",
        );
      }
      // Nothing is stopped for a recipe that cannot be started right now.
      await resolvePlan(env, recipe, roots);

      const stopped = await stopper.stop(
        {
          pid: target.pid,
          port: target.port,
          start: target.start,
          command: target.command,
          uid: target.uid,
        },
        signal,
      );
      const result: RestartResult = {
        pid: target.pid,
        port: target.port,
        name: fileName(target.command),
        recipe: target.recipe,
        exited: stopped.exited,
        started: false,
        new_pid: null,
        can_force: stopped.can_force,
      };
      if (!stopped.exited) {
        onFinished(result, false);
        return result;
      }
      try {
        // The files may have changed while the program shut down.
        const plan = await resolvePlan(env, recipe, roots);
        const { pid } = await env.spawn({
          file: plan.file,
          args: plan.args,
          cwd: plan.cwd,
          env: restartEnv(env.environ),
        });
        const done: RestartResult = { ...result, started: true, new_pid: pid, can_force: false };
        onFinished(done, false);
        return done;
      } catch (err) {
        onFinished(result, true);
        throw new PortsError(
          "spawn_failed",
          `The program was stopped, but the recipe could not be started${
            err instanceof PortsError ? `: ${err.message}` : ""
          }. The program is no longer running.`,
        );
      }
    },
  };
}
