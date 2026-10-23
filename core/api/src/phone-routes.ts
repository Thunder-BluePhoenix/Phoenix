// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";
import type { CoreServices } from "./services";

/** Too many attempts: the LAN listener answers 429 with Retry-After, the desktop API 403. */
export class PhoneThrottledError extends PhoenixError {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(ErrorCode.SECURITY_POLICY_BLOCKED, message);
  }
}

/** Everything the desktop UI needs to show about the phone link. Never carries a key or a code. */
export interface PhoneStatusView {
  enabled: boolean;
  listening: boolean;
  address: string | null;
  port: number | null;
  /**
   * The port the listener binds to the next time it opens (`phone.port`, default 47821). `port`
   * above is where it actually listens now. Changing it reopens a link that is on.
   */
  configured_port: number;
  /** LAN addresses the listener could be bound to right now. */
  addresses: string[];
  /** SHA-256 of the listener's certificate: uppercase hex pairs joined by `:`. */
  fingerprint: string | null;
  require_user_verification: boolean;
  kill_switch: boolean;
  pairing: { expires_at: string } | null;
  pending_pair: {
    name: string;
    key_fingerprint: string;
    requested_at: string;
    expires_at: string;
    /** The generic confirmation to answer with POST /api/confirmations/:id. */
    confirmation_id: string | null;
  } | null;
  locked_out_until: string | null;
  /**
   * Why the link is enabled but not listening: `address_changed` = the network address the user
   * chose is no longer on this computer. The link stays off (it never opens on another interface)
   * until the user picks an address again.
   */
  off_reason: "address_changed" | null;
  /** Paired devices that are not revoked. */
  devices: number;
}

/** The one place the pairing code leaves Core: the response to the desktop user who asked for it. */
export interface PhonePairingView {
  code: string;
  expires_at: string;
  fingerprint: string;
  address: string;
  port: number;
  uri: string;
}

export interface PhoneDeviceView {
  id: string;
  name: string;
  key_fingerprint: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

/** Desktop side: session-token routes on the loopback API. */
export interface PhoneApi {
  status(): PhoneStatusView;
  configure(input: unknown): Promise<PhoneStatusView>;
  startPairing(): PhonePairingView;
  cancelPairing(): { cancelled: true };
  devices(): PhoneDeviceView[];
  revokeDevice(id: string): { id: string; revoked: true };
}

/** What the LAN listener hands to the service for one request, exactly as it arrived. */
export interface PhoneAuthRequest {
  deviceId: string | undefined;
  timestamp: string | undefined;
  nonce: string | undefined;
  signature: string | undefined;
  method: string;
  /** Path plus query string, as sent. */
  target: string;
  body: Buffer;
  remote: string | undefined;
}

export interface PhoneIdentity {
  id: string;
  name: string;
}

export type PhonePairProgress =
  | { status: "pending"; expires_at: string }
  | { status: "approved"; device_id: string }
  | { status: "denied" | "expired" };

export interface PhoneApprovalView {
  source: "confirmation" | "agent";
  id: string;
  tool: string;
  /** Short line for the notification / list row. Untrusted text: show it as text. */
  title: string;
  /** The material `preview_hash` covers. Untrusted text. */
  preview: Record<string, unknown>;
  /** sha256 (hex) of the canonical JSON of `preview`. */
  preview_hash: string;
  expires_at: string;
  /**
   * sha256 (hex) over the canonical binding of source, id, tool, preview_hash and expires_at
   * (docs/phone-link.md). The phone echoes it in its decision; Core recomputes it from the request
   * as it is NOW and refuses on any difference.
   */
  request_hash: string;
}

/** LAN side: what the phone listener may call. Nothing else of Core is reachable from it. */
export interface PhoneDeviceApi {
  /** Verifies the per-request device signature; throws a PhoenixError (always 401/403) otherwise. */
  authenticate(request: PhoneAuthRequest): PhoneIdentity;
  pair(
    body: unknown,
    remote: string | undefined,
  ): {
    pair_id: string;
    status: "pending";
    expires_at: string;
  };
  pairProgress(pairId: string, remote: string | undefined): PhonePairProgress;
  whoami(device: PhoneIdentity): {
    device_id: string;
    name: string;
    require_user_verification: boolean;
    server_time: string;
  };
  approvals(device: PhoneIdentity): { approvals: PhoneApprovalView[] };
  decide(
    device: PhoneIdentity,
    body: unknown,
  ): { id: string; source: "confirmation" | "agent"; decision: "approve" | "deny" };
}

/** Desktop routes. The phone's own routes are in phone-listener.ts, on a separate server. */
export function phoneRoutes(s: CoreServices): Route[] {
  const phone = () => {
    if (!s.phone)
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Phone link is unavailable");
    return s.phone;
  };
  return [
    route("GET", "/api/phone/status", () => phone().status()),
    route("POST", "/api/phone/settings", async ({ body }) =>
      phone().configure(expectObject(await body())),
    ),
    route("POST", "/api/phone/pairing", async ({ res }) => {
      const pairing = phone().startPairing();
      res.statusCode = 201;
      return pairing;
    }),
    route("DELETE", "/api/phone/pairing", () => phone().cancelPairing()),
    route("GET", "/api/phone/devices", () => ({ devices: phone().devices() })),
    route("DELETE", "/api/phone/devices/:id", ({ params }) => phone().revokeDevice(params.id!)),
  ];
}
