// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegistryIndex } from "@phoenix/registry";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function signedSkinIndex(): { index: RegistryIndex; envelope: string; artifact: Buffer } {
  const artifact = Buffer.from(
    JSON.stringify({
      format: "phoenix-outfit",
      version: 1,
      id: "moon-hat",
      name: "Moon hat",
      author: "Phoenix",
      license: "CC-BY-4.0",
      layers: [{ slot: "head", svg: '<circle cx="30" cy="20" r="4" fill="#ff0000"/>' }],
    }),
  );
  const index: RegistryIndex = {
    format_version: 1,
    entries: [
      {
        kind: "skin-pack",
        id: "moon-hat",
        version: "1.0.0",
        name: "Moon hat",
        description: "A data-only outfit.",
        license: "CC-BY-4.0",
        compatibility: { core: "0.1.0", protocol: "1" },
        artifact: {
          file: "moon-hat.json",
          sha256: createHash("sha256").update(artifact).digest("hex"),
          size: artifact.length,
        },
      },
    ],
  };
  return {
    index,
    artifact,
    envelope: JSON.stringify({
      index,
      key_id: "testkey",
      signature: sign(null, Buffer.from(canonical(index)), privateKey).toString("base64url"),
    }),
  };
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
  const artifactDirectory = join(dir, "artifacts");
  mkdirSync(artifactDirectory);
  writeFileSync(trustedKeyFile, JSON.stringify({ key_id: "testkey", public_key: trust }));
  writeFileSync(indexFile, index);
  return { trustedKeyFile, indexFile, artifactDirectory };
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
    const envelope = JSON.parse(signedIndex());
    const expectedProvenance = {
      signer_key_id: "testkey",
      signature: envelope.signature,
      signature_status: "verified",
      index_sha256: createHash("sha256").update(canonical(envelope.index)).digest("hex"),
      artifact_verification: "not_verified",
    };
    const browse = await api("GET", "/api/registry");
    expect(browse.status).toBe(200);
    expect(browse.json).toMatchObject({
      configured: true,
      provenance: expectedProvenance,
      sandbox_status: "unavailable",
      entries: [{ id: "example", version: "1.0.0", installable: false }],
    });
    const preview = await api("GET", "/api/registry/example/1.0.0");
    expect(preview.status).toBe(200);
    expect(preview.json).toMatchObject({
      provenance: expectedProvenance,
      entry: { id: "example", artifact: { file: "example.tar" } },
      permission_descriptions: { network: "Make network connections" },
      data_categories: ["repository_metadata"],
      sandbox_status: "unavailable",
      installable: false,
    });
    expect((await api("GET", "/api/registry/example/2.0.0")).status).toBe(404);
    expect((await api("POST", "/api/registry/example/1.0.0/install")).status).toBe(403);
    expect(runtime.capabilities.list().filter((c) => c.id === "example")).toEqual([]);
    expect(
      (await api("GET", "/api/registry?indexFile=/tmp/other.json&trustedKeyFile=/tmp/other.pem"))
        .json,
    ).toEqual(browse.json);
    expect(
      (await api("GET", "/api/registry?signer_key_id=attacker&signature_status=verified")).json,
    ).toEqual(browse.json);
  });

  it("installs only the selected signed data-only skin after permission confirmation", async () => {
    const skin = signedSkinIndex();
    const files = provision(skin.envelope);
    writeFileSync(join(files.artifactDirectory, "moon-hat.json"), skin.artifact);
    core = await startCore({}, { runtime: { registry: files } });
    const { api, runtime } = core;
    expect((await api("GET", "/api/registry")).json.entries).toEqual([
      expect.objectContaining({ kind: "skin-pack", id: "moon-hat", installable: true }),
    ]);
    expect((await api("POST", "/api/registry/moon-hat/1.0.0/install")).status).toBe(403);
    runtime.permissions.grant("registry-skins", []);
    const request = api("POST", "/api/registry/skins/moon-hat/1.0.0/install");
    await vi.waitFor(() => expect(runtime.permissions.pendingConfirmations()).toHaveLength(1));
    const confirmation = runtime.permissions.pendingConfirmations()[0]!;
    expect(confirmation).toMatchObject({
      capabilityId: "registry-skins",
      command: "skin.install",
      sideEffect: "write",
      summary: "Install skin moon-hat 1.0.0 (CC-BY-4.0)",
    });
    runtime.permissions.resolveConfirmation(confirmation.id, true);
    expect((await request).status).toBe(200);
    expect((await api("GET", "/api/fawkes/appearance")).json.packs).toEqual([
      expect.objectContaining({ id: "moon-hat", license: "CC-BY-4.0" }),
    ]);
  });

  it("fails closed before a skin fetch when the kill switch is engaged", async () => {
    const skin = signedSkinIndex();
    const files = provision(skin.envelope);
    writeFileSync(join(files.artifactDirectory, "moon-hat.json"), skin.artifact);
    core = await startCore({}, { runtime: { registry: files } });
    core.runtime.permissions.engageKillSwitch();
    expect((await core.api("POST", "/api/registry/skins/moon-hat/1.0.0/install")).status).toBe(403);
    expect(core.runtime.permissions.pendingConfirmations()).toEqual([]);
    expect((await core.api("GET", "/api/fawkes/appearance")).json.packs).toEqual([]);
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
