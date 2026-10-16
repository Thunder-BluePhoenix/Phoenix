// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 65 through the public HTTP/WebSocket API. NO real call, microphone, system audio or Whisper
// transcription is involved: the recogniser is a FakeRecognizer, the model is a fake Ollama, the
// "audio" is fixed bytes. What is proven here is Core's behaviour around them.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WS_PROTOCOL, WS_TOKEN_PREFIX } from "@phoenix/api";
import { FakeRecognizer } from "@phoenix/ai-multimodal";
import { createLogger, type LogRecord } from "@phoenix/logging";
import { MemorySecretStore } from "@phoenix/persistence";
import { createEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import WebSocket from "ws";
import { fakeNetwork, type FakeNetwork } from "./ai-network";
import { TOKEN, connect, startCore, type TestCore } from "./helpers";
import type { NotetakerConsentChannel } from "../src/notetaker";

const WINDOW = 1600; // samples per transcription window in these tests (0.1 s)
const SECRET_WORDS = "zebra quantum marmalade";
const SECRET_TITLE = "Confidential board call";
const SUMMARY_JSON = JSON.stringify({
  text: "The group agreed to ship on Friday.",
  topics: ["launch"],
  decisions: ["Ship the review panel on Friday"],
  action_items: ["Ana writes the release notes"],
});

interface Boot extends TestCore {
  recognizer: FakeRecognizer;
  network: FakeNetwork;
  logs: LogRecord[];
  consent: FakeConsent | null;
}

let core: Boot | undefined;
const sockets = new Set<WebSocket>();
afterEach(async () => {
  for (const ws of sockets) ws.terminate();
  sockets.clear();
  await core?.runtime.stop();
  core = undefined;
});

/** The embedding process's confirmation dialog, played by a test. No HTTP request can reach it. */
interface FakeConsent extends NotetakerConsentChannel {
  asked: { title: string | null }[];
  answer: boolean;
}
function fakeConsent(answer = true): FakeConsent {
  const channel: FakeConsent = {
    kind: "test-dialog",
    asked: [],
    answer,
    confirm(info) {
      channel.asked.push(info);
      return Promise.resolve(channel.answer);
    },
  };
  return channel;
}

async function boot(
  options: {
    transcript?: string;
    chat?: (body: string) => string;
    recognizer?: FakeRecognizer | null;
    secrets?: MemorySecretStore;
    /** Default: a dialog that says yes. `null` is the production default: no person-bound channel. */
    consent?: FakeConsent | null;
  } = {},
): Promise<Boot> {
  const recognizer = new FakeRecognizer({ transcript: options.transcript ?? SECRET_WORDS });
  const network = fakeNetwork({ chat: options.chat ?? (() => SUMMARY_JSON) });
  const logs: LogRecord[] = [];
  const consent = options.consent === undefined ? fakeConsent() : options.consent;
  const started = await startCore(
    {},
    {
      logger: createLogger({ level: "debug", sink: (r) => void logs.push(r) }),
      secrets: options.secrets ?? new MemorySecretStore(),
      runtime: {
        fetch: network.fetch,
        notetakerWindowSamples: WINDOW,
        ...(consent ? { notetakerConsent: consent } : {}),
        ...(options.recognizer === null
          ? {}
          : { notetakerRecognizer: options.recognizer ?? recognizer }),
      },
    },
  );
  core = { ...started, recognizer, network, logs, consent };
  return core;
}

const enable = () => core!.api("POST", "/api/notetaker/settings", { enabled: true });
const OK = { consent: true, notice_acknowledged: true };
const startSession = async (extra: Record<string, unknown> = {}) => {
  const res = await core!.api("POST", "/api/notetaker/sessions", { ...OK, ...extra });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json as { id: string; stream_path: string };
};

/** One frame: channel byte + 16-bit little-endian PCM of `samples` samples. */
function frame(channel: number, samples = WINDOW, value = 7): Buffer {
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(value, i * 2);
  return Buffer.concat([Buffer.from([channel]), pcm]);
}

/** A client socket on the notetaker stream, with the messages Core sent as JSON. */
interface StreamClient {
  ws: WebSocket;
  opened: Promise<number>;
  closed: Promise<number>;
  next(type: string): Promise<Record<string, unknown>>;
  messages: Record<string, unknown>[];
}

function stream(
  path: string,
  options: { token?: string; origin?: string | null; protocols?: string[]; cookie?: string } = {},
): StreamClient {
  const headers: Record<string, string> = {};
  if (options.origin !== null) headers.Origin = options.origin ?? core!.base;
  if (options.cookie) headers.Cookie = options.cookie;
  const ws = new WebSocket(
    `ws://127.0.0.1:${core!.port}${path}`,
    options.protocols ?? [WS_PROTOCOL, WS_TOKEN_PREFIX + (options.token ?? TOKEN)],
    { headers },
  );
  sockets.add(ws);
  ws.on("error", () => {});
  const messages: Record<string, unknown>[] = [];
  ws.on("message", (data, isBinary) => {
    if (!isBinary) messages.push(JSON.parse(data.toString()) as Record<string, unknown>);
  });
  const opening = Promise.withResolvers<number>();
  ws.once("open", () => opening.resolve(101));
  ws.once("unexpected-response", (_req, response) => opening.resolve(response.statusCode ?? 0));
  ws.once("error", () => opening.resolve(0));
  const closing = Promise.withResolvers<number>();
  ws.once("close", (code) => closing.resolve(code));
  const next = (type: string) =>
    vi.waitFor(
      () => {
        const found = messages.find((m) => m.type === type);
        if (!found) throw new Error(`no ${type} message yet`);
        return found;
      },
      { timeout: 3000, interval: 5 },
    );
  return { ws, opened: opening.promise, closed: closing.promise, next, messages };
}

async function openStream(session: { stream_path: string }): Promise<StreamClient> {
  const s = stream(session.stream_path);
  expect(await s.opened).toBe(101);
  await s.next("ready");
  return s;
}

const transcriptOf = async (meetingId: string) =>
  (await core!.api("GET", `/api/meetings/${meetingId}/transcript`)).json as {
    text: string;
    segments: { speaker: string; text: string; start_ms: number }[];
  };

const meetingIdOf = (id: string) => `notetaker:${id}`;

/** Every file name below a directory, relative to it. */
function listing(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .map((e) => join(e.parentPath, e.name))
    .sort();
}
/**
 * Gives this process a private, empty OS temp dir until the test ends. Comparing the shared temp
 * dir raced: other test files running in parallel create and remove their own working dirs there
 * (the Docker mock's `pd-*`), and other apps write to it too. `os.tmpdir()` reads these variables
 * on every call, so anything in Core that asks for a temp dir gets this one, which must stay empty.
 */
function privateTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "phoenix-notetaker-tmp-"));
  const vars = ["TMPDIR", "TMP", "TEMP"] as const;
  const previous = vars.map((v) => process.env[v]);
  for (const v of vars) process.env[v] = dir;
  onTestFinished(() => {
    vars.forEach((v, i) => {
      if (previous[i] === undefined) delete process.env[v];
      else process.env[v] = previous[i];
    });
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

describe("settings and start rules", () => {
  it("is off by default; a start is refused and nothing records", async () => {
    await boot();
    expect((await core!.api("GET", "/api/notetaker/status")).json).toMatchObject({
      enabled: false,
      audio_on_disk: false,
      kill_switch_engaged: false,
      recognizer: { available: true },
      capture: { microphone: true, system_audio: false },
    });
    const refused = await core!.api("POST", "/api/notetaker/sessions", OK);
    expect(refused.status).toBe(409);
    expect(refused.json.message).toMatch(/notetaker is off/);
  });

  it("enabling is a user route, validated and audited", async () => {
    await boot();
    for (const body of [{}, { enabled: "yes" }, { enabled: true, extra: 1 }])
      expect((await core!.api("POST", "/api/notetaker/settings", body)).status).toBe(400);
    expect((await enable()).json).toEqual({ enabled: true });
    expect((await core!.api("GET", "/api/notetaker/status")).json.enabled).toBe(true);
    const audit = (await core!.api("GET", "/api/audit?limit=50")).json.entries as {
      action: string;
      details: unknown;
    }[];
    expect(audit.find((e) => e.action === "notetaker.settings")?.details).toEqual({
      enabled: true,
    });
  });

  it("requires the session token on every route", async () => {
    await boot();
    for (const [method, path] of [
      ["GET", "/api/notetaker/status"],
      ["POST", "/api/notetaker/settings"],
      ["POST", "/api/notetaker/sessions"],
      ["POST", "/api/notetaker/sessions/ntk_x/stop"],
      ["DELETE", "/api/notetaker/sessions/ntk_x"],
    ] as const) {
      const res = await fetch(core!.base + path, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("is refused without consent AND notice_acknowledged in EVERY request, even right after a recording", async () => {
    await boot();
    await enable();
    for (const body of [
      {},
      { consent: true },
      { notice_acknowledged: true },
      { consent: true, notice_acknowledged: false },
      { consent: false, notice_acknowledged: true },
      { consent: "true", notice_acknowledged: "true" },
      { consent: 1, notice_acknowledged: 1 },
    ]) {
      const res = await core!.api("POST", "/api/notetaker/sessions", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await core!.api("GET", "/api/notetaker/status")).json.active).toBeUndefined();
    // Consent given once does not carry over to the next recording.
    const first = await startSession();
    expect((await core!.api("DELETE", `/api/notetaker/sessions/${first.id}`)).status).toBe(200);
    expect((await core!.api("POST", "/api/notetaker/sessions", {})).status).toBe(400);
    expect((await core!.api("POST", "/api/notetaker/sessions", { consent: true })).status).toBe(
      400,
    );
    expect((await core!.api("POST", "/api/notetaker/sessions", OK)).status).toBe(200);
  });

  it("rejects unknown fields, a bad title and unknown sessions", async () => {
    await boot();
    await enable();
    expect((await core!.api("POST", "/api/notetaker/sessions", { ...OK, text: "x" })).status).toBe(
      400,
    );
    expect((await core!.api("POST", "/api/notetaker/sessions", { ...OK, title: 5 })).status).toBe(
      400,
    );
    expect(
      (await core!.api("POST", "/api/notetaker/sessions", { ...OK, title: "a\u202Eb" })).status,
    ).toBe(400);
    expect((await core!.api("POST", "/api/notetaker/sessions/ntk_nope/stop", {})).status).toBe(404);
    expect((await core!.api("DELETE", "/api/notetaker/sessions/ntk_nope")).status).toBe(404);
  });

  it("every start leaves an audit row with the session id and both flags, and no title or name", async () => {
    await boot();
    await enable();
    const s = await startSession({ title: SECRET_TITLE });
    const audit = (await core!.api("GET", "/api/audit?limit=50")).json.entries as {
      action: string;
      details: Record<string, unknown>;
    }[];
    const row = audit.find((e) => e.action === "notetaker.start")!;
    expect(row.details).toEqual({
      session: s.id,
      consent: true,
      notice_acknowledged: true,
      consent_channel: "test-dialog",
    });
    expect(core!.consent!.asked).toEqual([{ title: SECRET_TITLE }]);
    expect(JSON.stringify(audit)).not.toContain(SECRET_TITLE);
  });

  it("a person-bound consent channel is asked for EVERY recording, and its no (or failure) is final", async () => {
    await boot();
    await enable();
    const first = await startSession();
    await core!.api("DELETE", `/api/notetaker/sessions/${first.id}`);
    await startSession();
    expect(core!.consent!.asked).toHaveLength(2);
    await core!.api(
      "DELETE",
      `/api/notetaker/sessions/${(await core!.api("GET", "/api/notetaker/status")).json.active.id}`,
    );

    // The person says no: the flags in the request change nothing and nothing records.
    core!.consent!.answer = false;
    const sessionsBefore = core!.recognizer.sessions.length;
    const no = await core!.api("POST", "/api/notetaker/sessions", OK);
    expect(no.status).toBe(400);
    expect(no.json.message).toMatch(/not confirmed by a person/);
    expect((await core!.api("GET", "/api/notetaker/status")).json.active).toBeUndefined();
    expect(core!.recognizer.sessions.length).toBe(sessionsBefore);
    expect((await core!.api("GET", "/api/meetings")).json.meetings).toHaveLength(2);
  });

  it("a consent surface that throws is not a yes", async () => {
    const broken: FakeConsent = {
      ...fakeConsent(),
      confirm: () => Promise.reject(new Error("dialog crashed")),
    };
    await boot({ consent: broken });
    await enable();
    expect((await core!.api("POST", "/api/notetaker/sessions", OK)).status).toBe(400);
    expect((await core!.api("GET", "/api/notetaker/status")).json.active).toBeUndefined();
    expect(core!.recognizer.sessions).toHaveLength(0);
  });

  it("refuses to start when no recogniser is configured, and says why", async () => {
    await boot({ recognizer: null });
    await enable();
    const status = (await core!.api("GET", "/api/notetaker/status")).json;
    expect(status.recognizer.available).toBe(false);
    expect(status.recognizer.detail).toMatch(/No on-device speech recogniser/);
    const res = await core!.api("POST", "/api/notetaker/sessions", OK);
    expect(res.status).toBe(503);
    expect(res.json.message).toMatch(/No on-device speech recogniser/);
    // And the meeting list gained no half-made record.
    expect((await core!.api("GET", "/api/meetings")).json.meetings).toEqual([]);
  });

  it("refuses when the recogniser reports itself unavailable", async () => {
    await boot({ recognizer: new FakeRecognizer({ transcript: "x", available: false }) });
    await enable();
    expect((await core!.api("POST", "/api/notetaker/sessions", OK)).status).toBe(503);
  });

  it("has one session at a time", async () => {
    await boot();
    await enable();
    await startSession();
    const second = await core!.api("POST", "/api/notetaker/sessions", OK);
    expect(second.status).toBe(400);
    expect(second.json.message).toMatch(/already in progress/);
  });

  it("refuses to start under the emergency stop", async () => {
    await boot();
    await enable();
    await core!.api("POST", "/api/security/kill-switch", { engaged: true });
    expect((await core!.api("POST", "/api/notetaker/sessions", OK)).status).toBe(409);
    expect((await core!.api("GET", "/api/notetaker/status")).json.kill_switch_engaged).toBe(true);
  });
});

describe("a session-token holder alone cannot start a recording (no person-bound channel)", () => {
  it("status says so; start is 403 CONSENT_CHANNEL_UNAVAILABLE with every flag set, and nothing records", async () => {
    await boot({ consent: null });
    // The token holder does everything a script can do: turn it on, claim consent, claim notice.
    expect((await enable()).json).toEqual({ enabled: true });
    const status = (await core!.api("GET", "/api/notetaker/status")).json;
    expect(status.consent_channel).toMatchObject({
      available: false,
      code: "CONSENT_CHANNEL_UNAVAILABLE",
    });
    expect(status.recognizer.available).toBe(true);

    const hub = connect(core!.port);
    await hub.opened;
    hub.send({ type: "subscribe", channels: ["state.changed", "event.created"] });
    await hub.next((m) => m.type === "subscribed");

    for (const body of [OK, { ...OK, title: "Board call" }, {}, { consent: true }]) {
      const res = await core!.api("POST", "/api/notetaker/sessions", body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.json.code).toBe("CONSENT_CHANNEL_UNAVAILABLE");
    }
    // A consent-looking header or an approval of an unrelated confirmation does not help either.
    const headers = { "x-phoenix-consent": "true", "x-user-confirmed": "1" };
    const viaHeader = await core!.api("POST", "/api/notetaker/sessions", OK, headers);
    expect(viaHeader.status).toBe(403);
    expect((await core!.api("GET", "/api/confirmations")).json.confirmations).toEqual([]);

    await core!.runtime.bus.drain();
    expect(core!.recognizer.sessions).toHaveLength(0);
    expect((await core!.api("GET", "/api/notetaker/status")).json.active).toBeUndefined();
    expect((await core!.api("GET", "/api/meetings")).json.meetings).toEqual([]);
    expect((await core!.api("GET", "/api/pet/state")).json.state).not.toBe("RECORDING");
    const types = (
      (await core!.api("GET", "/api/events?limit=200")).json.events as {
        event: { event_type: string };
      }[]
    ).map((e) => e.event.event_type);
    expect(types.filter((t) => t.startsWith("notetaker."))).toEqual([]);
    const audit = (await core!.api("GET", "/api/audit?limit=100")).json.entries as {
      action: string;
    }[];
    expect(audit.some((e) => e.action === "notetaker.start")).toBe(false);
    hub.ws.close();
  });

  it("an audio socket cannot be opened for a session that was never confirmed", async () => {
    await boot({ consent: null });
    await enable();
    const s = stream("/api/notetaker/stream?session=ntk_" + "0".repeat(32));
    expect(await s.opened).not.toBe(101);
    expect(core!.recognizer.sessions).toHaveLength(0);
  });

  it("the runtime has no consent channel unless the embedder passes one in code", async () => {
    const plain = await startCore();
    try {
      await plain.api("POST", "/api/notetaker/settings", { enabled: true });
      const res = await plain.api("POST", "/api/notetaker/sessions", OK);
      expect(res.status).toBe(403);
      expect(res.json.code).toBe("CONSENT_CHANNEL_UNAVAILABLE");
    } finally {
      await plain.runtime.stop();
    }
  });
});

describe("a recording from start to meeting", () => {
  it("RECORDING for the whole capture, transcript written per window, summary, proposed items, nothing on disk, no text in events/audit/logs", async () => {
    await boot();
    await enable();
    await core!.api("POST", "/api/ai/settings", { enabled: true });
    const hub = connect(core!.port);
    await hub.opened;
    hub.send({ type: "subscribe", channels: ["state.changed"] });
    await hub.next((m) => m.channel === "state.changed");
    const privateTmp = privateTmpDir();
    expect(tmpdir()).toBe(privateTmp);
    const dataBefore = listing(core!.dataDir);

    const session = await startSession({ title: SECRET_TITLE });
    expect(session.stream_path).toBe(`/api/notetaker/stream?session=${session.id}`);
    const rec = await hub.next(
      (m) => m.channel === "state.changed" && m.data.state === "RECORDING",
    );
    expect(rec.data).toMatchObject({
      recording: true,
      explanation: expect.stringMatching(/Recording/),
    });

    // The meeting exists from the first second, in progress.
    const id = meetingIdOf(session.id);
    expect((await core!.api("GET", `/api/meetings/${id}`)).json).toMatchObject({
      capability_id: "notetaker",
      status: "in_progress",
      title: SECRET_TITLE,
      participants: ["You", "Others"],
      recording: {
        location: "none \u2014 audio is never stored",
        retention: "audio is discarded as it is transcribed",
      },
    });
    const status = (await core!.api("GET", "/api/notetaker/status")).json;
    expect(status.active).toMatchObject({ id: session.id });
    expect(typeof status.active.elapsed_s).toBe("number");

    const s = await openStream(session);
    s.ws.send(frame(1));
    // The first window's text is in the meeting WHILE the recording is still going.
    await vi.waitFor(async () => expect((await transcriptOf(id)).text).toContain(SECRET_WORDS));
    expect((await core!.api("GET", "/api/notetaker/status")).json.active).toBeDefined();
    s.ws.send(frame(2));
    s.ws.send(frame(1, 700)); // a partial window: transcribed when the recording stops
    await vi.waitFor(async () => expect((await transcriptOf(id)).segments).toHaveLength(2));

    s.ws.send(JSON.stringify({ type: "end" }));
    await s.next("audio_ended");
    const stopped = await core!.api("POST", `/api/notetaker/sessions/${session.id}/stop`, {});
    expect(stopped.status).toBe(200);
    expect(stopped.json).toEqual({ meeting_id: id });
    // The stop includes the local summary and item extraction, so allow the slow-runner budget.
    await hub.next((m) => m.channel === "state.changed" && m.data.state === "IDLE", 15_000);

    const transcript = await transcriptOf(id);
    expect(transcript.segments.map((x) => x.speaker).sort()).toEqual(["Others", "You", "You"]);
    expect(transcript.text).toContain(`You: ${SECRET_WORDS}`);
    expect(transcript.text).toContain(`Others: ${SECRET_WORDS}`);

    // The summary came from the local model and is stored with the existing meeting tables.
    const meeting = (await core!.api("GET", `/api/meetings/${id}`)).json;
    expect(meeting).toMatchObject({
      status: "ready",
      has_summary: true,
      has_transcript: true,
      participants: ["You", "Others"],
    });
    expect(meeting.duration_seconds).toBeGreaterThanOrEqual(0);
    const summary = (await core!.api("GET", `/api/meetings/${id}/summary`)).json;
    expect(summary).toMatchObject({
      text: "The group agreed to ship on Friday.",
      decisions: ["Ship the review panel on Friday"],
      generated_by: "ai",
    });
    expect(core!.network.cloud()).toEqual([]);

    // The existing pipeline made PROPOSED items only: nothing is accepted for the user.
    await vi.waitFor(async () => {
      const items = (await core!.api("GET", `/api/meetings/${id}/items`)).json;
      expect(items.items.length).toBeGreaterThanOrEqual(2);
    });
    const items = (await core!.api("GET", `/api/meetings/${id}/items`)).json;
    expect(items.items.every((i: { status: string }) => i.status === "proposed")).toBe(true);
    expect(
      items.items.every((i: { extracted_by: string }) => i.extracted_by.startsWith("ai:")),
    ).toBe(true);
    expect(items.counts).toMatchObject({ accepted: 0, edited: 0, rejected: 0 });
    expect(items.items.map((i: { kind: string }) => i.kind)).toEqual(
      expect.arrayContaining(["decision", "action_item"]),
    );

    // It shows up in the list alongside Kage's (here: alone).
    const list = (await core!.api("GET", "/api/meetings")).json.meetings as {
      id: string;
      capability_id: string;
    }[];
    expect(list.map((m) => [m.id, m.capability_id])).toEqual([[id, "notetaker"]]);

    // The audio never touched the disk: neither the data dir nor the temp dir gained anything.
    expect(listing(core!.dataDir)).toEqual(dataBefore);
    expect(readdirSync(privateTmp)).toEqual([]);

    // No transcript text, title or audio in events, audit rows or logs.
    const events = JSON.stringify((await core!.api("GET", "/api/events?limit=500")).json);
    const audit = JSON.stringify((await core!.api("GET", "/api/audit?limit=200")).json);
    const logs = JSON.stringify(core!.logs);
    for (const [name, text] of [
      ["events", events],
      ["audit", audit],
      ["logs", logs],
    ] as const) {
      expect(text, name).not.toContain("zebra");
      expect(text, name).not.toContain(SECRET_TITLE);
      expect(text, name).not.toContain("marmalade");
    }
    expect(events).toContain("notetaker.meeting.updated");
    // PCM is zeroed per window: every recogniser input is zero now.
    expect(core!.recognizer.sessions.length).toBeGreaterThanOrEqual(3);
    expect(
      core!.recognizer.sessions.every((r) => r.chunks.every((c) => c.every((v) => v === 0))),
    ).toBe(true);
    hub.ws.close();
  });

  it("a recorded call is NOT searchable until an item is accepted; the hit is then labelled reviewed, never Kage", async () => {
    await boot();
    await enable();
    await core!.api("POST", "/api/ai/settings", { enabled: true });
    await core!.api("POST", "/api/memory/settings", { allow_sensitive_meetings: true });
    const session = await startSession();
    const s = await openStream(session);
    s.ws.send(frame(1));
    s.ws.send(JSON.stringify({ type: "end" }));
    await s.next("audio_ended");
    await core!.api("POST", `/api/notetaker/sessions/${session.id}/stop`, {});
    const id = meetingIdOf(session.id);
    const decision = await vi.waitFor(async () => {
      const items = (await core!.api("GET", `/api/meetings/${id}/items?kind=decision`)).json
        .items as { id: string }[];
      if (items.length === 0) throw new Error("no decision item yet");
      return items[0]!;
    });
    const search = async () =>
      (await core!.api("GET", "/api/meetings/search?q=Friday&limit=10")).json.hits as {
        meeting_id: string;
        origin: string;
      }[];
    expect(await search()).toEqual([]);

    await core!.api("POST", `/api/meeting-items/${decision.id}/accept`, {});
    await vi.waitFor(async () => expect((await search()).length).toBeGreaterThan(0));
    const hits = await search();
    expect(hits.every((h) => h.meeting_id === id)).toBe(true);
    expect(hits.every((h) => h.origin === "reviewed")).toBe(true);
  });

  it("a call with no recognised speech completes with an empty transcript and no summary request", async () => {
    await boot({ transcript: "  " });
    await enable();
    await core!.api("POST", "/api/ai/settings", { enabled: true });
    const session = await startSession();
    const s = await openStream(session);
    s.ws.send(frame(1));
    s.ws.send(JSON.stringify({ type: "end" }));
    await s.next("audio_ended");
    await core!.api("POST", `/api/notetaker/sessions/${session.id}/stop`, {});
    const meeting = (await core!.api("GET", `/api/meetings/${meetingIdOf(session.id)}`)).json;
    expect(meeting).toMatchObject({
      has_transcript: true,
      has_summary: false,
      status: "transcribed",
    });
    expect(core!.network.chats()).toEqual([]);
  });
});

describe("the summary is local only and never faked", () => {
  async function record(extra: Parameters<typeof boot>[0] = {}) {
    await boot(extra);
    await enable();
    return null;
  }
  async function callAndStop() {
    const session = await startSession();
    const s = await openStream(session);
    s.ws.send(frame(1));
    s.ws.send(JSON.stringify({ type: "end" }));
    await s.next("audio_ended");
    const res = await core!.api("POST", `/api/notetaker/sessions/${session.id}/stop`, {});
    expect(res.status).toBe(200);
    return meetingIdOf(session.id);
  }

  it("a model that cannot be reached stores NO summary; the transcript is still kept", async () => {
    await record();
    // AI left off: nothing to ask.
    const id = await callAndStop();
    expect((await core!.api("GET", `/api/meetings/${id}`)).json).toMatchObject({
      status: "transcribed",
      has_transcript: true,
      has_summary: false,
    });
    expect((await core!.api("GET", `/api/meetings/${id}/summary`)).status).toBe(404);
    expect((await transcriptOf(id)).text).toContain(SECRET_WORDS);
    expect(core!.network.chats()).toEqual([]);
  });

  it("a model reply that is not the expected JSON stores NO summary and no items", async () => {
    await record({ chat: () => "Sure! Here is a lovely summary of your call." });
    await core!.api("POST", "/api/ai/settings", { enabled: true });
    const id = await callAndStop();
    expect(core!.network.chats().length).toBeGreaterThan(0);
    expect((await core!.api("GET", `/api/meetings/${id}`)).json).toMatchObject({
      status: "transcribed",
      has_summary: false,
    });
    expect((await core!.api("GET", `/api/meetings/${id}/summary`)).status).toBe(404);
    expect((await core!.api("GET", `/api/meetings/${id}/items`)).json.items).toEqual([]);
  });

  it("a routed cloud provider is refused for this purpose even with the grant and every opt-in: no cloud request, no summary", async () => {
    const secrets = new MemorySecretStore();
    await record({ secrets });
    const key = ["canary", "notetaker", "0123456789"].join("-");
    await core!.api("POST", "/api/ai/providers/anthropic/secret", { value: key });
    await core!.api("POST", "/api/ai/settings", {
      enabled: true,
      cloud_opt_in: { public: true, internal: true, sensitive: true },
      routing: { summaries: { provider: "anthropic" } },
    });
    await core!.api("POST", "/api/ai/external-processing", { granted: true });
    const id = await callAndStop();
    // Only the key-less health probe of the listing may reach the provider: no chat request, no content.
    expect(core!.network.cloud().filter((r) => !r.url.includes("/v1/models"))).toEqual([]);
    expect(
      core!.network.requests.some((r) => r.body.includes("zebra") || r.body.includes(key)),
    ).toBe(false);
    expect((await core!.api("GET", `/api/meetings/${id}`)).json).toMatchObject({
      status: "transcribed",
      has_summary: false,
    });
  });
});

/** A recording with one written window and one partial window still in memory. */
interface RecordingContext {
  hub: ReturnType<typeof connect>;
  session: { id: string; stream_path: string };
  s: StreamClient;
  id: string;
}

describe("every abort path zeroes the PCM and keeps what was already written", () => {
  async function recordingWithPartial(): Promise<RecordingContext> {
    await boot();
    await enable();
    const hub = connect(core!.port);
    await hub.opened;
    hub.send({ type: "subscribe", channels: ["state.changed"] });
    await hub.next((m) => m.channel === "state.changed");
    const session = await startSession();
    await hub.next((m) => m.channel === "state.changed" && m.data.state === "RECORDING");
    const s = await openStream(session);
    s.ws.send(frame(1)); // a complete window: transcribed and written
    const id = meetingIdOf(session.id);
    await vi.waitFor(async () => expect((await transcriptOf(id)).text).toContain(SECRET_WORDS));
    s.ws.send(frame(2, 500, 9)); // a partial window still held in memory when the abort comes
    await vi.waitFor(async () => expect(core!.recognizer.sessions.length).toBe(1));
    return { hub, session, s, id };
  }
  async function expectAborted(ctx: RecordingContext, reason?: string) {
    if (reason) expect((await ctx.s.next("ended")).reason).toBe(reason);
    await ctx.hub.next((m) => m.channel === "state.changed" && m.data.recording === false);
    expect((await core!.api("GET", "/api/notetaker/status")).json.active).toBeUndefined();
    // Whatever was transcribed before the abort stays; nothing is lost and nothing is invented.
    const meeting = (await core!.api("GET", `/api/meetings/${ctx.id}`)).json;
    expect(meeting.has_transcript).toBe(true);
    expect(meeting.status).toBe("transcribed");
    expect((await transcriptOf(ctx.id)).text).toBe(`You: ${SECRET_WORDS}`);
    expect(
      core!.recognizer.sessions.every((r) => r.chunks.every((c) => c.every((v) => v === 0))),
    ).toBe(true);
    ctx.hub.ws.close();
  }

  it("DELETE (abort)", async () => {
    const ctx = await recordingWithPartial();
    expect((await core!.api("DELETE", `/api/notetaker/sessions/${ctx.session.id}`)).status).toBe(
      200,
    );
    await expectAborted(ctx, "aborted");
    // Idempotent, and stop afterwards says why instead of pretending.
    expect((await core!.api("DELETE", `/api/notetaker/sessions/${ctx.session.id}`)).status).toBe(
      200,
    );
    const stop = await core!.api("POST", `/api/notetaker/sessions/${ctx.session.id}/stop`, {});
    expect(stop.status).toBe(400);
  });

  it("the kill switch", async () => {
    const ctx = await recordingWithPartial();
    await core!.api("POST", "/api/security/kill-switch", { engaged: true });
    await expectAborted(ctx, "kill_switch");
  });

  it("switching the notetaker off", async () => {
    const ctx = await recordingWithPartial();
    await core!.api("POST", "/api/notetaker/settings", { enabled: false });
    await expectAborted(ctx, "disabled");
  });

  it("the audio socket closing", async () => {
    const ctx = await recordingWithPartial();
    ctx.s.ws.close();
    await expectAborted(ctx);
  });

  it("an invalid frame", async () => {
    const ctx = await recordingWithPartial();
    ctx.s.ws.send(Buffer.from([1, 1, 2, 3])); // odd PCM length
    expect((await ctx.s.next("error")).error).toMatch(/invalid audio frame/);
    expect(await ctx.s.closed).toBe(1008);
    await expectAborted(ctx);
  });

  it("an unknown channel", async () => {
    const ctx = await recordingWithPartial();
    ctx.s.ws.send(frame(3, 100));
    expect((await ctx.s.next("error")).error).toMatch(/invalid audio frame/);
    await expectAborted(ctx);
  });

  it("an aborted call with no text at all is marked failed, not left in progress", async () => {
    await boot();
    await enable();
    const session = await startSession();
    await core!.api("DELETE", `/api/notetaker/sessions/${session.id}`);
    expect((await core!.api("GET", `/api/meetings/${meetingIdOf(session.id)}`)).json.status).toBe(
      "failed",
    );
  });
});

describe("the audio WebSocket follows the dictation socket's rules", () => {
  async function session() {
    await boot();
    await enable();
    return startSession();
  }
  const path = (id: string) => `/api/notetaker/stream?session=${id}`;

  it("refuses missing or foreign origins, a wrong token, extra or repeated parameters", async () => {
    const { id } = await session();
    expect(await stream(path(id), { origin: null }).opened).toBe(403);
    expect(await stream(path(id), { origin: "http://attacker.invalid" }).opened).toBe(403);
    expect(await stream(path(id), { origin: `http://localhost:${core!.port}` }).opened).toBe(403);
    expect(await stream(path(id), { token: "wrong" }).opened).toBe(401);
    expect(await stream(path(id), { protocols: [WS_PROTOCOL] }).opened).toBe(401);
    expect(await stream(`${path(id)}&token=${TOKEN}`).opened).toBe(403);
    expect(await stream(`${path(id)}&session=${id}`).opened).toBe(403);
    expect(await stream("/api/notetaker/stream").opened).toBe(403);
    expect(await stream("/api/notetaker/stream?session=nope").opened).toBe(400);
    expect(await stream(path("ntk_" + "0".repeat(32))).opened).toBe(409);
    // A dictation-shaped id is not a notetaker session.
    expect(await stream(path("dic_" + "0".repeat(32))).opened).toBe(400);
  });

  it("refuses a cookie", async () => {
    const { id } = await session();
    expect(await stream(path(id), { cookie: "a=b" }).opened).toBe(403);
  });

  it("the token is not accepted in the URL", async () => {
    const { id } = await session();
    expect(
      await stream(`${path(id)}&access_token=${TOKEN}`, { protocols: [WS_PROTOCOL] }).opened,
    ).toBe(403);
  });

  it("is single use", async () => {
    const { id } = await session();
    const first = stream(path(id));
    expect(await first.opened).toBe(101);
    await first.next("ready");
    expect(await stream(path(id)).opened).toBe(409);
    expect((await core!.api("GET", "/api/notetaker/status")).json.active).toMatchObject({ id });
  });

  it("is refused for a session that is not recording any more", async () => {
    const { id } = await session();
    await core!.api("DELETE", `/api/notetaker/sessions/${id}`);
    expect(await stream(path(id)).opened).toBe(409);
  });

  it("cannot be used to send text", async () => {
    const { id } = await session();
    const s = stream(path(id));
    await s.opened;
    await s.next("ready");
    s.ws.send(JSON.stringify({ type: "text", text: "inject" }));
    expect((await s.next("error")).error).toMatch(/Only PCM/);
    await s.closed;
  });

  it("takes a frame of up to 1 MiB and closes the connection on a larger one", async () => {
    const { id } = await session();
    const s = stream(path(id));
    await s.opened;
    await s.next("ready");
    s.ws.send(Buffer.alloc(1024 * 1024 + 4, 1));
    // The server drops an oversize frame at the protocol level (1009, or 1006 if the TCP close wins).
    expect([1006, 1009]).toContain(await s.closed);
  });
});

describe("events", () => {
  it("notetaker.recording / notetaker.idle can only come from Core", async () => {
    await boot();
    for (const type of ["notetaker.recording", "notetaker.idle", "notetaker.meeting.updated"]) {
      const res = await core!.api("POST", "/api/events", {
        event_id: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
        event_type: type,
        version: "1.1",
        source: "terminal",
        timestamp: new Date().toISOString(),
        severity: "info",
        payload: { session: "ntk_x" },
      });
      expect(res.status, type).toBe(403);
    }
  });
});

describe("a recorded call reaches memory only through the item review", () => {
  type Fact = { source: string; text: string };
  const facts = async () =>
    (await core!.api("GET", "/api/memory?domain=meeting&limit=100")).json.items as Fact[];

  async function recordedCall() {
    await boot();
    await enable();
    await core!.api("POST", "/api/ai/settings", { enabled: true });
    await core!.api("POST", "/api/memory/settings", { allow_sensitive_meetings: true });
    const session = await startSession();
    const s = await openStream(session);
    s.ws.send(frame(1));
    s.ws.send(JSON.stringify({ type: "end" }));
    await s.next("audio_ended");
    await core!.api("POST", `/api/notetaker/sessions/${session.id}/stop`, {});
    const id = meetingIdOf(session.id);
    expect((await core!.api("GET", `/api/meetings/${id}`)).json.has_summary).toBe(true);
    const decision = await vi.waitFor(async () => {
      const items = (await core!.api("GET", `/api/meetings/${id}/items?kind=decision`)).json
        .items as { id: string }[];
      if (items.length === 0) throw new Error("no decision item yet");
      return items[0]!;
    });
    // Let any memory sync that the summary triggered run.
    await core!.runtime.bus.drain();
    core!.runtime.memory.syncMeetings();
    return decision;
  }

  it("a proposed item and a fresh summary are NOT memory; accepting one makes exactly its fact; rejecting removes it", async () => {
    const decision = await recordedCall();
    // The model wrote a summary from speech nobody has read: nothing of it is memory yet.
    expect(await facts()).toEqual([]);
    expect(JSON.stringify(await facts())).not.toContain("Friday");

    const accepted = await core!.api("POST", `/api/meeting-items/${decision.id}/accept`, {});
    expect(accepted.status).toBe(200);
    expect((await facts()).map((f) => f.source)).toEqual(["meeting-review"]);
    expect((await facts())[0]!.text).toContain("Ship the review panel on Friday");
    // The summary paragraph and the action item the user did not accept are still absent.
    expect(JSON.stringify(await facts())).not.toContain("release notes");

    await core!.api("POST", `/api/meeting-items/${decision.id}/reject`, {});
    expect(await facts()).toEqual([]);
  });

  it("a fact an earlier build made straight from a notetaker summary is removed on the next sync", async () => {
    await recordedCall();
    const store = core!.runtime.memory.store;
    // The pipeline now refuses this source; write the row as the old build would have left it.
    const seeded = store.insert({
      dedupeKey: "meeting:notetaker:old:summary:x",
      source: "notetaker",
      sourceRef: "notetaker:old",
      owner: "owner",
      scope: "meeting:notetaker:old",
      layer: "episodic",
      domain: "meeting",
      kind: "fact",
      text: 'Summary of "Old call": unreviewed model text',
      observedAt: new Date().toISOString(),
      freshnessTtlDays: null,
      sensitivity: "sensitive",
      provenance: { meeting_id: "notetaker:old", capability: "notetaker" },
      confidence: 1,
      retentionDays: null,
    });
    expect(seeded.status).toBe("stored");
    const sources = () => store.list({ domain: "meeting", limit: 50 }).map((f) => f.source);
    expect(sources()).toContain("notetaker");
    core!.runtime.memory.syncMeetings();
    expect(sources()).not.toContain("notetaker");
  });
});

describe("the microphone indicators cannot be forged or cleared over the API", () => {
  it.each(["dictation.listening", "dictation.idle", "notetaker.recording", "notetaker.idle"])(
    "POST /api/events refuses %s from any source",
    async (type) => {
      await boot();
      const post = (source: string) =>
        core!.api("POST", "/api/events", {
          event_id: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
          event_type: type,
          version: "1.1",
          source,
          timestamp: new Date().toISOString(),
          severity: "info",
          payload: { session: "x" },
        });
      for (const source of ["terminal", "dictation", "notetaker", "core"]) {
        const res = await post(source);
        expect(res.status, `${type} from ${source}`).toBe(403);
      }
      expect((await core!.api("GET", `/api/events?type=${type}`)).json.events).toEqual([]);
    },
  );

  it("an attacker's dictation.idle cannot clear a live LISTENING state", async () => {
    await boot();
    // What Core itself publishes while a dictation is live.
    core!.runtime.bus.publish(
      createEvent({
        event_type: "dictation.listening",
        source: "core",
        severity: "info",
        payload: { session: "dic_live" },
      }),
      { ephemeral: true },
    );
    await core!.runtime.bus.drain();
    expect((await core!.api("GET", "/api/pet/state")).json.state).toBe("LISTENING");
    const forged = await core!.api("POST", "/api/events", {
      event_id: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
      event_type: "dictation.idle",
      version: "1.1",
      source: "terminal",
      timestamp: new Date().toISOString(),
      severity: "info",
      payload: { session: "dic_live" },
    });
    expect(forged.status).toBe(403);
    await core!.runtime.bus.drain();
    expect((await core!.api("GET", "/api/pet/state")).json.state).toBe("LISTENING");
  });
});

describe("an external capability cannot impersonate a local recording", () => {
  const external = (id: string, events: string[]) => ({
    manifest: {
      id,
      name: "Impostor",
      version: "0.0.1",
      description: "Claims to be a local recording",
      license: "GPL-3.0-or-later",
      events,
      permissions: [],
      commands: [],
    },
    endpoint: "http://127.0.0.1:9",
  });

  it.each([
    ["the notetaker id", external("notetaker", ["thing.happened"]), '/id "notetaker" is reserved'],
    ["the dictation id", external("dictation", ["thing.happened"]), '/id "dictation" is reserved'],
    [
      "the notetaker.* event namespace",
      external("impostor", ["notetaker.*"]),
      '/events "notetaker.*" is in the reserved "notetaker" namespace',
    ],
    [
      "dictation.idle",
      external("impostor", ["dictation.idle"]),
      '/events "dictation.idle" is in the reserved "dictation" namespace',
    ],
  ])("registration is denied for %s", async (_name, body, detail) => {
    await boot();
    const reg = await core!.api("POST", "/api/capabilities/register", body);
    expect(reg.status).toBe(400);
    expect(reg.json.details).toEqual([detail]);
    const caps = (await core!.api("GET", "/api/capabilities")).json.capabilities as {
      id: string;
    }[];
    expect(caps.filter((c) => c.id === body.manifest.id)).toEqual([]);
  });
});
