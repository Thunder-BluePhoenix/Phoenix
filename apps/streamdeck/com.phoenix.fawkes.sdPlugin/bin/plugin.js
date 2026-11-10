// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Entry point named by the manifest's CodePath. Stream Deck restarts a plugin that exits.
import { startPlugin } from "./plugin-core.js";

const running = startPlugin(process.argv.slice(2), { onClose: () => process.exit(0) });
if (running === null) process.exit(1);
