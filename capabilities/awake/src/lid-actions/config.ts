// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Lid-close action configuration (config key `lid_actions`). Stored config is data, never trusted
// code: everything is validated here and anything invalid falls back to the default or is dropped
// (and counted), never used. Defaults: freeze apps ON (Slack, WhatsApp, Discord), mute ON, display
// ON, Low Power Mode ON (it only runs when the privileged helper is installed), Docker freeze OFF,
// App Nap OFF.
import { isRecord } from "../guards";
import { FREEZE_APPS, FREEZE_APP_KEYS } from "./apps";
import { MAX_PROTECTED_EXTRA, parseProtectedExtra } from "./protected";

/** Reverse-DNS bundle ids only: letters, digits, `-` and `.`, at least two parts, no leading dash. */
export const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/;
export const MAX_BUNDLE_ID_LENGTH = 155;
export const MAX_NAP_APPS = 16;

export interface LidActionsConfig {
  /** The master switch: when false nothing at all happens on a lid close. */
  enabled: boolean;
  display: boolean;
  freezeApps: boolean;
  /** Keys of FREEZE_APPS the user chose. */
  freezeList: string[];
  mute: boolean;
  lowPower: boolean;
  dockerFreeze: boolean;
  appNap: boolean;
  /** Bundle ids the user chose for App Nap. Empty: the action has nothing to do. */
  appNapList: string[];
  /** The user's additions to the protected list (lower case names). Built-ins cannot be removed. */
  protectedExtra: string[];
  /** Entries of any list that failed validation and were ignored. */
  dropped: number;
}

export const DEFAULT_LID_ACTIONS: LidActionsConfig = {
  enabled: true,
  display: true,
  freezeApps: true,
  freezeList: FREEZE_APPS.filter((a) => a.byDefault).map((a) => a.key),
  mute: true,
  lowPower: true,
  dockerFreeze: false,
  appNap: false,
  appNapList: [],
  protectedExtra: [],
  dropped: 0,
};

export function isBundleId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_BUNDLE_ID_LENGTH && BUNDLE_ID.test(value);
}

function flag(root: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = root[key];
  return typeof value === "boolean" ? value : fallback;
}

/** Never throws. */
export function parseLidActionsConfig(raw: unknown): LidActionsConfig {
  const root = isRecord(raw) ? raw : {};
  let dropped = 0;
  let freezeList = [...DEFAULT_LID_ACTIONS.freezeList];
  if (Array.isArray(root.freeze_apps_list)) {
    const keys = new Set<string>();
    for (const item of root.freeze_apps_list) {
      if (typeof item === "string" && FREEZE_APP_KEYS.includes(item)) keys.add(item);
      else dropped += 1;
    }
    freezeList = [...keys];
  }
  const nap = new Set<string>();
  if (Array.isArray(root.app_nap_apps)) {
    for (const item of root.app_nap_apps) {
      if (isBundleId(item) && nap.size < MAX_NAP_APPS) nap.add(item);
      else dropped += 1;
    }
  }
  const extra = parseProtectedExtra(root.protected_extra);
  return {
    enabled: flag(root, "enabled", DEFAULT_LID_ACTIONS.enabled),
    display: flag(root, "display", DEFAULT_LID_ACTIONS.display),
    freezeApps: flag(root, "freeze_apps", DEFAULT_LID_ACTIONS.freezeApps),
    freezeList,
    mute: flag(root, "mute", DEFAULT_LID_ACTIONS.mute),
    lowPower: flag(root, "low_power", DEFAULT_LID_ACTIONS.lowPower),
    dockerFreeze: flag(root, "docker_freeze", DEFAULT_LID_ACTIONS.dockerFreeze),
    appNap: flag(root, "app_nap", DEFAULT_LID_ACTIONS.appNap),
    appNapList: [...nap],
    protectedExtra: extra.names,
    dropped: dropped + extra.dropped,
  };
}

/** The JSON-Schema of the `lid_actions` config key (the manager refuses a bad save). */
export const LID_ACTIONS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  description:
    "What Phoenix does while the lid is closed during a keep-awake session, and undoes when it opens.",
  properties: {
    enabled: { type: "boolean", description: "Master switch (default on)." },
    display: { type: "boolean", description: "Turn the display off (default on)." },
    freeze_apps: {
      type: "boolean",
      description: "Freeze chat apps while the lid is closed (default on).",
    },
    freeze_apps_list: {
      type: "array",
      maxItems: FREEZE_APP_KEYS.length,
      items: { type: "string", enum: [...FREEZE_APP_KEYS] },
      description: "Which chat apps to freeze (default: all of them).",
    },
    mute: { type: "boolean", description: "Mute the sound output (default on)." },
    low_power: {
      type: "boolean",
      description: "Turn on Low Power Mode when the helper is installed (default on).",
    },
    docker_freeze: {
      type: "boolean",
      description: "Freeze Docker Desktop when no container runs (default off).",
    },
    app_nap: {
      type: "boolean",
      description: "Turn App Nap off for the apps in app_nap_apps (default off).",
    },
    app_nap_apps: {
      type: "array",
      maxItems: MAX_NAP_APPS,
      items: { type: "string", pattern: BUNDLE_ID.source, maxLength: MAX_BUNDLE_ID_LENGTH },
      description: "Bundle ids (for example com.example.App) that App Nap must not slow down.",
    },
    protected_extra: {
      type: "array",
      maxItems: MAX_PROTECTED_EXTRA,
      items: { type: "string", minLength: 1, maxLength: 64 },
      description:
        "Extra program or app names that are never frozen. Built-in protections cannot be removed.",
    },
  },
};
