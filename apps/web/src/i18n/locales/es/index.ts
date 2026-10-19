// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Messages } from "../../en";
import { agents } from "./agents";
import { automation } from "./automation";
import { capture } from "./capture";
import { common } from "./common";
import { memory } from "./memory";
import { pet } from "./pet";
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
  ...services,
  ...settings,
};

export default messages;
