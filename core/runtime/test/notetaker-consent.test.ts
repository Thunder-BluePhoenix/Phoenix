// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 65 consent channel (managed mode), through the public HTTP API. NO desktop shell, pipe,
// microphone or call is involved: the shell is played by `shell()` below, which sends the
// per-launch value the way the real shell would, and the "pipe" is an injected stream.
import { randomBytes } from "node:crypto";
import { PassThrough } from "node:stream";
import { FakeRecognizer } from "@phoenix/ai-multimodal";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONSENT_SECRET_PREFIX, readConsentSecret } from "../src/consent-channel";
import { TOKEN, startCore, type TestCore } from "./helpers";

// Built at run time: a literal would look like a credential to the secret scanner.
const LAUNCH = randomBytes(32).toString("hex");
const OK = { consent: true, notice_acknowledged: true };
const HEADER = "x-phoenix-consent-secret";

let core: TestCore | undefined;
afterEach(async () => {
  await core?.runtime.stop();
  core = undefined;
});

interface Clock {
  t: number;
}

async function boot(
  options: { managed?: boolean; clock?: Clock; maxFailures?: number; maxCalls?: number } = {},
) {
  const clock = options.clock ?? { t: 1_000_000 };
  let n = 0;
  core = await startCore(
    {},
    {
      secrets: new MemorySecretStore(),
      runtime: {
        notetakerWindowSamples: 1600,
        notetakerRecognizer: new FakeRecognizer({ transcript: "hello" }),
        ...(options.managed === false
          ? {}
          : {
              consentSecret: LAUNCH,
              consentTiming: {
                now: () => clock.t,
                ttlMs: 30_000,
                linkTtlMs: 10_000,
                nonce: () => `nonce-${++n}-${"x".repeat(20)}`,
                ...(options.maxFailures ? { maxFailures: options.maxFailures } : {}),
                ...(options.maxCalls ? { maxCalls: options.maxCalls } : {}),
              },
            }),
      },
    },
  );
  await core.api("POST", "/api/notetaker/settings", { enabled: true });
  return { clock };
}

interface ShellReply {
  code?: string;
  decision?: string;
  pending: { nonce: string; what: string; requested_by: string; title: string | null }[];
}

/** What the shell sends: the launch value in its own header and NO session token. */
async function shell(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  headers: Record<string, string> = { [HEADER]: LAUNCH },
) {
  const res = await fetch(core!.base + path, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as ShellReply };
}

const pending = () => shell("GET", "/api/notetaker/consent/pending");
const status = async () => (await core!.api("GET", "/api/notetaker/status")).json;

/** Starts a recording request and returns its response promise plus the nonce the shell sees. */
async function startAndFetchNonce(title = "Board call") {
  const request = core!.api("POST", "/api/notetaker/sessions", { ...OK, title });
  const nonce = await vi.waitFor(
    async () => {
      const seen = (await pending()).json.pending;
      const first = seen[0];
      if (!first) throw new Error("not pending yet");
      return first.nonce;
    },
    { timeout: 3000, interval: 5 },
  );
  return { request, nonce };
}

const auditText = async () =>
  JSON.stringify((await core!.api("GET", "/api/audit?limit=500")).json.entries);

describe("unmanaged mode (pnpm dev:core) still refuses", () => {
  it("has no consent channel, refuses every start and the consent routes", async () => {
    await boot({ managed: false });
    expect((await status()).consent_channel).toMatchObject({
      available: false,
      code: "CONSENT_CHANNEL_UNAVAILABLE",
    });
    const start = await core!.api("POST", "/api/notetaker/sessions", OK);
    expect(start.status).toBe(403);
    expect(start.json.code).toBe("CONSENT_CHANNEL_UNAVAILABLE");
    const list = await shell("GET", "/api/notetaker/consent/pending");
    expect(list.status).toBe(403);
    expect(list.json.code).toBe("CONSENT_CHANNEL_UNAVAILABLE");
    const answer = await shell("POST", "/api/notetaker/consent/answer", {
      nonce: "n",
      decision: "granted",
    });
    expect(answer.status).toBe(403);
  });
});

describe("managed mode", () => {
  it("is unavailable until the shell has talked to Core, and again when the link goes quiet", async () => {
    const { clock } = await boot();
    expect((await status()).consent_channel.available).toBe(false);
    expect((await core!.api("POST", "/api/notetaker/sessions", OK)).status).toBe(403);
    expect((await pending()).status).toBe(200);
    expect((await status()).consent_channel.available).toBe(true);
    clock.t += 10_001;
    expect((await status()).consent_channel.available).toBe(false);
    expect((await core!.api("POST", "/api/notetaker/sessions", OK)).status).toBe(403);
  });

  it("a start waits for the person: granted starts it, denied does not", async () => {
    await boot();
    await pending();
    const granted = await startAndFetchNonce();
    const shown = (await pending()).json.pending[0];
    expect(shown).toMatchObject({
      what: "notetaker.record",
      requested_by: "session-api",
      title: "Board call",
    });
    expect(
      (
        await shell("POST", "/api/notetaker/consent/answer", {
          nonce: granted.nonce,
          decision: "granted",
        })
      ).json,
    ).toEqual({ decision: "granted" });
    const started = await granted.request;
    expect(started.status, JSON.stringify(started.json)).toBe(200);
    await core!.api("DELETE", `/api/notetaker/sessions/${started.json.id}`);

    const denied = await startAndFetchNonce();
    await shell("POST", "/api/notetaker/consent/answer", {
      nonce: denied.nonce,
      decision: "denied",
    });
    const refused = await denied.request;
    expect(refused.status).toBe(400);
    expect((await status()).active).toBeUndefined();
  });

  it("the request flags alone never start a recording while nobody answers", async () => {
    await boot();
    await pending();
    const { request } = await startAndFetchNonce();
    // Nobody answers; the request is still waiting and nothing records.
    let settled = false;
    void request.then(() => (settled = true));
    await core!.runtime.bus.drain();
    expect(settled).toBe(false);
    expect((await status()).active).toBeUndefined();
    core!.runtime.notetakerConsent!.close(); // shutdown answers "no"
    expect((await request).status).not.toBe(200);
  });

  it("the session token cannot answer or even read a consent", async () => {
    await boot();
    await pending();
    const { request, nonce } = await startAndFetchNonce();
    const asToken = { authorization: `Bearer ${TOKEN}` };
    const list = await shell("GET", "/api/notetaker/consent/pending", undefined, asToken);
    expect(list.status).toBe(401);
    const answer = await shell(
      "POST",
      "/api/notetaker/consent/answer",
      { nonce, decision: "granted" },
      asToken,
    );
    expect(answer.status).toBe(401);
    // The token in the secret's own header is just another wrong secret.
    const sneaky = await shell(
      "POST",
      "/api/notetaker/consent/answer",
      { nonce, decision: "granted" },
      { [HEADER]: TOKEN, ...asToken },
    );
    expect(sneaky.status).toBe(401);
    // Through the token-authenticated helper too.
    const viaApi = await core!.api("POST", "/api/notetaker/consent/answer", {
      nonce,
      decision: "granted",
    });
    expect(viaApi.status).toBe(401);
    // Still pending for the real shell.
    expect((await pending()).json.pending).toHaveLength(1);
    await shell("POST", "/api/notetaker/consent/answer", { nonce, decision: "denied" });
    expect((await request).status).toBe(400);
  });

  it("a wrong or missing secret is refused and answers nothing", async () => {
    await boot();
    await pending();
    const { request, nonce } = await startAndFetchNonce();
    const wrong = randomBytes(32).toString("hex");
    for (const headers of [{ [HEADER]: wrong }, {}, { [HEADER]: "" }] as Record<string, string>[]) {
      const res = await shell(
        "POST",
        "/api/notetaker/consent/answer",
        { nonce, decision: "granted" },
        headers,
      );
      expect(res.status).toBe(401);
    }
    await shell("POST", "/api/notetaker/consent/answer", { nonce, decision: "denied" });
    expect((await request).status).toBe(400);
  });

  it("web pages are refused before the secret is looked at (Origin or cookie)", async () => {
    await boot();
    for (const extra of [{ origin: core!.base }, { cookie: "a=b" }] as Record<string, string>[]) {
      const res = await shell("GET", "/api/notetaker/consent/pending", undefined, {
        [HEADER]: LAUNCH,
        ...extra,
      });
      expect(res.status).toBe(403);
    }
    expect((await status()).consent_channel.available).toBe(false);
  });

  it("a nonce works once: a replay is refused", async () => {
    await boot();
    await pending();
    const { request, nonce } = await startAndFetchNonce();
    const first = await shell("POST", "/api/notetaker/consent/answer", {
      nonce,
      decision: "granted",
    });
    expect(first.status).toBe(200);
    const started = await request;
    expect(started.status).toBe(200);
    const replay = await shell("POST", "/api/notetaker/consent/answer", {
      nonce,
      decision: "granted",
    });
    expect(replay.status).toBe(404);
    // A replay for a later request is refused too: the old nonce means nothing.
    await core!.api("DELETE", `/api/notetaker/sessions/${started.json.id}`);
    const second = await startAndFetchNonce();
    expect(second.nonce).not.toBe(nonce);
    expect(
      (await shell("POST", "/api/notetaker/consent/answer", { nonce, decision: "granted" })).status,
    ).toBe(404);
    await shell("POST", "/api/notetaker/consent/answer", {
      nonce: second.nonce,
      decision: "denied",
    });
    await second.request;
  });

  it("an expired nonce is refused and the request is not confirmed", async () => {
    const { clock } = await boot();
    await pending();
    const { request, nonce } = await startAndFetchNonce();
    clock.t += 30_001;
    const late = await shell("POST", "/api/notetaker/consent/answer", {
      nonce,
      decision: "granted",
    });
    expect(late.status).toBe(404);
    expect((await request).status).toBe(400);
    expect((await status()).active).toBeUndefined();
    expect((await pending()).json.pending).toEqual([]);
  });

  it("rejects an unknown decision and extra fields", async () => {
    await boot();
    await pending();
    const { request, nonce } = await startAndFetchNonce();
    expect(
      (await shell("POST", "/api/notetaker/consent/answer", { nonce, decision: "yes" })).status,
    ).toBe(400);
    expect(
      (
        await shell("POST", "/api/notetaker/consent/answer", {
          nonce,
          decision: "granted",
          extra: 1,
        })
      ).status,
    ).toBe(400);
    await shell("POST", "/api/notetaker/consent/answer", { nonce, decision: "denied" });
    await request;
  });

  it("is rate limited: repeated failures lock the routes, even for the right secret", async () => {
    await boot({ maxFailures: 3 });
    for (let i = 0; i < 3; i++) {
      const res = await shell("GET", "/api/notetaker/consent/pending", undefined, {
        [HEADER]: randomBytes(32).toString("hex"),
      });
      expect(res.status).toBe(401);
    }
    expect((await pending()).status).toBe(403);
    expect((await status()).consent_channel.available).toBe(false);
  });

  it("is rate limited: too many calls in a window", async () => {
    const { clock } = await boot({ maxCalls: 4 });
    for (let i = 0; i < 4; i++) expect((await pending()).status).toBe(200);
    expect((await pending()).status).toBe(403);
    clock.t += 60_001;
    expect((await pending()).status).toBe(200);
  });

  it("the audit log records the request and the answer and never the secret or a full nonce", async () => {
    await boot();
    await pending();
    const { request, nonce } = await startAndFetchNonce("Confidential board call");
    await shell("POST", "/api/notetaker/consent/answer", { nonce, decision: "granted" });
    const started = await request;
    await core!.api("DELETE", `/api/notetaker/sessions/${started.json.id}`);
    await shell("GET", "/api/notetaker/consent/pending", undefined, { [HEADER]: "wrong-value" });
    const text = await auditText();
    expect(text).toContain("notetaker.consent.requested");
    expect(text).toContain("notetaker.consent.granted");
    expect(text).toContain("notetaker.consent.rejected");
    expect(text).not.toContain(LAUNCH);
    expect(text).not.toContain("wrong-value");
    expect(text).not.toContain(nonce);
    expect(text).not.toContain("Confidential board call");
  });

  it("nothing in the HTTP surface or the logs carries the secret", async () => {
    await boot();
    await pending();
    for (const path of ["/api/notetaker/status", "/api/audit?limit=200", "/api/events?limit=200"]) {
      expect(JSON.stringify((await core!.api("GET", path)).json)).not.toContain(LAUNCH);
    }
  });
});

describe("reading the secret from the inherited pipe", () => {
  it("accepts exactly one well-formed line", async () => {
    const pipe = new PassThrough();
    const read = readConsentSecret(pipe, 1000);
    pipe.write(`${CONSENT_SECRET_PREFIX} ${LAUNCH}\n`);
    expect(await read).toBe(LAUNCH);
  });

  it.each([
    ["wrong prefix", `OTHER ${LAUNCH}\n`],
    ["short value", `${CONSENT_SECRET_PREFIX} abcd\n`],
    ["uppercase", `${CONSENT_SECRET_PREFIX} ${LAUNCH.toUpperCase()}\n`],
    ["trailing junk", `${CONSENT_SECRET_PREFIX} ${LAUNCH} extra\n`],
    ["too long", "a".repeat(400)],
  ])("refuses %s", async (_name, line) => {
    const pipe = new PassThrough();
    const read = readConsentSecret(pipe, 1000);
    pipe.write(line);
    expect(await read).toBeNull();
  });

  it("gives null when the pipe closes or never delivers, and for a terminal", async () => {
    const closed = new PassThrough();
    const read = readConsentSecret(closed, 1000);
    closed.end();
    expect(await read).toBeNull();
    expect(await readConsentSecret(new PassThrough(), 20)).toBeNull();
    const tty = Object.assign(new PassThrough(), { isTTY: true });
    expect(await readConsentSecret(tty, 1000)).toBeNull();
  });

  it("a shell that goes away ends the link and the waiting consent", async () => {
    await boot();
    await pending();
    const { request } = await startAndFetchNonce();
    core!.runtime.notetakerConsent!.shellGone();
    expect((await request).status).toBe(400);
    expect((await status()).consent_channel.available).toBe(false);
    expect((await pending()).status).toBe(200);
    expect((await status()).consent_channel.available).toBe(false);
  });
});
