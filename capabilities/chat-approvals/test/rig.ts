// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A pretend Core and pretend chat providers. Every key and secret is generated at runtime; nothing
// here opens a socket or waits on a timer. The request hash is Core's real `requestHash()` over the
// real `previewHash()`, so a card is bound the way the phone link binds it.
import { createHmac, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { previewHash, requestHash } from "../../../core/runtime/src/phone-link";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { createChatApprovals, SECRETS, type ChatApprovals } from "../src";
import type {
  ApprovalSnapshot,
  AuditSink,
  ChatApprovalHost,
  ChatAuditEntry,
  DecideInput,
  HttpRequest,
  HttpResponse,
  HttpTransport,
  RawRequest,
} from "../src/types";

export const T0 = Date.parse("2026-10-22T09:00:00Z");
export const SLACK_WORKSPACE = "T0PHOENIX";
export const SLACK_CHANNEL = "C0APPROVALS";
export const SLACK_OWNER = "U0OWNER";
export const DISCORD_GUILD = "9000000000001";
export const DISCORD_CHANNEL = "9000000000002";
export const DISCORD_OWNER = "9000000000003";

export class ManualClock {
  constructor(public ms = T0) {}
  now = (): number => this.ms;
  advance(ms: number): void {
    this.ms += ms;
  }
}

export interface FakeRequest {
  source: "confirmation" | "agent";
  id: string;
  tool: string;
  project?: string;
  command: string;
  expiresInMs: number;
}

/** Core's pending list; `hostile` text can be placed in `command` and shows up in the title. */
export class FakeCore implements ChatApprovalHost {
  readonly decisions: DecideInput[] = [];
  readonly audit: ChatAuditEntry[] = [];
  private readonly requests = new Map<string, FakeRequest & { createdAt: number }>();

  constructor(private readonly clock: ManualClock) {}

  add(request: FakeRequest): ApprovalSnapshot {
    this.requests.set(`${request.source}:${request.id}`, { ...request, createdAt: this.clock.ms });
    return this.snapshot(request.source, request.id)!;
  }

  /** The agent changes what it is asking for after the card was posted. */
  change(source: "confirmation" | "agent", id: string, command: string): void {
    const r = this.requests.get(`${source}:${id}`)!;
    r.command = command;
  }

  remove(source: "confirmation" | "agent", id: string): void {
    this.requests.delete(`${source}:${id}`);
  }

  private snapshot(source: string, id: string): ApprovalSnapshot | undefined {
    const r = this.requests.get(`${source}:${id}`);
    if (!r) return undefined;
    const expires = new Date(r.createdAt + r.expiresInMs).toISOString();
    const hash = previewHash({ agent: "claude", project: r.project ?? "", command: r.command });
    return {
      source: r.source,
      id: r.id,
      tool: r.tool,
      title: r.command,
      ...(r.project ? { project: r.project } : {}),
      expires_at: expires,
      request_hash: requestHash({
        source: r.source,
        id: r.id,
        tool: r.tool,
        preview_hash: hash,
        expires_at: expires,
      }),
    };
  }

  pending(): ApprovalSnapshot[] {
    return [...this.requests.values()].flatMap((r) => this.snapshot(r.source, r.id) ?? []);
  }

  /** Mimics PhoneLink.decide: refuses a stale hash even if the caller already checked. */
  decide(input: DecideInput): void {
    const current = this.snapshot(input.source, input.id);
    if (!current || current.request_hash !== input.requestHash) throw new Error("refused");
    this.requests.delete(`${input.source}:${input.id}`);
    this.decisions.push(input);
  }

  sink: AuditSink = (entry) => void this.audit.push(entry);
}

export interface Sent {
  request: HttpRequest;
  body: Record<string, unknown>;
}

export class FakeTransport {
  readonly sent: Sent[] = [];
  response: HttpResponse = { status: 200, body: JSON.stringify({ ok: true }) };
  readonly send: HttpTransport = (request) => {
    this.sent.push({ request, body: JSON.parse(request.body) as Record<string, unknown> });
    return Promise.resolve(this.response);
  };
}

export class SlackSigner {
  readonly secret = randomBytes(24).toString("hex");

  sign(body: string, timestampMs: number, secret = this.secret): RawRequest {
    const timestamp = String(Math.floor(timestampMs / 1000));
    const mac = createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");
    return {
      headers: { "x-slack-signature": `v0=${mac}`, "x-slack-request-timestamp": timestamp },
      body: Buffer.from(body),
    };
  }

  press(
    token: string,
    timestampMs: number,
    over: { user?: string; team?: string; channel?: string; responseUrl?: string } = {},
  ): RawRequest {
    const payload = {
      type: "block_actions",
      user: { id: over.user ?? SLACK_OWNER },
      team: { id: over.team ?? SLACK_WORKSPACE },
      channel: { id: over.channel ?? SLACK_CHANNEL },
      response_url: over.responseUrl ?? "https://hooks.slack.com/actions/T/1/x",
      actions: [{ action_id: "phx", value: token }],
    };
    return this.sign(`payload=${encodeURIComponent(JSON.stringify(payload))}`, timestampMs);
  }
}

export class DiscordSigner {
  private readonly pair = generateKeyPairSync("ed25519");
  readonly publicKeyHex = Buffer.from(
    this.pair.publicKey.export({ format: "jwk" }).x as string,
    "base64url",
  ).toString("hex");

  sign(body: string, timestampMs: number, key = this.pair.privateKey): RawRequest {
    const timestamp = String(Math.floor(timestampMs / 1000));
    const signature = sign(null, Buffer.from(timestamp + body), key).toString("hex");
    return {
      headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp },
      body: Buffer.from(body),
    };
  }

  /** A signature from some other key pair, for the wrong-key case. */
  forged(body: string, timestampMs: number): RawRequest {
    return this.sign(body, timestampMs, generateKeyPairSync("ed25519").privateKey);
  }

  press(
    token: string,
    timestampMs: number,
    over: { user?: string; guild?: string; channel?: string } = {},
  ): RawRequest {
    return this.sign(
      JSON.stringify({
        type: 3,
        guild_id: over.guild ?? DISCORD_GUILD,
        channel_id: over.channel ?? DISCORD_CHANNEL,
        member: { user: { id: over.user ?? DISCORD_OWNER } },
        data: { custom_id: token },
      }),
      timestampMs,
    );
  }
}

export const baseConfig = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  projects: ["alpha"],
  slack: {
    enabled: true,
    workspace: SLACK_WORKSPACE,
    channel: SLACK_CHANNEL,
    approvers: [SLACK_OWNER],
  },
  discord: {
    enabled: true,
    workspace: DISCORD_GUILD,
    channel: DISCORD_CHANNEL,
    approvers: [DISCORD_OWNER],
  },
  ...extra,
});

export interface Rig {
  clock: ManualClock;
  core: FakeCore;
  transport: FakeTransport;
  slack: SlackSigner;
  discord: DiscordSigner;
  chat: ChatApprovals;
  harness: Harness;
  /** The generated secret values, by name, to prove they never leak. */
  secrets: Record<string, string>;
  /** Live config the capability reads; tests flip switches here. */
  config: Record<string, unknown>;
}

export const TEAMS_WEBHOOK = "https://phoenix-test.webhook.office.com/webhookb2/abc";

/**
 * Enables the capability through the real manager and permission gateway (in memory) so secrets come
 * from `ctx.secret` exactly as in production. Every secret is generated here at runtime.
 */
export async function makeRig(config: Record<string, unknown> = baseConfig()): Promise<Rig> {
  const clock = new ManualClock();
  const core = new FakeCore(clock);
  const transport = new FakeTransport();
  const slack = new SlackSigner();
  const discord = new DiscordSigner();
  const rig = { clock, core, transport, slack, discord, config } as Rig;
  rig.chat = createChatApprovals({
    host: core,
    audit: core.sink,
    transport: transport.send,
    now: clock.now,
    config: () => rig.config,
  });
  rig.harness = createHarness({ modules: [rig.chat.module] });
  const id = "chat-approvals";
  const secrets: Record<string, string> = {
    [SECRETS.slackBotToken]: randomBytes(12).toString("hex"),
    [SECRETS.slackSigningSecret]: slack.secret,
    [SECRETS.discordBotToken]: randomBytes(12).toString("hex"),
    [SECRETS.discordPublicKey]: discord.publicKeyHex,
    [SECRETS.teamsWebhookUrl]: TEAMS_WEBHOOK,
    [SECRETS.teamsLinkKey]: randomBytes(24).toString("hex"),
  };
  rig.secrets = secrets;
  for (const [name, value] of Object.entries(secrets)) {
    await rig.harness.manager.setSecret(id, name, value);
  }
  await rig.harness.enable(id);
  return rig;
}

export const agentRequest = (over: Partial<FakeRequest> = {}): FakeRequest => ({
  source: "agent",
  id: "apr_1",
  tool: "Bash",
  project: "alpha",
  command: "npm test",
  expiresInMs: 120_000,
  ...over,
});

interface SlackBlock {
  type: string;
  elements?: { value?: string; action_id?: string }[];
}

/** Button tokens by action id from a Slack message or reply body. */
export function slackButtons(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const block of (body.blocks ?? []) as SlackBlock[]) {
    for (const el of block.elements ?? []) {
      if (el.action_id && el.value) out[el.action_id] = el.value;
    }
  }
  return out;
}

interface DiscordRow {
  components: { custom_id: string; label: string }[];
}

/** Button tokens by label from a Discord message body or interaction reply data. */
export function discordButtons(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of (body.components ?? []) as DiscordRow[]) {
    for (const c of row.components) out[c.label] = c.custom_id;
  }
  return out;
}
