// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Hybrid (lexical + vector) relevance over the six offline docs with the REAL nomic-embed-text
// model through the loopback-only Ollama adapter. Skipped unless PHOENIX_REAL_OLLAMA is set; it is
// a release check, never part of CI:
//   PHOENIX_REAL_OLLAMA=1 npx vitest run ai/evaluation/test/real-hybrid-relevance.test.ts
// Needs `nomic-embed-text` pulled. The figures are printed for the release record.
import { describe, expect, it } from "vitest";
import {
  HYBRID_EMBED_MODEL,
  formatEvaluation,
  ollamaRelevanceEmbedder,
  runHybridRelevance,
} from "../src/hybrid-relevance";

/** A cold model load can take far longer than vitest's 5 s default. */
const REAL_TIMEOUT_MS = 180_000;

describe.skipIf(!process.env.PHOENIX_REAL_OLLAMA)(
  "hybrid relevance with real nomic-embed-text",
  { timeout: REAL_TIMEOUT_MS },
  () => {
    it("hybrid is at least as good as lexical on the paraphrase queries", async () => {
      const r = await runHybridRelevance(ollamaRelevanceEmbedder());
      const { lexical, hybrid } = r.byKind.paraphrase!;
      const lines = [
        `embedder ${r.embedderKey} (${HYBRID_EMBED_MODEL}), k=${r.k}, indexed ${r.indexed.embedded}/6`,
        `paraphrase lexical: ${formatEvaluation(lexical)}`,
        `paraphrase hybrid:  ${formatEvaluation(hybrid)}`,
        `exact      lexical: ${formatEvaluation(r.byKind.exact!.lexical)}`,
        `exact      hybrid:  ${formatEvaluation(r.byKind.exact!.hybrid)}`,
        `all        lexical: ${formatEvaluation(r.lexical)}`,
        `all        hybrid:  ${formatEvaluation(r.hybrid)}`,
      ];
      console.log(lines.join("\n"));
      expect(r.indexed).toMatchObject({ embedded: 6, failed: 0, remaining: 0 });
      expect(r.vectorSkipped).toEqual([]);
      expect(hybrid.recallAtK).toBeGreaterThanOrEqual(lexical.recallAtK);
      expect(hybrid.mrr).toBeGreaterThanOrEqual(lexical.mrr);
      expect(hybrid.ndcgAtK).toBeGreaterThanOrEqual(lexical.ndcgAtK);
    });
  },
);
