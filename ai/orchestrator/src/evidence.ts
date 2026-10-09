// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash } from "node:crypto";
import { redact } from "@phoenix/logging";
import type { Evidence, EvidenceKind } from "@phoenix/protocol";

export const MAX_EVIDENCE_ITEMS = 60;
export const MAX_EXCERPT_CHARS = 1500;

export class EvidenceLimitError extends Error {
  override name = "EvidenceLimitError";
  constructor() {
    super(`A run may record at most ${MAX_EVIDENCE_ITEMS} pieces of evidence`);
  }
}

export interface NewEvidence {
  kind: EvidenceKind;
  /** Tool name, memory id, commit sha. */
  source: string;
  text: string;
  /** Excerpt length; capped at MAX_EXCERPT_CHARS. */
  maxChars?: number;
}

/**
 * The evidence of one run. Text is secret-redacted before it is hashed or stored, cut to a short
 * excerpt, and given a short id ("E1") that a diagnosis cites. Identical evidence is stored once.
 */
export class EvidenceBook {
  private readonly items: Evidence[] = [];
  private readonly byKey: Record<string, Evidence> = {};

  constructor(private readonly onAdd?: (evidence: Evidence) => void) {}

  add(input: NewEvidence): Evidence {
    const text = redact(input.text) as string;
    const excerptHash = createHash("sha256").update(text).digest("hex");
    const source = (redact(input.source) as string).slice(0, 300) || "unknown";
    const key = `${input.kind}\u0000${source}\u0000${excerptHash}`;
    const existing = this.byKey[key];
    if (existing) return existing;
    if (this.items.length >= MAX_EVIDENCE_ITEMS) throw new EvidenceLimitError();
    const max = Math.min(input.maxChars ?? MAX_EXCERPT_CHARS, MAX_EXCERPT_CHARS);
    const evidence: Evidence = {
      id: `E${this.items.length + 1}`,
      kind: input.kind,
      source,
      excerptHash,
      excerpt: text.slice(0, max),
      truncated: text.length > max,
    };
    this.items.push(evidence);
    this.byKey[key] = evidence;
    this.onAdd?.(evidence);
    return evidence;
  }

  get(id: string): Evidence | undefined {
    return this.items.find((e) => e.id === id);
  }

  list(): readonly Evidence[] {
    return this.items;
  }
}
