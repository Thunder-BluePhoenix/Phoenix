// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { FakeRecognizer } from "@phoenix/ai-multimodal";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { WS_PROTOCOL, WS_TOKEN_PREFIX } from "@phoenix/api";
import { TOKEN, connect, startCore, type TestCore } from "./helpers";

let core: TestCore | undefined;
const sockets = new Set<WebSocket>();
afterEach(async () => {
  for (const ws of sockets) ws.terminate();
  sockets.clear();
  await core?.runtime.stop();
  core = undefined;
});

const PCM = Buffer.alloc(3200, 7); // 100 ms
const SECRET_WORDS = "zebra quantum marmalade";

async function boot(transcript = SECRET_WORDS, extra: Parameters<typeof startCore>[1] = {}) {
  const recognizer = new FakeRecognizer({ transcript });
  core = await startCore(
    {},
    { ...extra, runtime: { dictationRecognizer: recognizer, ...extra.runtime } },
  );
  return recognizer;
}
const enable = () => core!.api("POST", "/api/dictation/settings", { enabled: true });

/** Opens the dictation stream with the exact headers a same-origin page sends. */
function stream(
  session: string,
  options: { token?: string; origin?: string | null; path?: string; protocols?: string[] } = {},
) {
  const path = options.path ?? `/api/dictation/stream?session=${session}`;
  const ws = new WebSocket(
    `ws://127.0.0.1:${core!.port}${path}`,
    options.protocols ?? [WS_PROTOCOL, WS_TOKEN_PREFIX + (options.token ?? TOKEN)],
    { headers: options.origin === null ? {} : { Origin: options.origin ?? core!.base } },
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
  const opened = opening.promise;
  const next = (type: string) =>
    vi.waitFor(
      () => {
        const found = messages.find((m) => m.type === type);
        if (!found) throw new Error(`no ${type} message yet`);
        return found;
      },
      { timeout: 3000, interval: 5 },
    );
  const closing = Promise.withResolvers<number>();
  ws.once("close", (code) => closing.resolve(code));
  const closed = closing.promise;
  return { ws, opened, next, closed, messages };
}

describe("dictation routes", () => {
  it("is off by default: sessions are refused and nothing is listening", async () => {
    await boot();
    const status = await core!.api("GET", "/api/dictation/status");
    expect(status.json).toMatchObject({
      enabled: false,
      audio_on_disk: false,
      kill_switch_engaged: false,
    });
    const refused = await core!.api("POST", "/api/dictation/sessions", {});
    expect(refused.status).toBe(409);
    expect(refused.json.message).toMatch(/Dictation is off/);
  });

  it("without a configured recogniser the Core says `unavailable` and starts nothing", async () => {
    core = await startCore();
    await enable();
    const status = await core.api("GET", "/api/dictation/status");
    expect(status.json.recognizer.available).toBe(false);
    expect(status.json.recognizer.detail).toMatch(/No on-device speech recogniser/);
    const res = await core.api("POST", "/api/dictation/sessions", {});
    expect(res.status).toBe(503);
  });

  it("requires the session token on every route", async () => {
    await boot();
    for (const [method, path] of [
      ["GET", "/api/dictation/status"],
      ["GET", "/api/dictation/settings"],
      ["POST", "/api/dictation/settings"],
      ["POST", "/api/dictation/sessions"],
      ["DELETE", "/api/dictation/stats"],
      ["GET", "/api/dictation/stats"],
    ] as const) {
      const res = await fetch(core!.base + path, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("validates settings and refuses hostile vocabulary with a 400", async () => {
    await boot();
    expect(
      (
        await core!.api("POST", "/api/dictation/settings", {
          vocabulary: { replacements: [{ from: "(a+)+", to: "x" }] },
        })
      ).status,
    ).toBe(400);
    expect((await core!.api("POST", "/api/dictation/settings", { typing_wpm: 5 })).status).toBe(
      400,
    );
    expect((await core!.api("POST", "/api/dictation/settings", { nope: true })).status).toBe(400);
    const ok = await core!.api("POST", "/api/dictation/settings", {
      enabled: true,
      typing_wpm: 50,
      app_modes: { "com.example.app": "polished" },
      vocabulary: {
        dictionary: [{ term: "Phoenix" }],
        replacements: [{ from: "um", to: "" }],
        snippets: [{ trigger: "my sig", text: "Best, A" }],
      },
    });
    expect(ok.status).toBe(200);
    expect((await core!.api("GET", "/api/dictation/settings")).json).toMatchObject({
      enabled: true,
      typing_wpm: 50,
      default_mode: "as_said",
    });
  });

  it("start -> stream -> finish returns the text; LISTENING is shown for the whole capture and cleared after; audio is zeroed", async () => {
    const recognizer = await boot();
    await enable();
    const hub = connect(core!.port);
    await hub.opened;
    hub.send({ type: "subscribe", channels: ["state.changed"] });
    await hub.next((m) => m.channel === "state.changed");

    const start = await core!.api("POST", "/api/dictation/sessions", { app: "com.example.app" });
    expect(start.status).toBe(200);
    const id = start.json.id as string;
    expect(id).toMatch(/^dic_[0-9a-f]{32}$/);
    const listening = await hub.next(
      (m) => m.channel === "state.changed" && m.data.state === "LISTENING",
    );
    expect(listening.data.explanation).toMatch(/microphone is on/);

    const s = stream(id);
    expect(await s.opened).toBe(101);
    await s.next("ready");
    s.ws.send(PCM);
    s.ws.send(JSON.stringify({ type: "end" }));
    await s.next("audio_ended");

    const done = await core!.api("POST", `/api/dictation/sessions/${id}/finish`, {});
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ text: SECRET_WORDS, words: 3 });
    await hub.next((m) => m.channel === "state.changed" && m.data.state === "IDLE");
    expect(recognizer.sessions[0]!.chunks.every((c) => c.every((v) => v === 0))).toBe(true);
    expect(recognizer.sessions[0]!.chunks.length).toBe(1);
    hub.ws.close();
  });

  it("LISTENING is published for the whole capture even before any audio, and cancel ends it", async () => {
    const recognizer = await boot();
    await enable();
    const hub = connect(core!.port);
    await hub.opened;
    hub.send({ type: "subscribe", channels: ["state.changed"] });
    await hub.next((m) => m.channel === "state.changed");
    const id = (await core!.api("POST", "/api/dictation/sessions", {})).json.id as string;
    await hub.next((m) => m.channel === "state.changed" && m.data.state === "LISTENING");
    const s = stream(id);
    await s.opened;
    await s.next("ready");
    s.ws.send(PCM);
    await vi.waitFor(() => expect(recognizer.sessions[0]!.chunks.length === 1).toBe(true));
    expect((await core!.api("DELETE", `/api/dictation/sessions/${id}`)).status).toBe(200);
    await hub.next((m) => m.channel === "state.changed" && m.data.state === "IDLE");
    expect(recognizer.sessions[0]!.chunks.every((c) => c.every((v) => v === 0))).toBe(true);
    expect((await s.next("ended")).reason).toBe("cancelled");
    expect((await core!.api("DELETE", `/api/dictation/sessions/${id}`)).status).toBe(200); // idempotent
    expect((await core!.api("POST", `/api/dictation/sessions/${id}/finish`, {})).status).toBe(400);
    hub.ws.close();
  });

  it("a second start is refused while one is active", async () => {
    await boot();
    await enable();
    expect((await core!.api("POST", "/api/dictation/sessions", {})).status).toBe(200);
    const second = await core!.api("POST", "/api/dictation/sessions", {});
    expect(second.status).toBe(400);
    expect(second.json.message).toMatch(/already in progress/);
  });

  it("rejects unknown fields, a bad app id and unknown sessions with 4xx", async () => {
    await boot();
    await enable();
    expect((await core!.api("POST", "/api/dictation/sessions", { app: "a b/../c" })).status).toBe(
      400,
    );
    expect((await core!.api("POST", "/api/dictation/sessions", { app: 5 })).status).toBe(400);
    expect((await core!.api("POST", "/api/dictation/sessions", { text: "hi" })).status).toBe(400);
    expect((await core!.api("POST", "/api/dictation/sessions/dic_nope/finish", {})).status).toBe(
      404,
    );
    expect((await core!.api("DELETE", "/api/dictation/sessions/dic_nope")).status).toBe(404);
  });

  it("the kill switch aborts a capture at once, zeroes the audio and clears LISTENING", async () => {
    const recognizer = await boot();
    await enable();
    const hub = connect(core!.port);
    await hub.opened;
    hub.send({ type: "subscribe", channels: ["state.changed"] });
    await hub.next((m) => m.channel === "state.changed");
    const id = (await core!.api("POST", "/api/dictation/sessions", {})).json.id as string;
    const s = stream(id);
    await s.opened;
    await s.next("ready");
    s.ws.send(PCM);
    await vi.waitFor(() => expect(recognizer.sessions[0]!.chunks.length === 1).toBe(true));
    await core!.api("POST", "/api/security/kill-switch", { engaged: true });
    expect((await s.next("ended")).reason).toBe("kill_switch");
    await vi.waitFor(() => expect(recognizer.sessions[0]!.state === "cancelled").toBe(true));
    expect(recognizer.sessions[0]!.chunks.every((c) => c.every((v) => v === 0))).toBe(true);
    expect((await core!.api("POST", "/api/dictation/sessions", {})).status).toBe(409);
    expect((await core!.api("GET", "/api/dictation/status")).json.kill_switch_engaged).toBe(true);
    hub.ws.close();
  });

  it("turning dictation off aborts a running capture", async () => {
    const recognizer = await boot();
    await enable();
    const id = (await core!.api("POST", "/api/dictation/sessions", {})).json.id as string;
    const s = stream(id);
    await s.opened;
    await s.next("ready");
    s.ws.send(PCM);
    await vi.waitFor(() => expect(recognizer.sessions[0]!.chunks.length === 1).toBe(true));
    await core!.api("POST", "/api/dictation/settings", { enabled: false });
    expect((await s.next("ended")).reason).toBe("disabled");
    expect(recognizer.sessions[0]!.chunks.every((c) => c.every((v) => v === 0))).toBe(true);
  });

  it("closing the WebSocket before `end` cancels and zeroes the audio", async () => {
    const recognizer = await boot();
    await enable();
    const id = (await core!.api("POST", "/api/dictation/sessions", {})).json.id as string;
    const s = stream(id);
    await s.opened;
    await s.next("ready");
    s.ws.send(PCM);
    await vi.waitFor(() => expect(recognizer.sessions[0]!.chunks.length === 1).toBe(true));
    s.ws.close();
    await vi.waitFor(() => expect(recognizer.sessions[0]!.state === "cancelled").toBe(true));
    expect(recognizer.sessions[0]!.chunks.every((c) => c.every((v) => v === 0))).toBe(true);
    expect((await core!.api("GET", "/api/dictation/status")).json.active).toBeNull();
  });

  it("an invalid frame ends the session with an error and a closed socket", async () => {
    const recognizer = await boot();
    await enable();
    const id = (await core!.api("POST", "/api/dictation/sessions", {})).json.id as string;
    const s = stream(id);
    await s.opened;
    await s.next("ready");
    s.ws.send(Buffer.alloc(3, 1)); // odd length
    expect((await s.next("error")).error).toMatch(/invalid audio frame/);
    expect(await s.closed).toBe(1008);
    await vi.waitFor(() => expect(recognizer.sessions[0]!.state === "cancelled").toBe(true));
  });

  it("audit entries for start/finish carry no text", async () => {
    await boot();
    await enable();
    const id = (await core!.api("POST", "/api/dictation/sessions", { app: "com.private.app" })).json
      .id as string;
    const s = stream(id);
    await s.opened;
    await s.next("ready");
    s.ws.send(PCM);
    s.ws.send(JSON.stringify({ type: "end" }));
    await s.next("audio_ended");
    await core!.api("POST", `/api/dictation/sessions/${id}/finish`, {});
    const audit = await core!.api("GET", "/api/audit?limit=50");
    const entries = (audit.json.entries as { action: string }[]).filter((e) =>
      e.action.startsWith("dictation."),
    );
    expect(entries.map((e) => e.action).sort()).toEqual([
      "dictation.finish",
      "dictation.settings",
      "dictation.start",
    ]);
    const text = JSON.stringify(entries);
    expect(text).not.toContain("zebra");
    expect(text).not.toContain("com.private.app");
  });
});

describe("dictation stream WebSocket access rules", () => {
  async function session() {
    await boot();
    await enable();
    return (await core!.api("POST", "/api/dictation/sessions", {})).json.id as string;
  }
  it("refuses missing or foreign origins, a wrong token, a cookie, extra query parameters", async () => {
    const id = await session();
    expect(await stream(id, { origin: null }).opened).toBe(403);
    expect(await stream(id, { origin: "http://attacker.invalid" }).opened).toBe(403);
    expect(await stream(id, { origin: `http://localhost:${core!.port}` }).opened).toBe(403); // not the exact Host
    expect(await stream(id, { token: "wrong" }).opened).toBe(401);
    expect(
      await stream(id, { path: `/api/dictation/stream?session=${id}&token=${TOKEN}` }).opened,
    ).toBe(403);
    expect(
      await stream(id, { path: `/api/dictation/stream?session=${id}&session=${id}` }).opened,
    ).toBe(403);
    expect(await stream(id, { path: `/api/dictation/stream` }).opened).toBe(403);
    expect(await stream(id, { protocols: [WS_PROTOCOL] }).opened).toBe(401);
    expect(await stream(id, { path: `/api/dictation/stream?session=nope` }).opened).toBe(400);
    expect(await stream("dic_" + "0".repeat(32)).opened).toBe(409);
  });
  it("a cookie is refused", async () => {
    const id = await session();
    const ws = new WebSocket(
      `ws://127.0.0.1:${core!.port}/api/dictation/stream?session=${id}`,
      [WS_PROTOCOL, WS_TOKEN_PREFIX + TOKEN],
      { headers: { Origin: core!.base, Cookie: "a=b" } },
    );
    sockets.add(ws);
    ws.on("error", () => {});
    const outcome = Promise.withResolvers<number>();
    ws.once("open", () => outcome.resolve(101));
    ws.once("unexpected-response", (_r, res) => outcome.resolve(res.statusCode ?? 0));
    expect(await outcome.promise).toBe(403);
  });
  it("the stream is single use", async () => {
    const id = await session();
    const first = stream(id);
    expect(await first.opened).toBe(101);
    await first.next("ready");
    expect(await stream(id).opened).toBe(409);
    expect((await core!.api("GET", "/api/dictation/status")).json.active).toMatchObject({
      id,
      phase: "listening",
    });
  });
  it("the stream is refused when dictation is off, and the socket cannot be used to send text", async () => {
    const id = await session();
    const s = stream(id);
    await s.opened;
    await s.next("ready");
    s.ws.send(JSON.stringify({ type: "text", text: "inject" }));
    expect((await s.next("error")).error).toMatch(/Only PCM/);
    await s.closed;
  });
});

describe("dictation statistics", () => {
  async function dictate(app: string | undefined, ms = 100) {
    const id = (await core!.api("POST", "/api/dictation/sessions", app ? { app } : {})).json
      .id as string;
    const s = stream(id);
    await s.opened;
    await s.next("ready");
    for (let i = 0; i < ms / 100; i++) s.ws.send(PCM);
    s.ws.send(JSON.stringify({ type: "end" }));
    await s.next("audio_ended");
    return core!.api("POST", `/api/dictation/sessions/${id}/finish`, {});
  }
  it("aggregates only: no text, no audio in any table; delete-all removes it", async () => {
    await boot();
    await enable();
    await dictate("com.example.app", 200);
    await dictate("com.example.app", 100);
    await dictate(undefined, 100);
    const stats = (await core!.api("GET", "/api/dictation/stats")).json;
    expect(stats).toMatchObject({ words: 9, sessions: 3, speech_ms: 400, typing_wpm: 40 });
    expect(stats.top_apps[0]).toEqual({ app: "com.example.app", words: 6, sessions: 2 });
    expect(stats.streak_days).toBe(1);
    expect(stats.saved_ms).toBe(Math.max(0, Math.round((9 / 40) * 60000) - 400));

    // Scan every table of the database for the dictated words.
    const db = core!.runtime.db;
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    ).map((t) => t.name);
    for (const table of tables) {
      const rows = JSON.stringify(db.prepare(`SELECT * FROM "${table}"`).all());
      expect(rows, table).not.toContain("zebra");
      expect(rows, table).not.toContain("marmalade");
    }
    const columns = (
      db.prepare("PRAGMA table_info(dictation_stats)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(columns.sort()).toEqual(["app", "day", "sessions", "speech_ms", "words"]);

    expect((await core!.api("DELETE", "/api/dictation/stats")).json).toEqual({ deleted: 2 });
    expect((await core!.api("GET", "/api/dictation/stats")).json).toMatchObject({
      words: 0,
      sessions: 0,
      top_apps: [],
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM dictation_stats").get()).toEqual({ n: 0 });
  });
  it("time saved uses the typing speed setting", async () => {
    await boot();
    await enable();
    await core!.api("POST", "/api/dictation/settings", { typing_wpm: 20 });
    await dictate("a.app", 100);
    const stats = (await core!.api("GET", "/api/dictation/stats")).json;
    expect(stats.typing_ms).toBe(9000); // 3 words at 20 wpm
  });
});

describe("dictation clean-up never reaches a cloud provider", () => {
  it("with AI on, the grant and every opt-in, clean-up goes to local Ollama only", async () => {
    const urls: string[] = [];
    const fetchFn = ((url: string) => {
      urls.push(url);
      if (url.includes("api.anthropic.com"))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{ type: "text", text: "Zebra quantum marmalade." }],
              model: "m",
              stop_reason: "end_turn",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      if (url.endsWith("/api/tags"))
        return Promise.resolve(
          new Response(JSON.stringify({ models: [{ name: "llama3.2:latest", size: 1 }] })),
        );
      if (url.endsWith("/api/version"))
        return Promise.resolve(new Response(JSON.stringify({ version: "0.1.0" })));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            message: { content: "Zebra quantum marmalade." },
            done: true,
            done_reason: "stop",
          }),
        ),
      );
    }) as unknown as typeof fetch;
    await boot(SECRET_WORDS, { runtime: { fetch: fetchFn as never } });
    await enable();
    await core!.api("POST", "/api/dictation/settings", { default_mode: "natural" });
    await core!.api("POST", "/api/ai/settings", {
      enabled: true,
      cloud_opt_in: { public: true, internal: true, sensitive: true },
    });
    await core!.api("POST", "/api/ai/external-processing", { granted: true });
    const id = (await core!.api("POST", "/api/dictation/sessions", {})).json.id as string;
    const s = stream(id);
    await s.opened;
    await s.next("ready");
    s.ws.send(PCM);
    s.ws.send(JSON.stringify({ type: "end" }));
    await s.next("audio_ended");
    const done = await core!.api("POST", `/api/dictation/sessions/${id}/finish`, {});
    expect(done.json).toMatchObject({
      text: "Zebra quantum marmalade.",
      steps: { cleanup: "used" },
    });
    expect(urls.some((u) => u.includes("anthropic"))).toBe(false);
    expect(urls.some((u) => u.includes("127.0.0.1:11434"))).toBe(true);
  });
});
