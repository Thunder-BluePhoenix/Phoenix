// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for api.cal.com shaped from the Cal.com API v2 reference: Bearer authentication, a
// required `cal-api-version` header, GET /v2/bookings answering `{ status: "success", data: [...] }`
// where each booking has `uid`, `title`, `status` (accepted|pending|cancelled|rejected), `start`,
// `end`, `createdAt`, `updatedAt`, `attendees[]`, `meetingUrl`, `rescheduledFromUid` and
// `rescheduledToUid`. Nothing here was recorded from the real service.
import { startMockService, type MockReply, type MockService } from "@phoenix/service-kit/testing";

/** Built at runtime so no key-shaped literal sits in the tree. */
export const MOCK_API_KEY = ["fake", "cal", "key", "0001"].join("-");

export function rawBooking(
  uid: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 1,
    uid,
    title: "Intro call",
    status: "accepted",
    start: "2026-10-05T15:00:00.000Z",
    end: "2026-10-05T15:30:00.000Z",
    duration: 30,
    createdAt: "2026-10-05T10:00:00.000Z",
    updatedAt: "2026-10-05T10:00:00.000Z",
    meetingUrl: "https://meet.example.com/abc",
    attendees: [{ name: "Ada", email: "ada@example.com", timeZone: "Europe/Paris" }],
    ...over,
  };
}

export interface MockCalcom extends MockService {
  bookings: unknown[];
  /** Replaces the whole reply to GET /v2/bookings. */
  override: MockReply | undefined;
  paths(): string[];
}

export async function startMockCalcom(): Promise<MockCalcom> {
  const state = { bookings: [] as unknown[], override: undefined as MockReply | undefined };
  const service = await startMockService((req) => {
    if (req.headers.authorization !== `Bearer ${MOCK_API_KEY}`) {
      return { status: 401, body: { status: "error", error: { code: "UNAUTHORIZED" } } };
    }
    if (!req.headers["cal-api-version"]) {
      return {
        status: 400,
        body: { status: "error", error: { message: "cal-api-version missing" } },
      };
    }
    if (req.method === "GET" && req.path.split("?")[0] === "/v2/bookings") {
      return state.override ?? { body: { status: "success", data: state.bookings } };
    }
    return undefined;
  });
  return {
    url: service.url,
    requests: service.requests,
    respond: service.respond,
    close: service.close,
    get bookings() {
      return state.bookings;
    },
    set bookings(value: unknown[]) {
      state.bookings = value;
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
