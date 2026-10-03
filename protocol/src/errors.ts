// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Stable machine-readable error codes (Full System PRD v2.0, Appendix B). */
export const ErrorCode = {
  CAPABILITY_DISABLED: "CAPABILITY_DISABLED",
  CAPABILITY_UNAVAILABLE: "CAPABILITY_UNAVAILABLE",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  INVALID_EVENT: "INVALID_EVENT",
  EVENT_DUPLICATE: "EVENT_DUPLICATE",
  OPERATION_TIMEOUT: "OPERATION_TIMEOUT",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  ACTION_REQUIRES_CONFIRMATION: "ACTION_REQUIRES_CONFIRMATION",
  SECURITY_POLICY_BLOCKED: "SECURITY_POLICY_BLOCKED",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_DESCRIPTIONS: Record<ErrorCode, string> = {
  CAPABILITY_DISABLED: "Capability disabled",
  CAPABILITY_UNAVAILABLE: "Capability unreachable",
  PERMISSION_DENIED: "Permission missing",
  INVALID_EVENT: "Schema invalid",
  EVENT_DUPLICATE: "Already processed",
  OPERATION_TIMEOUT: "Operation timed out",
  RESOURCE_NOT_FOUND: "Resource unavailable",
  ACTION_REQUIRES_CONFIRMATION: "Approval required",
  SECURITY_POLICY_BLOCKED: "Security policy blocked action",
};

export class PhoenixError extends Error {
  readonly code: ErrorCode;
  readonly details: readonly string[];

  constructor(code: ErrorCode, message?: string, details: readonly string[] = []) {
    super(message ?? ERROR_DESCRIPTIONS[code]);
    this.name = "PhoenixError";
    this.code = code;
    this.details = details;
  }

  toJSON(): { code: ErrorCode; message: string; details: readonly string[] } {
    return { code: this.code, message: this.message, details: this.details };
  }
}
