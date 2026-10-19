// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The weekly recap's share image (1080 x 1920). `buildRecapSvg` is pure: the same recap gives the
// same text, every string is escaped, and project names appear ONLY when `showProjects` is true
// (they are private by default; with it off the project is not in the output at all, not even in
// the accessible title). `downloadRecapPng` draws that SVG on a canvas; no dependency.
import { translate } from "../i18n/store";
import { formatNumber } from "./format";
import {
  activeRecapText,
  formatCodingTime,
  formatDayKey,
  formatWeek,
  gridLevel,
  type Recap,
  type RecapText,
} from "./recap";

export const RECAP_IMAGE_WIDTH = 1080;
export const RECAP_IMAGE_HEIGHT = 1920;

export interface RecapSvgOptions {
  /** Show the top project's name. Default (absent): false. */
  showProjects?: boolean;
  /**
   * The translator and language the image text is written in. Absent: the language on screen. The
   * page never sets it; tests and other callers pass one to get a fixed language.
   */
  text?: RecapText;
}

// Characters XML 1.0 cannot carry at all (an SVG with one fails to load), bidi controls that could
// reorder text around a name, and zero-width ones that hide it.
// eslint-disable-next-line no-control-regex
const UNSAFE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\ufffe\uffff]/g;
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Text safe inside an SVG element or attribute, cut to `max` characters. */
export function svgText(raw: string, max = 40): string {
  const clean = raw.replace(UNSAFE, "").replace(/\s+/g, " ").trim();
  const cut = clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
  return cut.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const BG = "#1b1b1f";
const FG = "#f8f9fa";
const MUTED = "#adb5bd";
const ACCENT = "#ff922b";
const CELL = ["#2b2b31", "#6b3a12", "#a85400", "#e8590c", "#ff922b"] as const;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const text = (
  x: number,
  y: number,
  size: number,
  fill: string,
  body: string,
  extra = "",
  rtl = false,
): string =>
  `<text x="${rtl ? RECAP_IMAGE_WIDTH - x : x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}"${rtl ? ' direction="rtl"' : ""}${extra}>${body}</text>`;

/** Builds the 1080 x 1920 share image for a recap, in the language of `options.text`. */
export function buildRecapSvg(recap: Recap, options: RecapSvgOptions = {}): string {
  const showProjects = options.showProjects === true;
  const words = options.text ?? activeRecapText();
  const { t } = words;
  // Arabic reads right to left: the whole layout is mirrored so the text starts at the right edge.
  const rtl = words.locale === "ar";
  const at = (x: number, y: number, size: number, fill: string, body: string, extra = "") =>
    text(x, y, size, fill, body, extra, rtl);
  const stat = (x: number, y: number, label: string, value: string): string =>
    at(x, y, 76, FG, value, ' font-weight="700"') + at(x, y + 44, 30, MUTED, svgText(label));
  const { coding, permissions } = recap;
  const lines: string[] = [];
  const week = formatWeek(recap.week, words);

  lines.push(
    at(80, 170, 44, ACCENT, svgText(t("memory.recap.image.heading"), 60), ' font-weight="700"'),
  );
  lines.push(at(80, 240, 38, MUTED, svgText(week, 60)));

  lines.push(
    at(
      80,
      420,
      150,
      FG,
      svgText(formatCodingTime(coding.seconds, words), 12),
      ' font-weight="700"',
    ),
  );
  lines.push(at(80, 480, 34, MUTED, svgText(t("memory.recap.image.timeCoding"), 40)));

  const column = [80, 580];
  const num = (n: number) => formatNumber(n, words.locale);
  const stats: [string, string][] = [
    [t("memory.recap.image.sessions"), num(coding.sessions)],
    [t("memory.recap.image.files"), num(coding.files)],
    [t("memory.recap.image.linesChanged"), num(coding.lines_changed)],
    [t("memory.recap.image.commands"), num(coding.commands)],
    [t("memory.recap.image.permissionsGranted"), num(permissions.granted)],
    [t("memory.recap.image.permissionsDenied"), num(permissions.denied)],
  ];
  stats.forEach(([label, value], i) => {
    lines.push(stat(column[i % 2]!, 640 + Math.floor(i / 2) * 170, label, svgText(value, 10)));
  });

  const facts: [string, string][] = [];
  if (recap.top_agent) facts.push([t("memory.recap.stat.topAgent"), recap.top_agent.name]);
  if (showProjects && recap.top_project) {
    facts.push([t("memory.recap.stat.topProject"), recap.top_project.name]);
  }
  if (recap.busiest_day) {
    facts.push([t("memory.recap.stat.busiestDay"), formatDayKey(recap.busiest_day.day, words)]);
  }
  facts.push([
    t("memory.recap.stat.longestSession"),
    formatCodingTime(coding.longest_session_seconds, words),
  ]);
  facts.forEach(([label, value], i) => {
    const y = 1210 + i * 74;
    lines.push(at(80, y, 32, MUTED, svgText(label)));
    lines.push(at(1000, y, 38, FG, svgText(value, 28), ' text-anchor="end" font-weight="700"'));
  });

  const grid = recap.grid;
  const weeks = grid.weeks.slice(-26);
  const size = 30;
  const gap = 8;
  const left = Math.round((RECAP_IMAGE_WIDTH - (weeks.length * (size + gap) - gap)) / 2);
  weeks.forEach((week, w) => {
    week.days.forEach((d, i) => {
      const fill = CELL[gridLevel(d.count, grid.max)];
      lines.push(
        `<rect x="${left + w * (size + gap)}" y="${1560 + i * (size + gap)}" width="${size}" height="${size}" rx="6" fill="${fill}"/>`,
      );
    });
  });
  lines.push(
    at(80, 1880, 28, MUTED, svgText(t("memory.recap.image.grid", { commits: grid.total }), 80)),
  );

  const title = svgText(t("memory.recap.image.title", { week }), 100);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${RECAP_IMAGE_WIDTH}" height="${RECAP_IMAGE_HEIGHT}" viewBox="0 0 ${RECAP_IMAGE_WIDTH} ${RECAP_IMAGE_HEIGHT}" role="img" aria-label="${title}">` +
    `<title>${title}</title>` +
    `<rect width="${RECAP_IMAGE_WIDTH}" height="${RECAP_IMAGE_HEIGHT}" fill="${BG}"/>` +
    lines.join("") +
    "</svg>"
  );
}

/** What the PNG renderer needs from the browser; tests pass fakes. */
export interface RecapCanvasHost {
  createImage(): HTMLImageElement;
  createCanvas(): HTMLCanvasElement;
}

const browserHost: RecapCanvasHost = {
  createImage: () => new Image(),
  createCanvas: () => document.createElement("canvas"),
};

/** SVG data URL -> Image -> 1080 x 1920 canvas -> PNG. Rejects when the image cannot load or encode. */
export async function renderRecapPng(
  svg: string,
  host: RecapCanvasHost = browserHost,
): Promise<Blob> {
  const loaded = Promise.withResolvers<HTMLImageElement>();
  const image = host.createImage();
  image.onload = () => loaded.resolve(image);
  image.onerror = () => loaded.reject(new Error(translate("memory.recap.image.error.draw")));
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded.promise;
  const canvas = host.createCanvas();
  canvas.width = RECAP_IMAGE_WIDTH;
  canvas.height = RECAP_IMAGE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(translate("memory.recap.image.error.canvas"));
  context.drawImage(image, 0, 0, RECAP_IMAGE_WIDTH, RECAP_IMAGE_HEIGHT);
  const encoded = Promise.withResolvers<Blob>();
  canvas.toBlob(
    (blob) =>
      blob
        ? encoded.resolve(blob)
        : encoded.reject(new Error(translate("memory.recap.image.error.encode"))),
    "image/png",
  );
  return encoded.promise;
}

/** Saves the recap image as `phoenix-recap-<week start>.png`. */
export async function downloadRecapPng(
  recap: Recap,
  options: RecapSvgOptions = {},
  host: RecapCanvasHost = browserHost,
): Promise<void> {
  const blob = await renderRecapPng(buildRecapSvg(recap, options), host);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `phoenix-recap-${recap.week.start}.png`;
  link.click();
  URL.revokeObjectURL(url);
}
