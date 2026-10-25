// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The per-agent adapter table. An adapter is writable only when the vendor's public documentation
// shows the file location and the hook/plugin shape (the doc URL is on each entry). Everything
// else is registered as unsupported with the reason, detected but never written: guessing a
// config format could break the user's agent.
import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { codexHooksConfig } from "../approval-codex";
import { APPROVAL_TIMEOUT, approvalHookTimeoutSeconds } from "../approval-map";
import { claudeHooksConfig } from "../claude";
import { isRecord } from "../guards";
import { claudeStatusLine } from "./statusline-hook";
import { hookCommands, type HookCommands, type HookCommandOptions } from "./commands";
import {
  removeHooks,
  removeNamed,
  staleEvents,
  staleNamed,
  upsertHooks,
  upsertNamed,
  type HookShape,
  type HookSpec,
  type JsonObject,
  type NamedLayout,
} from "./config-json";

export interface AdapterContext {
  home: string;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  commands: HookCommands;
}

export function adapterContext(
  home: string,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  commandOptions: HookCommandOptions = {},
): AdapterContext {
  return { home, env, platform, commands: hookCommands({ platform, ...commandOptions }) };
}

/**
 * A `statusLine` wrapper (Phase 58 usage). Plain hook installs never touch `statusLine`; an
 * adapter with a StatusLineHook has it applied on install/repair and undone on uninstall, with
 * the same preview, backup and sentinel rules. Only Claude Code has one (statusline-hook.ts).
 */
export interface StatusLineHook {
  apply(doc: JsonObject, ctx: AdapterContext): boolean;
  remove(doc: JsonObject): boolean;
  /** Phoenix's wrapper is missing or differs from what install would write. */
  stale(doc: JsonObject, ctx: AdapterContext): boolean;
}

/** Reported in `missing` when the statusLine wrapper is absent or changed. */
export const STATUSLINE_MISSING = "statusLine";

interface AdapterBase {
  id: string;
  label: string;
  /** Binary looked for on PATH (never executed). */
  bin: string;
  doc_url: string;
  /** Directory whose existence means the agent has been used on this machine. */
  configDir(ctx: AdapterContext): string;
  /** The file Phoenix writes. */
  settingsPath(ctx: AdapterContext): string;
}

export interface JsonAdapter extends AdapterBase {
  kind: "json";
  support: "supported";
  /** Caveat shown next to a supported agent. */
  note?: string;
  /** What a new file starts as (Cursor and Copilot need `version`, Muse `schema_version`). */
  skeleton: JsonObject;
  shape: HookShape;
  spec(ctx: AdapterContext): HookSpec;
  statusLine?: StatusLineHook;
  /**
   * Google Antigravity's layout: the file maps hook NAMES to event lists and has no top-level
   * `hooks` object. When set, merge/remove/health work on that named entry; `spec(ctx).events` are
   * still the entries Phoenix wants per event.
   */
  named?: NamedLayout;
  merge(before: JsonObject, ctx: AdapterContext): { after: JsonObject; changed: boolean };
  remove(after: JsonObject): { before: JsonObject; changed: boolean };
  /** Events whose Phoenix hooks are missing from `doc`. */
  health(doc: JsonObject, ctx: AdapterContext): string[];
}

export interface PluginAdapter extends AdapterBase {
  kind: "plugin";
  support: "supported";
  note?: string;
  /** The whole plugin file; contains PLUGIN_MARKER. */
  contents(ctx: AdapterContext): string;
}

export interface UnsupportedAdapter extends AdapterBase {
  kind: "unsupported";
  support: "unsupported";
  reason: string;
}

export type AgentAdapter = JsonAdapter | PluginAdapter | UnsupportedAdapter;

/** First line of every plugin file Phoenix writes; health and uninstall recognise the file by it. */
export const PLUGIN_MARKER = "phoenix_managed";

export function detectAgent(
  adapter: AgentAdapter,
  ctx: AdapterContext,
): { detected: boolean; via?: string } {
  const dir = adapter.configDir(ctx);
  if (existsSync(dir)) return { detected: true, via: `config directory ${dir}` };
  const suffixes = ctx.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const part of (ctx.env.PATH ?? "").split(delimiter)) {
    if (!part) continue;
    for (const suffix of suffixes) {
      try {
        // Looked up, never run: detection must not start an agent.
        if (statSync(join(part, adapter.bin + suffix)).isFile()) {
          return { detected: true, via: `${adapter.bin} on PATH` };
        }
      } catch {
        // not in this PATH entry
      }
    }
  }
  return { detected: false };
}

const xdgConfig = (ctx: AdapterContext) => ctx.env.XDG_CONFIG_HOME || join(ctx.home, ".config");

function jsonAdapter(
  base: Omit<JsonAdapter, "kind" | "support" | "merge" | "remove" | "health">,
): JsonAdapter {
  return {
    ...base,
    kind: "json",
    support: "supported",
    merge(before, ctx) {
      const after = structuredClone(before);
      const hooks = base.named
        ? upsertNamed(after, base.named, base.spec(ctx).events)
        : upsertHooks(after, base.spec(ctx));
      const line = base.statusLine?.apply(after, ctx) ?? false;
      return { after, changed: hooks || line };
    },
    remove(after) {
      const before = structuredClone(after);
      const hooks = base.named ? removeNamed(before, base.named) : removeHooks(before, base.shape);
      const line = base.statusLine?.remove(before) ?? false;
      return { before, changed: hooks || line };
    },
    health(doc, ctx) {
      const stale = base.named
        ? staleNamed(doc, base.named, base.spec(ctx).events)
        : staleEvents(doc, base.spec(ctx));
      return base.statusLine?.stale(doc, ctx) ? [...stale, STATUSLINE_MISSING] : stale;
    },
  };
}

const grouped = (events: Readonly<Record<string, readonly unknown[]>>): HookSpec => ({
  shape: "grouped",
  events,
});
const flat = (events: Readonly<Record<string, readonly unknown[]>>): HookSpec => ({
  shape: "flat",
  events,
});

/** `{matcher?, hooks:[handler]}` group around one command handler. */
const group = (handler: Record<string, unknown>) => [{ hooks: [handler] }];

const claudeSpec = (ctx: AdapterContext): HookSpec => {
  // Phase 79: the secret guard runs for EVERY PreToolUse (no matcher) next to the AskUserQuestion
  // approval group. Both are Phoenix's, so install/repair/uninstall treat them as one set.
  const config = claudeHooksConfig(
    ctx.commands.claudeState(),
    {
      command: ctx.commands.approval("claude-code", APPROVAL_TIMEOUT.default),
      timeoutMs: APPROVAL_TIMEOUT.default,
    },
    {
      command: ctx.commands.guard("claude-code", APPROVAL_TIMEOUT.default),
      timeoutMs: APPROVAL_TIMEOUT.default,
    },
  );
  return grouped(isRecord(config.hooks) ? (config.hooks as Record<string, unknown[]>) : {});
};

const codexSpec = (ctx: AdapterContext): HookSpec => {
  const approval = codexHooksConfig(
    ctx.commands.approval("codex", APPROVAL_TIMEOUT.default),
    APPROVAL_TIMEOUT.default,
    { command: ctx.commands.guard("codex", APPROVAL_TIMEOUT.default) },
  );
  const observe = group({ type: "command", command: ctx.commands.generic("codex"), timeout: 5 });
  const codexHooks = isRecord(approval.hooks) ? approval.hooks : {};
  return grouped({
    SessionStart: observe,
    UserPromptSubmit: observe,
    PostToolUse: observe,
    Stop: observe,
    SessionEnd: observe,
    PermissionRequest: codexHooks.PermissionRequest as unknown[],
    // Phase 79: Codex's PreToolUse takes the same deny shape (developers.openai.com/codex/hooks).
    // No matcher: the guard reads every tool's input. UNVERIFIED against a real Codex.
    PreToolUse: codexHooks.PreToolUse as unknown[],
  });
};

const cursorSpec = (ctx: AdapterContext): HookSpec => {
  const hook = (event: string) => [{ command: ctx.commands.generic("cursor", event), timeout: 5 }];
  return flat({
    sessionStart: hook("sessionStart"),
    beforeSubmitPrompt: hook("beforeSubmitPrompt"),
    afterShellExecution: hook("afterShellExecution"),
    stop: hook("stop"),
    sessionEnd: hook("sessionEnd"),
  });
};

const geminiSpec = (ctx: AdapterContext): HookSpec => {
  const hook = (event: string) =>
    group({
      name: "phoenix-agent",
      type: "command",
      command: ctx.commands.generic("gemini-cli", event),
      timeout: 5_000,
    });
  return grouped({
    SessionStart: hook("SessionStart"),
    BeforeAgent: hook("BeforeAgent"),
    AfterTool: hook("AfterTool"),
    AfterAgent: hook("AfterAgent"),
    Notification: hook("Notification"),
    SessionEnd: hook("SessionEnd"),
  });
};

const copilotSpec = (ctx: AdapterContext): HookSpec => {
  const hook = (event: string) => [
    { type: "command", command: ctx.commands.generic("copilot-cli", event), timeoutSec: 5 },
  ];
  return flat({
    sessionStart: hook("sessionStart"),
    userPromptSubmitted: hook("userPromptSubmitted"),
    postToolUse: hook("postToolUse"),
    agentStop: hook("agentStop"),
    notification: hook("notification"),
    sessionEnd: hook("sessionEnd"),
  });
};

const museSpec = (ctx: AdapterContext): HookSpec => {
  const hook = (event: string) =>
    group({ type: "command", command: ctx.commands.generic("muse-code", event), timeout: 5 });
  return grouped({
    SessionStart: hook("SessionStart"),
    UserPromptSubmit: hook("UserPromptSubmit"),
    PostToolUse: hook("PostToolUse"),
    Stop: hook("Stop"),
    Notification: hook("Notification"),
    SessionEnd: hook("SessionEnd"),
  });
};

/** The hook name Phoenix owns inside Antigravity's `hooks.json` (a map of hook names to events). */
export const ANTIGRAVITY_HOOK_NAME = "phoenix-agent";
const ANTIGRAVITY_SHAPES: Readonly<Record<string, HookShape>> = {
  SessionStart: "flat",
  PreInvocation: "flat",
  PostToolUse: "grouped",
  Stop: "flat",
};

/**
 * https://antigravity.google/docs/hooks: handlers of `SessionStart`, `PreInvocation` and `Stop` are
 * listed directly under the event, `PostToolUse` takes `{matcher, hooks:[...]}` groups, `timeout` is in
 * seconds. Phoenix only observes: it never installs `PreToolUse` (whose output REQUIRES a `decision`).
 * `Stop` REQUIRES a `decision` and anything but "continue" lets the agent stop, so its handler prints
 * the fixed `antigravity-stop` reply; the other events print `{}` (their outputs are all optional).
 */
const antigravitySpec = (ctx: AdapterContext): HookSpec => {
  const handler = (event: string, reply?: string) => ({
    type: "command",
    command: ctx.commands.generic("antigravity", event, reply),
    timeout: 5,
  });
  return {
    shape: "grouped",
    events: {
      SessionStart: [handler("SessionStart")],
      PreInvocation: [handler("PreInvocation")],
      PostToolUse: [{ matcher: "*", hooks: [handler("PostToolUse")] }],
      Stop: [handler("Stop", "antigravity-stop")],
    },
  };
};

const OPENCODE_STATES = JSON.stringify({
  "session.created": "started",
  "session.idle": "completed",
  "session.deleted": "ended",
});

/** https://opencode.ai/docs/plugins: files in ~/.config/opencode/plugins/ load at startup. */
function openCodePlugin(ctx: AdapterContext): string {
  return `// ${PLUGIN_MARKER}: written by Phoenix, removed by Phoenix uninstall. Do not edit.
// OpenCode plugin API: https://opencode.ai/docs/plugins
import { exec } from "node:child_process";

const command = ${JSON.stringify(ctx.commands.generic("opencode"))};
const states = ${OPENCODE_STATES};

export const PhoenixPlugin = async ({ directory }) => ({
  event: async ({ event }) => {
    const state = states[event.type];
    if (!state) return;
    const props = event.properties ?? {};
    const id = props.info?.id ?? props.sessionID;
    const workspace = props.info?.directory ?? directory;
    if (!id || !workspace) return;
    exec(command, {
      env: { ...process.env, PHOENIX_AGENT_STATE: state, PHOENIX_AGENT_ID: id, PHOENIX_AGENT_WORKSPACE: workspace },
    }, () => {});
  },
});
`;
}

/** https://ampcode.com/docs/customize/plugins: ~/.config/amp/plugins/<name>.js. */
function ampPlugin(ctx: AdapterContext): string {
  return `// ${PLUGIN_MARKER}: written by Phoenix, removed by Phoenix uninstall. Do not edit.
// Amp plugin API: https://ampcode.com/docs/plugin-api
import { exec } from "node:child_process";

const command = ${JSON.stringify(ctx.commands.generic("amp"))};

export default function (amp) {
  const root = amp.system.workspaceRoot;
  const workspace = root ? amp.helpers.filePathFromURI(root) : process.cwd();
  const report = (event, state) =>
    exec(command, {
      env: { ...process.env, PHOENIX_AGENT_STATE: state, PHOENIX_AGENT_ID: event.thread.id, PHOENIX_AGENT_WORKSPACE: workspace },
    }, () => {});
  amp.on("session.start", (event) => report(event, "started"));
  amp.on("agent.start", (event) => report(event, "working"));
  amp.on("agent.end", (event) => report(event, event.status === "error" ? "failed" : "completed"));
}
`;
}

/** Every agent Phoenix knows. Supported ones link the docs the format was read from. */
export const AGENT_ADAPTERS: readonly AgentAdapter[] = [
  jsonAdapter({
    id: "claude-code",
    label: "Claude Code",
    bin: "claude",
    doc_url: "https://code.claude.com/docs/en/hooks",
    configDir: (c) => join(c.home, ".claude"),
    settingsPath: (c) => join(c.home, ".claude", "settings.json"),
    skeleton: {},
    shape: "grouped",
    spec: claudeSpec,
    statusLine: claudeStatusLine,
    note: "The Claude Desktop Code tab reads the same settings file. An existing statusLine is wrapped, not replaced, so it keeps printing exactly what it printed (macOS/Linux only).",
  }),
  jsonAdapter({
    id: "codex",
    label: "Codex",
    bin: "codex",
    doc_url: "https://developers.openai.com/codex/hooks",
    configDir: (c) => join(c.home, ".codex"),
    settingsPath: (c) => join(c.home, ".codex", "hooks.json"),
    skeleton: {},
    shape: "grouped",
    spec: codexSpec,
    note: "Codex asks you to review and trust new hooks: open /hooks in Codex once after installing.",
  }),
  jsonAdapter({
    id: "cursor",
    label: "Cursor",
    bin: "cursor",
    doc_url: "https://cursor.com/docs/hooks",
    configDir: (c) => join(c.home, ".cursor"),
    settingsPath: (c) => join(c.home, ".cursor", "hooks.json"),
    skeleton: { version: 1 },
    shape: "flat",
    spec: cursorSpec,
    note: "User-level hooks; Cursor does not document a permission-wait hook, so waiting is not reported.",
  }),
  jsonAdapter({
    id: "gemini-cli",
    label: "Gemini CLI",
    bin: "gemini",
    doc_url: "https://geminicli.com/docs/hooks/reference/",
    configDir: (c) => join(c.home, ".gemini"),
    settingsPath: (c) => join(c.home, ".gemini", "settings.json"),
    skeleton: {},
    shape: "grouped",
    spec: geminiSpec,
  }),
  jsonAdapter({
    id: "copilot-cli",
    label: "GitHub Copilot CLI",
    bin: "copilot",
    doc_url: "https://docs.github.com/en/copilot/reference/hooks-reference",
    configDir: (c) => c.env.COPILOT_HOME || join(c.home, ".copilot"),
    settingsPath: (c) =>
      join(c.env.COPILOT_HOME || join(c.home, ".copilot"), "hooks", "phoenix.json"),
    skeleton: { version: 1 },
    shape: "flat",
    spec: copilotSpec,
    note: "Phoenix writes its own file, hooks/phoenix.json; your other Copilot hook files are not touched.",
  }),
  jsonAdapter({
    id: "muse-code",
    label: "Muse Code",
    bin: "muse",
    doc_url: "https://dev.meta.ai/docs/muse-code/configuration",
    configDir: (c) => join(xdgConfig(c), "muse"),
    settingsPath: (c) => join(xdgConfig(c), "muse", "settings.json"),
    skeleton: { schema_version: 1 },
    shape: "grouped",
    spec: museSpec,
    note: "Muse Code hooks are documented as a developer preview; their stdout contract is not confirmed.",
  }),
  {
    kind: "plugin",
    support: "supported",
    id: "opencode",
    label: "OpenCode",
    bin: "opencode",
    doc_url: "https://opencode.ai/docs/plugins",
    configDir: (c) => join(xdgConfig(c), "opencode"),
    settingsPath: (c) => join(xdgConfig(c), "opencode", "plugins", "phoenix.js"),
    contents: openCodePlugin,
    note: "Plugin folder and event names are in the docs; the session fields inside events are taken from the SDK types, not the docs page.",
  },
  {
    kind: "plugin",
    support: "supported",
    id: "amp",
    label: "Amp",
    bin: "amp",
    doc_url: "https://ampcode.com/docs/customize/plugins",
    configDir: (c) => join(xdgConfig(c), "amp"),
    settingsPath: (c) => join(xdgConfig(c), "amp", "plugins", "phoenix.js"),
    contents: ampPlugin,
    note: "Amp has no session-end or permission event, so only start, working and finished are reported.",
  },
  {
    kind: "unsupported",
    support: "unsupported",
    id: "hermes",
    label: "Hermes Agent",
    bin: "hermes",
    doc_url: "https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins",
    configDir: (c) => join(c.home, ".hermes"),
    settingsPath: (c) => join(c.home, ".hermes", "plugins", "phoenix", "plugin.yaml"),
    reason:
      "unsupported: a Hermes plugin loads only after `hermes plugins enable <name>` (or plugins.enabled in ~/.hermes/config.yaml, YAML Phoenix will not rewrite) and its documented hook callbacks carry no workspace directory; the one no-YAML integration point, a gateway hook directory (~/.hermes/hooks/<name>/HOOK.yaml + handler.py), is documented as never loaded by CLI, TUI or Desktop sessions and its events carry no workspace either, and shell hooks that do receive cwd are declared in config.yaml",
  },
  jsonAdapter({
    id: "antigravity",
    label: "Google Antigravity",
    bin: "agy",
    doc_url: "https://antigravity.google/docs/hooks",
    configDir: (c) => join(c.home, ".gemini", "antigravity-cli"),
    settingsPath: (c) => join(c.home, ".gemini", "config", "hooks.json"),
    skeleton: {},
    shape: "grouped",
    spec: antigravitySpec,
    named: { key: ANTIGRAVITY_HOOK_NAME, shapes: ANTIGRAVITY_SHAPES },
    note: "State only. The file is ~/.gemini/config/hooks.json (global level, shared by the Antigravity App, CLI and IDE); Phoenix owns one hook named phoenix-agent and keeps your others. The docs do not document hook exit codes, so Phoenix's hooks always exit 0. No permission-wait hook is documented (PreToolUse only returns allow/ask/deny and Phoenix never answers it), so waiting is not reported.",
  }),
  {
    kind: "unsupported",
    support: "unsupported",
    id: "claude-desktop",
    label: "Claude Desktop (Chat)",
    bin: "claude-desktop",
    doc_url: "https://claude.com/docs/third-party/claude-desktop/extensions",
    configDir: (c) => join(c.home, "Library", "Application Support", "Claude"),
    settingsPath: (c) =>
      join(c.home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    reason:
      "unsupported: no user-writable hooks location for Chat is documented (Chat hooks come from plugins added to your claude.ai account or, on Claude Desktop 3P, from the admin-owned org-plugins directory; the plugin support page marks hooks as ignored in Chat); the Code tab uses Claude Code's settings, so install Claude Code above",
  },
];
