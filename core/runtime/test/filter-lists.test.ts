// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The filter-list updater (Phase 93) through a running Core. Every download here goes to a fake
// list server on 127.0.0.1 that this file starts; nothing in this file contacts easylist.to. The
// list text served is synthetic.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FILTER_LIST_CATALOGUE, FILTER_LIST_ORIGIN } from "../src/filter-lists/catalogue";
import { FilterListsService, MAX_LIST_BYTES } from "../src/filter-lists/service";
import { startCore, type TestCore } from "./helpers";

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
}
type Responder = (req: IncomingMessage, res: ServerResponse) => void;

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A fake list host. `serve` decides each answer; `seen` records every request that reached it. */
async function fakeHost(): Promise<{
  origin: string;
  seen: Seen[];
  serve: (path: string, responder: Responder) => void;
}> {
  const routes = new Map<string, Responder>();
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers });
    const responder = routes.get(req.url ?? "");
    if (!responder) {
      res.writeHead(404).end("no such list");
      return;
    }
    responder(req, res);
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  cleanups.push(() => {
    const closed = Promise.withResolvers<void>();
    server.closeAllConnections();
    server.close(() => closed.resolve());
    return closed.promise;
  });
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    seen,
    serve: (path, responder) => routes.set(path, responder),
  };
}

const text =
  (body: string | Buffer, type = "text/plain; charset=utf-8"): Responder =>
  (_req, res) => {
    res.writeHead(200, { "content-type": type, "content-length": Buffer.byteLength(body) });
    res.end(body);
  };

/** A synthetic list: a real-looking header and `n` rules. */
function listText(n: number, extra: Record<string, string> = {}): string {
  const header = {
    Version: "202601010000",
    Title: "Fake list",
    "Last modified": "1 Jan 2026 00:00 UTC",
    Expires: "4 days (update frequency)",
    ...extra,
  };
  const lines = ["[Adblock Plus 2.0]", ...Object.entries(header).map(([k, v]) => `! ${k}: ${v}`)];
  for (let i = 0; i < n; i++) lines.push(`||ads${i}.example^$third-party`);
  lines.push("example.org##.banner", "@@||ads1.example/ok.js^");
  return lines.join("\n") + "\n";
}

async function boot(host?: { origin: string }, runtime: Record<string, unknown> = {}) {
  const core = await startCore(
    {},
    {
      runtime: {
        filterLists: { ...(host ? { baseUrl: host.origin } : {}), ...runtime },
      },
    },
  );
  cleanups.push(() => core.runtime.stop());
  return core;
}

const EASYLIST = "/easylist/easylist.txt";
const listFile = (core: TestCore, id = "easylist") =>
  join(core.dataDir, "filter-lists", `${id}.filterlist`);
const update = (core: TestCore, id = "easylist") =>
  core.api("POST", `/api/browser/filter-lists/${id}/update`);
const lists = async (core: TestCore) =>
  (await core.api("GET", "/api/browser/filter-lists")).json.lists as {
    id: string;
    status: string;
    enabled: boolean;
    rules: { network: number; exceptions: number; cosmetic: number } | null;
    [key: string]: unknown;
  }[];
const auditRows = (core: TestCore, action: string) =>
  core.runtime.permissions.audit
    .list({ limit: 1000 })
    .filter((e) => e.action === action)
    .reverse();

describe("filter list catalogue", () => {
  it("is fixed in code: two https easylist.to lists, each with its licence recorded", () => {
    expect(FILTER_LIST_ORIGIN).toBe("https://easylist.to");
    expect(FILTER_LIST_CATALOGUE.map((s) => [s.id, FILTER_LIST_ORIGIN + s.path])).toEqual([
      ["easylist", "https://easylist.to/easylist/easylist.txt"],
      ["easyprivacy", "https://easylist.to/easylist/easyprivacy.txt"],
    ]);
    for (const spec of FILTER_LIST_CATALOGUE) {
      expect(spec.licence).toBe("GPL-3.0-or-later OR CC-BY-SA-3.0-or-later");
      expect(spec.licenceUrl).toBe("https://easylist.to/pages/licence.html");
      expect(spec.attribution).toContain("EasyList authors");
      expect(spec.path).not.toMatch(/[?#]/);
    }
  });

  it("contacts the pinned easylist.to address in production, checked with a recording fetcher that never leaves the process", async () => {
    const requested: { url: string; init: RequestInit | undefined }[] = [];
    const settingsStore = new Map<string, unknown>();
    const service = new FilterListsService({
      settings: {
        get: (key: string, fallback: unknown) => settingsStore.get(key) ?? fallback,
        set: (key: string, value: unknown) => void settingsStore.set(key, value),
      } as never,
      audit: { record: () => ({}) as never },
      dataDir: mkdtempSync(join(tmpdir(), "phoenix-filter-lists-")),
      killSwitchEngaged: () => false,
      fetcher: (async (url: string, init?: RequestInit) => {
        requested.push({ url, init });
        return new Response(listText(3), {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }) as unknown as typeof fetch,
    });
    await service.update("easylist");
    await service.update("easyprivacy");
    expect(requested.map((r) => r.url)).toEqual([
      "https://easylist.to/easylist/easylist.txt",
      "https://easylist.to/easylist/easyprivacy.txt",
    ]);
    for (const { init } of requested) {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      expect(init?.credentials).toBe("omit");
      expect(init?.body).toBeUndefined();
    }
  });

  it("refuses a code-only origin that is plain http to a non-loopback host", () => {
    const make = (baseUrl: string) =>
      new FilterListsService({
        settings: {} as never,
        audit: { record: () => ({}) as never },
        dataDir: "/nonexistent",
        killSwitchEngaged: () => false,
        baseUrl,
      });
    expect(() => make("http://evil.example")).toThrow(/https/);
    expect(() => make("https://user:pw@easylist.to")).toThrow();
    expect(() => make("https://easylist.to/?x=1")).toThrow();
    expect(() => make("http://127.0.0.1:1234")).not.toThrow();
  });
});

describe("filter list updater through Core", () => {
  it("downloads nothing on its own and needs the session token on every route", async () => {
    const host = await fakeHost();
    host.serve(EASYLIST, text(listText(5)));
    const core = await boot(host);
    expect((await lists(core)).map((l) => [l.id, l.status, l.enabled])).toEqual([
      ["easylist", "never", false],
      ["easyprivacy", "never", false],
    ]);
    // Reading, switching shields and the like never contact the server.
    await core.api("PUT", "/api/browser/shields", { enabled: false });
    await core.api("GET", "/api/browser/shields");
    expect(host.seen).toEqual([]);

    const anonymous = (method: string, path: string) =>
      fetch(core.base + path, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "GET" ? {} : { body: "{}" }),
      }).then((r) => r.status);
    for (const [method, path] of [
      ["GET", "/api/browser/filter-lists"],
      ["POST", "/api/browser/filter-lists/easylist/update"],
      ["PUT", "/api/browser/filter-lists/easylist"],
      ["DELETE", "/api/browser/filter-lists/easylist"],
      ["GET", "/api/browser/filter-lists/easylist/text"],
      ["GET", "/api/browser/shields"],
      ["PUT", "/api/browser/shields"],
      ["PUT", "/api/browser/shields/sites/example.com"],
    ] as const) {
      expect(await anonymous(method, path), `${method} ${path}`).toBe(401);
    }
    expect(host.seen).toEqual([]);
  });

  it("stores a good list: one GET to the pinned path, sha256, size, date, rule counts, 0600, no temp files", async () => {
    const host = await fakeHost();
    const body = listText(40);
    host.serve(EASYLIST, text(body));
    const core = await boot(host);

    const res = await update(core);
    expect(res.status).toBe(200);
    expect(host.seen).toHaveLength(1);
    expect(host.seen[0]).toMatchObject({ method: "GET", url: EASYLIST });
    expect(host.seen[0]?.headers.cookie).toBeUndefined();
    expect(host.seen[0]?.headers.authorization).toBeUndefined();

    const view = res.json.list;
    expect(view).toMatchObject({
      id: "easylist",
      status: "ready",
      enabled: false,
      version: "202601010000",
      listTitle: "Fake list",
      lastModified: "1 Jan 2026 00:00 UTC",
      refreshAfterDays: 4,
      bytes: Buffer.byteLength(body),
      licence: "GPL-3.0-or-later OR CC-BY-SA-3.0-or-later",
      rules: { network: 41, exceptions: 1, cosmetic: 1 },
    });
    expect(view.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(view.fetchedAt)).not.toBeNaN();
    expect(Date.parse(view.dueAt) - Date.parse(view.fetchedAt)).toBe(4 * 86_400_000);

    const file = listFile(core);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(core.dataDir, "filter-lists")).mode & 0o777).toBe(0o700);
    expect(readdirSync(join(core.dataDir, "filter-lists"))).toEqual(["easylist.filterlist"]);

    const served = (await core.api("GET", "/api/browser/filter-lists/easylist/text")).json;
    expect(served.text).toBe(body);
    expect(served.sha256).toBe(view.sha256);
    // Only the other list stays "never".
    expect((await lists(core)).map((l) => l.status)).toEqual(["ready", "never"]);
  });

  it("turns a list on only after it was downloaded, and removing it deletes the file and turns it off", async () => {
    const host = await fakeHost();
    host.serve(EASYLIST, text(listText(3)));
    const core = await boot(host);
    const put = (enabled: unknown) =>
      core.api("PUT", "/api/browser/filter-lists/easylist", { enabled });
    expect((await put(true)).status).toBe(400);
    expect((await put("yes")).status).toBe(400);
    await update(core);
    expect((await put(true)).json.lists[0]).toMatchObject({ id: "easylist", enabled: true });
    expect((await put(false)).json.lists[0].enabled).toBe(false);
    await put(true);
    const removed = await core.api("DELETE", "/api/browser/filter-lists/easylist");
    expect(removed.json.lists[0]).toMatchObject({ status: "never", enabled: false });
    expect(existsSync(listFile(core))).toBe(false);
    expect((await core.api("GET", "/api/browser/filter-lists/easylist/text")).status).toBe(404);
    expect(
      (await core.api("PUT", "/api/browser/filter-lists/nope", { enabled: true })).status,
    ).toBe(404);
    expect(auditRows(core, "browser.filter_list.changed").map((e) => e.details)).toEqual([
      { list: "easylist", enabled: true },
      { list: "easylist", enabled: false },
      { list: "easylist", enabled: true },
    ]);
  });

  it("rejects HTML, whether labelled text/html or passed off as text/plain", async () => {
    const host = await fakeHost();
    const core = await boot(host);
    const html = "<!doctype html><html><body>Please log in</body></html>";
    host.serve(EASYLIST, text(html, "text/html; charset=utf-8"));
    const labelled = await update(core);
    expect(labelled.status).toBe(403);
    expect(labelled.json.message).toMatch(/not plain text/);
    host.serve(EASYLIST, text(html));
    const disguised = await update(core);
    expect(disguised.status).toBe(403);
    expect(disguised.json.message).toMatch(/not a filter list/);
    expect(existsSync(listFile(core))).toBe(false);
    expect(auditRows(core, "browser.filter_list.update").map((e) => e.details.reason)).toEqual([
      "not_text",
      "not_a_filter_list",
    ]);
  });

  it("refuses a redirect and never requests the address it points to", async () => {
    const host = await fakeHost();
    host.serve(EASYLIST, (_req, res) => {
      res.writeHead(302, { location: "/elsewhere/list.txt" }).end();
    });
    host.serve("/elsewhere/list.txt", text(listText(3)));
    const core = await boot(host);
    const res = await update(core);
    expect(res.status).toBe(403);
    expect(res.json.message).toMatch(/somewhere else/);
    expect(host.seen.map((s) => s.url)).toEqual([EASYLIST]);
    expect(existsSync(listFile(core))).toBe(false);
  });

  it("refuses an oversize list, declared in the headers or streamed without a length", async () => {
    const host = await fakeHost();
    const big = "! " + "x".repeat(MAX_LIST_BYTES);
    host.serve(EASYLIST, text("[Adblock Plus 2.0]\n" + big));
    host.serve("/easylist/easyprivacy.txt", (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("[Adblock Plus 2.0]\n");
      const chunk = "! " + "y".repeat(1000) + "\n";
      let sent = 0;
      const pump = () => {
        while (sent < MAX_LIST_BYTES + 100_000) {
          sent += chunk.length;
          if (!res.write(chunk)) {
            res.once("drain", pump);
            return;
          }
        }
        res.end();
      };
      pump();
    });
    const core = await boot(host);
    for (const id of ["easylist", "easyprivacy"]) {
      const res = await update(core, id);
      expect(res.status, id).toBe(403);
      expect(res.json.message).toMatch(/larger than Phoenix accepts/);
    }
    expect(existsSync(listFile(core))).toBe(false);
    expect(existsSync(listFile(core, "easyprivacy"))).toBe(false);
  }, 60_000);

  it("refuses at the headers when the declared length is over the cap, without waiting for a body", async () => {
    const host = await fakeHost();
    host.serve(EASYLIST, (_req, res) => {
      res.writeHead(200, {
        "content-type": "text/plain",
        "content-length": String(MAX_LIST_BYTES + 1),
      });
      res.write("[Adblock Plus 2.0]\n");
    });
    // A short body timeout: without the declared-length check this ends as "too slow", not "larger".
    const core = await boot(host, { bodyTimeoutMs: 400 });
    const res = await update(core);
    expect(res.status).toBe(403);
    expect(res.json.message).toMatch(/larger than Phoenix accepts/);
  });

  it("reports a store failure as such, removes its temp file and keeps the previous copy", async () => {
    const host = await fakeHost();
    host.serve(EASYLIST, text(listText(10)));
    const core = await boot(host);
    await update(core);
    const before = readFileSync(listFile(core));
    // Make the final rename impossible: a directory where the file goes.
    rmSync(listFile(core));
    mkdirSync(listFile(core));
    const res = await update(core);
    expect(res.status).toBe(500);
    expect(res.json.message).toMatch(/could not be saved/);
    expect(readdirSync(join(core.dataDir, "filter-lists"))).toEqual(["easylist.filterlist"]);
    const rows = auditRows(core, "browser.filter_list.update");
    expect(rows.at(-1)?.details).toEqual({
      list: "easylist",
      outcome: "failed",
      reason: "store_failed",
    });
    expect(before.length).toBeGreaterThan(0);
  });

  it("refuses too many lines, a very long line and text that is not UTF-8", async () => {
    const host = await fakeHost();
    const core = await boot(host);
    host.serve(EASYLIST, text("[Adblock Plus 2.0]\n" + "!\n".repeat(500_001)));
    expect((await update(core)).json.message).toMatch(/more lines/);
    host.serve(EASYLIST, text("[Adblock Plus 2.0]\n||" + "a".repeat(20_000) + "^\n"));
    expect((await update(core)).json.message).toMatch(/line longer/);
    host.serve(
      EASYLIST,
      text(
        Buffer.concat([
          Buffer.from("[Adblock Plus 2.0]\n||"),
          Buffer.from([0xff, 0xfe]),
          Buffer.from("^\n"),
        ]),
      ),
    );
    expect((await update(core)).json.message).toMatch(/not valid UTF-8/);
    expect(existsSync(listFile(core))).toBe(false);
  });

  it("refuses a bad status, a server that never answers, and an engaged emergency stop (no request then)", async () => {
    const host = await fakeHost();
    const core = await boot(host, { headersTimeoutMs: 150 });
    host.serve(EASYLIST, (_req, res) => void res.writeHead(500).end("boom"));
    expect((await update(core)).json.message).toMatch(/did not answer with the list/);
    host.serve(EASYLIST, () => undefined);
    const slow = await update(core);
    expect(slow.status).toBe(503);
    expect(slow.json.message).toMatch(/too slow/);
    const before = host.seen.length;
    await core.api("POST", "/api/security/kill-switch", { engaged: true });
    const stopped = await update(core);
    expect(stopped.status).toBe(403);
    expect(stopped.json.message).toMatch(/Emergency stop/);
    expect(host.seen).toHaveLength(before);
  });

  it("strips NUL and control characters and keeps only the header fields as metadata", async () => {
    const host = await fakeHost();
    host.serve(
      EASYLIST,
      text(
        "\uFEFF[Adblock Plus 2.0]\r\n! Title: Fake\u0000 <b>list</b>\r\n! Version: 7\r\n||ad\u0001s.example^\r\n! Expires: 400 days\r\n",
      ),
    );
    const core = await boot(host);
    const view = (await update(core)).json.list;
    expect(view).toMatchObject({ listTitle: "Fake blistb", version: "7", refreshAfterDays: 30 });
    const served = (await core.api("GET", "/api/browser/filter-lists/easylist/text")).json.text;
    // eslint-disable-next-line no-control-regex
    expect(served).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f\r\uFEFF]/);
    expect(served).toContain("||ads.example^");
  });

  it("bounds the list's own Expires to between 1 and 30 days and never schedules a download", async () => {
    const host = await fakeHost();
    const core = await boot(host);
    const days = async (expires: string) => {
      host.serve(EASYLIST, text(listText(2, { Expires: expires })));
      return (await update(core)).json.list.refreshAfterDays;
    };
    expect(await days("12 hours (update frequency)")).toBe(1);
    expect(await days("0 days")).toBe(1);
    expect(await days("4 days (update frequency)")).toBe(4);
    expect(await days("9999 days")).toBe(30);
    expect(await days("whenever you like")).toBe(4);
    // Five updates were asked for and exactly five requests were made: nothing ran on its own.
    expect(host.seen).toHaveLength(5);
  });

  it("keeps the previous copy, byte for byte, when an update fails or is under half the size", async () => {
    const host = await fakeHost();
    const original = listText(400);
    host.serve(EASYLIST, text(original));
    const core = await boot(host);
    await update(core);
    const stored = readFileSync(listFile(core));
    const hash = (await lists(core))[0]?.sha256;

    // Failure: server error.
    host.serve(EASYLIST, (_req, res) => void res.writeHead(503).end());
    expect((await update(core)).status).toBe(503);
    // Failure: HTML.
    host.serve(EASYLIST, text("<html></html>"));
    expect((await update(core)).status).toBe(403);
    // Truncation: a valid list, but well under half the size.
    host.serve(EASYLIST, text(listText(20)));
    const small = await update(core);
    expect(small.status).toBe(403);
    expect(small.json.message).toMatch(/less than half the size/);
    expect(small.json.message).toMatch(/copy you already have was kept/);

    expect(readFileSync(listFile(core)).equals(stored)).toBe(true);
    expect((await lists(core))[0]?.sha256).toBe(hash);
    expect((await core.api("GET", "/api/browser/filter-lists/easylist/text")).json.text).toBe(
      original,
    );
    expect(readdirSync(join(core.dataDir, "filter-lists"))).toEqual(["easylist.filterlist"]);

    // A list just above half is accepted: the guard is a ratio, not a lock.
    host.serve(EASYLIST, text(listText(250)));
    expect((await update(core)).status).toBe(200);
    expect((await lists(core))[0]?.rules?.network).toBe(251);
  });

  it("audits every attempt with sizes and a reason, and never with any response text", async () => {
    const host = await fakeHost();
    const core = await boot(host);
    host.serve(EASYLIST, text(listText(10, { Title: "SENTINEL-TITLE-TEXT" })));
    await update(core);
    host.serve(EASYLIST, text("<html>SENTINEL-HTML-BODY</html>"));
    await update(core);
    host.serve(EASYLIST, text("[Adblock Plus 2.0]\n! Version: 1\n||SENTINEL-RULE-TEXT.example^\n"));
    await update(core);

    const rows = auditRows(core, "browser.filter_list.update");
    expect(rows.map((r) => [r.decision, r.details.outcome, r.details.reason])).toEqual([
      ["allowed", "stored", undefined],
      ["blocked", "refused", "not_a_filter_list"],
      ["blocked", "refused", "truncated"],
    ]);
    expect(rows[0]?.details).toMatchObject({
      list: "easylist",
      bytes: expect.any(Number),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      networkRules: 11,
    });
    expect(JSON.stringify(rows)).not.toMatch(/SENTINEL/);
    expect(rows.every((r) => r.actor === "user")).toBe(true);
  });

  it("does not serve a damaged copy: a hand-edited file reads as damaged, is off, and can be replaced", async () => {
    const host = await fakeHost();
    host.serve(EASYLIST, text(listText(30)));
    const core = await boot(host);
    await update(core);
    await core.api("PUT", "/api/browser/filter-lists/easylist", { enabled: true });
    const file = listFile(core);
    writeFileSync(file, readFileSync(file, "utf8").replace("ads3.", "bds3."));
    const [view] = await lists(core);
    expect(view).toMatchObject({ status: "damaged", enabled: false, rules: null });
    expect((await core.api("GET", "/api/browser/filter-lists/easylist/text")).status).toBe(404);
    expect((await update(core)).status).toBe(200);
    expect((await lists(core))[0]?.status).toBe("ready");
  });

  it("rejects a second update of the same list while one is running", async () => {
    const host = await fakeHost();
    const arrived = Promise.withResolvers<() => void>();
    host.serve(EASYLIST, (req, res) => arrived.resolve(() => text(listText(3))(req, res)));
    const core = await boot(host);
    const first = update(core);
    const release = await arrived.promise;
    expect((await update(core)).status).toBe(400);
    release();
    expect((await first).status).toBe(200);
    expect(host.seen).toHaveLength(1);
  });

  it("takes the list id from the catalogue only: an unknown id is 404 and no request is made", async () => {
    const host = await fakeHost();
    host.serve("/anything", text(listText(1)));
    const core = await boot(host);
    for (const id of ["nope", "..%2Feasylist", "easylist%3Fx", "https%3A%2F%2Fevil.example%2Fl"]) {
      expect((await update(core, id)).status, id).toBe(404);
    }
    expect(host.seen).toEqual([]);
    // A body cannot choose the address either: the route ignores it and uses the catalogue.
    host.serve(EASYLIST, text(listText(2)));
    const res = await core.api("POST", "/api/browser/filter-lists/easylist/update", {
      url: "https://evil.example/list.txt",
      baseUrl: "https://evil.example",
    });
    expect(res.status).toBe(200);
    expect(host.seen.map((s) => s.url)).toEqual([EASYLIST]);
  });
});

describe("shields settings through Core", () => {
  it("is on by default, switches off and on, and keeps a sorted off-list of host names", async () => {
    const core = await boot();
    expect((await core.api("GET", "/api/browser/shields")).json.shields).toEqual({
      enabled: true,
      offSites: [],
    });
    expect(
      (await core.api("PUT", "/api/browser/shields", { enabled: false })).json.shields,
    ).toEqual({ enabled: false, offSites: [] });
    const off = (site: string, blocking: unknown) =>
      core.api("PUT", `/api/browser/shields/sites/${encodeURIComponent(site)}`, { blocking });
    await off("News.Example.com", false);
    await off("a.example.org", false);
    expect((await off("a.example.org", false)).json.shields.offSites).toEqual([
      "a.example.org",
      "news.example.com",
    ]);
    expect((await off("a.example.org", true)).json.shields).toEqual({
      enabled: false,
      offSites: ["news.example.com"],
    });
    // Persisted in the settings store, so a restart sees it.
    expect(core.runtime.settings.get("browser.shields", null)).toEqual({
      enabled: false,
      offSites: ["news.example.com"],
    });
  });

  it("accepts host names only: no URL, path, query, port, credentials or spaces", async () => {
    const core = await boot();
    for (const bad of [
      "https://example.com/",
      "example.com/path",
      "example.com?q=1",
      "example.com:8080",
      "user@example.com",
      "exa mple.com",
      "",
      "-bad.example",
      "a".repeat(300) + ".com",
    ]) {
      const res = await core.api("PUT", `/api/browser/shields/sites/${encodeURIComponent(bad)}`, {
        blocking: false,
      });
      expect(res.status, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
    }
    expect((await core.api("GET", "/api/browser/shields")).json.shields.offSites).toEqual([]);
    expect(
      (await core.api("PUT", "/api/browser/shields/sites/example.com", { blocking: "no" })).status,
    ).toBe(400);
    expect((await core.api("PUT", "/api/browser/shields", { enabled: 1 })).status).toBe(400);
  });

  it("caps the off-list and audits each change without any page address", async () => {
    const core = await boot();
    for (let i = 0; i < 500; i++)
      core.runtime.filterLists.setSiteBlocking(`s${i}.example`, { blocking: false });
    const over = await core.api("PUT", "/api/browser/shields/sites/extra.example", {
      blocking: false,
    });
    expect(over.status).toBe(400);
    expect(core.runtime.filterLists.shields().offSites).toHaveLength(500);
    const rows = auditRows(core, "browser.shields.changed");
    expect(rows).toHaveLength(500);
    expect(rows[0]?.details).toEqual({ site: "s0.example", blocking: false });
  });

  it("lists stored data in the privacy inventory", async () => {
    const host = await fakeHost();
    host.serve(EASYLIST, text(listText(3)));
    const core = await boot(host);
    const row = async () =>
      (await core.api("GET", "/api/privacy")).json.derived.find(
        (d: { id: string }) => d.id === "browser_filter_lists",
      );
    expect(await row()).toMatchObject({ count: 0 });
    await update(core);
    await core.api("PUT", "/api/browser/shields/sites/example.com", { blocking: false });
    expect(await row()).toMatchObject({ count: 2 });
  });
});
