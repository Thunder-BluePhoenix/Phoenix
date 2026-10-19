// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import type { Recap } from "../src/core/recap";
import {
  buildRecapSvg,
  renderRecapPng,
  svgText,
  RECAP_IMAGE_HEIGHT,
  RECAP_IMAGE_WIDTH,
  type RecapCanvasHost,
} from "../src/core/recap-image";

const HOSTILE_PROJECT = `PROJECTCANARY</text><script>`;
const HOSTILE_AGENT = `&amp;AGENTCANARY</title><image href="x"/>\u202e`;

function recap(over: Partial<Recap> = {}): Recap {
  const weekDays = [
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
  ];
  return {
    week: {
      start: "2026-10-26",
      end: "2026-11-01",
      days: weekDays,
      time_zone: "UTC",
      current: false,
    },
    coding: {
      seconds: 5400,
      sessions: 3,
      steps: 13,
      files: 2,
      lines_added: 18,
      lines_removed: 3,
      lines_changed: 21,
      commands: 3,
      longest_session_seconds: 1200,
    },
    permissions: { granted: 3, denied: 4 },
    top_agent: { name: HOSTILE_AGENT, steps: 10 },
    top_project: { name: HOSTILE_PROJECT, steps: 10 },
    busiest_day: { day: "2026-11-01", steps: 6, seconds: 1200 },
    days: weekDays.map((day) => ({ day, steps: 0, seconds: 0, commits: 0 })),
    commits: 4,
    ci: { passed: 2, failed: 1 },
    meetings: { count: 2, decisions: 2 },
    meetings_allowed: true,
    grid: {
      weeks: [{ start: "2026-10-26", days: weekDays.map((day, i) => ({ day, count: i })) }],
      max: 6,
      total: 21,
      source: "local-git-events",
    },
    ...over,
  };
}

describe("buildRecapSvg", () => {
  it("is a 1080 x 1920 image", () => {
    const svg = buildRecapSvg(recap());
    expect(svg).toContain(`width="${RECAP_IMAGE_WIDTH}" height="${RECAP_IMAGE_HEIGHT}"`);
    expect([RECAP_IMAGE_WIDTH, RECAP_IMAGE_HEIGHT]).toEqual([1080, 1920]);
  });

  it("is well-formed XML whatever the names hold", () => {
    for (const showProjects of [false, true]) {
      const svg = buildRecapSvg(recap(), { showProjects });
      // No element can be created out of a name: every tag in the output is one the builder wrote.
      const tags = new Set([...svg.matchAll(/<\/?([a-zA-Z]+)/g)].map((m) => m[1]));
      expect([...tags].sort()).toEqual(["rect", "svg", "text", "title"]);
      expect(svg).not.toMatch(/<script|<image|<a |onload|javascript:/i);
      // Tags balance: every <text> and <title> is closed.
      expect(svg.match(/<text /g)?.length).toBe(svg.match(/<\/text>/g)?.length);
      // No raw ampersand is left unescaped (a stray one makes the SVG unloadable).
      expect(svg).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;)/);
    }
  });

  it("escapes a hostile agent and a hostile project, and drops bidi controls", () => {
    const svg = buildRecapSvg(recap(), { showProjects: true });
    expect(svg).toContain("&amp;amp;AGENTCANARY&lt;/title&gt;&lt;");
    expect(svg).toContain("PROJECTCANARY&lt;/text&gt;&lt;script&gt;");
    expect(svg).not.toContain("\u202e");
  });

  it("with showProjects off the project name is nowhere in the output", () => {
    for (const options of [{}, { showProjects: false }, { showProjects: undefined }]) {
      const svg = buildRecapSvg(recap(), options);
      expect(svg, JSON.stringify(options)).not.toContain("PROJECTCANARY");
      expect(svg).not.toContain("Top project");
      expect(svg).not.toContain("script");
    }
    // The agent is not a project: it still shows.
    expect(buildRecapSvg(recap())).toContain("Top agent");
  });

  it("with showProjects on it names the project", () => {
    const svg = buildRecapSvg(recap(), { showProjects: true });
    expect(svg).toContain("Top project");
    expect(svg).toContain("PROJECTCANARY");
  });

  it("only a literal true turns project names on", () => {
    const loose = { showProjects: "yes" } as unknown as { showProjects: boolean };
    expect(buildRecapSvg(recap(), loose)).not.toContain("PROJECTCANARY");
  });

  it("an empty week still draws, with no rank rows for nothing", () => {
    const svg = buildRecapSvg(recap({ top_agent: null, top_project: null, busiest_day: null }), {
      showProjects: true,
    });
    expect(svg).not.toContain("Top agent");
    expect(svg).not.toContain("Top project");
    expect(svg).not.toContain("Busiest day");
    expect(svg).toContain("Longest session");
  });

  it("shows the numbers of the recap", () => {
    const svg = buildRecapSvg(recap());
    expect(svg).toContain("1 h 30 min");
    expect(svg).toContain(">21<"); // lines changed
    expect(svg).toContain("permissions granted");
  });
});

describe("svgText", () => {
  it("cuts long text and neutralises markup", () => {
    expect(svgText("a".repeat(50), 10)).toBe("aaaaaaaaa…");
    expect(svgText("<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
    expect(svgText("a\u0000b\u200bc")).toBe("abc");
  });
});

describe("renderRecapPng", () => {
  function host(options: { fail?: "image" | "context" | "blob" } = {}) {
    const seen: { src?: string; width?: number; height?: number; drawn?: number[]; type?: string } =
      {};
    const image = {
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      set src(value: string) {
        seen.src = value;
        queueMicrotask(() => (options.fail === "image" ? image.onerror?.() : image.onload?.()));
      },
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () =>
        options.fail === "context"
          ? null
          : {
              drawImage: (_i: unknown, x: number, y: number, w: number, h: number) => {
                seen.drawn = [x, y, w, h];
              },
            },
      toBlob: (cb: (blob: Blob | null) => void, type: string) => {
        seen.type = type;
        seen.width = canvas.width;
        seen.height = canvas.height;
        cb(options.fail === "blob" ? null : new Blob(["png"], { type }));
      },
    };
    const value: RecapCanvasHost = {
      createImage: () => image as unknown as HTMLImageElement,
      createCanvas: () => canvas as unknown as HTMLCanvasElement,
    };
    return { value, seen };
  }

  it("draws the SVG data URL on a 1080 x 1920 canvas and returns a PNG", async () => {
    const { value, seen } = host();
    const svg = buildRecapSvg(recap());
    const blob = await renderRecapPng(svg, value);
    expect(blob.type).toBe("image/png");
    expect(seen.src).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    expect([seen.width, seen.height, seen.type]).toEqual([1080, 1920, "image/png"]);
    expect(seen.drawn).toEqual([0, 0, 1080, 1920]);
  });

  it.each([
    ["image", "could not be drawn"],
    ["context", "cannot draw"],
    ["blob", "PNG encoding failed"],
  ] as const)("rejects with a clear message when the %s step fails", async (fail, message) => {
    await expect(renderRecapPng("<svg/>", host({ fail }).value)).rejects.toThrow(message);
  });
});
