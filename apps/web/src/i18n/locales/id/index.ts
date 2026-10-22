// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Messages } from "../../en";
import { agents } from "./agents";
import { automation } from "./automation";
import { capture } from "./capture";
import { common } from "./common";
import { handoff } from "./handoff";
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
};

export default messages;
