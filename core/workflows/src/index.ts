// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Workflow engine (Phases 39 and 40): event-driven WHEN / IF / THEN workflows that are DATA,
// executed only through the tool gateway, with declared permissions, production authorisation,
// approval gates, compensation, a kill switch and reliability metrics. See ADR-0021.
export * from "./admin";
export * from "./ai-step";
export * from "./approvals";
export * from "./canonical";
export * from "./engine";
export * from "./engine-types";
export * from "./expr";
export * from "./lookup";
export * from "./store";
export * from "./types";
export * from "./validate";
export * from "./views";
