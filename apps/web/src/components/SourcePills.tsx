// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { GLYPHS } from "@phoenix/pet-runtime";
import type { CSSProperties } from "react";
import { useActivePills, type Pill } from "../core/appearance";
import "./source-pills.css";

/** Most pills drawn at once; the rest are counted in text, so nothing is silently dropped. */
export const MAX_PILLS = 4;

/**
 * The active-source pills. Colour is never the only cue: every pill carries a glyph shape and the
 * source's name as text. The glyph is decorative for assistive technology (the text says it all).
 */
export function SourcePills({ pills }: { pills: Pill[] }) {
  if (pills.length === 0) return null;
  const shown = pills.slice(0, MAX_PILLS);
  const hidden = pills.length - shown.length;
  return (
    <ul className="source-pills" aria-label="Active sources">
      {shown.map((p) => (
        <li
          key={p.id}
          className="source-pill"
          data-source={p.id}
          data-glyph={p.glyph}
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
      {hidden > 0 && <li className="source-pill source-pill-more">+{hidden} more</li>}
    </ul>
  );
}

/** The pills for what is active now, for the floating pet and the island. */
export function ActiveSourcePills() {
  return <SourcePills pills={useActivePills()} />;
}
