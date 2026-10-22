// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Chat approvals (Phase 86): answer a pending Phoenix or agent approval from Slack or Discord, and
// get notified in Teams. A chat button press is never authority by itself. Each provider callback is
// first authenticated with the provider's own signing scheme (Slack HMAC v0, Discord Ed25519), then
// mapped to an explicitly allow-listed owner identity, bound to the exact request through the
// request_hash Core computes, single-use, expiring, and recorded with the actor `chat:<provider>:<user>`.
// Allow leads to a confirm step. "Approve from chat" is per project and OFF by default; it is checked
// before a card exists and again when a button is pressed. Bot tokens, signing secrets and keys come
// only from ctx.secret. Every network call goes through the injected transport.
//
// SIMULATED EVIDENCE ONLY: nothing here has talked to Slack, Discord or Teams. See docs/chat-approvals.md.
import { defineCapability, type CapabilityContext, type CapabilityModule } from "@phoenix/sdk";
import { ApprovalBinding, AuditThrottle, ReplayGuard } from "./binding";
import { cardView, digestText, cardText } from "./cards";
import { CONFIG_SCHEMA, chatAllowed, parseConfig, providerReady, type ChatConfig } from "./config";
import {
  discordCardBody,
  discordPong,
  discordPost,
  discordReply,
  parseDiscordInteraction,
  type DiscordInbound,
  verifyDiscordRequest,
} from "./discord";
import {
  parseSlackPress,
  slackCardBlocks,
  slackPost,
  slackReply,
  slackRespond,
  verifySlackRequest,
  type SlackPress,
} from "./slack";
import {
  linkMatches,
  type LinkBinding,
  signDeepLink,
  teamsCard,
  teamsNotice,
  teamsPost,
  verifyDeepLink,
} from "./teams";
import {
  ParseError,
  SIGNATURE_WINDOW_MS,
  SignatureError,
  TransportError,
  type ApprovalSnapshot,
  type AuditSink,
  type CardView,
  type ChatApprovalHost,
  type ChatReply,
  type HttpTransport,
  type Provider,
  type RawRequest,
  type RefusalReason,
} from "./types";

export * from "./binding";
export * from "./cards";
export * from "./config";
export * from "./discord";
export * from "./headers";
export * from "./slack";
export * from "./teams";
export * from "./types";

/** Secret names (OS keychain through ctx.secret). None of these may ever appear in config. */
export const SECRETS = {
  slackBotToken: "slack_bot_token",
  slackSigningSecret: "slack_signing_secret",
  discordBotToken: "discord_bot_token",
  discordPublicKey: "discord_public_key",
  teamsWebhookUrl: "teams_webhook_url",
  teamsLinkKey: "teams_link_key",
} as const;

const MAX_POSTED = 500;

export interface ChatApprovalsOptions {
  /** Core's pending list and audited decision path. */
  host: ChatApprovalHost;
  /** Receives every audit row (the runtime passes `permissions.audit.record`). */
  audit: AuditSink;
  /** Every outgoing HTTPS call. Required: this package never opens a socket itself. */
  transport: HttpTransport;
  now?: () => number;
  /**
   * Live configuration. The capability manager hands a capability a frozen copy at enable time, so
   * a project switched OFF afterwards would stay on until a restart; the runtime SHOULD pass a reader
   * of the stored config here. Default: the config the capability was enabled with.
   */
  config?: () => Readonly<Record<string, unknown>>;
}

export type TeamsLinkResult =
  | { kind: "show"; source: "confirmation" | "agent"; id: string; view: CardView }
  | { kind: "refused"; reason: RefusalReason | "bad_link" };

export interface PostPendingResult {
  cards: Record<Provider, number>;
  notices: Record<Provider, number>;
  /** Pending requests that are not switched on for chat (no card was made for them). */
  skipped: number;
}

export interface DigestResult {
  sent: Record<Provider, boolean>;
  text: string;
}

/** What {@link createChatApprovals} returns. */
export interface ChatApprovals {
  /** Register with the capability manager. */
  module: CapabilityModule;
  /** The inbound door the runtime's HTTP route calls with the raw provider request. */
  handleCallback(provider: "slack" | "discord", request: RawRequest): Promise<ChatReply>;
  /** What Phoenix does when opened from a Teams link. */
  openTeamsLink(link: string): Promise<TeamsLinkResult>;
  postPending(): Promise<PostPendingResult>;
  postDigest(): Promise<DigestResult>;
  binding: ApprovalBinding;
}

/** A fresh instance (its own token table and replay memory). Phoenix Core uses one per process. */
export function createChatApprovals(options: ChatApprovalsOptions): ChatApprovals {
  const now = options.now ?? Date.now;
  let ctx: CapabilityContext | undefined;
  const config = (): ChatConfig =>
    parseConfig(options.config ? options.config() : (ctx?.config ?? {}));
  const binding = new ApprovalBinding({ host: options.host, config, now, audit: options.audit });
  const replay = new ReplayGuard(SIGNATURE_WINDOW_MS * 2);
  const throttle = new AuditThrottle(options.audit);
  const posted = new Map<string, string>();

  const secret = async (name: string): Promise<string> => (await ctx?.secret(name)) ?? "";

  function refusedCallback(provider: Provider, reason: string, status: number): ChatReply {
    // No provider identity is known yet (the signature failed), so the actor is the channel itself.
    throttle.record(now(), {
      actor: `chat:${provider}:unauthenticated`,
      action: "chat.callback.refused",
      decision: "blocked",
      details: { provider, reason },
    });
    return { status };
  }

  async function handleSlack(request: RawRequest): Promise<ChatReply> {
    const signingSecret = await secret(SECRETS.slackSigningSecret);
    let signature: string;
    try {
      signature = verifySlackRequest(request, signingSecret, now());
    } catch (err) {
      if (err instanceof SignatureError) return refusedCallback("slack", err.reason, 401);
      throw err;
    }
    if (!replay.claim(`slack:${signature}`, now()))
      return refusedCallback("slack", "replayed", 401);
    let press: SlackPress;
    try {
      press = parseSlackPress(request.body);
    } catch (err) {
      if (err instanceof ParseError) return { status: 400 };
      throw err;
    }
    const outcome = binding.press(press.interaction);
    if (press.responseUrl !== undefined) {
      try {
        await slackRespond(
          options.transport,
          press.responseUrl,
          slackReply(outcome, press.interaction.userId),
          ctx?.signal,
        );
      } catch (err) {
        if (!(err instanceof TransportError)) throw err;
        ctx?.logger.warn("Slack follow-up failed");
      }
    }
    return { status: 200 };
  }

  async function handleDiscord(request: RawRequest): Promise<ChatReply> {
    const publicKey = await secret(SECRETS.discordPublicKey);
    let signature: string;
    try {
      signature = verifyDiscordRequest(request, publicKey, now());
    } catch (err) {
      if (err instanceof SignatureError) return refusedCallback("discord", err.reason, 401);
      throw err;
    }
    if (!replay.claim(`discord:${signature}`, now()))
      return refusedCallback("discord", "replayed", 401);
    let inbound: DiscordInbound;
    try {
      inbound = parseDiscordInteraction(request.body);
    } catch (err) {
      if (err instanceof ParseError) return { status: 400 };
      throw err;
    }
    if (inbound.kind === "ping") return { status: 200, json: discordPong() };
    const outcome = binding.press(inbound.interaction);
    return { status: 200, json: discordReply(outcome, inbound.interaction.userId) };
  }

  /** Both providers' inbound door. Teams has none, by design (see teams.ts). */
  async function handleCallback(
    provider: "slack" | "discord",
    request: RawRequest,
  ): Promise<ChatReply> {
    if (ctx === undefined) return { status: 503 };
    return provider === "slack" ? await handleSlack(request) : await handleDiscord(request);
  }

  const key = (provider: Provider, s: ApprovalSnapshot): string =>
    `${provider}:${s.source}:${s.id}`;

  async function postSlack(cfg: ChatConfig, s: ApprovalSnapshot): Promise<boolean> {
    const token = await secret(SECRETS.slackBotToken);
    if (token === "") return false;
    binding.invalidate(s.source, s.id, "slack");
    const issued = binding.issueCard("slack", s);
    if (!issued) return false;
    const view = cardView(s);
    try {
      await slackPost(
        options.transport,
        token,
        cfg.slack.channel,
        cardText(view),
        slackCardBlocks(view, issued.allow, issued.deny),
        ctx?.signal,
      );
    } catch (err) {
      binding.invalidate(s.source, s.id, "slack");
      if (err instanceof TransportError) return false;
      throw err;
    }
    return true;
  }

  async function postDiscord(cfg: ChatConfig, s: ApprovalSnapshot): Promise<boolean> {
    const token = await secret(SECRETS.discordBotToken);
    if (token === "") return false;
    binding.invalidate(s.source, s.id, "discord");
    const issued = binding.issueCard("discord", s);
    if (!issued) return false;
    try {
      await discordPost(
        options.transport,
        token,
        cfg.discord.channel,
        discordCardBody(cardView(s), issued.allow, issued.deny),
        ctx?.signal,
      );
    } catch (err) {
      binding.invalidate(s.source, s.id, "discord");
      if (err instanceof TransportError) return false;
      throw err;
    }
    return true;
  }

  async function postTeams(cfg: ChatConfig, s: ApprovalSnapshot): Promise<boolean> {
    const webhook = await secret(SECRETS.teamsWebhookUrl);
    const link = signDeepLink(await secret(SECRETS.teamsLinkKey), s, now(), cfg.ttlMs);
    if (webhook === "" || link === undefined) return false;
    try {
      await teamsPost(options.transport, webhook, teamsCard(cardView(s), link), ctx?.signal);
    } catch (err) {
      if (err instanceof TransportError) return false;
      throw err;
    }
    return true;
  }

  async function noticeTo(provider: Provider, cfg: ChatConfig, message: string): Promise<boolean> {
    try {
      if (provider === "slack") {
        const token = await secret(SECRETS.slackBotToken);
        if (token === "") return false;
        await slackPost(
          options.transport,
          token,
          cfg.slack.channel,
          message,
          [{ type: "section", text: { type: "plain_text", text: message, emoji: false } }],
          ctx?.signal,
        );
      } else if (provider === "discord") {
        const token = await secret(SECRETS.discordBotToken);
        if (token === "") return false;
        await discordPost(
          options.transport,
          token,
          cfg.discord.channel,
          {
            content: message,
            allowed_mentions: { parse: [] },
          },
          ctx?.signal,
        );
      } else {
        const webhook = await secret(SECRETS.teamsWebhookUrl);
        if (webhook === "") return false;
        await teamsPost(options.transport, webhook, teamsNotice(message), ctx?.signal);
      }
    } catch (err) {
      if (err instanceof TransportError) return false;
      throw err;
    }
    return true;
  }

  const wantsNotice = (cfg: ChatConfig, p: Provider): boolean =>
    p === "teams" ? cfg.teams.enabled && cfg.teams.notify : providerReady(cfg, p) && cfg[p].notify;

  /**
   * Posts a card for every pending request that is switched on for chat (Slack, Discord) and a
   * notify-only card with a signed link (Teams). Requests NOT switched on get no card; a provider
   * with `notify` on gets a one-line generic notice with no title, tool or project.
   */
  async function postPending(): Promise<PostPendingResult> {
    const cfg = config();
    const result: PostPendingResult = {
      cards: { slack: 0, discord: 0, teams: 0 },
      notices: { slack: 0, discord: 0, teams: 0 },
      skipped: 0,
    };
    for (const s of options.host.pending()) {
      const allowed = chatAllowed(cfg, s);
      if (!allowed) {
        result.skipped += 1;
        for (const p of ["slack", "discord", "teams"] as const) {
          const k = key(p, { ...s, request_hash: "notice" });
          if (!wantsNotice(cfg, p) || posted.get(k) === "notice") continue;
          if (
            await noticeTo(p, cfg, "Phoenix: an approval is waiting. Open Phoenix to review it.")
          ) {
            result.notices[p] += 1;
            posted.set(k, "notice");
          }
        }
        continue;
      }
      const jobs = [
        ["slack", providerReady(cfg, "slack"), postSlack],
        ["discord", providerReady(cfg, "discord"), postDiscord],
        ["teams", cfg.teams.enabled, postTeams],
      ] as const;
      for (const [provider, ready, post] of jobs) {
        if (!ready || posted.get(key(provider, s)) === s.request_hash) continue;
        if (await post(cfg, s)) {
          result.cards[provider] += 1;
          if (posted.size >= MAX_POSTED) posted.clear();
          posted.set(key(provider, s), s.request_hash);
        }
      }
    }
    return result;
  }

  /** Counts only, to the providers whose `digest` switch is on. Names no title or command. */
  async function postDigest(): Promise<DigestResult> {
    const cfg = config();
    const text = digestText({
      pending: options.host.pending(),
      allowed: (s) => chatAllowed(cfg, s),
    });
    const sent: Record<Provider, boolean> = { slack: false, discord: false, teams: false };
    for (const p of ["slack", "discord", "teams"] as const) {
      const on =
        p === "teams"
          ? cfg.teams.enabled && cfg.teams.digest
          : providerReady(cfg, p) && cfg[p].digest;
      if (on) sent[p] = await noticeTo(p, cfg, text);
    }
    return { sent, text };
  }

  /**
   * What Phoenix does when it is opened from a Teams link: verifies Core's signature, then that the
   * request is still pending, still switched on and unchanged. It shows the request; the person
   * decides inside Phoenix through the desktop path, never from this link.
   */
  async function openTeamsLink(link: string): Promise<TeamsLinkResult> {
    let parsed: LinkBinding;
    try {
      parsed = verifyDeepLink(link, await secret(SECRETS.teamsLinkKey), now());
    } catch (err) {
      if (err instanceof SignatureError && err.reason === "stale")
        return { kind: "refused", reason: "expired" };
      if (err instanceof SignatureError || err instanceof ParseError)
        return { kind: "refused", reason: "bad_link" };
      throw err;
    }
    const current = options.host
      .pending()
      .find((p) => p.source === parsed.source && p.id === parsed.id);
    if (!current) return { kind: "refused", reason: "not_pending" };
    if (!linkMatches(parsed, current)) return { kind: "refused", reason: "request_changed" };
    if (!chatAllowed(config(), current)) return { kind: "refused", reason: "project_off" };
    return { kind: "show", source: current.source, id: current.id, view: cardView(current) };
  }

  const module = defineCapability({
    manifest: {
      id: "chat-approvals",
      name: "Chat approvals",
      version: "0.1.0",
      description:
        "Posts approval cards for agent and Phoenix requests to Slack and Discord and lets an allow-listed owner answer them from there; Teams is notify-only with a signed link into Phoenix. Off by default, per project. A button press is verified with the provider's own signature, bound to the exact request, single use, and audited as chat:<provider>:<user>. Allow asks again before anything happens.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: [],
      permissions: ["network", "external_api"],
      data_categories: [
        "approval titles (short, sanitized)",
        "tool names and project names",
        "chat user and channel ids",
      ],
      secrets: [
        { name: SECRETS.slackBotToken, description: "Slack bot token (chat:write only)" },
        { name: SECRETS.slackSigningSecret, description: "Slack app signing secret" },
        { name: SECRETS.discordBotToken, description: "Discord bot token (Send Messages only)" },
        { name: SECRETS.discordPublicKey, description: "Discord application public key (hex)" },
        { name: SECRETS.teamsWebhookUrl, description: "Teams incoming webhook URL" },
        { name: SECRETS.teamsLinkKey, description: "Random key Phoenix signs Teams links with" },
      ],
      commands: [
        {
          name: "status",
          description:
            "Which providers are ready and which projects are switched on for chat. Read-only; shows no secret.",
          side_effect: "read",
          timeout_ms: 5_000,
          input_schema: { type: "object", additionalProperties: false, properties: {} },
        },
        {
          name: "post_pending",
          description:
            "Posts cards for pending approvals whose project is switched on for chat (and generic notices where notify is on). Asks for confirmation every time.",
          side_effect: "external",
          permissions: ["network", "external_api"],
          timeout_ms: 30_000,
          input_schema: { type: "object", additionalProperties: false, properties: {} },
        },
        {
          name: "post_digest",
          description:
            "Posts a counts-only digest to providers whose digest switch is on. Asks for confirmation every time.",
          side_effect: "external",
          permissions: ["network", "external_api"],
          timeout_ms: 30_000,
          input_schema: { type: "object", additionalProperties: false, properties: {} },
        },
      ],
      config_schema: CONFIG_SCHEMA,
    },
    init(context) {
      ctx = context;
      context.signal.addEventListener(
        "abort",
        () => {
          ctx = undefined;
          posted.clear();
        },
        { once: true },
      );
    },
    commands: {
      status() {
        const cfg = config();
        return {
          providers: {
            slack: providerReady(cfg, "slack"),
            discord: providerReady(cfg, "discord"),
            teams: cfg.teams.enabled,
          },
          teams_mode: "notify-only",
          projects: cfg.projects,
          phoenix_confirmations: cfg.phoenixConfirmations,
          open_tokens: binding.size,
        };
      },
      post_pending: postPending,
      post_digest: postDigest,
    },
    health() {
      const cfg = config();
      const ready =
        providerReady(cfg, "slack") || providerReady(cfg, "discord") || cfg.teams.enabled;
      return {
        status: "healthy" as const,
        message: ready ? "A chat provider is configured" : "No chat provider is switched on",
      };
    },
    shutdown() {
      ctx = undefined;
      posted.clear();
    },
  });

  return { module, handleCallback, openTeamsLink, postPending, postDigest, binding };
}
