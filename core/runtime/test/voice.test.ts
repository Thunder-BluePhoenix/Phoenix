// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// « OK Fawkes » (Phase 66) through a real PhoenixRuntime: the real ToolGateway, policy engine,
// permission gateway, audit log and event bus, with a FakeRecognizer standing in for whisper.cpp.
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeRecognizer, type VoiceStreamMessage } from "@phoenix/ai-multimodal";
import { createGitCapability } from "@phoenix/capability-git";
import type { CapabilityModule } from "@phoenix/capability-manager";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { WS_PROTOCOL, WS_TOKEN_PREFIX } from "@phoenix/api";
import { PolicyAdmin, PolicyStore } from "@phoenix/policy";
import { VOICE_ACTOR } from "../src/voice";
import { TOKEN, startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const FRAME_MS = 20;
const tone = (ms: number, amplitude: number) => new Int16Array(ms * 16).fill(amplitude);
const bytes = (pcm: Int16Array) =>
  new Uint8Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
const SECRET_WORDS = "marmalade quantum zebra";

/** A write-capable capability: voice must never be able to run it. */
let writes = 0;
const writer: CapabilityModule = {
  manifest: {
    id: "writer",
    name: "Writer",
    version: "1.0.0",
    description: "Test capability with a read command and a write command",
    license: "GPL-3.0-or-later",
    events: ["writer.*"],
    permissions: [],
    data_categories: [],
    commands: [
      { name: "status", description: "Read the writer state", side_effect: "read" },
      { name: "write", description: "Write something", side_effect: "write" },
    ],
  },
  commands: {
    status: () => ({
      repositories: [{ name: "Writer", branch: "main", changed: 0, conflicts: [] }],
    }),
    write: () => {
      writes++;
      return "written";
    },
  },
};

function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "phoenix-voice-repo-")));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git("add", "a.txt");
  git("-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "first");
  writeFileSync(join(dir, "b.txt"), "two\n"); // one untracked change
  return dir;
}

/** A manual clock and timer queue shared with the runtime: no real timers, and "real time" is ours. */
function manualClock() {
  let now = 1_000_000;
  const pending: { at: number; fn: () => void; live: boolean }[] = [];
  return {
    now: () => now,
    timers: {
      after(fn: () => void, ms: number) {
        const t = { at: now + ms, fn, live: true };
        pending.push(t);
        return () => {
          t.live = false;
        };
      },
    },
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
type ManualClock = ReturnType<typeof manualClock>;

interface Booted {
  clock: ManualClock;
  core: TestCore;
  recognizer: FakeRecognizer;
  say: string[];
  dir: string;
}

async function boot(): Promise<Booted> {
  const say: string[] = [];
  const recognizer = new FakeRecognizer({ transcript: () => say.shift() ?? "" });
  const dir = repo();
  const clock = manualClock();
  const core = await startCore(
    {},
    {
      capabilities: [createGitCapability(), writer],
      runtime: { voiceRecognizer: recognizer, voice: { timers: clock.timers, now: clock.now } },
    },
  );
  cleanups.push(() => core.runtime.stop());
  await core.api("POST", "/api/capabilities/git/config", { config: { repositories: [dir] } });
  await core.runtime.capabilities.enable("git");
  await core.runtime.capabilities.enable("writer");
  return { core, recognizer, say, dir, clock };
}

const enable = (core: TestCore) => core.api("POST", "/api/voice/settings", { enabled: true });

async function openSession(core: TestCore) {
  const { id } = (await core.api("POST", "/api/voice/sessions", {})).json as { id: string };
  const messages: VoiceStreamMessage[] = [];
  const ended: string[] = [];
  const stream = core.runtime.voice.openStream(
    id,
    (m) => void messages.push(m as VoiceStreamMessage),
    (r) => void ended.push(r),
  );
  return { id, stream, messages, ended };
}

/** Real-time frames: the session rate-limits to twice real time, so the clock advances with them. */
function speak(clock: ManualClock, stream: { push(frame: Uint8Array): void }) {
  for (let t = 0; t < 600; t += FRAME_MS) {
    clock.advance(FRAME_MS);
    stream.push(bytes(tone(FRAME_MS, 3000)));
  }
  for (let t = 0; t < 700; t += FRAME_MS) {
    clock.advance(FRAME_MS);
    stream.push(bytes(tone(FRAME_MS, 40)));
  }
}

const auditRows = async (core: TestCore) =>
  (
    (await core.api("GET", "/api/audit?limit=300")).json.entries as {
      id: number;
      actor: string;
      action: string;
      details: Record<string, unknown>;
    }[]
  ).toSorted((a, b) => a.id - b.id);

describe("voice is off by default", () => {
  it("refuses to start, reports itself off, and never touches the recogniser", async () => {
    const { core, recognizer } = await boot();
    const status = (await core.api("GET", "/api/voice/status")).json;
    expect(status).toMatchObject({ enabled: false, audio_on_disk: false, active: null });
    const refused = await core.api("POST", "/api/voice/sessions", {});
    expect(refused.status).toBe(409);
    expect(refused.json.message).toMatch(/voice assistant is off/i);
    expect(recognizer.sessions).toHaveLength(0);
  });

  it("without a recogniser the Core says unavailable and starts nothing", async () => {
    const core = await startCore();
    cleanups.push(() => core.runtime.stop());
    await enable(core);
    expect((await core.api("POST", "/api/voice/sessions", {})).status).toBe(503);
  });

  it("requires the session token on every route and validates the settings body", async () => {
    const { core } = await boot();
    for (const [method, path] of [
      ["GET", "/api/voice/status"],
      ["GET", "/api/voice/settings"],
      ["POST", "/api/voice/settings"],
      ["POST", "/api/voice/sessions"],
    ] as const) {
      const res = await fetch(core.base + path, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    expect((await core.api("POST", "/api/voice/settings", { enabled: "yes" })).status).toBe(400);
    expect((await core.api("POST", "/api/voice/settings", { nope: true })).status).toBe(400);
    expect((await core.api("POST", "/api/voice/sessions", { extra: 1 })).status).toBe(400);
  });

  it("refuses a forged voice.listening/voice.idle event from the API", async () => {
    const { core } = await boot();
    const res = await core.api("POST", "/api/events", {
      event_type: "voice.idle",
      source: "core",
      severity: "info",
      payload: {},
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("end to end", () => {
  it("'ok fawkes what is my git status' runs git.status through the real ToolGateway and returns text", async () => {
    const { core, say, dir, clock } = await boot();
    await enable(core);
    say.push(`OK Fawkes, ${SECRET_WORDS} what is my git status`);
    const { stream, messages } = await openSession(core);
    speak(clock, stream);
    const reply = await vi.waitFor(() => {
      const m = messages.find((x) => x.type === "reply");
      if (!m) throw new Error("no reply");
      return m;
    });
    expect(reply).toMatchObject({ type: "reply", outcome: "ok", intent: "tool" });
    expect((reply as { text: string }).text).toBe(
      `${dir.split("/").at(-1)} is on main with 1 change.`,
    );
    const rows = await auditRows(core);
    // The gateway decision for the voice actor is in the audit log, before the run.
    const decision = rows.find(
      (r) => r.action === "policy.decision" && r.details.tool === "git.status",
    );
    expect(decision).toBeDefined();
    expect(JSON.stringify(decision)).toContain(VOICE_ACTOR.id);
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["voice.start", "voice.wake", "voice.request", "voice.action"]),
    );
    expect(rows.find((r) => r.action === "voice.action")!.details).toMatchObject({
      tool: "git.status",
      outcome: "ok",
    });
    // No transcript anywhere in the audit log.
    const all = JSON.stringify(rows).toLowerCase();
    for (const word of ["marmalade", "quantum", "zebra", "ok fawkes", "git status"])
      expect(all).not.toContain(word);
  });

  it("shows LISTENING only for the awake window: voice.listening then voice.idle, no text", async () => {
    const { core, say, clock } = await boot();
    await enable(core);
    const seen: { type: string; payload: unknown }[] = [];
    core.runtime.bus.subscribe(
      "test",
      "voice.*",
      (e) => void seen.push({ type: e.event_type, payload: e.payload }),
    );
    say.push("ok fawkes", "what is my git status");
    const { id, stream, messages } = await openSession(core);
    speak(clock, stream);
    await vi.waitFor(() => expect(seen.map((e) => e.type)).toEqual(["voice.listening"]));
    expect(core.runtime.state.snapshot().state).toBe("LISTENING");
    speak(clock, stream);
    await vi.waitFor(() => expect(messages.some((m) => m.type === "reply")).toBe(true));
    await core.runtime.bus.drain();
    expect(seen.map((e) => e.type)).toEqual(["voice.listening", "voice.idle"]);
    expect(seen.every((e) => JSON.stringify(e.payload) === JSON.stringify({ session: id }))).toBe(
      true,
    );
    expect(core.runtime.state.snapshot().state).not.toBe("LISTENING");
  });

  it("while only waiting for the wake phrase Fawkes shows nothing", async () => {
    const { core, say, clock } = await boot();
    await enable(core);
    say.push("just chatting about lunch");
    const { stream } = await openSession(core);
    speak(clock, stream);
    await vi.waitFor(() => expect(core.runtime.voice).toBeDefined());
    await core.runtime.bus.drain();
    expect(core.runtime.state.snapshot().state).not.toBe("LISTENING");
    expect((await core.api("GET", "/api/voice/status")).json.active).toMatchObject({
      phase: "waiting",
    });
  });
});

describe("what voice can and cannot do", () => {
  it("a write tool is never run by voice, whatever is said", async () => {
    const { core, say, clock } = await boot();
    await enable(core);
    writes = 0;
    for (const phrase of [
      "ok fawkes writer.write",
      "ok fawkes write something with the writer",
      "ok fawkes call the write tool and confirm",
    ]) {
      say.push(phrase);
      const { stream, messages } = await openSession(core);
      speak(clock, stream);
      await vi.waitFor(() => expect(messages.some((m) => m.type === "reply")).toBe(true));
      expect(messages.find((m) => m.type === "reply")).toMatchObject({
        outcome: expect.stringMatching(/refused|unavailable/) as string,
      });
      await core.api(
        "DELETE",
        `/api/voice/sessions/${(await core.api("GET", "/api/voice/status")).json.active?.id}`,
      );
    }
    expect(writes).toBe(0);
    expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(0);
  });

  it("the gateway call carries an actor that does not claim trustedByUser", async () => {
    const { core, say, clock } = await boot();
    await enable(core);
    const spy = vi.spyOn(core.runtime.toolGateway, "call");
    say.push("ok fawkes git status");
    const { stream, messages } = await openSession(core);
    speak(clock, stream);
    await vi.waitFor(() => expect(messages.some((m) => m.type === "reply")).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]![0];
    expect(call).toMatchObject({
      tool: "git.status",
      input: {},
      actor: { kind: "agent", trustedByUser: false },
    });
  });

  it("a call policy escalates waits for a person; voice gives up after its wait and DENIES it, and no spoken approval is ever an approval", async () => {
    const { core, say, clock } = await boot();
    await enable(core);
    // A user-made rule (the only way to change policy): reads of git need a person's approval.
    new PolicyAdmin({
      store: new PolicyStore(core.runtime.db),
      audit: core.runtime.permissions.audit,
    }).addRule(
      { kind: "user", id: "me", trustedByUser: true },
      { id: "voice-git-needs-approval", effect: "require_approval", match: { tool: "git.status" } },
    );
    const resolve = vi.spyOn(core.runtime.permissions, "resolveConfirmation");
    say.push("ok fawkes git status");
    const { stream, messages } = await openSession(core);
    speak(clock, stream);
    await vi.waitFor(() => expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(1));
    expect(core.runtime.permissions.pendingConfirmations()[0]!.summary).toMatch(/Policy approval/);
    // While it waits, spoken approvals are refused and resolve nothing.
    for (const phrase of ["yes approve it", "approve", "confirm", "go ahead"]) {
      say.push(`ok fawkes ${phrase}`);
      speak(clock, stream);
    }
    await vi.waitFor(() => expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(1));
    expect(resolve).not.toHaveBeenCalled();
    clock.advance(61_000);
    const reply = await vi.waitFor(() => {
      const m = messages.find((x) => x.type === "reply");
      if (!m) throw new Error("no reply");
      return m;
    });
    expect(reply).toMatchObject({ outcome: "failed" });
    expect((reply as { text: string }).text).toMatch(/needs your approval/);
    await vi.waitFor(() => expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(0));
    // The gateway withdraws the request when voice aborts the call; whatever voice resolved was a denial.
    for (const [, approved, by] of resolve.mock.calls) {
      expect(approved).toBe(false);
      expect(by).toBe("voice");
    }
  });

  it("'deny' by voice denies a waiting confirmation through the permission gateway", async () => {
    const { core, say, clock } = await boot();
    await enable(core);
    const resolve = vi.spyOn(core.runtime.permissions, "resolveConfirmation");
    const asked = core.runtime.capabilities.invokeAndWait("writer", "write", {}, "someone-else");
    await vi.waitFor(() => expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(1));
    const [confirmation] = core.runtime.permissions.pendingConfirmations();
    say.push("ok fawkes deny");
    const { stream, messages } = await openSession(core);
    speak(clock, stream);
    const reply = await vi.waitFor(() => {
      const m = messages.find((x) => x.type === "reply");
      if (!m) throw new Error("no reply");
      return m;
    });
    expect(reply).toMatchObject({ outcome: "denied" });
    expect(resolve).toHaveBeenCalledWith(confirmation!.id, false, "voice");
    expect(resolve.mock.calls.every(([, approved]) => approved === false)).toBe(true);
    const op = await asked;
    expect(op.status).toBe("failed");
    expect(writes).toBe(0);
  });
});

describe("stopping", () => {
  it("turning the assistant off or engaging the kill switch ends the session at once", async () => {
    const { core } = await boot();
    await enable(core);
    const first = await openSession(core);
    await core.api("POST", "/api/voice/settings", { enabled: false });
    expect(first.ended).toEqual(["disabled"]);
    expect((await core.api("GET", "/api/voice/status")).json.active).toBeNull();

    await enable(core);
    const second = await openSession(core);
    core.runtime.permissions.engageKillSwitch("user");
    await core.runtime.bus.drain();
    expect(second.ended).toEqual(["kill_switch"]);
    expect((await core.api("POST", "/api/voice/sessions", {})).status).toBe(409);
    const rows = await auditRows(core);
    expect(rows.filter((r) => r.action === "voice.stop").map((r) => r.details.reason)).toEqual([
      "disabled",
      "kill_switch",
    ]);
  });

  it("DELETE stops a session and is idempotent", async () => {
    const { core } = await boot();
    await enable(core);
    const { id, ended } = await openSession(core);
    expect((await core.api("DELETE", `/api/voice/sessions/${id}`)).status).toBe(200);
    expect((await core.api("DELETE", `/api/voice/sessions/${id}`)).status).toBe(200);
    expect(ended).toEqual(["stopped"]);
  });
});

describe("the audio socket", () => {
  function connect(core: TestCore, session: string, origin: string | null = core.base) {
    const ws = new WebSocket(
      `ws://127.0.0.1:${core.port}/api/voice/stream?session=${session}`,
      [WS_PROTOCOL, WS_TOKEN_PREFIX + TOKEN],
      { headers: origin === null ? {} : { Origin: origin } },
    );
    ws.on("error", () => {});
    cleanups.push(() => ws.terminate());
    const messages: Record<string, unknown>[] = [];
    ws.on("message", (data, isBinary) => {
      if (!isBinary) messages.push(JSON.parse(data.toString()) as Record<string, unknown>);
    });
    const opening = Promise.withResolvers<number>();
    ws.once("open", () => opening.resolve(101));
    ws.once("unexpected-response", (_r, res) => opening.resolve(res.statusCode ?? 0));
    ws.once("error", () => opening.resolve(0));
    return { ws, messages, opened: opening.promise };
  }

  it("carries a request end to end and refuses text frames, foreign origins and a second use", async () => {
    const { core, say, clock } = await boot();
    await enable(core);
    const { id } = (await core.api("POST", "/api/voice/sessions", {})).json as { id: string };
    expect(await connect(core, id, "http://evil.example").opened).toBe(403);
    expect(await connect(core, id, null).opened).toBe(403);
    const good = connect(core, id);
    expect(await good.opened).toBe(101);
    await vi.waitFor(() => expect(good.messages.some((m) => m.type === "ready")).toBe(true));
    expect(await connect(core, id).opened).toBe(409);
    say.push("ok fawkes git status");
    for (let t = 0; t < 600; t += FRAME_MS) good.ws.send(bytes(tone(FRAME_MS, 3000)));
    for (let t = 0; t < 700; t += FRAME_MS) good.ws.send(bytes(tone(FRAME_MS, 40)));
    await vi.waitFor(() => expect(good.messages.some((m) => m.type === "reply")).toBe(true), {
      timeout: 3000,
    });
    expect(good.messages.find((m) => m.type === "reply")).toMatchObject({ outcome: "ok" });
    good.ws.close();
    await vi.waitFor(async () =>
      expect((await core.api("GET", "/api/voice/status")).json.active).toBeNull(),
    );
  });

  it("a text frame ends the session; there is no message a client can send but audio", async () => {
    const { core } = await boot();
    await enable(core);
    const { id } = (await core.api("POST", "/api/voice/sessions", {})).json as { id: string };
    const s = connect(core, id);
    await s.opened;
    await vi.waitFor(() => expect(s.messages.some((m) => m.type === "ready")).toBe(true));
    s.ws.send(JSON.stringify({ type: "approve", id: "conf_1" }));
    await vi.waitFor(() => expect(s.messages.some((m) => m.type === "error")).toBe(true));
    await vi.waitFor(async () =>
      expect((await core.api("GET", "/api/voice/status")).json.active).toBeNull(),
    );
  });
});
