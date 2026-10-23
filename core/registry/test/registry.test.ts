// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RegistryService, type RegistryEntry, type RegistryIndex } from "../src/index";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const service = new RegistryService(new Map([["testkey", publicKey]]), {
  sdk: "0.1.0",
  core: "0.1.0",
  protocol: "1",
});
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}
function index(): { format_version: 1; entries: RegistryEntry[] } {
  const artifact = Buffer.from("locally trusted bytes, never executed");
  return {
    format_version: 1,
    entries: [
      {
        id: "example",
        version: "1.0.0",
        manifest: {
          id: "example",
          name: "Example",
          version: "1.0.0",
          description: "A local example",
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
}
function signed(value: RegistryIndex): Uint8Array {
  return Buffer.from(
    JSON.stringify({
      index: value,
      key_id: "testkey",
      signature: sign(null, Buffer.from(canonical(value)), privateKey).toString("base64url"),
    }),
  );
}

describe("local signed capability registry", () => {
  it("discloses exact permissions, data categories and refusal before any install", () => {
    const trusted = service.loadIndex(signed(index()));
    const provenance = service.provenance(trusted);
    expect(provenance).toEqual({
      signer_key_id: "testkey",
      signature: JSON.parse(Buffer.from(signed(index())).toString()).signature,
      signature_status: "verified",
      index_sha256: createHash("sha256").update(canonical(index())).digest("hex"),
      artifact_verification: "not_verified",
    });
    expect(service.preview(trusted, "example", "1.0.0").provenance).toBe(provenance);
    expect(() => service.provenance(index() as typeof trusted)).toThrowError(
      expect.objectContaining({ code: "UNTRUSTED_INDEX" }),
    );
    const separateService = new RegistryService(new Map([["testkey", publicKey]]), {
      sdk: "0.1.0",
      core: "0.1.0",
      protocol: "1",
    });
    expect(() => separateService.provenance(trusted)).toThrowError(
      expect.objectContaining({ code: "UNTRUSTED_INDEX" }),
    );
    expect(service.preview(trusted, "example", "1.0.0")).toMatchObject({
      permission_descriptions: { network: "Make network connections" },
      data_categories: ["repository_metadata"],
      sandbox_status: "unavailable",
      installable: false,
    });
    expect(() => service.install()).toThrowError(
      expect.objectContaining({ code: "SANDBOX_UNAVAILABLE" }),
    );
    expect(() => service.preview(index() as typeof trusted, "example", "1.0.0")).toThrowError(
      expect.objectContaining({ code: "UNTRUSTED_INDEX" }),
    );
    expect(() => {
      (trusted.entries[0] as RegistryEntry).permissions.push("camera");
    }).toThrow();
  });

  it("accepts only strict CC-BY data-only skin metadata", () => {
    const artifact = Buffer.from(
      '{"format":"phoenix-outfit","version":1,"id":"moon-hat","name":"Moon hat","author":"Phoenix","license":"CC-BY-4.0","layers":[]}',
    );
    const skins: RegistryIndex = {
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
    const trusted = service.loadIndex(signed(skins));
    expect(service.preview(trusted, "moon-hat", "1.0.0")).toMatchObject({
      kind: "skin-pack",
      installable: true,
      entry: { license: "CC-BY-4.0", artifact: { size: artifact.length } },
    });
    (skins.entries[0] as unknown as Record<string, unknown>).permissions = [];
    expect(() => service.loadIndex(signed(skins))).toThrowError(
      expect.objectContaining({ code: "INVALID_INDEX" }),
    );
  });

  it("reads only matching local skin bytes without following links", async () => {
    const artifact = Buffer.from(
      '{"format":"phoenix-outfit","version":1,"id":"moon-hat","name":"Moon hat","author":"Phoenix","license":"CC-BY-4.0","layers":[]}',
    );
    const skins: RegistryIndex = {
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
    const directory = await mkdtemp(join(tmpdir(), "phoenix-skins-"));
    dirs.push(directory);
    const trusted = service.loadIndex(signed(skins));
    const file = join(directory, "moon-hat.json");
    await writeFile(file, artifact);
    await expect(
      service.readLocalSkinArtifact(trusted, "moon-hat", "1.0.0", directory),
    ).resolves.toEqual(artifact);
    await writeFile(file, Buffer.concat([artifact, Buffer.from(" ")]));
    await expect(
      service.readLocalSkinArtifact(trusted, "moon-hat", "1.0.0", directory),
    ).rejects.toMatchObject({ code: "ARTIFACT_MISMATCH" });
    const sameSizeTamper = Buffer.from(artifact);
    sameSizeTamper[0] = "[".charCodeAt(0);
    await writeFile(file, sameSizeTamper);
    await expect(
      service.readLocalSkinArtifact(trusted, "moon-hat", "1.0.0", directory),
    ).rejects.toMatchObject({ code: "ARTIFACT_MISMATCH" });
  });

  it.each([
    [
      "path traversal",
      (value: RegistryIndex) => {
        (value.entries[0] as RegistryEntry).artifact.file = "../malicious.mjs";
      },
      "INVALID_INDEX",
    ],
    [
      "hostile metadata",
      (value: RegistryIndex) => {
        (value.entries[0]! as unknown as Record<string, unknown>).script = "process.exit(1)";
      },
      "INVALID_INDEX",
    ],
    [
      "prototype metadata",
      (value: RegistryIndex) => {
        Object.defineProperty((value.entries[0] as RegistryEntry).manifest, "__proto__", {
          value: { polluted: true },
          enumerable: true,
        });
      },
      "INVALID_INDEX",
    ],
    [
      "permission mismatch",
      (value: RegistryIndex) => {
        (value.entries[0] as RegistryEntry).permissions = [];
      },
      "PERMISSION_MISMATCH",
    ],
    [
      "data-category mismatch",
      (value: RegistryIndex) => {
        (value.entries[0] as RegistryEntry).data_categories = [];
      },
      "PERMISSION_MISMATCH",
    ],
    [
      "forbidden licence",
      (value: RegistryIndex) => {
        (value.entries[0] as RegistryEntry).license = (
          value.entries[0] as RegistryEntry
        ).manifest.license = "Proprietary";
      },
      "FORBIDDEN_LICENSE",
    ],
    [
      "incompatible SDK",
      (value: RegistryIndex) => {
        (value.entries[0] as RegistryEntry).compatibility.sdk = "0.2.0";
      },
      "INCOMPATIBLE_VERSION",
    ],
    [
      "incompatible protocol",
      (value: RegistryIndex) => {
        Object.assign((value.entries[0] as RegistryEntry).compatibility, { protocol: "2" });
      },
      "INCOMPATIBLE_VERSION",
    ],
    [
      "incompatible Core",
      (value: RegistryIndex) => {
        (value.entries[0] as RegistryEntry).compatibility.core = "0.2.0";
      },
      "INCOMPATIBLE_VERSION",
    ],
  ] as const)("rejects signed %s", (_name, mutate, code) => {
    const value = index();
    mutate(value);
    expect(() => service.loadIndex(signed(value))).toThrowError(expect.objectContaining({ code }));
  });

  it("rejects corrupt, tampered, unknown signer, and unsupported index versions", () => {
    expect(() => service.loadIndex(Buffer.from("{"))).toThrowError(
      expect.objectContaining({ code: "INVALID_INDEX" }),
    );
    const envelope = JSON.parse(Buffer.from(signed(index())).toString());
    envelope.index.entries[0].permissions = [];
    expect(() => service.loadIndex(Buffer.from(JSON.stringify(envelope)))).toThrowError(
      expect.objectContaining({ code: "INVALID_SIGNATURE" }),
    );
    envelope.key_id = "other";
    expect(() => service.loadIndex(Buffer.from(JSON.stringify(envelope)))).toThrowError(
      expect.objectContaining({ code: "UNTRUSTED_KEY" }),
    );
    const trustedSignerTamper = JSON.parse(Buffer.from(signed(index())).toString());
    trustedSignerTamper.key_id = "anotherkey";
    const otherService = new RegistryService(
      new Map([
        ["testkey", publicKey],
        ["anotherkey", generateKeyPairSync("ed25519").publicKey],
      ]),
      { sdk: "0.1.0", core: "0.1.0", protocol: "1" },
    );
    expect(() =>
      otherService.loadIndex(Buffer.from(JSON.stringify(trustedSignerTamper))),
    ).toThrowError(expect.objectContaining({ code: "INVALID_SIGNATURE" }));
    const unsupported = index() as unknown as {
      format_version: number;
      entries: RegistryIndex["entries"];
    };
    unsupported.format_version = 2;
    expect(() => service.loadIndex(signed(unsupported as RegistryIndex))).toThrowError(
      expect.objectContaining({ code: "INVALID_INDEX" }),
    );
  });

  it("verifies local signed artifact digest without running it; rejects mismatch and symlink", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phoenix-registry-"));
    dirs.push(directory);
    const trusted = service.loadIndex(signed(index()));
    const file = join(directory, "example.tar");
    await writeFile(file, "locally trusted bytes, never executed");
    await expect(
      service.verifyLocalArtifact(trusted, "example", "1.0.0", directory),
    ).resolves.toBeUndefined();
    await writeFile(file, "locally trusted bytes, never executeD");
    await expect(
      service.verifyLocalArtifact(trusted, "example", "1.0.0", directory),
    ).rejects.toMatchObject({ code: "ARTIFACT_MISMATCH" });
    await unlink(file);
    await symlink(join(directory, "elsewhere"), file);
    await expect(
      service.verifyLocalArtifact(trusted, "example", "1.0.0", directory),
    ).rejects.toMatchObject({ code: "ELOOP" });
  });
});
