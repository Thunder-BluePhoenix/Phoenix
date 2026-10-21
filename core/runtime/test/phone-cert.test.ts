// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { execFileSync } from "node:child_process";
import { createPrivateKey, generateKeyPairSync, X509Certificate } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { createServer, connect as tlsConnect } from "node:tls";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSelfSignedCertificate,
  CERT_RENEW_BEFORE_DAYS,
  ensureTlsIdentity,
} from "../src/phone-cert";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "zz-phone-cert-"));
  dirs.push(dir);
  return dir;
};

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const DAY = 86_400_000;
const keys = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" });

describe("self-signed certificate builder", () => {
  it("makes a certificate Node parses, verifies and binds to the key and the address", () => {
    const { privateKey, publicKey } = keys();
    const pem = buildSelfSignedCertificate({
      privateKey,
      address: "192.168.1.23",
      notBefore: new Date(NOW),
      notAfter: new Date(NOW + 90 * DAY),
    });
    const cert = new X509Certificate(pem);
    expect(cert.verify(publicKey)).toBe(true); // the signature is valid over the TBS bytes
    expect(cert.checkPrivateKey(privateKey)).toBe(true);
    expect(cert.checkIP("192.168.1.23")).toBe("192.168.1.23");
    expect(cert.checkIP("192.168.1.24")).toBeUndefined();
    expect(cert.subjectAltName).toBe("IP Address:192.168.1.23");
    expect(cert.ca).toBe(false);
    expect(Date.parse(cert.validFrom)).toBe(NOW);
    expect(Date.parse(cert.validTo)).toBe(NOW + 90 * DAY);
    expect(cert.fingerprint256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it("rejects a signature made by another key", () => {
    const a = keys();
    const b = keys();
    const cert = new X509Certificate(
      buildSelfSignedCertificate({
        privateKey: a.privateKey,
        address: "10.0.0.5",
        notBefore: new Date(NOW),
        notAfter: new Date(NOW + DAY),
      }),
    );
    expect(cert.verify(b.publicKey)).toBe(false);
  });

  it("writes dates from 2050 as GeneralizedTime and refuses an inverted validity", () => {
    const { privateKey } = keys();
    const far = Date.UTC(2051, 0, 2, 3, 4, 5);
    const cert = new X509Certificate(
      buildSelfSignedCertificate({
        privateKey,
        address: "10.0.0.5",
        notBefore: new Date(NOW),
        notAfter: new Date(far),
      }),
    );
    expect(Date.parse(cert.validTo)).toBe(far);
    expect(() =>
      buildSelfSignedCertificate({
        privateKey,
        address: "10.0.0.5",
        notBefore: new Date(NOW),
        notAfter: new Date(NOW - 1),
      }),
    ).toThrow(/after/);
  });

  it("refuses a key that is not P-256 and an address that is not dotted IPv4", () => {
    const opts = { address: "10.0.0.5", notBefore: new Date(NOW), notAfter: new Date(NOW + DAY) };
    {
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
      expect(() => buildSelfSignedCertificate({ ...opts, privateKey })).toThrow(/P-256/);
    }
    const { privateKey } = keys();
    for (const bad of ["10.0.0", "10.0.0.256", "10.0.0.5.1", "::1", "host.local", "010.0.0.5", ""])
      expect(
        () => buildSelfSignedCertificate({ ...opts, privateKey, address: bad }),
        bad,
      ).toThrow();
  });

  it("serves a real TLS handshake whose peer fingerprint equals the certificate fingerprint", async () => {
    const { privateKey } = keys();
    const pem = buildSelfSignedCertificate({
      privateKey,
      address: "127.0.0.1",
      notBefore: new Date(Date.now() - 60_000),
      notAfter: new Date(Date.now() + DAY),
    });
    const fingerprint = new X509Certificate(pem).fingerprint256;
    const server = createServer({
      key: privateKey.export({ type: "pkcs8", format: "pem" }),
      cert: pem,
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    // Trusting exactly this certificate, with hostname/IP verification on, proves the SAN works too.
    const socket = tlsConnect({ host: "127.0.0.1", port, ca: pem });
    await once(socket, "secureConnect");
    expect(socket.authorized).toBe(true);
    expect(socket.getPeerCertificate().fingerprint256).toBe(fingerprint);
    socket.destroy();
    server.close();
  });

  it("is accepted by openssl when it is installed", () => {
    const { privateKey } = keys();
    const pem = buildSelfSignedCertificate({
      privateKey,
      address: "192.168.7.7",
      notBefore: new Date(NOW),
      notAfter: new Date(NOW + 90 * DAY),
    });
    const dir = tmp();
    const file = join(dir, "c.pem");
    writeFileSync(file, pem);
    let out: string;
    try {
      out = execFileSync("openssl", ["x509", "-in", file, "-noout", "-text"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // no openssl here: skip
      throw err;
    }
    expect(out).toContain("ecdsa-with-SHA256");
    expect(out).toContain("IP Address:192.168.7.7");
    expect(out).toContain("CA:FALSE");
    expect(out).toContain("Digital Signature");
    expect(out).toMatch(/TLS Web Server Authentication/);
    const verify = execFileSync("openssl", ["verify", "-CAfile", file, file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    // A self-signed non-CA leaf pinned as its own anchor verifies (or reports the CA:FALSE leaf OK).
    expect(verify).toContain("OK");
  });
});

describe("persisted TLS identity", () => {
  it("keeps the fingerprint across restarts and keeps the key private to the owner", () => {
    const dir = join(tmp(), "phone");
    const first = ensureTlsIdentity(dir, "192.168.1.9", NOW);
    const second = ensureTlsIdentity(dir, "192.168.1.9", NOW + 5 * DAY);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.fingerprint).toBe(new X509Certificate(first.cert).fingerprint256);
    expect(statSync(join(dir, "tls-key.pem")).mode & 0o077).toBe(0);
  });

  it("issues a new certificate (new fingerprint, same key) for another address", () => {
    const dir = join(tmp(), "phone");
    const first = ensureTlsIdentity(dir, "192.168.1.9", NOW);
    const second = ensureTlsIdentity(dir, "192.168.1.10", NOW);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(new X509Certificate(second.cert).checkIP("192.168.1.10")).toBe("192.168.1.10");
    expect(second.key).toBe(first.key);
  });

  it("renews a certificate close to expiry and replaces an unreadable key", () => {
    const dir = join(tmp(), "phone");
    const first = ensureTlsIdentity(dir, "192.168.1.9", NOW);
    const near = NOW + (90 - CERT_RENEW_BEFORE_DAYS + 1) * DAY;
    const renewed = ensureTlsIdentity(dir, "192.168.1.9", near);
    expect(renewed.fingerprint).not.toBe(first.fingerprint);
    expect(Date.parse(new X509Certificate(renewed.cert).validTo)).toBeGreaterThan(near + 60 * DAY);
    writeFileSync(join(dir, "tls-key.pem"), "not a key");
    const recovered = ensureTlsIdentity(dir, "192.168.1.9", near);
    expect(recovered.key).not.toBe(first.key);
    expect(
      new X509Certificate(recovered.cert).checkPrivateKey(createPrivateKey(recovered.key)),
    ).toBe(true);
  });
});

describe("persisted TLS identity permissions", () => {
  it.skipIf(process.platform === "win32")(
    "tightens a directory and a key file that were left too open",
    () => {
      const dir = join(tmp(), "phone");
      ensureTlsIdentity(dir, "192.168.1.9", NOW);
      chmodSync(dir, 0o755);
      chmodSync(join(dir, "tls-key.pem"), 0o644);
      ensureTlsIdentity(dir, "192.168.1.9", NOW);
      expect(statSync(dir).mode & 0o077).toBe(0);
      expect(statSync(join(dir, "tls-key.pem")).mode & 0o077).toBe(0);
    },
  );
});
