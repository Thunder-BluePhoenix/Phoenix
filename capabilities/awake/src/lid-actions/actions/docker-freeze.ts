// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Freeze Docker Desktop's own processes with SIGSTOP while the lid is closed and no container
// runs. OFF by default. Idleness comes from the DockerIdle seam (Phoenix's Docker capability):
// containers running, or the state unknown, means it is NOT frozen. Same identity rules as the
// chat-app freeze (freeze-core.ts), and the same protected list.
import { NotAppliedError } from "../../power/journal";
import { DOCKER_APP } from "../apps";
import type { DockerIdleState, LidAction, LidSeams } from "../types";
import {
  chooseTargets,
  framePlanned,
  freezeNow,
  thawNow,
  withoutAssertionHolders,
  type FreezeScope,
} from "./freeze-core";

export const DOCKER_FREEZE_KIND = "lid.docker_freeze";

export function createDockerFreeze(seams: LidSeams, extra: FreezeScope["extra"]): LidAction {
  const scope: FreezeScope = { apps: [DOCKER_APP], extra };
  return {
    id: "docker_freeze",
    kind: DOCKER_FREEZE_KIND,
    async plan(ctx) {
      if (seams.platform !== "darwin") return ctx.skip("unsupported_platform");
      let idle: DockerIdleState;
      try {
        idle = await seams.dockerIdle();
      } catch {
        idle = "unknown";
      }
      if (idle === "busy") return ctx.skip("docker_busy");
      if (idle !== "idle") return ctx.skip("docker_unknown");
      const table = await ctx.procs();
      if (!table) return ctx.skip("process_list_unavailable");
      const chosen = chooseTargets(seams, scope, table);
      if (chosen.targets.length === 0) return ctx.skip("no_targets");
      const check = await withoutAssertionHolders(seams, scope, chosen.targets);
      if (!check.ok) return ctx.skip(check.reason);
      return framePlanned(check.targets, chosen.keys);
    },
    async apply(planned) {
      // Asked again at the last moment: a container may have started since the plan.
      let idle: DockerIdleState;
      try {
        idle = await seams.dockerIdle();
      } catch {
        idle = "unknown";
      }
      if (idle !== "idle")
        throw new NotAppliedError("containers are running or Docker's state is unknown");
      await freezeNow(seams, scope, planned);
    },
    undo: (undo) => thawNow(seams, undo),
    support: () =>
      Promise.resolve(
        seams.platform === "darwin"
          ? { supported: true }
          : { supported: false, reason: "unsupported_platform" },
      ),
  };
}
