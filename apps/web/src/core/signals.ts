// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
export type SignalKind = "advisory" | "flaky_test" | "duration_trend" | "config_drift";
export interface SignalView {
  id: string;
  kind: SignalKind;
  repo: string;
  subject: string;
  detail: string;
  observedAt: number;
}
export interface ProviderAvailability {
  available: boolean;
  reason?: string;
}
export interface SignalsAvailability {
  advisories: ProviderAvailability;
  history: ProviderAvailability;
}
export interface SignalsSnapshot {
  watchedRoots: string[];
  signals: SignalView[];
  availability: SignalsAvailability;
}
/** Signals beyond this are dropped so a hostile repository cannot make the folder list unusable. */
const MAX_SIGNALS = 500;
const MAX_REASON = 200;
const kinds: readonly string[] = ["advisory", "flaky_test", "duration_trend", "config_drift"];
/** Missing or malformed reports are "unknown", never "available": absence must not look clean. */
function readProvider(value: unknown): ProviderAvailability {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { available: false };
  const available = Reflect.get(value, "available");
  if (available === true) return { available: true };
  const reason = Reflect.get(value, "reason");
  return typeof reason === "string" && reason
    ? { available: false, reason: reason.slice(0, MAX_REASON) }
    : { available: false };
}
export function readSignalsSnapshot(value: unknown): SignalsSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const roots = Reflect.get(value, "watchedRoots");
  const signals = Reflect.get(value, "signals");
  const availability = Reflect.get(value, "availability");
  if (!Array.isArray(roots) || !roots.every((root) => typeof root === "string")) return null;
  if (!Array.isArray(signals)) return null;
  const rows: SignalView[] = [];
  for (const item of signals.slice(0, MAX_SIGNALS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const id = Reflect.get(item, "id");
    const kind = Reflect.get(item, "kind");
    const repo = Reflect.get(item, "repo");
    const subject = Reflect.get(item, "subject");
    const detail = Reflect.get(item, "detail");
    const observedAt = Reflect.get(item, "observedAt");
    if (
      typeof id !== "string" ||
      !/^engineering\.[\w.]+$/.test(id) ||
      !kinds.includes(kind) ||
      typeof repo !== "string" ||
      typeof subject !== "string" ||
      typeof detail !== "string" ||
      !Number.isFinite(observedAt)
    )
      return null;
    rows.push({ id, kind, repo, subject, detail, observedAt });
  }
  const source = availability && typeof availability === "object" ? availability : undefined;
  return {
    watchedRoots: roots,
    signals: rows,
    availability: {
      advisories: readProvider(source && Reflect.get(source, "advisories")),
      history: readProvider(source && Reflect.get(source, "history")),
    },
  };
}
