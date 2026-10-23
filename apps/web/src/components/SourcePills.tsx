// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { GLYPHS } from "@phoenix/pet-runtime";
import type { CSSProperties } from "react";
import type { Pill } from "../core/appearance";
import { useT } from "../i18n";
import "./source-pills.css";

/** Most pills drawn at once; the rest are counted in text, so nothing is silently dropped. */
export const MAX_PILLS = 4;

/**
 * The pills to draw: the first `MAX_PILLS`, or, when "switch pills" selected one further down the
 * list, the last `MAX_PILLS` up to it, so the selected pill is always on screen.
 */
export function visiblePills(pills: readonly Pill[], selected: string | null): Pill[] {
  const at = selected === null ? -1 : pills.findIndex((p) => p.id === selected);
  const start = at < MAX_PILLS ? 0 : at - MAX_PILLS + 1;
  return pills.slice(start, start + MAX_PILLS);
}

/**
 * The active-source pills. Colour is never the only cue: every pill carries a glyph shape and the
 * source's name as text. The glyph is decorative for assistive technology (the text says it all).
 * The pill that "switch pills" selected is marked with `aria-current` and a thicker outline.
 */
export function SourcePills({
  pills,
  selected = null,
}: {
  pills: Pill[];
  selected?: string | null;
}) {
  const t = useT();
  if (pills.length === 0) return null;
  const shown = visiblePills(pills, selected);
  const hidden = pills.length - shown.length;
  return (
    <ul className="source-pills" aria-label={t("pet.sources.active")}>
      {shown.map((p) => (
        <li
          key={p.id}
          className="source-pill"
          data-source={p.id}
          data-glyph={p.glyph}
          {...(p.id === selected ? { "aria-current": true, "data-selected": "true" } : {})}
          style={{ "--pill-colour": p.colour } as CSSProperties}
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            focusable="false"
            // Bundled glyph markup (GLYPHS), never pack or user text.
            dangerouslySetInnerHTML={{ __html: GLYPHS[p.glyph].markup }}
          />
          <span className="source-pill-label">{p.label}</span>
        </li>
      ))}
      {hidden > 0 && (
        <li className="source-pill source-pill-more">{t("pet.sources.more", { count: hidden })}</li>
      )}
    </ul>
  );
}
