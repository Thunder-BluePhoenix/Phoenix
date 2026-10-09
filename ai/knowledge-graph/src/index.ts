// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phoenix knowledge graph (Phase 38, ADR-0020): a property graph of people, repositories, commits,
// issues, meetings, decisions, CI runs and deployments in the Phoenix SQLite database, with
// provenance on every node and edge, deterministic why/which/who questions that answer with the
// explanation path itself, and provenance inspection. No model is used to build or query it.
export * from "./graph";
export * from "./types";
export * from "./extract";
export * from "./ingest";
export * from "./query";
export * from "./inspect";
export * from "./answer";
