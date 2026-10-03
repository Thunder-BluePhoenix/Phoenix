// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Kage capability (Phase 15). Phoenix integrates Kage as it exists today
// (docs/contracts/kage-api-v0.md): it polls Kage's REST API for meetings and
// turns status changes into kage.* events, and "Start meeting capture" runs
// Kage's own Meet bot. Phoenix never captures, transcribes or summarises
// anything itself.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";

export const DEFAULT_KAGE_URL = "http://127.0.0.1:8000";

/** A meeting as Kage's GET /api/meetings returns it (fields Phoenix uses). */
export interface KageMeeting {
  id: number;
  title: string | null;
  status: string;
  created_at: string;
  updated_at?: string;
  duration_seconds: number | null;
  participants: string[] | null;
  transcript?: string | null;
  summary?: string | null;
  extractive_summary?: string | null;
  key_decisions?: string[] | null;
  action_items?: unknown[] | null;
  follow_up_questions?: string[] | null;
  keywords?: string[] | null;
  error_message?: string | null;
}

/** Kage status → Phoenix event type and lifecycle status. */
export const STATUS_EVENTS: Readonly<Record<string, { event: string; status: string }>> = {
  uploaded: { event: "kage.meeting.ended", status: "processing" },
  transcribing: { event: "kage.transcription.started", status: "transcribing" },
  transcribed: { event: "kage.transcription.completed", status: "transcribed" },
  summarizing: { event: "kage.summary.started", status: "summarizing" },
  summarized: { event: "kage.summary.ready", status: "ready" },
  failed: { event: "kage.meeting.failed", status: "failed" },
};

const SETTLED = new Set(["transcribed", "summarized", "failed"]);
const SYNC_LIMIT = 100;

/** Kage stores SQLite UTC timestamps ("YYYY-MM-DD HH:MM:SS"). */
const iso = (t: string | undefined | null) =>
  t ? (/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t.replace(" ", "T") + "Z") : undefined;

export class KageClient {
  constructor(
    readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly timeoutMs = 5_000,
  ) {}

  async request<T>(path: string, authenticated = true): Promise<T> {
    if (authenticated && !this.apiKey) {
      throw new PhoenixError(ErrorCode.PERMISSION_DENIED, "Set the Kage API key first");
    }
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        headers: authenticated ? { "x-api-key": this.apiKey! } : {},
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if ((err as Error).name === "TimeoutError") {
        throw new PhoenixError(
          ErrorCode.OPERATION_TIMEOUT,
          `Kage did not answer within ${this.timeoutMs} ms`,
        );
      }
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        `Kage is unreachable at ${this.baseUrl}`,
      );
    }
    if (res.status === 401)
      throw new PhoenixError(ErrorCode.PERMISSION_DENIED, "Kage rejected the API key");
    if (res.status === 404)
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Meeting not found in Kage");
    if (!res.ok) {
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, `Kage answered HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  meetings = () => this.request<KageMeeting[]>("/api/meetings");
  meeting = (id: string) => this.request<KageMeeting>(`/api/meetings/${encodeURIComponent(id)}`);
  health = () => this.request<{ status: string }>("/health", false);
}

/** Event for a meeting's current Kage status, or null for statuses Phoenix does not track. */
export function statusEvent(m: KageMeeting, baseUrl: string) {
  const mapped = STATUS_EVENTS[m.status];
  if (!mapped) return null;
  return {
    event_type: mapped.event,
    severity:
      m.status === "failed"
        ? ("error" as const)
        : m.status === "summarized"
          ? ("success" as const)
          : ("info" as const),
    correlation_id: `kage-meeting-${m.id}`,
    subject: m.title ?? `Meeting ${m.id}`,
    payload: {
      meeting_id: String(m.id),
      status: mapped.status,
      ...(m.title ? { title: m.title } : {}),
      ...(iso(m.created_at) ? { started_at: iso(m.created_at) } : {}),
      ...(m.duration_seconds != null ? { duration_seconds: m.duration_seconds } : {}),
      ...(m.participants ? { participants: m.participants } : {}),
      ...(m.status === "failed" && m.error_message ? { error: m.error_message.slice(0, 300) } : {}),
      recording: {
        location: `${baseUrl}/api/meetings/${m.id}/media/audio`,
        retention: "Stored and deleted by Kage",
      },
    },
  };
}

export function createKageCapability() {
  const seen = new Map<number, string>();
  let synced = false;
  let reachable: boolean | undefined;
  let problem: string | undefined;
  let bot: { child: ChildProcess; correlation: string; title: string } | null = null;

  const baseUrl = (ctx: CapabilityContext) =>
    ((ctx.config.base_url as string | undefined) ?? DEFAULT_KAGE_URL).replace(/\/$/, "");
  const client = async (ctx: CapabilityContext) =>
    new KageClient(baseUrl(ctx), await ctx.secret("api_key"));

  async function poll(ctx: CapabilityContext): Promise<void> {
    let meetings: KageMeeting[];
    try {
      meetings = await (await client(ctx)).meetings();
    } catch (err) {
      const e = err as PhoenixError;
      problem = e.message;
      if (e.code === ErrorCode.CAPABILITY_UNAVAILABLE || e.code === ErrorCode.OPERATION_TIMEOUT) {
        reachable = false;
      }
      return;
    }
    problem = undefined;
    if (reachable !== true) {
      reachable = true;
      ctx.emit({ event_type: "kage.connected", severity: "info", payload: { url: baseUrl(ctx) } });
    }
    for (const m of meetings.slice(0, synced ? undefined : SYNC_LIMIT)) {
      if (seen.get(m.id) === m.status) continue;
      seen.set(m.id, m.status);
      const event = statusEvent(m, baseUrl(ctx));
      if (!event) continue;
      if (!synced && SETTLED.has(m.status)) {
        // History from before Phoenix was watching: record it, but don't replay it at Fawkes.
        ctx.emit({ ...event, event_type: "kage.meeting.synced" }, { ephemeral: true });
      } else {
        ctx.emit(event);
      }
    }
    synced = true;
  }

  function startBot(ctx: CapabilityContext, meetUrl: string, title: string, apiKey: string) {
    const botPath = ctx.config.bot_path as string | undefined;
    if (!botPath || !isAbsolute(botPath)) {
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "Set bot_path to the absolute path of Kage's bot/bot.js to capture meetings from Phoenix",
      );
    }
    const args = [botPath, meetUrl, "--title", title, "--backend", baseUrl(ctx)];
    if (typeof ctx.config.bot_name === "string") args.push("--name", ctx.config.bot_name);
    if (typeof ctx.config.max_duration_min === "number") {
      args.push("--max-duration-min", String(ctx.config.max_duration_min));
    }
    // The API key goes in the environment, never on the command line (it would show in `ps`).
    const child = spawn(process.execPath, args, {
      env: { ...process.env, KAGE_API_KEY: apiKey },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const correlation = `kage-capture-${randomBytes(6).toString("hex")}`;
    bot = { child, correlation, title };
    const emit = (event_type: string, severity: "info" | "error", payload = {}) =>
      ctx.emit({
        event_type,
        severity,
        correlation_id: correlation,
        subject: title,
        payload: { title, ...payload },
      });

    emit("kage.meeting.started", "info");
    let lastError = "";
    createInterface({ input: child.stdout! }).on("line", (line) => {
      ctx.logger.debug("kage bot", { line });
      if (line.startsWith("recording")) emit("kage.meeting.recording", "info");
    });
    createInterface({ input: child.stderr! }).on("line", (line) => {
      if (line.trim()) lastError = line.trim().slice(0, 300);
    });
    child.on("close", (code) => {
      if (bot?.child === child) bot = null;
      if (code === 0) emit("kage.capture.finished", "info");
      else
        emit("kage.meeting.failed", "error", {
          error: lastError || `Kage bot exited with code ${code}`,
        });
    });
    child.on("error", (err) => emit("kage.meeting.failed", "error", { error: err.message }));
  }

  const meetingIdInput = {
    type: "object",
    required: ["meeting_id"],
    additionalProperties: false,
    properties: { meeting_id: { type: "string", pattern: "^[0-9]{1,18}$" } },
  };

  return defineCapability({
    manifest: {
      id: "kage",
      name: "Kage",
      version: "0.1.0",
      description: "Meeting capture, transcripts and summaries from your Kage server.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/kage",
      events: ["kage.*"],
      permissions: ["meeting_recording", "network"],
      data_categories: ["meeting titles and participants", "transcripts", "summaries"],
      healthcheck: { interval_ms: 15_000 },
      secrets: [
        {
          name: "api_key",
          description: "Your Kage API key (Kage dashboard → account, or GET /auth/me)",
        },
      ],
      commands: [
        {
          name: "meeting.start",
          description: "Start capturing a Google Meet call with the Kage bot",
          side_effect: "execute",
          permissions: ["meeting_recording"],
          input_schema: {
            type: "object",
            required: ["meet_url"],
            additionalProperties: false,
            properties: {
              meet_url: {
                type: "string",
                pattern: "^https://meet\\.google\\.com/[^\\s]+$",
                maxLength: 300,
              },
              title: { type: "string", minLength: 1, maxLength: 200 },
            },
          },
        },
        { name: "meeting.list", description: "List meetings in Kage", side_effect: "read" },
        {
          name: "meeting.get_status",
          description: "Current status of a meeting",
          side_effect: "read",
          input_schema: meetingIdInput,
        },
        {
          name: "meeting.get_transcript",
          description: "A meeting's transcript",
          side_effect: "read",
          input_schema: meetingIdInput,
        },
        {
          name: "meeting.get_summary",
          description: "A meeting's summary, decisions and action items",
          side_effect: "read",
          input_schema: meetingIdInput,
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          base_url: { type: "string", pattern: "^https?://[^\\s]+$" },
          poll_ms: { type: "integer", minimum: 250, maximum: 300_000 },
          bot_path: {
            type: "string",
            minLength: 1,
            description: "Absolute path to Kage's bot/bot.js",
          },
          bot_name: { type: "string", minLength: 1, maxLength: 60 },
          max_duration_min: { type: "integer", minimum: 1, maximum: 480 },
        },
      },
      state_rules: [
        // The bot waits in the Meet lobby until admitted, which can take a while.
        {
          match: "kage.meeting.started",
          effect: { state: "WORKING", explain: "Joining {subject}", timeoutMs: 30 * 60_000 },
        },
        // Kage only summarises with an AI key; without one "transcribed" is the end state.
        {
          match: "kage.transcription.completed",
          effect: { state: "SUCCESS", explain: "Transcript ready: {subject}", ttlMs: 10_000 },
        },
        { match: "kage.capture.finished", effect: { clear: true } },
      ],
    },
    init(ctx) {
      seen.clear();
      synced = false;
      reachable = undefined;
      problem = undefined;
      const interval = (ctx.config.poll_ms as number | undefined) ?? 5_000;
      void (async () => {
        while (!ctx.signal.aborted) {
          await poll(ctx);
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, interval);
            ctx.signal.addEventListener("abort", () => (clearTimeout(t), resolve()), {
              once: true,
            });
          });
        }
      })();
    },
    shutdown(ctx) {
      if (bot) {
        // ponytail: Kage's bot has no stop signal handler, so this loses the in-progress
        // recording; it only happens on disable / emergency stop. Graceful stop needs a Kage change.
        ctx.logger.warn("stopping the Kage bot; the in-progress recording will not be uploaded");
        bot.child.kill("SIGTERM");
        bot = null;
      }
    },
    commands: {
      async "meeting.start"(input, ctx) {
        const { meet_url, title } = input as { meet_url: string; title?: string };
        if (bot)
          throw new PhoenixError(ErrorCode.INVALID_REQUEST, `Already capturing "${bot.title}"`);
        const apiKey = await ctx.secret("api_key");
        if (!apiKey)
          throw new PhoenixError(ErrorCode.PERMISSION_DENIED, "Set the Kage API key first");
        startBot(ctx, meet_url, title ?? "Meeting", apiKey);
        return { started: true, correlation_id: bot!.correlation };
      },
      async "meeting.list"(_input, ctx) {
        const meetings = await (await client(ctx)).meetings();
        return meetings.map(
          (m) =>
            statusEvent(m, baseUrl(ctx))?.payload ?? { meeting_id: String(m.id), status: m.status },
        );
      },
      async "meeting.get_status"(input, ctx) {
        const m = await (await client(ctx)).meeting((input as { meeting_id: string }).meeting_id);
        return {
          meeting_id: String(m.id),
          status: STATUS_EVENTS[m.status]?.status ?? m.status,
          kage_status: m.status,
        };
      },
      async "meeting.get_transcript"(input, ctx) {
        const m = await (await client(ctx)).meeting((input as { meeting_id: string }).meeting_id);
        return m.transcript ? { text: m.transcript } : null;
      },
      async "meeting.get_summary"(input, ctx) {
        const m = await (await client(ctx)).meeting((input as { meeting_id: string }).meeting_id);
        const text = m.summary ?? m.extractive_summary;
        if (!text) return null;
        return {
          text,
          generated_by: m.summary ? "ai" : "extractive",
          topics: m.keywords ?? [],
          decisions: m.key_decisions ?? [],
          action_items: m.action_items ?? [],
          follow_up_questions: m.follow_up_questions ?? [],
        };
      },
    },
    async health(ctx): Promise<HealthResult> {
      const c = await client(ctx);
      try {
        await c.health();
      } catch (err) {
        return { status: "unhealthy", message: (err as Error).message };
      }
      const capturing = bot ? ` · capturing "${bot.title}"` : "";
      if (!(await ctx.secret("api_key"))) {
        return { status: "degraded", message: "Connected, but no Kage API key is set" };
      }
      if (problem) return { status: "degraded", message: problem };
      return { status: "healthy", message: `Connected to ${c.baseUrl}${capturing}` };
    },
  });
}

export const kageCapability = createKageCapability();
