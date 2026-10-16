// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it, vi } from "vitest";
import {
  DictationError,
  FakeRecognizer,
  NOTETAKER_LIMITS,
  NotetakerSessions,
  type NotetakerEndReason,
  type NotetakerSessionDeps,
  type Timers,
  type TranscriptSegment,
} from "../src";

const WINDOW = 1600; // 0.1 s: tests use tiny windows
const frame = (channel: number, samples: number, value = 7): Uint8Array => {
  const out = new Uint8Array(1 + samples * 2);
  out[0] = channel;
  // Unaligned on purpose: the PCM starts one byte (the channel) into the frame.
  const pcm = new Int16Array(samples).fill(value);
  out.set(new Uint8Array(pcm.buffer), 1);
  return out;
};

interface ManualTimers {
  timers: Timers;
  fire(): void;
  pending: { fn: () => void; ms: number; live: boolean }[];
}

function manualTimers(): ManualTimers {
  const pending: ManualTimers["pending"] = [];
  const timers: Timers = {
    after(fn, ms) {
      const entry = { fn, ms, live: true };
      pending.push(entry);
      return () => {
        entry.live = false;
      };
    },
  };
  return { timers, fire: () => pending.filter((p) => p.live).forEach((p) => p.fn()), pending };
}

interface Rig {
  sessions: NotetakerSessions;
  recognizer: FakeRecognizer;
  enabled: { value: boolean };
  /** The person-bound confirmation: what it answers, and the titles it was asked about. */
  consent: { answer: boolean; asked: (string | null)[] };
  kill: { value: boolean };
  clock: { now: number };
  timers: ManualTimers;
  recording: boolean[];
  segments: TranscriptSegment[];
  ended: { reason: NotetakerEndReason; completed: boolean }[];
  audits: { action: string; details: Record<string, unknown> }[];
}

function rig(
  over: Partial<NotetakerSessionDeps> = {},
  fake: ConstructorParameters<typeof FakeRecognizer>[0] = {
    transcript: (n) => `heard ${n} samples`,
  },
): Rig {
  const recognizer = new FakeRecognizer(fake);
  const enabled = { value: true };
  const kill = { value: false };
  const consent: Rig["consent"] = { answer: true, asked: [] };
  const clock = { now: 1_000_000 };
  const timers = manualTimers();
  const recording: boolean[] = [];
  const segments: TranscriptSegment[] = [];
  const ended: Rig["ended"] = [];
  const audits: Rig["audits"] = [];
  const sessions = new NotetakerSessions({
    recognizer,
    enabled: () => enabled.value,
    killSwitchEngaged: () => kill.value,
    confirmConsent: (info) => {
      consent.asked.push(info.title);
      return Promise.resolve(consent.answer);
    },
    onRecording: (on) => void recording.push(on),
    onStarted: () => {},
    onSegment: (_id, segment) => void segments.push(segment),
    onEnded: (info) => void ended.push({ reason: info.reason, completed: info.completed }),
    audit: (action, details) => void audits.push({ action, details }),
    timers: timers.timers,
    now: () => clock.now,
    windowSamples: WINDOW,
    ...over,
  });
  return {
    sessions,
    recognizer,
    enabled,
    consent,
    kill,
    clock,
    timers,
    recording,
    segments,
    ended,
    audits,
  };
}

const OK = { consent: true, notice_acknowledged: true };
const allZero = (r: Rig) =>
  r.recognizer.sessions.every((s) => s.chunks.every((c) => c.every((v) => v === 0)));

describe("start: the person-bound confirmation is the proof, never the request flags", () => {
  it("asks the confirmation for every start, after the other checks and before anything exists", async () => {
    const r = rig();
    const a = await r.sessions.start({ ...OK, title: "  Board  " });
    expect(r.consent.asked).toEqual(["Board"]);
    r.sessions.cancel(a.id);
    await r.sessions.start(OK);
    expect(r.consent.asked).toEqual(["Board", null]);
    // Refused earlier (off, bad flags): the person is not even asked.
    r.sessions.abortAll("shutdown");
    r.enabled.value = false;
    await expect(r.sessions.start(OK)).rejects.toMatchObject({ kind: "disabled" });
    expect(r.consent.asked).toHaveLength(2);
  });

  it("a no records nothing: no recording event, no recogniser session, no audit, even with both flags true", async () => {
    const r = rig();
    r.consent.answer = false;
    await expect(r.sessions.start(OK)).rejects.toMatchObject({ kind: "invalid" });
    expect(r.recording).toEqual([]);
    expect(r.recognizer.sessions).toHaveLength(0);
    expect(r.audits).toEqual([]);
    expect(r.sessions.active()).toBeNull();
  });

  it("the emergency stop that arrives while the person is answering wins", async () => {
    const gate = Promise.withResolvers<boolean>();
    const r = rig({ confirmConsent: () => gate.promise });
    const pending = r.sessions.start(OK);
    r.kill.value = true;
    gate.resolve(true);
    await expect(pending).rejects.toMatchObject({ kind: "disabled" });
    expect(r.recording).toEqual([]);
  });
});

describe("start: off by default, consent every time, recogniser, one session", () => {
  it("is refused while the notetaker is off, and nothing is recording", async () => {
    const r = rig();
    r.enabled.value = false;
    await expect(r.sessions.start(OK)).rejects.toMatchObject({ kind: "disabled" });
    expect(r.recording).toEqual([]);
  });

  it.each([
    [{ consent: false, notice_acknowledged: true }],
    [{ consent: true, notice_acknowledged: false }],
    [{ consent: true }],
    [{ notice_acknowledged: true }],
    [{}],
    [{ consent: "true", notice_acknowledged: "true" }],
  ])("is refused without consent AND notice_acknowledged being exactly true: %j", async (input) => {
    const r = rig();
    await expect(
      r.sessions.start(input as unknown as Parameters<NotetakerSessions["start"]>[0]),
    ).rejects.toMatchObject({ kind: "invalid" });
    expect(r.recording).toEqual([]);
    expect(r.recognizer.sessions).toHaveLength(0);
  });

  it("an earlier consent does not carry over: the second start needs its own", async () => {
    const r = rig();
    const first = await r.sessions.start(OK);
    r.sessions.cancel(first.id);
    await expect(
      r.sessions.start({ consent: true } as unknown as Parameters<NotetakerSessions["start"]>[0]),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(r.sessions.start(OK)).resolves.toMatchObject({
      id: expect.stringMatching(/^ntk_/),
    });
  });

  it("is refused when the recogniser is unavailable, with its reason", async () => {
    const r = rig({}, { transcript: "x", available: false });
    const err = await r.sessions.start(OK).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DictationError);
    expect(err).toMatchObject({ kind: "unavailable" });
    expect(r.recording).toEqual([]);
  });

  it("is refused while the emergency stop is engaged", async () => {
    const r = rig();
    r.kill.value = true;
    await expect(r.sessions.start(OK)).rejects.toMatchObject({ kind: "disabled" });
  });

  it("has one session: a second start is refused, never queued", async () => {
    const r = rig();
    await r.sessions.start(OK);
    await expect(r.sessions.start(OK)).rejects.toMatchObject({ kind: "busy" });
  });

  it("refuses a title with hidden or control characters or over the limit", async () => {
    const r = rig();
    for (const title of ["a\u202Eb", "a\u200Bb", "a\u0000b", " ", "x".repeat(121)])
      await expect(r.sessions.start({ ...OK, title })).rejects.toMatchObject({ kind: "invalid" });
  });

  it("audits every start with the session id and the flags, no title and no names", async () => {
    const r = rig();
    const s = await r.sessions.start({ ...OK, title: "Secret board meeting" });
    expect(r.audits).toEqual([
      {
        action: "notetaker.start",
        details: { session: s.id, consent: true, notice_acknowledged: true },
      },
    ]);
  });
});

describe("RECORDING brackets the whole capture", () => {
  it("is on from start until the recording ends, and cleared exactly once", async () => {
    const r = rig();
    const s = await r.sessions.start(OK);
    expect(r.recording).toEqual([true]);
    r.sessions.openStream(s.id, () => {}).push(frame(1, 100));
    expect(r.recording).toEqual([true]);
    await r.sessions.stop(s.id);
    expect(r.recording).toEqual([true, false]);
  });

  it.each(["cancel", "kill", "off", "shutdown", "close", "limit"] as const)(
    "is cleared on abort path %s",
    async (path) => {
      const r = rig();
      const s = await r.sessions.start(OK);
      const stream = r.sessions.openStream(s.id, () => {});
      stream.push(frame(1, 100));
      if (path === "cancel") r.sessions.cancel(s.id);
      if (path === "kill") r.sessions.abortAll("kill_switch");
      if (path === "off") r.sessions.abortAll("disabled");
      if (path === "shutdown") r.sessions.abortAll("shutdown");
      if (path === "close") stream.closed();
      if (path === "limit") r.timers.fire();
      expect(r.recording).toEqual([true, false]);
      expect(r.sessions.active()).toBeNull();
    },
  );
});

describe("limits", () => {
  it("ends the session at the maximum length (4 h) and says so", async () => {
    const r = rig();
    const s = await r.sessions.start(OK);
    expect(r.timers.pending[0]!.ms).toBe(4 * 60 * 60 * 1000);
    expect(NOTETAKER_LIMITS.maxSeconds).toBe(14_400);
    const reasons: string[] = [];
    r.sessions.openStream(s.id, (reason) => void reasons.push(reason));
    r.timers.fire();
    expect(reasons).toEqual(["max_length"]);
    expect(r.ended).toEqual([{ reason: "max_length", completed: false }]);
  });

  it("refuses a frame over 1 MiB, an unknown channel, an odd length and an empty frame, ending the session", async () => {
    for (const bad of [
      new Uint8Array(1024 * 1024 + 2).fill(1),
      frame(3, 100),
      frame(0, 100),
      new Uint8Array([1, 0, 0, 0]),
      new Uint8Array([1]),
    ]) {
      const r = rig();
      const s = await r.sessions.start(OK);
      const stream = r.sessions.openStream(s.id, () => {});
      expect(() => stream.push(bad)).toThrow(DictationError);
      expect(r.sessions.active()).toBeNull();
      expect(r.ended[0]!.reason).toBe("bad_frame");
    }
  });

  it("accepts a frame of exactly 1 MiB (channel byte included) when it is paced like real time", async () => {
    const r = rig();
    const s = await r.sessions.start(OK);
    const stream = r.sessions.openStream(s.id, () => {});
    r.clock.now += 3600_000; // an hour in: a 1 MiB frame (~33 s) is well within the rate
    const samples = (1024 * 1024 - 1) / 2;
    expect(Number.isInteger(samples)).toBe(false); // so use the largest even PCM length
    expect(() => stream.push(frame(1, Math.floor(samples)))).not.toThrow();
  });

  it("ends the session when audio arrives faster than twice real time", async () => {
    const r = rig({ windowSamples: 10_000_000 });
    const s = await r.sessions.start(OK);
    const stream = r.sessions.openStream(s.id, () => {});
    // burst 2 s = 32,000 samples at t = 0
    stream.push(frame(1, 16_000));
    stream.push(frame(1, 16_000));
    expect(() => stream.push(frame(1, 1600))).toThrow(/faster/);
    expect(r.ended[0]!.reason).toBe("too_fast");
  });

  it("the rate limit is per channel: microphone and system audio each get real time", async () => {
    const r = rig({ windowSamples: 10_000_000 });
    const s = await r.sessions.start(OK);
    const stream = r.sessions.openStream(s.id, () => {});
    stream.push(frame(1, 16_000));
    stream.push(frame(2, 16_000));
    expect(r.sessions.active()).not.toBeNull();
  });

  it("is single use: the second openStream is refused", async () => {
    const r = rig();
    const s = await r.sessions.start(OK);
    expect(r.sessions.streamAvailable(s.id)).toBe(true);
    r.sessions.openStream(s.id, () => {});
    expect(r.sessions.streamAvailable(s.id)).toBe(false);
    expect(() => r.sessions.openStream(s.id, () => {})).toThrow(DictationError);
  });

  it("refuses frames once the kill switch or the setting turned it off, ending the session", async () => {
    const r = rig();
    const s = await r.sessions.start(OK);
    const stream = r.sessions.openStream(s.id, () => {});
    r.kill.value = true;
    expect(() => stream.push(frame(1, 100))).toThrow(/emergency stop/);
    expect(r.ended[0]!.reason).toBe("kill_switch");
    const r2 = rig();
    const s2 = await r2.sessions.start(OK);
    const stream2 = r2.sessions.openStream(s2.id, () => {});
    r2.enabled.value = false;
    expect(() => stream2.push(frame(1, 100))).toThrow(/switched off/);
    expect(r2.ended[0]!.reason).toBe("disabled");
  });
});

describe("windows: PCM is transcribed in fixed windows and zeroed", () => {
  it("transcribes a full window as soon as it is complete, with the channel's speaker label, and zeroes it", async () => {
    const r = rig();
    const s = await r.sessions.start(OK);
    const stream = r.sessions.openStream(s.id, () => {});
    stream.push(frame(1, WINDOW, 9));
    stream.push(frame(2, WINDOW, 5));
    await r.sessions.stop(s.id);
    expect(r.segments.map((x) => [x.speaker, x.text, x.start_ms, x.end_ms])).toEqual([
      ["You", `heard ${WINDOW} samples`, 0, 100],
      ["Others", `heard ${WINDOW} samples`, 0, 100],
    ]);
    expect(r.recognizer.sessions).toHaveLength(2);
    // The recogniser saw the REAL samples (not a copy of zeros) and they are zero now.
    expect(allZero(r)).toBe(true);
    expect(r.recognizer.sessions[0]!.chunks.flatMap((c) => [...c]).length).toBe(WINDOW);
  });

  it("each window is zeroed right after ITS text was produced, before the next window is read", async () => {
    const seenAtAnswer: number[] = [];
    let recognizer: FakeRecognizer;
    const r = rig(
      {},
      {
        transcript: () => {
          // At the moment the recogniser answers for window N, earlier windows are already zero.
          const live = recognizer.sessions.map((s) => s.chunks.some((c) => c.some((v) => v !== 0)));
          seenAtAnswer.push(live.filter(Boolean).length);
          return "words";
        },
      },
    );
    recognizer = r.recognizer;
    const s = await r.sessions.start(OK);
    const stream = r.sessions.openStream(s.id, () => {});
    stream.push(frame(1, WINDOW));
    stream.push(frame(1, WINDOW));
    await r.sessions.stop(s.id);
    // Window 1 answered while only itself held audio; window 2 answered after window 1 was wiped.
    expect(seenAtAnswer).toEqual([1, 1]);
    expect(allZero(r)).toBe(true);
  });

  it("cuts windows from frames of any size: a frame spanning two windows is split, nothing is lost", async () => {
    const r = rig();
    const s = await r.sessions.start(OK);
    const stream = r.sessions.openStream(s.id, () => {});
    stream.push(frame(1, WINDOW / 2));
    stream.push(frame(1, WINDOW));
    stream.push(frame(1, WINDOW / 2 + 100));
    await r.sessions.stop(s.id);
    const counts = r.recognizer.sessions.map((s) => s.chunks.reduce((n, c) => n + c.length, 0));
    expect(counts).toEqual([WINDOW, WINDOW, 100]);
    expect(allZero(r)).toBe(true);
  });

  it("what is not yet transcribed at stop is transcribed, then wiped", async () => {
    const r = rig();
    const s = await r.sessions.start(OK);
    r.sessions.openStream(s.id, () => {}).push(frame(1, 300, 4));
    const result = await r.sessions.stop(s.id);
    expect(result).toMatchObject({ windows: 1, segments: 1 });
    expect(r.segments[0]).toMatchObject({ speaker: "You", text: "heard 300 samples" });
    expect(allZero(r)).toBe(true);
    expect(r.ended).toEqual([{ reason: "stopped", completed: true }]);
  });

  it("a window with no recognised speech writes no segment", async () => {
    const r = rig({}, { transcript: "  \u200B " });
    const s = await r.sessions.start(OK);
    r.sessions.openStream(s.id, () => {}).push(frame(1, WINDOW));
    const result = await r.sessions.stop(s.id);
    expect(r.segments).toEqual([]);
    expect(result.segments).toBe(0);
  });

  it("reports the segment of a window to the writer BEFORE the next window is processed (incremental)", async () => {
    const gate = Promise.withResolvers<void>();
    const r = rig();
    const s = await r.sessions.start(OK);
    const stream = r.sessions.openStream(s.id, () => {});
    stream.push(frame(1, WINDOW));
    await Promise.resolve();
    await Promise.resolve();
    await vi_waitFor(() => r.segments.length === 1);
    gate.resolve();
    expect(r.sessions.active()).not.toBeNull(); // still recording; the text already exists
    expect(r.segments).toHaveLength(1);
  });
});

/** Polls without real timers: yields to the microtask queue. */
async function vi_waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error("condition not reached");
}

describe("PCM is zeroed on EVERY abort path; the transcript written so far stays", () => {
  type Path = "cancel" | "kill" | "off" | "shutdown" | "close" | "limit" | "bad_frame" | "fail";
  it.each<Path>(["cancel", "kill", "off", "shutdown", "close", "limit", "bad_frame", "fail"])(
    "path %s: audio held (a complete window in flight AND a partial buffer) is zeroed, earlier text stays",
    async (path) => {
      const gate = Promise.withResolvers<void>();
      const r = rig({}, { transcript: "kept words", gate: gate.promise });
      const s = await r.sessions.start(OK);
      const stream = r.sessions.openStream(s.id, () => {});
      // A complete window is handed to the recogniser (it waits on the gate) and a partial buffer remains.
      stream.push(frame(1, WINDOW, 3));
      stream.push(frame(2, 500, 3));
      await vi_waitFor(() => r.recognizer.sessions.length === 1);
      const held = r.recognizer.sessions[0]!.chunks;
      expect(held.some((c) => c.some((v) => v !== 0))).toBe(true); // real audio is held right now
      if (path === "cancel") r.sessions.cancel(s.id);
      if (path === "kill") r.sessions.abortAll("kill_switch");
      if (path === "off") r.sessions.abortAll("disabled");
      if (path === "shutdown") r.sessions.abortAll("shutdown");
      if (path === "close") stream.closed();
      if (path === "limit") r.timers.fire();
      if (path === "bad_frame") expect(() => stream.push(new Uint8Array([9, 0, 0]))).toThrow();
      if (path === "fail") {
        r.kill.value = true;
        expect(() => stream.push(frame(1, 100))).toThrow();
      }
      expect(held.every((c) => c.length === 0 || c.every((v) => v === 0))).toBe(true);
      expect(r.recognizer.sessions[0]!.state).toBe("cancelled");
      expect(r.sessions.active()).toBeNull();
      gate.resolve();
      await vi_waitFor(() => r.ended.length === 1);
      // The window in flight never delivers text after the abort.
      expect(r.segments).toEqual([]);
      expect(r.ended[0]!.completed).toBe(false);
      expect(allZero(r)).toBe(true);
    },
  );

  it("a recogniser failure ends the session and zeroes the window", async () => {
    const r = rig({}, { transcript: "x", failWith: "boom" });
    const s = await r.sessions.start(OK);
    r.sessions.openStream(s.id, () => {}).push(frame(1, WINDOW, 8));
    await vi_waitFor(() => r.ended.length === 1);
    expect(r.ended[0]).toEqual({ reason: "recogniser_failed", completed: false });
    expect(allZero(r)).toBe(true);
    expect(r.recording).toEqual([true, false]);
  });

  it("a partial buffer that never became a window is zeroed too (observed through the zeroing calls)", async () => {
    const zeroed: number[] = [];
    const original = Int16Array.prototype.fill;
    const spy = vi.spyOn(Int16Array.prototype, "fill").mockImplementation(function (
      this: Int16Array,
      value: number,
      ...rest: [number?, number?]
    ) {
      if (value === 0) zeroed.push(this.length);
      return original.call(this, value, ...rest);
    });
    try {
      const r = rig({ windowSamples: 10_000 });
      const s = await r.sessions.start(OK);
      r.sessions.openStream(s.id, () => {}).push(frame(1, 321, 6));
      expect(r.recognizer.sessions).toHaveLength(0); // never reached the recogniser
      zeroed.length = 0;
      r.sessions.cancel(s.id);
      expect(zeroed).toContain(321);
    } finally {
      spy.mockRestore();
    }
  });

  it("earlier windows' text stays after a later abort", async () => {
    const r = rig();
    const s = await r.sessions.start(OK);
    const stream = r.sessions.openStream(s.id, () => {});
    stream.push(frame(1, WINDOW));
    await vi_waitFor(() => r.segments.length === 1);
    stream.push(frame(1, 700));
    r.sessions.cancel(s.id);
    expect(r.segments).toHaveLength(1);
    expect(allZero(r)).toBe(true);
  });

  it("stop after an abort says why; cancel is idempotent", async () => {
    const r = rig();
    const s = await r.sessions.start(OK);
    r.sessions.cancel(s.id);
    r.sessions.cancel(s.id);
    await expect(r.sessions.stop(s.id)).rejects.toMatchObject({ kind: "aborted" });
    expect(() => r.sessions.cancel("ntk_" + "0".repeat(32))).toThrow(DictationError);
  });
});

describe("what the audit hook and the events can see", () => {
  it("audits ids, counts and reasons only: never audio bytes or transcript text", async () => {
    const r = rig({}, { transcript: "zebra quantum marmalade" });
    const s = await r.sessions.start({ ...OK, title: "Private title" });
    r.sessions.openStream(s.id, () => {}).push(frame(1, WINDOW, 12345));
    await r.sessions.stop(s.id);
    const text = JSON.stringify(r.audits);
    expect(text).not.toContain("zebra");
    expect(text).not.toContain("Private title");
    expect(text).not.toContain("12345");
    expect(r.audits.map((a) => a.action)).toEqual(["notetaker.start", "notetaker.stop"]);
  });
});
