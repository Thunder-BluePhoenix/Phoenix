// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/test/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
  },
});
