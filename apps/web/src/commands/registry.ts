// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The one list of commands. The command palette shows it and the in-app keyboard shortcuts run it,
// so a command, its label and its key chord can never drift apart. (Global shortcuts that work from
// other applications belong to the desktop shell and are configured in Settings; they are not here.)
import type { DemoPhase } from "../core/demo-controller";
import type { MessageKey } from "../i18n";
import type { TabId } from "../components/PetPanel";
import {
  ChordError,
  chordId,
  parseChord,
  type Chord,
} from "./keys";

/** What a command may do. The App builds it from its own state; tests pass a fake. */
export interface CommandContext {
  /** Goes to an in-app route such as "/meetings". */
  navigate(route: string): void;
  /** Opens the Fawkes panel on a tab. */
  openPanelTab(tab: TabId): void;
  /** Settings, scrolled to and focused on the interface language. */
  openLanguageSettings(): void;
  togglePalette(): void;
  /** The demo controller's phase and entry points; null outside a <DemoHost>. */
  demo: { phase: DemoPhase; start(): void; stop(): void } | null;
  /** The desktop's mute flag; null in a browser, where there is no desktop to mute. */
  mute: { muted: boolean; toggle(): void } | null;
}

export interface Command {
  /** Stable, unique. */
  id: string;
  labelKey: MessageKey;
  /** Extra English search words; the localized label is always searched too. Data, not shown. */
  keywords: readonly string[];
  /** In-app chord, `Mod+K` style (see keys.ts for what is allowed). Omit for palette-only. */
  defaultKeys?: string;
  /** Only offered when this is true (e.g. "stop the demo" while it runs). */
  when?(ctx: CommandContext): boolean;
  /** True for the one chord that must keep working while the person is typing. */
  allowWhileTyping?: boolean;
  /** False to leave it out of the palette list (the palette's own opener). */
  inPalette?: boolean;
  run(ctx: CommandContext): void;
}

const PANEL_LABELS: Record<TabId, MessageKey> = {
  overview: "shell.cmd.panel.overview",
  chat: "shell.cmd.panel.chat",
  activity: "shell.cmd.panel.activity",
  capabilities: "shell.cmd.panel.capabilities",
  memory: "shell.cmd.panel.memory",
  wardrobe: "shell.cmd.panel.wardrobe",
};

const PANEL_KEYS: Record<TabId, readonly string[]> = {
  overview: ["fawkes", "pet", "approvals", "status"],
  chat: ["fawkes", "pet", "ask", "talk", "message"],
  activity: ["fawkes", "pet", "events", "feed", "log"],
  capabilities: ["fawkes", "pet", "integrations", "plugins"],
  memory: ["fawkes", "pet", "remember", "notes"],
  wardrobe: ["fawkes", "pet", "outfit", "appearance", "dress"],
};

const PANEL_CHORDS: Partial<Record<TabId, string>> = {
  chat: "Mod+Alt+Shift+7",
  wardrobe: "Mod+Alt+Shift+8",
};

const panelCommand = (tab: TabId): Command => ({
  id: `panel.${tab}`,
  labelKey: PANEL_LABELS[tab],
  keywords: PANEL_KEYS[tab],
  ...(PANEL_CHORDS[tab] ? { defaultKeys: PANEL_CHORDS[tab] } : {}),
  run: (ctx) => ctx.openPanelTab(tab),
});

const go = (
  id: string,
  route: string,
  labelKey: MessageKey,
  keywords: readonly string[],
  defaultKeys?: string,
): Command => ({
  id,
  labelKey,
  keywords,
  ...(defaultKeys ? { defaultKeys } : {}),
  run: (ctx) => ctx.navigate(route),
});

/** Opens the palette; its chord works everywhere, even in a text field. */
export const PALETTE_COMMAND_ID = "palette.open";

export const COMMANDS: readonly Command[] = [
  {
    id: PALETTE_COMMAND_ID,
    labelKey: "shell.cmd.palette.open",
    keywords: ["commands", "search", "find"],
    defaultKeys: "Mod+K",
    allowWhileTyping: true,
    inPalette: false,
    run: (ctx) => ctx.togglePalette(),
  },
  go("nav.home", "/", "shell.cmd.nav.home", ["overview", "start", "phoenix"]),
  go("nav.meetings", "/meetings", "shell.cmd.nav.meetings", ["kage", "calls", "notes"], "Mod+Alt+Shift+1"),
  go("nav.provenance", "/provenance", "shell.cmd.nav.provenance", ["graph", "source", "origin"], "Mod+Alt+Shift+2"),
  go("nav.agents", "/agents", "shell.cmd.nav.agents", ["sessions", "terminal", "coding"], "Mod+Alt+Shift+3"),
  go("nav.workflows", "/workflows", "shell.cmd.nav.workflows", ["automation", "runs"], "Mod+Alt+Shift+4"),
  go("nav.recap", "/recap", "shell.cmd.nav.recap", ["weekly", "statistics", "summary"], "Mod+Alt+Shift+5"),
  go("nav.settings", "/settings", "shell.cmd.nav.settings", ["preferences", "options", "configure"], "Mod+Alt+Shift+6"),
  {
    id: "settings.language",
    labelKey: "shell.cmd.settings.language",
    keywords: ["language", "locale", "translation", "settings", "rtl"],
    run: (ctx) => ctx.openLanguageSettings(),
  },
  panelCommand("overview"),
  panelCommand("chat"),
  panelCommand("activity"),
  panelCommand("capabilities"),
  panelCommand("memory"),
  panelCommand("wardrobe"),
  {
    id: "demo.start",
    labelKey: "shell.cmd.demo.start",
    keywords: ["demo", "walkthrough", "tour"],
    when: (ctx) => ctx.demo?.phase === "off",
    run: (ctx) => ctx.demo?.start(),
  },
  {
    id: "demo.stop",
    labelKey: "shell.cmd.demo.stop",
    keywords: ["demo", "walkthrough", "tour", "exit", "end"],
    when: (ctx) => ctx.demo?.phase === "on",
    run: (ctx) => ctx.demo?.stop(),
  },
  {
    id: "mute.toggle",
    labelKey: "shell.cmd.mute.toggle",
    keywords: ["mute", "quiet", "silence", "sound", "notifications"],
    defaultKeys: "Mod+Alt+Shift+9",
    when: (ctx) => ctx.mute !== null,
    run: (ctx) => ctx.mute?.toggle(),
  },
];

export const available = (commands: readonly Command[], ctx: CommandContext): Command[] =>
  commands.filter((c) => c.when?.(ctx) ?? true);

export interface Bindings {
  /** chord id (see chordId) to the command it runs. */
  byChord: ReadonlyMap<string, Command>;
  /** command id to its parsed chord. */
  byCommand: ReadonlyMap<string, Chord>;
}

/**
 * Binds every command's chord. A chord two commands claim, or one the key rules forbid, is a
 * programming mistake: with `strict` (development and tests) it throws so it is fixed before it
 * ships; otherwise the first command keeps the chord and the second goes without one.
 */
export function buildBindings(
  commands: readonly Command[],
  strict: boolean = import.meta.env.DEV,
): Bindings {
  const byChord = new Map<string, Command>();
  const byCommand = new Map<string, Chord>();
  const ids = new Set<string>();
  for (const command of commands) {
    if (ids.has(command.id)) {
      if (strict) throw new Error(`Duplicate command id "${command.id}"`);
      continue;
    }
    ids.add(command.id);
    if (!command.defaultKeys) continue;
    let chord: Chord;
    try {
      chord = parseChord(command.defaultKeys);
    } catch (err) {
      if (strict && err instanceof ChordError) throw err;
      continue;
    }
    const id = chordId(chord);
    const owner = byChord.get(id);
    if (owner) {
      if (strict) throw new Error(`"${command.id}" and "${owner.id}" both use ${id}`);
      continue;
    }
    byChord.set(id, command);
    byCommand.set(command.id, chord);
  }
  return { byChord, byCommand };
}
