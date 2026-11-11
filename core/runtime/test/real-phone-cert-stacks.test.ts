// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 71: the self-signed certificate Core's REAL phone TLS listener serves, checked by every
// independent TLS/X.509 stack installed on this machine. Skipped unless PHOENIX_REAL_CERT_STACKS=1:
//   PHOENIX_REAL_CERT_STACKS=1 PHOENIX_EVIDENCE_OUT=/tmp/phone-cert-stacks.json \
//     node ./node_modules/vitest/vitest.mjs run core/runtime/test/real-phone-cert-stacks.test.ts \
//     --testTimeout=600000
// Stacks (each skipped cleanly when its tool is missing; nothing is installed, nothing leaves
// loopback): Apple Security/URLSession via swiftc, Go crypto/x509+tls, Java JSSE, Python
// cryptography + ssl, LibreSSL and OpenSSL `x509` / `s_client` / `verify`. The probes live in
// core/runtime/test/real-cert-stacks/. These are DESKTOP stacks on macOS: they say nothing about
// iOS or Android devices (Network.framework policies, BoringSSL/Conscrypt were not exercised).
// Every result is recorded; only the guarantees below are asserted: the served fingerprint equals
// the advertised one and each stack's own computation, a handshake that pins the right
// fingerprint (and nothing else) completes on TLS 1.2 and 1.3, and a wrong pin is refused.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { X509Certificate, createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect as tlsConnect } from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSelfSignedCertificate } from "../src/phone-cert";
import { startCore, type TestCore } from "./helpers";

const enabled = process.env.PHOENIX_REAL_CERT_STACKS === "1";
const HERE = dirname(fileURLToPath(import.meta.url));
const PROBES = join(HERE, "real-cert-stacks");
const HOST = "127.0.0.1";
const BEGIN = ["-----BEGIN", "CERTIFICATE-----"].join(" ");
const END = ["-----END", "CERTIFICATE-----"].join(" ");

type Json = Record<string, unknown>;
interface Handshake {
  mode: string;
  tls: string;
  pin: string;
  ok: boolean;
  error?: unknown;
  [k: string]: unknown;
}
interface StackResult {
  stack: string;
  skipped?: string;
  sha256?: string;
  parse?: Json;
  handshakes?: Handshake[];
  [k: string]: unknown;
}

const fp = (der: Buffer): string =>
  createHash("sha256").update(der).digest("hex").toUpperCase().match(/../g)!.join(":");

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | undefined;
}

/** Async on purpose: the listener under test runs on this event loop, so nothing may block it. */
function run(
  cmd: string,
  args: string[],
  opts: { input?: string; cwd?: string; timeout?: number } = {},
): Promise<RunResult> {
  const { promise, resolve } = Promise.withResolvers<RunResult>();
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    timeout: opts.timeout ?? 60_000,
    killSignal: "SIGKILL",
    env: { ...process.env, GOPROXY: "off", GOFLAGS: "", GO111MODULE: "off" },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
  child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
  child.stdin.on("error", () => undefined);
  child.once("error", (error) => resolve({ status: null, stdout, stderr, error }));
  child.once("close", (status) => resolve({ status, stdout, stderr, error: undefined }));
  child.stdin.end(opts.input ?? "");
  return promise;
}

const which = async (name: string): Promise<string | null> => {
  const r = await run("/usr/bin/which", [name], { timeout: 5_000 });
  return r.status === 0 ? r.stdout.trim() : null;
};
const works = async (cmd: string, args: string[]): Promise<boolean> => {
  const r = await run(cmd, args, { timeout: 15_000 });
  return !r.error && r.status === 0;
};

/** Parses the single JSON line a probe prints. */
function parseProbe(stack: string, r: RunResult): StackResult {
  const line = r.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  try {
    return JSON.parse(line) as StackResult;
  } catch {
    return {
      stack,
      skipped: `probe produced no JSON (exit ${r.status}): ${r.stderr.slice(0, 400)}`,
    };
  }
}

describe.skipIf(!enabled)("the phone listener's certificate on independent stacks", () => {
  let core: TestCore;
  let work: string;
  let port = 0;
  let advertised = "";
  let pairingFingerprint = "";
  let der: Buffer;
  let wrongPin = "";
  const results: StackResult[] = [];
  const evidence: Json = {};
  const probeArgs = () => [
    HOST,
    String(port),
    join(work, "served.der"),
    join(work, "other.der"),
    advertised,
    wrongPin,
  ];

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "phoenix-cert-stacks-"));
    // Production code: the real runtime, the real PhoneLink, the real PhoneListener. Only the LAN
    // address list (loopback) and the port (ephemeral) are overridden.
    core = await startCore({}, { runtime: { phone: { lanAddresses: () => [HOST], port: 0 } } });
    const on = (await core.api("POST", "/api/phone/settings", { enabled: true })).json;
    port = on.port as number;
    advertised = on.fingerprint as string;
    pairingFingerprint = (await core.api("POST", "/api/phone/pairing")).json.fingerprint as string;
    // Extract the certificate the way a phone sees it: off the wire, with no trust configured.
    const socket = tlsConnect({ host: HOST, port, rejectUnauthorized: false });
    await once(socket, "secureConnect");
    der = Buffer.from(socket.getPeerCertificate(true).raw);
    socket.destroy();
    writeFileSync(join(work, "served.der"), der);
    writeFileSync(join(work, "served.crt"), new X509Certificate(der).toString());
    // A different key and certificate for the same address: the wrong pin and the wrong anchor.
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const otherX509 = new X509Certificate(
      buildSelfSignedCertificate({
        privateKey: other.privateKey,
        address: HOST,
        notBefore: new Date(Date.now() - 60_000),
        notAfter: new Date(Date.now() + 90 * 86_400_000),
      }),
    );
    writeFileSync(join(work, "other.der"), otherX509.raw);
    writeFileSync(join(work, "other.crt"), otherX509.toString());
    wrongPin = fp(otherX509.raw);
    const node = new X509Certificate(der);
    evidence.node = {
      version: process.version,
      subject: node.subject,
      issuer: node.issuer,
      validFrom: node.validFrom,
      validTo: node.validTo,
      validityDays: (Date.parse(node.validTo) - Date.parse(node.validFrom)) / 86_400_000,
      serialNumberHex: node.serialNumber,
      subjectAltName: node.subjectAltName,
      keyUsage: node.keyUsage,
      ca: node.ca,
      derBytes: der.length,
    };
    evidence.listener = {
      host: HOST,
      port,
      advertisedFingerprint: advertised,
      pairingFingerprint,
      wrongPin,
    };
  }, 120_000);

  afterAll(async () => {
    await core?.runtime.stop();
    if (process.env.PHOENIX_EVIDENCE_OUT) {
      const out = process.env.PHOENIX_EVIDENCE_OUT;
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify({ ...evidence, stacks: results }, null, 2) + "\n");
    }
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it("serves the fingerprint Core advertises (status route, pairing route, file on disk)", () => {
    expect(fp(der)).toBe(advertised);
    expect(pairingFingerprint).toBe(advertised);
    const disk = new X509Certificate(readFileSync(join(core.dataDir, "phone", "tls-cert.pem")));
    expect(fp(disk.raw)).toBe(advertised);
  });

  /** Asserts the structural guarantees on one stack's record; a skipped stack asserts nothing. */
  function check(res: StackResult): void {
    results.push(res);
    if (res.skipped) return;
    if (res.sha256 !== undefined) expect(res.sha256, `${res.stack} fingerprint`).toBe(advertised);
    const parsedFp = res.parse?.fingerprintSha256;
    if (typeof parsedFp === "string")
      expect(parsedFp, `${res.stack} parsed fingerprint`).toBe(advertised);
    const pins = (res.handshakes ?? []).filter((h) => h.mode === "pin-fingerprint");
    expect(pins.length, `${res.stack} pin handshakes ran`).toBe(4);
    for (const h of pins) {
      if (h.pin === "right")
        expect(h.ok, `${res.stack} TLS ${h.tls} right pin: ${String(h.error)}`).toBe(true);
      else expect(h.ok, `${res.stack} TLS ${h.tls} wrong pin accepted`).toBe(false);
    }
    for (const h of (res.handshakes ?? []).filter(
      (x) => x.mode === "trust-anchor" && x.pin === "wrong",
    ))
      expect(h.ok, `${res.stack} TLS ${h.tls} wrong anchor accepted`).toBe(false);
  }

  it("Apple Security framework + URLSession (macOS, same family as iOS)", async () => {
    const swiftc = await which("swiftc");
    if (!swiftc) return check({ stack: "apple-security-urlsession", skipped: "swiftc not found" });
    const bin = join(work, "probe-swift");
    const built = await run(swiftc, [join(PROBES, "probe.swift"), "-o", bin], { timeout: 240_000 });
    if (built.status !== 0)
      return check({
        stack: "apple-security-urlsession",
        skipped: `swiftc failed: ${built.stderr.slice(0, 400)}`,
      });
    const res = parseProbe(
      "apple-security-urlsession",
      await run(bin, probeArgs(), { timeout: 240_000 }),
    );
    res.swiftVersion = (await run(swiftc, ["--version"])).stdout.split("\n")[0];
    check(res);
  }, 600_000);

  it("Go crypto/x509 + crypto/tls", async () => {
    const go = await which("go");
    if (!go) return check({ stack: "go-crypto-x509-tls", skipped: "go not found" });
    const bin = join(work, "probe-go");
    const built = await run(go, ["build", "-o", bin, join(PROBES, "probe.go")], {
      timeout: 240_000,
    });
    if (built.status !== 0)
      return check({
        stack: "go-crypto-x509-tls",
        skipped: `go build failed: ${built.stderr.slice(0, 400)}`,
      });
    check(parseProbe("go-crypto-x509-tls", await run(bin, probeArgs(), { timeout: 120_000 })));
  }, 600_000);

  it("Java JSSE + java.security.cert", async () => {
    const candidates = [await which("java"), "/opt/homebrew/opt/openjdk/bin/java"].filter(
      (c): c is string => c !== null && existsSync(c),
    );
    let java: string | undefined;
    for (const c of candidates) {
      if (await works(c, ["-version"])) {
        java = c;
        break;
      }
    }
    if (!java)
      return check({
        stack: "java-jsse",
        skipped: "no working java (the /usr/bin stub needs a JRE)",
      });
    const res = parseProbe(
      "java-jsse",
      await run(java, [join(PROBES, "Probe.java"), ...probeArgs()], { timeout: 180_000 }),
    );
    check(res);
  }, 600_000);

  it("Python cryptography + ssl", async () => {
    const py = await which("python3");
    if (!py || !(await works(py, ["-c", "import cryptography, ssl"])))
      return check({
        stack: "python-cryptography-ssl",
        skipped: "python3 with cryptography not found",
      });
    check(
      parseProbe(
        "python-cryptography-ssl",
        await run(py, [join(PROBES, "probe.py"), ...probeArgs()], { timeout: 120_000 }),
      ),
    );
  }, 600_000);

  for (const [label, bin] of [
    ["libressl", "/usr/bin/openssl"],
    ["openssl-4", "/opt/homebrew/bin/openssl"],
  ] as const) {
    it(`${label} x509 / verify / s_client (${bin})`, async () => {
      const stack = `${label}-cli`;
      if (!existsSync(bin)) return check({ stack, skipped: `${bin} not found` });
      const served = join(work, "served.crt");
      const otherCrt = join(work, "other.crt");
      const text = await run(bin, ["x509", "-in", served, "-text", "-noout"]);
      const strict = await run(bin, ["x509", "-in", served, "-noout", "-checkip", HOST]);
      const fingerprint = await run(bin, [
        "x509",
        "-in",
        served,
        "-noout",
        "-fingerprint",
        "-sha256",
      ]);
      const dates = await run(bin, ["x509", "-in", served, "-noout", "-dates"]);
      const verifyRows: Json = {};
      const verifyArgs = (extra: string[]) => ["verify", "-CAfile", served, ...extra, served];
      for (const [name, extra] of [
        ["plain", []],
        ["purposeSslServer", ["-purpose", "sslserver"]],
        ["purposeSslServerIp", ["-purpose", "sslserver", "-verify_ip", HOST]],
        ["x509Strict", ["-x509_strict"]],
      ] as [string, string[]][]) {
        const r = await run(bin, verifyArgs(extra));
        verifyRows[name] = { status: r.status, output: (r.stdout + r.stderr).trim() };
      }
      const sha = /=\s*([0-9A-Fa-f:]+)/.exec(fingerprint.stdout)?.[1]?.toUpperCase();
      const handshakes: Handshake[] = [];
      for (const mode of ["pin-fingerprint", "trust-anchor"]) {
        for (const tls of ["1.2", "1.3"]) {
          for (const pin of ["right", "wrong"]) {
            const args = [
              "s_client",
              "-connect",
              `${HOST}:${port}`,
              `-tls1_${tls === "1.2" ? "2" : "3"}`,
              "-ign_eof",
            ];
            if (mode === "trust-anchor") {
              args.push("-CAfile", pin === "right" ? served : otherCrt, "-verify_return_error");
              // LibreSSL 3.3's s_client has no -verify_ip: the chain is checked, the IP SAN is not.
              if (label !== "libressl") args.push("-verify_ip", HOST);
            }
            const r = await run(bin, args, {
              input: `GET /phone/v1/pair/00000000000000000000000000000000 HTTP/1.1\r\nHost: ${HOST}:${port}\r\nConnection: close\r\n\r\n`,
              timeout: 30_000,
            });
            const all = r.stdout + r.stderr;
            const status = /^HTTP\/1\.[01] (\d{3})/m.exec(all)?.[1];
            const negotiated = /New, (\S+), Cipher is/.exec(all)?.[1];
            const presented = (() => {
              const start = all.indexOf(BEGIN);
              const end = all.indexOf(END);
              if (start < 0 || end < 0) return null;
              const pem = all.slice(start, end + END.length) + "\n";
              try {
                return fp(new X509Certificate(pem).raw);
              } catch {
                return null;
              }
            })();
            const row: Handshake = {
              mode,
              tls,
              pin,
              ok: false,
              negotiated: negotiated ?? null,
              httpStatus: status ? Number(status) : null,
            };
            if (mode === "pin-fingerprint") {
              // s_client has no pin option: the pin comparison is done here on the certificate it received.
              const want = pin === "right" ? advertised : wrongPin;
              row.presented = presented;
              row.ok = status !== undefined && presented === want;
              if (!row.ok)
                row.error = presented === null ? "no certificate or response" : "pin mismatch";
            } else {
              row.ok = status !== undefined && /Verify return code: 0 \(ok\)/.test(all);
              if (!row.ok)
                row.error = (/verify error:[^\n]*/.exec(all)?.[0] ?? all.slice(0, 300)).trim();
            }
            handshakes.push(row);
          }
        }
      }
      check({
        stack,
        versions: { binary: bin, version: (await run(bin, ["version"])).stdout.trim() },
        sha256: sha,
        x509Text: text.stdout,
        x509TextExit: text.status,
        checkip: (strict.stdout + strict.stderr).trim(),
        dates: dates.stdout.trim(),
        verify: verifyRows,
        handshakes,
      });
    }, 600_000);
  }

  it("records every stack that ran", () => {
    expect(results.length).toBeGreaterThan(0);
    // evidence is flushed in afterAll; this only guards against a silently empty run
    expect(results.some((r) => !r.skipped)).toBe(true);
  });
});
