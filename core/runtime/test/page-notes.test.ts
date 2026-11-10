// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// POST /api/companion/page through a running Core (Phase 89): validation, storage as inert data,
// audit, deletion, and the privacy inventory. Nothing reads a note into a model.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE_GITHUB_TOKEN } from "../../../protocol/testing/fake-secrets";
import { MAX_PAGE_NOTES, PageNotesService } from "../src/page-notes/service";
import { startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function boot(): Promise<TestCore> {
  const core = await startCore();
  cleanups.push(() => core.runtime.stop());
  return core;
}
const post = (core: TestCore, body: unknown) => core.api("POST", "/api/companion/page", body);
const good = { url: "https://example.com/a?b=1", title: "A page" };
const auditRows = (core: TestCore, action: string) =>
  core.runtime.db.prepare("SELECT actor, details FROM audit_log WHERE action = ?").all(action) as {
    actor: string;
    details: string;
  }[];

describe("POST /api/companion/page", () => {
  it("needs the session token", async () => {
    const core = await boot();
    const res = await fetch(`${core.base}/api/companion/page`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(good),
    });
    expect(res.status).toBe(401);
    expect((await fetch(`${core.base}/api/companion/pages`)).status).toBe(401);
  });

  it("stores a typed, bounded note and lists it, with an audit row naming only the host", async () => {
    const core = await boot();
    const res = await post(core, { ...good, selection: "some chosen words" });
    expect(res.status).toBe(200);
    expect(res.json.page).toMatchObject({
      url: "https://example.com/a",
      title: good.title,
      selected_text: "some chosen words",
    });
    expect(res.json.page.id).toMatch(/^pn_[0-9a-f]{24}$/);
    const list = (await core.api("GET", "/api/companion/pages")).json.pages;
    expect(list).toHaveLength(1);
    const [row] = auditRows(core, "companion.page.received");
    expect(row!.actor).toBe("companion");
    const details = JSON.parse(row!.details);
    expect(details).toMatchObject({ host: "example.com", selection_chars: 17 });
    expect(JSON.stringify(details)).not.toContain("b=1");
    expect(JSON.stringify(details)).not.toContain("chosen");
  });

  it("refuses unsafe addresses and unknown or mistyped fields, storing nothing", async () => {
    const core = await boot();
    for (const bad of [
      { ...good, url: "javascript:alert(1)" },
      { ...good, url: "file:///etc/passwd" },
      { ...good, url: "chrome://settings" },
      { ...good, url: "https://u:p@example.com/" },
      { ...good, url: "https://example.com/\u202e" },
      { ...good, url: `https://example.com/${"a".repeat(2100)}` },
      { title: "no url" },
      { ...good, title: 5 },
      { ...good, title: "x".repeat(201) },
      { ...good, selection: 5 },
      { ...good, selection: "x".repeat(2001) },
      { ...good, run: "rm -rf /" },
      { ...good, kind: "page" },
      [good],
      "text",
    ]) {
      const res = await post(core, bad);
      expect(res.status, JSON.stringify(bad).slice(0, 80)).toBe(400);
    }
    expect((await core.api("GET", "/api/companion/pages")).json.pages).toEqual([]);
  });

  it("refuses an oversized body (256 KiB) and an oversized field", async () => {
    const core = await boot();
    expect((await post(core, { ...good, title: "x".repeat(300 * 1024) })).status).toBe(413);
    expect((await post(core, { ...good, title: "x".repeat(40 * 1024) })).status).toBe(400);
  });

  it("strips the fragment, control and bidi characters, and masks secrets", async () => {
    const core = await boot();
    const res = await post(core, {
      url: "https://example.com/p#access_token=abc",
      title: `a\u202eb\u0007\nc ${FAKE_GITHUB_TOKEN}`,
      selection: `x\r\ny\u202e\u0000z`,
    });
    const page = res.json.page;
    expect(page.url).toBe("https://example.com/p");
    expect(page.title).not.toMatch(/[\u202e\u0007\n]/);
    expect(page.title).not.toContain(FAKE_GITHUB_TOKEN);
    expect(page.selected_text).toBe("x\nyz");
  });

  it("stores origin and path only: the query never reaches the row, the list or the audit", async () => {
    const core = await boot();
    const res = await post(core, {
      url: "https://example.com:8443/cb/x?code=plain-oauth-code&sid=abc&k=magic#frag",
      title: "t",
    });
    expect(res.json.page.url).toBe("https://example.com:8443/cb/x");
    const stored = core.runtime.db.prepare("SELECT url FROM page_notes").all() as { url: string }[];
    expect(stored.map((r) => r.url)).toEqual(["https://example.com:8443/cb/x"]);
    expect(JSON.stringify(auditRows(core, "companion.page.received"))).not.toMatch(
      /plain-oauth-code|magic|sid=/,
    );
  });

  it("stores a page whose host name looks like a secret label, with its audit row", async () => {
    const core = await boot();
    for (const host of ["cookie", "authorization", "x-api-key", "set-cookie"]) {
      const res = await post(core, { url: `http://${host}:8080/x`, title: "t" });
      expect(res.status, host).toBe(200);
      expect(() => new URL(res.json.page.url), host).not.toThrow();
    }
    const rows = auditRows(core, "companion.page.received").map((r) => JSON.parse(r.details).host);
    expect(rows.sort()).toEqual(
      ["authorization:8080", "cookie:8080", "set-cookie:8080", "x-api-key:8080"].sort(),
    );
    expect(core.runtime.pageNotes.count()).toBe(4);
  });

  it("leaves no half-state when the audit write fails after the insert", async () => {
    const core = await boot();
    const failing = new PageNotesService({
      db: core.runtime.db,
      audit: {
        record: () => {
          throw new Error("audit down");
        },
      },
    });
    expect(() => failing.receive(good)).toThrow("audit down");
    expect(core.runtime.pageNotes.count()).toBe(0);
  });

  it("stores no selection when none was sent", async () => {
    const core = await boot();
    const res = await post(core, { ...good, selection: "  \u202e " });
    expect(res.json.page.selected_text).toBeNull();
  });

  it("stops at the list size instead of deleting the person's pages", async () => {
    const core = await boot();
    for (let i = 0; i < MAX_PAGE_NOTES; i++) core.runtime.pageNotes.receive(good);
    const res = await post(core, good);
    expect(res.status).toBe(400);
    expect(core.runtime.pageNotes.count()).toBe(MAX_PAGE_NOTES);
  });

  it("deletes a page with an audit row, and refuses a bad or unknown id", async () => {
    const core = await boot();
    const { id } = (await post(core, good)).json.page;
    expect((await core.api("DELETE", "/api/companion/pages/not-an-id")).status).toBe(400);
    expect((await core.api("DELETE", `/api/companion/pages/pn_${"0".repeat(24)}`)).status).toBe(
      404,
    );
    expect((await core.api("DELETE", `/api/companion/pages/${id}`)).status).toBe(200);
    expect((await core.api("GET", "/api/companion/pages")).json.pages).toEqual([]);
    expect(auditRows(core, "companion.page.deleted")).toHaveLength(1);
  });

  it("shows up in the privacy inventory", async () => {
    const core = await boot();
    await post(core, good);
    const inventory = (await core.api("GET", "/api/privacy")).json;
    expect(inventory.derived.find((d: { id: string }) => d.id === "page_notes")).toMatchObject({
      count: 1,
    });
  });
});

describe("core.json (where Core listens, for the local hosts)", () => {
  it("is written 0600 next to the session token with the real port, and removed on stop", async () => {
    const core = await startCore(undefined, { writeTokenFile: true });
    const file = join(core.dataDir, "core.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      url: `http://127.0.0.1:${core.port}`,
    });
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    await core.runtime.stop();
    expect(existsSync(file)).toBe(false);
  });
});
