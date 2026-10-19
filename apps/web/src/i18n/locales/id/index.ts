// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Messages } from "../../en";
import { common } from "./common";
import { shell } from "./shell";

const messages: Messages = { ...common, ...shell };

export default messages;
