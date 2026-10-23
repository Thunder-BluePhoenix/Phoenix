// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { parseArgs } from "node:util";
import { ASK_TIMEOUT_MS, answerJson, ask, parseQuestion, renderAnswer } from "./ask";
import { decide, listPending, renderList, toView, type Decision } from "./approvals";
import { parseAwake, parseDuration, parseReason, renderAwake, runCommand } from "./awake";
import { CoreClient, DEFAULT_CORE_URL, parseCoreUrl } from "./client";
import { CoreError, EXIT, NoAnswerError, RefusedError, UsageError } from "./errors";
import { eventsPath, renderEvent, tailEvents } from "./events";
import { clean, formatDuration, redact, terminalSafeJson } from "./format";
import { parseEvents, parseHealth, parsePet, type CoreEvent } from "./model";
import { resolveSessionToken } from "./token";

export const HELP = `phoenix: talk to your local Phoenix Core

Usage:
  phoenix status [--json]
  phoenix approvals list [--json]
  phoenix approvals approve <id> [--ref <ref>]
  phoenix approvals deny <id> [--ref <ref>]
  phoenix events tail [-n <count>] [--follow] [--source <name>] [--type <type>] [--json]
  phoenix awake <duration> [--reason <text>]
  phoenix awake extend <duration>
  phoenix awake end
  phoenix awake status [--json]
  phoenix ask "<question>" [--json]
  phoenix help

Options:
  --url <url>        Core address (default ${DEFAULT_CORE_URL}, or PHOENIX_CORE_URL); loopback http only
  --data-dir <dir>   Core's data directory, where session.token lives (or PHOENIX_DATA_DIR)
  --json             Machine-readable output
  --reason <text>    Why the computer should stay awake (phoenix awake, up to 80 characters)
  -h, --help         Show this help

The session token is read from PHOENIX_SESSION_TOKEN or <data dir>/session.token and is never printed.
Approving needs the --ref printed by "approvals list", or an interactive terminal where you review
and confirm the exact request. Denying needs neither.

A duration is whole minutes, hours or days: 90, 90m, 2h, 1d (1 minute to 7 days). "awake" (start),
"awake extend" and "awake end" are confirmed in Phoenix, exactly as in the app, and the CLI waits for
your answer; it never answers for you. "awake status" only reads.

"ask" puts a question to your own memory through Core's AI (the same route as the Pet Panel chat). It
prints an answer only when Core produced one, labelled as a generated hypothesis with its evidence;
if AI is off, no provider is allowed or nothing in memory matches, it prints Core's reason and exits 1.
`;

export interface CliEnvironment {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  cwd: string;
  home: string;
  platform: NodeJS.Platform;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Present only when a person can answer a question at a terminal. */
  confirm?: (prompt: string) => Promise<boolean>;
  signal: AbortSignal;
}

const OPTIONS = {
  url: { type: "string" },
  "data-dir": { type: "string" },
  json: { type: "boolean", default: false },
  ref: { type: "string" },
  reason: { type: "string" },
  n: { type: "string", short: "n" },
  follow: { type: "boolean", short: "f", default: false },
  source: { type: "string" },
  type: { type: "string" },
  help: { type: "boolean", short: "h", default: false },
} as const;

/** Runs one command line and returns its exit code. Never throws for expected failures. */
export async function run(io: CliEnvironment): Promise<number> {
  let token: string | undefined;
  try {
    const { positionals, values } = parseArgs({
      args: [...io.argv],
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
    const [command, sub, ...rest] = positionals;
    if (values.help || command === undefined || command === "help") {
      io.stdout(HELP);
      return command === undefined && !values.help ? EXIT.usage : EXIT.ok;
    }
    if (!["status", "approvals", "events", "awake", "ask"].includes(command)) {
      throw new UsageError(`Unknown command "${clean(command, 40)}". Try: phoenix help`);
    }

    const baseUrl = parseCoreUrl(values.url ?? io.env.PHOENIX_CORE_URL ?? DEFAULT_CORE_URL);
    const session = resolveSessionToken({
      env: io.env,
      cwd: io.cwd,
      home: io.home,
      platform: io.platform,
      ...(values["data-dir"] ? { dataDir: values["data-dir"] } : {}),
    });
    token = session.value;
    if (session.warning) io.stderr(`warning: ${session.warning}\n`);
    const client = new CoreClient({
      baseUrl,
      token,
      fetch: io.fetch,
      headers: { "x-phoenix-client": "phoenix-cli" },
    });

    if (command === "status") {
      noMore(sub, rest);
      await status(client, values.json, io);
    } else if (command === "approvals") {
      await approvals(client, sub, rest, values, io);
    } else if (command === "awake") {
      await awake(client, sub, rest, values, io);
    } else if (command === "ask") {
      const question = parseQuestion([sub, ...rest]);
      const view = await ask(
        new CoreClient({
          baseUrl,
          token,
          fetch: io.fetch,
          timeoutMs: ASK_TIMEOUT_MS,
          headers: { "x-phoenix-client": "phoenix-cli" },
        }),
        question,
        io.signal,
      );
      io.stdout(values.json ? `${terminalSafeJson(answerJson(view))}\n` : renderAnswer(view));
    } else {
      await events(client, sub, rest, values, io);
    }
    return EXIT.ok;
  } catch (err) {
    return fail(err, token, io);
  }
}

/** The parsed flags the commands read (the shape `OPTIONS` produces). */
interface Values {
  json: boolean;
  follow: boolean;
  ref?: string | undefined;
  reason?: string | undefined;
  n?: string | undefined;
  source?: string | undefined;
  type?: string | undefined;
}

function noMore(...extra: (string | undefined | string[])[]): void {
  const left = extra.flat().filter((x) => x !== undefined);
  if (left.length > 0) throw new UsageError(`Unexpected argument "${clean(left[0], 40)}"`);
}

async function status(client: CoreClient, json: boolean, io: CliEnvironment): Promise<void> {
  const [health, pet] = await Promise.all([
    client.request("GET", "/api/health").then(parseHealth),
    client.request("GET", "/api/pet/state").then(parsePet),
  ]);
  const pending = await listPending(client);
  if (json) {
    io.stdout(
      `${terminalSafeJson({
        core: {
          status: health.status,
          version: health.version,
          protocol: health.protocol,
          env: health.env,
          uptime_ms: health.uptimeMs,
        },
        fawkes: pet,
        kill_switch: health.killSwitch,
        active_tasks: health.activeTasks,
        approvals_pending: pending.length,
        capabilities: health.capabilities,
      })}\n`,
    );
    return;
  }
  const unhealthy = health.capabilities.filter(
    (c) => c.status === "enabled" && c.health !== "healthy",
  );
  const lines = [
    `Core ${clean(health.status, 20)}  v${clean(health.version, 20)}  ${clean(health.env, 20)}  up ${formatDuration(health.uptimeMs)}`,
    `Fawkes ${clean(pet.state, 20)}${pet.sleeping ? " (sleeping)" : ""}${pet.recording ? " (recording)" : ""}: ${clean(pet.explanation)}`,
    `Active tasks ${health.activeTasks}  ·  Approvals waiting ${pending.length}`,
    `Kill switch ${health.killSwitch ? "ENGAGED" : "off"}`,
    ...(unhealthy.length > 0
      ? [
          `Needs attention: ${unhealthy.map((c) => `${clean(c.id, 40)} (${clean(c.health, 20)})`).join(", ")}`,
        ]
      : []),
  ];
  io.stdout(`${lines.join("\n")}\n`);
}

async function approvals(
  client: CoreClient,
  sub: string | undefined,
  rest: string[],
  values: Values,
  io: CliEnvironment,
): Promise<void> {
  if (sub === "list" || sub === undefined) {
    noMore(rest);
    const pending = await listPending(client);
    io.stdout(
      values.json ? `${JSON.stringify({ approvals: pending.map(toView) })}\n` : renderList(pending),
    );
    return;
  }
  if (sub !== "approve" && sub !== "deny") {
    throw new UsageError(`Unknown approvals command "${clean(sub, 40)}"`);
  }
  const [id, ...extra] = rest;
  if (!id) throw new UsageError(`phoenix approvals ${sub} needs a request id`);
  noMore(extra);
  const decision: Decision = sub;
  const result = await decide({
    client,
    id,
    decision,
    ...(values.ref ? { ref: values.ref } : {}),
    now: io.now,
    ...(io.confirm ? { confirm: io.confirm } : {}),
    write: io.stdout,
  });
  io.stdout(
    values.json
      ? `${JSON.stringify(result)}\n`
      : `${decision === "approve" ? "Approved" : "Denied"} ${result.id} (${result.source}). Core recorded it in the audit log.\n`,
  );
}

async function awake(
  client: CoreClient,
  sub: string | undefined,
  rest: string[],
  values: Values,
  io: CliEnvironment,
): Promise<void> {
  const call = (command: string, input: Record<string, unknown>) =>
    runCommand({
      client,
      capability: "awake",
      command,
      input,
      signal: io.signal,
      sleep: io.sleep,
      waiting: () =>
        io.stderr("Waiting for you to approve this in Phoenix (or: phoenix approvals list)...\n"),
      // Core's own confirmation expires after five minutes; this stops just after that.
      maxWaitMs: 330_000,
      intervalMs: 1000,
    });
  const show = (result: unknown): void =>
    io.stdout(
      values.json ? `${terminalSafeJson(parseAwake(result))}\n` : renderAwake(parseAwake(result)),
    );
  if (sub === undefined)
    throw new UsageError("Usage: phoenix awake <duration> | extend | end | status");
  if (sub === "status") {
    noMore(rest);
    show(await call("status", {}));
  } else if (sub === "end") {
    noMore(rest);
    show(await call("end", {}));
  } else if (sub === "extend") {
    const [duration, ...extra] = rest;
    noMore(extra);
    show(await call("extend", { minutes: parseDuration(duration) }));
  } else {
    noMore(rest);
    const reason = parseReason(values.reason);
    show(await call("start", { minutes: parseDuration(sub), ...(reason ? { reason } : {}) }));
  }
}

async function events(
  client: CoreClient,
  sub: string | undefined,
  rest: string[],
  values: Values,
  io: CliEnvironment,
): Promise<void> {
  if (sub !== "tail") throw new UsageError("Usage: phoenix events tail [-n <count>] [--follow]");
  noMore(rest);
  const count = values.n === undefined ? 20 : Number(values.n);
  if (!Number.isInteger(count) || count < 0 || count > 1000) {
    throw new UsageError("-n must be a whole number from 0 to 1000");
  }
  const emit = (event: CoreEvent): void =>
    io.stdout(values.json ? `${terminalSafeJson(event)}\n` : `${renderEvent(event)}\n`);
  await tailEvents({
    client,
    filter: {
      ...(values.source ? { source: values.source } : {}),
      ...(values.type ? { type: values.type } : {}),
    },
    initial: count,
    follow: values.follow,
    intervalMs: 2000,
    signal: io.signal,
    sleep: io.sleep,
    emit,
    warn: (text) => io.stderr(`${text}\n`),
  });
}

function fail(err: unknown, token: string | undefined, io: CliEnvironment): number {
  const say = (text: string): void => io.stderr(`phoenix: ${redact(text, token)}\n`);
  if (err instanceof UsageError) {
    say(err.message);
    return EXIT.usage;
  }
  if (err instanceof RefusedError) {
    say(err.message);
    return EXIT.refused;
  }
  if (err instanceof NoAnswerError) {
    say(err.message);
    return EXIT.failed;
  }
  if (err instanceof CoreError) {
    say(err.message);
    return err.kind === "unreachable" ? EXIT.unreachable : EXIT.failed;
  }
  // parseArgs reports bad flags with a code of this shape.
  if (err instanceof Error && "code" in err && String(err.code).startsWith("ERR_PARSE_ARGS")) {
    say(err.message);
    return EXIT.usage;
  }
  say(err instanceof Error ? err.message : "unexpected failure");
  return EXIT.failed;
}
