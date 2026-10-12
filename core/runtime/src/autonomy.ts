// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { AutonomyApi, AutonomySettingView } from "@phoenix/api";
import {
  AutonomyController,
  AUTONOMY_LEVELS,
  ENVIRONMENTS,
  PolicyError,
  type AutonomyLevel,
  type AutonomySetting,
  type Environment,
} from "@phoenix/policy";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

const OWNER = { kind: "user", id: "owner", trustedByUser: true } as const;

function policyOperation<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (!(error instanceof PolicyError)) throw error;
    const code =
      error.code === "NOT_USER_ACTOR"
        ? ErrorCode.PERMISSION_DENIED
        : error.code === "INVALID_REQUEST"
          ? ErrorCode.INVALID_REQUEST
          : ErrorCode.INTERNAL_ERROR;
    throw new PhoenixError(
      code,
      code === ErrorCode.INTERNAL_ERROR ? undefined : error.message,
      code === ErrorCode.INTERNAL_ERROR ? [] : error.details,
    );
  }
}

function settingView(setting: AutonomySetting): AutonomySettingView {
  return {
    capability_id: setting.capabilityId,
    environment: setting.environment,
    level: setting.level,
    max_actions: setting.maxActions,
    max_duration_ms: setting.maxDurationMs,
    updated_by: setting.updatedBy,
    updated_at: setting.updatedAt,
  };
}

/** Sole HTTP-facing adapter. The user actor is constructed here, never supplied by a request. */
export class AutonomyRuntime implements AutonomyApi {
  constructor(private readonly controller: AutonomyController) {}

  setting(capabilityId: string, environment: string): AutonomySettingView | null {
    if (!(ENVIRONMENTS as readonly string[]).includes(environment))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Invalid autonomy environment");
    const setting = policyOperation(() =>
      this.controller.setting(capabilityId, environment as Environment),
    );
    return setting ? settingView(setting) : null;
  }

  configure(
    capabilityId: string,
    environment: string,
    level: string,
    maxActions: number,
    maxDurationMs: number,
  ): AutonomySettingView {
    if (
      !(ENVIRONMENTS as readonly string[]).includes(environment) ||
      !(AUTONOMY_LEVELS as readonly string[]).includes(level)
    )
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Invalid autonomy setting");
    return settingView(
      policyOperation(() =>
        this.controller.configure(
          OWNER,
          capabilityId,
          environment as Environment,
          level as AutonomyLevel,
          { maxActions, maxDurationMs },
        ),
      ),
    );
  }

  stop(runId: string): void {
    policyOperation(() => this.controller.stop(OWNER, runId));
  }
}
