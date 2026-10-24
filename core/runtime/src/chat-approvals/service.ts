// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  createChatApprovals,
  type ChatApprovals,
  type ChatReply,
  type HttpTransport,
  type RawRequest,
} from "@phoenix/capability-chat-approvals";
import type { CapabilityModule } from "@phoenix/capability-manager";
import type { EventBus } from "@phoenix/event-bus";
import type { AuditLog } from "@phoenix/permissions";
import type { AgentApprovals } from "../agent-approvals";
import { createChatHost, createChatTransport, type ChatHostDeps } from "./index";

/** Capability id; the manager stores the user's switches (projects, providers) under it. */
export const CHAT_APPROVALS_CAPABILITY = "chat-approvals";
/** Settings key holding the epoch ms of the last scheduled digest attempt (a number, nothing else). */
export const CHAT_DIGEST_LAST_KEY = ["chat-approvals", "digest", "last"].join(".");

export interface ChatApprovalsServiceDeps extends ChatHostDeps {
  audit: Pick<AuditLog, "record">;
  bus: Pick<EventBus, "subscribe">;
  /** Live config of the capability (the manager hands the capability a frozen copy at enable). */
  config: () => Readonly<Record<string, unknown>>;
  /** Whether the capability is enabled; nothing is posted and no callback is answered otherwise. */
  enabled: () => boolean;
  killSwitchEngaged: () => boolean;
  transport?: HttpTransport;
  now?: () => number;
  agentApprovals: Pick<AgentApprovals, "list" | "decide">;
  /** Persists the time of the last scheduled digest (settings store); memory only when absent. */
  digestClock?: { read(): number | undefined; write(at: number): void };
  /** How often the opt-in digest schedule is checked. The configured interval (>= 1 hour) still rules. */
  digestCheckMs?: number;
}

/** Digest checks are cheap (no network unless one is due); the interval itself is the owner's setting. */
const DEFAULT_DIGEST_CHECK_MS = 5 * 60_000;

/** How Core's resolve events count in the digest. Counts only; the payload is never read further. */
const OUTCOMES: Readonly<Record<string, "approved" | "denied" | "expired" | "other">> = {
  allow: "approved",
  approved: "approved",
  deny: "denied",
  rejected: "denied",
  expired: "expired",
};

const TRIGGERS = ["security.confirmation.requested", "agent.approval.requested"] as const;

/**
 * Core's owner of the Phase 86 package: one instance per process, the callback door the HTTP route
 * calls, and the subscription that posts cards when an approval appears. Everything is off until
 * the user enables the capability and switches a provider and a project on.
 */
export class ChatApprovalsService {
  readonly approvals: ChatApprovals;
  private readonly unsubscribe: () => void;
  private readonly unsubscribeResolved: () => void;
  private digestTimer: NodeJS.Timeout | undefined;
  private digesting: Promise<unknown> = Promise.resolve();
  private posting: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: ChatApprovalsServiceDeps) {
    this.approvals = createChatApprovals({
      host: createChatHost(d, d.now),
      audit: (entry) => {
        d.audit.record({
          actor: entry.actor,
          action: entry.action,
          capabilityId: CHAT_APPROVALS_CAPABILITY,
          decision: entry.decision,
          details: entry.details,
        });
      },
      transport: d.transport ?? createChatTransport(),
      config: d.config,
      ...(d.now ? { now: d.now } : {}),
      ...(d.digestClock ? { digestClock: d.digestClock } : {}),
    });
    this.unsubscribe = d.bus.subscribe("chat-approvals", [...TRIGGERS], () => {
      this.schedulePost();
    });
    this.unsubscribeResolved = d.bus.subscribe(
      "chat-approvals-digest",
      ["security.confirmation.resolved", "agent.approval.resolved"],
      (event) => {
        // Only the outcome word is read, never anything else in the payload.
        const outcome = event.payload.outcome;
        this.approvals.noteDecision(
          (typeof outcome === "string" && Object.hasOwn(OUTCOMES, outcome)
            ? OUTCOMES[outcome]
            : undefined) ?? "other",
        );
      },
    );
  }

  /** The only caller of the schedule: Core's own timer (none runs until {@link startDigest}). */
  startDigest(): void {
    if (this.digestTimer) return;
    this.digestTimer = setInterval(() => {
      this.checkDigest();
    }, this.d.digestCheckMs ?? DEFAULT_DIGEST_CHECK_MS);
    this.digestTimer.unref();
  }

  /** One schedule check, serialised with itself; off while the capability is off or stopped. */
  checkDigest(): Promise<unknown> {
    this.digesting = this.digesting.then(async () => {
      if (!this.d.enabled() || this.d.killSwitchEngaged()) return;
      try {
        await this.approvals.tickDigest();
      } catch {
        // A provider outage must never disturb Core; the audit log has the refusal.
      }
    });
    return this.digesting;
  }

  get module(): CapabilityModule {
    return this.approvals.module;
  }

  /** Both providers authenticate themselves; this only refuses while the capability is off. */
  async handleCallback(provider: "slack" | "discord", request: RawRequest): Promise<ChatReply> {
    if (!this.d.enabled() || this.d.killSwitchEngaged()) return { status: 503 };
    return this.approvals.handleCallback(provider, request);
  }

  /** Posts at most one batch at a time; a request raised meanwhile is picked up by the next one. */
  private schedulePost(): void {
    this.posting = this.posting.then(async () => {
      if (!this.d.enabled() || this.d.killSwitchEngaged()) return;
      try {
        await this.approvals.postPending();
      } catch {
        // A provider outage must never disturb the approval itself; the audit log has the refusal.
      }
    });
  }

  /** Settles when the digest check queued so far has finished (tests, shutdown). */
  async digestIdle(): Promise<void> {
    await this.digesting;
  }

  /** Settles when the posting queued so far has finished (tests, shutdown). */
  async idle(): Promise<void> {
    await this.posting;
  }

  close(): void {
    clearInterval(this.digestTimer);
    this.digestTimer = undefined;
    this.unsubscribeResolved();
    this.unsubscribe();
  }
}
