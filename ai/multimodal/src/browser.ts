// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { BrowserCaptureDriver } from "./browser-capture";
import { ScopedCaptureSession, type CaptureAuthorization, type CaptureKind } from "./session";
export type { CaptureKind, ScopedCaptureSession } from "./session";

/** Grant and per-use confirmation run before this browser driver can request OS capture. */
export function createBrowserCaptureSession(options: {
  capabilityId: string;
  agentId: string;
  kind: CaptureKind;
  authorization: CaptureAuthorization;
  maxDurationMs: number;
}): ScopedCaptureSession {
  return new ScopedCaptureSession({ ...options, driver: new BrowserCaptureDriver() });
}
