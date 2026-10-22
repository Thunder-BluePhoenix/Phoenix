// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Core's owner of the Phase 87 relay client. Off by default. Enabling it creates a random route id
// and Core's relay identity; the private key goes to the OS secret store (never settings, never an
// API response), the public key is what a device pins at pairing. While enabled it keeps one
// server-sent-event stream open to the relay and reconnects with a capped backoff. Disabling,
// the emergency stop, a shutdown, or a new route each end the stream and forget the route.
import type { PhoneDeviceApi } from "@phoenix/api";
import type { AuditLog } from "@phoenix/permissions";
import type { DeviceStore, SecretStore, SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { RemoteRelayClient } from "./client";
import { newCoreIdentity } from "./crypto";
import { defaultSleep, keepStreamOpen, relayUrl, type RelaySleep } from "./stream";

export const RELAY_SETTINGS_KEY = "remote-relay.config";
export const RELAY_KEY_SECRET = "remote-relay.core-private-key";

interface RelayConfig {
  enabled: boolean;
  url: string;
  route: string;
  /** Public half of Core's relay identity, shown so a device can pin it. */
  corePublicKey: string;
}

const OFF: RelayConfig = { enabled: false, url: "", route: "", corePublicKey: "" };

export interface RemoteRelayStatus {
  enabled: boolean;
  connected: boolean;
  /** Where Core connects; a route id is an address, not a secret, but it is only shown to the owner. */
  url: string | null;
  route: string | null;
  core_public_key: string | null;
  last_error: string | null;
}

export interface RemoteRelayServiceDeps {
  settings: SettingsStore;
  secrets: SecretStore;
  devices: DeviceStore;
  phone: PhoneDeviceApi;
  audit: Pick<AuditLog, "record">;
  killSwitchEngaged: () => boolean;
  fetcher?: typeof fetch;
  clock?: () => number;
  sleep?: RelaySleep;
}

function parseConfig(value: unknown): RelayConfig {
  if (value === null || typeof value !== "object") return OFF;
  const o = value as Record<string, unknown>;
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    enabled: o.enabled === true,
    url: text(o.url),
    route: text(o.route),
    corePublicKey: text(o.corePublicKey),
  };
}

export class RemoteRelayService {
  private config: RelayConfig;
  private client: RemoteRelayClient | null = null;
  private loop: AbortController | null = null;
  private running: Promise<void> = Promise.resolve();
  private connected = false;
  private lastError: string | null = null;

  constructor(private readonly d: RemoteRelayServiceDeps) {
    this.config = parseConfig(d.settings.get<unknown>(RELAY_SETTINGS_KEY, null));
  }

  status(): RemoteRelayStatus {
    const on = this.config.enabled;
    return {
      enabled: on,
      connected: this.connected,
      url: on ? this.config.url : null,
      route: on ? this.config.route : null,
      core_public_key: on ? this.config.corePublicKey : null,
      last_error: this.lastError,
    };
  }

  /** Resumes a connection the user had enabled; called once at startup. */
  async start(): Promise<void> {
    if (!this.config.enabled) return;
    if (this.d.killSwitchEngaged()) {
      await this.disable("kill_switch");
      return;
    }
    await this.connect();
  }

  async enable(input: unknown): Promise<RemoteRelayStatus> {
    if (this.d.killSwitchEngaged())
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");
    const url = relayUrl(input);
    await this.stopLoop();
    const identity = newCoreIdentity();
    await this.d.secrets.set(RELAY_KEY_SECRET, identity.privateKey);
    this.config = {
      enabled: true,
      url,
      route: RemoteRelayClient.newRoute(),
      corePublicKey: identity.publicKey,
    };
    this.d.settings.set(RELAY_SETTINGS_KEY, this.config);
    this.d.audit.record({
      actor: "user",
      action: "remote_relay.enabled",
      capabilityId: "remote-relay",
      decision: "allowed",
      details: { host: new URL(url).host },
    });
    await this.connect();
    return this.status();
  }

  async disable(by: "user" | "kill_switch" = "user"): Promise<RemoteRelayStatus> {
    await this.stopLoop();
    const was = this.config.enabled;
    this.config = OFF;
    this.d.settings.set(RELAY_SETTINGS_KEY, OFF);
    await this.d.secrets.delete(RELAY_KEY_SECRET);
    this.lastError = null;
    if (was)
      this.d.audit.record({
        actor: by === "user" ? "user" : "kill-switch",
        action: "remote_relay.disabled",
        capabilityId: "remote-relay",
        decision: "info",
        details: {},
      });
    return this.status();
  }

  /** Sends a device the approvals it may answer; refuses when the relay is off. */
  async pushApprovals(deviceId: string): Promise<void> {
    if (!this.client) throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Relay is off");
    await this.client.pushApprovals(deviceId);
  }

  async close(): Promise<void> {
    await this.stopLoop();
  }

  private async connect(): Promise<void> {
    const privateKey = await this.d.secrets.get(RELAY_KEY_SECRET);
    if (!privateKey) {
      this.lastError = "Core's relay key is missing; turn the relay off and on again";
      return;
    }
    this.client = new RemoteRelayClient({
      url: this.config.url,
      route: this.config.route,
      corePrivateKey: privateKey,
      devices: this.d.devices,
      phone: this.d.phone,
      audit: this.d.audit,
      ...(this.d.fetcher ? { fetcher: this.d.fetcher } : {}),
      ...(this.d.clock ? { clock: this.d.clock } : {}),
    });
    const abort = new AbortController();
    this.loop = abort;
    this.running = this.run(this.client, abort.signal);
  }

  private run(client: RemoteRelayClient, signal: AbortSignal): Promise<void> {
    return keepStreamOpen({
      signal,
      sleep: this.d.sleep ?? defaultSleep,
      halted: () => this.d.killSwitchEngaged(),
      open: () => {
        this.connected = true;
        return client.receive(signal, (error) => {
          // A refused frame is audited by the client; only the kind of failure is kept here.
          this.lastError = error instanceof Error ? error.message.slice(0, 120) : "refused frame";
        });
      },
      connected: (on) => {
        this.connected = on;
      },
      failed: (message) => {
        this.lastError = message;
      },
    });
  }

  private async stopLoop(): Promise<void> {
    this.loop?.abort();
    this.loop = null;
    this.client = null;
    await this.running;
    this.connected = false;
  }
}
