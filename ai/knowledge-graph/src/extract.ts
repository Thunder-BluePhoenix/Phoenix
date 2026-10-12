// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Explicit text identifies a candidate, not proof of a target. Only existing graph targets (or
// configured known repositories) can receive a mention edge; no token creates an entity.
import type { NodeRef, Relation } from "./types";

/** Longest text scanned. A longer text is read up to this point only. */
export const MAX_SCAN_CHARS = 4000;
/** Most mentions taken from one text. */
export const MAX_MENTIONS = 20;

export interface Mention {
  rel: Relation;
  target: NodeRef;
  /** The words that produced it, for the provenance detail. */
  matched: string;
  /** 1 for a form that is unambiguous, lower where the form allows two readings. */
  confidence: number;
}

export interface MentionContext {
  /** Canonical `owner/name` of the repository the text belongs to, when it has one. */
  repository?: string | undefined;
  /** Repositories (canonical `owner/name`) a text may name in full. */
  knownRepositories: readonly string[];
  /** Tracker prefixes whose `PREFIX-123` is an issue (`ENG`, `PROJ`). */
  trackerPrefixes: readonly string[];
  /** Whether the exact target exists in the graph; a token alone never proves existence. */
  hasNode: (id: string) => boolean;
}

const FIX_WORDS = "(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)";
const REPO = "[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}";

interface Found {
  at: number;
  mention: Mention;
}

export function phaseKey(n: string): string {
  return `phase-${String(Number(n)).padStart(2, "0")}`;
}

/** Mentions in `text`, in order of appearance, without duplicates. */
export function extractMentions(rawText: string, ctx: MentionContext): Mention[] {
  const text = rawText.slice(0, MAX_SCAN_CHARS);
  const found: Found[] = [];
  const add = (at: number, candidate: Mention): void => {
    if (
      candidate.target.type !== "Repository" &&
      !ctx.hasNode(`${candidate.target.type}:${candidate.target.key}`)
    )
      return;
    found.push({ at, mention: candidate });
  };
  const local = ctx.repository;
  const known = new Set(ctx.knownRepositories);

  // owner/repo#N, with an optional "pull request"/"fixes" lead-in.
  const qualified = new RegExp(`(?<![\\w./-])(?:(${FIX_WORDS})\\s+)?(${REPO})#(\\d{1,7})\\b`, "gi");
  const consumed: [number, number][] = [];
  for (const m of text.matchAll(qualified)) {
    const repo = m[2] ?? "";
    const n = m[3] ?? "";
    consumed.push([m.index, m.index + m[0].length]);
    if (m[1]) add(m.index, mention("FIXES", "Issue", `${repo}#${n}`, m[0], 1));
    else add(m.index, refMention(ctx, repo, n, m[0], 1));
  }
  const inConsumed = (i: number): boolean => consumed.some(([a, b]) => i >= a && i < b);

  // pull request #N / PR #N / .../pull/N
  const pr = /(?<![\w])(?:pull request|PR|pull\/)\s*#?(\d{1,7})\b/gi;
  for (const m of text.matchAll(pr)) {
    if (local === undefined || inConsumed(m.index)) continue;
    add(m.index, mention("MENTIONS", "PullRequest", `${local}#${m[1] ?? ""}`, m[0], 1));
    consumed.push([m.index, m.index + m[0].length]);
  }

  // fixes #N
  const fixes = new RegExp(`(?<![\\w])${FIX_WORDS}\\s+#(\\d{1,7})\\b`, "gi");
  for (const m of text.matchAll(fixes)) {
    if (local === undefined || inConsumed(m.index)) continue;
    add(m.index, mention("FIXES", "Issue", `${local}#${m[1] ?? ""}`, m[0], 1));
    consumed.push([m.index, m.index + m[0].length]);
  }

  // Bare #N is ambiguous: select a known PR, otherwise a known issue; neither means no edge.
  const bare = /(?<![\w&/#])#(\d{1,7})\b/g;
  for (const m of text.matchAll(bare)) {
    if (local === undefined || inConsumed(m.index)) continue;
    add(m.index, refMention(ctx, local, m[1] ?? "", m[0], 0.8));
  }

  // PROJ-45, only for a tracker prefix that is configured or seen.
  const prefixes = new Set(ctx.trackerPrefixes);
  if (prefixes.size > 0) {
    for (const m of text.matchAll(/(?<![\w-])([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g)) {
      if (prefixes.has(m[1] ?? "")) add(m.index, mention("MENTIONS", "Issue", m[0], m[0], 1));
    }
  }

  for (const m of text.matchAll(/(?<![\w-])ADR-(\d{4})\b/g)) {
    add(m.index, mention("MENTIONS", "Decision", `ADR-${m[1] ?? ""}`, m[0], 1));
  }
  for (const m of text.matchAll(/(?<![\w-])Phase[ -](\d{1,3})\b/gi)) {
    add(m.index, mention("REFERENCES", "Feature", phaseKey(m[1] ?? ""), m[0], 1));
  }
  if (local !== undefined) {
    for (const m of text.matchAll(/(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/g)) {
      add(m.index, mention("MENTIONS", "Commit", `${local}@${m[0]}`, m[0], 1));
    }
  }
  for (const m of text.matchAll(new RegExp(`(?<![\\w./-])(${REPO})(?![\\w#/-])`, "g"))) {
    const repo = m[1] ?? "";
    if (known.has(repo) && repo !== local) {
      add(m.index, mention("REFERENCES", "Repository", repo, repo, 1));
    }
  }

  found.sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  const out: Mention[] = [];
  for (const { mention: x } of found) {
    const id = `${x.rel}|${x.target.type}:${x.target.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(x);
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

function mention(
  rel: Relation,
  type: NodeRef["type"],
  key: string,
  matched: string,
  confidence: number,
): Mention {
  return { rel, target: { type, key }, matched: matched.slice(0, 80), confidence };
}

function refMention(
  ctx: MentionContext,
  repo: string,
  n: string,
  matched: string,
  confidence: number,
): Mention {
  const key = `${repo}#${n}`;
  const type = ctx.hasNode(`PullRequest:${key}`) ? "PullRequest" : "Issue";
  return mention("MENTIONS", type, key, matched, confidence);
}
