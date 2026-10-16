// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  BYTES_PER_SECOND,
  DEFAULT_DICTATION_SETTINGS,
  DictationSessions,
  FakeRecognizer,
  SESSION_LIMITS,
  WhisperStdinRecognizer,
  cleanWhisperOutput,
  localDay,
  patchSettings,
  readSettings,
  streakDays,
  summarise,
  wavHeader,
  type DictationSessionDeps,
  type DictationSettings,
  type FinishedSession,
  type ProcessRunner,
  type StatsRow,
  type Timers,
} from "../src";

/** A manual clock and timer queue: no real timers. */
interface Clock {
  now(): number;
  timers: Timers;
  advance(ms: number): void;
}

function clock(): Clock {
  let now = 1_000_000;
  const pending: { at: number; fn: () => void; live: boolean }[] = [];
  const timers: Timers = {
    after(fn, ms) {
      const t = { at: now + ms, fn, live: true };
      pending.push(t);
      return () => {
        t.live = false;
      };
    },
  };
  return {
    now: () => now,
    timers,
    advance(ms: number) {
      now += ms;
      for (const t of pending) {
        if (t.live && t.at <= now) {
          t.live = false;
          t.fn();
        }
      }
    },
  };
}

const ON: DictationSettings = { ...DEFAULT_DICTATION_SETTINGS, enabled: true };

interface Rig {
  sessions: DictationSessions;
  recognizer: FakeRecognizer;
  state: { settings: DictationSettings; kill: boolean };
  listening: boolean[];
  finished: FinishedSession[];
  audit: { action: string; details: Record<string, unknown> }[];
  c: Clock;
}

function rig(
  overrides: Partial<DictationSessionDeps> = {},
  options: { transcript?: string; settings?: DictationSettings } = {},
): Rig {
  const c = clock();
  const recognizer = new FakeRecognizer({
    transcript: options.transcript ?? "hello from the microphone",
  });
  const state = { settings: options.settings ?? ON, kill: false };
  const listening: boolean[] = [];
  const finished: FinishedSession[] = [];
  const audit: { action: string; details: Record<string, unknown> }[] = [];
  const sessions = new DictationSessions({
    recognizer,
    settings: () => state.settings,
    killSwitchEngaged: () => state.kill,
    generate: () => null,
    onListening: (on) => void listening.push(on),
    onFinished: (done) => void finished.push(done),
    audit: (action, details) => void audit.push({ action, details }),
    timers: c.timers,
    now: c.now,
    newId: () => `dic_${"0".repeat(31)}${(sessionCounter++ % 10).toString()}`,
    ...overrides,
  });
  return { sessions, recognizer, state, listening, finished, audit, c };
}
let sessionCounter = 1;

/** 100 ms of non-zero PCM as bytes. */
const frame = (ms = 100) => {
  const bytes = new Uint8Array(Math.round((ms / 1000) * BYTES_PER_SECOND));
  bytes.fill(7);
  return bytes;
};
const nonZero = (chunks: Int16Array[]) => chunks.some((c) => c.some((v) => v !== 0));

describe("dictation sessions", () => {
  it("is OFF by default: nothing starts, no recogniser session, no LISTENING", async () => {
    const r = rig({}, { settings: DEFAULT_DICTATION_SETTINGS });
    await expect(r.sessions.start()).rejects.toMatchObject({ kind: "disabled" });
    expect(r.recognizer.sessions).toHaveLength(0);
    expect(r.listening).toEqual([]);
    expect(readSettings(null).enabled).toBe(false);
    expect(readSettings({ enabled: "yes" }).enabled).toBe(false); // malformed stored value reads as off
  });

  it("happy path: audio is bracketed by listening on/off, text comes back, counts only are reported", async () => {
    const r = rig();
    const { id } = await r.sessions.start("com.example.app");
    expect(r.listening).toEqual([true]);
    const stream = r.sessions.openStream(id, () => {});
    stream.push(frame(500));
    r.c.advance(600);
    stream.push(frame(500));
    const out = await r.sessions.finish(id);
    expect(out).toMatchObject({ text: "hello from the microphone", words: 4 });
    expect(r.listening).toEqual([true, false]);
    expect(r.finished).toEqual([{ app: "com.example.app", words: 4, speech_ms: 1000 }]);
    expect(r.sessions.active()).toBeNull();
    expect(JSON.stringify(r.audit)).not.toContain("microphone");
    expect(r.audit.map((a) => a.action)).toEqual(["dictation.start", "dictation.finish"]);
    // The audio handed to the recogniser was zeroed after finish.
    expect(nonZero(r.recognizer.sessions[0]!.chunks)).toBe(false);
  });

  it("allows one active session and a single use stream", async () => {
    const r = rig();
    const { id } = await r.sessions.start();
    await expect(r.sessions.start()).rejects.toMatchObject({ kind: "busy" });
    r.sessions.openStream(id, () => {});
    expect(r.sessions.streamAvailable(id)).toBe(false);
    expect(() => r.sessions.openStream(id, () => {})).toThrow(/already used/);
    expect(() => r.sessions.openStream("dic_unknown", () => {})).toThrow(/No such/);
  });

  it("rejects a bad app id", async () => {
    const r = rig();
    await expect(r.sessions.start("../../etc/passwd")).rejects.toMatchObject({ kind: "invalid" });
    await expect(r.sessions.start("a b")).rejects.toMatchObject({ kind: "invalid" });
  });

  it("limits: frame size, odd length, total bytes, rate, and wall-clock length each END the session and zero the audio", async () => {
    const cases: [string, (s: Rig, id: string) => void, RegExp][] = [
      [
        "oversized frame",
        (r, id) =>
          r.sessions
            .openStream(id, () => {})
            .push(new Uint8Array(SESSION_LIMITS.maxFrameBytes + 2).fill(1)),
        /invalid audio frame/,
      ],
      [
        "odd frame",
        (r, id) => r.sessions.openStream(id, () => {}).push(new Uint8Array(3).fill(1)),
        /invalid audio frame/,
      ],
      [
        "empty frame",
        (r, id) => r.sessions.openStream(id, () => {}).push(new Uint8Array(0)),
        /invalid audio frame/,
      ],
      [
        "too fast",
        (r, id) => {
          const s = r.sessions.openStream(id, () => {});
          for (let i = 0; i < 200; i++)
            s.push(new Uint8Array(SESSION_LIMITS.maxFrameBytes).fill(1));
        },
        /faster than a microphone/,
      ],
    ];
    for (const [name, act, message] of cases) {
      const r = rig();
      const { id } = await r.sessions.start();
      // some real audio first so there is something to zero
      const s = r.sessions.openStream(id, () => {});
      s.push(frame(100));
      expect(() => act({ ...r, sessions: { openStream: () => s } } as never, id), name).toThrow(
        message,
      );
      expect(r.sessions.active(), name).toBeNull();
      expect(r.listening, name).toEqual([true, false]);
      expect(nonZero(r.recognizer.sessions[0]!.chunks), name).toBe(false);
      expect(r.recognizer.sessions[0]!.state, name).toBe("cancelled");
      await expect(r.sessions.finish(id), name).rejects.toMatchObject({ kind: "aborted" });
    }
  });

  it("total byte cap: more than 120 s of PCM ends the session", async () => {
    const r = rig();
    const { id } = await r.sessions.start();
    const s = r.sessions.openStream(id, () => {});
    let sent = 0;
    // Keep within the rate limit by moving the clock; the byte cap must still hold.
    expect(() => {
      for (;;) {
        r.c.advance(2000);
        s.push(new Uint8Array(SESSION_LIMITS.maxFrameBytes).fill(1));
        sent += SESSION_LIMITS.maxFrameBytes;
      }
    }).toThrow();
    expect(sent).toBeLessThanOrEqual(SESSION_LIMITS.maxBytes);
    expect(r.sessions.active()).toBeNull();
    expect(nonZero(r.recognizer.sessions[0]!.chunks)).toBe(false);
  });

  it("max session length: the timer ends it, zeroes the audio and publishes idle", async () => {
    const r = rig();
    const { id } = await r.sessions.start();
    r.sessions.openStream(id, () => {}).push(frame(100));
    r.c.advance(SESSION_LIMITS.maxSeconds * 1000 + 1);
    expect(r.sessions.active()).toBeNull();
    expect(r.listening).toEqual([true, false]);
    expect(nonZero(r.recognizer.sessions[0]!.chunks)).toBe(false);
    await expect(r.sessions.finish(id)).rejects.toThrow(/maximum length/);
    expect(r.audit.at(-1)).toMatchObject({
      action: "dictation.abort",
      details: { reason: "max_length" },
    });
  });

  it("cancel zeroes the PCM and publishes idle; cancelling twice is fine", async () => {
    const r = rig();
    const { id } = await r.sessions.start();
    r.sessions.openStream(id, () => {}).push(frame(200));
    const chunks = r.recognizer.sessions[0]!.chunks;
    expect(nonZero(chunks)).toBe(true);
    r.sessions.cancel(id);
    expect(nonZero(chunks)).toBe(false);
    expect(chunks.every((c) => c.every((v) => v === 0))).toBe(true);
    expect(r.listening).toEqual([true, false]);
    expect(r.recognizer.sessions[0]!.state).toBe("cancelled");
    expect(() => r.sessions.cancel(id)).not.toThrow();
    expect(() => r.sessions.cancel("dic_neverexisted")).toThrow(/No such/);
  });

  it("every exit path zeroes the PCM: kill switch, feature disabled, closed connection, recogniser failure, shutdown, timeout", async () => {
    const paths: [string, (r: Rig, id: string) => Promise<void> | void][] = [
      [
        "kill switch (push)",
        (r) => {
          r.state.kill = true;
        },
      ],
      ["kill switch (abortAll)", (r) => r.sessions.abortAll("kill_switch")],
      [
        "feature disabled",
        (r) => {
          r.state.settings = { ...ON, enabled: false };
          r.sessions.abortAll("disabled");
        },
      ],
      ["shutdown", (r) => r.sessions.abortAll("shutdown")],
    ];
    for (const [name, act] of paths) {
      const r = rig();
      const { id } = await r.sessions.start();
      const s = r.sessions.openStream(id, () => {});
      s.push(frame(100));
      await act(r, id);
      if (name === "kill switch (push)") expect(() => s.push(frame(10))).toThrow(/emergency stop/);
      expect(r.sessions.active(), name).toBeNull();
      expect(nonZero(r.recognizer.sessions[0]!.chunks), name).toBe(false);
      expect(r.listening, name).toEqual([true, false]);
    }
    // closed connection
    {
      const r = rig();
      const { id } = await r.sessions.start();
      const ended: string[] = [];
      const s = r.sessions.openStream(id, (reason) => ended.push(reason));
      s.push(frame(100));
      s.closed();
      expect(r.sessions.active()).toBeNull();
      expect(nonZero(r.recognizer.sessions[0]!.chunks)).toBe(false);
      expect(r.listening).toEqual([true, false]);
    }
    // recogniser failure
    {
      const r = rig({
        recognizer: new FakeRecognizer({
          transcript: "x",
          failWith: "model crashed: /Users/secret/path",
        }),
      });
      const { id } = await r.sessions.start();
      r.sessions.openStream(id, () => {}).push(frame(100));
      await expect(r.sessions.finish(id)).rejects.toThrow("Speech recognition failed");
      expect(r.sessions.active()).toBeNull();
      expect(r.listening).toEqual([true, false]);
    }
    // recognition timeout
    {
      const fake = new FakeRecognizer({
        transcript: "x",
        gate: Promise.withResolvers<void>().promise,
      });
      const r = rig({ recognizer: fake });
      const { id } = await r.sessions.start();
      r.sessions.openStream(id, () => {}).push(frame(100));
      const pending = r.sessions.finish(id);
      const settled = pending.then(
        () => "ok",
        (e: Error) => e.message,
      );
      r.c.advance(SESSION_LIMITS.finishTimeoutMs + 1);
      expect(await settled).toMatch(/too long/);
      expect(nonZero(fake.sessions[0]!.chunks)).toBe(false);
      expect(r.listening).toEqual([true, false]);
    }
  });

  it("the stream is told when the session ends, so its socket can close", async () => {
    const r = rig();
    const { id } = await r.sessions.start();
    const ended: string[] = [];
    r.sessions.openStream(id, (reason) => ended.push(reason));
    r.sessions.abortAll("kill_switch");
    expect(ended).toEqual(["kill_switch"]);
  });

  it("kill switch / disabling while recognising discards the result", async () => {
    const gate = Promise.withResolvers<void>();
    const r = rig({
      recognizer: new FakeRecognizer({ transcript: "secret words here", gate: gate.promise }),
    });
    const { id } = await r.sessions.start();
    r.sessions.openStream(id, () => {}).push(frame(100));
    const pending = r.sessions.finish(id);
    const settled = pending.then(
      () => "text returned",
      (e: Error) => e.message,
    );
    r.sessions.abortAll("kill_switch");
    gate.resolve();
    expect(await settled).toMatch(/emergency stop/);
    expect(r.finished).toEqual([]);
  });

  it("finish is refused while off or under the emergency stop, and ends the session", async () => {
    const r = rig();
    const { id } = await r.sessions.start();
    r.state.kill = true;
    await expect(r.sessions.finish(id)).rejects.toMatchObject({ kind: "disabled" });
    expect(r.sessions.active()).toBeNull();
    expect(r.listening).toEqual([true, false]);
  });

  it("an `end` makes LISTENING stop at once; a late frame is dropped and the session can still finish", async () => {
    const r = rig();
    const { id } = await r.sessions.start();
    const s = r.sessions.openStream(id, () => {});
    s.push(frame(200));
    s.end();
    expect(r.listening).toEqual([true, false]);
    expect(() => s.push(frame(10))).toThrow(/after the dictation ended/);
    expect((await r.sessions.finish(id)).words).toBe(4);
    expect(r.listening).toEqual([true, false]);
  });

  it("rate-limits starts", async () => {
    const r = rig();
    for (let i = 0; i < SESSION_LIMITS.maxStarts; i++) {
      const { id } = await r.sessions.start();
      r.sessions.cancel(id);
    }
    await expect(r.sessions.start()).rejects.toThrow(/Too many/);
    r.c.advance(SESSION_LIMITS.startWindowMs + 1);
    await expect(r.sessions.start()).resolves.toBeTruthy();
  });

  it("an unavailable recogniser is reported honestly and nothing starts", async () => {
    const r = rig({ recognizer: new FakeRecognizer({ transcript: "x", available: false }) });
    await expect(r.sessions.start()).rejects.toMatchObject({ kind: "unavailable" });
    expect(r.listening).toEqual([]);
  });

  it("uses the per-app clean-up mode, falling back to the default", async () => {
    const calls: string[] = [];
    const settings = patchSettings(ON, {
      default_mode: "as_said",
      app_modes: { "com.polish.app": "polished" },
    });
    const r = rig(
      {
        generate: () => async (req) => (
          calls.push(req.messages[0]!.content.slice(0, 40)),
          "Hello from the microphone."
        ),
      },
      { settings },
    );
    for (const app of ["com.polish.app", "com.other.app"]) {
      const { id } = await r.sessions.start(app);
      r.sessions.openStream(id, () => {}).push(frame(100));
      await r.sessions.finish(id);
    }
    expect(calls).toHaveLength(1);
  });
});

describe("settings validation", () => {
  it("validates every field and refuses unknown ones", () => {
    expect(() => patchSettings(ON, { typing_wpm: 5 })).toThrow();
    expect(() => patchSettings(ON, { typing_wpm: 40.5 })).toThrow();
    expect(() => patchSettings(ON, { default_mode: "creative" })).toThrow();
    expect(() => patchSettings(ON, { app_modes: { "bad id": "natural" } })).toThrow();
    expect(() => patchSettings(ON, { app_modes: { ok: "weird" } })).toThrow();
    expect(() => patchSettings(ON, { surprise: 1 })).toThrow(/Unknown setting/);
    expect(() => patchSettings(ON, null)).toThrow();
    expect(patchSettings(ON, { typing_wpm: 60 }).typing_wpm).toBe(60);
  });
});

describe("statistics math", () => {
  const rows: StatsRow[] = [
    { day: "2026-03-10", app: "a.app", words: 400, speech_ms: 120_000, sessions: 4 },
    { day: "2026-03-11", app: "b.app", words: 100, speech_ms: 60_000, sessions: 2 },
    { day: "2026-03-11", app: "a.app", words: 100, speech_ms: 30_000, sessions: 1 },
    { day: "2026-03-13", app: "", words: 40, speech_ms: 20_000, sessions: 1 },
  ];
  it("words, time saved, average wpm, streak and top apps", () => {
    const s = summarise(rows, 40, "2026-03-11");
    expect(s.words).toBe(640);
    expect(s.sessions).toBe(8);
    expect(s.speech_ms).toBe(230_000);
    expect(s.typing_ms).toBe(960_000); // 640 words / 40 wpm = 16 min
    expect(s.saved_ms).toBe(730_000);
    expect(s.average_wpm).toBe(167.0); // 640 / (230 s / 60)
    expect(s.streak_days).toBe(2); // 10th and 11th
    expect(s.top_apps).toEqual([
      { app: "a.app", words: 500, sessions: 5 },
      { app: "b.app", words: 100, sessions: 2 },
      { app: "", words: 40, sessions: 1 },
    ]);
  });
  it("saved time never goes negative, empty stats are zeros, and a streak survives until the day is over", () => {
    expect(
      summarise(
        [{ day: "2026-03-10", app: "x", words: 10, speech_ms: 600_000, sessions: 1 }],
        40,
        "2026-03-10",
      ).saved_ms,
    ).toBe(0);
    expect(summarise([], 40, "2026-03-10")).toMatchObject({
      words: 0,
      average_wpm: 0,
      streak_days: 0,
      top_apps: [],
    });
    expect(streakDays(["2026-03-09", "2026-03-10"], "2026-03-11")).toBe(2); // yesterday still counts
    expect(streakDays(["2026-03-08", "2026-03-10"], "2026-03-11")).toBe(1);
    expect(streakDays(["2026-02-28", "2026-03-01"], "2026-03-01")).toBe(2); // across a month end
    expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe("2026-01-05");
  });
});

describe("whisper.cpp over stdin (no audio file)", () => {
  it("builds a WAV in memory, passes `-` as the input, never a path to an audio file, and zeroes it", async () => {
    let captured:
      { args: readonly string[]; header: string; bytes: number; sample: number } | undefined;
    let wavRef: Uint8Array | undefined;
    const run: ProcessRunner = async (_exe, args, input) => {
      wavRef = input;
      captured = {
        args,
        header:
          Buffer.from(input.subarray(0, 4)).toString("ascii") +
          Buffer.from(input.subarray(8, 12)).toString("ascii"),
        bytes: input.byteLength,
        sample: new DataView(input.buffer, input.byteOffset).getInt16(44, true),
      };
      return " [BLANK_AUDIO]\n Hello world. \n(music)\n";
    };
    const recognizer = new WhisperStdinRecognizer({ modelPath: "/models/m.bin", run });
    const session = recognizer.start();
    session.push(new Int16Array([5, 6, 7]));
    session.push(new Int16Array([8]));
    await expect(session.finish()).resolves.toEqual({ text: "Hello world." });
    expect(captured).toMatchObject({ header: "RIFFWAVE", bytes: 44 + 8, sample: 5 });
    expect(captured!.args.at(-1)).toBe("-");
    expect(captured!.args.some((a) => a === "-f" || a.startsWith("-o"))).toBe(false);
    expect(wavRef!.every((b) => b === 0)).toBe(true);
    expect(wavHeader(8).byteLength).toBe(44);
    expect(cleanWhisperOutput("[_BEG_]\n a\n b")).toBe("a b");
  });
  it("cancel aborts the process; availability is false for a missing model", async () => {
    let aborted = false;
    const run: ProcessRunner = (_e, _a, _i, signal) => {
      const waiting = Promise.withResolvers<string>();
      signal.addEventListener("abort", () => {
        aborted = true;
        waiting.reject(new Error("recognition stopped"));
      });
      return waiting.promise;
    };
    const recognizer = new WhisperStdinRecognizer({
      modelPath: "/definitely/not/a/model.bin",
      run,
    });
    expect(await recognizer.availability()).toMatchObject({ available: false });
    const session = recognizer.start();
    session.push(new Int16Array(10));
    const pending = session.finish();
    const settled = pending.then(
      () => "ok",
      () => "rejected",
    );
    session.cancel();
    expect(await settled).toBe("rejected");
    expect(aborted).toBe(true);
  });
});
