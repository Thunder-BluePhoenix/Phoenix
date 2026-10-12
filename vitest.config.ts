// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    // The package's public entry is its built artifact (dist). Tests run against the source so a
    // clean checkout does not need a prior build; `check:artifact` covers the packed artifact itself.
    alias: {
      "@phoenix/sdk": fileURLToPath(new URL("./sdk/capability/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["**/test/**/*.test.ts", "**/test/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
