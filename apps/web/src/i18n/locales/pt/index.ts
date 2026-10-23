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
import { sounds } from "./sounds";
import { shell } from "./shell";
import { signals } from "./signals";
import { browserProfiles } from "./browser-profiles";
import { awakeSchedule } from "./awake-schedule";
import { awakeSettings } from "./awake-settings";
import { teamStatus } from "./team-status";
import { teamWebhooks } from "./team-webhooks";
import { serviceGlances } from "./service-glances";
import { serviceGlancesB } from "./service-glances-b";

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
  ...awakeSettings,
  ...teamStatus,
  ...teamWebhooks,
  ...machine,
  ...fawkesRebirth,
  ...sounds,
  ...serviceGlances,
  ...serviceGlancesB,
};

export default messages;
