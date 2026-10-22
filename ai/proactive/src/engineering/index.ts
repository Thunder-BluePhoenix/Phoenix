// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename, isAbsolute, join } from "node:path";
const MAX_BYTES = 2 * 1024 * 1024;

export type Ecosystem = "npm" | "cargo" | "pip" | "go";
export type SignalKind = "advisory" | "flaky_test" | "duration_trend" | "config_drift";
export interface Dependency {
  ecosystem: Ecosystem;
  name: string;
  version: string;
}
export interface Advisory {
  id: string;
  ecosystem: Ecosystem;
  name: string;
  affectedVersion: string;
  summary: string;
  url?: string;
}
/** An injected, read-only provider; the collector itself never contacts a service. */
export interface AdvisoryProvider {
  lookup(dependencies: readonly Dependency[]): Promise<readonly Advisory[]>;
}
/**
 * Thrown by an optional provider that has no reliable data (no local vetted source, unreadable or
 * incomplete history). The collector records it, keeps its other signals and never treats the
 * missing data as a clean result. Any other error still propagates.
 */
export class ProviderUnavailableError extends Error {
  /** `reason` is provider-authored, fixed text: never include paths, values or a caught error's message. */
  constructor(reason: string) {
    super(reason.slice(0, 200));
    this.name = "ProviderUnavailableError";
  }
}
export interface EngineeringProviderAvailability {
  advisories: { available: boolean; reason?: string };
  history: { available: boolean; reason?: string };
}
export interface HistoryRun {
  repo: string;
  source: "terminal" | "ci";
  /** Stable CI job name or canonical command, supplied by the history owner. */
  job: string;
  /** Stable test full name; null represents the entire build/job. */
  test: string | null;
  outcome: "passed" | "failed";
  durationMs: number;
  finishedAt: number;
}
export interface HistorySource {
  list(root: string): Promise<readonly HistoryRun[]>;
}
export interface EngineeringSignal {
  id: string;
  kind: SignalKind;
  repo: string;
  subject: string;
  detail: string;
  evidenceIds: string[];
  observedAt: number;
}
export interface Clock {
  now(): number;
}
export interface Timer {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}
export interface Delivery {
  /** Phase 52 preference, capability and kill-switch gate; explicit opt-in only. */
  enabled(): boolean;
  /** Synchronously call NotificationService.considerInsight with isCurrent; do not retain the callback. */
  consider(signal: EngineeringSignal, isCurrent: () => boolean): void;
}

/** Minimal policy-facing shape; notification service remains the quiet/noise authority. */
export interface EngineeringInsight {
  id: string;
  kind: SignalKind;
  capabilityId: "engineering-signals";
  title: string;
  body: string;
  evidenceIds: string[];
  subjectId: string;
}
export interface EngineeringNotificationService {
  proactivePreferences(userId: string): {
    enabled: boolean;
    capabilities: string[];
    cadenceMinutes: number | null;
  };
  considerInsight(userId: string, insight: EngineeringInsight, isCurrent: () => boolean): unknown;
}
/** Never bypass Phase 52 quiet hours, persisted deduplication or the hourly budget. */
export function createEngineeringDelivery(options: {
  notifications: EngineeringNotificationService;
  userId: string;
  killSwitchEngaged(): boolean;
  capabilityEnabled(): boolean;
}): Delivery {
  const enabled = () => {
    const prefs = options.notifications.proactivePreferences(options.userId);
    return (
      !options.killSwitchEngaged() &&
      options.capabilityEnabled() &&
      prefs.enabled &&
      prefs.capabilities.includes("engineering-signals") &&
      prefs.cadenceMinutes !== null
    );
  };
  return {
    enabled,
    consider(signal, isCurrent) {
      if (!enabled() || !isCurrent()) return;
      const insight: EngineeringInsight = {
        id: signal.id,
        kind: signal.kind,
        capabilityId: "engineering-signals",
        title: `${signal.repo}: ${signal.subject}`,
        body: signal.detail,
        evidenceIds: [...signal.evidenceIds],
        subjectId: signal.id,
      };
      options.notifications.considerInsight(
        options.userId,
        insight,
        () => enabled() && isCurrent(),
      );
    },
  };
}
const hash = (...parts: string[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
const id = (kind: SignalKind, ...parts: string[]) => `engineering.${kind}.${hash(...parts)}`;
const manifests: readonly [string, Ecosystem][] = [
  ["package.json", "npm"],
  ["Cargo.lock", "cargo"],
  ["requirements.txt", "pip"],
  ["go.mod", "go"],
];
const safeName = (name: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);

/** Never follow symlinks to a manifest or env file, including symlinked repository roots. */
async function localFile(root: string, name: string): Promise<string | null> {
  const path = join(root, name);
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const current = await handle.stat();
      if (
        !current.isFile() ||
        current.ino !== stat.ino ||
        current.dev !== stat.dev ||
        current.size > MAX_BYTES
      )
        return null;
      return await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (["ENOENT", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
    throw error;
  }
}

const MAX_ENV_NAMES = 500;
const MAX_ENV_NAME_LENGTH = 128;
const MAX_DRIFT_SIGNALS = 500;
const MAX_GO_LINE = 1024;
/** Linear: a comment starts at the first `//` preceded by whitespace. */
function stripGoComment(line: string): string {
  for (let at = line.indexOf("//"); at > 0; at = line.indexOf("//", at + 1))
    if (/\s/.test(line[at - 1]!)) return line.slice(0, at);
  return line;
}
function dependencies(ecosystem: Ecosystem, text: string): Dependency[] {
  const rows: Dependency[] = [];
  if (ecosystem === "npm") {
    try {
      const doc: unknown = JSON.parse(text);
      if (!doc || typeof doc !== "object") return rows;
      for (const field of ["dependencies", "devDependencies"] as const) {
        const group: unknown = Reflect.get(doc, field);
        if (!group || typeof group !== "object" || Array.isArray(group)) continue;
        for (const [name, version] of Object.entries(group)) {
          // Ranges are not installed versions; the provider must not infer vulnerability from them.
          if (typeof version === "string" && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))
            rows.push({ ecosystem, name, version });
        }
      }
    } catch {
      return rows;
    }
  } else if (ecosystem === "pip") {
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([\w.-]+)==([\w.!+-]+)\s*(?:#.*)?$/.exec(line);
      if (match) rows.push({ ecosystem, name: match[1]!, version: match[2]! });
    }
  } else if (ecosystem === "go") {
    // go.mod has both single-line and block require forms. Ignore replace/exclude,
    // whose versions do not establish an installed dependency.
    let block = false;
    for (const line of text.split(/\r?\n/)) {
      if (line.length > MAX_GO_LINE) continue;
      const uncommented = stripGoComment(line).trim();
      if (uncommented === "require (") {
        block = true;
        continue;
      }
      if (block && uncommented === ")") {
        block = false;
        continue;
      }
      const match = /^(?:require\s+)?([^\s()]+)\s+(v\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/.exec(
        uncommented,
      );
      if (match && (block || uncommented.startsWith("require ")))
        rows.push({ ecosystem, name: match[1]!, version: match[2]! });
    }
  } else {
    let name: string | null = null;
    let version: string | null = null;
    const flush = () => {
      if (name && version) rows.push({ ecosystem, name, version });
      name = version = null;
    };
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*\[\[package\]\]\s*$/.test(line)) {
        flush();
        continue;
      }
      if (/^\s*\[/.test(line)) {
        flush();
        continue;
      }
      const n = /^\s*name\s*=\s*"([^"]+)"\s*$/.exec(line);
      const v = /^\s*version\s*=\s*"([^"]+)"\s*$/.exec(line);
      if (n) name = n[1]!;
      if (v) version = v[1]!;
    }
    flush();
  }
  return rows;
}

/** Streams assignment lines, retaining only names; values are never returned or logged. */
async function envNames(root: string, name: string, maxNames: number): Promise<Set<string> | null> {
  const path = join(root, name);
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    const names = new Set<string>();
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.ino !== stat.ino || current.dev !== stat.dev) return null;
      const lines = createInterface({
        input: handle.createReadStream({ autoClose: false }),
        crlfDelay: Infinity,
      });
      try {
        for await (const line of lines) {
          if (names.size >= maxNames) break;
          const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
          if (match && match[1]!.length <= MAX_ENV_NAME_LENGTH && safeName(match[1]!))
            names.add(match[1]!);
        }
      } finally {
        lines.close();
      }
      return names;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export class EngineeringSignals {
  private roots: string[] = [];
  private availability: EngineeringProviderAvailability = {
    advisories: { available: false, reason: "No scan performed" },
    history: { available: false, reason: "No scan performed" },
  };
  private handle: unknown;
  private running = false;
  private generation = 0;
  private evidenceRevision = 0;
  constructor(
    private readonly options: {
      advisories: AdvisoryProvider;
      history: HistorySource;
      delivery: Delivery;
      clock: Clock;
      timer: Timer;
      cadenceMs: number;
    },
  ) {
    if (!Number.isSafeInteger(options.cadenceMs) || options.cadenceMs < 60_000)
      throw new Error("invalid cadence");
  }
  /** Explicit user configuration only. Never discover neighboring projects or recurse. */
  async setWatchedRoots(paths: readonly string[]): Promise<void> {
    const roots: string[] = [];
    for (const path of paths) {
      if (!isAbsolute(path) || !(await lstat(path)).isDirectory())
        throw new Error("watched root must be a real directory");
      const canonical = await realpath(path);
      if (!roots.includes(canonical)) roots.push(canonical);
    }
    this.roots = roots;
    this.generation++;
    this.stop();
    this.start();
  }
  watchedRoots(): readonly string[] {
    return [...this.roots];
  }
  /** Latest scan only. `available: false` means "unknown", never "clean": no signals of that kind were evaluated. */
  providerAvailability(): EngineeringProviderAvailability {
    return {
      advisories: { ...this.availability.advisories },
      history: { ...this.availability.history },
    };
  }
  async scan(): Promise<EngineeringSignal[]> {
    // A newer observation supersedes any callback retained by the delivery policy.
    this.evidenceRevision++;
    const now = this.options.clock.now();
    if (!Number.isFinite(now)) return [];
    const signals: EngineeringSignal[] = [];
    const availability: EngineeringProviderAvailability = {
      advisories: { available: false, reason: "No pinned dependencies scanned" },
      history: { available: false, reason: "No watched repository scanned" },
    };
    for (const root of this.roots) {
      // Revocation/removal or replacement of the root invalidates all previous evidence.
      if (!(await this.validRoot(root))) continue;
      const label = basename(root);
      const found: Dependency[] = [];
      for (const [file, ecosystem] of manifests) {
        const text = await localFile(root, file);
        if (text !== null) found.push(...dependencies(ecosystem, text));
      }
      if (found.length) {
        const inventory = new Set(found.map((dep) => JSON.stringify(dep)));
        let advisories: readonly Advisory[] = [];
        try {
          advisories = await this.options.advisories.lookup(found);
          if (availability.advisories.reason === "No pinned dependencies scanned")
            availability.advisories = { available: true };
        } catch (error) {
          if (!(error instanceof ProviderUnavailableError)) throw error;
          availability.advisories = { available: false, reason: error.message };
        }
        for (const advisory of advisories) {
          const dep = {
            ecosystem: advisory.ecosystem,
            name: advisory.name,
            version: advisory.affectedVersion,
          };
          if (!inventory.has(JSON.stringify(dep)) || !/^[\w.:-]{1,160}$/.test(advisory.id))
            continue;
          signals.push({
            id: id("advisory", root, advisory.ecosystem, advisory.name, advisory.id),
            kind: "advisory",
            repo: label,
            subject: advisory.name,
            detail: advisory.summary.slice(0, 500),
            evidenceIds: [id("advisory", root, advisory.id)],
            observedAt: now,
          });
        }
      }
      const expected = await envNames(root, ".env.example", MAX_ENV_NAMES);
      const present = expected === null ? null : await envNames(root, ".env", Infinity);
      if (expected !== null && present !== null) {
        let drift = 0;
        for (const key of expected) {
          if (drift >= MAX_DRIFT_SIGNALS) break;
          if (!present.has(key)) {
            drift++;
            signals.push({
              id: id("config_drift", root, key),
              kind: "config_drift",
              repo: label,
              subject: key,
              detail: key,
              evidenceIds: [id("config_drift", root, key)],
              observedAt: now,
            });
          }
        }
      }
      let listed: readonly HistoryRun[] = [];
      try {
        listed = await this.options.history.list(root);
        if (availability.history.reason === "No watched repository scanned")
          availability.history = { available: true };
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) throw error;
        availability.history = { available: false, reason: error.message };
      }
      const runs = listed.filter(
        (run) =>
          run.repo === root &&
          Number.isFinite(run.finishedAt) &&
          run.finishedAt <= now &&
          now - run.finishedAt <= 30 * 86_400_000 &&
          Number.isFinite(run.durationMs) &&
          run.durationMs >= 0 &&
          run.durationMs <= 86_400_000 &&
          run.job.length > 0 &&
          run.job.length <= 160 &&
          (run.test === null || (run.test.length > 0 && run.test.length <= 300)),
      );
      const groups = new Map<string, HistoryRun[]>();
      for (const run of runs) {
        const key = JSON.stringify([run.source, run.job, run.test]);
        const group = groups.get(key) ?? [];
        group.push(run);
        groups.set(key, group);
      }
      for (const group of groups.values()) {
        group.sort((a, b) => a.finishedAt - b.finishedAt);
        const sample = group[0]!;
        const identity = [root, sample.source, sample.job, sample.test ?? ""];
        const recent = group.slice(-10);
        if (
          sample.test !== null &&
          recent.length >= 3 &&
          recent.some((r) => r.outcome === "passed") &&
          recent.some((r) => r.outcome === "failed")
        ) {
          signals.push({
            id: id("flaky_test", ...identity),
            kind: "flaky_test",
            repo: label,
            subject: sample.test,
            detail: `${recent.filter((r) => r.outcome === "failed").length}/${recent.length} recent runs failed`,
            evidenceIds: [id("flaky_test", ...identity)],
            observedAt: now,
          });
        }
        if (group.length >= 6) {
          const baseline = group
            .slice(-6, -3)
            .map((r) => r.durationMs)
            .sort((a, b) => a - b)[1]!;
          const latest = group
            .slice(-3)
            .map((r) => r.durationMs)
            .sort((a, b) => a - b)[1]!;
          if (baseline >= 1000 && latest >= baseline * 1.5 && latest - baseline >= 1000)
            signals.push({
              id: id("duration_trend", ...identity),
              kind: "duration_trend",
              repo: label,
              subject: sample.test ?? sample.job,
              detail: `${Math.round(baseline)} ms → ${Math.round(latest)} ms (median of three runs)`,
              evidenceIds: [id("duration_trend", ...identity)],
              observedAt: now,
            });
        }
      }
    }
    this.availability = availability;
    return signals.sort((a, b) => a.id.localeCompare(b.id));
  }
  /** Re-read source evidence immediately before Phase 52 decides to deliver. */
  async evaluate(): Promise<EngineeringSignal[]> {
    const generation = this.generation;
    if (!this.options.delivery.enabled()) return [];
    const candidates = await this.scan();
    if (!candidates.length) return candidates;
    // One fresh read validates every candidate; rescanning per candidate is O(n) full scans.
    const current = await this.scan();
    if (generation !== this.generation) return candidates;
    const fresh = new Map(current.map((signal) => [signal.id, signal]));
    const revision = this.evidenceRevision;
    for (const candidate of candidates) {
      if (generation !== this.generation || !this.options.delivery.enabled()) break;
      const match = fresh.get(candidate.id);
      if (
        match &&
        match.detail === candidate.detail &&
        match.evidenceIds.join("\0") === candidate.evidenceIds.join("\0")
      ) {
        this.options.delivery.consider(
          candidate,
          () =>
            generation === this.generation &&
            revision === this.evidenceRevision &&
            this.options.delivery.enabled(),
        );
      }
    }
    return candidates;
  }
  private async validRoot(root: string): Promise<boolean> {
    try {
      return (await lstat(root)).isDirectory() && (await realpath(root)) === root;
    } catch {
      return false;
    }
  }
  start(): void {
    if (this.running || !this.roots.length || !this.options.delivery.enabled()) return;
    this.running = true;
    const tick = () => {
      if (!this.running || !this.options.delivery.enabled()) {
        this.stop();
        return;
      }
      void this.evaluate()
        .catch(() => {
          /* Retain no stale findings on source failure. */
        })
        .finally(() => {
          if (this.running) this.handle = this.options.timer.set(tick, this.options.cadenceMs);
        });
    };
    this.handle = this.options.timer.set(tick, this.options.cadenceMs);
  }
  stop(): void {
    this.running = false;
    this.generation++;
    if (this.handle !== undefined) this.options.timer.clear(this.handle);
    this.handle = undefined;
  }
}
