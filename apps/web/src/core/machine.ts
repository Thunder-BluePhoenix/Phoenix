// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCapabilities } from "./hooks";
export type MachineProvider = "ollama" | "lmstudio";
export interface MachineReadingView {
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  memoryFreeBytes: number | null;
  memoryTotalBytes: number | null;
  cpuPercent: number | null;
  batteryPercent: number | null;
  charging: boolean | null;
  temperatureCelsius: number | null;
}
export interface MachineSnapshotView {
  platform: "darwin" | "linux" | "win32";
  reading: MachineReadingView;
  warnings: string[];
}
export interface MachineModelView {
  provider: MachineProvider;
  name: string;
  sizeBytes: number;
  loaded: boolean;
}
const field = (value: unknown, key: string): unknown =>
  value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
const num = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const maybeNum = (value: unknown): value is number | null => value === null || num(value);
export function readMachineSnapshot(raw: unknown): MachineSnapshotView | null {
  const reading = field(raw, "reading");
  const platform = field(raw, "platform");
  const warnings = field(raw, "warnings");
  const keys = [
    "diskFreeBytes",
    "diskTotalBytes",
    "memoryFreeBytes",
    "memoryTotalBytes",
    "cpuPercent",
    "batteryPercent",
    "temperatureCelsius",
  ] as const;
  if (
    (platform !== "darwin" && platform !== "linux" && platform !== "win32") ||
    !Array.isArray(warnings) ||
    !warnings.every((value) => typeof value === "string") ||
    !keys.every((key) => maybeNum(field(reading, key))) ||
    (field(reading, "charging") !== null && typeof field(reading, "charging") !== "boolean")
  )
    return null;
  return {
    platform,
    warnings,
    reading: {
      diskFreeBytes: field(reading, "diskFreeBytes") as number | null,
      diskTotalBytes: field(reading, "diskTotalBytes") as number | null,
      memoryFreeBytes: field(reading, "memoryFreeBytes") as number | null,
      memoryTotalBytes: field(reading, "memoryTotalBytes") as number | null,
      cpuPercent: field(reading, "cpuPercent") as number | null,
      batteryPercent: field(reading, "batteryPercent") as number | null,
      charging: field(reading, "charging") as boolean | null,
      temperatureCelsius: field(reading, "temperatureCelsius") as number | null,
    },
  };
}
export function readMachineModels(raw: unknown): MachineModelView[] | null {
  if (!Array.isArray(raw)) return null;
  const models: MachineModelView[] = [];
  for (const item of raw) {
    const provider = field(item, "provider"),
      name = field(item, "name"),
      sizeBytes = field(item, "sizeBytes"),
      loaded = field(item, "loaded");
    if (
      (provider !== "ollama" && provider !== "lmstudio") ||
      typeof name !== "string" ||
      !num(sizeBytes) ||
      typeof loaded !== "boolean"
    )
      return null;
    models.push({ provider, name, sizeBytes, loaded });
  }
  return models;
}
export function useMachineAvailability(): "absent" | "disabled" | "ready" {
  const { data } = useCapabilities();
  const cap = data.find((entry) => entry.id === "machine");
  return !cap ? "absent" : cap.status === "enabled" ? "ready" : "disabled";
}
