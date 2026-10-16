// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  AA_CONTRAST,
  BUILTIN_OUTFITS,
  contrastRatio,
  defaultSourceStyle,
  GLYPHS,
  OutfitError,
  PILL_BACKGROUND,
  resolveOutfit,
  validateOutfitPack,
  type GlyphName,
  type SourceStyle,
} from "@phoenix/pet-runtime";
import { useState } from "react";
import { useAppearance, type Appearance } from "../core/appearance";
import { useAction, usePetSettings } from "../core/hooks";
import { FawkesAvatar } from "./FawkesAvatar";
import { Feedback } from "./Feedback";

const SEASON_TEXT: Record<string, string> = {
  spring: "spring",
  summer: "summer",
  autumn: "autumn",
  winter: "winter",
  any: "any time",
};

/** Contrast of a pill colour against the pill's own background, and whether it meets WCAG AA. */
export function pillContrast(colour: string): { ratio: number; ok: boolean } {
  const ratio = contrastRatio(colour, PILL_BACKGROUND);
  return { ratio, ok: ratio >= AA_CONTRAST };
}

/**
 * Wardrobe (Phase 61): pick Fawkes' outfit (none, a specific one, or the season's), preview it, import
 * an outfit pack by pasting its JSON (no file access), delete an imported pack, and choose each
 * source's colour, glyph and whether it shows in Fawkes. Core validates every pack again.
 */
export function Wardrobe({ now = () => new Date() }: { now?: () => Date }) {
  const { data, error: loadError, reload } = useAppearance();
  const { data: petSettings } = usePetSettings();
  const { run, error, details } = useAction();
  const [pasted, setPasted] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const save = async (patch: Record<string, unknown>, done?: string) => {
    setSaved(null);
    if ((await run("POST", "/api/fawkes/appearance", patch)) !== undefined) {
      await reload();
      if (done) setSaved(done);
    }
  };

  const importPack = async () => {
    setProblem(null);
    setSaved(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(pasted);
    } catch {
      setProblem("That is not valid JSON.");
      return;
    }
    try {
      validateOutfitPack(parsed);
    } catch (err) {
      setProblem(err instanceof OutfitError ? err.message : "That is not a valid outfit pack.");
      return;
    }
    if ((await run("POST", "/api/fawkes/packs", parsed)) !== undefined) {
      setPasted("");
      await reload();
      setSaved("Outfit imported.");
    }
  };

  const removePack = async (id: string, name: string) => {
    setSaved(null);
    if ((await run("DELETE", `/api/fawkes/packs/${encodeURIComponent(id)}`)) !== undefined) {
      await reload();
      setSaved(`Deleted ${name}.`);
    }
  };

  const choices: { id: string; name: string; note: string }[] = [
    { id: "none", name: "No outfit", note: "Fawkes as drawn" },
    { id: "auto-season", name: "Follow the season", note: "Changes with the calendar" },
    ...BUILTIN_OUTFITS.map((o) => ({
      id: o.id,
      name: o.name,
      note: `built in, ${SEASON_TEXT[o.season ?? "any"]}`,
    })),
    ...data.packs.map((p) => ({
      id: p.id,
      name: p.name,
      note: `by ${p.author}, ${SEASON_TEXT[p.season ?? "any"]}`,
    })),
  ];
  const worn = resolveOutfit(data.outfit, data.hemisphere, data.packs, now());

  return (
    <div className="wardrobe">
      <p className="muted small">
        Outfits are only decoration. They never change what Fawkes says it is doing, and with
        reduced motion they hold still.
      </p>
      <div className="wardrobe-preview">
        <FawkesAvatar
          state={{
            state: "IDLE",
            explanation: "Outfit preview",
            since: "",
            recording: false,
            sleeping: false,
          }}
          size={96}
          interactive={false}
          actionHint="This is a preview"
          reducedMotion={petSettings.reduced_motion}
          outfit={worn}
        />
        <p role="status" className="small">
          Wearing: {worn ? worn.name : "no outfit"}
        </p>
      </div>
      <fieldset>
        <legend className="small">Outfit</legend>
        {choices.map((c) => (
          <label key={c.id} className="choice">
            <input
              type="radio"
              name="fawkes-outfit"
              checked={data.outfit === c.id}
              onChange={() => void save({ outfit: c.id }, `Outfit set to ${c.name}.`)}
            />
            {c.name} <span className="muted small">({c.note})</span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        Hemisphere (for “Follow the season”)
        <select value={data.hemisphere} onChange={(e) => void save({ hemisphere: e.target.value })}>
          <option value="north">Northern</option>
          <option value="south">Southern</option>
        </select>
      </label>

      <h3 className="h3">Import an outfit</h3>
      <label className="field">
        Outfit pack (JSON)
        <textarea
          rows={5}
          value={pasted}
          spellCheck={false}
          onChange={(e) => setPasted(e.target.value)}
          aria-describedby="wardrobe-import-help"
        />
      </label>
      <p id="wardrobe-import-help" className="muted small">
        Paste the pack’s JSON. A pack holds drawings only (no scripts, styles or links); a pack that
        breaks the rules is refused as a whole. Up to {data.limits.packs} imported outfits.
      </p>
      <button
        type="button"
        className="btn"
        disabled={pasted.trim().length === 0}
        onClick={() => void importPack()}
      >
        Import outfit
      </button>
      {problem && (
        <p className="error-text small" role="alert">
          {problem}
        </p>
      )}
      {data.packs.length > 0 && (
        <ul className="card-list">
          {data.packs.map((p) => (
            <li key={p.id} className="small">
              {p.name}{" "}
              <span className="muted">
                by {p.author}, {p.license}
              </span>{" "}
              <button
                type="button"
                className="btn btn-danger-outline"
                onClick={() => void removePack(p.id, p.name)}
                aria-label={`Delete outfit ${p.name}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="h3">Sources in Fawkes</h3>
      <p className="muted small">
        While a coding agent or capability is working, Fawkes shows a pill with its name, a shape
        and its colour. Colour is never the only cue.
      </p>
      {data.known.length === 0 && <p className="muted small">No sources yet.</p>}
      {data.known.map((k) => (
        <SourceRow
          key={k.id}
          id={k.id}
          label={k.label}
          style={data.sources[k.id] ?? defaultSourceStyle(k.id)}
          onChange={(patch) => save({ sources: { [k.id]: patch } })}
        />
      ))}
      <Feedback error={error ?? loadError} saved={saved} />
      {details.length > 0 && (
        <ul className="small error-text">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceRow({
  id,
  label,
  style,
  onChange,
}: {
  id: string;
  label: string;
  style: SourceStyle;
  onChange: (patch: Partial<SourceStyle>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const colour = draft ?? style.colour;
  const { ratio, ok } = pillContrast(colour);
  const commit = () => {
    if (draft !== null && draft !== style.colour) void onChange({ colour: draft });
    setDraft(null);
  };
  return (
    <fieldset className="wardrobe-source" data-source={id}>
      <legend className="small">{label}</legend>
      <label className="choice">
        <input
          type="checkbox"
          checked={style.show}
          onChange={(e) => void onChange({ show: e.target.checked })}
        />
        Show {label} in Fawkes
      </label>
      <label className="field">
        Colour for {label}
        <input
          type="color"
          value={colour}
          onChange={(e) => setDraft(e.target.value.toLowerCase())}
          onBlur={commit}
        />
      </label>
      <label className="field">
        Shape for {label}
        <select
          value={style.glyph}
          onChange={(e) => void onChange({ glyph: e.target.value as GlyphName })}
        >
          {Object.entries(GLYPHS).map(([name, g]) => (
            <option key={name} value={name}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      <p className={ok ? "muted small" : "error-text small"} role="status">
        {ok
          ? `Contrast ${ratio.toFixed(1)}:1 on the pill: meets WCAG AA.`
          : `Warning: contrast ${ratio.toFixed(1)}:1 on the pill is below WCAG AA (${AA_CONTRAST}:1). The name may be hard to read.`}
      </p>
    </fieldset>
  );
}

export type { Appearance };

/** The Settings section "Fawkes appearance": the same Wardrobe as the Pet Panel tab. */
export function FawkesAppearanceSection() {
  return (
    <section aria-labelledby="appearance-h" className="card">
      <h2 id="appearance-h" className="h3">
        Fawkes appearance
      </h2>
      <Wardrobe />
    </section>
  );
}
