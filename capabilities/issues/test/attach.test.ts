// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `jira.issue.attach` and `linear.issue.attach` (Phase 85), exercised ONLY against a fake `fetch`.
// Nothing here contacts Atlassian, Linear or Google Cloud Storage: no real tracker, account, key,
// site or signed URL was involved, and every reply shape is written from the vendors' documentation.
import { createHash } from "node:crypto";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIssuesCapability,
  LINEAR_CREATE_ENDPOINT,
  LINEAR_FILE_UPLOAD_MUTATION,
  MAX_ATTACH_BYTES,
  multipartBody,
  validateAssetUrl,
  validateUploadHeaders,
  validateUploadUrl,
} from "../src";

const SITE = "https://acme.atlassian.net";
const LINEAR_KEY = ["fake", "linear", "write", "0001"].join("-");
const JIRA_EMAIL = "writer@example.test";
const JIRA_TOKEN = ["fake", "jira", "write", "0002"].join("-");
const REMOTE_MARK = "REMOTE-WROTE-THIS-9f3";
const BASIC = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString("base64");
/** A signed URL is a bearer capability: it must never reach an operation, event, audit row or error. */
const SIGNED = `https://storage.googleapis.com/linear-uploads/abc/def.png?X-Goog-Signature=${REMOTE_MARK}SIG&X-Goog-Expires=60`;
const ASSET = "https://uploads.linear.app/ws/abc/def.png";

/** A whole PNG: signature, 13-byte IHDR (width x height), IEND. Pixels are not decoded by the check. */
function png(width = 4, height = 4, pad = 0): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return Buffer.concat([sig, ihdr, Buffer.alloc(pad, 7), iend]);
}

interface Call {
  url: string;
  init: RequestInit;
}
type Reply = Response | "throw" | "hang";

let h: Harness | undefined;
let calls: Call[] = [];

afterEach(async () => {
  await h?.close();
  h = undefined;
  calls = [];
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** A fake `fetch` that answers per call index. Like the real one with redirect "error", it throws on 3xx. */
function fakeFetch(replies: (Reply | ((c: Call) => Reply))[]) {
  vi.stubGlobal("fetch", async (url: unknown, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    const pick = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    const res = typeof pick === "function" ? pick(call) : pick;
    if (res === "throw") throw new TypeError(`connection reset ${SIGNED}`);
    if (res === "hang") {
      const hung = Promise.withResolvers<Response>();
      init.signal?.addEventListener("abort", () => hung.reject(new DOMException("aborted")));
      return await hung.promise;
    }
    if (res.status >= 300 && res.status < 400 && init.redirect === "error") {
      throw new TypeError("unexpected redirect");
    }
    return res;
  });
}

async function ready(
  setup: {
    linearKey?: string | null;
    site?: string | null;
    limits?: { timeoutMs?: number; maxBytes?: number };
  } = {},
) {
  h = createHarness({
    modules: [
      createIssuesCapability({
        wait: () => Promise.withResolvers<void>().promise,
        ...(setup.limits ? { limits: setup.limits } : {}),
      }),
    ],
  });
  const site = setup.site === undefined ? SITE : setup.site;
  h.manager.configure("issues", site ? { create: { jira_site: site } } : {});
  const linearKey = setup.linearKey === undefined ? LINEAR_KEY : setup.linearKey;
  if (linearKey) await h.manager.setSecret("issues", "linear_write_key", linearKey);
  await h.manager.setSecret("issues", "jira_write_email", JIRA_EMAIL);
  await h.manager.setSecret("issues", "jira_write_token", JIRA_TOKEN);
  await h.enable("issues");
  return h;
}

/** The full input, with the confirmation fields computed from the image the way a page would. */
function input(image: Buffer, issue: string, extra: Record<string, unknown> = {}) {
  const prefix = createHash("sha256").update(image).digest("hex").slice(0, 12);
  return {
    issue,
    image_base64: image.toString("base64"),
    bytes: image.length,
    sha256_prefix: prefix,
    file_name: `phoenix-screenshot-${prefix}.png`,
    ...extra,
  };
}

/**
 * Core's schema check throws before an operation exists; the capability's own check fails the
 * operation. Either way nothing was sent, so both are reported as a failed result here.
 */
async function attempt(command: string, i: Record<string, unknown>, approve: boolean) {
  try {
    return await h!.run("issues", command, i, approve);
  } catch (err) {
    return {
      status: "failed" as const,
      result: undefined,
      error: { message: (err as Error).message },
    };
  }
}
const jira = (i: Record<string, unknown>, approve = true) =>
  attempt("jira.issue.attach", i, approve);
const linear = (i: Record<string, unknown>, approve = true) =>
  attempt("linear.issue.attach", i, approve);

const auditRows = () => h!.db.prepare("SELECT * FROM audit_log").all() as Record<string, unknown>[];
const everything = (...ops: unknown[]) =>
  JSON.stringify({
    ops,
    events: h!.events,
    audit: auditRows(),
    view: h!.manager.get("issues"),
  });
const noSecrets = (text: string) => {
  for (const secret of [
    LINEAR_KEY,
    JIRA_TOKEN,
    JIRA_EMAIL,
    BASIC,
    REMOTE_MARK,
    SIGNED,
    "X-Goog-Signature",
  ]) {
    expect(text).not.toContain(secret);
  }
};

const IMAGE = png();
const JIRA_OK = [{ id: "10050", filename: "x.png", self: `https://evil.test/${REMOTE_MARK}` }];

const LINEAR_REPLIES = (over: Record<string, unknown> = {}): Reply[] => [
  json({ data: { issue: { id: "0a1b2c3d-1111-2222-3333-444455556666", identifier: "ENG-12" } } }),
  json({
    data: {
      fileUpload: {
        success: true,
        uploadFile: {
          uploadUrl: SIGNED,
          assetUrl: ASSET,
          headers: [
            { key: "Content-Type", value: "image/png" },
            { key: "x-goog-meta-source", value: "linear" },
          ],
          ...over,
        },
      },
    },
  }),
  new Response("", { status: 200 }),
  json({ data: { attachmentCreate: { success: true } } }),
];

describe("manifest", () => {
  it("both attach commands are separate external commands; GitHub has none", () => {
    const manifest = createIssuesCapability().manifest;
    for (const name of ["jira.issue.attach", "linear.issue.attach"]) {
      const spec = manifest.commands.find((c) => c.name === name);
      expect(spec?.side_effect).toBe("external");
      expect(spec?.permissions).toEqual(["network", "external_api"]);
      const schema = spec?.input_schema as {
        properties: Record<string, Record<string, unknown>>;
        additionalProperties: boolean;
      };
      expect(schema.additionalProperties).toBe(false);
      // The card shows the issue key, the generated file name, the size and the hash prefix.
      for (const shown of ["issue", "file_name", "bytes", "sha256_prefix"]) {
        expect(schema.properties[shown]?.["x-phoenix-confirm"]).toBe(true);
      }
      expect(schema.properties.image_base64?.["x-phoenix-confirm"]).toBeUndefined();
    }
    expect(manifest.commands.map((c) => c.name).filter((n) => /github|attach/.test(n))).toEqual([
      "jira.issue.attach",
      "linear.issue.attach",
    ]);
  });
});

describe("jira.issue.attach", () => {
  it("posts one multipart body with field `file`, the no-check header, to the pinned site", async () => {
    await ready();
    fakeFetch([json(JIRA_OK)]);
    const op = await jira(input(IMAGE, "PROJ-7"));
    expect(op.status).toBe("succeeded");
    const prefix = createHash("sha256").update(IMAGE).digest("hex").slice(0, 12);
    expect(op.result).toEqual({
      tracker: "jira",
      issue: "PROJ-7",
      file_name: `phoenix-screenshot-${prefix}.png`,
      bytes: IMAGE.length,
      sha256_prefix: prefix,
      attached: true,
    });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(`${SITE}/rest/api/3/issue/PROJ-7/attachments`);
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("error");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["x-atlassian-token"]).toBe("no-check");
    expect(headers.authorization).toBe(`Basic ${BASIC}`);
    const boundary = /^multipart\/form-data; boundary=(phoenix-[0-9a-f]{32})$/.exec(
      headers["content-type"] ?? "",
    )?.[1];
    expect(boundary).toBeTruthy();
    const body = Buffer.from(call.init.body as Uint8Array);
    expect(body.equals(multipartBody(IMAGE, `phoenix-screenshot-${prefix}.png`, boundary!))).toBe(
      true,
    );
    const text = body.toString("latin1");
    expect(
      text.startsWith(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="phoenix-screenshot-${prefix}.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
    ).toBe(true);
    expect(text.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);
    expect(body.includes(IMAGE)).toBe(true);
    // Exactly one part.
    expect(text.split(`--${boundary}`).length).toBe(3);
    noSecrets(everything(op));
  });

  it("asks Core for confirmation and sends nothing when declined", async () => {
    await ready();
    fakeFetch([json(JIRA_OK)]);
    const op = await jira(input(IMAGE, "PROJ-7"), false);
    expect(op.status).toBe("failed");
    expect(calls).toEqual([]);
  });

  it("the confirmation card carries the issue key, file name, size and hash prefix only", async () => {
    await ready();
    fakeFetch([json(JIRA_OK)]);
    const op = await jira(input(IMAGE, "PROJ-7"));
    const prefix = createHash("sha256").update(IMAGE).digest("hex").slice(0, 12);
    const rows = JSON.stringify(auditRows());
    expect(rows).toContain("PROJ-7");
    expect(rows).toContain(`phoenix-screenshot-${prefix}.png`);
    expect(rows).toContain(prefix);
    expect(rows).not.toContain(IMAGE.toString("base64"));
    expect(op.status).toBe("succeeded");
  });

  it("is host-pinned: no site, a look-alike or a non-atlassian site sends nothing", async () => {
    await ready({ site: null });
    fakeFetch([json(JIRA_OK)]);
    const op = await jira(input(IMAGE, "PROJ-7"));
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/config\.create\.jira_site/);
    expect(calls).toEqual([]);
    // The configuration itself refuses any other host, so none can ever be stored.
    for (const site of [
      "https://acme.atlassian.net.evil.test",
      "http://acme.atlassian.net",
      "https://evil.test",
    ]) {
      expect(() => h!.manager.configure("issues", { create: { jira_site: site } })).toThrow();
    }
  });

  it("an issue key that could change the path is refused before any request", async () => {
    await ready();
    fakeFetch([json(JIRA_OK)]);
    for (const issue of ["../../x", "PROJ-7/../../x", "proj-7", "PROJ-7?x=1", "PROJ-7 "]) {
      const op = await jira(input(IMAGE, issue));
      expect(op.status).toBe("failed");
    }
    expect(calls).toEqual([]);
  });

  const failures: [string, Response, RegExp][] = [
    ["401", json({ message: REMOTE_MARK }, 401), /rejected the credentials/],
    ["403", json({ message: REMOTE_MARK }, 403), /refused the request \(403\)/],
    ["404", json({ message: REMOTE_MARK }, 404), /could not find that issue/],
    ["413", json({ message: REMOTE_MARK }, 413), /too large \(413\)/],
    [
      "429",
      new Response(REMOTE_MARK, { status: 429, headers: { "retry-after": "5" } }),
      /rate limit/,
    ],
    ["500", json({ message: REMOTE_MARK }, 500), /may or may not have been attached/],
    ["200 html", new Response(`<html>${REMOTE_MARK}</html>`), /could not read/],
    ["200 object", json({ id: "10050" }), /could not read/],
    ["200 empty list", json([]), /could not read/],
    ["200 two entries", json([{ id: "1" }, { id: "2" }]), /could not read/],
    ["200 bad id", json([{ id: REMOTE_MARK }]), /could not read/],
    ["204", new Response(null, { status: 204 }), /could not read/],
  ];
  for (const [name, reply, message] of failures) {
    it(`${name}: fixed message, nothing the server wrote leaks, one request`, async () => {
      await ready();
      fakeFetch([reply]);
      const op = await jira(input(IMAGE, "PROJ-7"));
      expect(op.status).toBe("failed");
      expect(op.error?.message).toMatch(message);
      expect(calls).toHaveLength(1);
      noSecrets(everything(op));
    });
  }

  it("a redirect is not followed and says the outcome is unknown", async () => {
    await ready();
    fakeFetch([new Response("", { status: 302, headers: { location: "https://evil.test/x" } })]);
    const op = await jira(input(IMAGE, "PROJ-7"));
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/may or may not have been attached/);
    expect(calls).toHaveLength(1);
    expect(everything(op)).not.toContain("evil.test");
  });

  it("a dropped connection, a hang and an oversized reply are fixed messages", async () => {
    await ready({ limits: { timeoutMs: 50, maxBytes: 64 } });
    for (const reply of [
      "throw",
      "hang",
      new Response("x".repeat(500), { status: 200 }),
    ] as Reply[]) {
      fakeFetch([reply]);
      const op = await jira(input(IMAGE, "PROJ-7"));
      expect(op.status).toBe("failed");
      expect(op.error?.message).toMatch(/may or may not have been attached/);
      noSecrets(everything(op));
    }
  });
});

describe("image validation (both commands)", () => {
  const bad: [string, Record<string, unknown>][] = [
    ["not base64", { image_base64: "not base64 !!!" }],
    ["empty", { image_base64: "" }],
    [
      "a JPEG",
      {
        image_base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(1)]).toString(
          "base64",
        ),
      },
    ],
    [
      "truncated PNG (no IEND)",
      { image_base64: IMAGE.subarray(0, IMAGE.length - 4).toString("base64") },
    ],
    ["zero width", { image_base64: png(0, 4).toString("base64") }],
    ["huge dimensions", { image_base64: png(70_000, 4).toString("base64") }],
    ["wrong byte count", { bytes: IMAGE.length + 1 }],
    ["wrong hash prefix", { sha256_prefix: "0".repeat(12) }],
    ["a file name from the caller", { file_name: "../../etc/passwd.png" }],
    ["a different generated-looking name", { file_name: "phoenix-screenshot-000000000000.png" }],
    ["an extra field", { url: "https://evil.test/x" }],
    ["a path", { path: "/etc/passwd" }],
  ];
  for (const [name, patch] of bad) {
    it(`${name} is refused before any request`, async () => {
      await ready();
      fakeFetch([json(JIRA_OK)]);
      const j = await jira({ ...input(IMAGE, "PROJ-7"), ...patch });
      const l = await linear({ ...input(IMAGE, "ENG-12"), ...patch });
      expect(j.status).toBe("failed");
      expect(l.status).toBe("failed");
      expect(calls).toEqual([]);
    });
  }

  it("more than 5 MiB is refused before any request", async () => {
    await ready();
    fakeFetch([json(JIRA_OK)]);
    const big = png(4, 4, MAX_ATTACH_BYTES);
    const j = await jira(input(big, "PROJ-7"));
    const l = await linear(input(big, "ENG-12"));
    expect(j.status).toBe("failed");
    expect(l.status).toBe("failed");
    expect(calls).toEqual([]);
  });

  it("exactly 5 MiB is accepted", async () => {
    await ready();
    fakeFetch([json(JIRA_OK)]);
    const exact = png(4, 4, MAX_ATTACH_BYTES - png().length);
    expect(exact.length).toBe(MAX_ATTACH_BYTES);
    const op = await jira(input(exact, "PROJ-7"));
    expect(op.status).toBe("succeeded");
  });
});

describe("linear.issue.attach", () => {
  it("looks the issue up, asks for an upload URL, PUTs the bytes, then links the asset", async () => {
    await ready();
    fakeFetch(LINEAR_REPLIES());
    const op = await linear(input(IMAGE, "ENG-12"));
    expect(op.status).toBe("succeeded");
    const prefix = createHash("sha256").update(IMAGE).digest("hex").slice(0, 12);
    expect(op.result).toEqual({
      tracker: "linear",
      issue: "ENG-12",
      file_name: `phoenix-screenshot-${prefix}.png`,
      bytes: IMAGE.length,
      sha256_prefix: prefix,
      attached: true,
    });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", LINEAR_CREATE_ENDPOINT],
      ["POST", LINEAR_CREATE_ENDPOINT],
      ["PUT", SIGNED],
      ["POST", LINEAR_CREATE_ENDPOINT],
    ]);
    for (const c of calls) expect(c.init.redirect).toBe("error");
    const [lookup, upload, put, link] = calls as [Call, Call, Call, Call];
    expect((lookup.init.headers as Record<string, string>).authorization).toBe(LINEAR_KEY);
    expect(JSON.parse(lookup.init.body as string).variables).toEqual({ id: "ENG-12" });
    const uploadBody = JSON.parse(upload.init.body as string);
    expect(uploadBody.query).toBe(LINEAR_FILE_UPLOAD_MUTATION);
    expect(uploadBody.variables).toEqual({
      contentType: "image/png",
      filename: `phoenix-screenshot-${prefix}.png`,
      size: IMAGE.length,
    });
    // The signed URL host never receives our credential; it gets the returned headers and the bytes.
    const putHeaders = put.init.headers as Record<string, string>;
    expect(putHeaders.authorization).toBeUndefined();
    expect(putHeaders["content-type"]).toBe("image/png");
    expect(putHeaders["x-goog-meta-source"]).toBe("linear");
    expect(Buffer.from(put.init.body as Uint8Array).equals(IMAGE)).toBe(true);
    expect(JSON.parse(link.init.body as string).variables).toEqual({
      input: {
        issueId: "0a1b2c3d-1111-2222-3333-444455556666",
        title: `phoenix-screenshot-${prefix}.png`,
        url: ASSET,
      },
    });
    noSecrets(everything(op));
  });

  it("a declined confirmation sends nothing", async () => {
    await ready();
    fakeFetch(LINEAR_REPLIES());
    const op = await linear(input(IMAGE, "ENG-12"), false);
    expect(op.status).toBe("failed");
    expect(calls).toEqual([]);
  });

  it("no write key: fails before any request and never uses another key", async () => {
    await ready({ linearKey: null });
    fakeFetch(LINEAR_REPLIES());
    const op = await linear(input(IMAGE, "ENG-12"));
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/No linear_write_key is set/);
    expect(calls).toEqual([]);
  });

  it("an issue that comes back with another identifier is refused before any upload", async () => {
    await ready();
    fakeFetch([
      json({
        data: { issue: { id: "0a1b2c3d-1111-2222-3333-444455556666", identifier: "OTHER-1" } },
      }),
    ]);
    const op = await linear(input(IMAGE, "ENG-12"));
    expect(op.status).toBe("failed");
    expect(calls).toHaveLength(1);
  });

  it("an unknown issue (null) is refused before any upload", async () => {
    await ready();
    fakeFetch([json({ data: { issue: null } })]);
    const op = await linear(input(IMAGE, "ENG-12"));
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/could not find that issue/);
    expect(calls).toHaveLength(1);
  });

  describe("signed upload URL validation", () => {
    const accepted = [
      "https://storage.googleapis.com/bucket/obj.png?X-Goog-Signature=abc",
      "https://linear-uploads.storage.googleapis.com/obj.png?X-Goog-Signature=abc",
    ];
    const refused: [string, unknown][] = [
      ["http", "http://storage.googleapis.com/bucket/obj.png?s=1"],
      ["another host", "https://evil.test/bucket/obj.png?s=1"],
      ["look-alike suffix", "https://storage.googleapis.com.evil.test/obj.png?s=1"],
      ["look-alike prefix", "https://evilstorage.googleapis.com/obj.png"],
      ["nested bucket host", "https://a.b.storage.googleapis.com/obj"],
      ["userinfo trick", "https://storage.googleapis.com@evil.test/obj.png?s=1"],
      ["userinfo", "https://user:pw@storage.googleapis.com/obj.png"],
      ["port", "https://storage.googleapis.com:8443/obj.png"],
      ["fragment", "https://storage.googleapis.com/obj.png#x"],
      ["IP address", "https://142.250.80.16/obj.png"],
      ["loopback", "https://127.0.0.1/obj.png"],
      ["localhost", "https://localhost/obj.png"],
      ["file scheme", "file:///etc/passwd"],
      ["data scheme", "data:text/plain,hi"],
      ["javascript scheme", "javascript:alert(1)"],
      ["backslash", "https://storage.googleapis.com\\@evil.test/obj"],
      ["space", "https://storage.googleapis.com/a b"],
      ["control char", "https://storage.googleapis.com/a\u0000b"],
      ["dot segments", "https://storage.googleapis.com/a/../b"],
      ["encoded slash", "https://storage.googleapis.com/a%2f..%2fb"],
      ["too long", `https://storage.googleapis.com/${"a".repeat(5000)}`],
      ["empty", ""],
      ["not a string", 42],
      ["null", null],
      ["object", { href: "https://storage.googleapis.com/x" }],
      ["no scheme", "storage.googleapis.com/obj"],
    ];
    for (const url of accepted) {
      it(`accepts ${url.slice(0, 50)}`, () => {
        expect(validateUploadUrl(url)).toBe(new URL(url).href);
      });
    }
    for (const [name, url] of refused) {
      it(`refuses ${name}`, () => {
        expect(validateUploadUrl(url)).toBeUndefined();
      });
    }
    for (const [name, url] of refused.slice(0, 8)) {
      it(`end to end: ${name} uploads nothing and the URL is not echoed`, async () => {
        await ready();
        fakeFetch(LINEAR_REPLIES({ uploadUrl: url }));
        const op = await linear(input(IMAGE, "ENG-12"));
        expect(op.status).toBe("failed");
        expect(op.error?.message).toMatch(/does not accept/);
        // Lookup and fileUpload only: no PUT, no attachmentCreate.
        expect(calls).toHaveLength(2);
        expect(calls.some((c) => c.init.method === "PUT")).toBe(false);
        expect(everything(op)).not.toContain(String(url));
      });
    }
  });

  describe("asset URL and upload header validation", () => {
    it("accepts the Linear asset host only", () => {
      expect(validateAssetUrl(ASSET)).toBe(ASSET);
      for (const bad of [
        "https://evil.test/ws/a.png",
        "http://uploads.linear.app/ws/a.png",
        "https://uploads.linear.app.evil.test/a.png",
        "https://uploads.linear.app/a.png?x=1",
        "https://uploads.linear.app/../a.png",
        "https://u@uploads.linear.app/a.png",
        "javascript:alert(1)",
        "",
        7,
      ]) {
        expect(validateAssetUrl(bad)).toBeUndefined();
      }
    });
    it("keeps allow-listed headers and refuses the rest", () => {
      expect(
        validateUploadHeaders([
          { key: "Content-Type", value: "image/png" },
          { key: "x-goog-meta-a", value: "b" },
        ]),
      ).toEqual({ "content-type": "image/png", "x-goog-meta-a": "b" });
      for (const bad of [
        [{ key: "Authorization", value: "x" }],
        [{ key: "Host", value: "evil.test" }],
        [{ key: "Cookie", value: "a=b" }],
        [{ key: "Content-Type", value: "text/html" }],
        [{ key: "x-goog-meta-a", value: "line\r\nbreak" }],
        [{ key: "x-goog-meta-a", value: 3 }],
        Array.from({ length: 13 }, () => ({ key: "x-goog-meta-a", value: "b" })),
        "nope",
        null,
      ]) {
        expect(validateUploadHeaders(bad)).toBeUndefined();
      }
    });
    it("end to end: a bad asset URL or header uploads nothing", async () => {
      await ready();
      fakeFetch(LINEAR_REPLIES({ assetUrl: "https://evil.test/a.png" }));
      expect((await linear(input(IMAGE, "ENG-12"))).status).toBe("failed");
      expect(calls.some((c) => c.init.method === "PUT")).toBe(false);
      calls = [];
      fakeFetch(LINEAR_REPLIES({ headers: [{ key: "Authorization", value: LINEAR_KEY }] }));
      expect((await linear(input(IMAGE, "ENG-12"))).status).toBe("failed");
      expect(calls.some((c) => c.init.method === "PUT")).toBe(false);
    });
  });

  describe("hostile responses", () => {
    const cases: [string, Reply[], RegExp][] = [
      ["lookup 401", [json({ errors: [{ message: REMOTE_MARK }] }, 401)], /rejected the write key/],
      [
        "fileUpload GraphQL error",
        [
          LINEAR_REPLIES()[0]!,
          json({ errors: [{ message: REMOTE_MARK, extensions: { code: "X" } }] }),
        ],
        /Linear reported an error/,
      ],
      [
        "fileUpload success false",
        [LINEAR_REPLIES()[0]!, json({ data: { fileUpload: { success: false } } })],
        /could not read/,
      ],
      [
        "fileUpload html",
        [LINEAR_REPLIES()[0]!, new Response(`<html>${REMOTE_MARK}</html>`)],
        /could not read/,
      ],
      [
        "PUT 403",
        [...LINEAR_REPLIES().slice(0, 2), new Response(REMOTE_MARK, { status: 403 })],
        /file storage did not accept the image \(HTTP 403\)/,
      ],
      [
        "PUT 500",
        [...LINEAR_REPLIES().slice(0, 2), new Response(REMOTE_MARK, { status: 500 })],
        /file storage did not accept the image \(HTTP 500\)/,
      ],
      [
        "PUT redirect",
        [
          ...LINEAR_REPLIES().slice(0, 2),
          new Response("", { status: 307, headers: { location: "https://evil.test/x" } }),
        ],
        /may or may not have been attached/,
      ],
      [
        "PUT connection dropped",
        [...LINEAR_REPLIES().slice(0, 2), "throw"],
        /may or may not have been attached/,
      ],
      [
        "link step fails",
        [...LINEAR_REPLIES().slice(0, 3), json({ errors: [{ message: REMOTE_MARK }] })],
        /Linear reported an error/,
      ],
      [
        "link step success false",
        [...LINEAR_REPLIES().slice(0, 3), json({ data: { attachmentCreate: { success: false } } })],
        /uploaded to Linear's storage but Linear did not link it/,
      ],
    ];
    for (const [name, replies, message] of cases) {
      it(`${name}: fixed message, no signed URL or remote text anywhere`, async () => {
        await ready();
        fakeFetch(replies);
        const op = await linear(input(IMAGE, "ENG-12"));
        expect(op.status).toBe("failed");
        expect(op.error?.message).toMatch(message);
        noSecrets(everything(op));
      });
    }
  });
});
