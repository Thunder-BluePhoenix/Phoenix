// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  OUTFIT_ANIMATIONS,
  OUTFIT_SLOTS,
  parseOutfitSvg,
  type OutfitPack,
  type OutfitSvgNode,
} from "@phoenix/pet-assets";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Motion for outfit layers. A layer names one of Phoenix's built-in keyframes; the rule lives here, in
 * Phoenix's own stylesheet, so a pack never carries CSS and never sets an inline style.
 */
export const OUTFIT_CSS = Object.entries(OUTFIT_ANIMATIONS)
  .map(
    ([name, animation]) =>
      `.fawkes-outfit [data-outfit-animation="${name}"] { animation: ${animation}; }`,
  )
  .join("\n");

function build(doc: Document, node: OutfitSvgNode): SVGElement {
  const el = doc.createElementNS(SVG_NS, node.tag);
  for (const [name, value] of node.attrs) el.setAttribute(name, value);
  for (const child of node.children) el.appendChild(build(doc, child));
  return el;
}

/**
 * Draws `outfit` over the Fawkes SVG, or removes it when `outfit` is null. Layers are re-validated
 * and built node by node with createElementNS (never innerHTML), so a pack that somehow skipped the
 * validator still cannot put markup the allow-list does not know into the page.
 *
 * Slots draw in the fixed order of OUTFIT_SLOTS. Everything but `aura` sits inside `.fawkes-figure`
 * and so follows the body's pose; `aura` sits behind-and-around, outside it. Under `reduced` only the
 * `still` variant of an animated layer renders, with no animation attribute at all.
 *
 * Returns false (and draws nothing) when a layer is rejected.
 */
export function applyOutfit(art: Element, outfit: OutfitPack | null, reduced: boolean): boolean {
  for (const old of art.querySelectorAll(".fawkes-outfit")) old.remove();
  const svg = art.querySelector("svg");
  const figure = art.querySelector(".fawkes-figure");
  if (!outfit || !svg || !figure) return true;
  const doc = art.ownerDocument;

  const onBody = doc.createElementNS(SVG_NS, "g");
  const onAura = doc.createElementNS(SVG_NS, "g");
  for (const group of [onBody, onAura]) {
    group.setAttribute("class", "fawkes-outfit");
    group.setAttribute("data-outfit", outfit.id);
    group.setAttribute("data-outfit-motion", reduced ? "still" : "animated");
  }
  try {
    for (const slot of OUTFIT_SLOTS) {
      for (const layer of outfit.layers.filter((l) => l.slot === slot)) {
        const source = reduced && layer.animation ? layer.still : layer.svg;
        if (source === undefined) return false;
        const g = doc.createElementNS(SVG_NS, "g");
        g.setAttribute("data-outfit-slot", slot);
        if (layer.animation && !reduced) g.setAttribute("data-outfit-animation", layer.animation);
        for (const node of parseOutfitSvg(source)) g.appendChild(build(doc, node));
        (slot === "aura" ? onAura : onBody).appendChild(g);
      }
    }
  } catch {
    return false;
  }
  figure.appendChild(onBody);
  // The aura is drawn first so the character is in front of it.
  svg.insertBefore(onAura, svg.firstChild);
  return true;
}
