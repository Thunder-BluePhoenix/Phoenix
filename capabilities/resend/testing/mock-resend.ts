// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for api.resend.com shaped from Resend's public API reference ("List Emails",
// GET /emails: `{ object: "list", has_more, data: [{ id, to[], from, created_at, subject,
// last_event, ... }] }`, Bearer authentication). Nothing here was recorded from the real service.
import { startMockService, type MockReply, type MockService } from "@phoenix/service-kit/testing";

/** Built at runtime so no key-shaped literal sits in the tree. */
export const MOCK_API_KEY = ["fake", "resend", "key", "0001"].join("-");

export interface MockEmail {
  id: string;
  to: unknown;
  from: string;
  created_at: string;
  subject: unknown;
  last_event: unknown;
  [extra: string]: unknown;
}

export function rawEmail(id: string, over: Partial<MockEmail> = {}): MockEmail {
  return {
    id,
    to: ["Ada <ada@example.com>"],
    from: "Phoenix <noreply@example.org>",
    created_at: "2026-10-05 10:00:00.123456+00",
    subject: "Welcome",
    bcc: null,
    cc: null,
    reply_to: null,
    last_event: "delivered",
    ...over,
  };
}

export interface MockResend extends MockService {
  /** What GET /emails returns (as `data`). */
  emails: unknown[];
  /** Replaces the whole reply to GET /emails (status, body, headers). */
  override: MockReply | undefined;
  /** Paths requested, e.g. "/emails?limit=25". */
  paths(): string[];
}

export async function startMockResend(): Promise<MockResend> {
  const state = { emails: [] as unknown[], override: undefined as MockReply | undefined };
  const service = await startMockService((req) => {
    if (req.headers.authorization !== `Bearer ${MOCK_API_KEY}`) {
      return { status: 401, body: { name: "missing_api_key", message: "API key is invalid" } };
    }
    if (req.method === "GET" && req.path.split("?")[0] === "/emails") {
      if (state.override) return state.override;
      const limit = Number(new URL(req.path, "http://x").searchParams.get("limit") ?? 20);
      return { body: { object: "list", has_more: false, data: state.emails.slice(0, limit) } };
    }
    return undefined;
  });
  return {
    url: service.url,
    requests: service.requests,
    respond: service.respond,
    close: service.close,
    get emails() {
      return state.emails;
    },
    set emails(value: unknown[]) {
      state.emails = value;
    },
    get override() {
      return state.override;
    },
    set override(value: MockReply | undefined) {
      state.override = value;
    },
    paths: () => service.requests.map((r) => r.path),
  };
}
