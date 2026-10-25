// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Editing an agent's JSON settings file without disturbing it: the text style (BOM, line endings,
// indentation, final newline) is detected and kept, the user's own hooks are never removed or
// reordered, and Phoenix's entries are recognised only by their command (see HOOK_SCRIPT_PATTERN).
// A merge that changes nothing returns the original text untouched, so installing twice never
// rewrites the file.
import { isRecord } from "../guards";
import { InstallError } from "./errors";
import { HOOK_SCRIPT_PATTERN } from "./commands";

export interface TextStyle {
  bom: boolean;
  eol: "\n" | "\r\n";
  /** Spaces per level, or a tab. */
  indent: number | "\t";
  finalNewline: boolean;
}

export type JsonObject = Record<string, unknown>;

const DEFAULT_STYLE: TextStyle = { bom: false, eol: "\n", indent: 2, finalNewline: true };

export function detectStyle(text: string | null): TextStyle {
  if (text === null || text.trim() === "") {
    const crlf = text !== null && text.includes("\r\n");
    return { ...DEFAULT_STYLE, ...(crlf ? { eol: "\r\n" as const } : {}) };
  }
  const bom = text.charCodeAt(0) === 0xfeff;
  const body = bom ? text.slice(1) : text;
  const crlf = (body.match(/\r\n/g) ?? []).length;
  const lf = (body.match(/\n/g) ?? []).length - crlf;
  const indentMatch = /^([ \t]+)\S/m.exec(body);
  let indent: TextStyle["indent"] = 2;
  if (indentMatch) {
    const lead = indentMatch[1]!;
    indent = lead.startsWith("\t") ? "\t" : Math.min(lead.length, 8);
  }
  return {
    bom,
    eol: crlf > 0 && crlf >= lf ? "\r\n" : "\n",
    indent,
    finalNewline: body.endsWith("\n"),
  };
}

export interface ParsedConfig {
  doc: JsonObject;
  style: TextStyle;
  /** The file was missing or only whitespace. */
  blank: boolean;
}

/** Blank/missing is an empty document. Anything that is not a JSON object is refused. */
export function parseConfig(text: string | null): ParsedConfig {
  const style = detectStyle(text);
  if (text === null || text.trim() === "") return { doc: {}, style, blank: true };
  let value: unknown;
  try {
    value = JSON.parse(style.bom ? text.slice(1) : text);
  } catch {
    throw new InstallError(
      "invalid_file",
      "The file is not valid JSON (comments are not supported), so Phoenix will not change it.",
    );
  }
  if (!isRecord(value)) {
    throw new InstallError("invalid_file", "The file does not contain a JSON object.");
  }
  return { doc: value, style, blank: false };
}

export function serializeConfig(doc: JsonObject, style: TextStyle): string {
  const body = JSON.stringify(doc, null, style.indent).replace(/\n/g, style.eol);
  return (style.bom ? "\uFEFF" : "") + body + (style.finalNewline ? style.eol : "");
}

/** Key-order independent form, for "is this the entry Phoenix would write". */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sameJson(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

/** How hook entries nest: `{matcher?, hooks:[handler]}` groups, or handlers listed directly. */
export type HookShape = "grouped" | "flat";

export interface HookSpec {
  shape: HookShape;
  /** event name → the groups (grouped) or handlers (flat) Phoenix wants in that event. */
  events: Readonly<Record<string, readonly unknown[]>>;
}

const COMMAND_FIELDS = ["command", "bash", "powershell"] as const;

/** A handler is Phoenix's when one of its command strings runs one of Phoenix's hook scripts. */
export function isPhoenixHandler(handler: unknown): boolean {
  return (
    isRecord(handler) &&
    COMMAND_FIELDS.some(
      (f) => typeof handler[f] === "string" && HOOK_SCRIPT_PATTERN.test(handler[f]),
    )
  );
}

function handlersOf(entry: unknown, shape: HookShape): unknown[] {
  if (shape === "flat") return [entry];
  return isRecord(entry) && Array.isArray(entry.hooks) ? (entry.hooks as unknown[]) : [];
}

const hasPhoenix = (entry: unknown, shape: HookShape) =>
  handlersOf(entry, shape).some(isPhoenixHandler);

/** The entry without Phoenix's handlers, or null when nothing of the user's is left in it. */
function stripPhoenix(entry: unknown, shape: HookShape): unknown {
  if (shape === "flat") return isPhoenixHandler(entry) ? null : entry;
  if (!isRecord(entry) || !Array.isArray(entry.hooks)) return entry;
  const kept = (entry.hooks as unknown[]).filter((h) => !isPhoenixHandler(h));
  if (kept.length === entry.hooks.length) return entry;
  return kept.length === 0 ? null : { ...entry, hooks: kept };
}

function hooksObject(doc: JsonObject, create: boolean): JsonObject | null {
  const hooks = doc.hooks;
  if (hooks === undefined) {
    if (!create) return null;
    const made: JsonObject = {};
    doc.hooks = made;
    return made;
  }
  if (!isRecord(hooks)) {
    throw new InstallError("invalid_file", 'The "hooks" setting is not an object.');
  }
  return hooks;
}

function eventList(hooks: JsonObject, event: string): unknown[] | null {
  const list = hooks[event];
  if (list === undefined) return null;
  if (!Array.isArray(list)) {
    throw new InstallError("invalid_file", `The "${event}" hook list is not an array.`);
  }
  return list;
}

/** The list Phoenix wants for one event, user entries kept in place. */
function wantedList(
  current: unknown[] | null,
  desired: readonly unknown[],
  shape: HookShape,
): unknown[] {
  if (current === null) return [...desired];
  if (!current.some((e) => hasPhoenix(e, shape))) return [...current, ...desired];
  const next: unknown[] = [];
  let placed = false;
  for (const entry of current) {
    if (!hasPhoenix(entry, shape)) {
      next.push(entry);
      continue;
    }
    if (!placed) {
      next.push(...desired);
      placed = true;
    }
    const rest = stripPhoenix(entry, shape);
    if (rest !== null) next.push(rest);
  }
  return next;
}

/** Events whose Phoenix entries are missing or differ from `spec` (what repair would write). */
export function staleEvents(doc: JsonObject, spec: HookSpec): string[] {
  const hooks = isRecord(doc.hooks) ? doc.hooks : {};
  return Object.entries(spec.events)
    .filter(([event, desired]) => {
      const list = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : null;
      return !sameJson(wantedList(list, desired, spec.shape), list ?? []) || list === null;
    })
    .map(([event]) => event);
}

/** Adds or refreshes Phoenix's entries in `doc`. Returns whether anything changed. */
export function upsertHooks(doc: JsonObject, spec: HookSpec): boolean {
  let changed = false;
  for (const [event, desired] of Object.entries(spec.events)) {
    const hooks = hooksObject(doc, true)!;
    const current = eventList(hooks, event);
    const next = wantedList(current, desired, spec.shape);
    if (current === null || !sameJson(next, current)) {
      hooks[event] = next;
      changed = true;
    }
  }
  return changed;
}

/** Removes only Phoenix's handlers (and the groups/lists/object they leave empty). */
export function removeHooks(doc: JsonObject, shape: HookShape): boolean {
  const hooks = hooksObject(doc, false);
  if (!hooks) return false;
  let changed = false;
  for (const event of Object.keys(hooks)) {
    const list = eventList(hooks, event);
    if (!list || !list.some((e) => hasPhoenix(e, shape))) continue;
    const kept = list.map((e) => stripPhoenix(e, shape)).filter((e) => e !== null);
    changed = true;
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  if (changed && Object.keys(hooks).length === 0) delete doc.hooks;
  return changed;
}

/** Whether the document holds nothing but `skeleton` (so a file Phoenix created can be deleted). */
export function isSkeleton(doc: JsonObject, skeleton: JsonObject): boolean {
  return sameJson(doc, skeleton);
}

/**
 * The "named" layout (Google Antigravity, https://antigravity.google/docs/hooks): `hooks.json` maps a
 * hook NAME to `{enabled?, <Event>: [...]}`, there is no top-level `hooks` object. Phoenix owns one
 * name; its events are merged with the same rules as above (the user's own handlers inside that name,
 * and every other name, are kept in place). Some events list handlers directly (`flat`) and some list
 * `{matcher, hooks}` groups (`grouped`), so each event has its own shape.
 */
export interface NamedLayout {
  /** The hook name Phoenix owns. */
  key: string;
  shapes: Readonly<Record<string, HookShape>>;
}

function namedEntry(doc: JsonObject, key: string, create: boolean): JsonObject | null {
  const entry = doc[key];
  if (entry === undefined) {
    if (!create) return null;
    const made: JsonObject = {};
    doc[key] = made;
    return made;
  }
  if (!isRecord(entry)) {
    throw new InstallError("invalid_file", `The "${key}" hook is not an object.`);
  }
  return entry;
}

/** Event names Phoenix's named hook is missing or has changed (what repair would write). */
export function staleNamed(
  doc: JsonObject,
  layout: NamedLayout,
  events: Readonly<Record<string, readonly unknown[]>>,
): string[] {
  const entry = isRecord(doc[layout.key]) ? (doc[layout.key] as JsonObject) : {};
  return Object.entries(events)
    .filter(([event, desired]) => {
      const list = Array.isArray(entry[event]) ? (entry[event] as unknown[]) : null;
      return list === null || !sameJson(wantedList(list, desired, layout.shapes[event]!), list);
    })
    .map(([event]) => event);
}

/** Adds or refreshes Phoenix's events under its own hook name. Returns whether anything changed. */
export function upsertNamed(
  doc: JsonObject,
  layout: NamedLayout,
  events: Readonly<Record<string, readonly unknown[]>>,
): boolean {
  let changed = false;
  for (const [event, desired] of Object.entries(events)) {
    const entry = namedEntry(doc, layout.key, true)!;
    const current = eventList(entry, event);
    const next = wantedList(current, desired, layout.shapes[event]!);
    if (current === null || !sameJson(next, current)) {
      entry[event] = next;
      changed = true;
    }
  }
  return changed;
}

/** Removes only Phoenix's handlers; the name goes when nothing but `enabled` is left of it. */
export function removeNamed(doc: JsonObject, layout: NamedLayout): boolean {
  const entry = namedEntry(doc, layout.key, false);
  if (!entry) return false;
  let changed = false;
  for (const [event, shape] of Object.entries(layout.shapes)) {
    const list = eventList(entry, event);
    if (!list || !list.some((e) => hasPhoenix(e, shape))) continue;
    const kept = list.map((e) => stripPhoenix(e, shape)).filter((e) => e !== null);
    changed = true;
    if (kept.length === 0) delete entry[event];
    else entry[event] = kept;
  }
  if (changed && Object.keys(entry).every((k) => k === "enabled")) delete doc[layout.key];
  return changed;
}
