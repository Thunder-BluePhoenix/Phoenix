// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The opt-in scheduled approvals digest: a pure formatter (counts, short ids and action names only,
// bounded, hidden characters stripped) and a schedule that sends at most once per interval, never in
// quiet hours and never when nothing happened. Simulated: no request reaches a chat provider.
import { afterEach, describe, expect, it } from "vitest";
import {
  digestVerdict,
  emptyActivity,
  formatDigest,
  MAX_DIGEST_CHARS,
  MAX_DIGEST_LISTED,
  MIN_DIGEST_INTERVAL_MINUTES,
  OFF_SCHEDULE,
  parseConfig,
  quietNow,
  type ApprovalSnapshot,
} from "../src";
import { agentRequest, baseConfig, makeRig, T0, type Rig } from "./rig";

const HOUR = 3_600_000;
const slack = {
  enabled: true,
  workspace: "T0PHOENIX",
  channel: "C0APPROVALS",
  approvers: ["U0OWNER"],
  digest: true,
};
const schedule = (extra: Record<string, unknown> = {}) => ({
  enabled: true,
  interval_minutes: 60,
  ...extra,
});

const snap = (over: Partial<ApprovalSnapshot> = {}): ApprovalSnapshot => ({
  source: "agent",
  id: "apr_1",
  tool: "Bash",
  title: "rm -rf /secret/path --token=hunter2",
  project: "alpha",
  request_hash: "0".repeat(64),
  expires_at: "2026-10-22T09:02:00.000Z",
  ...over,
});

describe("formatDigest", () => {
  it("holds counts, short ids and action names, never title, project, path or command", () => {
    const text = formatDigest({
      pending: [snap(), snap({ id: "apr_2", tool: "Write", project: "hidden-repo" })],
      allowed: () => true,
      activity: { approved: 2, denied: 1, expired: 0, other: 0 },
    });
    expect(text).toContain("2 waiting");
    expect(text).toContain("3 decided");
    expect(text).toContain("apr_1 Bash");
    expect(text).toContain("apr_2 Write");
    expect(text).not.toMatch(/rm -rf|secret|hunter2|alpha|hidden-repo/);
  });

  it("names only approvals switched on for chat; the others are counted", () => {
    const text = formatDigest({
      pending: [snap(), snap({ id: "apr_9", tool: "Private", project: "other" })],
      allowed: (s) => s.project === "alpha",
      activity: emptyActivity(),
    });
    expect(text).toContain("2 waiting");
    expect(text).toContain("apr_1 Bash");
    expect(text).not.toContain("apr_9");
    expect(text).not.toContain("Private");
  });

  it("strips control and hidden characters and markup from ids and tool names", () => {
    const text = formatDigest({
      pending: [snap({ id: "a\u202Eb\u0000c", tool: "Ba\u200Bsh\n<@everyone> [x](http://evil)" })],
      allowed: () => true,
      activity: emptyActivity(),
    });
    expect(text).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
    expect(text).not.toMatch(/[<>@[\]()]/);
    // Only [A-Za-z0-9_-] survives in an id or action name: nothing can form a link or mention.
    expect(text).toContain("abc Basheveryonexhttpevil");
    expect(text.split("Waiting:")[1]).not.toMatch(/[:/@<>]/);
  });

  it("is bounded: only a few are listed and the text never passes its limit", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      snap({ id: `apr_${i}`, tool: "T".repeat(500) }),
    );
    const text = formatDigest({
      pending: many,
      allowed: () => true,
      activity: { approved: 99_999, denied: 0, expired: 0, other: 0 },
    });
    expect(Array.from(text).length).toBeLessThanOrEqual(MAX_DIGEST_CHARS);
    expect(text.match(/apr_\d+/g)).toHaveLength(MAX_DIGEST_LISTED);
    expect(text).toContain("45 not listed");
    expect(text).toContain("9999+");
  });
});

describe("quietNow and digestVerdict", () => {
  const night = { timezone: "UTC", start: "22:00", end: "07:00" };
  it("handles windows across midnight, the zone, and fails quiet on bad input", () => {
    expect(quietNow(Date.UTC(2026, 9, 22, 23), night)).toBe(true);
    expect(quietNow(Date.UTC(2026, 9, 22, 12), night)).toBe(false);
    expect(quietNow(Date.UTC(2026, 9, 22, 23), { ...night, timezone: "America/New_York" })).toBe(
      false,
    );
    expect(quietNow(0, { ...night, timezone: "No/Such_Zone" })).toBe(true);
    expect(quietNow(0, { ...night, start: "25:00" })).toBe(true);
    expect(quietNow(0, null)).toBe(false);
  });

  const base = {
    schedule: { enabled: true, intervalMs: HOUR, quietHours: null },
    now: 10 * HOUR,
    lastAt: 0,
    hasDestination: true,
    hasNews: true,
  };
  it("sends only when on, reachable, due, outside quiet hours and with news", () => {
    expect(digestVerdict(base)).toBe("send");
    expect(digestVerdict({ ...base, schedule: OFF_SCHEDULE })).toBe("off");
    expect(digestVerdict({ ...base, hasDestination: false })).toBe("no_destination");
    expect(digestVerdict({ ...base, lastAt: 10 * HOUR - 1 })).toBe("not_due");
    expect(digestVerdict({ ...base, lastAt: undefined })).toBe("not_due");
    expect(digestVerdict({ ...base, hasNews: false })).toBe("idle");
    expect(
      digestVerdict({
        ...base,
        schedule: {
          ...base.schedule,
          quietHours: { timezone: "UTC", start: "00:00", end: "23:59" },
        },
      }),
    ).toBe("quiet");
  });

  it("parses the interval to at least one hour and defaults everything to off", () => {
    expect(parseConfig({}).digestSchedule.enabled).toBe(false);
    expect(
      parseConfig({ digest_schedule: { enabled: true, interval_minutes: 1 } }).digestSchedule,
    ).toMatchObject({ enabled: true, intervalMs: MIN_DIGEST_INTERVAL_MINUTES * 60_000 });
    expect(parseConfig({ digest_schedule: { enabled: "yes" } }).digestSchedule.enabled).toBe(false);
  });
});

let rig: Rig | undefined;
afterEach(async () => {
  await rig?.harness.close();
  rig = undefined;
});

describe("tickDigest", () => {
  it("is off by default even when a provider has digest on and approvals wait", async () => {
    rig = await makeRig(baseConfig({ slack }));
    rig.core.add(agentRequest());
    rig.clock.advance(100 * HOUR);
    expect((await rig.chat.tickDigest()).outcome).toBe("off");
    expect(rig.transport.sent).toEqual([]);
  });

  it("does nothing without a provider whose own digest switch is on", async () => {
    rig = await makeRig(baseConfig({ digest_schedule: schedule() }));
    rig.core.add(agentRequest());
    rig.clock.advance(2 * HOUR);
    expect((await rig.chat.tickDigest()).outcome).toBe("no_destination");
    expect(rig.transport.sent).toEqual([]);
  });

  it("starts the interval at the first check, then sends once, to the configured channel only", async () => {
    rig = await makeRig(baseConfig({ slack, digest_schedule: schedule() }));
    rig.core.add(agentRequest({ command: "private command", project: "alpha" }));
    expect((await rig.chat.tickDigest()).outcome).toBe("not_due");
    expect(rig.transport.sent).toEqual([]);
    rig.clock.advance(HOUR);
    expect((await rig.chat.tickDigest()).outcome).toBe("sent");
    expect(rig.transport.sent).toHaveLength(1);
    const sent = rig.transport.sent[0]!;
    expect(sent.request.url).toContain("slack.com");
    expect(sent.body.channel).toBe("C0APPROVALS");
    expect(sent.request.body).toContain("apr_1 Bash");
    expect(sent.request.body).not.toMatch(/private command|alpha/);
    expect(rig.core.audit.at(-1)).toMatchObject({
      actor: "chat:scheduler",
      action: "chat.digest.sent",
      decision: "allowed",
      details: { providers: ["slack"], pending: 1, decided: 0 },
    });
  });

  it("sends at most once per interval and skips when nothing happened since", async () => {
    rig = await makeRig(baseConfig({ slack, digest_schedule: schedule() }));
    rig.core.add(agentRequest());
    await rig.chat.tickDigest();
    rig.clock.advance(HOUR);
    expect((await rig.chat.tickDigest()).outcome).toBe("sent");
    rig.clock.advance(HOUR - 1);
    expect((await rig.chat.tickDigest()).outcome).toBe("not_due");
    rig.clock.advance(1);
    // The same request was already counted and nothing was decided: nothing to say.
    expect((await rig.chat.tickDigest()).outcome).toBe("idle");
    expect(rig.transport.sent).toHaveLength(1);
    rig.chat.noteDecision("approved");
    rig.clock.advance(HOUR);
    expect((await rig.chat.tickDigest()).outcome).toBe("sent");
    expect(rig.transport.sent).toHaveLength(2);
    expect(rig.transport.sent[1]!.request.body).toContain("1 allowed");
  });

  it("waits through quiet hours and sends at the next check after them", async () => {
    const quiet = { timezone: "UTC", start: "09:00", end: "11:00" };
    rig = await makeRig(baseConfig({ slack, digest_schedule: schedule({ quiet_hours: quiet }) }));
    rig.core.add(agentRequest());
    await rig.chat.tickDigest();
    rig.clock.advance(HOUR); // 10:00 UTC, inside the window
    expect(new Date(T0 + HOUR).getUTCHours()).toBe(10);
    expect((await rig.chat.tickDigest()).outcome).toBe("quiet");
    expect(rig.transport.sent).toEqual([]);
    rig.clock.advance(HOUR); // 11:00 UTC, the window is over
    expect((await rig.chat.tickDigest()).outcome).toBe("sent");
  });

  it("a failed send is audited, uses up the interval and does not forget the news", async () => {
    rig = await makeRig(baseConfig({ slack, digest_schedule: schedule() }));
    rig.core.add(agentRequest());
    await rig.chat.tickDigest();
    rig.clock.advance(HOUR);
    rig.transport.response = { status: 500, body: "{}" };
    expect((await rig.chat.tickDigest()).outcome).toBe("failed");
    expect(rig.core.audit.at(-1)).toMatchObject({
      action: "chat.digest.sent",
      decision: "blocked",
    });
    rig.transport.response = { status: 200, body: JSON.stringify({ ok: true }) };
    rig.clock.advance(HOUR - 1);
    expect((await rig.chat.tickDigest()).outcome).toBe("not_due");
    rig.clock.advance(1);
    expect((await rig.chat.tickDigest()).outcome).toBe("sent");
  });
});
