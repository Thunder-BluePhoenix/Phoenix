// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { agents } from "./agents";
import { automation } from "./automation";
import { calendar } from "./calendar";
import { capture } from "./capture";
import { common } from "./common";
import { digest } from "./digest";
import { fawkesRebirth } from "./fawkes-rebirth";
import { focus } from "./focus";
import { handoff } from "./handoff";
import { machine } from "./machine";
import { mcp } from "./mcp";
import { memory } from "./memory";
import { mission } from "./mission";
import { pet } from "./pet";
import { phone } from "./phone";
import { ports } from "./ports";
import { power } from "./power";
import { safety } from "./safety";
import { services } from "./services";
import { settings } from "./settings";
import { shell } from "./shell";
import { signals } from "./signals";
import { browserProfiles } from "./browser-profiles";
import { awakeSchedule } from "./awake-schedule";
import { teamStatus } from "./team-status";
import { teamWebhooks } from "./team-webhooks";

/** Every English message: the source text, bundled with the app and the fallback for every key. */
export const en = {
  ...common,
  ...shell,
  ...agents,
  ...automation,
  ...capture,
  ...memory,
  ...pet,
  ...phone,
  ...power,
  ...services,
  ...settings,
  ...mcp,
  ...safety,
  ...mission,
  ...ports,
  ...handoff,
  ...focus,
  ...digest,
  ...calendar,
  ...signals,
  ...browserProfiles,
  ...awakeSchedule,
  ...teamStatus,
  ...teamWebhooks,
  ...machine,
  ...fawkesRebirth,
} as const;

/** A message id, e.g. "common.button.save". A misspelt id is a compile error. */
export type MessageKey = keyof typeof en;

/** A complete set of messages: what every non-English locale must provide. */
export type Messages = Readonly<Record<MessageKey, string>>;
