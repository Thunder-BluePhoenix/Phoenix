// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phoenix hybrid retrieval (Phase 37): a SQLite vector index, an embedding pipeline through the
// model router, lexical + vector retrieval fused with reciprocal-rank fusion, rerankers, and
// relevance metrics. Nothing in Core imports this package yet; the runtime wires it in.
export * from "./embedder";
export * from "./indexer";
export * from "./metrics";
export * from "./rerank";
export * from "./retriever";
export * from "./vectors";
