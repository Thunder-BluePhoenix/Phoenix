// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Deterministic voice intent selection. A recognised request is UNTRUSTED TEXT, never a command:
// it can only select a fixed intent below. Tool names come from the ToolGateway registry, and its
// contract supplies side effect and JSON schema. The caller builds the call with `{}`; no spoken
// text is ever turned into tool input. This intentionally makes the initial assistant useful for
// zero-input service status tools without accidentally granting arbitrary command execution.

export type VoiceSideEffect = "none" | "read" | "write" | "execute" | "external" | "production";

export interface VoiceTool {
  name: string;
  sideEffect: VoiceSideEffect;
  inputSchema: Record<string, unknown>;
}

export type VoiceIntent =
  | { kind: "tool"; tool: string }
  | { kind: "switch_pill" }
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
const WEB = /\b(web|internet|google|search|look up)\b/iu;
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
  if (MAIL.test(request) && DRAFT.test(request)) {
    const topic = /\b(?:about|saying|that says)\s+(.+)$/u.exec(request)?.[1] ?? "";
    return { kind: "mailto_draft", body: topic.slice(0, MAX_DRAFT_CHARS) };
  }
  if (ACTION_WORDS.test(request)) {
    return {
      kind: "refuse",
      message:
        "Voice can read information, but it cannot perform an action or approve one. Use the Pet Panel for that.",
    };
  }
  if (PILL.test(request)) return { kind: "switch_pill" };
  if (WEB.test(request)) {
    return { kind: "unavailable", message: "Web search is not available in Phoenix." };
  }
  if (MUSIC.test(request)) {
    const tool = findReadTool(tools, ["spotify.now_playing", "apple-music.now_playing"]);
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
    message: "I can read the status of enabled services, open the pill, or draft an email.",
  };
}
