// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Locality, PrivacyClass } from "./types";

/** The `AI_external_processing` permission grant, supplied by the runtime. */
export interface ExternalAiPolicy {
  /** True only while the user has granted AI_external_processing. Read on every decision. */
  allowed(): boolean;
}

/**
 * Per-class opt-in for cloud use. `sensitive` is the Phase 29 opt-in: it is false unless the user
 * set it on purpose (the runtime only ever sets it from the user's own settings request), and it
 * is never defaulted to true anywhere.
 */
export interface CloudOptIn {
  public: boolean;
  internal: boolean;
  sensitive: boolean;
}

/** Cloud AI is off for every class until the user says otherwise. */
export const NO_CLOUD_OPT_IN: CloudOptIn = { public: false, internal: false, sensitive: false };

/** Purpose of a question the user asked Fawkes about their own memory (`ask` in ai/context). */
export const PURPOSE_ANSWER_FROM_MEMORY = "answer a question from memory";

/**
 * Purposes for which sensitive data may be sent to a cloud provider once the user has opted in.
 * This is code, not a setting: nothing an agent or a request can write changes it. A background
 * or automatic purpose (indexing, summarising on a schedule) is deliberately not listed, so
 * sensitive data only reaches the cloud for something the user asked for just now.
 */
export const SENSITIVE_CLOUD_PURPOSES: readonly string[] = [PURPOSE_ANSWER_FROM_MEMORY];

export interface GateDecision {
  allowed: boolean;
  /** Why the provider was refused. Present exactly when `allowed` is false. Safe to show. */
  reason?: string;
}

const ALLOWED: GateDecision = { allowed: true };

/**
 * Decides whether a provider may receive a request of the given data class. Local providers are
 * always allowed (data stays on the device). A cloud provider needs the AI_external_processing
 * grant AND the opt-in for this class, and for sensitive data additionally a purpose from
 * SENSITIVE_CLOUD_PURPOSES. The caller records the reason, so a skipped cloud provider is visible
 * and never silently replaced by "send it anyway".
 */
export function checkGate(
  locality: Locality,
  privacy: PrivacyClass,
  policy: ExternalAiPolicy,
  optIn: CloudOptIn,
  purpose: string,
): GateDecision {
  if (locality === "local") return ALLOWED;
  if (privacy === "sensitive" && !optIn.sensitive) {
    return {
      allowed: false,
      reason: "sensitive data stays on this device unless you opt in to cloud AI for it",
    };
  }
  if (!policy.allowed()) {
    return { allowed: false, reason: "AI_external_processing permission is not granted" };
  }
  if (!optIn[privacy]) {
    return { allowed: false, reason: `cloud AI is not enabled for ${privacy} data` };
  }
  if (privacy === "sensitive" && !SENSITIVE_CLOUD_PURPOSES.includes(purpose)) {
    return {
      allowed: false,
      reason: "this purpose is not covered by the sensitive-data opt-in",
    };
  }
  return ALLOWED;
}
