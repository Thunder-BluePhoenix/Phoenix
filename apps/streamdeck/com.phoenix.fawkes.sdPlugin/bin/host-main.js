// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Entry point the plugin starts. Nothing is written to stdout except the reply frame, and nothing
// to stderr (the token never reaches this far).
import { runHost } from "./host.js";

await runHost(process.stdin, process.stdout);
process.exit(0);
