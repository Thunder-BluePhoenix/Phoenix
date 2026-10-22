// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHmac } from "node:crypto";
import { AuditLog } from "@phoenix/permissions";
import { EventBus } from "@phoenix/event-bus";
import { MemorySecretStore, SettingsStore, openDatabase } from "@phoenix/persistence";
import type { PhoenixEvent } from "@phoenix/protocol";
import { describe, expect, it } from "vitest";
import { FAKE_GITHUB_TOKEN } from "../../../protocol/testing/fake-secrets";
import { newCoreIdentity, type RelayFrame } from "../src/remote-relay/crypto";
import {
  DedupeWindow,
  FRAME_WINDOW_MS,
  LONG_AGENT_RUN_MS,
  RateLimiter,
  STALE_AFTER_MS,
  TEAM_SHARING_KEY,
  TeamPresence,
  TeamSharing,
  TeamStatus,
  TeamWebhooks,
  WEBHOOK_SECRET_PREFIX,
  WEBHOOK_SETTINGS_KEY,
  WEBHOOK_WINDOW_SECONDS,
  openTeamFrame,
  parseFrameBody,
  parseWebhookPayload,
  sealTeamFrame,
  signWebhook,
  type TeamFrameBody,
  type TeamStatusIdentity,
  type WebhookOutcome,
} from "../src/team-status";

const T0 = Date.parse("2026-10-22T12:00:00Z");

class ManualClock {
  constructor(private current = T0) {}
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

function webhookRig(options: { preBurst?: number; sourceBurst?: number } = {}) {
  const db = openDatabase(":memory:");
  const clock = new ManualClock();
  const settings = new SettingsStore(db);
  const secrets = new MemorySecretStore();
  const audit = new AuditLog(db, () => clock.now());
  const bus = new EventBus({ retryDelayMs: 0 });
  const received: PhoenixEvent[] = [];
  bus.subscribe("test", "*", (event) => {
    received.push(event);
  });
  const hooks = new TeamWebhooks({
    settings,
    secrets,
    bus,
    audit,
    clock,
    preAuthLimit: new RateLimiter(options.preBurst ?? 100, 60),
    sourceLimit: new RateLimiter(options.sourceBurst ?? 100, 60),
  });
  const body = (overrides: Record<string, unknown> = {}) =>
    Buffer.from(
      JSON.stringify({
        event_id: "delivery-0001",
        event_type: "deploy.started",
        severity: "info",
        subject: "api",
        message: "rolling out",
        ...overrides,
      }),
    );
  const deliver = (
    id: string,
    secret: string,
    raw: Buffer = body(),
    at: number = Math.floor(clock.now() / 1000),
  ) =>
    hooks.accept({
      sourceId: id,
      timestamp: String(at),
      signature: signWebhook(secret, at, raw),
      body: raw,
    });
  return { db, clock, settings, secrets, audit, bus, received, hooks, body, deliver };
}

async function refusal(promise: Promise<WebhookOutcome>) {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; message: string; details: readonly string[] };
  }
  throw new Error("expected a refusal");
}

describe("incoming webhooks: authentication", () => {
  async function ready() {
    const rig = webhookRig();
    rig.hooks.setEnabled(true);
    const { secret } = await rig.hooks.createSource("ci-main", ["deploy.started", "build.failed"]);
    return { ...rig, secret };
  }

  it("is off by default: nothing is verified or published until the master switch is on", async () => {
    const rig = webhookRig();
    expect(rig.hooks.status()).toEqual({ enabled: false, sources: [] });
    const { secret } = await rig.hooks.createSource("ci-main", ["deploy.started"]);
    const error = await refusal(rig.deliver("ci-main", secret));
    expect(error).toMatchObject({
      code: "UNAUTHENTICATED",
      message: "Webhook authentication failed",
    });
    expect(rig.received).toEqual([]);
  });

  it("accepts a correctly signed delivery as an untrusted, source-namespaced event", async () => {
    const { deliver, bus, received, secret, audit } = await ready();
    const outcome = await deliver("ci-main", secret);
    expect(outcome).toMatchObject({
      ok: true,
      eventId: expect.stringMatching(/^evt_wh_[0-9a-f]{40}$/),
    });
    await bus.drain();
    expect(received).toHaveLength(1);
    const event = received[0]!;
    expect(event).toMatchObject({
      event_type: "deploy.started",
      source: "webhook-ci-main",
      severity: "info",
      subject: "api",
      payload: { message: "rolling out" },
      metadata: { untrusted: true },
      provenance: { kind: "incoming_webhook", source_id: "ci-main" },
    });
    expect(audit.list({ limit: 1 })[0]).toMatchObject({
      action: "team.webhook.accepted",
      decision: "allowed",
    });
  });

  it("answers every authentication failure identically so nothing about the source leaks", async () => {
    const { deliver, hooks, secret, body, clock } = await ready();
    await hooks.createSource("off-source", ["deploy.started"]);
    hooks.setSourceEnabled("off-source", false);
    const raw = body();
    const at = Math.floor(clock.now() / 1000);
    const attempts: Promise<WebhookOutcome>[] = [
      deliver("ci-main", `${secret}x`), // wrong secret
      deliver("ci-main", secret, raw, at - WEBHOOK_WINDOW_SECONDS - 1), // stale but validly signed
      deliver("nobody", secret), // unknown source
      deliver("off-source", secret), // disabled source
      hooks.accept({ sourceId: "ci-main", timestamp: undefined, signature: undefined, body: raw }),
      hooks.accept({ sourceId: "ci-main", timestamp: String(at), signature: "v1=zz", body: raw }),
      hooks.accept({ sourceId: "../../x", timestamp: String(at), signature: "v1=00", body: raw }),
      hooks.accept({
        sourceId: "ci-main",
        timestamp: String(at),
        signature: `v1=${"0".repeat(64)}`,
        body: raw,
      }),
    ];
    const errors = [];
    for (const attempt of attempts) errors.push(await refusal(attempt));
    for (const error of errors) {
      expect(error).toMatchObject({
        code: "UNAUTHENTICATED",
        message: "Webhook authentication failed",
        details: [],
      });
    }
  });

  it("covers the exact body bytes and the timestamp, not re-serialized JSON", async () => {
    const { hooks, secret, body, clock } = await ready();
    const at = Math.floor(clock.now() / 1000);
    const signed = body();
    const signature = signWebhook(secret, at, signed);
    const reformatted = Buffer.from(JSON.stringify(JSON.parse(signed.toString()), null, 1));
    expect(
      (
        await refusal(
          hooks.accept({
            sourceId: "ci-main",
            timestamp: String(at),
            signature,
            body: reformatted,
          }),
        )
      ).code,
    ).toBe("UNAUTHENTICATED");
    // The same bytes under another timestamp do not verify either: the timestamp is signed.
    expect(
      (
        await refusal(
          hooks.accept({ sourceId: "ci-main", timestamp: String(at + 1), signature, body: signed }),
        )
      ).code,
    ).toBe("UNAUTHENTICATED");
    // A signature computed independently with HMAC-SHA256 over "<ts>.<body>" is what is expected.
    const independent = `v1=${createHmac("sha256", secret).update(`${at}.`).update(signed).digest("hex")}`;
    expect(independent).toBe(signature);
    await expect(
      hooks.accept({
        sourceId: "ci-main",
        timestamp: String(at),
        signature: independent,
        body: signed,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("enforces the replay window at its edges using only the injected clock", async () => {
    const { deliver, secret, body, clock } = await ready();
    const now = Math.floor(clock.now() / 1000);
    await expect(
      deliver("ci-main", secret, body({ event_id: "edge-past-01" }), now - WEBHOOK_WINDOW_SECONDS),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      deliver("ci-main", secret, body({ event_id: "edge-future-1" }), now + WEBHOOK_WINDOW_SECONDS),
    ).resolves.toMatchObject({ ok: true });
    expect(
      (
        await refusal(
          deliver(
            "ci-main",
            secret,
            body({ event_id: "edge-past-02" }),
            now - WEBHOOK_WINDOW_SECONDS - 1,
          ),
        )
      ).code,
    ).toBe("UNAUTHENTICATED");
    expect(
      (
        await refusal(
          deliver(
            "ci-main",
            secret,
            body({ event_id: "edge-future-2" }),
            now + WEBHOOK_WINDOW_SECONDS + 1,
          ),
        )
      ).code,
    ).toBe("UNAUTHENTICATED");
  });

  it("rejects a captured delivery replayed inside the window, and one replayed after it", async () => {
    const { deliver, secret, body, clock, received, bus } = await ready();
    const raw = body();
    const at = Math.floor(clock.now() / 1000);
    await deliver("ci-main", secret, raw, at);
    expect(await refusal(deliver("ci-main", secret, raw, at))).toMatchObject({
      code: "EVENT_DUPLICATE",
    });
    clock.advance((WEBHOOK_WINDOW_SECONDS + 1) * 1000);
    expect(await refusal(deliver("ci-main", secret, raw, at))).toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await bus.drain();
    expect(received).toHaveLength(1);
  });

  it("dedupes by event id per source and does not let one source pre-empt another's ids", async () => {
    const { hooks, secret, deliver, body, bus, received } = await ready();
    const other = await hooks.createSource("ci-other", ["deploy.started"]);
    await deliver("ci-main", secret, body({ event_id: "same-id-001" }));
    await expect(
      deliver("ci-other", other.secret, body({ event_id: "same-id-001" })),
    ).resolves.toMatchObject({ ok: true });
    expect(
      await refusal(
        deliver("ci-main", secret, body({ event_id: "same-id-001", message: "changed" })),
      ),
    ).toMatchObject({ code: "EVENT_DUPLICATE" });
    await bus.drain();
    expect(received.map((e) => e.source).sort()).toEqual(["webhook-ci-main", "webhook-ci-other"]);
    expect(new Set(received.map((e) => e.event_id)).size).toBe(2);
  });

  it("does not use the first secret after rotation, or any secret after revocation", async () => {
    const { hooks, secret, deliver, body, secrets, settings } = await ready();
    const rotated = await hooks.rotateSecret("ci-main");
    expect(rotated.secret).not.toBe(secret);
    expect(
      (await refusal(deliver("ci-main", secret, body({ event_id: "after-rotate1" })))).code,
    ).toBe("UNAUTHENTICATED");
    await expect(
      deliver("ci-main", rotated.secret, body({ event_id: "after-rotate2" })),
    ).resolves.toMatchObject({ ok: true });
    await hooks.revoke("ci-main");
    expect(await secrets.get(`${WEBHOOK_SECRET_PREFIX}ci-main`)).toBeUndefined();
    expect(
      (await refusal(deliver("ci-main", rotated.secret, body({ event_id: "after-revoke1" })))).code,
    ).toBe("UNAUTHENTICATED");
    expect(hooks.status().sources).toEqual([]);
    expect(JSON.stringify(settings.get(WEBHOOK_SETTINGS_KEY, null))).not.toContain("ci-main");
  });

  it("keeps secrets in the secret store only: never in settings, views, events or audit", async () => {
    const { hooks, secret, deliver, settings, audit, received, bus, secrets } = await ready();
    await deliver("ci-main", secret);
    await refusal(deliver("ci-main", `${secret}x`));
    await bus.drain();
    expect(await secrets.get(`${WEBHOOK_SECRET_PREFIX}ci-main`)).toBe(secret);
    expect(secret.length).toBeGreaterThanOrEqual(32);
    const everythingElse = JSON.stringify([
      settings.get(WEBHOOK_SETTINGS_KEY, null),
      hooks.status(),
      received,
      audit.list({ limit: 100 }),
    ]);
    expect(everythingElse).not.toContain(secret);
  });

  it("refuses a stored secret that is too short instead of authenticating against it", async () => {
    const { deliver, secrets, body } = await ready();
    await secrets.set(`${WEBHOOK_SECRET_PREFIX}ci-main`, "short");
    expect((await refusal(deliver("ci-main", "short", body()))).code).toBe("UNAUTHENTICATED");
  });

  it("starts disabled for any stored source that does not say it is enabled", async () => {
    const { settings, secrets, bus, audit, clock, secret, body } = await ready();
    settings.set(WEBHOOK_SETTINGS_KEY, {
      enabled: true,
      sources: { "ci-main": { eventTypes: ["deploy.started"], createdAt: "x" } },
    });
    const reloaded = new TeamWebhooks({ settings, secrets, bus, audit, clock });
    const at = Math.floor(clock.now() / 1000);
    const raw = body();
    expect(
      (
        await refusal(
          reloaded.accept({
            sourceId: "ci-main",
            timestamp: String(at),
            signature: signWebhook(secret, at, raw),
            body: raw,
          }),
        )
      ).code,
    ).toBe("UNAUTHENTICATED");
  });
});

describe("incoming webhooks: validation and limits", () => {
  async function ready(options?: Parameters<typeof webhookRig>[0]) {
    const rig = webhookRig(options);
    rig.hooks.setEnabled(true);
    const { secret } = await rig.hooks.createSource("ci-main", ["deploy.started", "build.failed"]);
    return { ...rig, secret };
  }

  it("rejects an authenticated delivery whose event type the source was not given", async () => {
    const { deliver, secret, body, received } = await ready();
    expect(
      await refusal(
        deliver(
          "ci-main",
          secret,
          body({ event_type: "deploy.succeeded", event_id: "not-allowed1" }),
        ),
      ),
    ).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(received).toEqual([]);
  });

  it("refuses to configure a source for core, dictation, agent or built-in service namespaces", async () => {
    const { hooks } = await ready();
    for (const type of [
      "dictation.idle",
      "agent.session.step",
      "stripe.payment.succeeded",
      "core.started",
      "github.ci.failed",
      "security.kill_switch.disengaged",
      "pet.state.changed",
    ]) {
      await expect(hooks.createSource("bad-source", [type])).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
    }
    expect(hooks.status().sources.map((s) => s.id)).toEqual(["ci-main"]);
  });

  it("enforces a strict payload schema with specific errors only after authentication", async () => {
    const { deliver, secret, body, received } = await ready();
    const bad: Record<string, unknown>[] = [
      { source: "core" },
      { severity: "fatal" },
      { event_id: "short" },
      { event_type: "Deploy.Started" },
      { subject: "line\nbreak" },
      { message: "a\u202eb" },
      { message: "x".repeat(281) },
      { data: { Nested: 1 } },
      { data: { nested: { a: 1 } } },
      { data: { n: Number.NaN } },
      { data: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i])) },
    ];
    for (const overrides of bad) {
      const raw = body({
        event_id: `bad-${received.length}-${Object.keys(overrides)[0]}-xx`,
        ...overrides,
      });
      // NaN serialises to null, which is also not a valid data value.
      expect(await refusal(deliver("ci-main", secret, raw))).toMatchObject({
        code: "INVALID_REQUEST",
      });
    }
    expect(await refusal(deliver("ci-main", secret, Buffer.from("[1,2]")))).toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(await refusal(deliver("ci-main", secret, Buffer.from("{not json")))).toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(received).toEqual([]);
  });

  it("keeps secret-shaped content out of the bus and lets the sender retry the same id", async () => {
    const { deliver, secret, body, bus, received } = await ready();
    const leaky = body({ event_id: "leaky-0001", message: FAKE_GITHUB_TOKEN });
    expect(await refusal(deliver("ci-main", secret, leaky))).toMatchObject({
      code: "SECURITY_POLICY_BLOCKED",
    });
    await expect(
      deliver("ci-main", secret, body({ event_id: "leaky-0001" })),
    ).resolves.toMatchObject({ ok: true });
    await bus.drain();
    expect(received).toHaveLength(1);
  });

  it("rate limits per source after authentication and refills from the injected clock", async () => {
    const { deliver, secret, body, clock, audit } = await ready({ sourceBurst: 2 });
    await deliver("ci-main", secret, body({ event_id: "rate-limit-1" }));
    await deliver("ci-main", secret, body({ event_id: "rate-limit-2" }));
    const limited = await deliver("ci-main", secret, body({ event_id: "rate-limit-3" }));
    expect(limited).toMatchObject({ ok: false, retryAfterMs: 1000 });
    expect(audit.list({ limit: 1 })[0]).toMatchObject({
      action: "team.webhook.refused",
      decision: "blocked",
      details: { reason: "rate_limited" },
    });
    clock.advance(1000);
    await expect(
      deliver("ci-main", secret, body({ event_id: "rate-limit-3" })),
    ).resolves.toMatchObject({ ok: true });
  });

  it("throttles unsignable junk before any secret lookup", async () => {
    const { hooks, secrets, body, clock } = await ready({ preBurst: 3 });
    let lookups = 0;
    const original = secrets.get.bind(secrets);
    secrets.get = async (ref) => {
      lookups++;
      return original(ref);
    };
    const at = String(Math.floor(clock.now() / 1000));
    const outcomes: unknown[] = [];
    for (let i = 0; i < 6; i++) {
      try {
        outcomes.push(
          await hooks.accept({
            sourceId: "ci-main",
            timestamp: at,
            signature: "not-a-signature",
            body: body(),
          }),
        );
      } catch (error) {
        outcomes.push((error as { code: string }).code);
      }
    }
    expect(outcomes.slice(0, 3)).toEqual(["UNAUTHENTICATED", "UNAUTHENTICATED", "UNAUTHENTICATED"]);
    expect(outcomes.slice(3).every((o) => (o as { ok?: boolean }).ok === false)).toBe(true);
    expect(lookups).toBe(0);
  });

  it("never lets strangers with a wrong signature spend a real source's delivery budget", async () => {
    const { hooks, deliver, secret, body, clock } = await ready({ preBurst: 2, sourceBurst: 5 });
    const at = String(Math.floor(clock.now() / 1000));
    for (let i = 0; i < 20; i++) {
      await hooks
        .accept({
          sourceId: "ci-main",
          timestamp: at,
          signature: `v1=${"0".repeat(64)}`,
          body: body(),
        })
        .catch(() => undefined);
    }
    await expect(
      deliver("ci-main", secret, body({ event_id: "after-flood-1" })),
    ).resolves.toMatchObject({ ok: true });
  });

  it("drops an in-flight delivery whose source is revoked while the secret is being read", async () => {
    const { hooks, secrets, secret, body, clock, received, bus } = await ready();
    const release = Promise.withResolvers<void>();
    const original = secrets.get.bind(secrets);
    secrets.get = async (ref) => {
      const value = await original(ref);
      await release.promise;
      return value;
    };
    const at = Math.floor(clock.now() / 1000);
    const raw = body({ event_id: "in-flight-1" });
    const pending = hooks
      .accept({
        sourceId: "ci-main",
        timestamp: String(at),
        signature: signWebhook(secret, at, raw),
        body: raw,
      })
      .catch((error: unknown) => error);
    await hooks.revoke("ci-main");
    release.resolve();
    expect(((await pending) as { code: string }).code).toBe("UNAUTHENTICATED");
    await bus.drain();
    expect(received.filter((e) => e.event_id.startsWith("evt_wh_"))).toEqual([]);
  });

  it("charges unknown source ids to one shared bucket so guessing ids cannot starve a real source", async () => {
    const { hooks, body, clock, secret, deliver } = await ready({ preBurst: 2 });
    const at = String(Math.floor(clock.now() / 1000));
    for (let i = 0; i < 10; i++) {
      await hooks
        .accept({
          sourceId: `guess-${i}`,
          timestamp: at,
          signature: `v1=${"0".repeat(64)}`,
          body: body(),
        })
        .catch(() => undefined);
    }
    await expect(deliver("ci-main", secret)).resolves.toMatchObject({ ok: true });
  });

  it("bounds audit growth under an unauthenticated flood and reports how many it suppressed", async () => {
    const { hooks, body, clock, audit } = await ready();
    const at = String(Math.floor(clock.now() / 1000));
    for (let i = 0; i < 50; i++) {
      await hooks
        .accept({
          sourceId: "ci-main",
          timestamp: at,
          signature: `v1=${"1".repeat(64)}`,
          body: body(),
        })
        .catch(() => undefined);
    }
    const refused = audit.list({ limit: 200 }).filter((e) => e.action === "team.webhook.refused");
    expect(refused.length).toBeLessThanOrEqual(6);
    clock.advance(60_000);
    await hooks
      .accept({
        sourceId: "ci-main",
        timestamp: String(Math.floor(clock.now() / 1000)),
        signature: `v1=${"1".repeat(64)}`,
        body: body(),
      })
      .catch(() => undefined);
    expect(audit.list({ limit: 1 })[0]!.details).toMatchObject({
      reason: "bad_signature",
      suppressed: expect.any(Number),
    });
  });

  it("fails closed when the dedupe table is full instead of forgetting an id inside the window", () => {
    const window = new DedupeWindow(1000, 3, 2);
    expect(window.claim("a", "1", 0)).toBe("claimed");
    expect(window.claim("a", "2", 0)).toBe("claimed");
    expect(window.claim("a", "3", 0)).toBe("full");
    expect(window.claim("b", "1", 0)).toBe("claimed");
    expect(window.claim("b", "2", 0)).toBe("full");
    expect(window.claim("a", "1", 0)).toBe("duplicate");
    expect(window.claim("a", "3", 1001)).toBe("claimed");
  });

  it("caps tracked rate limit keys", () => {
    const limiter = new RateLimiter(1, 1, 2);
    expect(limiter.take("a", 0).ok).toBe(true);
    expect(limiter.take("b", 0).ok).toBe(true);
    expect(limiter.take("c", 0).ok).toBe(true); // overflow bucket, first use
    expect(limiter.take("d", 0).ok).toBe(false); // shares it
    expect(limiter.take("a", 0).ok).toBe(false);
  });

  it("limits the number of sources and validates source ids", async () => {
    const { hooks } = await ready();
    for (const id of ["A", "ab", "../x", "x".repeat(33), "9abc", 7, null]) {
      await expect(hooks.createSource(id, ["deploy.started"])).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
    }
    await expect(hooks.createSource("ci-main", ["deploy.started"])).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    for (let i = 1; i < 16; i++) await hooks.createSource(`source-${i}`, ["deploy.started"]);
    await expect(hooks.createSource("one-too-many", ["deploy.started"])).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("parseWebhookPayload returns only validated fields", () => {
    expect(
      parseWebhookPayload({
        event_id: "abcdefgh",
        event_type: "build.failed",
        data: { n: 1, ok: false, s: "" },
      }),
    ).toEqual({
      event_id: "abcdefgh",
      event_type: "build.failed",
      data: { n: 1, ok: false, s: "" },
    });
  });
});

describe("team sharing (outgoing)", () => {
  function sharingRig(longRunMs?: number) {
    const db = openDatabase(":memory:");
    const settings = new SettingsStore(db);
    const clock = new ManualClock();
    const sharing = new TeamSharing(settings, clock, longRunMs);
    return { settings, clock, sharing };
  }
  const started = (type: string, correlation = "c1") => ({
    event_type: type,
    source: "ci",
    correlation_id: correlation,
  });

  it("shares nothing by default, even while states are being observed", () => {
    const { sharing } = sharingRig();
    sharing.observe(started("deploy.started"));
    expect(sharing.outgoing()).toEqual({ sharing: false, items: [] });
    expect(sharing.view()).toMatchObject({
      enabled: false,
      consent: { deploying: false, agent_run: false, meeting: false },
    });
  });

  it("needs both the master switch and per-item consent", () => {
    const { sharing } = sharingRig();
    sharing.observe(started("deploy.started", "d1"));
    sharing.observe(started("kage.meeting.started", "m1"));
    sharing.setEnabled(true);
    expect(sharing.outgoing()).toEqual({ sharing: true, items: [] });
    sharing.setConsent({ deploying: true });
    expect(sharing.outgoing().items.map((i) => i.kind)).toEqual(["deploying"]);
    sharing.setConsent({ meeting: true });
    expect(sharing.outgoing().items.map((i) => i.kind)).toEqual(["deploying", "meeting"]);
    sharing.setConsent({ deploying: false });
    expect(sharing.outgoing().items.map((i) => i.kind)).toEqual(["meeting"]);
    sharing.setEnabled(false);
    expect(sharing.outgoing()).toEqual({ sharing: false, items: [] });
  });

  it("carries only a kind and a minute-rounded start: no names, ids or payload", () => {
    const { sharing, clock } = sharingRig();
    sharing.setEnabled(true);
    sharing.setConsent({ deploying: true });
    clock.advance(37_123);
    sharing.observe({
      event_type: "deploy.started",
      source: "ci",
      correlation_id: "secret-project-codename",
      subject: "repo/secret",
    });
    const outgoing = sharing.outgoing();
    expect(outgoing.items).toEqual([
      { kind: "deploying", since: Math.floor((T0 + 37_123) / 60_000) * 60_000 },
    ]);
    expect(JSON.stringify(outgoing)).not.toMatch(/secret|ci|repo/);
  });

  it("shares an agent run only once it has been running long enough", () => {
    const { sharing, clock } = sharingRig();
    sharing.setEnabled(true);
    sharing.setConsent({ agent_run: true });
    sharing.observe(started("agent_run.started", "run1"));
    expect(sharing.outgoing().items).toEqual([]);
    clock.advance(LONG_AGENT_RUN_MS);
    expect(sharing.outgoing().items.map((i) => i.kind)).toEqual(["agent_run"]);
    sharing.observe(started("agent_run.completed", "run1"));
    expect(sharing.outgoing().items).toEqual([]);
  });

  it("stops sharing when the end event arrives, and when an end event never does", () => {
    const { sharing, clock } = sharingRig();
    sharing.setEnabled(true);
    sharing.setConsent({ deploying: true, meeting: true });
    sharing.observe(started("deploy.started", "d1"));
    sharing.observe(started("kage.meeting.started", "m1"));
    sharing.observe(started("deploy.failed", "d1"));
    expect(sharing.outgoing().items.map((i) => i.kind)).toEqual(["meeting"]);
    clock.advance(6 * 60 * 60_000);
    expect(sharing.outgoing().items).toEqual([]);
  });

  it("ignores events from incoming webhooks and unrelated event types", () => {
    const { sharing } = sharingRig();
    sharing.setEnabled(true);
    sharing.setConsent({ deploying: true });
    sharing.observe({ event_type: "deploy.started", source: "webhook-ci-main" });
    sharing.observe({ event_type: "build.started", source: "ci" });
    expect(sharing.outgoing().items).toEqual([]);
  });

  it("rejects an unknown consent kind or non-boolean value without changing anything", () => {
    const { sharing, settings } = sharingRig();
    expect(() => sharing.setConsent({ deploying: true, location: true })).toThrow(RangeError);
    expect(() => sharing.setConsent({ meeting: "yes" as unknown as boolean })).toThrow(RangeError);
    expect(sharing.view().consent).toEqual({ deploying: false, agent_run: false, meeting: false });
    expect(settings.get(TEAM_SHARING_KEY, null)).toBeNull();
  });

  it("persists choices, and treats malformed stored settings as off", () => {
    const { sharing, settings, clock } = sharingRig();
    sharing.setEnabled(true);
    sharing.setConsent({ meeting: true });
    expect(new TeamSharing(settings, clock).view()).toMatchObject({
      enabled: true,
      consent: { meeting: true, deploying: false },
    });
    settings.set(TEAM_SHARING_KEY, { enabled: "true", consent: { meeting: 1 } });
    expect(new TeamSharing(settings, clock).view()).toMatchObject({
      enabled: false,
      consent: { meeting: false },
    });
    settings.set(TEAM_SHARING_KEY, "garbage");
    expect(new TeamSharing(settings, clock).view().enabled).toBe(false);
  });

  it("notifies subscribers on consent and state changes until they unsubscribe", () => {
    const { sharing } = sharingRig();
    let calls = 0;
    const off = sharing.subscribe(() => calls++);
    sharing.setEnabled(true);
    sharing.observe(started("deploy.started"));
    sharing.observe(started("build.started")); // ignored: no notification
    off();
    sharing.setEnabled(false);
    expect(calls).toBe(2);
  });
});

describe("team presence (incoming)", () => {
  const identity = newCoreIdentity();
  const body = (overrides: Partial<TeamFrameBody> = {}): TeamFrameBody => ({
    v: 1,
    sentAt: T0,
    sharing: true,
    items: [{ kind: "deploying", since: T0 - 120_000 }],
    ...overrides,
  });
  function presenceRig() {
    const presence = new TeamPresence();
    presence.addMember({ id: "ana", label: "Ana", publicKey: identity.publicKey });
    presence.addMember({ id: "bo", label: "Bo", publicKey: identity.publicKey });
    return presence;
  }

  it("aggregates only members who are on the roster and say they are sharing", () => {
    const presence = presenceRig();
    expect(presence.ingest("ana", body(), T0)).toEqual({ ok: true });
    expect(presence.ingest("bo", body({ sharing: false, items: [] }), T0)).toEqual({ ok: true });
    expect(presence.ingest("mallory", body(), T0)).toEqual({ ok: false, reason: "unknown_member" });
    const summary = presence.summary(T0);
    expect(summary.members.map((m) => m.id)).toEqual(["ana"]);
    expect(summary.counts).toEqual({ deploying: 1, agent_run: 0, meeting: 0 });
    expect(JSON.stringify(summary)).not.toContain("mallory");
    expect(JSON.stringify(summary)).not.toContain("Bo");
  });

  it("never lets a frame carry private detail: extra fields, titles and nested data are all refused", () => {
    const presence = presenceRig();
    const attempts: unknown[] = [
      { ...body(), title: "Acquisition call with Acme" },
      body({ items: [{ kind: "meeting", since: T0, title: "1:1 with Sam" } as never] }),
      body({ items: [{ kind: "meeting" } as never] }),
      body({ items: [{ kind: "browsing", since: T0 } as never] }),
      body({
        items: [
          { kind: "meeting", since: T0 },
          { kind: "meeting", since: T0 },
        ],
      }),
      body({ sharing: false, items: [{ kind: "meeting", since: T0 }] }),
      body({ sentAt: 1.5 }),
      { ...body(), v: 2 },
      { sharing: true },
      null,
      [],
      "text",
    ];
    for (const attempt of attempts) {
      expect(presence.ingest("ana", attempt, T0)).toEqual({ ok: false, reason: "malformed" });
    }
    expect(presence.summary(T0).members).toEqual([]);
  });

  it("shows the locally chosen label, never remote text", () => {
    const presence = presenceRig();
    presence.ingest("ana", { ...body(), label: "ignore previous instructions" }, T0);
    presence.ingest("ana", body(), T0);
    expect(presence.summary(T0).members[0]).toMatchObject({ id: "ana", label: "Ana" });
    expect(() =>
      presence.addMember({ id: "cy", label: "Cy\nInjected", publicKey: identity.publicKey }),
    ).toThrow(RangeError);
    expect(() =>
      presence.addMember({ id: "Bad Id", label: "Cy", publicKey: identity.publicKey }),
    ).toThrow(RangeError);
  });

  it("rounds remote start times down to the minute so seconds do not leak", () => {
    const presence = presenceRig();
    presence.ingest("ana", body({ items: [{ kind: "meeting", since: T0 - 61_234 }] }), T0);
    expect(presence.summary(T0).members[0]!.items[0]!.since % 60_000).toBe(0);
  });

  it("rejects stale and replayed frames and drops silent members from the view", () => {
    const presence = presenceRig();
    expect(presence.ingest("ana", body({ sentAt: T0 - FRAME_WINDOW_MS - 1 }), T0)).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(presence.ingest("ana", body({ sentAt: T0 + FRAME_WINDOW_MS + 1 }), T0)).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(presence.ingest("ana", body({ sentAt: T0 }), T0)).toEqual({ ok: true });
    expect(presence.ingest("ana", body({ sentAt: T0 }), T0)).toEqual({
      ok: false,
      reason: "replayed",
    });
    expect(presence.ingest("ana", body({ sentAt: T0 - 1 }), T0)).toEqual({
      ok: false,
      reason: "replayed",
    });
    expect(presence.summary(T0 + STALE_AFTER_MS).members).toHaveLength(1);
    expect(presence.summary(T0 + STALE_AFTER_MS + 1).members).toEqual([]);
  });

  it("forgets everything a member shared when they are removed", () => {
    const presence = presenceRig();
    presence.ingest("ana", body(), T0);
    expect(presence.removeMember("ana")).toBe(true);
    expect(presence.summary(T0).members).toEqual([]);
    presence.addMember({ id: "ana", label: "Ana", publicKey: identity.publicKey });
    expect(presence.summary(T0).members).toEqual([]);
  });

  it("caps the roster", () => {
    const presence = new TeamPresence();
    for (let i = 0; i < 32; i++)
      presence.addMember({ id: `m${i + 10}`, label: "x", publicKey: identity.publicKey });
    expect(() =>
      presence.addMember({ id: "m99", label: "x", publicKey: identity.publicKey }),
    ).toThrow(/full/);
  });

  it("parseFrameBody is strict about the exact key set", () => {
    expect(parseFrameBody(body())).toMatchObject({ v: 1, sharing: true });
    expect(parseFrameBody({ ...body(), extra: 1 })).toBeNull();
    const { items: _items, ...missing } = body();
    expect(parseFrameBody(missing)).toBeNull();
  });
});

describe("team status between two installs", () => {
  const keys = { ana: newCoreIdentity(), bo: newCoreIdentity(), eve: newCoreIdentity() };
  function install(
    id: "ana" | "bo",
    clock: ManualClock,
    peers: Record<string, Parameters<TeamPresence["addMember"]>[0]>,
  ) {
    const db = openDatabase(":memory:");
    const sharing = new TeamSharing(new SettingsStore(db), clock);
    const presence = new TeamPresence();
    for (const member of Object.values(peers)) presence.addMember(member);
    const outbox: { to: string; frame: RelayFrame }[] = [];
    const identity: TeamStatusIdentity = { id, privateKeyPem: async () => keys[id].privateKey };
    const status = new TeamStatus({
      sharing,
      presence,
      identity,
      clock,
      send: async (to, frame) => {
        outbox.push({ to, frame });
      },
    });
    return { sharing, presence, status, outbox };
  }
  function pair() {
    const clock = new ManualClock();
    const ana = install("ana", clock, {
      bo: { id: "bo", label: "Bo", publicKey: keys.bo.publicKey },
    });
    const bo = install("bo", clock, {
      ana: { id: "ana", label: "Ana", publicKey: keys.ana.publicKey },
    });
    return { clock, ana, bo };
  }

  it("shows each install the other's consented state and nothing else", async () => {
    const { ana, bo, clock } = pair();
    ana.sharing.setEnabled(true);
    ana.sharing.setConsent({ deploying: true });
    ana.sharing.observe({ event_type: "deploy.started", source: "ci", correlation_id: "d1" });
    ana.sharing.observe({
      event_type: "kage.meeting.started",
      source: "kage",
      correlation_id: "m1",
    });
    const report = await ana.status.broadcast();
    expect(report).toMatchObject({ delivered: ["bo"], failed: [] });
    expect(report.sent!.items.map((i) => i.kind)).toEqual(["deploying"]);
    expect(await bo.status.receive(ana.outbox[0]!.frame)).toEqual({ ok: true });
    const view = bo.status.view();
    expect(view.presence.members).toEqual([
      { id: "ana", label: "Ana", items: [{ kind: "deploying", since: expect.any(Number) }] },
    ]);
    expect(view.presence.counts).toEqual({ deploying: 1, agent_run: 0, meeting: 0 });
    // Bo shares nothing, and Ana sees nothing from Bo.
    expect(await bo.status.broadcast()).toEqual({ sent: null, delivered: [], failed: [] });
    expect(bo.outbox).toEqual([]);
    expect(ana.status.view().presence.members).toEqual([]);
    expect(clock.now()).toBe(T0);
  });

  it("encrypts end to end: the frame carries no readable state", async () => {
    const { ana } = pair();
    ana.sharing.setEnabled(true);
    ana.sharing.setConsent({ meeting: true });
    ana.sharing.observe({
      event_type: "kage.meeting.started",
      source: "kage",
      correlation_id: "m1",
    });
    await ana.status.broadcast();
    const wire = JSON.stringify(ana.outbox[0]!.frame);
    expect(wire).not.toMatch(/meeting|sharing|items|since/);
  });

  it("sends one final not-sharing frame when sharing is turned off, then goes quiet", async () => {
    const { ana, bo } = pair();
    ana.sharing.setEnabled(true);
    ana.sharing.setConsent({ deploying: true });
    ana.sharing.observe({ event_type: "deploy.started", source: "ci", correlation_id: "d1" });
    await ana.status.broadcast();
    await bo.status.receive(ana.outbox[0]!.frame);
    expect(bo.status.view().presence.members).toHaveLength(1);
    ana.sharing.setEnabled(false);
    expect(await ana.status.broadcast()).toMatchObject({ sent: { sharing: false, items: [] } });
    await bo.status.receive(ana.outbox[1]!.frame);
    expect(bo.status.view().presence.members).toEqual([]);
    expect(await ana.status.broadcast()).toEqual({ sent: null, delivered: [], failed: [] });
    expect(ana.outbox).toHaveLength(2);
  });

  it("rejects a replayed frame, a forged sender and a frame from an unrostered install", async () => {
    const { ana, bo, clock } = pair();
    ana.sharing.setEnabled(true);
    ana.sharing.setConsent({ deploying: true });
    ana.sharing.observe({ event_type: "deploy.started", source: "ci", correlation_id: "d1" });
    await ana.status.broadcast();
    const frame = ana.outbox[0]!.frame;
    expect(await bo.status.receive(frame)).toEqual({ ok: true });
    expect(await bo.status.receive(frame)).toEqual({ ok: false, reason: "replayed" });
    // Eve encrypts to Bo's public key and claims to be Ana: the signature is not Ana's.
    const forged = sealTeamFrame("ana", "bo", keys.bo.publicKey, keys.eve.privateKey, {
      v: 1,
      sentAt: clock.now() + 1,
      sharing: true,
      items: [{ kind: "meeting", since: T0 }],
    });
    expect(await bo.status.receive(forged)).toEqual({ ok: false, reason: "malformed" });
    expect(bo.status.view().presence.counts.meeting).toBe(0);
    const stranger = sealTeamFrame("eve", "bo", keys.bo.publicKey, keys.eve.privateKey, {
      v: 1,
      sentAt: clock.now() + 2,
      sharing: true,
      items: [],
    });
    expect(await bo.status.receive(stranger)).toEqual({ ok: false, reason: "unknown_member" });
  });

  it("does not open a frame addressed to someone else or altered in transit", () => {
    const body: TeamFrameBody = { v: 1, sentAt: T0, sharing: true, items: [] };
    const frame = sealTeamFrame("ana", "bo", keys.bo.publicKey, keys.ana.privateKey, body);
    expect(openTeamFrame("bo", "ana", keys.ana.publicKey, keys.bo.privateKey, frame)).toEqual(body);
    expect(openTeamFrame("eve", "ana", keys.ana.publicKey, keys.eve.privateKey, frame)).toBeNull();
    expect(
      openTeamFrame("bo", "ana", keys.ana.publicKey, keys.bo.privateKey, {
        ...frame,
        tag: frame.iv,
      }),
    ).toBeNull();
    expect(openTeamFrame("bo", "eve", keys.eve.publicKey, keys.bo.privateKey, frame)).toBeNull();
    expect(
      openTeamFrame("bo", "ana", keys.ana.publicKey, keys.bo.privateKey, {
        ...frame,
        ciphertext: "A".repeat(5000),
      }),
    ).toBeNull();
  });

  it("reports failed deliveries per member without throwing, and reads the key at each use", async () => {
    const clock = new ManualClock();
    const db = openDatabase(":memory:");
    const sharing = new TeamSharing(new SettingsStore(db), clock);
    const presence = new TeamPresence();
    presence.addMember({ id: "bo", label: "Bo", publicKey: keys.bo.publicKey });
    presence.addMember({ id: "cy", label: "Cy", publicKey: keys.eve.publicKey });
    let key: string | undefined = undefined;
    const status = new TeamStatus({
      sharing,
      presence,
      clock,
      identity: { id: "ana", privateKeyPem: async () => key },
      send: async (to) => {
        if (to === "cy") throw new Error("relay down");
      },
    });
    sharing.setEnabled(true);
    expect(await status.broadcast()).toMatchObject({ delivered: [], failed: ["bo", "cy"] });
    key = keys.ana.privateKey;
    expect(await status.broadcast()).toMatchObject({ delivered: ["bo"], failed: ["cy"] });
  });
});
