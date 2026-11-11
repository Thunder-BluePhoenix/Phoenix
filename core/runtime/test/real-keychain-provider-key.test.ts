// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 63, REAL macOS Keychain with a provider key. Opt-in, macOS only:
//   PHOENIX_REAL_KEYCHAIN=1 node ./node_modules/vitest/vitest.mjs run core/runtime/test/real-keychain-provider-key.test.ts
//
// What runs for real: a PhoenixRuntime with `secrets: new KeychainSecretStore()` (production service
// name `phoenix`, the login keychain, the `security` tool), the production routes
// POST/DELETE /api/ai/providers/:id/secret, and the production AI path (AiService.run through the
// routed user endpoint, which reads the key from the Keychain on every request) against a recording
// HTTP server on 127.0.0.1. What does NOT run: any cloud provider, any real key, a signed app, a
// Keychain access prompt for another binary, Linux or Windows.
//
// The service name is fixed by KeychainSecretStore (`phoenix`), so every item this test creates has
// an account carrying the marker `kc63-` (provider id `kc63-<hex>` => account
// `phoenix.ai.kc63-<hex>_api_key`; direct probes use `kc63-legacy-<hex>`). A sweep of ONLY accounts
// with that marker runs before and after; the test asserts none is left. Fake values are made at run
// time from random bytes and are never printed or written: evidence carries a length and a SHA-256
// prefix only.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger, type LogRecord } from "@phoenix/logging";
import { KeychainSecretStore } from "@phoenix/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCore } from "./helpers";

const ENABLED = process.env.PHOENIX_REAL_KEYCHAIN === "1" && process.platform === "darwin";
const MARKER = "kc63-";
const SERVICE = "phoenix";
const TOOL_TIMEOUT_MS = 20_000;

const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);
const fingerprint = (value: string) => ({ length: value.length, sha256_prefix: sha(value) });
const fakeValue = (chars: number) =>
  `fake-value-${randomBytes(Math.ceil(chars / 2)).toString("hex")}`
    .slice(0, chars)
    .padEnd(chars, "f");

interface ToolRun {
  status: number | null;
  timedOut: boolean;
  ms: number;
  stdout: string;
  stderr: string;
}
/** Runs the real `security` tool with a hard timeout. Output is returned, never logged. */
function security(args: string[], input?: string): ToolRun {
  const t0 = Date.now();
  const r = spawnSync("security", args, {
    input,
    encoding: "utf8",
    timeout: TOOL_TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    status: r.status,
    timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT",
    ms: Date.now() - t0,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

/** Accounts of items with service `phoenix` whose account carries the test marker. */
function markedAccounts(): string[] {
  const dump = security(["dump-keychain"]);
  const out = new Set<string>();
  for (const block of dump.stdout.split(/\nclass: /)) {
    if (!block.includes(`"svce"<blob>="${SERVICE}"`)) continue;
    const m = /"acct"<blob>="([^\n]*)"\n/.exec(block);
    if (m?.[1]?.includes(MARKER)) out.add(m[1]);
  }
  return [...out];
}
function sweep(): number {
  const found = markedAccounts();
  for (const account of found) security(["delete-generic-password", "-s", SERVICE, "-a", account]);
  return found.length;
}

/** Hash and length of the stored value, read with -w inside this function only. */
function storedFingerprint(account: string): { length: number; sha256_prefix: string } | null {
  const r = security(["find-generic-password", "-s", SERVICE, "-a", account, "-g"]);
  if (r.status !== 0) return null;
  const line = r.stderr.split("\n").find((l) => l.startsWith("password:")) ?? "";
  const shown = line.slice("password:".length).trim();
  const hex = /^0x([0-9a-fA-F]+)/.exec(shown);
  const value = hex ? Buffer.from(hex[1]!, "hex").toString("utf8") : shown.slice(1, -1);
  return fingerprint(value);
}

/** Attributes of an item (no -g, no -w: the tool prints no value), home directory redacted. */
function attributes(account: string) {
  const r = security(["find-generic-password", "-s", SERVICE, "-a", account]);
  const keep = ["class:", '"acct"', '"svce"', '"cdat"', '"mdat"', "keychain:"];
  return {
    exit: r.status,
    timed_out: r.timedOut,
    ms: r.ms,
    prompted_or_hung: r.timedOut,
    lines: r.stdout
      .split("\n")
      .filter((l) => keep.some((k) => l.trim().startsWith(k)))
      .map((l) => l.replaceAll(homedir(), "~").replace(/0x[0-9A-F]{16,}\s+/g, "")),
    password_lines_in_output: r.stdout.split("\n").filter((l) => /^password/.test(l)).length,
  };
}

/** Samples `ps` while `during` runs: did the value (or its hex) ever appear in a process command line? */
async function watchPs<T>(needles: string[], during: () => Promise<T>) {
  let stop = false;
  let samples = 0;
  let sawSecurityProcess = 0;
  let hits = 0;
  const loop = (async () => {
    while (!stop) {
      const out = await new Promise<string>((resolve) => {
        const p = spawn("ps", ["-axo", "command"]);
        let s = "";
        p.stdout.on("data", (c: Buffer) => (s += c));
        p.on("close", () => resolve(s));
        p.on("error", () => resolve(""));
      });
      samples++;
      if (/(^|\n)\S*security -i/.test(out) || /add-generic-password/.test(out))
        sawSecurityProcess++;
      if (needles.some((n) => out.includes(n))) hits++;
    }
  })();
  const result = await during();
  stop = true;
  await loop;
  return {
    result,
    ps: {
      samples,
      samples_with_security_process: sawSecurityProcess,
      samples_with_value_in_argv: hits,
    },
  };
}

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}
async function fakeProvider() {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      res.setHeader("content-type", "application/json");
      if ((req.url ?? "").endsWith("/models")) {
        res.end(JSON.stringify({ data: [{ id: "fake-model" }] }));
      } else {
        res.end(
          JSON.stringify({
            model: "fake-model",
            choices: [{ message: { content: "ok" }, finish_reason: "length" }],
            usage: { prompt_tokens: 3, completion_tokens: 1 },
          }),
        );
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    seen,
    port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe.runIf(ENABLED)("real macOS Keychain with a provider key (Phase 63)", () => {
  beforeAll(() => {
    const swept = sweep();
    expect(swept).toBeGreaterThanOrEqual(0);
  });
  afterAll(() => {
    sweep();
  });

  it(
    "set, read at request time, replace, delete through the production routes; long and odd values",
    { timeout: 240_000 },
    async () => {
      const providerId = `${MARKER}${randomBytes(4).toString("hex")}`;
      const account = `phoenix.ai.${providerId}_api_key`;
      const store = new KeychainSecretStore();
      const records: LogRecord[] = [];
      const logger = createLogger({ level: "debug", sink: (r) => records.push(r) });
      const server = await fakeProvider();
      const core = await startCore({}, { secrets: store, logger });
      const events: string[] = [];
      core.runtime.bus.subscribe("kc63-capture", "*", (e) => {
        events.push(JSON.stringify(e));
      });
      const responses: string[] = [];
      const call = async (method: string, path: string, body?: unknown) => {
        const r = await core.api(method, path, body);
        responses.push(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json ?? null)}`);
        return r;
      };
      const providerRoute = `/api/ai/providers/${providerId}/secret`;
      const ask = async (privacyNote = "one token") => {
        const before = server.seen.length;
        let error: string | undefined;
        let answered = false;
        try {
          const out = await core.runtime.ai.service.run({
            kind: "generate",
            request: {
              privacy: "public",
              purpose: "answer a question from memory",
              messages: [{ role: "user", content: privacyNote }],
              maxTokens: 1,
            },
          });
          answered = out.kind === "generate" && out.result.text === "ok";
        } catch (err) {
          error = err instanceof Error ? `${err.name}: ${err.message}` : "non-error thrown";
        }
        return { answered, error, requests: server.seen.slice(before) };
      };
      const authOf = (r: Seen) => r.headers.authorization;
      const secrets = new Set<string>();
      const evidence: Record<string, unknown> = {
        date: new Date().toISOString(),
        node: process.version,
        macos: spawnSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).stdout.trim(),
        provider_ref: account,
        service: SERVICE,
        security_tool: "/usr/bin/security (unsigned Node process, login keychain)",
      };
      let leftover = -1;
      try {
        // Core with a loopback OpenAI-compatible endpoint, routed for chat.
        const set = await call("POST", "/api/ai/settings", {
          enabled: true,
          endpoints: [
            {
              id: providerId,
              label: "Fake loopback",
              base_url: `http://127.0.0.1:${server.port}/v1`,
            },
          ],
          routing: { chat: { provider: providerId, model: "fake-model" } },
        });
        expect(set.status).toBe(200);
        expect(storedFingerprint(account)).toBeNull();

        // (1)+(2) set through the route; the item exists with the expected service/account.
        const v1 = fakeValue(40);
        secrets.add(v1);
        const setRun = await watchPs([v1, Buffer.from(v1).toString("hex")], () =>
          call("POST", providerRoute, { value: v1 }),
        );
        expect(setRun.result.status).toBe(200);
        expect(setRun.result.json).toEqual({ provider: providerId, key_set: true });
        const attrs = attributes(account);
        expect(attrs.exit).toBe(0);
        expect(attrs.timed_out).toBe(false);
        expect(attrs.password_lines_in_output).toBe(0);
        expect(attrs.lines.join("\n")).toContain(`"svce"<blob>="${SERVICE}"`);
        expect(attrs.lines.join("\n")).toContain(`"acct"<blob>="${account}"`);
        expect(storedFingerprint(account)).toEqual(fingerprint(v1));
        expect(setRun.ps.samples_with_value_in_argv).toBe(0);
        evidence.step2 = {
          attributes: attrs,
          value: fingerprint(v1),
          ps_watch_during_set: setRun.ps,
        };

        // (3) the key is read FROM THE KEYCHAIN at request time. Prove it: change the item behind
        // Core's back with `security` itself, and the next request carries that, not a cache.
        const first = await ask();
        expect(first.answered, first.error).toBe(true);
        const chat1 = first.requests.filter((r) => r.url.endsWith("/chat/completions"));
        expect(chat1).toHaveLength(1);
        expect(authOf(chat1[0]!)).toBe(`Bearer ${v1}`);
        for (const r of first.requests) {
          expect(r.url).toMatch(/^\/v1\/(models|chat\/completions)$/);
          for (const [name, val] of Object.entries(r.headers)) {
            if (name === "authorization") continue;
            expect(String(val), `header ${name}`).not.toContain(v1);
          }
          expect(r.body).not.toContain(v1);
          expect(r.url).not.toContain(v1);
        }
        const outOfBand = fakeValue(40);
        secrets.add(outOfBand);
        const oob = security([
          "add-generic-password",
          "-U",
          "-s",
          SERVICE,
          "-a",
          account,
          "-X",
          Buffer.from(outOfBand).toString("hex"),
        ]);
        expect(oob.status).toBe(0);
        const viaKeychain = await ask();
        const chatOob = viaKeychain.requests.filter((r) => r.url.endsWith("/chat/completions"));
        expect(authOf(chatOob[0]!)).toBe(`Bearer ${outOfBand}`);
        evidence.step3 = {
          requests_first_ask: first.requests.map((r) => ({
            method: r.method,
            path: r.url,
            authorization_present: authOf(r) !== undefined,
            authorization_equals_bearer_value: authOf(r) === `Bearer ${v1}`,
            header_names: Object.keys(r.headers).sort(),
            body_contains_value: r.body.includes(v1),
          })),
          key_read_from_keychain_at_request_time:
            "item rewritten with `security` outside Core; next request carried the new value",
          out_of_band_value: fingerprint(outOfBand),
          host_only_loopback: server.seen.every(
            (r) => r.headers.host === `127.0.0.1:${server.port}`,
          ),
        };

        // (4) replace through the route; the next request carries the new value.
        const v2 = fakeValue(55);
        secrets.add(v2);
        expect((await call("POST", providerRoute, { value: v2 })).status).toBe(200);
        expect(storedFingerprint(account)).toEqual(fingerprint(v2));
        const second = await ask();
        const chat2 = second.requests.filter((r) => r.url.endsWith("/chat/completions"));
        expect(authOf(chat2[0]!)).toBe(`Bearer ${v2}`);
        expect(second.requests.some((r) => authOf(r)?.includes(v1))).toBe(false);
        evidence.step4 = {
          new_value: fingerprint(v2),
          next_request_authorization_matches_new: true,
        };

        // Key shown as set in status, never the value.
        const status = await call("GET", "/api/ai/status");
        const view = (status.json.providers as { id: string; key_set: boolean }[]).find(
          (p) => p.id === providerId,
        );
        expect(view?.key_set).toBe(true);
        const listed = await call("GET", `/api/ai/status?models=${providerId}`);
        expect(listed.status).toBe(200);
        evidence.status_view = { key_set: view?.key_set };

        // (5) delete through the route.
        const del = await call("DELETE", providerRoute);
        expect(del.json).toEqual({ provider: providerId, key_set: false });
        const gone = security(["find-generic-password", "-s", SERVICE, "-a", account]);
        expect(gone.status).toBe(44);
        expect(gone.timedOut).toBe(false);
        const third = await ask();
        const chat3 = third.requests.filter((r) => r.url.endsWith("/chat/completions"));
        // A loopback endpoint's key is optional: the request goes out with NO Authorization header.
        expect(chat3.every((r) => authOf(r) === undefined)).toBe(true);
        expect(third.requests.every((r) => authOf(r) === undefined)).toBe(true);
        evidence.step5 = {
          find_after_delete: { exit: gone.status, stderr_first_line: gone.stderr.split("\n")[0] },
          next_request: {
            answered: third.answered,
            error: third.error ?? null,
            chat_requests: chat3.length,
            authorization_header_present: chat3.some((r) => authOf(r) !== undefined),
          },
        };

        // (6) lengths and odd values through the route and the real store.
        const cases: { name: string; value: string; expectStatus: number }[] = [
          { name: "ascii-128", value: fakeValue(128), expectStatus: 200 },
          { name: "ascii-129", value: fakeValue(129), expectStatus: 200 },
          { name: "ascii-200", value: fakeValue(200), expectStatus: 200 },
          { name: "ascii-1000", value: fakeValue(1000), expectStatus: 200 },
          { name: "ascii-1900", value: fakeValue(1900), expectStatus: 200 },
          {
            name: "quotes-no-spaces",
            value: `${fakeValue(12)}"ab"'c'\\d$e\`f\``,
            expectStatus: 200,
          },
          // Refused at set time: an HTTP header cannot carry these (AiRuntime.setSecret).
          {
            name: "spaces",
            value: `${fakeValue(12)} "a b" 'c' \\d $e \`f\``,
            expectStatus: 400,
          },
          { name: "unicode", value: `${fakeValue(12)} héllo wörld ✓ 日本語 😀`, expectStatus: 400 },
          { name: "leading-trailing-space", value: `  ${fakeValue(12)}  `, expectStatus: 400 },
          { name: "newline", value: `${fakeValue(12)}\nsecond`, expectStatus: 400 },
          { name: "carriage-return", value: `${fakeValue(12)}\rsecond`, expectStatus: 400 },
          { name: "nul", value: `${fakeValue(12)}\0x`, expectStatus: 400 },
          { name: "ascii-4000", value: fakeValue(4000), expectStatus: 400 },
          { name: "ascii-8192", value: fakeValue(8192), expectStatus: 400 },
          { name: "ascii-8193", value: fakeValue(8193), expectStatus: 400 },
        ];
        const rows: Record<string, unknown>[] = [];
        for (const c of cases) {
          secrets.add(c.value);
          await call("DELETE", providerRoute);
          const r = await call("POST", providerRoute, { value: c.value });
          const stored = storedFingerprint(account);
          const viaStore = await store.get(account);
          const row: Record<string, unknown> = {
            name: c.name,
            value: fingerprint(c.value),
            route_status: r.status,
            route_error: r.status === 200 ? null : (r.json?.message ?? null),
            keychain_item_exists: stored !== null,
            keychain_value: stored,
            round_trip_identical: viaStore === c.value,
          };
          expect(r.status, c.name).toBe(c.expectStatus);
          if (c.expectStatus === 200) {
            expect(viaStore === c.value, `${c.name} round trip`).toBe(true);
            expect(stored, c.name).toEqual(fingerprint(c.value));
            const a = await ask();
            const chat = a.requests.filter((q) => q.url.endsWith("/chat/completions"));
            row.request = {
              answered: a.answered,
              error: a.error ?? null,
              note: "HTTP trims leading/trailing spaces of a header value, so the server cannot see them",
              error_leaks_value: a.error?.includes(c.value) ?? false,
              authorization_matches_value:
                chat.length > 0 && authOf(chat[0]!) === `Bearer ${c.value}`,
              chat_requests: chat.length,
            };
            expect(a.error?.includes(c.value) ?? false).toBe(false);
          } else {
            expect(stored, `${c.name}: nothing stored on refusal`).toBeNull();
          }
          rows.push(row);
        }
        evidence.step6 = rows;

        // A refusal leaves the earlier key alone.
        const keep = fakeValue(1900);
        secrets.add(keep);
        expect((await call("POST", providerRoute, { value: keep })).status).toBe(200);
        const tooLong = fakeValue(4000);
        secrets.add(tooLong);
        expect((await call("POST", providerRoute, { value: tooLong })).status).toBe(400);
        expect(storedFingerprint(account)).toEqual(fingerprint(keep));
        // The longest value that fits the `security -i` line, and one more.
        const prefix = `add-generic-password -U -s ${SERVICE} -a "${account}" -X `.length;
        const maxBytes = Math.floor((4094 - prefix) / 2);
        const edge = fakeValue(maxBytes);
        secrets.add(edge);
        expect((await call("POST", providerRoute, { value: edge })).status).toBe(200);
        expect(storedFingerprint(account)).toEqual(fingerprint(edge));
        const edgePlus = fakeValue(maxBytes + 1);
        secrets.add(edgePlus);
        expect((await call("POST", providerRoute, { value: edgePlus })).status).toBe(400);
        expect(storedFingerprint(account)).toEqual(fingerprint(edge));
        evidence.longest_value_that_fits = { bytes: maxBytes, for_account_length: account.length };
        await call("DELETE", providerRoute);

        // What the OLD path did (security add-generic-password -w, value on stdin twice): measured
        // directly on throwaway items, so the defect is on record. Not used by Core any more.
        const legacy: Record<string, unknown>[] = [];
        for (const n of [100, 128, 129, 200, 1000, 4000]) {
          const v = fakeValue(n);
          secrets.add(v);
          const legacyAccount = `${MARKER}legacy-${randomBytes(3).toString("hex")}`;
          const add = security(
            ["add-generic-password", "-U", "-s", SERVICE, "-a", legacyAccount, "-w"],
            `${v}\n${v}\n`,
          );
          const got = storedFingerprint(legacyAccount);
          security(["delete-generic-password", "-s", SERVICE, "-a", legacyAccount]);
          legacy.push({
            value: fingerprint(v),
            add_exit: add.status,
            add_timed_out: add.timedOut,
            add_ms: add.ms,
            stored: got,
            silently_truncated: got !== null && got.length < n && add.status === 0,
          });
        }
        evidence.old_path_add_generic_password_w = legacy;

        // A value stored by the OLD path cannot be told from a short key: get() returns 128 chars.
        const old = fakeValue(200);
        secrets.add(old);
        security(
          ["add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w"],
          `${old}\n${old}\n`,
        );
        const readBack = await store.get(account);
        evidence.item_stored_truncated_by_old_path = {
          stored_value: readBack ? fingerprint(readBack) : null,
          indistinguishable_from_a_short_key: true,
        };
        await call("DELETE", providerRoute);

        // Structural: the value is in no response, audit entry, log record, event or other header.
        const finalGets = [
          "/api/ai/status",
          "/api/ai/providers",
          "/api/audit?limit=1000",
          "/api/diagnostics",
          "/api/privacy",
          "/api/permissions",
          "/api/capabilities",
          "/api/events",
        ];
        const getStatuses: Record<string, number> = {};
        for (const p of finalGets) getStatuses[p] = (await call("GET", p)).status;
        const audit = (await call("GET", "/api/audit?limit=1000")).json as {
          entries: { action: string; details: unknown }[];
        };
        const auditText = JSON.stringify(audit);
        const seenText = JSON.stringify(
          server.seen.map((r) => ({
            url: r.url,
            body: r.body,
            headers: { ...r.headers, authorization: "" },
          })),
        );
        const haystacks: Record<string, string> = {
          responses: responses.join("\n"),
          audit: auditText,
          logs: JSON.stringify(records),
          events: events.join("\n"),
          server_non_authorization: seenText,
        };
        const leaks: Record<string, number> = {};
        for (const [name, text] of Object.entries(haystacks)) {
          let n = 0;
          for (const s of secrets) {
            for (const form of [
              s,
              Buffer.from(s).toString("hex"),
              Buffer.from(s).toString("base64"),
            ]) {
              if (text.includes(form)) n++;
            }
          }
          leaks[name] = n;
          expect(n, `value found in ${name}`).toBe(0);
        }
        const setAudits = audit.entries.filter((e) => e.action.startsWith("ai.secret."));
        expect(setAudits.length).toBeGreaterThan(0);
        for (const e of setAudits) expect(e.details).toEqual({ provider: providerId });
        evidence.structural = {
          values_checked: secrets.size,
          leaks_by_surface_in_plain_hex_base64: leaks,
          log_records: records.length,
          event_bus_events: events.length,
          audit_secret_entries: setAudits.length,
          get_statuses: getStatuses,
          note_ai_providers_route:
            "GET /api/ai/providers is not a Core route (404); key_set is in GET /api/ai/status",
          server_requests_total: server.seen.length,
        };
      } finally {
        await core.runtime.stop().catch(() => undefined);
        await server.close();
        sweep();
        leftover = markedAccounts().length;
        evidence.leftover_items_with_marker = leftover;
        const dir = join(process.cwd(), "docs", "evidence");
        mkdirSync(dir, { recursive: true });
        const day = new Date().toISOString().slice(0, 10);
        writeFileSync(
          join(dir, `phase-63-real-keychain-provider-key-${day}-raw.json`),
          JSON.stringify(evidence, null, 2) + "\n",
        );
      }
      expect(leftover).toBe(0);
    },
  );
});
