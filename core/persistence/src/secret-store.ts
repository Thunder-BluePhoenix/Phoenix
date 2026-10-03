// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * Abstraction over OS secure storage (ADR-0014). The database only ever stores a
 * reference; the secret value lives here. An OS keychain implementation is added
 * with the first capability that needs credentials (Phase 22).
 */
export interface SecretStore {
  set(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string | undefined>;
  delete(ref: string): Promise<void>;
}

/** Non-persistent store for tests and development. */
export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async set(ref: string, value: string): Promise<void> {
    this.values.set(ref, value);
  }

  async get(ref: string): Promise<string | undefined> {
    return this.values.get(ref);
  }

  async delete(ref: string): Promise<void> {
    this.values.delete(ref);
  }
}
