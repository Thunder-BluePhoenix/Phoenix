// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegistryIndex } from "@phoenix/registry";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

let core: TestCore | undefined;
const directories: string[] = [];
afterEach(async () => {
  await core?.runtime.stop();
  core = undefined;
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}
function signedIndex(): string {
  const artifact = Buffer.from("This is not executable code");
  const index: RegistryIndex = {
    format_version: 1,
    entries: [
      {
        id: "example",
        version: "1.0.0",
        manifest: {
          id: "example",
          name: "Example",
          version: "1.0.0",
          description: "Local metadata",
          license: "MIT",
          events: [],
          commands: [],
          permissions: ["network"],
          data_categories: ["repository_metadata"],
        },
        permissions: ["network"],
        data_categories: ["repository_metadata"],
        license: "MIT",
        compatibility: { sdk: "0.1.0", core: "0.1.0", protocol: "1" },
        artifact: {
          file: "example.tar",
          sha256: createHash("sha256").update(artifact).digest("hex"),
          size: artifact.length,
        },
        security: {
          contact: "mailto:security@example.org",
          advisory_url: "https://example.org/advisories",
        },
      },
    ],
  };
  return JSON.stringify({
    index,
    key_id: "testkey",
    signature: sign(null, Buffer.from(canonical(index)), privateKey).toString("base64url"),
  });
}

function provision(
  index = signedIndex(),
  trust = publicKey.export({ format: "pem", type: "spki" }).toString(),
) {
  // Files are created before constructing Core; only the host supplies their paths.
  const dir = mkdtempSync(join(tmpdir(), "phoenix-registry-api-"));
  directories.push(dir);
  const trustedKeyFile = join(dir, "registry-key.json");
  const indexFile = join(dir, "registry-index.json");
  writeFileSync(trustedKeyFile, JSON.stringify({ key_id: "testkey", public_key: trust }));
  writeFileSync(indexFile, index);
  return { trustedKeyFile, indexFile };
}

describe("real Core local registry API", () => {
  it("shows the no-trust state and refuses preview/install by default", async () => {
    core = await startCore();
    const { api } = core;
    expect((await api("GET", "/api/registry")).json).toEqual({
      configured: false,
      sandbox_status: "unavailable",
      entries: [],
    });
    expect((await api("GET", "/api/registry/example/1.0.0")).status).toBe(503);
    expect((await api("POST", "/api/registry/example/1.0.0/install")).status).toBe(403);
  });

  it("authenticates browse and preview, discloses only verified local metadata, never installs", async () => {
    const files = provision();
    core = await startCore({}, { runtime: { registry: files } });
    const { api, runtime } = core;
    expect((await api("GET", "/api/registry", undefined, { authorization: "" })).status).toBe(401);
    expect(
      (
        await api("GET", "/api/registry/example/1.0.0", undefined, {
          authorization: "Bearer wrong",
        })
      ).status,
    ).toBe(401);
    expect(
      (await api("POST", "/api/registry/example/1.0.0/install", undefined, { authorization: "" }))
        .status,
    ).toBe(401);
    const browse = await api("GET", "/api/registry");
    expect(browse.status).toBe(200);
    expect(browse.json).toMatchObject({
      configured: true,
      sandbox_status: "unavailable",
      entries: [{ id: "example", version: "1.0.0", installable: false }],
    });
    const preview = await api("GET", "/api/registry/example/1.0.0");
    expect(preview.status).toBe(200);
    expect(preview.json).toMatchObject({
      entry: { id: "example", artifact: { file: "example.tar" } },
      permission_descriptions: { network: "Make network connections" },
      data_categories: ["repository_metadata"],
      sandbox_status: "unavailable",
      installable: false,
    });
    expect((await api("GET", "/api/registry/example/2.0.0")).status).toBe(404);
    expect((await api("POST", "/api/registry/example/1.0.0/install")).status).toBe(403);
    expect(runtime.capabilities.list()).toEqual([]);
    expect(
      (await api("GET", "/api/registry?indexFile=/tmp/other.json&trustedKeyFile=/tmp/other.pem"))
        .json,
    ).toEqual(browse.json);
  });

  it("fails closed on tampered, corrupt, untrusted index or missing key", async () => {
    const files = provision();
    const original = signedIndex();
    const tampered = JSON.parse(original);
    tampered.index.entries[0].manifest.description = "changed";
    writeFileSync(files.indexFile, JSON.stringify(tampered));
    core = await startCore({}, { runtime: { registry: files } });
    expect((await core.api("GET", "/api/registry")).status).toBe(403);
    await core.runtime.stop();
    core = undefined;
    tampered.key_id = "unknown";
    writeFileSync(files.indexFile, JSON.stringify(tampered));
    core = await startCore({}, { runtime: { registry: files } });
    expect((await core.api("GET", "/api/registry/example/1.0.0")).status).toBe(403);
    await core.runtime.stop();
    core = undefined;
    writeFileSync(files.indexFile, original);
    core = await startCore(
      {},
      { runtime: { registry: { ...files, trustedKeyFile: `${files.trustedKeyFile}.missing` } } },
    );
    expect((await core.api("GET", "/api/registry")).status).toBe(503);
    await core.runtime.stop();
    core = undefined;
    writeFileSync(files.trustedKeyFile, "not JSON");
    core = await startCore({}, { runtime: { registry: files } });
    expect((await core.api("GET", "/api/registry")).status).toBe(503);
    await core.runtime.stop();
    core = undefined;
    writeFileSync(
      files.trustedKeyFile,
      JSON.stringify({
        key_id: "testkey",
        public_key: publicKey.export({ format: "pem", type: "spki" }).toString(),
      }),
    );
    writeFileSync(files.indexFile, "{corrupt");
    core = await startCore({}, { runtime: { registry: files } });
    expect((await core.api("GET", "/api/registry")).status).toBe(403);
  });
});
