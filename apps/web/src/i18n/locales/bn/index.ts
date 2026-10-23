// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Messages } from "../../en";
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

const messages: Messages = {
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
};

export default messages;
