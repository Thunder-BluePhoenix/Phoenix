// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChainedRecognizer,
  FakeRecognizer,
  ParakeetSherpaRecognizer,
  buildSpeechRecognizer,
  parseSherpaOutput,
  parseSpeechEngineOrder,
  runProcess,
  type ProcessRunner,
} from "../src";

// Copied from the official sherpa-onnx documentation, "Decode wave files" of
// https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html
// (stdout carries only this one line; the rest below is stderr in sherpa-onnx-offline.cc).
const DOC_STDOUT =
  '{"lang": "", "emotion": "", "event": "", "text": "Well, I don\'t wish to see it any more, observed Phoebe, turning away her eyes. It is certainly very like the old portrait", "timestamps": [1.04, 1.04, 1.12, 1.20], "durations": [], "tokens":[" We", "ll", ",", " I"], "ys_log_probs": [-0.002837, -0.000404], "words": []}\n';
const DOC_TEXT =
  "Well, I don't wish to see it any more, observed Phoebe, turning away her eyes. It is certainly very like the old portrait";
const DOC_STDERR_LINES =
  "Creating recognizer ...\nrecognizer created in 0.865 s\nStarted\nDone!\n\n/a/b/0.wav\n----\nnum threads: 2\ndecoding method: greedy_search\nElapsed seconds: 0.239 s\nReal time factor (RTF): 0.239 / 7.435 = 0.032\n";

let root: string;
let models: string;
let temp: string;
let program: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "phoenix-parakeet-test-"));
  models = join(root, "models");
  temp = join(root, "tmp");
  await mkdir(models);
  await mkdir(temp);
  for (const name of ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"])
    await writeFile(join(models, name), new Uint8Array(2048));
  program = join(root, "sherpa-onnx-offline");
  await writeFile(program, "#!/bin/sh\n");
  await chmod(program, 0o755);
});
afterEach(() => rm(root, { recursive: true, force: true }));

function make(run: ProcessRunner, extra: { modelDir?: string; executable?: string } = {}) {
  return new ParakeetSherpaRecognizer({
    modelDir: extra.modelDir ?? models,
    executable: extra.executable ?? program,
    tempRoot: temp,
    run,
  });
}
const leftovers = () => readdir(temp);

describe("parseSherpaOutput", () => {
  it("reads the text of the official doc's stdout line", () => {
    expect(parseSherpaOutput(DOC_STDOUT)).toBe(DOC_TEXT);
  });
  it("ignores log lines and takes the first JSON object with a string text", () => {
    expect(parseSherpaOutput(`${DOC_STDERR_LINES}{"text": 3}\nnot json {\n${DOC_STDOUT}`)).toBe(
      DOC_TEXT,
    );
  });
  it("keeps an empty transcription empty (that is not an error)", () => {
    expect(parseSherpaOutput('{"lang": "", "text": "", "tokens": []}\n')).toBe("");
  });
  it("neutralises control characters and collapses whitespace in hostile text", () => {
    const hostile = JSON.stringify({ text: "a\u0000b\u001b[31m\n\n c\u202ed\r\te" });
    expect(parseSherpaOutput(hostile)).toBe("a b [31m c d e");
  });
  it("bounds the text", () => {
    const out = parseSherpaOutput(JSON.stringify({ text: "x".repeat(200_000) }));
    expect(out.length).toBe(64 * 1024);
  });
  it("throws a fixed error when no line is a result", () => {
    for (const raw of ["", "hello", "[1,2]", "null", '{"text":null}', "{broken"])
      expect(() => parseSherpaOutput(raw)).toThrow("recogniser output not understood");
  });
});

describe("ParakeetSherpaRecognizer", () => {
  it("runs the documented flags, argv only, on a private 0600 file in a 0700 directory, then erases it", async () => {
    let seen:
      | { exe: string; args: readonly string[]; stdin: number; dirMode: number; fileMode: number }
      | undefined;
    let header = "";
    let fileBytes = 0;
    let wavMemory: Uint8Array | undefined;
    const run: ProcessRunner = async (exe, args, input) => {
      const file = args.at(-1)!;
      const dir = join(file, "..");
      const [d, f] = await Promise.all([stat(dir), stat(file)]);
      seen = {
        exe,
        args,
        stdin: input.length,
        dirMode: d.mode & 0o777,
        fileMode: f.mode & 0o777,
      };
      fileBytes = f.size;
      header = readFileSync(file).subarray(0, 12).toString("latin1");
      wavMemory = input;
      return DOC_STDOUT;
    };
    const recognizer = make(run);
    const session = recognizer.start();
    session.push(new Int16Array([5, 6, 7]));
    session.push(new Int16Array([8]));
    await expect(session.finish()).resolves.toEqual({ text: DOC_TEXT });
    expect(seen!.exe).toBe(program);
    expect(seen!.args.slice(0, 6)).toEqual([
      `--tokens=${join(models, "tokens.txt")}`,
      `--encoder=${join(models, "encoder.int8.onnx")}`,
      `--decoder=${join(models, "decoder.int8.onnx")}`,
      `--joiner=${join(models, "joiner.int8.onnx")}`,
      "--model-type=nemo_transducer",
      "--num-threads=2",
    ]);
    expect(seen!.args).toHaveLength(7);
    expect(seen!.args.at(-1)).toMatch(/phoenix-parakeet-[^/]+\/audio\.wav$/);
    expect(seen!.stdin).toBe(0);
    expect(wavMemory).toBeDefined();
    if (process.platform !== "win32") {
      expect(seen!.dirMode).toBe(0o700);
      expect(seen!.fileMode).toBe(0o600);
    }
    expect(header.startsWith("RIFF")).toBe(true);
    expect(header.endsWith("WAVE")).toBe(true);
    expect(fileBytes).toBe(44 + 8);
    expect(await leftovers()).toEqual([]);
  });

  it("removes the file when the program fails, times out, is cancelled or prints nonsense", async () => {
    const fails: ProcessRunner = () => Promise.reject(new Error("recogniser failed"));
    const timesOut: ProcessRunner = () => Promise.reject(new Error("recognition stopped"));
    const nonsense: ProcessRunner = () => Promise.resolve("garbage\n");
    for (const [run, message] of [
      [fails, "recogniser failed"],
      [timesOut, "recognition stopped"],
      [nonsense, "recogniser output not understood"],
    ] as const) {
      const session = make(run).start();
      session.push(new Int16Array(100));
      await expect(session.finish()).rejects.toThrow(message);
      expect(await leftovers()).toEqual([]);
    }
  });

  it("cancel while the program runs aborts it and still removes the file", async () => {
    const { promise: running, resolve: started } = Promise.withResolvers<void>();
    const run: ProcessRunner = async (_e, args, _i, signal) => {
      expect((await stat(args.at(-1)!)).isFile()).toBe(true);
      started();
      const waiting = Promise.withResolvers<string>();
      signal.addEventListener("abort", () => waiting.reject(new Error("recognition stopped")));
      return waiting.promise;
    };
    const session = make(run).start();
    session.push(new Int16Array(10));
    const pending = session.finish();
    const settled = pending.then(
      () => "ok",
      (e: Error) => e.message,
    );
    await running;
    session.cancel();
    expect(await settled).toBe("recognition stopped");
    expect(await leftovers()).toEqual([]);
  });

  it("cancel before finish writes nothing; finish after cancel is refused", async () => {
    const run = vi.fn<ProcessRunner>(() => Promise.resolve(DOC_STDOUT));
    const session = make(run).start();
    session.push(new Int16Array(10));
    session.cancel();
    session.cancel();
    await expect(session.finish()).rejects.toThrow("recognition stopped");
    expect(run).not.toHaveBeenCalled();
    expect(await leftovers()).toEqual([]);
  });

  it("an empty transcription is returned as empty text", async () => {
    const session = make(() => Promise.resolve('{"text": ""}\n')).start();
    session.push(new Int16Array(10));
    await expect(session.finish()).resolves.toEqual({ text: "" });
  });

  it("availability names the missing piece, never a path, and always says audio_on_disk", async () => {
    const run: ProcessRunner = () => Promise.resolve("");
    const ok = await make(run).availability();
    expect(ok).toMatchObject({
      available: true,
      engine: "Parakeet (sherpa-onnx)",
      audio_on_disk: true,
    });
    const noModel = await make(run, { modelDir: join(root, "nope") }).availability();
    expect(noModel).toMatchObject({ available: false, audio_on_disk: true });
    expect(noModel.detail).not.toContain(root);
    const noProgram = await make(run, { executable: join(root, "missing") }).availability();
    expect(noProgram).toMatchObject({
      available: false,
      detail: expect.stringContaining("sherpa-onnx-offline"),
    });
    expect(noProgram.detail).not.toContain(root);
    expect(() => make(run, { modelDir: join(root, "nope") }).start()).toThrow(
      "recogniser unavailable",
    );
  });

  it("accepts the fp32 file names and rejects a relative model directory", async () => {
    const fp32 = join(root, "fp32");
    await mkdir(fp32);
    for (const name of ["encoder.onnx", "decoder.onnx", "joiner.onnx", "tokens.txt"])
      await writeFile(join(fp32, name), new Uint8Array(2048));
    const run: ProcessRunner = () => Promise.resolve("");
    expect((await make(run, { modelDir: fp32 }).availability()).available).toBe(true);
    expect(() => new ParakeetSherpaRecognizer({ modelDir: "models", run })).toThrow(TypeError);
  });
});

describe("the real process runner (shared bounds)", () => {
  it("kills a program whose output is too large", async () => {
    await expect(
      runProcess(
        process.execPath,
        ["-e", "process.stdout.write('x'.repeat(400000)); setTimeout(()=>{}, 30000)"],
        new Uint8Array(0),
        new AbortController().signal,
      ),
    ).rejects.toThrow("recogniser output too large");
  });
  it("kills a program that outlives the timeout (fake timers)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = runProcess(
        process.execPath,
        ["-e", "setTimeout(()=>{}, 30000)"],
        new Uint8Array(0),
        new AbortController().signal,
      );
      const settled = pending.then(
        () => "ok",
        (e: Error) => e.message,
      );
      await vi.advanceTimersByTimeAsync(60_001);
      expect(await settled).toBe("recognition stopped");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("speech engine selection and fallback", () => {
  const fake = (transcript: string, available = true) =>
    new FakeRecognizer({ transcript, available });

  it("uses the first available engine in the owner's order", async () => {
    const chain = new ChainedRecognizer([
      { id: "parakeet", recognizer: fake("p") },
      { id: "whisper", recognizer: fake("w") },
    ]);
    const a = await chain.availability();
    expect(a.available).toBe(true);
    expect(a.engines).toEqual([
      expect.objectContaining({ id: "parakeet", available: true, active: true }),
      expect.objectContaining({ id: "whisper", available: true, active: false }),
    ]);
    const s = chain.start();
    s.push(new Int16Array(1));
    await expect(s.finish()).resolves.toEqual({ text: "p" });
  });

  it("falls back only when an engine is unavailable, and says why", async () => {
    const chain = new ChainedRecognizer([
      { id: "parakeet", recognizer: fake("p", false) },
      { id: "whisper", recognizer: fake("w") },
    ]);
    const a = await chain.availability();
    expect(a.detail).toContain("Using whisper because parakeet is not available");
    expect(a.engines?.map((e) => [e.id, e.available, e.active])).toEqual([
      ["parakeet", false, false],
      ["whisper", true, true],
    ]);
    const s = chain.start();
    s.push(new Int16Array(1));
    await expect(s.finish()).resolves.toEqual({ text: "w" });
  });

  it("never falls back on an empty transcription or a failed recognition", async () => {
    const second = fake("second");
    const empty = new ChainedRecognizer([
      { id: "parakeet", recognizer: fake("") },
      { id: "whisper", recognizer: second },
    ]);
    await empty.availability();
    const s = empty.start();
    s.push(new Int16Array(1));
    await expect(s.finish()).resolves.toEqual({ text: "" });
    const failing = new ChainedRecognizer([
      { id: "parakeet", recognizer: new FakeRecognizer({ transcript: "", failWith: "boom" }) },
      { id: "whisper", recognizer: second },
    ]);
    await failing.availability();
    const f = failing.start();
    f.push(new Int16Array(1));
    await expect(f.finish()).rejects.toThrow("boom");
    expect(second.sessions).toHaveLength(0);
  });

  it("reports unavailable with every reason, and refuses to start", async () => {
    const chain = new ChainedRecognizer([
      { id: "parakeet", recognizer: fake("p", false) },
      { id: "whisper", recognizer: fake("w", false) },
    ]);
    const a = await chain.availability();
    expect(a.available).toBe(false);
    expect(a.detail).toContain("parakeet:");
    expect(a.detail).toContain("whisper:");
    expect(() => chain.start()).toThrow("recogniser unavailable");
  });

  it("reports audio_on_disk of the ACTIVE engine only", async () => {
    const onDisk = {
      availability: () =>
        Promise.resolve({ available: true, detail: "d", audio_on_disk: true, engine: "x" }),
      start: () => fake("x").start(),
    };
    const first = await new ChainedRecognizer([
      { id: "parakeet", recognizer: onDisk },
      { id: "whisper", recognizer: fake("w") },
    ]).availability();
    expect(first.audio_on_disk).toBe(true);
    const second = await new ChainedRecognizer([
      { id: "whisper", recognizer: fake("w") },
      { id: "parakeet", recognizer: onDisk },
    ]).availability();
    expect(second.audio_on_disk).toBe(false);
  });

  it("parses the owner's list strictly", () => {
    expect(parseSpeechEngineOrder(undefined)).toEqual(["whisper"]);
    expect(parseSpeechEngineOrder("")).toEqual(["whisper"]);
    expect(parseSpeechEngineOrder(" Parakeet , whisper ")).toEqual(["parakeet", "whisper"]);
    expect(() => parseSpeechEngineOrder("whisper,apple")).toThrow(TypeError);
    expect(() => parseSpeechEngineOrder("whisper,whisper")).toThrow(TypeError);
  });

  it("defaults to Whisper only; Parakeet needs both the list and the model directory", async () => {
    expect(buildSpeechRecognizer({})).toBeNull();
    expect(buildSpeechRecognizer({ parakeetModelDir: models })).toBeNull();
    expect(buildSpeechRecognizer({ order: "parakeet" })).not.toBeNull();
    const whisperOnly = await buildSpeechRecognizer({
      whisperModelPath: join(root, "none.bin"),
      parakeetModelDir: models,
    })!.availability();
    expect(whisperOnly.engines?.map((e) => e.id)).toEqual(["whisper"]);
    const both = await buildSpeechRecognizer({
      whisperModelPath: join(root, "none.bin"),
      parakeetModelDir: models,
      order: "whisper,parakeet",
    })!.availability();
    expect(both.engines?.map((e) => e.id)).toEqual(["whisper", "parakeet"]);
    expect(both.engines?.[0]).toMatchObject({ available: false });
    const unconfigured = await buildSpeechRecognizer({ order: "parakeet" })!.availability();
    expect(unconfigured).toMatchObject({ available: false });
    expect(unconfigured.detail).toContain("No Parakeet model directory is configured");
  });
});
