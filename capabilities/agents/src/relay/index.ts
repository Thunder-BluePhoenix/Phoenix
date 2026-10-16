// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 57 public surface: the relay transport (Core hosts the server, hooks use the client) and
// the hook installer (Core's Settings routes and the `phoenix-agent` CLI drive it).
export { AGENT_ADAPTERS } from "./adapters";
export * from "./client";
export * from "./installer";
export * from "./protocol";
export * from "./self-test";
export * from "./server";
