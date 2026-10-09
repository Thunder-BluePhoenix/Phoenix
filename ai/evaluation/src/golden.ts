// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Report } from "./report";
import { stringifyReport } from "./report";

export const GOLDEN_PATH = join(import.meta.dirname, "../golden/offline-report.json");
export const REAL_REPORT_PATH = join(import.meta.dirname, "../golden/real-ollama-report.json");

export function readReport(path: string): Report | null {
  if (!existsSync(path)) return null;
  const raw: Report = JSON.parse(readFileSync(path, "utf8"));
  return raw;
}

export function writeReport(path: string, report: Report): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyReport(report));
}
