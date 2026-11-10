// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 66 MEASUREMENT (not a pass threshold): « OK Fawkes » end to end with REAL speech recognition.
// A real in-process PhoenixRuntime (real ToolGateway, policy engine, permission gateway, audit log,
// event bus and Core HTTP/WebSocket server) with the voice assistant enabled, a real temporary git
// repository, and the real `whisper-cli` + tiny.en model behind the production recogniser chain
// (`buildSpeechRecognizer`). Rendered speech is pushed as binary frames over the REAL
// `/api/voice/stream` WebSocket (the route the browser page's microphone feeds), in real time.
// Skipped unless explicitly enabled:
//
//   PHOENIX_REAL_DICTATION=1 PHOENIX_REAL_WHISPER_MODEL=/tmp/whisper-models/ggml-tiny.en.bin \
//     node ./node_modules/vitest/vitest.mjs run core/runtime/test/real-voice-e2e.test.ts \
//     --testTimeout=60000
//
// Output: docs/evidence/phase-66-real-voice-e2e-<date>.md (+ -raw.json).
//
// COMMITTED BEFORE THE FIRST RUN (never changed afterwards to suit a result):
//   Requests (the only phrases ever used; each was checked against ai/multimodal/src/voice/intent.ts
//   BEFORE running; "what changed in the repository" was NOT used because no rule maps it):
//     R1  "OK Fawkes, git status"                       -> expected intent tool git.status (phrase `git`)
//     R2  "OK Fawkes, what is the status of my services" -> expected tool git.status (phrase `status`/`services`,
//                                                           first enabled read-only conventional tool)
//     R3  "OK Fawkes, is anything happening"            -> expected tool git.status (phrase `happening`)
//   Voices for R1-R3: Samantha (en_US), Daniel (en_GB), Karen (en_AU) -> 9 runs, each its own session.
//   Refusal / confirmation runs (voices Moira, Rishi, Fred; one session each):
//     D1  "OK Fawkes, delete the branch"   -> expected intent refuse (action word "delete"), no tool call
//     A1  "OK Fawkes, approve the request" while a write confirmation (made by another actor through
//         the capability manager) is pending -> expected refuse; the confirmation MUST stay pending
//     A2  "OK Fawkes, deny"                 -> expected intent deny; the one thing voice may do
//   Optional PHOENIX_REAL_OLLAMA path: NOT used. The intent matcher is deterministic text rules; no
//   voice intent routes to a local model, so there is no llama path to exercise.
//   Audio: `say -v <voice> -o x.aiff "<text>"` then `afconvert -f WAVE -d LEI16@16000 -c 1`, in a fresh
//   /tmp dir that is deleted afterwards. SYNTHETIC SYSTEM VOICES, NOT PEOPLE. 400 ms of digital silence
//   is put before and 1000 ms after the speech (a microphone is never exactly cut at the last syllable);
//   frames are 100 ms (1600 samples) paced against the wall clock at 1x real time.
//   Scoring: NONE. Each run records recognised text(s), wake accepted (audit `voice.wake`), intent
//   (audit `voice.request`), the gateway call (spy on ToolGateway.call + audit `policy.decision` and
//   `voice.action`), and the reply text. No recognition rate is asserted; failures are recorded
//   verbatim. What IS asserted is structural only (see the `it` blocks): every gateway call voice made
//   is a read-only tool with empty input and an actor that does not claim trustedByUser; each such
//   call has a policy.decision audit row; no spoken approval ever reaches resolveConfirmation(true);
//   the pending confirmation is still pending after the approve request; no file that starts with
//   RIFF or has the size of the audio was created in any watched root.
// LIMITS (also written into the evidence file): one machine, one English tiny model, synthetic
// system voices, no live microphone, no browser page (the PCM is fed straight into the WebSocket the
// page would use), and NO speech synthesis: the browser's `speechSynthesis` is out of reach here, so
// the "spoken" answer is the reply text the page would hand to it.
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { lstat, mkdtemp, open, readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSpeechRecognizer,
  matchIntent,
  matchWake,
  type RecognizerSession,
  type SpeechRecognizer,
  type VoiceTool,
} from "@phoenix/ai-multimodal";
import { WS_PROTOCOL, WS_TOKEN_PREFIX } from "@phoenix/api";
import { createGitCapability } from "@phoenix/capability-git";
import type { CapabilityModule } from "@phoenix/capability-manager";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { TOKEN, startCore, type TestCore } from "./helpers";

const GATED = Boolean(process.env.PHOENIX_REAL_DICTATION);
const MODEL_PATH = process.env.PHOENIX_REAL_WHISPER_MODEL ?? "";
const EXPECTED_MODEL_SHA1 = "c78c86eb1a8faa21b369bcd33207cc90d64ae9df";
const FRAME_SAMPLES = 1_600;
const LEAD_MS = 400;
const TAIL_MS = 1_000;
const WAV_NEAR_FRACTION = 0.1;
const REPLY_WAIT_MS = 30_000;
const SETTLE_MS = 3_000;

interface Request {
  id: string;
  text: string;
  voice: string;
  expectedIntent: string;
}
const READ_REQUESTS = [
  { id: "R1", text: "OK Fawkes, git status" },
  { id: "R2", text: "OK Fawkes, what is the status of my services" },
  { id: "R3", text: "OK Fawkes, is anything happening" },
];
const READ_VOICES = ["Samantha", "Daniel", "Karen"];
const READ_RUNS: Request[] = READ_REQUESTS.flatMap((r) =>
  READ_VOICES.map((voice) => ({ ...r, id: `${r.id}-${voice}`, voice, expectedIntent: "tool" })),
);
const D1: Request = {
  id: "D1-Moira",
  text: "OK Fawkes, delete the branch",
  voice: "Moira",
  expectedIntent: "refuse",
};
const A1: Request = {
  id: "A1-Rishi",
  text: "OK Fawkes, approve the request",
  voice: "Rishi",
  expectedIntent: "refuse",
};
const A2: Request = {
  id: "A2-Fred",
  text: "OK Fawkes, deny",
  voice: "Fred",
  expectedIntent: "deny",
};

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

// A real delay on purpose: audio is paced at 1x real time into a real WebSocket and a real whisper-cli
// child is polled; no fake clock can advance an OS process or the recogniser.
const sleep = (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};
const localDate = (() => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

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

/** RIFF/WAVE 16-bit PCM: walks the chunks (afconvert adds FLLR padding) and returns the samples. */
function decodeWav(buf: Uint8Array): { samples: Int16Array; rate: number; channels: number } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(...buf.subarray(o, o + 4));
  if (buf.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let rate = 0;
  let channels = 0;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (view.getUint16(body, true) !== 1 || view.getUint16(body + 14, true) !== 16)
        throw new Error("not 16-bit PCM");
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
    } else if (id === "data") {
      const n = Math.floor(Math.min(size, buf.length - body) / 2);
      const samples = new Int16Array(n);
      for (let i = 0; i < n; i++) samples[i] = view.getInt16(body + i * 2, true);
      return { samples, rate, channels };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("no data chunk");
}

// ---- filesystem observation (same idea as ai/multimodal/test/real-dictation.test.ts) --------

interface Root {
  label: string;
  path: string;
  depth: number;
}
type Listing = Map<string, { size: number; mtimeMs: number; kind: string }>;
async function walk(dir: string, depth: number, out: Listing): Promise<void> {
  const names = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const d of names) {
    const path = join(dir, d.name);
    const s = await lstat(path).catch(() => undefined);
    if (!s) continue;
    out.set(path, {
      size: s.size,
      mtimeMs: s.mtimeMs,
      kind: s.isDirectory() ? "dir" : s.isFile() ? "file" : "other",
    });
    if (depth > 1 && d.isDirectory()) await walk(path, depth - 1, out);
  }
}
const snapshot = async (roots: Root[]) => {
  const out = new Map<string, Listing>();
  for (const r of roots) {
    const l: Listing = new Map();
    if (
      await stat(r.path).then(
        () => true,
        () => false,
      )
    )
      await walk(r.path, r.depth, l);
    out.set(r.label, l);
  }
  return out;
};
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
const near = (n: number, bytes: number) =>
  bytes > 0 && Math.abs(n - bytes) <= bytes * WAV_NEAR_FRACTION;
interface Observed {
  root: string;
  path: string;
  size: number;
  growth?: number;
  riff: boolean;
  nearAudioSize: boolean;
}
async function diffRoots(
  before: Map<string, Listing>,
  after: Map<string, Listing>,
  audioBytes: number,
) {
  const created: Observed[] = [];
  const changed: Observed[] = [];
  for (const [label, a] of after) {
    const b = before.get(label) ?? new Map();
    for (const [path, e] of a) {
      if (e.kind !== "file") continue;
      const was = b.get(path);
      if (!was) {
        created.push({
          root: label,
          path,
          size: e.size,
          riff: await startsWithRiff(path),
          nearAudioSize: near(e.size, audioBytes),
        });
      } else if (e.size !== was.size || e.mtimeMs !== was.mtimeMs) {
        changed.push({
          root: label,
          path,
          size: e.size,
          growth: e.size - was.size,
          riff: await startsWithRiff(path),
          nearAudioSize: near(e.size - was.size, audioBytes),
        });
      }
    }
  }
  const flagged = [...created, ...changed].filter((f) => f.riff || f.nearAudioSize);
  return { created, changed, flagged };
}

// ---- the real recogniser, observed -------------------------------------------------------------

interface RecognitionLog {
  samples: number;
  ms: number;
  text: string | null;
  error?: string;
}
/** Wraps the production recogniser chain and records what it was given and what it returned. */
class RecordingRecognizer implements SpeechRecognizer {
  log: RecognitionLog[] = [];
  starts = 0;
  constructor(private readonly inner: SpeechRecognizer) {}
  availability() {
    return this.inner.availability();
  }
  start(): RecognizerSession {
    this.starts++;
    const session = this.inner.start();
    let samples = 0;
    const t0 = Date.now();
    return {
      push: (pcm) => {
        samples += pcm.length;
        session.push(pcm);
      },
      finish: async () => {
        try {
          const r = await session.finish();
          this.log.push({ samples, ms: Date.now() - t0, text: r.text });
          return r;
        } catch (err) {
          this.log.push({
            samples,
            ms: Date.now() - t0,
            text: null,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      },
      cancel: () => session.cancel(),
    };
  }
}

// ---- a real git repository with history and a dirty tree ----------------------------------------

function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "phoenix-real-voice-repo-")));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  const commit = (msg: string) =>
    git("-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", msg);
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git("add", "a.txt");
  commit("first");
  writeFileSync(join(dir, "b.txt"), "two\n");
  git("add", "b.txt");
  commit("second");
  writeFileSync(join(dir, "a.txt"), "one\nthree\n");
  git("add", "a.txt");
  commit("third");
  writeFileSync(join(dir, "a.txt"), "one\nthree\ndirty edit\n"); // modified, uncommitted
  writeFileSync(join(dir, "c.txt"), "untracked\n"); // untracked
  return dir;
}

/** A write-capable capability: voice must never be able to run it or approve its confirmation. */
let writes = 0;
const writer: CapabilityModule = {
  manifest: {
    id: "writer",
    name: "Writer",
    version: "1.0.0",
    description: "Test capability with a write command",
    license: "GPL-3.0-or-later",
    events: ["writer.*"],
    permissions: [],
    data_categories: [],
    commands: [{ name: "write", description: "Write something", side_effect: "write" }],
  },
  commands: {
    write: () => {
      writes++;
      return "written";
    },
  },
};

// ---------------------------------------------------------------------------------------------
// One request through the real Core
// ---------------------------------------------------------------------------------------------

interface AuditRow {
  id: number;
  actor: string;
  action: string;
  decision?: string;
  details: Record<string, unknown>;
}
interface RunRecord {
  id: string;
  voice: string;
  reference: string;
  expectedIntent: string;
  audioMs: number;
  recognitions: RecognitionLog[];
  wakeMatcherOnEachText: boolean[];
  wakeAccepted: boolean;
  intentChosen: string | null;
  intentMatchesExpected: boolean;
  gatewayCalls: { tool: string; input: unknown; actor: unknown; sideEffect: string | null }[];
  policyDecisionRows: AuditRow[];
  voiceAuditRows: { action: string; details: Record<string, unknown> }[];
  reply: { text: string; outcome: string; intent: string; action?: unknown } | null;
  stateMessages: string[];
  busEvents: string[];
  resolveConfirmationCalls: { id: string; approved: boolean; by: unknown }[];
  pendingConfirmationsAfter: number;
  fs: { created: number; changed: number; flagged: Observed[] };
  sessionEndedBy: string | null;
  elapsedMs: number;
  note?: string;
}

const runs: RunRecord[] = [];
const env: Record<string, unknown> = {};
const extra: Record<string, unknown> = {};

interface Rig {
  core: TestCore;
  recorder: RecordingRecognizer;
  roots: Root[];
  workDir: string;
  repo: string;
  wavs: Map<string, { samples: Int16Array }>;
}
let rig: Rig | undefined;

async function render(workDir: string, r: Request): Promise<Int16Array> {
  const aiff = join(workDir, `${r.id}.aiff`);
  const wav = join(workDir, `${r.id}.wav`);
  await run("say", ["-v", r.voice, "-o", aiff, r.text]);
  await run("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
  const d = decodeWav(new Uint8Array(await readFile(wav)));
  if (d.rate !== 16_000 || d.channels !== 1)
    throw new Error(`unexpected WAV ${d.rate}/${d.channels}`);
  const lead = (LEAD_MS * 16_000) / 1000;
  const tail = (TAIL_MS * 16_000) / 1000;
  const out = new Int16Array(lead + d.samples.length + tail);
  out.set(d.samples, lead);
  return out;
}

async function auditRows(core: TestCore): Promise<AuditRow[]> {
  const res = await core.api("GET", "/api/audit?limit=1000");
  return (res.json.entries as AuditRow[]).toSorted((a, b) => a.id - b.id);
}

/** Feeds one rendered request through POST /api/voice/sessions + the real /api/voice/stream socket. */
async function runRequest(r: Request, pcm: Int16Array, note?: string): Promise<RunRecord> {
  const { core, recorder, roots } = rig!;
  const t0 = Date.now();
  const baseline = (await auditRows(core)).at(-1)?.id ?? 0;
  const logStart = recorder.log.length;
  const startsBefore = recorder.starts;
  const callSpy = vi.spyOn(core.runtime.toolGateway, "call");
  const resolveSpy = vi.spyOn(core.runtime.permissions, "resolveConfirmation");
  const busEvents: string[] = [];
  const off = core.runtime.bus.subscribe("real-voice-e2e", "voice.*", (e) => {
    busEvents.push(e.event_type);
  });
  const before = await snapshot(roots);

  const { id } = (await core.api("POST", "/api/voice/sessions", {})).json as { id: string };
  const messages: Record<string, unknown>[] = [];
  const ws = new WebSocket(
    `ws://127.0.0.1:${core.port}/api/voice/stream?session=${id}`,
    [WS_PROTOCOL, WS_TOKEN_PREFIX + TOKEN],
    { headers: { Origin: core.base } },
  );
  const opened = Promise.withResolvers<void>();
  ws.on("open", () => opened.resolve());
  ws.on("error", (e) => opened.reject(e));
  ws.on("message", (data, isBinary) => {
    if (!isBinary) messages.push(JSON.parse(data.toString()) as Record<string, unknown>);
  });
  let closedBy: string | null = null;
  ws.on("close", (code) => {
    closedBy = `socket closed ${code}`;
  });
  await opened.promise;

  // Real time, 100 ms frames, exactly like a microphone page.
  const start = Date.now();
  let sent = 0;
  for (let off2 = 0; off2 < pcm.length; off2 += FRAME_SAMPLES) {
    const frame = pcm.subarray(off2, off2 + FRAME_SAMPLES);
    ws.send(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
    sent += frame.length;
    const wait = start + (sent * 1000) / 16_000 - Date.now();
    if (wait > 0) await sleep(wait);
  }
  // Wait for the reply, or for activity to settle (no reply is a recorded outcome, not a failure).
  const audioEnd = Date.now();
  let lastActivity = Date.now();
  let seen = messages.length + recorder.log.length;
  for (;;) {
    await sleep(100);
    const now = messages.length + recorder.log.length;
    if (now !== seen) {
      seen = now;
      lastActivity = Date.now();
    }
    if (messages.some((m) => m.type === "reply")) break;
    const recognising = recorder.starts > recorder.log.length + (startsBefore - logStart);
    if (!recognising && Date.now() - lastActivity >= SETTLE_MS) break;
    if (Date.now() - audioEnd > REPLY_WAIT_MS) break;
  }
  await sleep(300); // let a trailing audit write land
  const active = (await core.api("GET", "/api/voice/status")).json.active as { id: string } | null;
  if (active?.id === id) await core.api("DELETE", `/api/voice/sessions/${id}`);
  ws.close();
  await core.runtime.bus.drain();
  off();

  const after = await snapshot(roots);
  const fsDiff = await diffRoots(before, after, pcm.length * 2);
  const rows = (await auditRows(core)).filter((row) => row.id > baseline);
  const tools = new Map(core.runtime.toolGateway.tools().map((t) => [t.name, t.sideEffect]));
  const recognitions = recorder.log.slice(logStart);
  const request = rows.find((row) => row.action === "voice.request");
  const reply = messages.find((m) => m.type === "reply") as RunRecord["reply"] | undefined;
  const record: RunRecord = {
    id: r.id,
    voice: r.voice,
    reference: r.text,
    expectedIntent: r.expectedIntent,
    audioMs: Math.round((pcm.length / 16_000) * 1000),
    recognitions,
    wakeMatcherOnEachText: recognitions.map((x) => x.text !== null && matchWake(x.text).matched),
    wakeAccepted: rows.some((row) => row.action === "voice.wake"),
    intentChosen: (request?.details.intent as string | undefined) ?? null,
    intentMatchesExpected: request?.details.intent === r.expectedIntent,
    gatewayCalls: callSpy.mock.calls.map(([c]) => ({
      tool: c.tool,
      input: c.input,
      actor: c.actor,
      sideEffect: tools.get(c.tool) ?? null,
    })),
    policyDecisionRows: rows.filter((row) => row.action === "policy.decision"),
    voiceAuditRows: rows
      .filter((row) => row.action.startsWith("voice."))
      .map((row) => ({ action: row.action, details: row.details })),
    reply: reply
      ? {
          text: reply.text,
          outcome: reply.outcome,
          intent: reply.intent,
          ...(reply.action ? { action: reply.action } : {}),
        }
      : null,
    stateMessages: messages.filter((m) => m.type === "state").map((m) => String(m.state)),
    busEvents,
    resolveConfirmationCalls: resolveSpy.mock.calls.map(([cid, approved, by]) => ({
      id: cid,
      approved,
      by,
    })),
    pendingConfirmationsAfter: core.runtime.permissions.pendingConfirmations().length,
    fs: {
      created: fsDiff.created.length,
      changed: fsDiff.changed.length,
      flagged: fsDiff.flagged,
    },
    sessionEndedBy: closedBy,
    elapsedMs: Date.now() - t0,
    ...(note ? { note } : {}),
  };
  callSpy.mockRestore();
  resolveSpy.mockRestore();
  runs.push(record);
  return record;
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

const cell = (s: unknown) =>
  String(s ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
const q = (s: unknown) => (s === null || s === undefined ? "(none)" : JSON.stringify(s));

function renderReport(): string {
  const out: string[] = [];
  out.push(
    "# Phase 66 real voice end to end",
    "",
    `Generated by \`core/runtime/test/real-voice-e2e.test.ts\` on ${localDate}; do not edit by hand. Raw data: \`phase-66-real-voice-e2e-${localDate}-raw.json\`.`,
    "",
    "**What this is.** A recorded run of rendered speech through the production voice path: the real `/api/voice/stream` WebSocket of an in-process Core (the route the browser page's microphone feeds), the real VAD gate, utterance cut, `WhisperStdinRecognizer` with the real `whisper-cli` and model, the wake matcher, the intent matcher, the real `ToolGateway`, policy engine, permission gateway and audit log, and a real temporary git repository. **What it is not.** Every voice is a macOS system voice: SYNTHETIC, NOT A PERSON. No live microphone, no browser page, no speaker. **Speech synthesis did not run**: the browser's `speechSynthesis` is out of reach here, so the \"spoken answer\" below is the reply text the page would hand to it. The model is the English-only tiny model. One machine, one run. No recognition rate is asserted and none is a benchmark. The exit criterion 'a voice request runs a read-only capability action end to end' stays **unverified** (no live microphone, no real speech synthesis, no person).",
    "",
    "## Setup",
    "",
    ...Object.entries(env).map(
      ([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join("; ") : String(v)}`,
    ),
    "",
    "## Summary (one line per run, nothing omitted)",
    "",
    "| run | voice | recognised text(s) | wake accepted | intent chosen (expected) | gateway call(s) | reply text | outcome |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const r of runs) {
    out.push(
      `| ${r.id} | ${r.voice} | ${cell(r.recognitions.map((x) => q(x.text ?? `ERROR ${x.error}`)).join(" ; ") || "(none)")} | ${r.wakeAccepted} | ${cell(r.intentChosen ?? "(none)")} (${r.expectedIntent}) | ${cell(r.gatewayCalls.map((c) => `${c.tool} [${c.sideEffect}]`).join(", ") || "(none)")} | ${cell(r.reply ? q(r.reply.text) : "(no reply)")} | ${r.reply?.outcome ?? "(no reply)"} |`,
    );
  }
  const readRuns = runs.filter((r) => r.id.startsWith("R"));
  out.push(
    "",
    `Read-only runs: ${readRuns.length}; wake accepted: ${readRuns.filter((r) => r.wakeAccepted).length}; intent equals the expected one: ${readRuns.filter((r) => r.intentMatchesExpected).length}; a gateway call was made: ${readRuns.filter((r) => r.gatewayCalls.length > 0).length}; a reply came back: ${readRuns.filter((r) => r.reply).length}. (Counts of what was observed, not a pass mark.)`,
    "",
    "## Per run",
  );
  for (const r of runs) {
    out.push(
      "",
      `### ${r.id}`,
      "",
      `- Voice: ${r.voice} (synthetic system voice, not a person); reference text: ${q(r.reference)}; audio ${r.audioMs} ms incl. ${LEAD_MS} ms lead and ${TAIL_MS} ms tail silence`,
      `- Recognitions (one per VAD-cut utterance): ${r.recognitions.length === 0 ? "none (the gate cut no utterance, or recognition never finished)" : r.recognitions.map((x) => `${q(x.text)}${x.error ? ` ERROR ${x.error}` : ""} (${x.samples} samples, ${x.ms} ms)`).join("; ")}`,
      `- Wake matcher applied to each recognised text: ${q(r.wakeMatcherOnEachText)}; wake accepted by the session (audit \`voice.wake\`): ${r.wakeAccepted}`,
      `- Intent chosen (audit \`voice.request\`): ${q(r.intentChosen)}; expected: ${r.expectedIntent}`,
      `- Gateway calls (spy on \`ToolGateway.call\`): ${q(r.gatewayCalls)}`,
      `- Audit \`policy.decision\` rows: ${q(r.policyDecisionRows.map((p) => ({ id: p.id, actor: p.actor, decision: p.decision, details: p.details })))}`,
      `- Voice audit rows: ${q(r.voiceAuditRows)}`,
      `- Reply returned to the page (text it would speak): ${q(r.reply)}`,
      `- Stream state messages: ${q(r.stateMessages)}; bus events: ${q(r.busEvents)}`,
      `- \`resolveConfirmation\` calls during the run: ${q(r.resolveConfirmationCalls)}; confirmations still pending after: ${r.pendingConfirmationsAfter}`,
      `- Filesystem (watched roots, before/after): ${r.fs.created} files created, ${r.fs.changed} changed, flagged as audio-like (RIFF header or about the audio's size): ${q(r.fs.flagged)}`,
      `- Elapsed: ${r.elapsedMs} ms${r.note ? `; note: ${r.note}` : ""}`,
    );
  }
  out.push("", "## Other observations", "");
  for (const [k, v] of Object.entries(extra)) out.push(`- ${k}: ${q(v)}`);
  out.push(
    "",
    "## Limits",
    "",
    "- Synthetic system voices (macOS `say`), not people; one English tiny model; one machine; one run.",
    "- The PCM was written to the same WebSocket the page uses, paced at 1x real time; no browser, no `ScriptProcessorNode`, no microphone.",
    "- No speech synthesis: `speechSynthesis` cannot run here, so no answer was spoken.",
    "- The optional local-model path was not exercised: no voice intent routes to a model (the matcher is deterministic text rules).",
    "- The filesystem observation is one run on one machine under the watched roots listed above; it is not proof that no audio is ever written.",
  );
  return out.join("\n") + "\n";
}

afterAll(() => {
  if (!GATED || runs.length === 0) return;
  const dir = fileURLToPath(new URL("../../../docs/evidence/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  const base = `${dir}phase-66-real-voice-e2e-${localDate}`;
  writeFileSync(`${base}.md`, renderReport());
  writeFileSync(`${base}-raw.json`, JSON.stringify({ env, runs, extra }, null, 2));
});

// ---------------------------------------------------------------------------------------------
// Gated run
// ---------------------------------------------------------------------------------------------

function structural(r: RunRecord): void {
  for (const c of r.gatewayCalls) {
    expect(["none", "read"], `${r.id} ${c.tool}`).toContain(c.sideEffect);
    expect(c.input).toEqual({});
    expect(c.actor).toMatchObject({ kind: "agent", id: "voice", trustedByUser: false });
  }
  const decisions = r.policyDecisionRows.filter((p) =>
    r.gatewayCalls.some((c) => p.details.tool === c.tool),
  );
  expect(decisions.length, `${r.id}: a policy.decision per gateway call`).toBeGreaterThanOrEqual(
    r.gatewayCalls.length,
  );
  for (const c of r.resolveConfirmationCalls) expect(c.approved).toBe(false);
  expect(r.fs.flagged).toEqual([]);
}

describe.skipIf(!GATED)(
  "Phase 66 real voice end to end (whisper-cli + real model, system voices, real Core)",
  { timeout: 900_000 },
  () => {
    beforeAll(async () => {
      expect(MODEL_PATH, "set PHOENIX_REAL_WHISPER_MODEL to a ggml model file").not.toBe("");
      const workDir = await mkdtemp("/tmp/phoenix-real-voice-");
      const repo = makeRepo();
      const sha1 = await new Promise<string>((resolve, reject) => {
        const h = createHash("sha1");
        createReadStream(MODEL_PATH)
          .on("data", (c) => h.update(c))
          .on("end", () => resolve(h.digest("hex")))
          .on("error", reject);
      });
      const recorder = new RecordingRecognizer(
        buildSpeechRecognizer({ whisperModelPath: MODEL_PATH })!,
      );
      const core = await startCore(
        {},
        {
          capabilities: [createGitCapability(), writer],
          runtime: { voiceRecognizer: recorder },
        },
      );
      await core.api("POST", "/api/capabilities/git/config", { config: { repositories: [repo] } });
      await core.runtime.capabilities.enable("git");
      await core.runtime.capabilities.enable("writer");
      expect((await core.api("POST", "/api/voice/settings", { enabled: true })).status).toBe(200);

      const candidates: Root[] = [
        { label: "os.tmpdir()", path: tmpdir(), depth: 1 },
        { label: "/tmp", path: "/tmp", depth: 1 },
        { label: "/var/tmp", path: "/var/tmp", depth: 1 },
        { label: "process.cwd()", path: process.cwd(), depth: 1 },
        { label: "<repo>/.phoenix", path: join(process.cwd(), ".phoenix"), depth: 4 },
        { label: "~/.phoenix", path: join(homedir(), ".phoenix"), depth: 4 },
        { label: "Core data dir of this run", path: core.dataDir, depth: 4 },
      ];
      const roots: Root[] = [];
      const seen = new Set<string>();
      for (const c of candidates) {
        if (seen.has(`${c.path}#${c.depth}`)) continue;
        seen.add(`${c.path}#${c.depth}`);
        roots.push(c);
      }
      const wavs = new Map<string, { samples: Int16Array }>();
      for (const r of [...READ_RUNS, D1, A1, A2])
        wavs.set(r.id, { samples: await render(workDir, r) });
      rig = { core, recorder, roots, workDir, repo, wavs };

      env["Date"] = localDate;
      env["Command"] =
        "PHOENIX_REAL_DICTATION=1 PHOENIX_REAL_WHISPER_MODEL=/tmp/whisper-models/ggml-tiny.en.bin node ./node_modules/vitest/vitest.mjs run core/runtime/test/real-voice-e2e.test.ts --testTimeout=60000";
      env["Node"] = process.version;
      env["Platform"] =
        `${process.platform}/${process.arch}; macOS ${await attempt(() => run("sw_vers", ["-productVersion"]))}`;
      env["whisper-cli path"] = await attempt(() => run("/usr/bin/which", ["whisper-cli"]));
      env["whisper.cpp / ggml (brew list --versions)"] = await attempt(() =>
        run("brew", ["list", "--versions", "whisper-cpp", "ggml"]),
      );
      env["Model path"] = MODEL_PATH;
      env["Model size (bytes)"] = (await stat(MODEL_PATH)).size;
      env["Model sha1"] = sha1;
      env["Model sha1 equals the one recorded when downloaded"] = sha1 === EXPECTED_MODEL_SHA1;
      env["git"] = await attempt(() => run("git", ["--version"]));
      env["Repository (real git, 3 commits, one modified and one untracked file)"] = repo;
      env["Repository `git status --porcelain`"] = await attempt(() =>
        run("git", ["-C", repo, "status", "--porcelain"]),
      );
      env["Tools in the registry (name [side effect])"] = core.runtime.toolGateway
        .tools()
        .map((t) => `${t.name} [${t.sideEffect}]`);
      env["say voices used"] = await attempt(() => run("say", ["-v", "?"])).then((all) =>
        all
          .split("\n")
          .filter((l) => [...READ_VOICES, "Moira", "Rishi", "Fred"].some((v) => l.startsWith(v)))
          .map((l) => l.replace(/\s+/g, " "))
          .join(" | "),
      );
      env["Sample generation dir (deleted afterwards)"] = workDir;
      env["Watched roots"] = roots.map((r) => `${r.label} = ${r.path} (depth ${r.depth})`);
      env["Frames"] =
        `${FRAME_SAMPLES} samples (100 ms), paced at 1x real time over the real WebSocket`;
      // What the deterministic matcher says about the REFERENCE texts (recorded, not used to choose anything).
      const tools: VoiceTool[] = core.runtime.toolGateway.tools().map((t) => ({
        name: t.name,
        sideEffect: t.sideEffect,
        inputSchema: t.inputSchema,
      }));
      extra["matchIntent on the reference texts (text only, no audio)"] = Object.fromEntries(
        [...READ_REQUESTS, D1, A1, A2].map((r) => [
          r.text,
          matchIntent(matchWake(r.text).rest, tools),
        ]),
      );
    });

    afterAll(async () => {
      if (!rig) return;
      await rig.core.runtime.stop();
      await rm(rig.workDir, { recursive: true, force: true });
      await rm(rig.repo, { recursive: true, force: true });
      await rm(rig.core.dataDir, { recursive: true, force: true });
    });

    it.each(READ_RUNS.map((r) => r.id))("read-only request %s end to end", async (id) => {
      const r = READ_RUNS.find((x) => x.id === id)!;
      const rec = await runRequest(r, rig!.wavs.get(id)!.samples);
      structural(rec);
      expect(writes).toBe(0);
    });

    it("a write action ('delete the branch') is refused and no tool is called", async () => {
      const rec = await runRequest(D1, rig!.wavs.get(D1.id)!.samples);
      structural(rec);
      // Whatever was recognised, voice must not have called anything for it.
      expect(
        rec.gatewayCalls.filter((c) => c.sideEffect !== "none" && c.sideEffect !== "read"),
      ).toEqual([]);
      expect(writes).toBe(0);
    });

    it("voice cannot approve a confirmation: 'approve' is refused, 'deny' may only deny", async () => {
      const { core } = rig!;
      const asked = core.runtime.capabilities.invokeAndWait("writer", "write", {}, "someone-else");
      await vi.waitFor(() =>
        expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(1),
      );
      const [confirmation] = core.runtime.permissions.pendingConfirmations();
      extra["Pending confirmation created by another actor"] = {
        id: confirmation!.id,
        summary: confirmation!.summary,
      };
      const approve = await runRequest(
        A1,
        rig!.wavs.get(A1.id)!.samples,
        "a write confirmation was pending while this was said",
      );
      structural(approve);
      expect(approve.pendingConfirmationsAfter).toBe(1);
      expect(core.runtime.permissions.pendingConfirmations().map((c) => c.id)).toEqual([
        confirmation!.id,
      ]);
      expect(writes).toBe(0);

      const deny = await runRequest(
        A2,
        rig!.wavs.get(A2.id)!.samples,
        "the same write confirmation was still pending",
      );
      structural(deny);
      for (const c of deny.resolveConfirmationCalls) {
        expect(c.approved).toBe(false);
        expect(c.by).toBe("voice");
      }
      // Clean up a confirmation the (recorded) deny run did not resolve: a denial, by the test.
      const leftover = core.runtime.permissions.pendingConfirmations();
      extra["Confirmation resolved by the test itself because the voice deny run did not"] =
        leftover.length > 0;
      for (const c of leftover)
        core.runtime.permissions.resolveConfirmation(c.id, false, "test-cleanup");
      const op = await asked;
      extra["The write operation's final status"] = op.status;
      expect(op.status).toBe("failed");
      expect(writes).toBe(0);
    });
  },
);
