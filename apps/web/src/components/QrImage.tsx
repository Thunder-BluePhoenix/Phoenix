// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useMemo } from "react";
import { encodeQr, qrSvgPath } from "../core/qr";

/**
 * Draws `text` as an inline SVG QR code (black on white, with the 4-module quiet zone every scanner
 * needs, whatever the theme). It makes no request, keeps nothing and writes nothing to the page
 * except the drawing (path data, not the text). Renders `fallback` when the text cannot be encoded
 * (for example, too long).
 */
export function QrImage({
  text,
  label,
  fallback,
}: {
  text: string;
  label: string;
  fallback: string;
}) {
  const drawing = useMemo(() => {
    try {
      return qrSvgPath(encodeQr(text));
    } catch {
      return null;
    }
  }, [text]);
  if (!drawing) {
    return (
      <p className="muted small" role="status">
        {fallback}
      </p>
    );
  }
  return (
    <svg
      className="qr-image"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${drawing.total} ${drawing.total}`}
      shapeRendering="crispEdges"
    >
      <rect width={drawing.total} height={drawing.total} fill="#ffffff" />
      <path d={drawing.path} fill="#000000" />
    </svg>
  );
}
