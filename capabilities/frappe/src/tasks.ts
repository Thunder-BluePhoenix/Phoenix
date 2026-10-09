// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `task.create`: the one write this capability performs. It creates a Task document on a Frappe
// site the user named under `api` in the capability config, using the `write_token` secret.
//
// Credential discipline
//   * The write URL comes only from `api[<site>]`. It is never derived from bench files,
//     `host_name` or the `sites` polling overrides: a credential only goes where the user said.
//   * `ctx.secret("write_token")` is read only here. Health polling is unauthenticated.
//   * Redirects are refused (`redirect: "error"`) so the Authorization header cannot be forwarded.
//   * Error messages are fixed strings built from the status or error class. They never contain
//     the credential, the request body or any text of the response.
//
// Idempotency
//   The marker is a visible last line of the description, `Phoenix ref: <idempotency_key>`. A
//   Text Editor field is HTML-sanitised and may drop comments, so an HTML comment would not
//   survive. Before every POST we ask Frappe for a Task whose description contains the key. Frappe
//   answers from its database, so the lookup is strongly consistent: once a create has committed,
//   the next lookup sees it (there is no search-index lag to race). The POST is never retried
//   automatically; if the connection fails after the request was sent the outcome is unknown and
//   the caller re-runs the command with the same key, which finds the task if it was created.
//   (`_` in a key is a LIKE wildcard; at worst a key differing only at a `_` position matches.)
import { redact } from "@phoenix/logging";
import type { CapabilityContext, CommandSpec } from "@phoenix/sdk";
import { isRecord } from "./guards";
import { errorCode, normalizeOrigin, readCapped, SITE_NAME } from "./http";

const WRITE_TIMEOUT_MS = 25_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const LOOKUP_LIMIT = 5;
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,80}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,139}$/;
const CREDENTIAL = /^[^\s:]{4,128}:[^\s:]{4,128}$/;
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const CONTROL_CHARS = /\p{Cc}/gu;
/** Control characters other than tab and newline (kept in a description). */
const CONTROL_CHARS_EXCEPT_LAYOUT = /[^\P{Cc}\t\n]/gu;
const HAS_CONTROL_CHARS = /\p{Cc}/u;
const PHOENIX_REF = /phoenix[\s_-]*ref\s*:/gi;

const PRIORITIES = ["Low", "Medium", "High", "Urgent"];

/** The user-supplied fields that become document fields. The ONLY place that list lives. */
const BODY_FIELDS = ["subject", "description", "priority", "exp_end_date", "project"] as const;
type BodyField = (typeof BODY_FIELDS)[number];

const FIELD_SCHEMAS: Record<BodyField, Record<string, unknown>> = {
  subject: { type: "string", minLength: 1, maxLength: 140 },
  description: { type: "string", maxLength: 10_000 },
  priority: { enum: PRIORITIES },
  exp_end_date: { type: "string", pattern: DATE.source },
  project: { type: "string", minLength: 1, maxLength: 140, pattern: "^[^\\p{Cc}]+$" },
};

export const TASK_SECRET = {
  name: "write_token",
  description:
    "Frappe API key and secret as api_key:api_secret (User > API Access). Used only by task.create, sent to the URL you set under api for that site. Create a user that may only create Tasks.",
};

export const TASK_COMMAND: CommandSpec = {
  name: "task.create",
  description:
    "Creates a Task document on a Frappe site you configured under `api`. Writes. Always asks for confirmation.",
  side_effect: "external",
  permissions: ["network", "external_api"],
  timeout_ms: 30_000,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["site", "subject", "idempotency_key"],
    properties: {
      site: { type: "string", pattern: SITE_NAME.source },
      ...FIELD_SCHEMAS,
      idempotency_key: { type: "string", pattern: IDEMPOTENCY_KEY.source },
    },
  },
};

export const API_CONFIG_SCHEMA = {
  type: "object",
  maxProperties: 20,
  propertyNames: { pattern: SITE_NAME.source },
  additionalProperties: {
    type: "string",
    maxLength: 300,
    pattern:
      "^(https://[^\\s/@]+(/[^\\s]*)?|http://(127\\.0\\.0\\.1|localhost|\\[::1\\])(:[0-9]+)?(/[^\\s]*)?)$",
  },
  description:
    'Write targets for task.create: Frappe site name to base URL, e.g. { "erp.localhost": "http://127.0.0.1:8000" }. ' +
    "The write credential is sent only to these URLs. https anywhere; plain http only for localhost.",
};

export interface TaskInput {
  site: string;
  subject: string;
  description: string;
  priority?: string;
  exp_end_date?: string;
  project?: string;
  idempotency_key: string;
}

export interface TaskResult {
  status: "created" | "existing";
  site: string;
  name: string;
  url: string;
  idempotency_key: string;
}

const UNKNOWN_OUTCOME =
  "The outcome is unknown: the task may or may not have been created. It is safe to retry with the same idempotency_key.";

function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  const v = value[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new Error(`Invalid ${key}`);
  return v;
}

/** Re-checks what the manager already validated against input_schema (defence in depth). */
export function parseTaskInput(input: unknown): TaskInput {
  if (!isRecord(input)) throw new Error("Invalid task input");
  const site = optionalString(input, "site");
  const subject = optionalString(input, "subject");
  const key = optionalString(input, "idempotency_key");
  if (!site || !SITE_NAME.test(site)) throw new Error("Invalid site name");
  if (!subject || subject.length > 140) throw new Error("Invalid subject");
  if (!key || !IDEMPOTENCY_KEY.test(key)) throw new Error("Invalid idempotency_key");
  const description = optionalString(input, "description") ?? "";
  if (description.length > 10_000) throw new Error("Invalid description");
  const priority = optionalString(input, "priority");
  if (priority !== undefined && !PRIORITIES.includes(priority)) throw new Error("Invalid priority");
  const date = optionalString(input, "exp_end_date");
  if (date !== undefined && !DATE.test(date)) throw new Error("Invalid exp_end_date");
  const project = optionalString(input, "project");
  if (
    project !== undefined &&
    (!project || project.length > 140 || HAS_CONTROL_CHARS.test(project))
  ) {
    throw new Error("Invalid project");
  }
  return {
    site,
    subject,
    description,
    ...(priority !== undefined ? { priority } : {}),
    ...(date !== undefined ? { exp_end_date: date } : {}),
    ...(project !== undefined ? { project } : {}),
    idempotency_key: key,
  };
}

/** Redacts secret-looking text, removes control characters and any pre-existing marker. */
function sanitize(value: string, controlChars: RegExp): string {
  const redacted = redact(value);
  let text = (typeof redacted === "string" ? redacted : "").replace(controlChars, " ");
  // Removal can splice a new marker together ("Phoenix Phoenix ref:ref:"), so repeat to a fixpoint.
  for (let previous = ""; previous !== text;) {
    previous = text;
    text = text.replace(PHOENIX_REF, "");
  }
  return text;
}

/** The JSON body of the POST: fixed doctype plus the allow-listed, cleaned fields. */
export function buildTaskDocument(task: TaskInput): Record<string, string> {
  const subject = sanitize(task.subject, CONTROL_CHARS).replace(/\s+/g, " ").trim().slice(0, 140);
  if (!subject) throw new Error("The subject is empty after removing control characters");
  const text = sanitize(
    task.description.replace(/\r\n?/g, "\n"),
    CONTROL_CHARS_EXCEPT_LAYOUT,
  ).trim();
  const marker = `Phoenix ref: ${task.idempotency_key}`;
  const cleaned: Record<BodyField, string | undefined> = {
    subject,
    description: text ? `${text}\n\n${marker}` : marker,
    priority: task.priority,
    exp_end_date: task.exp_end_date,
    project: task.project === undefined ? undefined : sanitize(task.project, CONTROL_CHARS).trim(),
  };
  const document: Record<string, string> = { doctype: "Task" };
  for (const field of BODY_FIELDS) {
    const value = cleaned[field];
    if (value) document[field] = value;
  }
  return document;
}

/**
 * The base URL a credential may be sent to for `site`, from `api` only. Reduced to an origin;
 * rejects credentials in the URL, non-http(s) and plain http to anything but loopback.
 */
export function writeOrigin(api: unknown, site: string): string {
  const configured = isRecord(api) && Object.hasOwn(api, site) ? api[site] : undefined;
  if (configured === undefined) {
    throw new Error(`No write URL configured for site ${site} under api`);
  }
  const invalid = new Error(`The write URL for site ${site} under api is not acceptable`);
  if (typeof configured !== "string") throw invalid;
  const origin = normalizeOrigin(configured);
  if (!origin) throw invalid;
  const url = new URL(configured.trim());
  if (url.username || url.password) throw invalid;
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.includes(url.hostname)) throw invalid;
  return origin;
}

function statusMessage(status: number): string {
  switch (status) {
    case 401:
      return "Frappe rejected the write credential (HTTP 401)";
    case 403:
      return "The write credential may not read or create Tasks (HTTP 403)";
    case 404:
      return "Frappe did not find the Task endpoint for this site (HTTP 404): check the api URL and the site name";
    case 417:
      return "Frappe rejected the task (validation failed)";
    default:
      return `Frappe returned HTTP ${status}`;
  }
}

type Sent<T> = { ok: true; value: T } | { ok: false; reason: string };

/** One request with a deadline and the capability's abort signal; never throws. */
async function send<T>(
  ctx: CapabilityContext,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<Sent<T>> {
  const timeout = AbortSignal.timeout(WRITE_TIMEOUT_MS);
  try {
    return { ok: true, value: await request(AbortSignal.any([ctx.signal, timeout])) };
  } catch (err) {
    if (timeout.aborted) return { ok: false, reason: `no response within ${WRITE_TIMEOUT_MS} ms` };
    if (ctx.signal.aborted) return { ok: false, reason: "cancelled" };
    const code = errorCode(err);
    return { ok: false, reason: code ? `connection failed (${code})` : "request failed" };
  }
}

interface Answer {
  status: number;
  /** Parsed JSON on 2xx, else a fixed message that is safe to show. */
  body: { value: unknown } | { failure: string };
}

/** Status check plus a capped JSON read. `failure` is a fixed message, never remote text. */
async function answer(res: Response): Promise<Answer> {
  const { status } = res;
  if (!res.ok) {
    await res.body?.cancel();
    return { status, body: { failure: statusMessage(status) } };
  }
  const text = await readCapped(res, MAX_RESPONSE_BYTES);
  if (text === null) return { status, body: { failure: "the response from Frappe is too large" } };
  try {
    return { status, body: { value: JSON.parse(text) as unknown } };
  } catch {
    return { status, body: { failure: "the response from Frappe is not valid JSON" } };
  }
}

function docName(value: unknown): string | undefined {
  return typeof value === "string" && DOC_NAME.test(value) ? value : undefined;
}

export async function createTask(input: unknown, ctx: CapabilityContext): Promise<TaskResult> {
  const task = parseTaskInput(input);
  const origin = writeOrigin(ctx.config.api, task.site);
  const credential = await ctx.secret(TASK_SECRET.name);
  if (!credential) throw new Error(`No ${TASK_SECRET.name} secret is set for this capability`);
  if (!CREDENTIAL.test(credential) || !PRINTABLE_ASCII.test(credential)) {
    throw new Error(`The ${TASK_SECRET.name} secret must have the form api_key:api_secret`);
  }
  const document = buildTaskDocument(task);
  const headers = {
    accept: "application/json",
    authorization: `token ${credential}`,
    "x-frappe-site-name": task.site,
  };
  const result = (status: TaskResult["status"], name: string): TaskResult => ({
    status,
    site: task.site,
    name,
    url: `${origin}/app/task/${encodeURIComponent(name)}`,
    idempotency_key: task.idempotency_key,
  });

  // 1. Is there already a Task carrying this key? (No write has happened yet.)
  const query = new URLSearchParams({
    filters: JSON.stringify([["description", "like", `%${task.idempotency_key}%`]]),
    fields: JSON.stringify(["name"]),
    limit_page_length: String(LOOKUP_LIMIT),
  });
  const lookup = await send(ctx, async (signal) =>
    answer(
      await fetch(`${origin}/api/resource/Task?${query}`, { headers, redirect: "error", signal }),
    ),
  );
  if (!lookup.ok) throw new Error(`Looking for an existing task failed: ${lookup.reason}`);
  if ("failure" in lookup.value.body) {
    throw new Error(`Looking for an existing task failed: ${lookup.value.body.failure}`);
  }
  const reply = lookup.value.body.value;
  const rows = isRecord(reply) ? reply.data : undefined;
  if (!Array.isArray(rows)) {
    throw new Error("Looking for an existing task failed: unexpected response");
  }
  if (rows.length > 0) {
    const found = rows.map((row) => (isRecord(row) ? docName(row.name) : undefined));
    const name = found.find((n) => n !== undefined);
    if (name === undefined) {
      throw new Error("Frappe returned an unexpected task name; not creating a possible duplicate");
    }
    return result("existing", name);
  }

  // 2. Create. Never retried here: after this point a failure means the outcome is unknown.
  const created = await send(ctx, async (signal) =>
    answer(
      await fetch(`${origin}/api/resource/Task`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(document),
        redirect: "error",
        signal,
      }),
    ),
  );
  if (!created.ok) {
    throw new Error(`Creating the task failed: ${created.reason}. ${UNKNOWN_OUTCOME}`);
  }
  const { status, body } = created.value;
  if ("failure" in body) {
    // 4xx: Frappe refused, nothing was created. A 2xx we cannot read, or a 5xx from a proxy after
    // a commit, may have created it.
    const refused = status >= 400 && status < 500;
    throw new Error(refused ? body.failure : `${body.failure}. ${UNKNOWN_OUTCOME}`);
  }
  const data = isRecord(body.value) ? body.value.data : undefined;
  const name = isRecord(data) ? docName(data.name) : undefined;
  if (name === undefined) {
    throw new Error(`Frappe answered with an unexpected response. ${UNKNOWN_OUTCOME}`);
  }
  return result("created", name);
}
