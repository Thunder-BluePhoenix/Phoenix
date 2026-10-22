// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Core's owner of Phase 92 team presence. It holds what the pure pieces deliberately do not: this
// install's team identity (private key only in the OS secret store), the pinned roster, the relay
// address, and the one open stream that carries teammates' frames in. Everything is off until the
// user turns the link on, and sharing has its own separate opt-in on top of that.
//
// Transport is the Phase 87 relay, addressed `tm_<12 hex>` so a teammate frame can never reach
// Core's own phone route. The relay is untrusted: every frame is sealed to its recipient and signed
// by its sender, and only a rostered sender whose pinned key verifies is ever shown.
import { randomBytes } from "node:crypto";
import type { AuditLog } from "@phoenix/permissions";
import type { SecretStore, SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { EventBus } from "@phoenix/event-bus";
import { newCoreIdentity, type RelayFrame } from "../remote-relay/crypto";
import {
  defaultSleep,
  keepStreamOpen,
  readRelayStream,
  relayUrl,
  type RelaySleep,
} from "../remote-relay/stream";
import { assertTeamPublicKey } from "./frame";
import { isSafeText, type TeamClock } from "./kinds";
import { TeamPresence, type TeamMember } from "./presence";
import { RateLimiter } from "./rate-limit";
import { TeamStatus, type TeamStatusIdentity, type TeamStatusView } from "./service";
import { TeamSharing } from "./sharing";

export const TEAM_LINK_KEY = "team-status.link";
export const TEAM_ROSTER_KEY = "team-status.roster";
export const TEAM_KEY_SECRET = "team-status.private-key";
/** Teammates are addressed `tm_<12 hex>`: the relay's own peer shape, never `core` or `dev_…`. */
export const TEAM_ID = /^tm_[a-f0-9]{12}$/;
const ROUTE = /^[a-f0-9]{32}$/;
/** A teammate with no news for 3 minutes drops out of the view, so refresh well inside that. */
export const HEARTBEAT_MS = 60_000;
const SEND_TIMEOUT_MS = 10_000;

interface LinkConfig {
  enabled: boolean;
  url: string;
  route: string;
  /** This install's id on its teammates' rosters; created once, kept until the user leaves. */
  selfId: string;
  /** Public half of the team identity, shown so a teammate can pin it. */
  publicKey: string;
}

const OFF: LinkConfig = { enabled: false, url: "", route: "", selfId: "", publicKey: "" };

export interface TeamLinkStatus {
  enabled: boolean;
  connected: boolean;
  url: string | null;
  route: string | null;
  /** Null until the link has been turned on once. */
  self: { id: string; public_key: string } | null;
  last_error: string | null;
}

export interface TeamLinkDependencies {
  settings: SettingsStore;
  secrets: SecretStore;
  audit: Pick<AuditLog, "record">;
  bus: Pick<EventBus, "subscribe">;
  killSwitchEngaged: () => boolean;
  clock?: TeamClock;
  fetcher?: typeof fetch;
  sleep?: RelaySleep;
  /** Starts the periodic refresh and returns its stop function; tests call the beat by hand. */
  heartbeat?: (beat: () => void) => () => void;
}

const everyHeartbeat = (beat: () => void): (() => void) => {
  const timer = setInterval(beat, HEARTBEAT_MS);
  timer.unref();
  return () => clearInterval(timer);
};

function parseLink(value: unknown): LinkConfig {
  if (value === null || typeof value !== "object") return OFF;
  const o = value as Record<string, unknown>;
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    enabled: o.enabled === true,
    url: text(o.url),
    route: text(o.route),
    selfId: text(o.selfId),
    publicKey: text(o.publicKey),
  };
}

function parseRoster(value: unknown): TeamMember[] {
  if (!Array.isArray(value)) return [];
  const members: TeamMember[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const { id, label, publicKey } = entry as Record<string, unknown>;
    if (typeof id === "string" && typeof label === "string" && typeof publicKey === "string")
      members.push({ id, label, publicKey });
  }
  return members;
}

export class TeamLinkService {
  readonly sharing: TeamSharing;
  readonly presence = new TeamPresence();
  private readonly team: TeamStatus;
  /** Read by {@link TeamStatus} at each use, so `id` follows the saved config. */
  private readonly identity: TeamStatusIdentity;
  private config: LinkConfig;
  private loop: AbortController | null = null;
  private running: Promise<void> = Promise.resolve();
  private queue: Promise<void> = Promise.resolve();
  private connected = false;
  private lastError: string | null = null;
  private stopBeat: (() => void) | null = null;
  private readonly inbound = new RateLimiter(10, 30);
  private readonly unsubscribe: () => void;
  private readonly unlisten: () => void;

  constructor(private readonly d: TeamLinkDependencies) {
    const clock = d.clock ?? { now: Date.now };
    this.config = parseLink(d.settings.get<unknown>(TEAM_LINK_KEY, null));
    this.sharing = new TeamSharing(d.settings, clock);
    for (const member of parseRoster(d.settings.get<unknown>(TEAM_ROSTER_KEY, null))) {
      try {
        this.presence.addMember(member);
      } catch {
        // A roster entry that no longer validates is dropped rather than trusted.
      }
    }
    this.identity = { id: this.config.selfId, privateKeyPem: () => d.secrets.get(TEAM_KEY_SECRET) };
    this.team = new TeamStatus({
      sharing: this.sharing,
      presence: this.presence,
      identity: this.identity,
      send: (recipientId, frame) => this.deliver(recipientId, frame),
      clock,
    });
    this.unlisten = this.sharing.subscribe(() => this.refresh());
    this.unsubscribe = d.bus.subscribe(
      "team-status",
      ["deploy.*", "agent_run.*", "kage.meeting.*", "security.kill_switch.engaged"],
      (event) => {
        if (event.event_type === "security.kill_switch.engaged") {
          void this.pause("kill_switch");
          return;
        }
        this.sharing.observe({
          source: event.source,
          event_type: event.event_type,
          ...(event.correlation_id ? { correlation_id: event.correlation_id } : {}),
          ...(event.subject ? { subject: event.subject } : {}),
        });
      },
    );
  }

  view(): TeamStatusView {
    return this.team.view();
  }

  setEnabled(enabled: boolean): void {
    this.sharing.setEnabled(enabled);
  }

  setConsent(change: Record<string, unknown>): void {
    this.sharing.setConsent(change as Partial<Record<string, boolean>>);
  }

  status(): TeamLinkStatus {
    const on = this.config.enabled;
    return {
      enabled: on,
      connected: this.connected,
      url: on ? this.config.url : null,
      route: on ? this.config.route : null,
      self: this.config.selfId
        ? { id: this.config.selfId, public_key: this.config.publicKey }
        : null,
      last_error: this.lastError,
    };
  }

  /** Number of teammates on the roster, for the privacy inventory. */
  memberCount(): number {
    return this.presence.members().length;
  }

  /** Resumes a link the user had turned on; called once at startup. */
  async start(): Promise<void> {
    if (!this.config.enabled) return;
    if (this.d.killSwitchEngaged()) {
      await this.pause("kill_switch");
      return;
    }
    await this.connect();
  }

  /**
   * Turns the link on. `route` is how a team shares one address: the first member leaves it out and
   * gets a random one, everyone else passes theirs. A route id is an address, not a credential.
   */
  async enable(input: unknown): Promise<TeamLinkStatus> {
    if (this.d.killSwitchEngaged())
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");
    const url = relayUrl(input);
    const wanted = (input as { route?: unknown }).route;
    if (wanted !== undefined && (typeof wanted !== "string" || !ROUTE.test(wanted)))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"route" must be 32 lowercase hex digits');
    await this.stopLoop();
    let { selfId, publicKey } = this.config;
    if (!selfId || (await this.d.secrets.get(TEAM_KEY_SECRET)) === undefined) {
      const identity = newCoreIdentity();
      await this.d.secrets.set(TEAM_KEY_SECRET, identity.privateKey);
      selfId = `tm_${randomBytes(6).toString("hex")}`;
      publicKey = identity.publicKey;
    }
    this.saveConfig({
      enabled: true,
      url,
      route: wanted ?? randomBytes(16).toString("hex"),
      selfId,
      publicKey,
    });
    this.record("team.link.enabled", "allowed", { host: new URL(url).host });
    await this.connect();
    return this.status();
  }

  /** Stops the network without forgetting who I am or who my teammates are. */
  async pause(by: "user" | "kill_switch" = "user"): Promise<TeamLinkStatus> {
    await this.stopLoop();
    if (this.config.enabled) {
      this.saveConfig({ ...this.config, enabled: false });
      this.record("team.link.paused", "info", { by });
    }
    return this.status();
  }

  /**
   * Leaves the team: stops sharing (with one last "not sharing" frame so teammates stop showing me
   * at once), then forgets the identity, the route and the whole roster.
   */
  async leave(): Promise<TeamLinkStatus> {
    if (this.config.enabled) {
      this.sharing.setEnabled(false);
      await this.idle();
    } else {
      this.sharing.setEnabled(false);
    }
    await this.stopLoop();
    for (const member of this.presence.members()) this.presence.removeMember(member.id);
    this.d.settings.set(TEAM_ROSTER_KEY, []);
    await this.d.secrets.delete(TEAM_KEY_SECRET);
    this.saveConfig(OFF);
    this.lastError = null;
    this.record("team.link.left", "info", {});
    return this.status();
  }

  /** Pins a teammate. A key already on the roster is never replaced silently: remove, then add. */
  async addMember(input: unknown): Promise<TeamStatusView> {
    if (input === null || typeof input !== "object")
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Expected an object");
    const { id, label, public_key: key } = input as Record<string, unknown>;
    if (!this.config.selfId)
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Turn the team link on first");
    if (typeof id !== "string" || !TEAM_ID.test(id))
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        '"id" must look like tm_ and 12 hex digits',
      );
    if (!isSafeText(label, 40))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"label" must be 1-40 plain characters');
    if (typeof key !== "string")
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"public_key" must be a string');
    if (id === this.config.selfId || key === this.config.publicKey)
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "That is this install's own identity");
    if (this.presence.member(id))
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        "Already on the roster; remove them first to change their key",
      );
    try {
      assertTeamPublicKey(key);
      this.presence.addMember({ id, label, publicKey: key });
    } catch (error) {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        error instanceof RangeError ? error.message : "Invalid public key",
      );
    }
    this.persistRoster();
    this.record("team.member.added", "allowed", { member: id });
    this.refresh();
    return this.view();
  }

  removeMember(id: string): TeamStatusView {
    if (!this.presence.removeMember(id))
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Not on the roster");
    this.persistRoster();
    this.inbound.forget(id);
    this.record("team.member.removed", "info", { member: id });
    return this.view();
  }

  /** Resolves once every queued broadcast has finished. */
  async idle(): Promise<void> {
    await this.queue;
  }

  async close(): Promise<void> {
    this.unsubscribe();
    this.unlisten();
    await this.stopLoop();
    await this.idle();
  }

  /** Sends my current state to every teammate, one at a time, when the link is up. */
  private refresh(): void {
    if (!this.config.enabled) return;
    this.queue = this.queue
      .then(() => this.team.broadcast())
      .then(
        () => undefined,
        () => undefined,
      );
  }

  private async deliver(recipientId: string, frame: RelayFrame): Promise<void> {
    if (!this.config.enabled) throw new Error("Team link is off");
    const response = await (this.d.fetcher ?? fetch)(this.address(recipientId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(frame),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Relay delivery failed (${response.status})`);
  }

  private address(peer: string): string {
    return `${this.config.url.replace(/\/$/, "")}/v1/routes/${this.config.route}/peers/${peer}`;
  }

  private async connect(): Promise<void> {
    if ((await this.d.secrets.get(TEAM_KEY_SECRET)) === undefined) {
      this.lastError = "The team key is missing; leave the team and join again";
      return;
    }
    const abort = new AbortController();
    this.loop = abort;
    const { signal } = abort;
    this.stopBeat = (this.d.heartbeat ?? everyHeartbeat)(() => this.refresh());
    this.running = keepStreamOpen({
      signal,
      sleep: this.d.sleep ?? defaultSleep,
      halted: () => this.d.killSwitchEngaged(),
      open: () =>
        readRelayStream(
          this.d.fetcher ?? fetch,
          this.address(this.config.selfId),
          signal,
          (frame) => this.accept(frame),
          () => {
            this.lastError = "refused frame";
          },
          () => {
            this.connected = true;
            this.refresh();
          },
        ),
      connected: (on) => {
        this.connected = on;
      },
      failed: (message) => {
        this.lastError = message;
      },
    });
  }

  /** Drops frames from a sender that is flooding; everything else is judged by TeamStatus. */
  private async accept(frame: unknown): Promise<void> {
    const sender =
      frame !== null && typeof frame === "object" && "sender" in frame ? frame.sender : undefined;
    if (typeof sender !== "string" || sender.length > 40) return;
    if (!this.inbound.take(sender, (this.d.clock ?? { now: Date.now }).now()).ok) return;
    await this.team.receive(frame as RelayFrame);
  }

  private async stopLoop(): Promise<void> {
    this.stopBeat?.();
    this.stopBeat = null;
    this.loop?.abort();
    this.loop = null;
    await this.running;
    this.connected = false;
  }

  private saveConfig(config: LinkConfig): void {
    this.config = config;
    this.identity.id = config.selfId;
    this.d.settings.set(TEAM_LINK_KEY, config);
  }

  private persistRoster(): void {
    this.d.settings.set(TEAM_ROSTER_KEY, this.presence.members());
  }

  private record(action: string, decision: "allowed" | "info", details: Record<string, unknown>) {
    this.d.audit.record({
      actor: action.endsWith("paused") && details.by === "kill_switch" ? "kill-switch" : "user",
      action,
      capabilityId: "team-status",
      decision,
      details,
    });
  }
}
