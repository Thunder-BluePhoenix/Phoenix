// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Fawkes appearance (Phase 61): which outfit Fawkes wears, the hemisphere used for "auto-season",
// user-imported outfit packs and the colour/glyph/"show in Fawkes" choice per source.
//
// Everything is the user's own cosmetic setting, stored in the settings store under
// `fawkes.appearance`, and changed only through the session-token routes (never a capability command,
// never a tool). Outfit packs are untrusted data: they are validated here again with the same strict
// allow-list the renderer uses, and a bad pack is rejected whole. Nothing in this file touches
// Fawkes' state, its label or its announcements.
import type { EventBus } from "@phoenix/event-bus";
import type { SettingsStore } from "@phoenix/persistence";
import { createEvent, ErrorCode, PhoenixError } from "@phoenix/protocol";
// The validator is pure and dependency-free; importing it by path keeps one allow-list for Core and
// the renderer without adding a package dependency to Core.
import {
  BUILTIN_OUTFITS,
  defaultSourceStyle,
  GLYPH_NAMES,
  isGlyphName,
  MAX_SOURCES,
  MAX_USER_PACKS,
  MAX_USER_PACK_BYTES,
  OutfitError,
  SOURCE_COLOUR,
  SOURCE_ID,
  validateOutfitPack,
} from "../../../pet/assets/src/outfits";
import type { OutfitPack } from "../../../pet/assets/src/types";
import type { SourceStyle } from "../../../pet/assets/src/outfits/sources";

export const APPEARANCE_KEY = "fawkes.appearance";
export const APPEARANCE_CHANGED = "fawkes.appearance.changed";

export interface StoredAppearance {
  outfit: string;
  hemisphere: "north" | "south";
  packs: OutfitPack[];
  sources: Record<string, SourceStyle>;
}

/** A source the user can style: a capability, or an agent that has reported in. */
export interface KnownSource {
  id: string;
  label: string;
  kind: "agent" | "capability";
}

export interface AppearanceView extends StoredAppearance {
  /** The built-in outfits, for the picker (their art ships with the app, not in this answer). */
  builtin: { id: string; name: string; season: string }[];
  known: KnownSource[];
  glyphs: readonly string[];
  limits: { packs: number; pack_bytes: number; sources: number };
}

export interface AppearanceDeps {
  settings: SettingsStore;
  bus: EventBus;
  /** Capabilities and agents seen so far; used to refuse styling for a source that does not exist. */
  known: () => KnownSource[];
}

const DEFAULTS: StoredAppearance = { outfit: "none", hemisphere: "north", packs: [], sources: {} };
const invalid = (message: string, details: string[] = []) =>
  new PhoenixError(ErrorCode.INVALID_REQUEST, message, details);

function plain(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function only(value: Record<string, unknown>, allowed: readonly string[], what: string): void {
  const extra = Object.keys(value).filter((k) => !allowed.includes(k));
  if (extra.length > 0) throw invalid(`${what} has unknown fields`);
}

function packBytes(packs: readonly OutfitPack[]): number {
  return new TextEncoder().encode(JSON.stringify(packs)).length;
}

export class AppearanceRuntime {
  constructor(private readonly d: AppearanceDeps) {}

  private stored(): StoredAppearance {
    const saved = this.d.settings.get<Partial<StoredAppearance>>(APPEARANCE_KEY, {});
    // A stored value from an older or damaged file never widens what is trusted: packs are re-validated.
    const packs: OutfitPack[] = [];
    for (const p of Array.isArray(saved.packs) ? saved.packs : []) {
      try {
        packs.push(validateOutfitPack(p));
      } catch {
        // dropped: a pack that no longer passes the allow-list is never rendered
      }
    }
    return {
      outfit: typeof saved.outfit === "string" ? saved.outfit : DEFAULTS.outfit,
      hemisphere: saved.hemisphere === "south" ? "south" : "north",
      packs: packs.slice(0, MAX_USER_PACKS),
      sources:
        typeof saved.sources === "object" && saved.sources !== null && !Array.isArray(saved.sources)
          ? saved.sources
          : {},
    };
  }

  get(): AppearanceView {
    const s = this.stored();
    const known = this.d.known();
    // Every known source has a look: its saved choice or a stable default.
    const sources: Record<string, SourceStyle> = { ...s.sources };
    for (const k of known) sources[k.id] ??= defaultSourceStyle(k.id);
    return {
      ...s,
      outfit: this.outfitExists(s.outfit, s.packs) ? s.outfit : "none",
      sources,
      builtin: BUILTIN_OUTFITS.map((o) => ({ id: o.id, name: o.name, season: o.season ?? "any" })),
      known,
      glyphs: GLYPH_NAMES,
      limits: { packs: MAX_USER_PACKS, pack_bytes: MAX_USER_PACK_BYTES, sources: MAX_SOURCES },
    };
  }

  private outfitExists(id: string, packs: readonly OutfitPack[]): boolean {
    return (
      id === "none" ||
      id === "auto-season" ||
      BUILTIN_OUTFITS.some((o) => o.id === id) ||
      packs.some((p) => p.id === id)
    );
  }

  /** Partial update: `outfit`, `hemisphere` and a `sources` patch. Packs change only via import/delete. */
  set(input: unknown): AppearanceView {
    const body = plain(input, "The request");
    only(body, ["outfit", "hemisphere", "sources"], "The request");
    const next = this.stored();
    if (body.outfit !== undefined) {
      if (typeof body.outfit !== "string" || !this.outfitExists(body.outfit, next.packs)) {
        throw invalid('"outfit" must be "none", "auto-season" or the id of an installed outfit');
      }
      next.outfit = body.outfit;
    }
    if (body.hemisphere !== undefined) {
      if (body.hemisphere !== "north" && body.hemisphere !== "south") {
        throw invalid('"hemisphere" must be "north" or "south"');
      }
      next.hemisphere = body.hemisphere;
    }
    if (body.sources !== undefined) {
      const patch = plain(body.sources, '"sources"');
      const known = this.d.known();
      for (const [id, raw] of Object.entries(patch)) {
        if (!SOURCE_ID.test(id))
          throw invalid("A source id must be agent:<slug> or capability:<id>");
        if (id.startsWith("capability:") && !known.some((k) => k.id === id)) {
          throw invalid("Unknown capability source");
        }
        const style = plain(raw, "A source setting");
        only(style, ["colour", "glyph", "show"], "A source setting");
        const current = next.sources[id] ?? defaultSourceStyle(id);
        if (style.colour !== undefined) {
          if (typeof style.colour !== "string" || !SOURCE_COLOUR.test(style.colour)) {
            throw invalid('"colour" must be a lowercase #rrggbb colour');
          }
          current.colour = style.colour;
        }
        if (style.glyph !== undefined) {
          if (!isGlyphName(style.glyph))
            throw invalid('"glyph" must be one of the built-in glyphs');
          current.glyph = style.glyph;
        }
        if (style.show !== undefined) {
          if (typeof style.show !== "boolean") throw invalid('"show" must be true or false');
          current.show = style.show;
        }
        next.sources[id] = { colour: current.colour, glyph: current.glyph, show: current.show };
      }
      if (Object.keys(next.sources).length > MAX_SOURCES) {
        throw invalid(`At most ${MAX_SOURCES} sources can be styled`);
      }
    }
    return this.save(next, "settings");
  }

  importPack(input: unknown): AppearanceView {
    let pack: OutfitPack;
    try {
      pack = validateOutfitPack(input);
    } catch (err) {
      throw invalid(err instanceof OutfitError ? err.message : "Not a valid outfit pack");
    }
    if (BUILTIN_OUTFITS.some((o) => o.id === pack.id)) {
      throw invalid("That id belongs to a built-in outfit; choose another id");
    }
    const next = this.stored();
    const others = next.packs.filter((p) => p.id !== pack.id);
    if (others.length >= MAX_USER_PACKS) {
      throw invalid(`At most ${MAX_USER_PACKS} imported outfits; delete one first`);
    }
    const packs = [...others, pack];
    if (packBytes(packs) > MAX_USER_PACK_BYTES) {
      throw invalid(`Imported outfits are limited to ${MAX_USER_PACK_BYTES} bytes in total`);
    }
    next.packs = packs;
    return this.save(next, "pack");
  }

  deletePack(id: string): AppearanceView {
    const next = this.stored();
    if (!next.packs.some((p) => p.id === id)) {
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Outfit not found");
    }
    next.packs = next.packs.filter((p) => p.id !== id);
    // Wearing a pack that was just deleted would leave Fawkes dressed in nothing the user can see.
    if (next.outfit === id) next.outfit = "none";
    return this.save(next, "pack");
  }

  private save(next: StoredAppearance, changed: "settings" | "pack"): AppearanceView {
    this.d.settings.set(APPEARANCE_KEY, next);
    const result = this.d.bus.publish(
      createEvent({
        event_type: APPEARANCE_CHANGED,
        source: "core",
        severity: "info",
        payload: { changed },
      }),
    );
    if (!result.ok) throw result.error;
    return this.get();
  }
}
