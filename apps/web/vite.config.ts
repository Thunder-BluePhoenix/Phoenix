// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const CORE = process.env.PHOENIX_CORE_URL ?? "http://127.0.0.1:4870";

/** Where a dev core writes its session token (config/dev.json: .phoenix/dev, else ~/.phoenix/dev). */
function tokenFile(): string | undefined {
  const candidates = [
    process.env.PHOENIX_DATA_DIR && join(process.env.PHOENIX_DATA_DIR, "session.token"),
    resolve(__dirname, "../../.phoenix/dev/session.token"),
    join(homedir(), ".phoenix/dev/session.token"),
  ].filter(Boolean) as string[];
  return candidates.find((f) => existsSync(f));
}

/**
 * Dev only: inject the running core's session token into index.html, the
 * same way core does when it serves the production build.
 */
function phoenixDevToken(): Plugin {
  return {
    name: "phoenix-dev-token",
    apply: "serve",
    transformIndexHtml(html) {
      const file = tokenFile();
      if (!file) return html;
      const token = readFileSync(file, "utf8")
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, "");
      return html.replace("</head>", `  <meta name="phoenix-token" content="${token}">\n  </head>`);
    },
  };
}

export default defineConfig({
  plugins: [react(), phoenixDevToken()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: CORE, changeOrigin: false, ws: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
