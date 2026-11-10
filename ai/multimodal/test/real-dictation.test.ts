// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 64 MEASUREMENT (not a pass threshold): real speech through the real `WhisperStdinRecognizer`
// with the real `whisper-cli` and a real model, then (optionally) the transcripts through the
// clean-up modes with a real local model. Skipped unless explicitly enabled:
//
//   PHOENIX_REAL_DICTATION=1 PHOENIX_REAL_WHISPER_MODEL=/path/ggml-tiny.en.bin \
//     [PHOENIX_REAL_OLLAMA=1] node ./node_modules/vitest/vitest.mjs run \
//     ai/multimodal/test/real-dictation.test.ts --testTimeout=30000
//
// The numbers are written to docs/evidence/phase-64-real-dictation-<date>.md (+ -raw.json).
//
// WORD ERROR RATE: the normalisation rule (fixed here BEFORE any transcript was computed, never
// changed afterwards) applies to the reference and to the transcript alike:
//   1. Unicode NFC, lower-case; the typographic apostrophe U+2019 becomes "'".
//   2. A comma between a digit and exactly three digits ("1,250") is removed so it is one number.
//   3. Every character that is not a letter, a digit, an apostrophe or whitespace becomes a space
//      (so hyphens, colons, full stops, commas and quotes separate or vanish).
//   4. Leading and trailing apostrophes of a token are dropped; tokens are split on whitespace.
//   5. NO number conversion ("42" and "forty-two" are different words), NO abbreviation expansion
//      ("Dr" is not "doctor"), NO spelling variants. Whisper's own bracketed notes are already
//      removed by the recogniser (`cleanWhisperOutput`).
// WER = (substitutions + deletions + insertions) / reference words, by word-level Levenshtein
// distance computed in this file.
//
// What is asserted is structural only: the transcript is non-empty, no audio-like file was
// created during recognition, `cancel()` kills the child and leaves none behind, and an accepted
// clean-up satisfies the code's own `acceptCleanup` rule. Recognition quality is NOT asserted.
// LIMITS (also written into the evidence file): one machine, one English tiny model, four spoken
// samples of which three are macOS system-voice speech (synthetic, not a person), no live
// microphone, no person, and the filesystem observation is one run on one machine, not proof.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, writeFileSync, type Dirent } from "node:fs";
import { lstat, mkdtemp, open, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AiService,
  OllamaProvider,
  ProviderRegistry,
  type GenerateRequest,
} from "@phoenix/ai-models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  WhisperStdinRecognizer,
  runProcess,
  acceptCleanup,
  cleanUp,
  cleanupGenerateWith,
  normaliseText,
  tokenizeWords,
  type CleanupMode,
  type CleanupResult,
} from "../src";

const GATED = Boolean(process.env.PHOENIX_REAL_DICTATION);
const OLLAMA_GATED = GATED && Boolean(process.env.PHOENIX_REAL_OLLAMA);
const MODEL_PATH = process.env.PHOENIX_REAL_WHISPER_MODEL ?? "";
const OLLAMA_URL = "http://127.0.0.1:11434";
const OLLAMA_MODEL = "llama3.2";
const REPS = 3;
const CHUNK_SAMPLES = 1_600; // 100 ms pushes, like a capture loop
const JFK_PATH = "/opt/homebrew/share/whisper-cpp/jfk.wav";
const JFK_TEXT =
  "And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country.";
const EXPECTED_MODEL_SHA1 = "c78c86eb1a8faa21b369bcd33207cc90d64ae9df";
const WAV_NEAR_FRACTION = 0.1;

// ---------------------------------------------------------------------------------------------
// Pure helpers (checked without a model in the ungated block at the bottom)
// ---------------------------------------------------------------------------------------------

export function werTokens(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replaceAll("\u2019", "'")
    .replace(/(\d),(?=\d{3}(?!\d))/gu, "$1")
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .split(/\s+/u)
    .map((t) => t.replace(/^'+|'+$/gu, ""))
    .filter(Boolean);
}

export interface WerResult {
  words: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  wer: number;
}

export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const ref = werTokens(reference);
  const hyp = werTokens(hypothesis);
  const rows = ref.length + 1;
  const cols = hyp.length + 1;
  const dist: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dist[i]![0] = i;
  for (let j = 0; j < cols; j++) dist[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const sub = dist[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      dist[i]![j] = Math.min(sub, dist[i - 1]![j]! + 1, dist[i]![j - 1]! + 1);
    }
  }
  let i = ref.length;
  let j = hyp.length;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  while (i > 0 || j > 0) {
    const here = dist[i]![j]!;
    if (i > 0 && j > 0 && here === dist[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      if (ref[i - 1] !== hyp[j - 1]) substitutions++;
      i--;
      j--;
    } else if (i > 0 && here === dist[i - 1]![j]! + 1) {
      deletions++;
      i--;
    } else {
      insertions++;
      j--;
    }
  }
  const errors = substitutions + deletions + insertions;
  return {
    words: ref.length,
    substitutions,
    deletions,
    insertions,
    wer: ref.length === 0 ? (hyp.length === 0 ? 0 : 1) : errors / ref.length,
  };
}

export interface DecodedWav {
  samples: Int16Array;
  sampleRate: number;
  channels: number;
  bits: number;
}

/** RIFF/WAVE PCM: walks the chunks (tolerates LIST and friends) and returns the 16-bit samples. */
export function decodeWav(buf: Uint8Array): DecodedWav {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(...buf.subarray(o, o + 4));
  if (buf.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | undefined;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("data before fmt");
      if (fmt.format !== 1 || fmt.bits !== 16) throw new Error("not 16-bit PCM");
      const bytes = Math.min(size, buf.length - body);
      const samples = new Int16Array(Math.floor(bytes / 2));
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(body + i * 2, true);
      return { samples, sampleRate: fmt.sampleRate, channels: fmt.channels, bits: fmt.bits };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("no data chunk");
}

export function toChunks(samples: Int16Array, chunk = CHUNK_SAMPLES): Int16Array[] {
  const out: Int16Array[] = [];
  for (let i = 0; i < samples.length; i += chunk) out.push(samples.slice(i, i + chunk));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Filesystem observation
// ---------------------------------------------------------------------------------------------

interface FsEntry {
  size: number;
  mtimeMs: number;
  kind: "file" | "dir" | "other";
}
type Listing = Map<string, FsEntry>;
interface Root {
  label: string;
  path: string;
  depth: number;
}

async function walk(dir: string, depth: number, out: Listing): Promise<void> {
  let names: Dirent[];
  try {
    names = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (let i = 0; i < names.length; i += 256) {
    const batch = names.slice(i, i + 256);
    const stats = await Promise.all(
      batch.map((d) => lstat(join(dir, d.name)).catch(() => undefined)),
    );
    for (let k = 0; k < batch.length; k++) {
      const s = stats[k];
      if (!s) continue;
      const path = join(dir, batch[k]!.name);
      const kind = s.isDirectory() ? "dir" : s.isFile() ? "file" : "other";
      out.set(path, { size: s.size, mtimeMs: s.mtimeMs, kind });
    }
  }
  if (depth > 1) {
    for (const d of names) {
      if (d.isDirectory()) await walk(join(dir, d.name), depth - 1, out);
    }
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Every directory in which this code (or the tools it starts) could put a file. */
async function watchedRoots(): Promise<Root[]> {
  const candidates: Root[] = [
    { label: "os.tmpdir()", path: tmpdir(), depth: 1 },
    { label: "/tmp", path: "/tmp", depth: 1 },
    { label: "/var/tmp", path: "/var/tmp", depth: 1 },
    { label: "process.cwd()", path: process.cwd(), depth: 1 },
    { label: "<repo>/.phoenix (dev data dir)", path: join(process.cwd(), ".phoenix"), depth: 4 },
    { label: "~/.phoenix (default data dir)", path: join(homedir(), ".phoenix"), depth: 4 },
    {
      label: "~/Library/Application Support/dev.phoenix.desktop",
      path: join(homedir(), "Library", "Application Support", "dev.phoenix.desktop"),
      depth: 3,
    },
  ];
  if (process.env.PHOENIX_DATA_DIR) {
    candidates.push({
      label: "$PHOENIX_DATA_DIR",
      path: process.env.PHOENIX_DATA_DIR,
      depth: 4,
    });
  }
  const seen = new Set<string>();
  const roots: Root[] = [];
  for (const c of candidates) {
    const key = (await realpath(c.path).catch(() => c.path)) + `#${c.depth}`;
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(c);
  }
  return roots;
}

type Snapshot = { at: string; roots: { root: Root; present: boolean; entries: Listing }[] };

async function snapshot(roots: Root[]): Promise<Snapshot> {
  const out: Snapshot = { at: new Date().toISOString(), roots: [] };
  for (const root of roots) {
    const entries: Listing = new Map();
    const present = await exists(root.path);
    if (present) await walk(root.path, root.depth, entries);
    out.roots.push({ root, present, entries });
  }
  return out;
}

interface ObservedFile {
  root: string;
  path: string;
  kind: string;
  size: number;
  mtime: string;
  /** growth in bytes for a file that existed before (changed files only) */
  growth?: number;
  riff?: boolean;
  nearAudioSize?: boolean;
}

async function startsWithRiff(path: string): Promise<boolean> {
  try {
    const fh = await open(path, "r");
    try {
      const head = Buffer.alloc(12);
      const { bytesRead } = await fh.read(head, 0, 12, 0);
      return bytesRead >= 12 && head.toString("ascii", 0, 4) === "RIFF";
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

const near = (n: number, audioBytes: number) =>
  audioBytes > 0 && Math.abs(n - audioBytes) <= audioBytes * WAV_NEAR_FRACTION;

interface FsDiff {
  before: string;
  after: string;
  counts: { root: string; before: number; after: number; present: boolean }[];
  created: ObservedFile[];
  changed: ObservedFile[];
  removed: number;
  flagged: ObservedFile[];
  /** Full listings (names, sizes, mtimes) of the small roots only, for the record. */
  listings: { root: string; entries: { path: string; size: number; mtime: string }[] }[];
}

async function diffSnapshots(
  before: Snapshot,
  after: Snapshot,
  audioBytes: number,
): Promise<FsDiff> {
  const created: ObservedFile[] = [];
  const changed: ObservedFile[] = [];
  const counts: FsDiff["counts"] = [];
  const listings: FsDiff["listings"] = [];
  let removed = 0;
  const describe = (root: string, path: string, e: FsEntry, growth?: number): ObservedFile => ({
    root,
    path,
    kind: e.kind,
    size: e.size,
    mtime: new Date(e.mtimeMs).toISOString(),
    ...(growth === undefined ? {} : { growth }),
  });
  for (let i = 0; i < after.roots.length; i++) {
    const a = after.roots[i]!;
    const b = before.roots[i]!;
    counts.push({
      root: a.root.label,
      before: b.entries.size,
      after: a.entries.size,
      present: a.present,
    });
    if (a.entries.size <= 1_000) {
      listings.push({
        root: a.root.label,
        entries: [...a.entries]
          .sort((x, y) => x[0].localeCompare(y[0]))
          .map(([path, e]) => ({ path, size: e.size, mtime: new Date(e.mtimeMs).toISOString() })),
      });
    }
    for (const key of b.entries.keys()) if (!a.entries.has(key)) removed++;
    for (const [path, e] of a.entries) {
      const was = b.entries.get(path);
      if (!was) {
        created.push(describe(a.root.label, path, e));
        if (e.kind === "dir") {
          const inner: Listing = new Map();
          await walk(path, 3, inner);
          for (const [p, ie] of inner) created.push(describe(a.root.label, p, ie));
        }
      } else if (e.kind === "file" && (e.size !== was.size || e.mtimeMs !== was.mtimeMs)) {
        changed.push(describe(a.root.label, path, e, e.size - was.size));
      }
    }
  }
  const flagged: ObservedFile[] = [];
  for (const f of created) {
    if (f.kind !== "file") continue;
    f.riff = await startsWithRiff(f.path);
    f.nearAudioSize = near(f.size, audioBytes);
    if (f.riff || f.nearAudioSize) flagged.push(f);
  }
  for (const f of changed) {
    f.riff = await startsWithRiff(f.path);
    f.nearAudioSize = near(f.growth ?? 0, audioBytes);
    if (f.nearAudioSize) flagged.push(f);
  }
  return {
    before: before.at,
    after: after.at,
    counts,
    created,
    changed,
    removed,
    flagged,
    listings,
  };
}

// ---------------------------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------------------------

function run(file: string, args: string[], timeoutMs = 60_000): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(file, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, out, errOut) =>
    err ? reject(new Error(`${file}: ${err.message} ${errOut}`)) : resolve(out),
  );
  return promise;
}

const attempt = async (fn: () => Promise<string>): Promise<string> =>
  fn().then(
    (s) => s.trim(),
    (e: unknown) => `(unavailable: ${e instanceof Error ? e.message.slice(0, 200) : String(e)})`,
  );

async function whisperPids(): Promise<number[]> {
  const out = await run("pgrep", ["-x", "whisper-cli"]).catch(() => "");
  return out
    .split("\n")
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

// A real delay: the test polls a real child process; no fake clock can advance an OS process.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Recorded results
// ---------------------------------------------------------------------------------------------

interface SampleSpec {
  id: string;
  source: string;
  wavPath: string;
  reference: string;
}

interface SampleRecord {
  id: string;
  variant: "old-args" | "shipped";
  source: string;
  reference: string;
  audioBytes: number;
  audioSeconds: number;
  format: string;
  pushes: number;
  availability: unknown;
  elapsedMs: number;
  transcript: string;
  wer: WerResult;
  referenceTokens: string[];
  transcriptTokens: string[];
  fs: FsDiff;
}

interface CleanupRecord {
  sampleId: string;
  transcriptVariant: string;
  mode: CleanupMode;
  rep: number;
  input: string;
  rawReply: string | null;
  output: string;
  used: boolean;
  skipped: CleanupResult["skipped"] | null;
  acceptCleanupOnReply: boolean | null;
  addedNumbers: string[];
  addedNames: string[];
  latencyMs: number;
}

interface CancelRecord {
  audioSeconds: number;
  pidsBefore: number[];
  childPid: number | null;
  runningBeforeCancel: boolean;
  finishRejectedWith: string;
  stateAfterCancel: string;
  goneAfterMs: number | null;
  pidsAfter: number[];
  secondCancelThrew: boolean;
  finishAfterCancelRejected: boolean;
  fs?: FsDiff;
}

const env: Record<string, unknown> = {};
const samples: SampleRecord[] = [];
const cleanups: CleanupRecord[] = [];
const requests: { url: string; model?: string }[] = [];
let cancelRecord: CancelRecord | undefined;
let warmup = "";
const localDate = (() => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

function addedTokens(input: string, output: string) {
  const known = new Set(tokenizeWords(input).map((t) => t.key));
  const addedNumbers = [
    ...new Set(
      tokenizeWords(output)
        .map((t) => t.key)
        .filter((k) => /\d/u.test(k) && !known.has(k)),
    ),
  ];
  const names = new Set<string>();
  for (const m of output.matchAll(/(?<![.!?]\s)(?<!^)\b\p{Lu}\p{Ll}+/gu)) {
    if (!known.has(m[0].toLowerCase())) names.add(m[0]);
  }
  return { addedNumbers, addedNames: [...names] };
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

const fence = (s: string) => "```\n" + s + "\n```";
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function renderReport(): string {
  const out: string[] = [];
  const cmd = `PHOENIX_REAL_DICTATION=1 ${OLLAMA_GATED ? "PHOENIX_REAL_OLLAMA=1 " : ""}PHOENIX_REAL_WHISPER_MODEL=${MODEL_PATH} /Users/bluephoenix/.nvm/versions/node/v22.19.0/bin/node ./node_modules/vitest/vitest.mjs run ai/multimodal/test/real-dictation.test.ts --testTimeout=30000`;
  out.push(
    "# Phase 64 real dictation measurement",
    "",
    `Generated by \`ai/multimodal/test/real-dictation.test.ts\` on ${localDate}; do not edit by hand. Raw data: \`phase-64-real-dictation-${localDate}-raw.json\`.`,
    "",
    "**What this is.** A measurement of one real `whisper-cli` + one real model on four spoken samples, a filesystem observation around each recognition, a `cancel()` check, and (when enabled) the clean-up modes against a real local model. **What it is not.** It is not a live-microphone test, not a person, not a quality guarantee and not proof of anything beyond this one run on this one machine. Three of the four samples are macOS system-voice speech: synthetic, not a person. The model is the English-only tiny model. The exit criteria 'recognition from a live microphone', 'no audio is written to disk' (as an observed property of the shipped app) and the three-apps paste run stay **unverified**.",
    "",
    "## Setup",
    "",
    `- Command: \`${cmd}\``,
  );
  for (const [k, v] of Object.entries(env))
    out.push(`- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  out.push(
    "",
    "## WER normalisation rule (fixed before any transcript was computed)",
    "",
    "Both reference and transcript: NFC, lower-case, U+2019 → `'`; a comma between a digit and exactly three digits is removed; every character that is not a letter, digit, apostrophe or whitespace becomes a space; leading and trailing apostrophes of a token are dropped. No number-word conversion (`42` ≠ `forty-two`), no abbreviation expansion, no spelling variants. WER = (S + D + I) / reference words, word-level Levenshtein computed in the test file. The reference for a `say` sample is exactly the text passed to `say`.",
    "",
    "## Recognition (real `WhisperStdinRecognizer`, push/finish)",
    "",
    "| sample | variant | audio | words | S | D | I | WER | elapsed |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const s of samples) {
    out.push(
      `| ${s.id} | ${s.variant} | ${s.audioSeconds.toFixed(2)} s (${s.audioBytes} B) | ${s.wer.words} | ${s.wer.substitutions} | ${s.wer.deletions} | ${s.wer.insertions} | ${pct(s.wer.wer)} | ${s.elapsedMs} ms |`,
    );
  }
  for (const variant of ["old-args", "shipped"] as const) {
    const of = samples.filter((s) => s.variant === variant);
    if (!of.length) continue;
    const words = of.reduce((n, s) => n + s.wer.words, 0);
    const errs = of.reduce(
      (n, s) => n + s.wer.substitutions + s.wer.deletions + s.wer.insertions,
      0,
    );
    out.push(
      "",
      `Pooled, ${variant}: ${errs} errors / ${words} reference words = ${pct(errs / words)} (${of.length} samples; not a benchmark).`,
    );
  }
  out.push(
    "",
    "Variants. `shipped` is `WhisperStdinRecognizer` as it is now (arguments `-m <model> -nt -np -otxt -of - -`). `old-args` is the SAME class forced to the argument list it shipped with before the fix (`-m <model> -nt -np -`) by a runner override; it is the recorded before-result: with this whisper-cli build it exits 0 and prints nothing on stdout (stderr: \"read N bytes from stdin\" and \"warning: '--output-file -' used without any other '--output-*'\"), so the transcript is empty and the WER is 100% (all words deleted). It is not asserted to be non-empty. The clean-up runs use the `shipped` transcripts.",
  );
  for (const s of samples) {
    out.push(
      "",
      `### ${s.id} / ${s.variant} (${s.source})`,
      "",
      `- Format pushed: ${s.format}, ${s.pushes} pushes of ${CHUNK_SAMPLES} samples`,
      `- Reference: ${JSON.stringify(s.reference)}`,
      `- Transcript (raw, as returned by \`finish()\`): ${JSON.stringify(s.transcript)}`,
      `- Reference tokens: ${s.referenceTokens.join(" ")}`,
      `- Transcript tokens: ${s.transcriptTokens.join(" ")}`,
    );
  }
  out.push("", "## Filesystem observation (one run, one machine; not proof)", "");
  out.push(
    "Before and after each recognition (and the cancel run) these roots were listed with name, size and mtime: the OS temp dir, `/tmp`, `/var/tmp`, the process cwd, the Phoenix data directories the code could use (`<repo>/.phoenix`, `~/.phoenix`, the desktop app support dir, `$PHOENIX_DATA_DIR` if set). Flag rule: a new regular file whose first bytes are `RIFF`, or whose size is within 10% of the audio size (or a changed file whose growth is within 10%). Other processes on a shared machine also create files in the temp dirs; every created/changed entry is listed (capped) and flagged ones are called out. Full listings of the small roots are in the raw JSON.",
    "",
  );
  for (const s of samples) {
    out.push(
      `### ${s.id} / ${s.variant}`,
      "",
      `- Window: ${s.fs.before} → ${s.fs.after}`,
      `- Entries per root (before → after): ${s.fs.counts.map((c) => `${c.root}${c.present ? "" : " (absent)"}: ${c.before} → ${c.after}`).join("; ")}`,
      `- Created: ${s.fs.created.length}, changed files: ${s.fs.changed.length}, removed: ${s.fs.removed}, flagged (RIFF header or audio-sized): ${s.fs.flagged.length}`,
    );
    if (s.fs.flagged.length) out.push(`- FLAGGED: ${JSON.stringify(s.fs.flagged)}`);
    const cap = (list: ObservedFile[]) =>
      list
        .slice(0, 40)
        .map(
          (f) =>
            `${f.path} (${f.kind}, ${f.size} B, ${f.mtime}${f.growth === undefined ? "" : `, +${f.growth} B`})`,
        )
        .join("\n");
    if (s.fs.created.length) out.push("- Created entries (first 40):", fence(cap(s.fs.created)));
    if (s.fs.changed.length) out.push("- Changed files (first 40):", fence(cap(s.fs.changed)));
  }
  if (cancelRecord) {
    out.push(
      "",
      "## cancel() mid-run",
      "",
      fence(JSON.stringify({ ...cancelRecord, fs: undefined }, null, 2)),
    );
    if (cancelRecord.fs) {
      const f = cancelRecord.fs;
      out.push(
        "",
        `Filesystem during the cancel run: created ${f.created.length}, changed ${f.changed.length}, removed ${f.removed}, flagged ${f.flagged.length}${f.flagged.length ? " " + JSON.stringify(f.flagged) : ""}`,
      );
    }
  }
  out.push("", "## Clean-up modes (real local model)", "");
  if (!OLLAMA_GATED) {
    out.push("Not run (`PHOENIX_REAL_OLLAMA` not set).");
  } else {
    out.push(
      `Path: \`cleanUp\` → \`cleanupGenerateWith(AiService)\` → \`AiService.run\` (the production adapter, \`core/runtime/src/dictation.ts\`) with only the loopback \`OllamaProvider\` registered, cloud policy denying everything; request temperature 0 (set by \`cleanUp\`), so repeated runs are expected to be near-identical. Provider requests made: ${requests.length}; models named: ${[...new Set(requests.map((r) => r.model ?? "(none)"))].join(", ")}; all URLs loopback: ${requests.every((r) => r.url.startsWith(OLLAMA_URL + "/")) ? "yes" : "NO"}. Warm-up (one trivial call so the first measured call is not a cold model load; not part of the data): ${warmup}`,
      "",
      "| sample | mode | rep | used | skipped | acceptCleanup(reply) | added numbers | added names | ms |",
      "|---|---|---|---|---|---|---|---|---|",
    );
    for (const c of cleanups) {
      out.push(
        `| ${c.sampleId} (${c.transcriptVariant}) | ${c.mode} | ${c.rep} | ${c.used} | ${c.skipped ?? ""} | ${c.acceptCleanupOnReply === null ? "n/a" : c.acceptCleanupOnReply} | ${c.addedNumbers.join(", ")} | ${c.addedNames.join(", ")} | ${c.latencyMs} |`,
      );
    }
    for (const c of cleanups) {
      out.push(
        "",
        `#### ${c.sampleId} / ${c.mode} / run ${c.rep}`,
        "",
        `- Input: ${JSON.stringify(c.input)}`,
        `- Model reply (raw): ${c.rawReply === null ? "(no model call)" : JSON.stringify(c.rawReply)}`,
        `- Output returned by \`cleanUp\`: ${JSON.stringify(c.output)} (used: ${c.used}${c.skipped ? `, skipped: ${c.skipped}` : ""})`,
      );
    }
  }
  return out.join("\n") + "\n";
}

afterAll(() => {
  if (!GATED || samples.length === 0) return;
  const dir = fileURLToPath(new URL("../../../docs/evidence/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  const base = `${dir}phase-64-real-dictation-${localDate}${OLLAMA_GATED ? "" : "-no-cleanup"}`;
  writeFileSync(`${base}.md`, renderReport());
  writeFileSync(
    `${base}-raw.json`,
    JSON.stringify({ env, samples, cancel: cancelRecord, cleanups, requests, warmup }, null, 2),
  );
});

// ---------------------------------------------------------------------------------------------
// Gated measurement
// ---------------------------------------------------------------------------------------------

describe.skipIf(!GATED)(
  "Phase 64 real dictation (whisper-cli + real model, real speech samples)",
  { timeout: 600_000 },
  () => {
    let workDir = "";
    let roots: Root[] = [];
    const specs: SampleSpec[] = [
      {
        id: "jfk",
        source: "whisper.cpp sample jfk.wav (a recording of a person)",
        wavPath: JFK_PATH,
        reference: JFK_TEXT,
      },
    ];
    const SAY: { id: string; voice: string; text: string }[] = [
      {
        id: "say-samantha",
        voice: "Samantha",
        text: "The quarterly report is due on Thursday, and we sold 1,250 units in Lisbon.",
      },
      {
        id: "say-daniel",
        voice: "Daniel",
        text: "Tell Priya Raghavan that invoice number 4821 was paid on June 9.",
      },
      {
        id: "say-karen",
        voice: "Karen",
        text: "Remember to buy two pounds of apples and call Doctor Nakamura at 5 o'clock.",
      },
    ];

    beforeAll(async () => {
      expect(MODEL_PATH, "set PHOENIX_REAL_WHISPER_MODEL to a ggml model file").not.toBe("");
      workDir = await mkdtemp("/tmp/phoenix-real-dictation-");
      for (const s of SAY) {
        const aiff = join(workDir, `${s.id}.aiff`);
        const wav = join(workDir, `${s.id}.wav`);
        await run("say", ["-v", s.voice, "-o", aiff, s.text]);
        await run("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
        specs.push({
          id: s.id,
          source: `macOS \`say -v ${s.voice}\` (synthetic system voice, not a person) → afconvert 16 kHz mono LEI16`,
          wavPath: wav,
          reference: s.text,
        });
      }
      roots = await watchedRoots();
      const sha1 = await new Promise<string>((resolve, reject) => {
        const h = createHash("sha1");
        createReadStream(MODEL_PATH)
          .on("data", (c) => h.update(c))
          .on("end", () => resolve(h.digest("hex")))
          .on("error", reject);
      });
      env["Date"] = localDate;
      env["Node"] = process.version;
      env["Platform"] =
        `${process.platform}/${process.arch}; macOS ${await attempt(() => run("sw_vers", ["-productVersion"]))}`;
      env["whisper-cli path"] = await attempt(() => run("/usr/bin/which", ["whisper-cli"]));
      env["whisper-cli --version"] =
        "(whisper-cli has no --version flag: it answers 'unknown argument: --version')";
      env["whisper.cpp / ggml (brew list --versions)"] = await attempt(() =>
        run("brew", ["list", "--versions", "whisper-cpp", "ggml"]),
      );
      env["Model path"] = MODEL_PATH;
      env["Model size (bytes)"] = (await stat(MODEL_PATH)).size;
      env["Model sha1"] = sha1;
      env["Model sha1 equals the one recorded when downloaded"] = sha1 === EXPECTED_MODEL_SHA1;
      env["say voices used"] = await attempt(() => run("say", ["-v", "?"])).then((all) =>
        all
          .split("\n")
          .filter((l) => SAY.some((s) => l.startsWith(s.voice)))
          .map((l) => l.replace(/\s+/g, " "))
          .join(" | "),
      );
      env["Sample generation dir (deleted afterwards)"] = workDir;
      env["Watched roots"] = roots.map((r) => `${r.label} = ${r.path} (depth ${r.depth})`);
    });

    afterAll(async () => {
      if (workDir) await rm(workDir, { recursive: true, force: true });
    });

    it.each(["jfk", "say-samantha", "say-daniel", "say-karen"])(
      "recognises sample %s with the real binary and model, watching the filesystem",
      async (id) => {
        const spec = specs.find((s) => s.id === id)!;
        const wav = decodeWav(new Uint8Array(await readFile(spec.wavPath)));
        expect([wav.sampleRate, wav.channels, wav.bits]).toEqual([16_000, 1, 16]);
        const chunks = toChunks(wav.samples);
        const audioBytes = wav.samples.length * 2;
        const observed: SampleRecord[] = [];
        // "old-args": the argument list the code shipped BEFORE the fix (`-m <model> -nt -np -`),
        // forced through the same class by a runner override. Kept as the recorded before-result:
        // with whisper-cli 1.8.6 it exits 0 and prints nothing on stdout. Not asserted non-empty.
        // "shipped": WhisperStdinRecognizer exactly as it is now.
        for (const variant of ["old-args", "shipped"] as const) {
          const recogniser = new WhisperStdinRecognizer({
            modelPath: MODEL_PATH,
            ...(variant === "shipped"
              ? {}
              : {
                  run: (exe, _args, input, signal) =>
                    runProcess(exe, ["-m", MODEL_PATH, "-nt", "-np", "-"], input, signal),
                }),
          });
          const availability = await recogniser.availability();
          expect(availability.available, JSON.stringify(availability)).toBe(true);

          const before = await snapshot(roots);
          const t0 = Date.now();
          const session = recogniser.start();
          for (const c of chunks) session.push(c);
          const { text } = await session.finish();
          const elapsedMs = Date.now() - t0;
          const after = await snapshot(roots);
          const fs = await diffSnapshots(before, after, audioBytes + 44);

          const record: SampleRecord = {
            id,
            variant,
            source: spec.source,
            reference: spec.reference,
            audioBytes,
            audioSeconds: wav.samples.length / 16_000,
            format: `${wav.sampleRate} Hz, ${wav.channels} ch, ${wav.bits}-bit`,
            pushes: chunks.length,
            availability,
            elapsedMs,
            transcript: text,
            wer: wordErrorRate(spec.reference, text),
            referenceTokens: werTokens(spec.reference),
            transcriptTokens: werTokens(text),
            fs,
          };
          samples.push(record);
          observed.push(record);
        }

        // Structural guarantees only. Recognition quality is measured, not asserted.
        for (const r of observed) {
          const stray = r.fs.created.filter((f) => /(^|\/)-(\.txt)?$/u.test(f.path));
          expect(stray, `${r.variant}: file named "-" or "-.txt" created`).toEqual([]);
          expect(r.fs.flagged, `${r.variant}: ${JSON.stringify(r.fs.flagged)}`).toEqual([]);
        }
        const shipped = observed.find((r) => r.variant === "shipped")!;
        expect(shipped.transcript.trim().length, "shipped transcript is empty").toBeGreaterThan(0);
      },
    );

    it("cancel() mid-run kills the whisper-cli child and leaves no process behind", async () => {
      const jfk = decodeWav(new Uint8Array(await readFile(JFK_PATH)));
      const one = toChunks(jfk.samples);
      const recogniser = new WhisperStdinRecognizer({ modelPath: MODEL_PATH });
      const pidsBefore = await whisperPids();
      const session = recogniser.start();
      // ~18 minutes of audio so the recognition is certainly still running when cancel() is called.
      for (let i = 0; i < 100; i++) for (const c of one) session.push(c);
      const before = await snapshot(roots);
      const finished = session.finish().then(
        () => "resolved",
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
      let child: number | null = null;
      for (let i = 0; i < 100 && child === null; i++) {
        await sleep(100);
        child = (await whisperPids()).find((p) => !pidsBefore.includes(p)) ?? null;
      }
      const runningBeforeCancel =
        child !== null &&
        (await run("ps", ["-o", "pid=,stat=", "-p", String(child)]).catch(() => "")).trim() !== "";
      const cancelAt = Date.now();
      session.cancel();
      const finishRejectedWith = await finished;
      let goneAfterMs: number | null = null;
      let stateAfterCancel = "(no child observed)";
      if (child !== null) {
        for (let i = 0; i < 100; i++) {
          const ps = (
            await run("ps", ["-o", "pid=,stat=", "-p", String(child)]).catch(() => "")
          ).trim();
          stateAfterCancel = ps === "" ? "gone (ps lists no such pid)" : `still listed: ${ps}`;
          if (ps === "") {
            goneAfterMs = Date.now() - cancelAt;
            break;
          }
          await sleep(50);
        }
      }
      let secondCancelThrew = false;
      try {
        session.cancel();
      } catch {
        secondCancelThrew = true;
      }
      const finishAfterCancelRejected = await session.finish().then(
        () => false,
        () => true,
      );
      const pidsAfter = await whisperPids();
      const after = await snapshot(roots);
      const fs = await diffSnapshots(before, after, jfk.samples.length * 2 * 100 + 44);
      cancelRecord = {
        audioSeconds: (jfk.samples.length * 100) / 16_000,
        pidsBefore,
        childPid: child,
        runningBeforeCancel,
        finishRejectedWith,
        stateAfterCancel,
        goneAfterMs,
        pidsAfter,
        secondCancelThrew,
        finishAfterCancelRejected,
        fs,
      };

      expect(child, "no whisper-cli child was observed").not.toBeNull();
      expect(runningBeforeCancel).toBe(true);
      expect(finishRejectedWith).toBe("recognition stopped");
      expect(goneAfterMs, stateAfterCancel).not.toBeNull();
      expect(pidsAfter.filter((p) => !pidsBefore.includes(p))).toEqual([]);
      expect(secondCancelThrew).toBe(false);
      expect(finishAfterCancelRejected).toBe(true);
      expect(
        fs.flagged.filter((f) => f.riff),
        JSON.stringify(fs.flagged),
      ).toEqual([]);
    });

    describe.skipIf(!OLLAMA_GATED)("clean-up modes with a real local model", () => {
      const provider = new OllamaProvider({
        baseUrl: OLLAMA_URL,
        chatModel: OLLAMA_MODEL,
        generateTimeoutMs: 120_000,
        fetch: (url, init) => {
          let model: string | undefined;
          if (typeof init?.body === "string") {
            try {
              model = (JSON.parse(init.body) as { model?: string }).model;
            } catch {
              // not JSON
            }
          }
          requests.push({ url: String(url), model });
          return fetch(url, init);
        },
      });
      const registry = new ProviderRegistry();
      registry.register(provider);
      const ai = new AiService({
        registry,
        policy: { allowed: () => false },
        auditCloudSend: () => undefined,
        settings: () => ({
          enabled: true,
          cloudOptIn: { public: false, internal: false, sensitive: false },
        }),
      });
      const lastReply = { text: null as string | null };
      const generate = cleanupGenerateWith(ai);
      const recording = async (request: GenerateRequest, signal?: AbortSignal) => {
        const text = await generate(request, signal);
        lastReply.text = text;
        return text;
      };

      it("the local Ollama has llama3.2 (digest recorded) and is warmed up", async () => {
        const tags = (await (await fetch(`${OLLAMA_URL}/api/tags`)).json()) as {
          models: { name: string; digest: string; size: number }[];
        };
        const m = tags.models.find((x) => x.name === `${OLLAMA_MODEL}:latest`);
        expect(m, "llama3.2:latest is not pulled").toBeDefined();
        env["Ollama model"] =
          `${m!.name}, digest ${m!.digest}, size ${m!.size} B (from GET ${OLLAMA_URL}/api/tags)`;
        const v = (await (await fetch(`${OLLAMA_URL}/api/version`)).json()) as { version: string };
        env["Ollama version"] = v.version;
        const t0 = Date.now();
        const outcome = await ai.generateLocal(
          {
            privacy: "sensitive",
            purpose: "warm up",
            messages: [{ role: "user", content: "Say ok." }],
            maxTokens: 8,
          },
          { provider: "ollama" },
        );
        warmup = `one \`generateLocal\` call, ${Date.now() - t0} ms, reply ${JSON.stringify(outcome.result.text.slice(0, 40))}`;
      });

      it.each(["jfk", "say-samantha", "say-daniel", "say-karen"])(
        "cleans up the real transcript of %s in all three modes, 3 runs each",
        async (id) => {
          const candidates = samples.filter(
            (s) => s.id === id && s.variant === "shipped" && s.transcript.trim() !== "",
          );
          const sample = candidates[0];
          expect(sample, "no non-empty transcript exists for this sample").toBeDefined();
          const input = normaliseText(sample!.transcript);
          for (const mode of ["as_said", "natural", "polished"] as const) {
            for (let rep = 1; rep <= REPS; rep++) {
              lastReply.text = null;
              const t0 = Date.now();
              const result = await cleanUp(input, { mode, generate: recording });
              const latencyMs = Date.now() - t0;
              const reply = lastReply.text;
              const normalisedReply = reply === null ? null : normaliseText(reply);
              const added = addedTokens(input, result.text);
              cleanups.push({
                sampleId: id,
                transcriptVariant: sample!.variant,
                mode,
                rep,
                input,
                rawReply: reply,
                output: result.text,
                used: result.used,
                skipped: result.skipped ?? null,
                acceptCleanupOnReply:
                  mode === "as_said" || normalisedReply === null
                    ? null
                    : acceptCleanup(input, normalisedReply, mode),
                addedNumbers: result.used ? added.addedNumbers : [],
                addedNames: result.used ? added.addedNames : [],
                latencyMs,
              });
              // Structural: whatever the model wrote, an accepted result satisfies the code's own rule.
              if (result.used) {
                expect(mode).not.toBe("as_said");
                expect(
                  acceptCleanup(input, result.text, mode as Exclude<CleanupMode, "as_said">),
                ).toBe(true);
              } else {
                expect(result.text).toBe(input);
              }
            }
          }
        },
      );

      it("every model request went to loopback Ollama with llama3.2", () => {
        expect(requests.length).toBeGreaterThan(0);
        for (const r of requests) {
          expect(r.url.startsWith(`${OLLAMA_URL}/`)).toBe(true);
          if (r.url.endsWith("/api/chat")) expect(r.model).toBe(OLLAMA_MODEL);
        }
      });
    });
  },
);

// ---------------------------------------------------------------------------------------------
// Ungated checks of the helpers themselves (no binary, no model)
// ---------------------------------------------------------------------------------------------

describe("real-dictation helpers", () => {
  it("applies the documented normalisation rule", () => {
    expect(werTokens("Sold 1,250 units, Lisbon! O’clock; 3:30 well-known 'quoted'")).toEqual([
      "sold",
      "1250",
      "units",
      "lisbon",
      "o'clock",
      "3",
      "30",
      "well",
      "known",
      "quoted",
    ]);
    expect(werTokens("42")).not.toEqual(werTokens("forty-two"));
  });

  it("computes word error rate with substitutions, deletions and insertions", () => {
    expect(wordErrorRate("a b c d", "a b c d")).toMatchObject({ wer: 0, words: 4 });
    expect(wordErrorRate("a b c d", "a x c d")).toMatchObject({ substitutions: 1, wer: 0.25 });
    expect(wordErrorRate("a b c d", "a c d")).toMatchObject({ deletions: 1, wer: 0.25 });
    expect(wordErrorRate("a b c d", "a b x c d")).toMatchObject({ insertions: 1, wer: 0.25 });
    expect(wordErrorRate("a b", "")).toMatchObject({ deletions: 2, wer: 1 });
    expect(wordErrorRate("", "")).toMatchObject({ wer: 0 });
  });

  it("decodes a WAV with an extra chunk into 100 ms pushes", () => {
    const pcm = Int16Array.from({ length: 3_300 }, (_, i) => i - 1000);
    const data = new Uint8Array(pcm.buffer.slice(0));
    const head = new Uint8Array(12 + 24 + 12 + 8);
    const v = new DataView(head.buffer);
    const put = (o: number, s: string) =>
      [...s].forEach((ch, i) => (head[o + i] = ch.charCodeAt(0)));
    put(0, "RIFF");
    v.setUint32(4, 36 + 12 + data.length, true);
    put(8, "WAVE");
    put(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 16_000, true);
    v.setUint32(28, 32_000, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    put(36, "LIST");
    v.setUint32(40, 4, true);
    put(44, "abcd");
    put(48, "data");
    v.setUint32(52, data.length, true);
    const file = new Uint8Array(head.length + data.length);
    file.set(head);
    file.set(data, head.length);
    const decoded = decodeWav(file);
    expect([decoded.sampleRate, decoded.channels, decoded.bits]).toEqual([16_000, 1, 16]);
    expect([...decoded.samples]).toEqual([...pcm]);
    const chunks = toChunks(decoded.samples);
    expect(chunks.map((c) => c.length)).toEqual([1_600, 1_600, 100]);
    expect(() => decodeWav(new Uint8Array(20))).toThrow();
  });
});
