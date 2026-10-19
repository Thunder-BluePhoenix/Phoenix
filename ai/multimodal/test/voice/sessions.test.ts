// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_VOICE_SETTINGS,
  FakeRecognizer,
  VoiceSessions,
  dispatchRequest,
  patchVoiceSettings,
  readVoiceSettings,
  type VoiceActions,
  type VoiceApprovals,
  type VoiceAuditAction,
  type VoiceSessionDeps,
  type VoiceSettings,
  type VoiceStream,
  type VoiceStreamMessage,
  type VoiceTool,
} from "../../src";
import { bytesOf, clock, tone, type Clock } from "./helpers";

const ON: VoiceSettings = { enabled: true };
const GIT: VoiceTool = { name: "git.status", sideEffect: "read", inputSchema: {} };
const WRITE: VoiceTool = { name: "spotify.play_pause", sideEffect: "write", inputSchema: {} };
const SECRET_PHRASE = "zebra marmalade quantum";
const FRAME_MS = 20;

interface Rig {
  sessions: VoiceSessions;
  recognizer: FakeRecognizer;
  c: Clock;
  state: { settings: VoiceSettings; kill: boolean };
  awake: boolean[];
  audit: { action: VoiceAuditAction; details: Record<string, unknown> }[];
  calls: string[];
  denied: string[];
  pending: { id: string }[];
  messages: VoiceStreamMessage[];
  ended: string[];
  /** Transcripts handed out one per recognised utterance. */
  say: string[];
  start(): Promise<VoiceStream>;
  /** Feeds loud audio then enough quiet to end the utterance, one real-time frame at a time. */
  speak(stream: VoiceStream, speechMs?: number): void;
  quiet(stream: VoiceStream, ms: number): void;
  reply(): Promise<Extract<VoiceStreamMessage, { type: "reply" }>>;
}

function rig(
  options: {
    tools?: VoiceTool[];
    call?: VoiceActions["call"];
    recognizer?: ConstructorParameters<typeof FakeRecognizer>[0];
    settings?: VoiceSettings;
    deps?: Partial<VoiceSessionDeps>;
  } = {},
): Rig {
  const c = clock();
  const say: string[] = [];
  const recognizer = new FakeRecognizer(
    options.recognizer ?? { transcript: () => say.shift() ?? "" },
  );
  const state = { settings: options.settings ?? ON, kill: false };
  const r: Rig = {
    sessions: undefined as unknown as VoiceSessions,
    recognizer,
    c,
    state,
    awake: [],
    audit: [],
    calls: [],
    denied: [],
    pending: [],
    messages: [],
    ended: [],
    say,
    start: undefined as unknown as Rig["start"],
    speak: undefined as unknown as Rig["speak"],
    quiet: undefined as unknown as Rig["quiet"],
    reply: undefined as unknown as Rig["reply"],
  };
  const actions: VoiceActions = {
    tools: () => options.tools ?? [GIT, WRITE],
    call:
      options.call ??
      ((tool) => {
        r.calls.push(tool);
        return Promise.resolve({
          output: {
            repositories: [{ name: "Phoenix", branch: "main", changed: 3, conflicts: [] }],
          },
        });
      }),
  };
  const approvals: VoiceApprovals = {
    pending: () => r.pending,
    deny: (id) => void r.denied.push(id),
  };
  r.sessions = new VoiceSessions({
    recognizer,
    settings: () => state.settings,
    killSwitchEngaged: () => state.kill,
    actions,
    approvals,
    onAwake: (on) => void r.awake.push(on),
    audit: (action, details) => void r.audit.push({ action, details }),
    timers: c.timers,
    now: c.now,
    ...options.deps,
  });
  r.start = async () => {
    const { id } = await r.sessions.start();
    return r.sessions.openStream(
      id,
      (m) => void r.messages.push(m),
      (reason) => void r.ended.push(reason),
    );
  };
  r.quiet = (stream, ms) => {
    for (let t = 0; t < ms; t += FRAME_MS) {
      c.advance(FRAME_MS);
      stream.push(bytesOf(tone(FRAME_MS, 40)));
    }
  };
  r.speak = (stream, speechMs = 600) => {
    for (let t = 0; t < speechMs; t += FRAME_MS) {
      c.advance(FRAME_MS);
      stream.push(bytesOf(tone(FRAME_MS, 3000)));
    }
    r.quiet(stream, 700); // past the 600 ms hangover
  };
  r.reply = () =>
    vi.waitFor(() => {
      const found = r.messages.find((m) => m.type === "reply");
      if (!found || found.type !== "reply") throw new Error("no reply yet");
      return found;
    });
  return r;
}

const allZero = (rec: FakeRecognizer) =>
  rec.sessions.length > 0 &&
  rec.sessions.every((s) => s.chunks.every((chunk) => chunk.every((sample) => sample === 0)));
const hadAudio = (rec: FakeRecognizer) =>
  rec.sessions.some((s) => s.chunks.some((chunk) => chunk.some((sample) => sample !== 0)));

describe("settings", () => {
  it("is off by default and validates strictly", () => {
    expect(DEFAULT_VOICE_SETTINGS.enabled).toBe(false);
    expect(readVoiceSettings(null).enabled).toBe(false);
    expect(readVoiceSettings({ enabled: "yes" }).enabled).toBe(false);
    expect(readVoiceSettings({ enabled: true, nope: 1 }).enabled).toBe(false);
    expect(patchVoiceSettings({ enabled: false }, { enabled: true }).enabled).toBe(true);
    expect(() => patchVoiceSettings({ enabled: false }, { enabled: 1 })).toThrow();
    expect(() => patchVoiceSettings({ enabled: false }, [])).toThrow();
  });
});

describe("starting", () => {
  it("refuses to start while disabled (the default), while the kill switch is engaged, and without a recogniser", async () => {
    const off = rig({ settings: DEFAULT_VOICE_SETTINGS });
    await expect(off.sessions.start()).rejects.toMatchObject({ kind: "disabled" });
    expect(off.recognizer.sessions).toHaveLength(0);
    const killed = rig();
    killed.state.kill = true;
    await expect(killed.sessions.start()).rejects.toMatchObject({ kind: "disabled" });
    const none = rig({ recognizer: { transcript: "", available: false } });
    await expect(none.sessions.start()).rejects.toMatchObject({ kind: "unavailable" });
    expect(off.audit).toHaveLength(0);
  });

  it("allows one session at a time and a start window limit", async () => {
    const r = rig();
    await r.start();
    await expect(r.sessions.start()).rejects.toMatchObject({ kind: "busy" });
    const many = rig({ deps: { limits: { maxStarts: 2 } } });
    for (let i = 0; i < 2; i++) {
      const s = await many.start();
      s.closed();
    }
    await expect(many.sessions.start()).rejects.toMatchObject({ kind: "limit" });
  });

  it("ends a session whose audio stream is never opened", async () => {
    const r = rig();
    const { id } = await r.sessions.start();
    expect(r.sessions.streamAvailable(id)).toBe(true);
    r.c.advance(16_000);
    expect(r.sessions.active()).toBeNull();
    expect(r.audit.at(-1)).toMatchObject({
      action: "voice.stop",
      details: { reason: "stream_not_opened" },
    });
  });

  it("opens the stream once", async () => {
    const r = rig();
    const { id } = await r.sessions.start();
    r.sessions.openStream(
      id,
      () => {},
      () => {},
    );
    expect(r.sessions.streamAvailable(id)).toBe(false);
    expect(() =>
      r.sessions.openStream(
        id,
        () => {},
        () => {},
      ),
    ).toThrow(/already used/);
  });
});

describe("VAD first", () => {
  it("never starts the recogniser while the room is quiet", async () => {
    const r = rig();
    const stream = await r.start();
    r.quiet(stream, 5_000);
    expect(r.recognizer.sessions).toHaveLength(0);
    expect(r.messages).toEqual([]);
  });

  it("drops an utterance that is not the wake phrase: no reply, no wake audit, audio zeroed", async () => {
    const r = rig();
    r.say.push(`hello ${SECRET_PHRASE}`);
    const stream = await r.start();
    r.speak(stream);
    await vi.waitFor(() => expect(r.recognizer.sessions[0]?.state).toBe("cancelled"));
    expect(r.recognizer.sessions).toHaveLength(1);
    expect(hadAudio(r.recognizer)).toBe(false); // zeroed by now
    expect(allZero(r.recognizer)).toBe(true);
    expect(r.audit.map((a) => a.action)).toEqual(["voice.start"]);
    expect(r.messages.filter((m) => m.type === "reply")).toHaveLength(0);
    expect(r.awake).toEqual([]);
  });
});

describe("wake and request", () => {
  it("'ok fawkes what is my git status' in one breath runs the read tool and replies", async () => {
    const r = rig();
    r.say.push("OK Fawkes, what is my git status?");
    const stream = await r.start();
    r.speak(stream);
    const reply = await r.reply();
    expect(r.calls).toEqual(["git.status"]);
    expect(reply).toMatchObject({ outcome: "ok", intent: "tool" });
    expect(reply.text).toBe("Phoenix is on main with 3 changes.");
    expect(r.audit.map((a) => a.action)).toEqual([
      "voice.start",
      "voice.wake",
      "voice.request",
      "voice.action",
    ]);
    expect(r.audit[3]!.details).toMatchObject({ tool: "git.status", outcome: "ok" });
    expect(allZero(r.recognizer)).toBe(true);
  });

  it("the wake phrase alone opens an awake window (LISTENING); the next utterance is the request", async () => {
    const r = rig();
    r.say.push("ok fawkes", "what is my git status");
    const stream = await r.start();
    r.speak(stream);
    await vi.waitFor(() => expect(r.awake).toEqual([true]));
    expect(r.messages).toContainEqual({ type: "state", state: "awake" });
    r.speak(stream);
    const reply = await r.reply();
    expect(reply.outcome).toBe("ok");
    expect(r.awake).toEqual([true, false]);
    expect(r.sessions.active()?.phase).toBe("waiting");
  });

  it("the awake window closes on its own and the session keeps waiting for the wake phrase", async () => {
    const r = rig();
    r.say.push("ok fawkes", "what is my git status");
    const stream = await r.start();
    r.speak(stream);
    await vi.waitFor(() => expect(r.awake).toEqual([true]));
    r.c.advance(9_000);
    expect(r.awake).toEqual([true, false]);
    expect(r.sessions.active()?.phase).toBe("waiting");
    // The next utterance is not a request any more: it needs the wake phrase again.
    r.speak(stream);
    await vi.waitFor(() => expect(r.recognizer.sessions).toHaveLength(2));
    expect(r.calls).toEqual([]);
  });

  it("audit entries carry ids, tool names and outcomes, never the transcript", async () => {
    const r = rig();
    r.say.push(`ok fawkes ${SECRET_PHRASE} what is my git status`);
    const stream = await r.start();
    r.speak(stream);
    await r.reply();
    stream.closed();
    const text = JSON.stringify(r.audit).toLowerCase();
    for (const word of [SECRET_PHRASE, "zebra", "marmalade", "quantum", "ok fawkes", "git status"])
      expect(text).not.toContain(word);
    expect(r.audit.at(-1)).toMatchObject({
      action: "voice.stop",
      details: { reason: "connection_closed" },
    });
  });

  it("an unavailable or refused request is spoken, not executed", async () => {
    const r = rig();
    r.say.push("ok fawkes search the web for cats");
    const stream = await r.start();
    r.speak(stream);
    expect((await r.reply()).outcome).toBe("unavailable");
    expect(r.calls).toEqual([]);
  });

  it("a tool failure is spoken generically", async () => {
    const r = rig({ call: () => Promise.reject(new Error("secret internal detail")) });
    r.say.push("ok fawkes git status");
    const stream = await r.start();
    r.speak(stream);
    const reply = await r.reply();
    expect(reply).toMatchObject({ outcome: "failed", text: "I could not run that." });
    expect(JSON.stringify(r.audit)).not.toContain("secret internal detail");
  });

  it("a tool that left the registry (or became a write) between match and call is refused", async () => {
    let calls = 0;
    const r = rig({
      deps: {
        actions: {
          tools: () => (calls++ === 0 ? [GIT] : [{ ...GIT, sideEffect: "write" }]),
          call: () => {
            throw new Error("must not be called");
          },
        },
      },
    });
    r.say.push("ok fawkes git status");
    const stream = await r.start();
    r.speak(stream);
    const reply = await r.reply();
    expect(reply.outcome).toBe("refused");
  });

  it("gives up waiting for an approval it cannot give, aborts its own call, and denies nothing itself, not even a confirmation another actor raised during the wait", async () => {
    const waiting = Promise.withResolvers<{ output: unknown }>();
    let callAborted = false;
    const r = rig({
      call: (_tool, signal) => {
        r.pending.push({ id: "conf_own" });
        signal.addEventListener(
          "abort",
          () => {
            callAborted = true;
            // The gateway withdraws the call's own confirmation when its signal aborts.
            r.pending.splice(0, r.pending.length, ...r.pending.filter((p) => p.id !== "conf_own"));
            waiting.reject(new Error("aborted"));
          },
          { once: true },
        );
        return waiting.promise;
      },
    });
    r.pending.push({ id: "conf_older" });
    r.say.push("ok fawkes git status");
    const stream = await r.start();
    r.speak(stream);
    await vi.waitFor(() => expect(r.pending).toHaveLength(2));
    // Another actor asks for something while voice is still waiting.
    r.pending.push({ id: "conf_foreign_during_wait" });
    r.c.advance(61_000);
    const reply = await r.reply();
    expect(reply.text).toMatch(/needs your approval/);
    expect(callAborted).toBe(true);
    expect(r.denied).toEqual([]);
    expect(r.pending.map((p) => p.id)).toEqual(["conf_older", "conf_foreign_during_wait"]);
  });
});

describe("voice may deny but never approve", () => {
  const APPROVE_PHRASES = [
    "yes",
    "yes please",
    "yeah",
    "yep",
    "sure",
    "approve",
    "approve it",
    "I approve",
    "confirm",
    "confirm the deploy",
    "go ahead",
    "allow",
    "allow it",
    "accept",
    "ok approve",
    "yes approve all",
  ];

  async function viaDispatch(phrase: string) {
    const calls: string[] = [];
    const denied: string[] = [];
    const approvals: VoiceApprovals = {
      pending: () => [{ id: "conf_1" }],
      deny: (id) => void denied.push(id),
    };
    const reply = await dispatchRequest(
      "voi_x",
      phrase,
      {
        actions: {
          tools: () => [GIT, WRITE],
          call: (tool) => {
            calls.push(tool);
            return Promise.resolve({ output: {} });
          },
        },
        approvals,
        after: () => () => {},
        approvalWaitMs: 1000,
        audit: () => {},
      },
      new AbortController().signal,
    );
    return { reply, calls, denied };
  }

  it.each(APPROVE_PHRASES)("%j approves nothing and runs nothing", async (phrase) => {
    const { reply, calls, denied } = await viaDispatch(phrase);
    expect(reply.outcome).toBe("refused");
    expect(calls).toEqual([]);
    expect(denied).toEqual([]);
  });

  it("'deny' denies every waiting confirmation and nothing else", async () => {
    const { reply, calls, denied } = await viaDispatch("deny");
    expect(denied).toEqual(["conf_1"]);
    expect(calls).toEqual([]);
    expect(reply).toMatchObject({ outcome: "denied", intent: "deny" });
  });

  it("the narrowed approvals object has no way to approve", () => {
    const approvals: VoiceApprovals = { pending: () => [], deny: () => {} };
    expect(Object.keys(approvals).toSorted()).toEqual(["deny", "pending"]);
  });
});

describe("audio is zeroed on every way out", () => {
  async function midUtterance(r: Rig) {
    const stream = await r.start();
    for (let t = 0; t < 400; t += FRAME_MS) {
      r.c.advance(FRAME_MS);
      stream.push(bytesOf(tone(FRAME_MS, 3000)));
    }
    return stream;
  }
  const gateChunks = (r: Rig) =>
    (r.sessions as unknown as { live: { gate: { chunks: Int16Array[]; ring: Int16Array } } }).live
      .gate;

  it.each([
    ["stop", (r: Rig) => r.sessions.stop(r.sessions.active()!.id), "stopped"],
    ["kill switch", (r: Rig) => r.sessions.abortAll("kill_switch"), "kill_switch"],
    ["disabled", (r: Rig) => r.sessions.abortAll("disabled"), "disabled"],
    ["shutdown", (r: Rig) => r.sessions.abortAll("shutdown"), "shutdown"],
  ] as const)("%s zeroes the ring and the utterance being captured", async (_name, end, reason) => {
    const r = rig();
    await midUtterance(r);
    const gate = gateChunks(r);
    const chunks = gate.chunks.slice();
    expect(chunks.some((c) => c.some((s) => s !== 0))).toBe(true);
    end(r);
    expect(chunks.every((c) => c.every((s) => s === 0))).toBe(true);
    expect(gate.ring.every((s) => s === 0)).toBe(true);
    expect(r.sessions.active()).toBeNull();
    expect(r.audit.at(-1)).toMatchObject({ action: "voice.stop", details: { reason } });
    expect(r.ended).toEqual([reason]);
  });

  it("the kill switch seen on the next frame ends the session and zeroes the ring", async () => {
    const r = rig();
    const stream = await midUtterance(r);
    const gate = gateChunks(r);
    const chunks = gate.chunks.slice();
    r.state.kill = true;
    expect(() => stream.push(bytesOf(tone(FRAME_MS, 3000)))).toThrow(/emergency stop/);
    expect(chunks.every((c) => c.every((s) => s === 0))).toBe(true);
    expect(r.sessions.active()).toBeNull();
  });

  it("switching the assistant off is seen on the next frame", async () => {
    const r = rig();
    const stream = await midUtterance(r);
    r.state.settings = { enabled: false };
    expect(() => stream.push(bytesOf(tone(FRAME_MS, 3000)))).toThrow(/switched off/);
    expect(r.sessions.active()).toBeNull();
  });

  it("an abort while the recogniser is working cancels it and zeroes the utterance it was given", async () => {
    const gate = Promise.withResolvers<void>();
    const r = rig({ recognizer: { transcript: "ok fawkes git status", gate: gate.promise } });
    const stream = await r.start();
    r.speak(stream);
    await vi.waitFor(() => expect(r.recognizer.sessions).toHaveLength(1));
    expect(hadAudio(r.recognizer)).toBe(true);
    r.sessions.abortAll("kill_switch");
    expect(r.recognizer.sessions[0]!.state).toBe("cancelled");
    expect(allZero(r.recognizer)).toBe(true);
    gate.resolve();
    await vi.waitFor(() => expect(r.recognizer.sessions[0]!.state).toBe("cancelled"));
    expect(r.calls).toEqual([]);
    expect(r.messages.filter((m) => m.type === "reply")).toHaveLength(0);
  });

  it("the connection closing ends the session and zeroes", async () => {
    const r = rig();
    const stream = await midUtterance(r);
    const chunks = gateChunks(r).chunks.slice();
    stream.closed();
    expect(chunks.every((c) => c.every((s) => s === 0))).toBe(true);
    expect(r.ended).toEqual(["connection_closed"]);
  });

  it("a recogniser that fails three times in a row ends the session", async () => {
    const r = rig({ recognizer: { transcript: "x", failWith: "boom" } });
    const stream = await r.start();
    for (let i = 0; i < 3; i++) {
      r.speak(stream);
      await vi.waitFor(() => expect(r.recognizer.sessions).toHaveLength(i + 1));
      // Audio that arrives while an utterance is being recognised is dropped: wait for it to settle.
      if (i < 2) await vi.waitFor(() => expect(r.sessions.active()?.phase).toBe("waiting"));
    }
    await vi.waitFor(() => expect(r.sessions.active()).toBeNull());
    expect(r.audit.at(-1)).toMatchObject({ details: { reason: "recogniser_failed" } });
    expect(allZero(r.recognizer)).toBe(true);
  });
});

describe("frame limits", () => {
  it("ends the session on an odd, empty or oversized frame and on audio faster than real time", async () => {
    for (const frame of [new Uint8Array(3), new Uint8Array(0), new Uint8Array(70_000)]) {
      const r = rig();
      const stream = await r.start();
      expect(() => stream.push(frame)).toThrow(/invalid audio frame/);
      expect(r.sessions.active()).toBeNull();
    }
    const fast = rig();
    const stream = await fast.start();
    // 3 s of audio at once exceeds the 2 s burst allowance
    expect(() => {
      for (let i = 0; i < 150; i++) stream.push(bytesOf(tone(FRAME_MS, 40)));
    }).toThrow(/faster than a microphone/);
    expect(fast.sessions.active()).toBeNull();
  });
});
