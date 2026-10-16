// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 62 through the public HTTP API: the in-memory attachment store, its limits and lifetime,
// name and path hygiene, that content reaches no event / audit row / log line / database table, and
// that asking a question is local only. All network is a fake: no real model, no real provider.
import type { CapabilityModule } from "@phoenix/capability-manager";
import type { FetchLike } from "@phoenix/ai-models";
import { PURPOSE_ANSWER_ABOUT_ATTACHMENTS } from "@phoenix/ai-context";
import { SENSITIVE_CLOUD_PURPOSES } from "@phoenix/ai-models";
import { createLogger, type LogRecord, type Logger } from "@phoenix/logging";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeNetwork, type RecordedRequest } from "./ai-network";
import { TOKEN, connect, startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

/** Assembled at runtime: no credential-shaped literal in the tree. */
const FAKE_KEY = ["ATTACHCANARY", "0123456789", "abcdef"].join("-");
/** Content that must appear nowhere but in the store and in the local model's request. */
const CANARY = "LEAKCANARY-zebra-quantum-marmalade";
const DESCRIPTION = "A whiteboard with the words VISIONCANARY on it.";
const ANSWER = "The note says the release is on Friday.";

const fakeKage: CapabilityModule = {
  manifest: {
    id: "kage",
    name: "Kage (test double)",
    version: "0.0.1",
    description: "Test double",
    license: "GPL-3.0-or-later",
    events: ["kage.*"],
    permissions: [],
    data_categories: [],
    commands: [],
  },
};

type Vision = "none" | "ok" | "text-only";

/** Ollama (text chat, plus an optional local vision model) and the Anthropic cloud, all fake. */
interface TestNetwork {
  fetch: FetchLike;
  all: RecordedRequest[];
  /** Requests that carry a prompt to the cloud provider (not its /v1/models health probe). */
  cloud(): RecordedRequest[];
  /** Chat calls to the text model (not the vision model). */
  chats(): RecordedRequest[];
  visionChats(): RecordedRequest[];
}

function network(
  options: { ollama?: "up" | "down"; vision?: Vision; reply?: string } = {},
): TestNetwork {
  const base = fakeNetwork({ ollama: options.ollama ?? "up", chat: () => options.reply ?? ANSWER });
  const all: RecordedRequest[] = [];
  const vision = options.vision ?? "none";
  const fetch: FetchLike = async (url, init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    all.push({ url, method: init?.method ?? "GET", body });
    if (vision !== "none" && options.ollama !== "down") {
      if (url === "http://127.0.0.1:11434/api/tags")
        return Response.json({
          models: [
            { name: "llama3.2:latest", size: 1 },
            { name: "nomic-embed-text:latest", size: 1 },
            { name: "llava:latest", size: 1 },
          ],
        });
      if (url.endsWith("/api/show"))
        return Response.json({
          capabilities: vision === "ok" ? ["vision", "completion"] : ["completion"],
        });
      if (url.endsWith("/api/chat") && body.includes('"model":"llava"'))
        return Response.json({ message: { role: "assistant", content: DESCRIPTION }, done: true });
    }
    return base.fetch(url, init);
  };
  return {
    fetch,
    all,
    cloud: () =>
      all.filter((r) => r.url.startsWith("https://api.anthropic.com") && r.method === "POST"),
    /** Chat calls to the text model (not the vision model). */
    chats: () =>
      all.filter((r) => r.url.endsWith("/api/chat") && !r.body.includes('"model":"llava"')),
    visionChats: () =>
      all.filter((r) => r.url.endsWith("/api/chat") && r.body.includes('"model":"llava"')),
  };
}

interface BootOptions {
  vision?: Vision;
  ollama?: "up" | "down";
  reply?: string;
  clock?: () => number;
  nonce?: () => string;
  logger?: Logger;
}

type Core = TestCore & { net: TestNetwork; secrets: MemorySecretStore };

async function boot(o: BootOptions = {}): Promise<Core> {
  const net = network(o);
  const secrets = new MemorySecretStore();
  const core = await startCore(
    {},
    {
      capabilities: [fakeKage],
      secrets,
      ...(o.logger ? { logger: o.logger } : {}),
      runtime: {
        fetch: net.fetch,
        ...((o.vision ?? "none") !== "none" ? { visionModel: "llava" } : {}),
        ...(o.clock ? { attachmentClock: o.clock } : {}),
        ...(o.nonce ? { attachmentNonce: o.nonce } : {}),
      },
    },
  );
  cleanups.push(() => core.runtime.stop());
  return { ...core, net, secrets };
}

const enableAi = (core: Core, extra: Record<string, unknown> = {}) =>
  core.api("POST", "/api/ai/settings", { enabled: true, ...extra });

const text = (over: Record<string, unknown> = {}) => ({
  name: "note.txt",
  kind: "text",
  mime: "text/plain",
  origin: "drop",
  content: `Meeting note. ${CANARY}`,
  ...over,
});

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const imageBytes = (head: number[], total = 64) =>
  Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, total - head.length), 7)]);
const image = (over: Record<string, unknown> = {}, bytes = imageBytes(PNG_HEAD)) => ({
  name: "shot.png",
  kind: "image",
  mime: "image/png",
  origin: "drop",
  content: bytes.toString("base64"),
  ...over,
});
const folder = (files: unknown[], over: Record<string, unknown> = {}) => ({
  name: "project",
  kind: "folder",
  mime: "inode/directory",
  origin: "drop",
  content: JSON.stringify({ files }),
  ...over,
});

const add = (core: Core, body: unknown) => core.api("POST", "/api/attachments", body);
const list = async (core: Core) => (await core.api("GET", "/api/attachments")).json;

describe("adding, listing, reading, removing", () => {
  it("201 with metadata and a 300-character preview; the list never holds full content", async () => {
    const core = await boot();
    const long = "a".repeat(1000);
    const res = await add(core, text({ content: long }));
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      name: "note.txt",
      kind: "text",
      origin: "drop",
      bytes: 1000,
      files: null,
    });
    expect(res.json.id).toMatch(/^att_[0-9a-f]{32}$/);
    expect(res.json.preview).toBe("a".repeat(300));
    expect(Date.parse(res.json.expires_at) - Date.parse(res.json.created_at)).toBe(3_600_000);
    expect(res.json).not.toHaveProperty("content");

    const listed = await list(core);
    expect(listed.attachments).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("a".repeat(301));
    expect(listed.limits).toMatchObject({ max_count: 10, ttl_ms: 3_600_000 });

    const full = await core.api("GET", `/api/attachments/${res.json.id}`);
    expect(full.json.content).toBe(long);
  });

  it("removes one, clears all, and says what it did", async () => {
    const core = await boot();
    const a = (await add(core, text())).json.id;
    const b = (await add(core, text({ name: "b.txt" }))).json.id;
    expect((await core.api("DELETE", `/api/attachments/${a}`)).json).toEqual({ deleted: true });
    expect((await core.api("GET", `/api/attachments/${a}`)).status).toBe(404);
    expect((await core.api("DELETE", `/api/attachments/${a}`)).status).toBe(404);
    expect((await core.api("GET", `/api/attachments/${b}`)).status).toBe(200);
    expect((await core.api("DELETE", "/api/attachments")).json).toEqual({ deleted: 1 });
    expect((await list(core)).attachments).toEqual([]);
  });

  it("is behind the session token: every route answers 401 without it", async () => {
    const core = await boot();
    for (const [method, path] of [
      ["GET", "/api/attachments"],
      ["POST", "/api/attachments"],
      ["DELETE", "/api/attachments"],
      ["GET", "/api/attachments/att_x"],
      ["DELETE", "/api/attachments/att_x"],
      ["POST", "/api/attachments/ask"],
    ] as const) {
      const res = await fetch(core.base + path, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });
      expect(res.status, `${method} ${path}`).toBe(401);
      await res.text();
    }
  });

  it("an id that is not one of ours is a plain 404", async () => {
    const core = await boot();
    for (const id of ["nope", "att_" + "g".repeat(32), "..%2f..%2fetc", "__proto__"])
      expect((await core.api("GET", `/api/attachments/${id}`)).status).toBe(404);
  });
});

describe("limits", () => {
  it("accepts 10 attachments and refuses the 11th", async () => {
    const core = await boot();
    for (let i = 0; i < 10; i++) {
      // Spread over origins that each allow their share: 3 window + 5 paste + 2 drop.
      const origin = i < 3 ? "window" : i < 8 ? "paste" : "drop";
      expect((await add(core, text({ name: `n${i}.txt`, origin }))).status).toBe(201);
    }
    const eleventh = await add(core, text({ name: "n10.txt" }));
    expect(eleventh.status).toBe(400);
    expect(eleventh.json.message).toMatch(/At most 10 attachments/);
    expect((await list(core)).attachments).toHaveLength(10);
  });

  it("bounds each origin: 3 windows, 5 pastes", async () => {
    const core = await boot();
    for (let i = 0; i < 3; i++)
      expect((await add(core, text({ origin: "window", name: `w${i}` }))).status).toBe(201);
    const fourth = await add(core, text({ origin: "window", name: "w3" }));
    expect(fourth.status).toBe(400);
    expect(fourth.json.message).toMatch(/"window"/);
    for (let i = 0; i < 5; i++)
      expect((await add(core, text({ origin: "paste", name: `p${i}` }))).status).toBe(201);
    expect((await add(core, text({ origin: "paste", name: "p5" }))).status).toBe(400);
    // Drops still have room.
    expect((await add(core, text({ origin: "drop" }))).status).toBe(201);
  });

  it("holds at most 8 MiB in total, and removing one makes room", async () => {
    const core = await boot();
    const mib3 = imageBytes(PNG_HEAD, 3 * 1024 * 1024);
    const first = await add(core, image({ name: "a.png" }, mib3));
    const second = await add(core, image({ name: "b.png" }, mib3));
    expect([first.status, second.status]).toEqual([201, 201]);
    const third = await add(core, image({ name: "c.png" }, mib3));
    expect(third.status).toBe(400);
    expect(third.json.message).toMatch(/8 MiB in total/);
    expect((await list(core)).total_bytes).toBe(6 * 1024 * 1024);
    await core.api("DELETE", `/api/attachments/${first.json.id}`);
    expect((await add(core, image({ name: "c.png" }, mib3))).status).toBe(201);
  });

  it("text is capped at 200,000 characters", async () => {
    const core = await boot();
    expect((await add(core, text({ content: "x".repeat(200_000) }))).status).toBe(201);
    const over = await add(core, text({ content: "x".repeat(200_001) }));
    expect(over.status).toBe(400);
    expect(over.json.message).toMatch(/200000 characters/);
  });

  it("an image is at most 5 MiB once decoded", async () => {
    const core = await boot();
    expect((await add(core, image({}, imageBytes(PNG_HEAD, 5 * 1024 * 1024)))).status).toBe(201);
    await core.api("DELETE", "/api/attachments");
    const over = await add(core, image({}, imageBytes(PNG_HEAD, 5 * 1024 * 1024 + 1)));
    expect(over.status).toBe(400);
    expect(over.json.message).toMatch(/5 MiB/);
  });

  it("an attachment lives one hour, judged by the injected clock", async () => {
    let now = Date.parse("2026-10-16T09:00:00Z");
    const core = await boot({ clock: () => now });
    const id = (await add(core, text())).json.id;
    now += 59 * 60_000 + 59_000;
    expect((await list(core)).attachments).toHaveLength(1);
    expect((await core.api("GET", `/api/attachments/${id}`)).status).toBe(200);
    now += 1_000;
    expect((await list(core)).attachments).toEqual([]);
    expect((await core.api("GET", `/api/attachments/${id}`)).status).toBe(404);
    // An expired attachment cannot be asked about either, and frees its room.
    await enableAi(core);
    const ask = await core.api("POST", "/api/attachments/ask", {
      question: "what?",
      attachment_ids: [id],
    });
    expect(ask.status).toBe(404);
    expect(core.net.chats()).toEqual([]);
  });

  it("the expiry is checked on write too: an expired one does not count toward the cap", async () => {
    let now = Date.parse("2026-10-16T09:00:00Z");
    const core = await boot({ clock: () => now });
    for (let i = 0; i < 3; i++) await add(core, text({ origin: "window", name: `w${i}` }));
    expect((await add(core, text({ origin: "window", name: "w3" }))).status).toBe(400);
    now += 3_600_000;
    expect((await add(core, text({ origin: "window", name: "w3" }))).status).toBe(201);
  });
});

describe("the emergency stop", () => {
  it("clears every attachment, refuses new ones while engaged, and audits the clear without content", async () => {
    const core = await boot();
    await add(core, text());
    await add(core, text({ name: "two.txt", origin: "paste" }));
    await core.api("POST", "/api/security/kill-switch", { engaged: true });
    expect((await add(core, text())).status).toBe(409);
    expect((await core.api("GET", "/api/attachments")).status).toBe(409);
    await core.api("POST", "/api/security/kill-switch", { engaged: false });
    // The clear runs when the bus delivers the event.
    await vi.waitFor(async () => expect((await list(core)).attachments).toEqual([]), {
      timeout: 3000,
      interval: 10,
    });
    const audit = (await core.api("GET", "/api/audit")).json.entries as {
      action: string;
      details: Record<string, unknown>;
    }[];
    const cleared = audit.filter((e) => e.action === "attachment.clear");
    expect(cleared.map((e) => e.details)).toContainEqual({ count: 2, reason: "kill_switch" });
    expect(JSON.stringify(audit)).not.toContain(CANARY);
  });
});

describe("names and paths", () => {
  const bad: [string, string][] = [
    ["absolute path", "/etc/passwd"],
    ["backslash root", "\\windows\\system32"],
    ["drive letter", "C:\\Users\\me\\a.txt"],
    ["dot-dot segment", "../secrets.txt"],
    ["dot-dot in the middle", "docs/../../a.txt"],
    ["NUL", "a\u0000.txt"],
    ["newline", "a\nb.txt"],
    ["escape", "a\u001b[31m.txt"],
    ["bidi override", "invoice\u202Egnp.exe"],
    ["bidi isolate", "a\u2066b.txt"],
    ["left-to-right mark", "a\u200Eb.txt"],
    ["zero-width space", "a\u200Bb.txt"],
    ["BOM", "a\uFEFFb.txt"],
    ["empty", ""],
    ["blank", "   "],
    ["121 characters", "n".repeat(121)],
  ];
  it.each(bad)("refuses a name with %s", async (_what, name) => {
    const core = await boot();
    const res = await add(core, text({ name }));
    expect(res.status).toBe(400);
    expect((await list(core)).attachments).toEqual([]);
    expect(JSON.stringify(res.json)).not.toContain(CANARY);
  });

  it("accepts ordinary names, including spaces, dots, dashes and non-Latin letters, at 120 characters", async () => {
    const core = await boot();
    for (const name of ["My report v2.final.txt", "日本語のメモ.txt", "n".repeat(120), "a..b.txt"])
      expect((await add(core, text({ name }))).status, name).toBe(201);
  });

  it("refuses a hidden character in the mime type and a non-text name", async () => {
    const core = await boot();
    expect((await add(core, text({ mime: "text/plain\u202E" }))).status).toBe(400);
    expect((await add(core, text({ mime: "x".repeat(81) }))).status).toBe(400);
    expect((await add(core, text({ name: 5 }))).status).toBe(400);
  });

  it("folder paths: absolute, `..`, empty segments, control and bidi characters are refused", async () => {
    const core = await boot();
    for (const path of [
      "/etc/passwd",
      "\\a.txt",
      "C:/a.txt",
      "../a.txt",
      "a/../b.txt",
      "a//b.txt",
      "./a.txt",
      "a/.",
      "a\u0000b",
      "a\nb",
      "a\u202Eb",
      "a\u200Bb",
      "p".repeat(301),
      "",
    ])
      expect((await add(core, folder([{ path, bytes: 1 }]))).status, JSON.stringify(path)).toBe(
        400,
      );
    expect(
      (await add(core, folder([{ path: "src/deep/a.ts", bytes: 3, text: "abc" }]))).status,
    ).toBe(201);
  });

  it("an unknown field, kind or origin is refused", async () => {
    const core = await boot();
    expect((await add(core, { ...text(), path: "/etc/passwd" })).status).toBe(400);
    expect((await add(core, text({ kind: "file" }))).status).toBe(400);
    expect((await add(core, text({ origin: "network" }))).status).toBe(400);
    expect((await add(core, text({ content: 5 }))).status).toBe(400);
    expect((await add(core, text({ content: "a\u0000b" }))).status).toBe(400);
    expect((await add(core, text({ content: "" }))).status).toBe(400);
  });
});

describe("images are judged by their bytes", () => {
  it("a lying mime type does not make text an image", async () => {
    const core = await boot();
    const notAnImage = Buffer.from("MZ\x90\x00 definitely an executable, not a picture");
    const res = await add(core, image({ mime: "image/png", name: "evil.png" }, notAnImage));
    expect(res.status).toBe(400);
    expect(res.json.message).toMatch(/PNG and JPEG/);
    // GIF, WebP, SVG and PDF are refused too, whatever they claim.
    for (const head of [
      [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
      [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
      Array.from(Buffer.from("<svg xmlns=")),
      Array.from(Buffer.from("%PDF-1.7")),
    ])
      expect((await add(core, image({ mime: "image/jpeg" }, imageBytes(head)))).status).toBe(400);
    expect((await list(core)).attachments).toEqual([]);
  });

  it("the stored type is what the bytes say, not what the client said", async () => {
    const core = await boot();
    const jpegClaimedAsPng = await add(core, image({ mime: "image/png" }, imageBytes(JPEG_HEAD)));
    expect(jpegClaimedAsPng.json.mime).toBe("image/jpeg");
    const pngClaimedAsText = await add(core, image({ mime: "text/plain" }, imageBytes(PNG_HEAD)));
    expect(pngClaimedAsText.status).toBe(201);
    expect(pngClaimedAsText.json.mime).toBe("image/png");
  });

  it("refuses base64 that is not base64", async () => {
    const core = await boot();
    for (const content of ["not base64!!", "abc", "AAAA AAAA", "iVBORw0K\n", ""])
      expect((await add(core, image({ content }))).status, content).toBe(400);
  });
});

describe("folder listings", () => {
  const files = (n: number, over: Record<string, unknown> = {}) =>
    Array.from({ length: n }, (_, i) => ({ path: `dir/file${i}.txt`, bytes: 10, ...over }));

  it("accepts 200 entries and refuses 201", async () => {
    const core = await boot();
    const ok = await add(core, folder(files(200)));
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ kind: "folder", files: 200, bytes: 2000, preview: null });
    const over = await add(core, folder(files(201)));
    expect(over.status).toBe(400);
    expect(over.json.message).toMatch(/at most 200 files/);
  });

  it("allows 20,000 characters of text per file and 400,000 in all", async () => {
    const core = await boot();
    expect(
      (await add(core, folder([{ path: "a.txt", bytes: 20_000, text: "x".repeat(20_000) }])))
        .status,
    ).toBe(201);
    await core.api("DELETE", "/api/attachments");
    const long = await add(core, folder([{ path: "a.txt", bytes: 1, text: "x".repeat(20_001) }]));
    expect(long.status).toBe(400);
    // 20 files of 20,000 = 400,000 is fine; 21 is one too many.
    const twenty = files(20, { text: "x".repeat(20_000), bytes: 20_000 });
    expect((await add(core, folder(twenty))).status).toBe(201);
    await core.api("DELETE", "/api/attachments");
    const over = await add(core, folder(files(21, { text: "x".repeat(20_000), bytes: 20_000 })));
    expect(over.status).toBe(400);
    expect(over.json.message).toMatch(/400000 characters/);
  });

  it("refuses an empty listing, a duplicate path, a bad size, extra keys and non-JSON", async () => {
    const core = await boot();
    expect((await add(core, folder([]))).status).toBe(400);
    expect(
      (
        await add(
          core,
          folder([
            { path: "a", bytes: 1 },
            { path: "a", bytes: 2 },
          ]),
        )
      ).status,
    ).toBe(400);
    for (const bytes of [-1, 1.5, "3", null, Number.MAX_SAFE_INTEGER + 1])
      expect((await add(core, folder([{ path: "a", bytes }]))).status).toBe(400);
    expect((await add(core, folder([{ path: "a", bytes: 1, mode: "0777" }]))).status).toBe(400);
    expect((await add(core, folder([{ path: "a", bytes: 1, text: 5 }]))).status).toBe(400);
    expect((await add(core, folder([{ path: "a", bytes: 1, text: "a\u0000" }]))).status).toBe(400);
    expect((await add(core, folder([{ path: "a", bytes: 1 }], { content: "{nope" }))).status).toBe(
      400,
    );
    expect((await add(core, folder([{ path: "a", bytes: 1 }], { content: "[]" }))).status).toBe(
      400,
    );
    expect(
      (await add(core, folder([{ path: "a", bytes: 1 }], { content: '{"files":[],"x":1}' })))
        .status,
    ).toBe(400);
    expect((await list(core)).attachments).toEqual([]);
  });

  it("is never opened: a path that names a real file is only text in the listing", async () => {
    const core = await boot();
    const res = await add(core, folder([{ path: "etc/passwd", bytes: 4 }]));
    expect(res.status).toBe(201);
    const full = (await core.api("GET", `/api/attachments/${res.json.id}`)).json;
    expect(JSON.parse(full.content)).toEqual({ files: [{ path: "etc/passwd", bytes: 4 }] });
  });
});

describe("content is held in memory only", () => {
  it("appears in no event, no audit row, no log line and no database table", async () => {
    const lines: LogRecord[] = [];
    const logger = createLogger({ level: "debug", sink: (r) => lines.push(r) });
    const core = await boot({ logger, vision: "ok" });
    const events: unknown[] = [];
    core.runtime.bus.subscribe("test-scan", "*", (event) => void events.push(event));
    await enableAi(core);

    const t = (await add(core, text({ name: "secret-notes.txt" }))).json.id;
    const i = (await add(core, image({ name: "board.png" }))).json.id;
    const f = (
      await add(core, folder([{ path: "src/a.ts", bytes: 9, text: `const x = "${CANARY}";` }]))
    ).json.id;
    const ask = await core.api("POST", "/api/attachments/ask", {
      question: "what do these say?",
      attachment_ids: [t, i, f],
    });
    expect(ask.status).toBe(200);
    await core.api("DELETE", `/api/attachments/${t}`);
    await core.api("DELETE", "/api/attachments");
    // A failing ask must not put content in an error either.
    const failed = await core.api("POST", "/api/attachments/ask", {
      question: "again?",
      attachment_ids: [t],
    });
    expect(failed.status).toBe(404);
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));

    const audit = (await core.api("GET", "/api/audit", undefined)).json;
    const actions = (audit.entries as { action: string }[]).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(["attachment.add", "attachment.ask", "attachment.remove"]),
    );
    const added = (audit.entries as { action: string; details: Record<string, unknown> }[]).find(
      (e) => e.action === "attachment.add",
    );
    expect(Object.keys(added!.details).sort()).toEqual(["bytes", "id", "kind", "name", "origin"]);

    expect(JSON.stringify(events)).not.toContain(CANARY);
    expect(JSON.stringify(events)).not.toContain("VISIONCANARY");
    expect(JSON.stringify(audit)).not.toContain(CANARY);
    expect(JSON.stringify(audit)).not.toContain("VISIONCANARY");
    expect(JSON.stringify(lines)).not.toContain(CANARY);
    expect(JSON.stringify(lines)).not.toContain("VISIONCANARY");
    expect(JSON.stringify(failed.json)).not.toContain(CANARY);

    // Every row of every table.
    const tables = core.runtime.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    for (const { name } of tables) {
      let rows: unknown[] = [];
      try {
        rows = core.runtime.db.prepare(`SELECT * FROM "${name}"`).all();
      } catch {
        continue; // a virtual table the plain driver cannot scan
      }
      const dump = JSON.stringify(rows, (_k, v: unknown) =>
        typeof v === "bigint" ? String(v) : v,
      );
      expect(dump, `table ${name}`).not.toContain(CANARY);
      expect(dump, `table ${name}`).not.toContain("VISIONCANARY");
    }
  });

  it("the attachment event carries a count only", async () => {
    const core = await boot();
    const seen: Record<string, unknown>[] = [];
    core.runtime.bus.subscribe("test-attach", "attachments.*", (e) => void seen.push(e.payload));
    await add(core, text());
    await vi.waitFor(() => expect(seen).toEqual([{ count: 1 }]));
  });
});

describe("asking is local only", () => {
  const ids = async (core: Core) => [(await add(core, text())).json.id as string];
  const ask = (core: Core, attachment_ids: string[], question = "when is the release?") =>
    core.api("POST", "/api/attachments/ask", { question, attachment_ids });

  /** Cloud allowed for every class, a key, the grant and the sensitive opt-in: the most permissive user there is. */
  async function everythingOptedIn(core: Core, extra: Record<string, unknown> = {}) {
    await core.secrets.set("phoenix.ai.anthropic_api_key", FAKE_KEY);
    await enableAi(core, {
      cloud_opt_in: { public: true, internal: true, sensitive: true },
      ...extra,
    });
    await core.api("POST", "/api/ai/external-processing", { granted: true });
  }

  it("the purpose is a fixed string and the cloud gate does not accept it for sensitive data", () => {
    expect(PURPOSE_ANSWER_ABOUT_ATTACHMENTS).toBe("answer a question about attached files");
    expect(SENSITIVE_CLOUD_PURPOSES).not.toContain(PURPOSE_ANSWER_ABOUT_ATTACHMENTS);
  });

  it("with Ollama up the question is answered on this device and nothing reaches the cloud", async () => {
    const core = await boot();
    await everythingOptedIn(core);
    const res = await ask(core, await ids(core));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      answer: ANSWER,
      provider: "ollama",
      locality: "local",
      vision_model: null,
    });
    expect(res.json.processed_by).toMatch(/on this device$/);
    expect(res.json.sources).toEqual([{ id: expect.stringMatching(/^att_/), name: "note.txt" }]);
    expect(core.net.cloud()).toEqual([]);
    expect(core.net.chats()).toHaveLength(1);
    expect(core.net.chats()[0]!.body).toContain(CANARY);
  });

  it("with every opt-in on and Ollama down, no cloud request is made and the refusal says why", async () => {
    const core = await boot({ ollama: "down" });
    await everythingOptedIn(core);
    const res = await ask(core, await ids(core));
    expect(res.status).toBe(503);
    expect(res.json.message).toMatch(/never sent to a cloud provider/);
    expect(core.net.cloud()).toEqual([]);
    expect(core.net.all.some((r) => r.body.includes(CANARY))).toBe(false);
    expect(JSON.stringify(res.json)).not.toContain(CANARY);
    // And the send was never audited as a cloud send.
    const audit = (await core.api("GET", "/api/audit")).json.entries as { action: string }[];
    expect(audit.some((e) => e.action === "ai.cloud_send")).toBe(false);
  });

  it("a user who routed this kind of work to the cloud provider is still refused by the gate", async () => {
    const core = await boot();
    await everythingOptedIn(core, { routing: { summaries: { provider: "anthropic" } } });
    const res = await ask(core, await ids(core));
    expect(res.status).toBe(503);
    expect(res.json.message).toMatch(/not covered by the sensitive-data opt-in/);
    expect(core.net.cloud()).toEqual([]);
    // The routed provider is the only one tried, so the local model did not take over either.
    expect(core.net.chats()).toEqual([]);
    expect(core.net.all.some((r) => r.body.includes(CANARY))).toBe(false);
  });

  it("preferring the cloud provider does not change that", async () => {
    const core = await boot();
    await everythingOptedIn(core, { preferred: "anthropic" });
    const res = await ask(core, await ids(core));
    expect(core.net.cloud()).toEqual([]);
    expect(res.json.provider).toBe("ollama");
  });

  it("AI off: refused with no network at all", async () => {
    const core = await boot();
    const res = await ask(core, await ids(core));
    expect(res.status).toBe(409);
    expect(res.json.message).toMatch(/AI is turned off/);
    expect(core.net.all).toEqual([]);
  });

  it("validates the question and the id list", async () => {
    const core = await boot();
    await enableAi(core);
    const [id] = await ids(core);
    const six = await Promise.all(
      Array.from({ length: 6 }, async (_, n) => (await add(core, text({ name: `n${n}` }))).json.id),
    );
    const post = (body: unknown) => core.api("POST", "/api/attachments/ask", body);
    expect((await post({ question: "", attachment_ids: [id] })).status).toBe(400);
    expect((await post({ question: "q".repeat(2001), attachment_ids: [id] })).status).toBe(400);
    expect((await post({ question: "q", attachment_ids: [] })).status).toBe(400);
    expect((await post({ question: "q", attachment_ids: six })).status).toBe(400);
    expect((await post({ question: "q", attachment_ids: [id, id] })).status).toBe(400);
    expect((await post({ question: "q", attachment_ids: [5] })).status).toBe(400);
    expect((await post({ question: "q", attachment_ids: "all" })).status).toBe(400);
    expect((await post({ question: "q", attachment_ids: [id], extra: 1 })).status).toBe(400);
    expect((await post({ question: "q", attachment_ids: ["att_" + "0".repeat(32)] })).status).toBe(
      404,
    );
    expect(core.net.chats()).toEqual([]);
    expect(
      (await post({ question: "q".repeat(2000), attachment_ids: six.slice(0, 5) })).status,
    ).toBe(200);
  });

  it("refuses rather than truncates when the chosen attachments are too large for one question", async () => {
    const core = await boot();
    await enableAi(core);
    const big = [];
    for (let n = 0; n < 4; n++)
      big.push((await add(core, text({ name: `big${n}`, content: "y".repeat(20_000) }))).json.id);
    const res = await ask(core, big);
    expect(res.status).toBe(400);
    expect(res.json.message).toMatch(/at most 60000/);
    expect(core.net.chats()).toEqual([]);
  });

  it("does not answer during the emergency stop", async () => {
    const core = await boot();
    await enableAi(core);
    const attached = await ids(core);
    await core.api("POST", "/api/security/kill-switch", { engaged: true });
    expect((await ask(core, attached)).status).toBe(409);
    expect(core.net.chats()).toEqual([]);
  });

  it("an empty or absurd reply is dropped, not shown", async () => {
    const empty = await boot({ reply: "   " });
    await enableAi(empty);
    expect((await ask(empty, await ids(empty))).status).toBe(503);
    const huge = await boot({ reply: "z".repeat(9000) });
    await enableAi(huge);
    expect((await ask(huge, await ids(huge))).status).toBe(503);
  });
});

describe("images need a local vision model", () => {
  const imageId = async (core: Core) => (await add(core, image())).json.id as string;
  const ask = (core: Core, attachment_ids: string[]) =>
    core.api("POST", "/api/attachments/ask", { question: "what is on it?", attachment_ids });

  it("no vision model configured: a clear 409, the image is not dropped silently, nothing is sent", async () => {
    const core = await boot({ vision: "none" });
    await enableAi(core);
    const text1 = (await add(core, text())).json.id;
    const res = await ask(core, [text1, await imageId(core)]);
    expect(res.status).toBe(409);
    expect(res.json.message).toMatch(/No local vision model is available/);
    expect(core.net.all.filter((r) => r.url.endsWith("/api/chat"))).toEqual([]);
  });

  it("a configured model that cannot see (or is not installed) is the same clear error", async () => {
    const core = await boot({ vision: "text-only" });
    await enableAi(core);
    const res = await ask(core, [await imageId(core)]);
    expect(res.status).toBe(409);
    expect(res.json.message).toMatch(/No local vision model is available/);
    expect(core.net.visionChats()).toEqual([]);
    expect(core.net.chats()).toEqual([]);
  });

  it("with a local vision model the image is described locally, then the description is asked about", async () => {
    const core = await boot({ vision: "ok" });
    await enableAi(core);
    const res = await ask(core, [await imageId(core)]);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ answer: ANSWER, vision_model: "llava", locality: "local" });
    expect(core.net.visionChats()).toHaveLength(1);
    const visionBody = JSON.parse(core.net.visionChats()[0]!.body) as {
      messages: { images: string[] }[];
    };
    expect(Buffer.from(visionBody.messages[0]!.images[0]!, "base64").subarray(0, 8)).toEqual(
      Buffer.from(PNG_HEAD),
    );
    const prompt = core.net.chats()[0]!.body;
    expect(prompt).toContain("VISIONCANARY");
    expect(prompt).toContain("described by a local vision model");
    // Only this device was contacted.
    const hosts = [...new Set(core.net.all.map((r) => new URL(r.url).origin))];
    expect(hosts).toEqual(["http://127.0.0.1:11434"]);
  });

  it("the stored image survives the vision call (its bytes are not zeroed under the store)", async () => {
    const core = await boot({ vision: "ok" });
    await enableAi(core);
    const id = await imageId(core);
    await ask(core, [id]);
    await ask(core, [id]);
    const full = (await core.api("GET", `/api/attachments/${id}`)).json;
    expect(Buffer.from(full.content, "base64").subarray(0, 8)).toEqual(Buffer.from(PNG_HEAD));
    expect(core.net.visionChats()).toHaveLength(2);
  });
});

describe("live updates", () => {
  it("a connected page is told (count only) when the set changes, including the emergency stop", async () => {
    const core = await boot();
    const page = connect(core.port, TOKEN);
    cleanups.push(() => void page.ws.close());
    await page.opened;
    page.send({ type: "subscribe", channels: ["event.created"] });
    const changed = (count: number) =>
      page.next(
        (m) =>
          m.channel === "event.created" &&
          m.data.event.event_type === "attachments.changed" &&
          m.data.event.payload.count === count,
      );
    await add(core, text());
    const first = await changed(1);
    expect(JSON.stringify(first)).not.toContain(CANARY);
    await core.api("POST", "/api/security/kill-switch", { engaged: true });
    await changed(0);
  });
});
