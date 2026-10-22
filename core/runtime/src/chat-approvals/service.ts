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
}

const TRIGGERS = ["security.confirmation.requested", "agent.approval.requested"] as const;

/**
 * Core's owner of the Phase 86 package: one instance per process, the callback door the HTTP route
 * calls, and the subscription that posts cards when an approval appears. Everything is off until
 * the user enables the capability and switches a provider and a project on.
 */
export class ChatApprovalsService {
  readonly approvals: ChatApprovals;
  private readonly unsubscribe: () => void;
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
    });
    this.unsubscribe = d.bus.subscribe("chat-approvals", [...TRIGGERS], () => {
      this.schedulePost();
    });
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

  /** Settles when the posting queued so far has finished (tests, shutdown). */
  async idle(): Promise<void> {
    await this.posting;
  }

  close(): void {
    this.unsubscribe();
  }
}
