// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The weekly recap's share image (1080 x 1920). `buildRecapSvg` is pure: the same recap gives the
// same text, every string is escaped, and project names appear ONLY when `showProjects` is true
// (they are private by default; with it off the project is not in the output at all, not even in
// the accessible title). `downloadRecapPng` draws that SVG on a canvas; no dependency.
import { formatCodingTime, formatDayKey, formatWeek, gridLevel, type Recap } from "./recap";

export const RECAP_IMAGE_WIDTH = 1080;
export const RECAP_IMAGE_HEIGHT = 1920;

export interface RecapSvgOptions {
  /** Show the top project's name. Default (absent): false. */
  showProjects?: boolean;
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

const text = (x: number, y: number, size: number, fill: string, body: string, extra = ""): string =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}"${extra}>${body}</text>`;

const stat = (x: number, y: number, label: string, value: string): string =>
  text(x, y, 76, FG, value, ' font-weight="700"') + text(x, y + 44, 30, MUTED, svgText(label));

/** Builds the 1080 x 1920 share image for a recap. */
export function buildRecapSvg(recap: Recap, options: RecapSvgOptions = {}): string {
  const showProjects = options.showProjects === true;
  const { coding, permissions } = recap;
  const lines: string[] = [];

  lines.push(text(80, 170, 44, ACCENT, "PHOENIX · WEEKLY RECAP", ' font-weight="700"'));
  lines.push(text(80, 240, 38, MUTED, svgText(formatWeek(recap.week), 60)));

  lines.push(
    text(80, 420, 150, FG, svgText(formatCodingTime(coding.seconds), 12), ' font-weight="700"'),
  );
  lines.push(text(80, 480, 34, MUTED, "time coding"));

  const column = [80, 580];
  const stats: [string, string][] = [
    ["sessions", String(coding.sessions)],
    ["files", String(coding.files)],
    ["lines changed", String(coding.lines_changed)],
    ["commands", String(coding.commands)],
    ["permissions granted", String(permissions.granted)],
    ["permissions denied", String(permissions.denied)],
  ];
  stats.forEach(([label, value], i) => {
    lines.push(stat(column[i % 2]!, 640 + Math.floor(i / 2) * 170, label, svgText(value, 10)));
  });

  const facts: [string, string][] = [];
  if (recap.top_agent) facts.push(["Top agent", recap.top_agent.name]);
  if (showProjects && recap.top_project) facts.push(["Top project", recap.top_project.name]);
  if (recap.busiest_day) facts.push(["Busiest day", formatDayKey(recap.busiest_day.day)]);
  facts.push(["Longest session", formatCodingTime(coding.longest_session_seconds)]);
  facts.forEach(([label, value], i) => {
    const y = 1210 + i * 74;
    lines.push(text(80, y, 32, MUTED, svgText(label)));
    lines.push(text(1000, y, 38, FG, svgText(value, 28), ' text-anchor="end" font-weight="700"'));
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
    text(
      80,
      1880,
      28,
      MUTED,
      `${svgText(String(grid.total), 10)} commits in 26 weeks · all on this computer`,
    ),
  );

  const title = svgText(`Phoenix weekly recap ${formatWeek(recap.week)}`, 100);
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
  image.onerror = () => loaded.reject(new Error("The recap image could not be drawn"));
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded.promise;
  const canvas = host.createCanvas();
  canvas.width = RECAP_IMAGE_WIDTH;
  canvas.height = RECAP_IMAGE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the recap image");
  context.drawImage(image, 0, 0, RECAP_IMAGE_WIDTH, RECAP_IMAGE_HEIGHT);
  const encoded = Promise.withResolvers<Blob>();
  canvas.toBlob(
    (blob) => (blob ? encoded.resolve(blob) : encoded.reject(new Error("PNG encoding failed"))),
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
