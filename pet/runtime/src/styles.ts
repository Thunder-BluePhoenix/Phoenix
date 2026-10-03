// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Layout and accessibility styles shared by every Fawkes asset. */
export const BASE_CSS = `
.fawkes {
  --fawkes-size: 32px;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--fawkes-size);
  height: var(--fawkes-size);
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}
.fawkes:focus-visible { outline: 2px solid var(--fawkes-focus, #4c6ef5); outline-offset: 2px; }
.fawkes[data-tone="danger"] { box-shadow: 0 0 0 2px var(--fawkes-danger, #e03131); }
.fawkes[data-tone="warning"] { box-shadow: 0 0 0 2px var(--fawkes-warning, #f08c00); }
.fawkes-art { width: 100%; height: 100%; pointer-events: none; }
.fawkes-rec {
  position: absolute;
  top: 0;
  right: 0;
  width: 30%;
  height: 30%;
  min-width: 6px;
  min-height: 6px;
  border-radius: 50%;
  background: var(--fawkes-recording, #e03131);
  box-shadow: 0 0 0 1.5px var(--fawkes-rec-ring, #fff);
}
.fawkes-rec[hidden] { display: none; }
.fawkes-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.fawkes[data-paused="true"] *,
.fawkes[data-paused="true"] *::before,
.fawkes[data-paused="true"] *::after { animation-play-state: paused !important; }
.fawkes[data-reduced-motion="true"] *,
.fawkes[data-reduced-motion="true"] *::before,
.fawkes[data-reduced-motion="true"] *::after { animation: none !important; transition: none !important; }
`;

/** Injects a stylesheet once per document, keyed by id. */
export function ensureStyles(doc: Document, id: string, css: string): void {
  if (doc.getElementById(id)) return;
  const style = doc.createElement("style");
  style.id = id;
  style.textContent = css;
  (doc.head ?? doc.documentElement).appendChild(style);
}
