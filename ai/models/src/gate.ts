// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Locality, PrivacyClass } from "./types";

/** The `AI_external_processing` permission grant, supplied by the runtime. */
export interface ExternalAiPolicy {
  /** True only while the user has granted AI_external_processing. Read on every decision. */
  allowed(): boolean;
}

/**
 * Per-class opt-in for cloud use. There is deliberately no `sensitive` key: sensitive data can
 * never be opted in from here.
 */
export interface CloudOptIn {
  public: boolean;
  internal: boolean;
}

/**
 * PHASE 29 HOOK. Sensitive data never leaves the device in Phase 27, and the router and the
 * service both refuse it for cloud providers by consulting this constant. Phase 29 (privacy
 * classification and redaction) owns any future rule that lets redacted sensitive content go to
 * the cloud; it must replace this constant with an explicit, audited decision and update the
 * tests that pin this behaviour. Flipping it alone is not enough: `checkGate` also refuses
 * sensitive data because `CloudOptIn` has no sensitive key, so Phase 29 has to extend both on
 * purpose. Until then it is `false` and nothing else may bypass it.
 */
export const SENSITIVE_DATA_MAY_USE_CLOUD = false as boolean;

export interface GateDecision {
  allowed: boolean;
  /** Why the provider was refused. Present exactly when `allowed` is false. Safe to show. */
  reason?: string;
}

const ALLOWED: GateDecision = { allowed: true };

/**
 * Decides whether a provider may receive a request of the given data class. Local providers are
 * always allowed (data stays on the device). A cloud provider needs the sensitive-data rule, the
 * AI_external_processing grant AND the opt-in for this class. The caller records the reason, so a
 * skipped cloud provider is visible and never silently replaced by "send it anyway".
 */
export function checkGate(
  locality: Locality,
  privacy: PrivacyClass,
  policy: ExternalAiPolicy,
  optIn: CloudOptIn,
): GateDecision {
  if (locality === "local") return ALLOWED;
  if (privacy === "sensitive" && !SENSITIVE_DATA_MAY_USE_CLOUD) {
    return { allowed: false, reason: "sensitive data never leaves this device" };
  }
  if (!policy.allowed()) {
    return { allowed: false, reason: "AI_external_processing permission is not granted" };
  }
  if (privacy === "sensitive") {
    return { allowed: false, reason: "sensitive data cannot be opted in to cloud AI" };
  }
  if (!optIn[privacy]) {
    return { allowed: false, reason: `cloud AI is not enabled for ${privacy} data` };
  }
  return ALLOWED;
}
