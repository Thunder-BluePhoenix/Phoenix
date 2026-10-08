// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phoenix context engine (Phase 28): assembles permission-scoped, multi-domain context from
// memory and answers questions with stored facts and generated interpretation kept apart.
// Lexical only; vector and graph retrieval come in Phases 37-38.
export * from "./answer";
export * from "./engine";
export * from "./question";
export * from "./time";
