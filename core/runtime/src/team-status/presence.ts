// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  TEAM_ITEM_KINDS,
  isSafeText,
  isTeamItemKind,
  minuteFloor,
  type TeamItem,
  type TeamItemKind,
} from "./kinds";

export const MEMBER_ID = /^[a-z][a-z0-9_-]{1,31}$/;
export const MAX_MEMBERS = 32;
/** A frame must be stamped within this distance of the receiver's clock. */
export const FRAME_WINDOW_MS = 2 * 60_000;
/** A member who has not refreshed within this long drops out of the view. */
export const STALE_AFTER_MS = 3 * 60_000;

/** The decrypted body of one teammate update. Exact keys only; see {@link parseFrameBody}. */
export interface TeamFrameBody {
  v: 1;
  /** Sender clock, strictly increasing per sender: doubles as the replay counter. */
  sentAt: number;
  /** The sender's own consent flag. false = they are not sharing anything. */
  sharing: boolean;
  items: TeamItem[];
}

export interface TeamMember {
  id: string;
  /** Chosen locally by this user; remote data never names a member. */
  label: string;
  /** Pinned P-256 SPKI (base64) used to encrypt to and authenticate this teammate. */
  publicKey: string;
}

export type PresenceRejection = "unknown_member" | "malformed" | "stale" | "replayed";

export type PresenceResult = { ok: true } | { ok: false; reason: PresenceRejection };

export interface TeamPresenceMember {
  id: string;
  label: string;
  items: TeamItem[];
}

export interface TeamPresenceSummary {
  /** Only teammates who are on the roster, said they are sharing, and are fresh. */
  members: TeamPresenceMember[];
  counts: Record<TeamItemKind, number>;
}

interface Latest {
  sentAt: number;
  receivedAt: number;
  sharing: boolean;
  items: TeamItem[];
}

const FRAME_KEYS = ["items", "sentAt", "sharing", "v"];
const ITEM_KEYS = ["kind", "since"];

const exactKeys = (value: object, keys: readonly string[]): boolean => {
  const own = Object.keys(value).sort();
  return own.length === keys.length && own.every((key, i) => key === keys[i]);
};

/** Strict validation of an untrusted decrypted body; anything unexpected is a rejection. */
export function parseFrameBody(raw: unknown): TeamFrameBody | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!exactKeys(raw, FRAME_KEYS)) return null;
  const { v, sentAt, sharing, items } = raw as Record<string, unknown>;
  if (v !== 1 || typeof sharing !== "boolean") return null;
  if (typeof sentAt !== "number" || !Number.isSafeInteger(sentAt) || sentAt <= 0) return null;
  if (!Array.isArray(items) || items.length > TEAM_ITEM_KINDS.length) return null;
  if (!sharing && items.length > 0) return null;
  const seen = new Set<string>();
  const parsed: TeamItem[] = [];
  for (const item of items as unknown[]) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    if (!exactKeys(item, ITEM_KEYS)) return null;
    const { kind, since } = item as Record<string, unknown>;
    if (!isTeamItemKind(kind) || seen.has(kind)) return null;
    if (typeof since !== "number" || !Number.isSafeInteger(since) || since <= 0) return null;
    if (since > sentAt + FRAME_WINDOW_MS) return null;
    seen.add(kind);
    parsed.push({ kind, since: minuteFloor(since) });
  }
  return { v: 1, sentAt, sharing, items: parsed };
}

/**
 * The roster and the latest state of each teammate. A teammate appears in the summary only if the
 * local user added them, they report `sharing: true`, and their last update is fresh. The summary
 * carries the locally chosen label, a closed set of kinds and minute-rounded start times, so
 * nothing a teammate or an attacker puts in a frame can reach the screen as text.
 */
export class TeamPresence {
  private readonly roster = new Map<string, TeamMember>();
  private readonly latest = new Map<string, Latest>();

  addMember(member: TeamMember): void {
    if (!MEMBER_ID.test(member.id)) throw new RangeError("Invalid member id");
    if (!isSafeText(member.label, 40)) throw new RangeError("Invalid member label");
    if (!this.roster.has(member.id) && this.roster.size >= MAX_MEMBERS)
      throw new RangeError("Team roster is full");
    this.roster.set(member.id, { ...member });
  }

  /** Removing a member also forgets everything they shared. */
  removeMember(id: string): boolean {
    this.latest.delete(id);
    return this.roster.delete(id);
  }

  member(id: string): TeamMember | undefined {
    const found = this.roster.get(id);
    return found && { ...found };
  }

  members(): TeamMember[] {
    return [...this.roster.values()].map((member) => ({ ...member }));
  }

  ingest(memberId: string, raw: unknown, now: number): PresenceResult {
    if (!this.roster.has(memberId)) return { ok: false, reason: "unknown_member" };
    const body = parseFrameBody(raw);
    if (body === null) return { ok: false, reason: "malformed" };
    if (Math.abs(now - body.sentAt) > FRAME_WINDOW_MS) return { ok: false, reason: "stale" };
    const previous = this.latest.get(memberId);
    if (previous !== undefined && body.sentAt <= previous.sentAt)
      return { ok: false, reason: "replayed" };
    this.latest.set(memberId, {
      sentAt: body.sentAt,
      receivedAt: now,
      sharing: body.sharing,
      items: body.items,
    });
    return { ok: true };
  }

  summary(now: number): TeamPresenceSummary {
    const counts = Object.fromEntries(TEAM_ITEM_KINDS.map((kind) => [kind, 0])) as Record<
      TeamItemKind,
      number
    >;
    const members: TeamPresenceMember[] = [];
    for (const member of [...this.roster.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const state = this.latest.get(member.id);
      if (state === undefined || !state.sharing) continue;
      if (now - state.receivedAt > STALE_AFTER_MS) continue;
      for (const item of state.items) counts[item.kind]++;
      members.push({
        id: member.id,
        label: member.label,
        items: state.items.map((item) => ({ ...item })),
      });
    }
    return { members, counts };
  }
}
