// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Messages } from "../../en";
import { agents } from "./agents";
import { automation } from "./automation";
import { calendar } from "./calendar";
import { capture } from "./capture";
import { windowCapture } from "./window-capture";
import { common } from "./common";
import { digest } from "./digest";
import { fawkesRebirth } from "./fawkes-rebirth";
import { focus } from "./focus";
import { screenRegion } from "./screen-region";
import { follow } from "./follow";
import { handoff } from "./handoff";
import { machine } from "./machine";
import { mcp } from "./mcp";
import { memory } from "./memory";
import { mission } from "./mission";
import { pet } from "./pet";
import { phone } from "./phone";
import { remoteRelay } from "./remote-relay";
import { ports } from "./ports";
import { power } from "./power";
import { safety } from "./safety";
import { services } from "./services";
import { settings } from "./settings";
import { sounds } from "./sounds";
import { shell } from "./shell";
import { signals } from "./signals";
import { browserProfiles } from "./browser-profiles";
import { shields } from "./shields";
import { browser } from "./browser";
import { awakeSchedule } from "./awake-schedule";
import { awakeSettings } from "./awake-settings";
import { teamStatus } from "./team-status";
import { teamWebhooks } from "./team-webhooks";
import { teamInvite } from "./team-invite";
import { serviceGlances } from "./service-glances";
import { serviceGlancesB } from "./service-glances-b";

const messages: Messages = {
  ...common,
  ...shell,
  ...agents,
  ...automation,
  ...capture,
  ...windowCapture,
  ...memory,
  ...pet,
  ...phone,
  ...remoteRelay,
  ...power,
  ...services,
  ...settings,
  ...mcp,
  ...safety,
  ...mission,
  ...ports,
  ...handoff,
  ...focus,
  ...screenRegion,
  ...digest,
  ...calendar,
  ...signals,
  ...browserProfiles,
  ...shields,
  ...browser,
  ...awakeSchedule,
  ...awakeSettings,
  ...teamStatus,
  ...teamWebhooks,
  ...teamInvite,
  ...machine,
  ...fawkesRebirth,
  ...sounds,
  ...follow,
  ...serviceGlances,
  ...serviceGlancesB,
};

export default messages;
