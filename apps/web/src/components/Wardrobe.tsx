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
import { formatNumber } from "../core/format";
import { useAction, usePetSettings } from "../core/hooks";
import { useT, type MessageKey, type Translate } from "../i18n";
import { FawkesAvatar } from "./FawkesAvatar";
import { Feedback } from "./Feedback";

const SEASON_KEY: Record<string, MessageKey> = {
  spring: "pet.wardrobe.season.spring",
  summer: "pet.wardrobe.season.summer",
  autumn: "pet.wardrobe.season.autumn",
  winter: "pet.wardrobe.season.winter",
  any: "pet.wardrobe.season.any",
};

/** The built-in outfits' names, in the language on screen; a pack's own name is data and stays. */
const OUTFIT_KEY: Record<string, MessageKey> = {
  "ember-scarf": "pet.outfit.emberScarf",
  "cinder-crest": "pet.outfit.cinderCrest",
  "dusk-nightcap": "pet.outfit.duskNightcap",
  "hearth-lantern": "pet.outfit.hearthLantern",
  "blossom-sprig": "pet.outfit.blossomSprig",
  "sunbeam-shades": "pet.outfit.sunbeamShades",
  "maple-drift": "pet.outfit.mapleDrift",
  "frostwool-beanie": "pet.outfit.frostwoolBeanie",
};

const GLYPH_KEY: Record<GlyphName, MessageKey> = {
  spark: "pet.glyph.spark",
  diamond: "pet.glyph.diamond",
  triangle: "pet.glyph.triangle",
  square: "pet.glyph.square",
  ring: "pet.glyph.ring",
  bars: "pet.glyph.bars",
  hexagon: "pet.glyph.hexagon",
  cross: "pet.glyph.cross",
  wave: "pet.glyph.wave",
  crescent: "pet.glyph.crescent",
};

const ANY_SEASON = "pet.wardrobe.season.any";

const outfitName = (t: Translate, o: { id: string; name: string }) =>
  Object.hasOwn(OUTFIT_KEY, o.id) && BUILTIN_OUTFITS.some((b) => b.id === o.id)
    ? t(OUTFIT_KEY[o.id]!)
    : o.name;

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
  const t = useT();
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
      setProblem(t("pet.wardrobe.import.notJson"));
      return;
    }
    try {
      validateOutfitPack(parsed);
    } catch (err) {
      // An OutfitError's text comes from the pack validator (data about the pack), shown as written.
      setProblem(err instanceof OutfitError ? err.message : t("pet.wardrobe.import.notValid"));
      return;
    }
    if ((await run("POST", "/api/fawkes/packs", parsed)) !== undefined) {
      setPasted("");
      await reload();
      setSaved(t("pet.wardrobe.import.done"));
    }
  };

  const removePack = async (id: string, name: string) => {
    setSaved(null);
    if ((await run("DELETE", `/api/fawkes/packs/${encodeURIComponent(id)}`)) !== undefined) {
      await reload();
      setSaved(t("pet.wardrobe.pack.deleted", { name }));
    }
  };

  const choices: { id: string; name: string; note: string }[] = [
    {
      id: "none",
      name: t("pet.wardrobe.choice.none"),
      note: t("pet.wardrobe.choice.noneNote"),
    },
    {
      id: "auto-season",
      name: t("pet.wardrobe.choice.season"),
      note: t("pet.wardrobe.choice.seasonNote"),
    },
    ...BUILTIN_OUTFITS.map((o) => ({
      id: o.id,
      name: outfitName(t, o),
      note: t("pet.wardrobe.note.builtIn", {
        season: t(SEASON_KEY[o.season ?? "any"] ?? ANY_SEASON),
      }),
    })),
    ...data.packs.map((p) => ({
      id: p.id,
      name: p.name,
      note: t("pet.wardrobe.note.pack", {
        author: p.author,
        season: t(SEASON_KEY[p.season ?? "any"] ?? ANY_SEASON),
      }),
    })),
  ];
  const worn = resolveOutfit(data.outfit, data.hemisphere, data.packs, now());

  return (
    <div className="wardrobe">
      <p className="muted small">{t("pet.wardrobe.intro")}</p>
      <div className="wardrobe-preview">
        <FawkesAvatar
          state={{
            state: "IDLE",
            explanation: t("pet.wardrobe.preview.explanation"),
            since: "",
            recording: false,
            sleeping: false,
          }}
          size={96}
          interactive={false}
          actionHint={t("pet.wardrobe.preview.hint")}
          reducedMotion={petSettings.reduced_motion}
          outfit={worn}
        />
        <p role="status" className="small">
          {worn
            ? t("pet.wardrobe.wearing", { name: outfitName(t, worn) })
            : t("pet.wardrobe.wearingNone")}
        </p>
      </div>
      <fieldset>
        <legend className="small">{t("pet.wardrobe.outfit.legend")}</legend>
        {choices.map((c) => (
          <label key={c.id} className="choice">
            <input
              type="radio"
              name="fawkes-outfit"
              checked={data.outfit === c.id}
              onChange={() =>
                void save({ outfit: c.id }, t("pet.wardrobe.outfit.set", { name: c.name }))
              }
            />
            {c.name} <span className="muted small">({c.note})</span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        {t("pet.wardrobe.hemisphere.label")}
        <select value={data.hemisphere} onChange={(e) => void save({ hemisphere: e.target.value })}>
          <option value="north">{t("pet.wardrobe.hemisphere.north")}</option>
          <option value="south">{t("pet.wardrobe.hemisphere.south")}</option>
        </select>
      </label>

      <h3 className="h3">{t("pet.wardrobe.import.title")}</h3>
      <label className="field">
        {t("pet.wardrobe.import.packLabel")}
        <textarea
          rows={5}
          value={pasted}
          spellCheck={false}
          onChange={(e) => setPasted(e.target.value)}
          aria-describedby="wardrobe-import-help"
        />
      </label>
      <p id="wardrobe-import-help" className="muted small">
        {t("pet.wardrobe.import.help", { count: data.limits.packs })}
      </p>
      <button
        type="button"
        className="btn"
        disabled={pasted.trim().length === 0}
        onClick={() => void importPack()}
      >
        {t("pet.wardrobe.import.button")}
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
                {t("pet.wardrobe.pack.by", { author: p.author, license: p.license })}
              </span>{" "}
              <button
                type="button"
                className="btn btn-danger-outline"
                onClick={() => void removePack(p.id, p.name)}
                aria-label={t("pet.wardrobe.pack.deleteLabel", { name: p.name })}
              >
                {t("common.button.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="h3">{t("pet.wardrobe.sources.title")}</h3>
      <p className="muted small">{t("pet.wardrobe.sources.intro")}</p>
      {data.known.length === 0 && <p className="muted small">{t("pet.wardrobe.sources.none")}</p>}
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
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const colour = draft ?? style.colour;
  const { ratio, ok } = pillContrast(colour);
  const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
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
        {t("pet.wardrobe.source.show", { label })}
      </label>
      <label className="field">
        {t("pet.wardrobe.source.colour", { label })}
        <input
          type="color"
          value={colour}
          onChange={(e) => setDraft(e.target.value.toLowerCase())}
          onBlur={commit}
        />
      </label>
      <label className="field">
        {t("pet.wardrobe.source.shape", { label })}
        <select
          value={style.glyph}
          onChange={(e) => void onChange({ glyph: e.target.value as GlyphName })}
        >
          {Object.keys(GLYPHS).map((name) => (
            <option key={name} value={name}>
              {t(GLYPH_KEY[name as GlyphName])}
            </option>
          ))}
        </select>
      </label>
      <p className={ok ? "muted small" : "error-text small"} role="status">
        {ok
          ? t("pet.wardrobe.source.contrastOk", {
              ratio: formatNumber(ratio, undefined, oneDecimal),
            })
          : t("pet.wardrobe.source.contrastLow", {
              ratio: formatNumber(ratio, undefined, oneDecimal),
              min: formatNumber(AA_CONTRAST, undefined, oneDecimal),
            })}
      </p>
    </fieldset>
  );
}

export type { Appearance };

/** The Settings section "Fawkes appearance": the same Wardrobe as the Pet Panel tab. */
export function FawkesAppearanceSection() {
  const t = useT();
  return (
    <section aria-labelledby="appearance-h" className="card">
      <h2 id="appearance-h" className="h3">
        {t("pet.appearance.title")}
      </h2>
      <Wardrobe />
    </section>
  );
}
