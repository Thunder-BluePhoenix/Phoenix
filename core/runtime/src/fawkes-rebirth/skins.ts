// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash } from "node:crypto";

/** Data-only skin format: the existing validated phoenix-outfit v1 schema. */
export interface SkinPack {
  format: "phoenix-outfit";
  version: 1;
  id: string;
  name: string;
  author: string;
  license: string;
  layers: { slot: string; svg: string; still?: string; animation?: string }[];
}

/** From a cryptographically verified registry index/preview, not self-asserted by the pack. */
export interface VerifiedSkinEntry {
  id: string;
  version: string;
  license: string;
  artifact: { sha256: string; size: number };
  provenance: { signature_status: "verified"; signer_key_id: string; index_sha256: string };
}

export interface SkinInstaller<T extends SkinPack> {
  /** RegistryService.preview over a verified, trusted local index. */
  preview(id: string, version: string): Promise<VerifiedSkinEntry>;
  /** Permission-gated, audited, host-supplied artifact retrieval; never an arbitrary URL from the pack. */
  fetch(entry: VerifiedSkinEntry): Promise<Uint8Array>;
  /** Existing validateOutfitPack; rejects unknown SVG/markup, unsafe fields and oversized packs. */
  validate(input: unknown): T;
  /** Existing Core outfit import route/store; responsible for user consent and persistence. */
  install(pack: T): Promise<void>;
}

/**
 * Verified registry-to-wardrobe bridge. No executable registry install and no remote fetch in this
 * module. Host must show `license` and provenance before calling this function after explicit consent.
 */
export async function installSkin<T extends SkinPack>(
  id: string,
  version: string,
  expectedLicense: string,
  host: SkinInstaller<T>,
): Promise<T> {
  const entry = await host.preview(id, version);
  if (
    entry.id !== id ||
    entry.version !== version ||
    entry.provenance.signature_status !== "verified" ||
    !entry.provenance.signer_key_id ||
    !/^[0-9a-f]{64}$/i.test(entry.provenance.index_sha256) ||
    !entry.license ||
    entry.license !== expectedLicense ||
    !/^[0-9a-f]{64}$/i.test(entry.artifact.sha256) ||
    !Number.isSafeInteger(entry.artifact.size) ||
    entry.artifact.size < 1 ||
    entry.artifact.size > 100_000
  ) {
    throw new Error("Skin registry provenance or licence does not match consent");
  }
  const bytes = await host.fetch(entry);
  if (
    bytes.byteLength !== entry.artifact.size ||
    createHash("sha256").update(bytes).digest("hex") !== entry.artifact.sha256.toLowerCase()
  ) {
    throw new Error("Skin artifact verification failed");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Skin artifact is not UTF-8 JSON");
  }
  const pack = host.validate(raw);
  if (
    pack.id !== id ||
    pack.license !== entry.license ||
    pack.format !== "phoenix-outfit" ||
    pack.version !== 1
  ) {
    throw new Error("Skin identity or licence does not match verified registry entry");
  }
  await host.install(pack);
  return pack;
}
