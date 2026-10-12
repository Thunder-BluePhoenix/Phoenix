// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

export type SyncClass = "preference" | "context" | "project_profile";
export interface SyncItem {
  id: string;
  owner: string;
  scope: string;
  project: string | null;
  data_class: SyncClass;
  value: unknown;
  revision: string;
  updated_at: string;
  deleted: boolean;
}
export interface Envelope {
  version: 1;
  namespace: string;
  id: string;
  revision: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}
export interface RelayEntry {
  envelope: Envelope;
  generation: string;
}
/** Implementations MUST atomically compare generation; null means an absent entry. */
export interface SyncTransport {
  list(namespace: string): Promise<RelayEntry[]>;
  put(
    namespace: string,
    entry: Envelope,
    expectedGeneration: string | null,
  ): Promise<"stored" | "conflict">;
}

const b64 = (bytes: Buffer) => bytes.toString("base64url");
const from64 = (text: string, bytes: number) => {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error("Invalid sync key or envelope encoding");
  const decoded = Buffer.from(text, "base64url");
  if (decoded.length !== bytes || b64(decoded) !== text)
    throw new Error("Invalid sync key or envelope length");
  return decoded;
};
export const newRecoveryKey = () => b64(randomBytes(32));
/** Account recovery credential, shared out-of-band across devices. This is NOT device authentication:
 * a relay accepting the same bearer token cannot revoke one device or prevent replay of old ciphertext.
 * Keep the key only in OS secret storage; do not claim device revocation without a relay-enforced roster. */
export function identity(recoveryKey: string): string {
  return b64(
    createHash("sha256")
      .update("phoenix-sync-identity-v1\0")
      .update(from64(recoveryKey, 32))
      .digest(),
  );
}
const aad = (e: Pick<Envelope, "namespace" | "id" | "revision">) =>
  Buffer.from(JSON.stringify([1, e.namespace, e.id, e.revision]));
export function seal(key: string, namespace: string, item: SyncItem): Envelope {
  const nonce = randomBytes(12);
  const envelope = {
    version: 1 as const,
    namespace,
    id: sealId(key, namespace, item),
    revision: item.revision,
  };
  const cipher = createCipheriv("aes-256-gcm", from64(key, 32), nonce);
  cipher.setAAD(aad(envelope));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(item), "utf8"), cipher.final()]);
  return {
    ...envelope,
    nonce: b64(nonce),
    ciphertext: b64(ciphertext),
    tag: b64(cipher.getAuthTag()),
  };
}
export function open(key: string, namespace: string, envelope: Envelope): SyncItem {
  if (
    envelope.version !== 1 ||
    envelope.namespace !== namespace ||
    typeof envelope.id !== "string" ||
    typeof envelope.revision !== "string" ||
    typeof envelope.ciphertext !== "string" ||
    envelope.ciphertext.length > 350_000
  )
    throw new Error("Invalid sync envelope");
  const cipher = createDecipheriv("aes-256-gcm", from64(key, 32), from64(envelope.nonce, 12));
  cipher.setAAD(aad(envelope));
  cipher.setAuthTag(from64(envelope.tag, 16));
  const plaintext = Buffer.concat([
    cipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    cipher.final(),
  ]);
  const item = JSON.parse(plaintext.toString("utf8")) as SyncItem;
  if (
    !item ||
    typeof item.id !== "string" ||
    typeof item.owner !== "string" ||
    typeof item.scope !== "string" ||
    typeof item.revision !== "string" ||
    item.revision !== envelope.revision ||
    !["preference", "context", "project_profile"].includes(item.data_class) ||
    typeof item.deleted !== "boolean" ||
    (item.project !== null && typeof item.project !== "string")
  )
    throw new Error("Invalid decrypted sync item");
  const expected = sealId(key, namespace, item);
  if (expected !== envelope.id) throw new Error("Sync item identity mismatch");
  return item;
}
function sealId(key: string, namespace: string, item: SyncItem): string {
  return b64(
    createHmac("sha256", from64(key, 32))
      .update(JSON.stringify([namespace, item.owner, item.scope, item.id]))
      .digest(),
  );
}

/** HTTPS relay wire contract: GET /v1/namespaces/:namespace/items returns {items:[{envelope,generation}]}; PUT /v1/namespaces/:namespace/items/:id sends {envelope,expected_generation}, 409 means CAS conflict. Bearer token authenticates the namespace. TLS is mandatory. */
export class HttpsSyncTransport implements SyncTransport {
  private readonly base: URL;
  constructor(
    endpoint: string,
    private readonly bearer: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.base = new URL(endpoint);
    if (
      this.base.protocol !== "https:" ||
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      !bearer
    )
      throw new Error("Sync relay requires HTTPS and bearer authentication");
  }
  private url(namespace: string, id?: string): URL {
    const base = new URL(this.base);
    base.pathname = `${base.pathname.replace(/\/$/, "")}/v1/namespaces/${encodeURIComponent(namespace)}/items${id ? `/${encodeURIComponent(id)}` : ""}`;
    return base;
  }
  private async request(url: URL, method: string, body?: unknown): Promise<Response> {
    const response = await this.fetcher(url, {
      method,
      headers: {
        authorization: `Bearer ${this.bearer}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    return response;
  }
  async list(namespace: string): Promise<RelayEntry[]> {
    const r = await this.request(this.url(namespace), "GET");
    if (!r.ok) throw new Error(`Sync relay list failed (${r.status})`);
    const maxBytes = 4 * 1024 * 1024;
    if (!r.body) throw new Error("Sync relay response has no body");
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new Error("Sync relay response exceeds 4 MiB");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const payload = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as {
      items?: unknown;
    };
    if (
      !Array.isArray(payload?.items) ||
      payload.items.length > 10_000 ||
      payload.items.some(
        (e: RelayEntry) =>
          !e ||
          typeof e.generation !== "string" ||
          !e.envelope ||
          e.envelope.namespace !== namespace,
      )
    )
      throw new Error("Invalid sync relay response");
    return payload.items as RelayEntry[];
  }
  async put(
    namespace: string,
    entry: Envelope,
    expectedGeneration: string | null,
  ): Promise<"stored" | "conflict"> {
    const r = await this.request(this.url(namespace, entry.id), "PUT", {
      envelope: entry,
      expected_generation: expectedGeneration,
    });
    if (r.status === 409) return "conflict";
    if (!r.ok) throw new Error(`Sync relay write failed (${r.status})`);
    return "stored";
  }
}
