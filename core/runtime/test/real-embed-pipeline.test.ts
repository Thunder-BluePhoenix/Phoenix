// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 37 embedding pipeline through a REAL in-process Core and the owner's REAL local Ollama
// (`nomic-embed-text` only; nothing is pulled, created, removed or generated):
//   1. cold model load (the model is evicted with keep_alive 0, then the indexer runs),
//   2. a provider outage mid-run, the persisted cooldown, and a NEW Core started on the SAME data
//      dir during the cooldown (no embed request may reach the provider until it expires),
//   3. switching the embedding model on a real database.
// Skipped unless PHOENIX_REAL_OLLAMA is set, so CI never runs it:
//   PHOENIX_REAL_OLLAMA=1 PHOENIX_EVIDENCE_OUT=/tmp/phoenix-embed.json \
//     node node_modules/vitest/vitest.mjs run core/runtime/test/real-embed-pipeline.test.ts \
//     --testTimeout=120000 -t "<scenario>"
// Core reaches Ollama ONLY through a loopback HTTP proxy owned by this test (port 11998). The
// proxy forwards three routes (GET /api/version, GET /api/tags, POST /api/embed with a model
// allow-list) to 127.0.0.1:11434, counts every request, and can drop connections, which is how the
// outage is made without touching the owner's Ollama process. Nothing is tuned after a result:
// the test asserts only what the code itself claims and records everything else.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults } from "@phoenix/config";
import { silentLogger } from "@phoenix/logging";
import { MemorySecretStore } from "@phoenix/persistence";
import { INDEXER_COOLDOWN_KEY, VectorDimensionError } from "@phoenix/ai-retrieval";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PhoenixRuntime } from "../src";
import { TOKEN } from "./helpers";

const OLLAMA = "http://127.0.0.1:11434";
const OLLAMA_PORT = 11434;
const PROXY_PORT = 11998;
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;
const REAL_MODEL = "nomic-embed-text";
/** A second LOGICAL model: the proxy rewrites it to the real model (see scenario 3). */
const ALIAS_MODEL = "nomic-embed-text-alias256";
const ALIAS_DIMENSIONS = 256;
const REAL_SPACE_ID = "ollama/nomic-embed-text#prefixed";
const ALIAS_KEY = `ollama/${ALIAS_MODEL}#prefixed`;
const TIMEOUT_MS = 600_000;

const evidence: Record<string, unknown> = {};
const cleanups: (() => Promise<void> | void)[] = [];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── The fixed synthetic corpus: 36 short notes, three topics of 12, no personal data ──────────

const COOKING = [
  "Simmer the tomato sauce for forty minutes with garlic and fresh basil.",
  "Knead the bread dough until it is smooth, then let it rise in a warm bowl.",
  "Roast the carrots and potatoes with olive oil at two hundred degrees.",
  "Whisk the eggs and sugar before folding in the flour for the sponge cake.",
  "Season the soup with salt and pepper after the onions have turned golden.",
  "Marinate the chicken overnight in lemon juice, yogurt and smoked paprika.",
  "Boil the pasta in plenty of salted water and keep a cup of the cooking water.",
  "Chop the herbs finely and stir them into the rice just before serving.",
  "Bake the cookies until the edges are brown but the centres are still soft.",
  "Toast the spices in a dry pan to release their aroma before grinding.",
  "Let the steak rest for five minutes after frying so the juices stay inside.",
  "Blend the roasted peppers with almonds to make a smooth red dip.",
];
const ASTRONOMY = [
  "Jupiter has four large moons that can be seen through a small telescope.",
  "A lunar eclipse happens when the Earth passes between the Sun and the Moon.",
  "The Milky Way is a spiral galaxy containing hundreds of billions of stars.",
  "A light year is the distance light travels in one year through empty space.",
  "Saturn is famous for its bright rings made of ice and rock fragments.",
  "Comets grow glowing tails when they approach the Sun and their ice evaporates.",
  "Neutron stars are the collapsed cores of massive stars after a supernova.",
  "Mars has the tallest volcano in the solar system, called Olympus Mons.",
  "Telescopes with larger mirrors collect more light from faint distant galaxies.",
  "The Sun is a star made mostly of hydrogen and helium fusing in its core.",
  "A meteor shower occurs when the Earth crosses the trail of dust left by a comet.",
  "Black holes bend light because their gravity is strong enough to trap it.",
];
const CYCLING = [
  "Check the tyre pressure before every ride to avoid punctures on the road.",
  "A lighter bicycle frame makes climbing steep hills noticeably easier.",
  "Oil the chain regularly and wipe off the dirt to keep the gears shifting.",
  "Adjust the saddle height so your knee is slightly bent at the bottom of a pedal stroke.",
  "Disc brakes give more stopping power than rim brakes in wet weather.",
  "Clip-in pedals let a cyclist pull the pedal up as well as push it down.",
  "A fixed gear bike has no freewheel, so the pedals turn whenever the wheels turn.",
  "Wear a helmet and use front and rear lights when riding at night.",
  "Cadence is the number of pedal revolutions a rider turns each minute.",
  "Mountain bikes have wide knobbly tyres and suspension for rough trails.",
  "Group riders take turns at the front to share the effort against the wind.",
  "Tubeless tyres seal small holes with liquid so a flat is less likely.",
];
const CORPUS = [...COOKING, ...ASTRONOMY, ...CYCLING];
const TOPIC_OF = (i: number) => Math.floor(i / 12);

// ── The loopback proxy (the only way Core reaches Ollama) ────────────────────────────────────

interface ProxyEntry {
  at: number;
  method: string;
  path: string;
  /** What Core asked for / what the proxy sent upstream. */
  model: string | null;
  upstreamModel: string | null;
  inputs: number;
  texts: string[];
  outcome: "forwarded" | "reset" | "refused";
  status: number | null;
  ms: number;
}

class LoopbackProxy {
  readonly log: ProxyEntry[] = [];
  /** While true every request is accepted and then its connection is destroyed. */
  reset = false;
  /** After this many forwarded embeds, flip to `reset` (null: never). */
  resetAfterEmbeds: number | null = null;
  private server: http.Server | null = null;

  async start(): Promise<void> {
    this.reset = false;
    const server = http.createServer((req, res) => void this.handle(req, res));
    server.keepAliveTimeout = 1000;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(PROXY_PORT, "127.0.0.1", () => resolve());
    });
    this.server = server;
  }

  /** Stops listening and drops every open connection: new connects are refused. */
  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  embeds(): ProxyEntry[] {
    return this.log.filter((e) => e.path === "/api/embed");
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const t0 = Date.now();
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const method = req.method ?? "";
    const path = req.url ?? "";
    let body: Record<string, unknown> | null = null;
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    const model = typeof body?.model === "string" ? body.model : null;
    const input = Array.isArray(body?.input) ? (body.input as string[]) : [];
    const base = { at: t0, method, path, model, upstreamModel: null as string | null };
    const entry = (
      outcome: ProxyEntry["outcome"],
      status: number | null,
      upstreamModel: string | null,
    ): void => {
      this.log.push({
        ...base,
        upstreamModel,
        inputs: input.length,
        texts: input,
        outcome,
        status,
        ms: Date.now() - t0,
      });
    };
    const allowed =
      (method === "GET" && (path === "/api/version" || path === "/api/tags")) ||
      (method === "POST" &&
        path === "/api/embed" &&
        (model === REAL_MODEL || model === ALIAS_MODEL));
    if (!allowed) {
      entry("refused", 403, null);
      res.writeHead(403).end("refused by the test proxy");
      return;
    }
    if (
      path === "/api/embed" &&
      this.resetAfterEmbeds !== null &&
      this.embeds().filter((e) => e.outcome === "forwarded").length >= this.resetAfterEmbeds
    ) {
      this.reset = true;
      this.resetAfterEmbeds = null;
    }
    if (this.reset) {
      entry("reset", null, null);
      req.socket.destroy();
      return;
    }
    let upstreamBody = raw;
    let upstreamModel: string | null = model;
    if (path === "/api/embed" && model === ALIAS_MODEL) {
      upstreamModel = REAL_MODEL;
      upstreamBody = JSON.stringify({ ...body, model: REAL_MODEL });
    }
    await new Promise<void>((resolve) => {
      const up = http.request(
        {
          host: "127.0.0.1",
          port: OLLAMA_PORT,
          method,
          path,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(upstreamBody),
          },
        },
        (ur) => {
          const parts: Buffer[] = [];
          ur.on("data", (c: Buffer) => parts.push(c));
          ur.on("end", () => {
            entry("forwarded", ur.statusCode ?? 0, upstreamModel);
            let answer = Buffer.concat(parts);
            if (path === "/api/embed" && model === ALIAS_MODEL && ur.statusCode === 200) {
              // The alias is a second logical model of a different width: keep the first
              // ALIAS_DIMENSIONS values (nomic-embed-text v1.5 is a Matryoshka model).
              const parsed = JSON.parse(answer.toString("utf8")) as { embeddings: number[][] };
              parsed.embeddings = parsed.embeddings.map((v) => v.slice(0, ALIAS_DIMENSIONS));
              answer = Buffer.from(JSON.stringify(parsed));
            }
            res.writeHead(ur.statusCode ?? 502, { "content-type": "application/json" });
            res.end(answer);
            resolve();
          });
        },
      );
      up.on("error", () => {
        entry("forwarded", 502, upstreamModel);
        res.writeHead(502).end();
        resolve();
      });
      up.end(upstreamBody);
    });
  }
}

// ── Core on a temp data dir that survives stop/start ──────────────────────────────────────────

interface Core {
  runtime: PhoenixRuntime;
  base: string;
  dataDir: string;
  api: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }>;
  stop: () => Promise<number>;
  startMs: number;
}

/** Refuses anything that is not the test proxy and any `:cloud` model; records nothing itself. */
const guardedFetch = (async (url: string, init?: RequestInit) => {
  const body = typeof init?.body === "string" ? init.body : "";
  if (!url.startsWith(`${PROXY_URL}/`) || /cloud/i.test(body)) {
    throw new TypeError("blocked by the real-embed test guard");
  }
  return fetch(url, init);
}) as unknown as NonNullable<ConstructorParameters<typeof PhoenixRuntime>[0]["fetch"]>;

async function bootCore(dataDir: string): Promise<Core> {
  const t0 = Date.now();
  const runtime = new PhoenixRuntime({
    config: { ...defaults("dev"), port: 0, dataDir },
    logger: silentLogger,
    token: TOKEN,
    writeTokenFile: false,
    capabilities: [],
    secrets: new MemorySecretStore(),
    fetch: guardedFetch,
    ollamaUrl: PROXY_URL,
  });
  const { port } = await runtime.start();
  const base = `http://127.0.0.1:${port}`;
  const startMs = Date.now() - t0;
  let stopped: Promise<number> | null = null;
  const stop = (): Promise<number> =>
    (stopped ??= (async () => {
      const s = Date.now();
      await runtime.stop();
      return Date.now() - s;
    })());
  cleanups.push(async () => void (await stop()));
  const api: Core["api"] = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, json: text ? (JSON.parse(text) as any) : undefined };
  };
  return { runtime, base, dataDir, api, stop, startMs };
}

function newDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "phoenix-real-embed-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function capture(core: Core): string[] {
  const ids: string[] = [];
  CORPUS.forEach((text, i) => {
    const out = core.runtime.memory.pipeline.capture({
      source: "git",
      sourceRef: "synthetic-corpus",
      scope: "repo:synthetic",
      contentType: "note",
      text,
      observedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      dedupeKey: `synthetic-note-${i}`,
      provenance: {},
    });
    if (out.status !== "stored") throw new Error(`note ${i} not stored: ${JSON.stringify(out)}`);
    ids.push(out.item.id);
  });
  return ids;
}

const turnOn = async (core: Core) => {
  expect((await core.api("POST", "/api/ai/settings", { enabled: true })).status).toBe(200);
  expect((await core.api("POST", "/api/retrieval/settings", { enabled: true })).status).toBe(200);
};

const status = async (core: Core) => (await core.api("GET", "/api/retrieval/status")).json;

interface Stored {
  memory_id: string;
  model: string;
  dim: number;
  vector: Uint8Array;
  created_at: string;
}
function storedVectors(core: Core, model: string): Stored[] {
  return core.runtime.db
    .prepare("SELECT memory_id, model, dim, vector, created_at FROM memory_vectors WHERE model = ?")
    .all(model) as unknown as Stored[];
}
function unit(blob: Uint8Array): Float32Array {
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}
const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

async function ps(): Promise<string[]> {
  const body = (await (await fetch(`${OLLAMA}/api/ps`)).json()) as { models: { name: string }[] };
  return body.models.map((m) => m.name);
}
/** Local models by name+digest, plus a digest of the whole list (remote-tagged entries are never named). */
async function tags(): Promise<{
  local: string[];
  remote_tagged_count: number;
  list_sha256: string;
}> {
  const body = (await (await fetch(`${OLLAMA}/api/tags`)).json()) as {
    models: { name: string; digest: string }[];
  };
  const all = body.models.map((m) => `${m.name}@${m.digest}`).sort();
  const isRemote = (n: string) => /cloud/i.test(n);
  return {
    local: all.filter((n) => !isRemote(n)).map((n) => n.slice(0, n.indexOf("@") + 13)),
    remote_tagged_count: all.filter(isRemote).length,
    list_sha256: createHash("sha256").update(all.join("\n")).digest("hex"),
  };
}

const proxy = new LoopbackProxy();
const summarize = (entries: ProxyEntry[]) =>
  entries.map((e) => ({
    path: e.path,
    model: e.model,
    upstream_model: e.upstreamModel,
    inputs: e.inputs,
    outcome: e.outcome,
    status: e.status,
    ms: e.ms,
  }));

beforeAll(async () => {
  if (!process.env.PHOENIX_REAL_OLLAMA) return;
  const version = (await (await fetch(`${OLLAMA}/api/version`)).json()) as { version: string };
  evidence.environment = {
    date: new Date().toISOString(),
    ollama_version: version.version,
    tags_before: await tags(),
    ps_before: await ps(),
    node: process.version,
    corpus_notes: CORPUS.length,
  };
  await proxy.start();
}, 60_000);

afterAll(async () => {
  if (!process.env.PHOENIX_REAL_OLLAMA) return;
  await proxy.stop();
  for (const c of cleanups.splice(0).reverse()) await c();
  evidence.tags_after = await tags();
  evidence.proxy_refused = proxy.log.filter((e) => e.outcome === "refused").length;
  const out = process.env.PHOENIX_EVIDENCE_OUT;
  if (out) writeFileSync(out, JSON.stringify(evidence, null, 2));
}, 120_000);

const real = !!process.env.PHOENIX_REAL_OLLAMA;

// ── 1. Cold start ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!real)(
  "phase 37: cold model load through the real indexer",
  { timeout: TIMEOUT_MS },
  () => {
    it("embeds the corpus after the model was evicted, and stores sane vectors", async () => {
      const obs: Record<string, unknown> = {};
      evidence.cold_start = obs;

      // Evict ONLY nomic-embed-text from memory (keep_alive 0 deletes nothing).
      const evict = await fetch(`${OLLAMA}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: REAL_MODEL, keep_alive: 0 }),
      });
      obs.evict_status = evict.status;
      await evict.text();
      for (let i = 0; i < 20 && (await ps()).some((n) => n.startsWith(REAL_MODEL)); i++)
        await sleep(250);
      const loadedAfterEvict = await ps();
      obs.ps_after_evict = loadedAfterEvict;
      expect(loadedAfterEvict.some((n) => n.startsWith(REAL_MODEL))).toBe(false);

      const core = await bootCore(newDataDir());
      obs.core_start_ms = core.startMs;
      capture(core);
      const mark = proxy.log.length;
      const t0 = Date.now();
      await turnOn(core);
      await core.runtime.retrieval.settled();
      obs.index_wall_ms = Date.now() - t0;
      const st = await status(core);
      obs.status_after_cold_index = st;
      const wire = proxy.log.slice(mark);
      obs.wire = summarize(wire);
      const embeds = wire.filter((e) => e.path === "/api/embed");
      obs.cold_first_embed_ms = embeds[0]?.ms ?? null;
      obs.cold_embed_batches = embeds.map((e) => e.inputs);
      obs.retries_or_failures = embeds.filter(
        (e) => e.outcome !== "forwarded" || e.status !== 200,
      ).length;
      obs.ps_after_index = await ps();

      expect(embeds.every((e) => e.status === 200)).toBe(true);
      expect(st).toMatchObject({
        embedded: CORPUS.length,
        total: CORPUS.length,
        unembedded: 0,
        failures: 0,
      });
      const rows = storedVectors(core, REAL_SPACE_ID);
      obs.vector_count = rows.length;
      obs.vector_dim = [...new Set(rows.map((r) => r.dim))];
      expect(rows).toHaveLength(CORPUS.length);
      expect(new Set(rows.map((r) => r.dim)).size).toBe(1);

      // Same texts embedded again while warm (explicit rebuild goes through the same indexer).
      const mark2 = proxy.log.length;
      const t1 = Date.now();
      expect((await core.api("POST", "/api/retrieval/rebuild", { confirm: true })).status).toBe(
        200,
      );
      obs.warm_rebuild_wall_ms = Date.now() - t1;
      const warm = proxy.log.slice(mark2).filter((e) => e.path === "/api/embed");
      obs.warm_embed_ms = warm.map((e) => e.ms);
      obs.warm_batches = warm.map((e) => e.inputs);

      // Sanity on the stored vectors: topic mates are closer than different topics (mean cosine).
      const byId = new Map(rows.map((r) => [r.memory_id, unit(r.vector)]));
      const order = core.runtime.db
        .prepare("SELECT id, dedupe_key FROM memory_items ORDER BY seq")
        .all() as unknown as { id: string; dedupe_key: string }[];
      const vecs = order.map((o) => byId.get(o.id)!);
      let within = 0;
      let across = 0;
      let nw = 0;
      let na = 0;
      for (let i = 0; i < vecs.length; i++) {
        for (let j = i + 1; j < vecs.length; j++) {
          const c = dot(vecs[i]!, vecs[j]!);
          if (TOPIC_OF(i) === TOPIC_OF(j)) ((within += c), nw++);
          else ((across += c), na++);
        }
      }
      obs.mean_cosine_same_topic = within / nw;
      obs.mean_cosine_different_topic = across / na;
      expect(within / nw).toBeGreaterThan(across / na);

      obs.core_stop_ms = await core.stop();
    });
  },
);

// ── 2. Outage, persisted cooldown, restart during the cooldown ───────────────────────────────

describe.skipIf(!real)(
  "phase 37: outage and restart during the cooldown",
  { timeout: TIMEOUT_MS },
  () => {
    it("honours the saved cooldown in a new Core on the same data dir, then resumes without loss", async () => {
      const obs: Record<string, unknown> = {};
      evidence.outage_restart = obs;
      const dir = newDataDir();

      const a = await bootCore(dir);
      capture(a);
      const seen: string[] = [];
      a.runtime.bus.subscribe("real-embed-probe", "*", (e) => void seen.push(e.event_type));
      // Let the first batch of 16 through, then drop every connection (mid-run outage).
      proxy.resetAfterEmbeds = proxy.embeds().filter((e) => e.outcome === "forwarded").length + 1;
      const mark = proxy.log.length;
      const t0 = Date.now();
      await turnOn(a);
      await a.runtime.retrieval.settled();
      obs.outage_run_wall_ms = Date.now() - t0;
      const stA = await status(a);
      obs.status_a_after_outage = stA;
      obs.wire_a = summarize(proxy.log.slice(mark));
      obs.events_a = seen;
      obs.audit_actions_a = (
        (await a.api("GET", "/api/audit?limit=50")).json.entries as { action: string }[]
      ).map((x) => x.action);
      const aiStatus = (await a.api("GET", "/api/ai/status")).json;
      obs.ai_status_a = aiStatus;
      const cooldownA = a.runtime.settings.get<number | null>(INDEXER_COOLDOWN_KEY, null);
      obs.cooldown_until_a = cooldownA;
      obs.cooldown_remaining_ms_a = cooldownA === null ? null : cooldownA - Date.now();
      const rowRaw = a.runtime.db
        .prepare("SELECT key, value FROM settings WHERE key = ?")
        .get(INDEXER_COOLDOWN_KEY) as { key: string; value: string } | undefined;
      obs.cooldown_row_in_settings_table = rowRaw ?? null;
      expect(typeof cooldownA).toBe("number");
      expect(cooldownA!).toBeGreaterThan(Date.now());
      expect(stA.last_run.degraded).toContain("provider_unavailable");
      obs.vectors_before_restart = storedVectors(a, REAL_SPACE_ID).length;
      obs.failures_recorded_a = stA.failures;
      expect(storedVectors(a, REAL_SPACE_ID).length).toBe(16);
      obs.core_a_stop_ms = await a.stop();

      // Provider is back (proxy up, no longer dropping); a NEW Core on the SAME data dir starts
      // DURING the cooldown.
      await proxy.stop();
      await proxy.start();
      const markB = proxy.log.length;
      const b = await bootCore(dir);
      obs.core_b_start_ms = b.startMs;
      obs.cooldown_at_b_start = b.runtime.settings.get<number | null>(INDEXER_COOLDOWN_KEY, null);
      obs.b_settings_enabled = (await b.api("GET", "/api/retrieval/settings")).json.enabled;
      await b.runtime.memory.maintain(); // the startup trigger, awaited
      await b.runtime.retrieval.settled();
      const idle: unknown[] = [];
      for (let i = 0; i < 3; i++) {
        const rep = await b.runtime.retrieval.index();
        idle.push({ embedded: rep?.embedded, degraded: rep?.degraded.map((d) => d.reason) });
      }
      obs.b_index_during_cooldown = idle;
      const embedsDuring = proxy.log.slice(markB).filter((e) => e.path === "/api/embed");
      obs.embed_requests_during_cooldown = embedsDuring.length;
      obs.b_cooldown_remaining_ms_when_checked = cooldownA! - Date.now();
      expect(Date.now()).toBeLessThan(cooldownA!);
      expect(embedsDuring).toHaveLength(0);
      obs.status_b_during_cooldown = await status(b);

      // Real clock: wait for the cooldown (30 s, the indexer's default first backoff; Core does not
      // expose the length and injecting a clock would not exercise the production wiring).
      while (Date.now() <= cooldownA! + 50) await sleep(500);
      expect(proxy.log.slice(markB).filter((e) => e.path === "/api/embed")).toHaveLength(0);
      const markResume = proxy.log.length;
      const t1 = Date.now();
      const resumed = await b.runtime.retrieval.index();
      obs.resume_wall_ms = Date.now() - t1;
      obs.resume_report = resumed;
      const resumeEmbeds = proxy.log.slice(markResume).filter((e) => e.path === "/api/embed");
      obs.resume_batches = resumeEmbeds.map((e) => e.inputs);
      const sent = resumeEmbeds.flatMap((e) =>
        e.texts.map((t) => t.replace("search_document: ", "")),
      );
      obs.resume_texts_sent = sent.length;
      expect(new Set(sent).size).toBe(sent.length);
      const stB = await status(b);
      obs.status_b_after_resume = stB;
      obs.cooldown_after_resume = b.runtime.settings.get<number | null>(INDEXER_COOLDOWN_KEY, null);
      const rows = storedVectors(b, REAL_SPACE_ID);
      const ids = new Set(rows.map((r) => r.memory_id));
      const live = (
        b.runtime.db
          .prepare("SELECT id FROM memory_items WHERE deleted_at IS NULL")
          .all() as unknown as {
          id: string;
        }[]
      ).map((r) => r.id);
      obs.vector_rows = rows.length;
      obs.distinct_memory_ids_with_vector = ids.size;
      obs.live_memories = live.length;
      obs.lost = live.filter((id) => !ids.has(id)).length;
      obs.texts_embedded_before_plus_after = 16 + sent.length;
      expect(rows.length).toBe(CORPUS.length);
      expect(ids.size).toBe(CORPUS.length);
      expect(live.every((id) => ids.has(id))).toBe(true);
      expect(sent).toHaveLength(CORPUS.length - 16);
      expect(stB).toMatchObject({ embedded: CORPUS.length, unembedded: 0, failures: 0 });
      expect(obs.cooldown_after_resume).toBeNull();
      obs.core_b_stop_ms = await b.stop();
    });
  },
);

// ── 3. Model switch on a real database ───────────────────────────────────────────────────────

describe.skipIf(!real)("phase 37: switching the embedding model", { timeout: TIMEOUT_MS }, () => {
  it("keeps two vector spaces apart, never mixes them in search, and rebuilds one space only", async () => {
    const obs: Record<string, unknown> = {};
    evidence.model_switch = obs;
    const core = await bootCore(newDataDir());
    capture(core);
    await turnOn(core);
    await core.runtime.retrieval.settled();
    const hash = (rows: Stored[]) =>
      createHash("sha256")
        .update(
          rows
            .map((r) => `${r.memory_id}:${Buffer.from(r.vector).toString("hex")}`)
            .sort()
            .join("|"),
        )
        .digest("hex");
    const realRows = storedVectors(core, REAL_SPACE_ID);
    const realHash = hash(realRows);
    obs.real_space = { vectors: realRows.length, dim: realRows[0]?.dim };
    expect(realRows).toHaveLength(CORPUS.length);

    // Switch the configured model to the second logical identity.
    const mark = proxy.log.length;
    expect((await core.api("POST", "/api/retrieval/settings", { model: ALIAS_MODEL })).status).toBe(
      200,
    );
    await core.runtime.retrieval.settled();
    const st = await status(core);
    obs.status_after_switch = st;
    const aliasRows = storedVectors(core, ALIAS_KEY);
    obs.alias_space = { vectors: aliasRows.length, dim: aliasRows[0]?.dim };
    obs.switch_embed_wire = summarize(proxy.log.slice(mark).filter((e) => e.path === "/api/embed"));
    expect(st.vector_space).toBe(ALIAS_KEY);
    expect(st.other_models).toEqual([{ model: REAL_SPACE_ID, vectors: CORPUS.length }]);
    expect(aliasRows).toHaveLength(CORPUS.length);
    expect(aliasRows[0]?.dim).toBe(ALIAS_DIMENSIONS);
    expect(hash(storedVectors(core, REAL_SPACE_ID))).toBe(realHash);

    // Search under the alias: the query is embedded with the alias model (width 256) and scored
    // only against alias vectors; a 768-wide query for the alias space, or a 256-wide one for the
    // real space, is refused by the store instead of being compared.
    const markSearch = proxy.log.length;
    const q = "which telescope shows the moons of a giant planet";
    const search = (await core.api("GET", `/api/memory/search?q=${encodeURIComponent(q)}&limit=5`))
      .json;
    obs.search_alias = {
      retrieval: search.retrieval,
      top: (search.items as { text: string }[]).map((i) => i.text),
    };
    const qEmbeds = proxy.log.slice(markSearch).filter((e) => e.path === "/api/embed");
    obs.search_alias_query_wire = summarize(qEmbeds);
    expect(search.retrieval.mode).toBe("hybrid");
    expect(qEmbeds.every((e) => e.model === ALIAS_MODEL)).toBe(true);
    const v = core.runtime.retrieval.vectors;
    const wide = Array.from({ length: 768 }, () => 0.1);
    const narrow = Array.from({ length: ALIAS_DIMENSIONS }, () => 0.1);
    expect(() => v.search(ALIAS_KEY, wide, { limit: 3 })).toThrow(VectorDimensionError);
    expect(() => v.search(REAL_SPACE_ID, narrow, { limit: 3 })).toThrow(VectorDimensionError);
    const aliasHits = v.search(ALIAS_KEY, narrow, { limit: 100 }).hits.map((h) => h.memoryId);
    const aliasIds = new Set(aliasRows.map((r) => r.memory_id));
    expect(aliasHits.every((id) => aliasIds.has(id))).toBe(true);

    // Rebuild under the alias replaces the alias space only.
    const markRebuild = proxy.log.length;
    const aliasBefore = hash(aliasRows);
    expect((await core.api("POST", "/api/retrieval/rebuild", { confirm: true })).status).toBe(200);
    const rebuildEmbeds = proxy.log.slice(markRebuild).filter((e) => e.path === "/api/embed");
    obs.rebuild_alias_wire = summarize(rebuildEmbeds);
    expect(rebuildEmbeds.length).toBeGreaterThan(0);
    expect(rebuildEmbeds.every((e) => e.model === ALIAS_MODEL)).toBe(true);
    expect(rebuildEmbeds.reduce((n, e) => n + e.inputs, 0)).toBe(CORPUS.length);
    expect(storedVectors(core, ALIAS_KEY)).toHaveLength(CORPUS.length);
    obs.alias_vectors_identical_after_rebuild =
      hash(storedVectors(core, ALIAS_KEY)) === aliasBefore;
    expect(hash(storedVectors(core, REAL_SPACE_ID))).toBe(realHash);

    // Switch back: the retained real vectors are used; nothing needs re-embedding.
    const markBack = proxy.log.length;
    expect((await core.api("POST", "/api/retrieval/settings", { model: REAL_MODEL })).status).toBe(
      200,
    );
    await core.runtime.retrieval.settled();
    const back = await status(core);
    obs.status_after_switch_back = back;
    const backEmbeds = proxy.log.slice(markBack).filter((e) => e.path === "/api/embed");
    obs.switch_back_embed_requests = backEmbeds.length;
    expect(back).toMatchObject({
      vector_space: REAL_SPACE_ID,
      embedded: CORPUS.length,
      unembedded: 0,
    });
    expect(backEmbeds).toHaveLength(0);
    const searchBack = (
      await core.api("GET", `/api/memory/search?q=${encodeURIComponent(q)}&limit=5`)
    ).json;
    obs.search_real = {
      retrieval: searchBack.retrieval,
      top: (searchBack.items as { text: string }[]).map((i) => i.text),
    };

    // Rebuild under the real model replaces the real space only.
    const markRebuild2 = proxy.log.length;
    const aliasHash2 = hash(storedVectors(core, ALIAS_KEY));
    expect((await core.api("POST", "/api/retrieval/rebuild", { confirm: true })).status).toBe(200);
    const re2 = proxy.log.slice(markRebuild2).filter((e) => e.path === "/api/embed");
    obs.rebuild_real_wire = summarize(re2);
    expect(re2.every((e) => e.model === REAL_MODEL)).toBe(true);
    expect(re2.reduce((n, e) => n + e.inputs, 0)).toBe(CORPUS.length);
    expect(hash(storedVectors(core, ALIAS_KEY))).toBe(aliasHash2);
    expect(storedVectors(core, REAL_SPACE_ID)).toHaveLength(CORPUS.length);
    obs.core_stop_ms = await core.stop();
  });
});
