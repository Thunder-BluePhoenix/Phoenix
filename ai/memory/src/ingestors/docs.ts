// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Project docs → memory. Only files the user explicitly lists (absolute paths to .md files, at
// most 1 MB each) are read; nothing is discovered or walked. The list is the user's grant: the
// runtime must only pass paths the user configured, and reads go through the injected DocReader
// so the same filesystem_read rules as the rest of Phoenix apply.
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { type MemoryPipeline, type RawCapture } from "../pipeline";
import type { MemoryStore } from "../store";
import { emptyReport, tally, type IngestReport } from "./report";

export const DOCS_SOURCE = "project-docs";
export const MAX_DOC_BYTES = 1024 * 1024;
/** Largest chunk of a doc. Small chunks keep retrieval precise and prompts cheap. */
export const DOC_CHUNK_CHARS = 1200;
/** Docs are not facts that last forever: they go stale if no ingest run has confirmed them. */
export const DOC_FRESHNESS_TTL_DAYS = 30;

export interface DocStat {
  size: number;
  /** Last modified time (ISO). */
  modifiedAt: string;
}

export interface DocReader {
  /** null when the file does not exist (or is not readable). */
  stat(path: string): Promise<DocStat | null>;
  read(path: string): Promise<string>;
}

export interface DocChunk {
  /** Heading path, for example "Phase 28 > Tasks". Empty for text before the first heading. */
  heading: string;
  body: string;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/**
 * Splits markdown by heading. Fenced code blocks are never mistaken for headings. Sections
 * without a body are dropped; sections longer than the memory size limit are split at blank
 * lines so no chunk is silently truncated.
 */
export function chunkMarkdown(markdown: string): DocChunk[] {
  const chunks: DocChunk[] = [];
  const trail: string[] = [];
  let lines: string[] = [];
  let heading = "";
  let fence: string | null = null;

  const flush = () => {
    const body = lines.join("\n").trim();
    lines = [];
    if (body.length === 0) return;
    for (const part of splitLong(body, DOC_CHUNK_CHARS - heading.length)) {
      chunks.push({ heading, body: part });
    }
  };

  for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
    const fenceMark = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (fenceMark) {
      if (fence === null) fence = fenceMark;
      else if (fenceMark.startsWith(fence[0] ?? "")) fence = null;
    }
    const match = fence === null ? HEADING.exec(line) : null;
    if (match) {
      flush();
      const level = match[1]!.length;
      trail.length = level - 1;
      trail[level - 1] = match[2]!;
      heading = trail.filter(Boolean).join(" > ");
      continue;
    }
    lines.push(line);
  }
  flush();
  return chunks;
}

/** Splits at blank lines, then at line breaks, and only then inside a line. Never drops text. */
function splitLong(body: string, max: number): string[] {
  if (body.length <= max) return [body];
  const parts: string[] = [];
  let current = "";
  const push = (piece: string, joiner: string) => {
    if (current.length > 0 && current.length + joiner.length + piece.length > max) {
      parts.push(current);
      current = "";
    }
    current = current ? `${current}${joiner}${piece}` : piece;
  };
  for (const paragraph of body.split(/\n\s*\n/)) {
    if (paragraph.length <= max) {
      push(paragraph, "\n\n");
      continue;
    }
    for (const line of paragraph.split("\n")) {
      const pieces =
        line.length > max ? (line.match(new RegExp(`[\\s\\S]{1,${max}}`, "g")) ?? []) : [line];
      for (const piece of pieces) push(piece, "\n");
    }
  }
  if (current) parts.push(current);
  return parts;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Why a configured path cannot be a doc source, or null when it can. */
export function docPathProblem(path: string): string | null {
  if (!isAbsolute(path)) return "path must be absolute";
  if (!path.toLowerCase().endsWith(".md")) return "only .md files are ingested";
  return null;
}

/** Captures for one file's content; dedupe keys include the chunk text so edits replace chunks. */
export function docCaptures(path: string, content: string, modifiedAt: string): RawCapture[] {
  const contentHash = sha256(content);
  const seen: Record<string, number> = {};
  return chunkMarkdown(content).map((chunk): RawCapture => {
    const body = chunk.heading ? `${chunk.heading}\n${chunk.body}` : chunk.body;
    const id = sha256(body).slice(0, 16);
    seen[id] = (seen[id] ?? 0) + 1;
    return {
      source: DOCS_SOURCE,
      sourceRef: path,
      scope: `path:${path}`,
      contentType: "doc",
      text: chunk.heading ? `${path.split("/").at(-1)} › ${body}` : body,
      observedAt: modifiedAt,
      // The same paragraph twice in one file gets a counter so it is not collapsed.
      dedupeKey: `doc:${path}:${id}:${seen[id]}`,
      provenance: { path, heading: chunk.heading, content_sha256: contentHash },
      freshnessTtlDays: DOC_FRESHNESS_TTL_DAYS,
    };
  });
}

export interface DocsIngestOptions {
  pipeline: MemoryPipeline;
  store: MemoryStore;
  reader: DocReader;
  /** The files the user pointed at. */
  paths: readonly string[];
}

/**
 * Brings doc memories in step with the listed files:
 * unchanged file (same content hash) → nothing re-ingested, memories just confirmed;
 * changed file → new chunks stored, chunks no longer present removed;
 * file removed, unreadable, or no longer in the list → its memories removed.
 */
export async function ingestDocs(options: DocsIngestOptions): Promise<IngestReport> {
  const { pipeline, store, reader } = options;
  const report = emptyReport();
  const listed: Record<string, true> = {};

  for (const path of options.paths) {
    const problem = docPathProblem(path);
    if (problem) {
      report.skipped.push({ source: path, reason: problem });
      continue;
    }
    listed[path] = true;
    const stat = await reader.stat(path);
    if (!stat) {
      report.removed += drop(store, path);
      report.skipped.push({ source: path, reason: "file not found" });
      continue;
    }
    if (stat.size > MAX_DOC_BYTES) {
      report.removed += drop(store, path);
      report.skipped.push({ source: path, reason: `larger than ${MAX_DOC_BYTES} bytes` });
      continue;
    }
    let content: string;
    try {
      content = await reader.read(path);
    } catch {
      report.removed += drop(store, path);
      report.skipped.push({ source: path, reason: "file could not be read" });
      continue;
    }
    const hash = sha256(content);
    if (store.sourceHash(path) === hash) {
      store.confirm(DOCS_SOURCE, path);
      continue;
    }
    const captures = docCaptures(path, content, stat.modifiedAt);
    let clean = true;
    for (const capture of captures) {
      const outcome = pipeline.capture(capture);
      tally(report, outcome);
      if (outcome.status === "refused" || outcome.status === "rejected") clean = false;
    }
    report.removed += store.purge({
      source: DOCS_SOURCE,
      sourceRef: path,
      keepKeys: captures.map((c) => c.dedupeKey),
    });
    // A refused chunk must be retried next run (the policy may have changed), so only a fully
    // handled file is remembered as unchanged.
    if (clean) store.setSourceHash(path, "project-doc", hash);
  }

  for (const ref of store.sourceRefs({ source: DOCS_SOURCE })) {
    if (listed[ref] !== true) report.removed += drop(store, ref);
  }
  return report;
}

function drop(store: MemoryStore, path: string): number {
  store.clearSourceHash(path);
  return store.purge({ source: DOCS_SOURCE, sourceRef: path });
}
