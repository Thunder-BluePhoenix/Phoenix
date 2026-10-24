// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Deterministic voice intent selection. A recognised request is UNTRUSTED TEXT, never a command:
// it can only select a fixed intent below. Tool names come from the ToolGateway registry, and its
// contract supplies side effect and JSON schema. The caller builds the call with `{}`; no spoken
// text is ever turned into tool input. This intentionally makes the initial assistant useful for
// zero-input service status tools without accidentally granting arbitrary command execution.
//
// The one exception is web search: "search the web for <words>" becomes the input of ONE named tool
// (`web-search.search_confirmed`), which the registry must list as an `external` command with a
// single `query` property. The words are bounded and normalised here, and the call is an external
// action: Core asks a person to approve the exact query before it leaves the computer, and voice can
// never give that approval.

export type VoiceSideEffect = "none" | "read" | "write" | "execute" | "external" | "production";

export interface VoiceTool {
  name: string;
  sideEffect: VoiceSideEffect;
  inputSchema: Record<string, unknown>;
}

export type VoiceIntent =
  | { kind: "tool"; tool: string }
  | { kind: "web_search"; tool: string; query: string }
  | { kind: "switch_pill"; direction: "next" | "previous" }
  | { kind: "mailto_draft"; body: string }
  | { kind: "deny" }
  | { kind: "unavailable"; message: string }
  | { kind: "refuse"; message: string };

const ACTION_WORDS =
  /\b(send|delete|remove|create|write|edit|deploy|publish|play|pause|skip|next|previous|volume|shuffle|repeat|approve|confirm|accept|allow|yes|yeah|yep|sure|go ahead)\b/iu;
const DENY = /^(deny|reject|decline|cancel that)\b/iu;
const MAIL = /\b(email|mail)\b/iu;
const DRAFT = /\b(draft|compose|write)\b/iu;
const PILL = /\b(switch|open|show|change)\b.*\b(pill|floating)\b|\bpill\b/iu;
/** "next pill" and "previous pill" are navigation, not the media action words above. */
const PILL_NAVIGATION = /\b(next|previous)\b/giu;
const PILL_BACKWARDS = /\b(previous|last|back)\b/iu;
const WEB = /\b(web|internet|google|search|look up)\b/iu;
/**
 * "search the web for X", "search for X", "look up X", "please search the internet about X":
 * the request must START with the search verb, so a sentence that merely mentions the web is not one.
 * (The text is already lowercase with punctuation removed.)
 */
const WEB_SEARCH =
  /^(?:please )?(?:search(?: (?:the )?(?:web|internet))?(?: for| about)?|look up)(?: (.*))?$/u;
/** The only tool voice may start with spoken input, and the only `external` one it may start at all. */
export const WEB_SEARCH_TOOL = "web-search.search_confirmed";
/**
 * Longest spoken query. It is the longest a person can read in full in Core's approval prompt
 * (the prompt shows 80 characters of a value), so what they approve is all of what is sent.
 */
export const MAX_SPOKEN_QUERY_CHARS = 80;
const MUSIC = /\b(music|song|track|album|artist|playing|listening)\b/iu;
/** Phrase -> conventional tool names, tried in order; the first that is enabled and read-only wins. */
const SERVICE_PHRASES: readonly { phrase: RegExp; tools: readonly string[] }[] = [
  { phrase: /\bgithub\b/iu, tools: ["github.status"] },
  { phrase: /\bgit\b/iu, tools: ["git.status"] },
  { phrase: /\b(docker|containers?)\b/iu, tools: ["docker.containers"] },
  {
    phrase: /\b(status|services?|health|happening)\b/iu,
    tools: ["git.status", "github.status", "docker.containers"],
  },
];
const MAX_DRAFT_CHARS = 300;
const SPACE = /\s+/gu;

function acceptsEmptyObject(schema: Record<string, unknown>): boolean {
  const required = schema.required;
  return !Array.isArray(required) || required.length === 0;
}

/** Lowercase, bounded phrase used only for phrase matching; it never reaches a capability. */
export function normaliseIntentText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(SPACE, " ")
    .trim()
    .slice(0, 500);
}

/**
 * True only for the confirmed web-search tool exactly as the registry describes it: the one name,
 * side effect `external` (so Core asks a person every time) and an input of one required `query`.
 * Anything else with that name, or any other external tool, is not reachable by voice.
 */
export function isConfirmedSearchTool(tool: VoiceTool): boolean {
  if (tool.name !== WEB_SEARCH_TOOL || tool.sideEffect !== "external") return false;
  const { required, properties, additionalProperties } = tool.inputSchema as {
    required?: unknown;
    properties?: unknown;
    additionalProperties?: unknown;
  };
  return (
    Array.isArray(required) &&
    required.length === 1 &&
    required[0] === "query" &&
    additionalProperties === false &&
    typeof properties === "object" &&
    properties !== null &&
    Object.keys(properties).length === 1
  );
}

/** Select a tool by exact registry metadata, never by an instruction contained in the transcript. */
function findReadTool(
  tools: readonly VoiceTool[],
  names: readonly string[],
): VoiceTool | undefined {
  return tools.find(
    (tool) =>
      (tool.sideEffect === "none" || tool.sideEffect === "read") &&
      acceptsEmptyObject(tool.inputSchema) &&
      names.includes(tool.name),
  );
}

/**
 * Maps a few intentionally small phrases to safe outcomes. A tool is selected only when the
 * enabled registry offers it under a conventional name (music tools by name, so Spotify or Apple
 * Music participate when installed); tools with required input or a side effect are never selected.
 */
export function matchIntent(text: string, tools: readonly VoiceTool[]): VoiceIntent {
  const request = normaliseIntentText(text);
  if (request.length === 0) return { kind: "refuse", message: "I did not catch a request." };
  if (DENY.test(request)) return { kind: "deny" };
  const search = WEB_SEARCH.exec(request);
  if (search) {
    const query = (search[1] ?? "").trim();
    if (query.length === 0) return { kind: "refuse", message: "What should I search for?" };
    if (query.length > MAX_SPOKEN_QUERY_CHARS) {
      return {
        kind: "refuse",
        message: "That search is too long for you to approve in full. Say a shorter one.",
      };
    }
    const tool = tools.find(isConfirmedSearchTool);
    return tool
      ? { kind: "web_search", tool: tool.name, query }
      : { kind: "unavailable", message: "Web search is not enabled." };
  }
  if (MAIL.test(request) && DRAFT.test(request)) {
    const topic = /\b(?:about|saying|that says)\s+(.+)$/u.exec(request)?.[1] ?? "";
    return { kind: "mailto_draft", body: topic.slice(0, MAX_DRAFT_CHARS) };
  }
  const pill = PILL.test(request);
  if (ACTION_WORDS.test(pill ? request.replace(PILL_NAVIGATION, " ") : request)) {
    return {
      kind: "refuse",
      message:
        "Voice can read information, but it cannot perform an action or approve one. Use the Pet Panel for that.",
    };
  }
  if (pill) {
    return { kind: "switch_pill", direction: PILL_BACKWARDS.test(request) ? "previous" : "next" };
  }
  if (WEB.test(request)) {
    return {
      kind: "refuse",
      message: "To search the web, say: search the web for, then what to look up.",
    };
  }
  if (MUSIC.test(request)) {
    const tool = findReadTool(tools, [
      "spotify.now_playing",
      "apple-music.now_playing",
      "mpris.now_playing",
    ]);
    return tool
      ? { kind: "tool", tool: tool.name }
      : { kind: "unavailable", message: "No music service is enabled." };
  }
  for (const { phrase, tools: names } of SERVICE_PHRASES) {
    if (!phrase.test(request)) continue;
    const tool = findReadTool(tools, names);
    return tool
      ? { kind: "tool", tool: tool.name }
      : {
          kind: "unavailable",
          message: "That service is not enabled, so I cannot read its status.",
        };
  }
  return {
    kind: "refuse",
    message:
      "I can read the status of enabled services, search the web, open the pill, or draft an email.",
  };
}
