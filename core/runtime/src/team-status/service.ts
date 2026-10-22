// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { RelayFrame } from "../remote-relay/crypto";
import { openTeamFrame, sealTeamFrame } from "./frame";
import type { TeamClock } from "./kinds";
import type { PresenceResult, TeamFrameBody, TeamPresence, TeamPresenceSummary } from "./presence";
import type { TeamOutgoing, TeamSharing } from "./sharing";

export interface TeamStatusIdentity {
  /** This install's member id on its teammates' rosters. */
  id: string;
  /** Resolved at each use from the OS credential store; never held as a field or logged. */
  privateKeyPem(): Promise<string | undefined>;
}

export interface TeamStatusDependencies {
  sharing: TeamSharing;
  presence: TeamPresence;
  identity: TeamStatusIdentity;
  /** Delivers a sealed frame to one teammate (through the Phase 87 relay in production). */
  send(recipientId: string, frame: RelayFrame): Promise<void>;
  clock: TeamClock;
}

export interface BroadcastReport {
  /** What was actually put into frames. Nothing is ever sent that is not in this value. */
  sent: TeamOutgoing | null;
  delivered: string[];
  failed: string[];
}

export interface TeamStatusView {
  sharing: ReturnType<TeamSharing["view"]>;
  members: { id: string; label: string }[];
  presence: TeamPresenceSummary;
}

/**
 * Glues the local sharing choices to the roster. Outbound: one end-to-end encrypted, signed
 * frame per teammate, built from {@link TeamSharing.outgoing} only. Inbound: a frame is accepted
 * only from a rostered sender whose signature verifies against the key pinned for that sender.
 */
export class TeamStatus {
  private lastSentAt = 0;
  private announcedSharing = false;

  constructor(private readonly d: TeamStatusDependencies) {}

  view(): TeamStatusView {
    const now = this.d.clock.now();
    return {
      sharing: this.d.sharing.view(),
      members: this.d.presence.members().map(({ id, label }) => ({ id, label })),
      presence: this.d.presence.summary(now),
    };
  }

  /**
   * Sends the current outgoing state to every rostered teammate. While sharing is off nothing is
   * sent, except one final "not sharing" frame after it was on, so teammates stop showing me at once.
   */
  async broadcast(): Promise<BroadcastReport> {
    const outgoing = this.d.sharing.outgoing();
    if (!outgoing.sharing && !this.announcedSharing)
      return { sent: null, delivered: [], failed: [] };
    const privateKey = await this.d.identity.privateKeyPem();
    const members = this.d.presence.members();
    if (privateKey === undefined)
      return { sent: outgoing, delivered: [], failed: members.map((m) => m.id) };
    const sentAt = Math.max(this.d.clock.now(), this.lastSentAt + 1);
    this.lastSentAt = sentAt;
    const body: TeamFrameBody = { v: 1, sentAt, sharing: outgoing.sharing, items: outgoing.items };
    const delivered: string[] = [];
    const failed: string[] = [];
    for (const member of members) {
      try {
        await this.d.send(
          member.id,
          sealTeamFrame(this.d.identity.id, member.id, member.publicKey, privateKey, body),
        );
        delivered.push(member.id);
      } catch {
        failed.push(member.id);
      }
    }
    this.announcedSharing = outgoing.sharing;
    return { sent: outgoing, delivered, failed };
  }

  /** Handles one inbound frame. Every failure is a plain rejection with no detail about why. */
  async receive(frame: RelayFrame): Promise<PresenceResult> {
    const sender = this.d.presence.member(typeof frame?.sender === "string" ? frame.sender : "");
    if (sender === undefined) return { ok: false, reason: "unknown_member" };
    const privateKey = await this.d.identity.privateKeyPem();
    if (privateKey === undefined) return { ok: false, reason: "malformed" };
    const body = openTeamFrame(this.d.identity.id, sender.id, sender.publicKey, privateKey, frame);
    if (body === null) return { ok: false, reason: "malformed" };
    return this.d.presence.ingest(sender.id, body, this.d.clock.now());
  }
}
