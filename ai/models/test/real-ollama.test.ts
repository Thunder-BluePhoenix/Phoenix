// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Runs the Ollama adapter against a real local Ollama. Skipped unless PHOENIX_REAL_OLLAMA is set:
//   PHOENIX_REAL_OLLAMA=1 npx vitest run ai/models/test/real-ollama.test.ts
// Needs `llama3.2` (generation) and `nomic-embed-text` (embeddings) pulled.
import { describe, expect, it } from "vitest";
import { OllamaProvider } from "../src";

const request = {
  privacy: "sensitive" as const,
  purpose: "real-ollama test",
  messages: [{ role: "user" as const, content: "Reply with the single word: pong" }],
  maxTokens: 16,
  temperature: 0,
};

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! ** 2;
    nb += b[i]! ** 2;
  }
  return dot / Math.sqrt(na * nb);
}

/** A cold model load can take far longer than vitest's 5 s default. */
const REAL_TIMEOUT_MS = 180_000;

describe.skipIf(!process.env.PHOENIX_REAL_OLLAMA)(
  "OllamaProvider against a real Ollama",
  { timeout: REAL_TIMEOUT_MS },
  () => {
    const p = new OllamaProvider({ generateTimeoutMs: 120_000 });

    it("health and models", async () => {
      const h = await p.health();
      expect(h.available).toBe(true);
      expect(h.version).toMatch(/^\d+\.\d+/);
      const ids = (await p.models()).map((m) => m.id);
      expect(ids).toContain("llama3.2:latest");
      expect(ids).toContain("nomic-embed-text:latest");
    });

    it("generate", async () => {
      const r = await p.generate(request);
      expect(r.text.toLowerCase()).toContain("pong");
      expect(r.provenance).toMatchObject({
        provider: "ollama",
        locality: "local",
        model: "llama3.2",
      });
    });

    it("stream", async () => {
      const texts: string[] = [];
      let done = false;
      for await (const c of p.stream(request)) {
        if (c.kind === "text") texts.push(c.text);
        else done = true;
      }
      expect(done).toBe(true);
      expect(texts.join("").toLowerCase()).toContain("pong");
    });

    it("embed: near-duplicates are closer than unrelated sentences", async () => {
      const r = await p.embed({
        privacy: "sensitive",
        purpose: "real-ollama test",
        input: [
          "The cat sat on the warm windowsill.",
          "A cat is sitting on the warm window ledge.",
          "Quarterly tax filings are due at the end of March.",
        ],
      });
      expect(r.embeddings).toHaveLength(3);
      expect(r.dimensions).toBeGreaterThan(100);
      const similar = cosine(r.embeddings[0]!, r.embeddings[1]!);
      const different = cosine(r.embeddings[0]!, r.embeddings[2]!);
      expect(similar).toBeGreaterThan(different);
    });

    it("an aborted real stream stops", async () => {
      const ctl = new AbortController();
      const run = (async () => {
        for await (const c of p.stream(
          {
            ...request,
            maxTokens: 200,
            messages: [{ role: "user", content: "Count from 1 to 100." }],
          },
          { signal: ctl.signal },
        )) {
          if (c.kind === "text") ctl.abort();
        }
      })();
      await expect(run).rejects.toMatchObject({ kind: "aborted" });
    });
  },
);
