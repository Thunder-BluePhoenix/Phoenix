// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The hook installer engine. Rules it enforces, in order of importance:
//  1. Nothing is written without a preview: `preview` returns a unified diff and a hash that covers
//     the action, the path, the exact bytes read and the exact bytes that would be written.
//     `apply` recomputes the plan from the file as it is NOW and refuses (StaleFileError) when the
//     hash differs, i.e. when the user (or the agent) changed the file after the preview.
//  2. The original bytes are backed up first, to Phoenix's own backup directory, with a manifest
//     {path, sha256_before, sha256_after, mtime}. Uninstall restores them byte-identically when the
//     file still equals sha256_after; otherwise it removes only Phoenix's entries and keeps every
//     later edit of the user.
//  3. Only entries whose command runs one of Phoenix's hook scripts are Phoenix's. Everything else,
//     including the user's own hooks, is left where it is, in order. Claude Code's `statusLine` is wrapped
//     (statusline-hook.ts), keeping the user's command, and unwrapped on uninstall.
//  4. Writes are atomic (random temp file in the same directory, O_EXCL|O_NOFOLLOW, fsync, rename),
//     keep the file mode, and follow a symlinked settings file to its real target instead of
//     replacing the link. Right before the rename the target is re-read and the path re-resolved
//     (atomic-file.ts): a file or link swapped after the preview is refused, never overwritten.
import { createHash } from "node:crypto";
import { readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../guards";
import {
  adapterContext,
  AGENT_ADAPTERS,
  detectAgent,
  PLUGIN_MARKER,
  STATUSLINE_MISSING,
  type AdapterContext,
  type AgentAdapter,
  type JsonAdapter,
  type PluginAdapter,
} from "./adapters";
import type { HookCommandOptions } from "./commands";
import { isSkeleton, parseConfig, serializeConfig, type JsonObject } from "./config-json";
import { unifiedDiff } from "./diff";
import {
  atomicWrite,
  ensurePrivateDir,
  removeChecked,
  snapshotTarget,
  writeBackupFile,
  type TargetSnapshot,
} from "./atomic-file";
import { InstallError, StaleFileError } from "./errors";

export { InstallError, StaleFileError } from "./errors";

export type InstallAction = "install" | "uninstall" | "repair";

export interface AgentStatus {
  id: string;
  label: string;
  support: "supported" | "unsupported";
  /** Why it is unsupported, or a caveat for a supported agent. */
  reason?: string;
  doc_url: string;
  detected: boolean;
  detected_via?: string;
  config_path?: string;
  state: "installed" | "not_installed" | "needs_repair" | "unsupported";
  /** Hook events whose Phoenix entries are missing (state needs_repair). */
  missing: string[];
  note?: string;
}

export interface InstallPreview {
  mode: "preview";
  action: InstallAction;
  agent: string;
  path: string;
  changed: boolean;
  diff: string;
  hash: string;
  notes: string[];
}

export interface InstallApplied {
  mode: "applied";
  action: InstallAction;
  agent: string;
  path: string;
  changed: boolean;
  summary: string;
  kept_user_edits: boolean;
}

export interface InstallerOptions {
  home: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  /** Phoenix-owned directory for backups and manifests. */
  backupDir: string;
  now?: () => number;
  /** Where the hook scripts live and how they are launched (tests pin it). */
  commands?: HookCommandOptions;
}

/** What is stored per agent next to the backed-up bytes. */
export interface BackupManifest {
  agent: string;
  path: string;
  /** The file existed before Phoenix first wrote it. */
  existed: boolean;
  sha256_before: string | null;
  sha256_after: string;
  /** Modification time (ms since epoch) of the file before Phoenix wrote it; null if absent. */
  mtime: number | null;
  /** Mode of the original file (octal digits), null if absent. */
  mode: number | null;
  /** The backup holds the user's file exactly; false after a repair over earlier hooks. */
  exact_restore: boolean;
  backup_file: string | null;
  created_at: string;
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const ABSENT = "absent";

interface Plan {
  action: InstallAction;
  agent: string;
  path: string;
  changed: boolean;
  diff: string;
  notes: string[];
  hash: string;
  /** Performs the write. Called only after the hash was verified. */
  commit(): { summary: string; kept_user_edits: boolean };
}

export class HookInstaller {
  private readonly ctx: AdapterContext;
  private readonly now: () => number;

  constructor(private readonly options: InstallerOptions) {
    this.ctx = adapterContext(
      options.home,
      options.env ?? process.env,
      options.platform ?? process.platform,
      options.commands,
    );
    this.now = options.now ?? Date.now;
  }

  list(): AgentStatus[] {
    return AGENT_ADAPTERS.map((adapter) => this.status(adapter));
  }

  preview(action: InstallAction, agent: string): InstallPreview {
    const plan = this.plan(action, agent);
    return {
      mode: "preview",
      action,
      agent,
      path: plan.path,
      changed: plan.changed,
      diff: plan.diff,
      hash: plan.hash,
      notes: plan.notes,
    };
  }

  apply(action: InstallAction, agent: string, confirmHash: string): InstallApplied {
    const plan = this.plan(action, agent);
    if (plan.hash !== confirmHash) throw new StaleFileError();
    const done = plan.commit();
    return {
      mode: "applied",
      action,
      agent,
      path: plan.path,
      changed: plan.changed,
      summary: done.summary,
      kept_user_edits: done.kept_user_edits,
    };
  }

  // ── status ────────────────────────────────────────────────────────────────────────────────

  private adapter(id: string): AgentAdapter {
    const found = AGENT_ADAPTERS.find((a) => a.id === id);
    if (!found) throw new InstallError("unknown_agent", `Unknown agent "${id.slice(0, 40)}".`);
    return found;
  }

  private status(adapter: AgentAdapter): AgentStatus {
    const found = detectAgent(adapter, this.ctx);
    const base = {
      id: adapter.id,
      label: adapter.label,
      doc_url: adapter.doc_url,
      detected: found.detected,
      ...(found.via ? { detected_via: found.via } : {}),
      config_path: adapter.settingsPath(this.ctx),
      missing: [] as string[],
    };
    if (adapter.kind === "unsupported") {
      return { ...base, support: "unsupported", reason: adapter.reason, state: "unsupported" };
    }
    const common = {
      ...base,
      support: "supported" as const,
      ...(adapter.note ? { reason: adapter.note } : {}),
    };
    try {
      const health =
        adapter.kind === "json" ? this.jsonHealth(adapter) : this.pluginHealth(adapter);
      return {
        ...common,
        state: health.state,
        missing: health.missing,
        ...(health.note ? { note: health.note } : {}),
      };
    } catch (err) {
      const note = err instanceof InstallError ? err.message : "The file could not be read.";
      return { ...common, state: "not_installed", note };
    }
  }

  private jsonHealth(adapter: JsonAdapter): {
    state: AgentStatus["state"];
    missing: string[];
    note?: string;
  } {
    const path = adapter.settingsPath(this.ctx);
    const manifest = this.readManifest(adapter.id);
    const bytes = readBytes(path);
    const events = Object.keys(adapter.spec(this.ctx).events);
    const { doc } = parseConfig(bytes === null ? null : decode(bytes));
    const installedEvents = events.filter((e) => !adapter.health(doc, this.ctx).includes(e));
    if (installedEvents.length === 0) {
      return manifest
        ? {
            state: "needs_repair",
            missing: events,
            note: "Phoenix's hooks are no longer in this file (an agent update or a manual edit removed them).",
          }
        : { state: "not_installed", missing: [] };
    }
    const missing = adapter.health(doc, this.ctx);
    return missing.length === 0
      ? { state: "installed", missing: [] }
      : { state: "needs_repair", missing };
  }

  private pluginHealth(adapter: PluginAdapter): {
    state: AgentStatus["state"];
    missing: string[];
    note?: string;
  } {
    const bytes = readBytes(adapter.settingsPath(this.ctx));
    const manifest = this.readManifest(adapter.id);
    if (bytes === null) {
      return manifest
        ? {
            state: "needs_repair",
            missing: ["plugin file"],
            note: "Phoenix's plugin file is gone.",
          }
        : { state: "not_installed", missing: [] };
    }
    const text = decode(bytes);
    if (!text.includes(PLUGIN_MARKER)) {
      return {
        state: "not_installed",
        missing: [],
        note: "A file Phoenix did not write is at the plugin path.",
      };
    }
    return text === adapter.contents(this.ctx)
      ? { state: "installed", missing: [] }
      : { state: "needs_repair", missing: ["plugin file"] };
  }

  // ── planning ──────────────────────────────────────────────────────────────────────────────

  private plan(action: InstallAction, agent: string): Plan {
    const adapter = this.adapter(agent);
    if (adapter.kind === "unsupported") {
      throw new InstallError("unsupported", adapter.reason);
    }
    const path = adapter.settingsPath(this.ctx);
    if (action !== "uninstall" && !detectAgent(adapter, this.ctx).detected) {
      throw new InstallError("not_detected", `${adapter.label} was not found on this computer.`);
    }
    return adapter.kind === "json"
      ? this.planJson(action, adapter, path)
      : this.planPlugin(action, adapter, path);
  }

  private display(path: string): string {
    return path.startsWith(this.options.home) ? `~${path.slice(this.options.home.length)}` : path;
  }

  private hashOf(
    action: InstallAction,
    agent: string,
    path: string,
    before: Buffer | null,
    after: Buffer | null,
  ): string {
    return sha256(
      [action, agent, path, before ? sha256(before) : ABSENT, after ? sha256(after) : ABSENT].join(
        "\0",
      ),
    );
  }

  private planJson(action: InstallAction, adapter: JsonAdapter, path: string): Plan {
    const before = readBytes(path);
    const snap = snapshotTarget(path);
    const manifest = this.readManifest(adapter.id);
    const text = before === null ? null : decode(before);
    const notes: string[] = [];

    if (action === "uninstall") {
      return this.planJsonUninstall(adapter, path, snap, before, text, manifest);
    }

    const parsed = parseConfig(text);
    const hasPhoenix =
      adapter.health(parsed.doc, this.ctx).filter((e) => e !== STATUSLINE_MISSING).length <
      Object.keys(adapter.spec(this.ctx).events).length;
    if (action === "repair" && !hasPhoenix && !manifest) {
      throw new InstallError("nothing_to_do", "Phoenix hooks are not installed here; use Install.");
    }
    const withSkeleton = withMissingKeys(parsed.doc, adapter.skeleton);
    const merged = adapter.merge(withSkeleton, this.ctx);
    const skeletonAdded = Object.keys(withSkeleton).length !== Object.keys(parsed.doc).length;
    const changed = merged.changed || skeletonAdded;
    const afterText = changed ? serializeConfig(merged.after, parsed.style) : text;
    const after = changed && afterText !== null ? Buffer.from(afterText, "utf8") : before;
    if (!changed) notes.push("Phoenix's hooks are already in place; nothing will be written.");
    else if (before === null) notes.push("The file does not exist yet; Phoenix will create it.");
    else
      notes.push(
        "Your own hooks and other settings are kept as they are; an existing statusLine keeps running, wrapped by Phoenix's.",
      );
    if (changed && before !== null)
      notes.push("A backup of the current file is saved before writing.");
    const diff = changed ? unifiedDiff(this.display(path), text, afterText) : "";

    return {
      action,
      agent: adapter.id,
      path,
      changed,
      diff,
      notes,
      hash: this.hashOf(action, adapter.id, path, before, changed ? after : before),
      commit: () => {
        if (!changed || after === null)
          return { summary: "Already installed; nothing changed.", kept_user_edits: false };
        this.backupAndWrite(adapter.id, path, snap, before, after, manifest, hasPhoenix, 0o600);
        return {
          summary: `${action === "repair" ? "Repaired" : "Installed"} Phoenix hooks in ${this.display(path)}.`,
          kept_user_edits: false,
        };
      },
    };
  }

  private planJsonUninstall(
    adapter: JsonAdapter,
    path: string,
    snap: TargetSnapshot,
    before: Buffer | null,
    text: string | null,
    manifest: BackupManifest | null,
  ): Plan {
    const exact =
      manifest !== null &&
      manifest.exact_restore &&
      before !== null &&
      sha256(before) === manifest.sha256_after;
    if (exact) {
      const original = this.readBackup(adapter.id, manifest);
      const originalText = original === null ? null : decode(original);
      return {
        action: "uninstall",
        agent: adapter.id,
        path,
        changed: true,
        diff: unifiedDiff(this.display(path), text, originalText),
        notes: [
          manifest.existed
            ? "The file has not been edited since Phoenix wrote it: your original file is restored byte for byte."
            : "Phoenix created this file: it is removed.",
        ],
        hash: this.hashOf("uninstall", adapter.id, path, before, original),
        commit: () => {
          this.restore(adapter.id, snap, manifest, original, before);
          return {
            summary: `Restored ${this.display(path)} from the backup.`,
            kept_user_edits: false,
          };
        },
      };
    }

    const parsed = parseConfig(text);
    const removal = adapter.remove(parsed.doc);
    if (!removal.changed && !manifest) {
      throw new InstallError("nothing_to_do", "Phoenix hooks are not installed here.");
    }
    const remaining = removal.before;
    const deleteFile =
      removal.changed &&
      manifest !== null &&
      !manifest.existed &&
      isSkeleton(remaining, adapter.skeleton);
    const afterText = removal.changed ? serializeConfig(remaining, parsed.style) : text;
    const after = deleteFile
      ? null
      : removal.changed && afterText !== null
        ? Buffer.from(afterText, "utf8")
        : before;
    const keptEdits =
      removal.changed &&
      manifest !== null &&
      before !== null &&
      sha256(before) !== manifest.sha256_after;
    const notes = removal.changed
      ? [
          "The file changed after Phoenix wrote it, so only Phoenix's own entries are removed. Everything else, including your later edits, stays.",
        ]
      : [
          "Phoenix's hooks are already gone from this file; only the stale backup record is dropped.",
        ];
    return {
      action: "uninstall",
      agent: adapter.id,
      path,
      changed: removal.changed,
      diff: removal.changed
        ? unifiedDiff(this.display(path), text, deleteFile ? null : afterText)
        : "",
      notes,
      hash: this.hashOf("uninstall", adapter.id, path, before, after),
      commit: () => {
        if (removal.changed) {
          if (deleteFile) removeChecked(snap, before === null ? null : sha256(before));
          else if (after !== null)
            atomicWrite(snap, after, {
              newFileMode: 0o600,
              expectSha256: before === null ? null : sha256(before),
            });
        }
        this.dropManifest(adapter.id);
        return {
          summary: removal.changed
            ? `Removed Phoenix's hooks from ${this.display(path)}.`
            : "Phoenix's hooks were already gone; the backup record was dropped.",
          kept_user_edits: keptEdits,
        };
      },
    };
  }

  private planPlugin(action: InstallAction, adapter: PluginAdapter, path: string): Plan {
    const before = readBytes(path);
    const snap = snapshotTarget(path);
    const manifest = this.readManifest(adapter.id);
    const text = before === null ? null : decode(before);
    const ours = text !== null && text.includes(PLUGIN_MARKER);

    if (action === "uninstall") {
      if (before === null || !ours) {
        if (!manifest)
          throw new InstallError("nothing_to_do", "Phoenix's plugin is not installed here.");
        return {
          action,
          agent: adapter.id,
          path,
          changed: false,
          diff: "",
          notes: ["The plugin file is already gone; only the stale backup record is dropped."],
          hash: this.hashOf(action, adapter.id, path, before, before),
          commit: () => {
            this.dropManifest(adapter.id);
            return {
              summary: "The plugin file was already gone; the record was dropped.",
              kept_user_edits: false,
            };
          },
        };
      }
      const edited = manifest !== null && sha256(before) !== manifest.sha256_after;
      if (edited) {
        return {
          action,
          agent: adapter.id,
          path,
          changed: false,
          diff: "",
          notes: [
            "You edited Phoenix's plugin file after it was written, so Phoenix keeps it. Delete it yourself if you want it gone.",
          ],
          hash: this.hashOf(action, adapter.id, path, before, before),
          commit: () => {
            this.dropManifest(adapter.id);
            return { summary: "Kept the plugin file you edited.", kept_user_edits: true };
          },
        };
      }
      return {
        action,
        agent: adapter.id,
        path,
        changed: true,
        diff: unifiedDiff(this.display(path), text, null),
        notes: ["Phoenix's plugin file is deleted."],
        hash: this.hashOf(action, adapter.id, path, before, null),
        commit: () => {
          removeChecked(snap, sha256(before));
          this.dropManifest(adapter.id);
          return { summary: `Deleted ${this.display(path)}.`, kept_user_edits: false };
        },
      };
    }

    if (before !== null && !ours) {
      throw new InstallError(
        "invalid_file",
        "A file that Phoenix did not write is already at the plugin path, so Phoenix will not replace it.",
      );
    }
    if (action === "repair" && before === null && !manifest) {
      throw new InstallError("nothing_to_do", "The plugin is not installed here; use Install.");
    }
    const wanted = adapter.contents(this.ctx);
    const changed = text !== wanted;
    const after = Buffer.from(wanted, "utf8");
    return {
      action,
      agent: adapter.id,
      path,
      changed,
      diff: changed ? unifiedDiff(this.display(path), text, wanted) : "",
      notes: changed
        ? [`Phoenix writes one plugin file into ${adapter.label}'s plugin folder.`]
        : ["The plugin file is already in place; nothing will be written."],
      hash: this.hashOf(action, adapter.id, path, before, changed ? after : before),
      commit: () => {
        if (!changed)
          return { summary: "Already installed; nothing changed.", kept_user_edits: false };
        this.backupAndWrite(
          adapter.id,
          path,
          snap,
          before,
          after,
          manifest,
          before !== null,
          0o644,
        );
        return { summary: `Wrote ${this.display(path)}.`, kept_user_edits: false };
      },
    };
  }

  // ── backups ───────────────────────────────────────────────────────────────────────────────

  private agentDir(agent: string): string {
    return join(this.options.backupDir, agent);
  }

  private manifestPath(agent: string): string {
    return join(this.agentDir(agent), "manifest.json");
  }

  readManifest(agent: string): BackupManifest | null {
    const bytes = readBytes(this.manifestPath(agent));
    if (bytes === null) return null;
    try {
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      return isRecord(value) &&
        typeof value.sha256_after === "string" &&
        typeof value.path === "string"
        ? (value as unknown as BackupManifest)
        : null;
    } catch {
      return null;
    }
  }

  private readBackup(agent: string, manifest: BackupManifest): Buffer | null {
    if (!manifest.existed || manifest.backup_file === null) return null;
    const bytes = readBytes(join(this.agentDir(agent), manifest.backup_file));
    if (
      bytes === null ||
      (manifest.sha256_before !== null && sha256(bytes) !== manifest.sha256_before)
    ) {
      throw new InstallError(
        "io",
        "The backup file is missing or damaged, so Phoenix cannot restore it.",
      );
    }
    return bytes;
  }

  private dropManifest(agent: string): void {
    rmSync(this.manifestPath(agent), { force: true });
  }

  /**
   * Backs up first, then writes. A file untouched since the previous Phoenix write keeps its
   * ORIGINAL backup (so uninstall can still restore it exactly); anything else is backed up as it
   * is now.
   */
  private backupAndWrite(
    agent: string,
    path: string,
    snap: TargetSnapshot,
    before: Buffer | null,
    after: Buffer,
    previous: BackupManifest | null,
    hadPhoenix: boolean,
    newFileMode: number,
  ): void {
    const dir = this.agentDir(agent);
    ensurePrivateDir(dir);
    const untouched =
      previous !== null && before !== null && sha256(before) === previous.sha256_after;
    let manifest: BackupManifest;
    if (untouched) {
      manifest = { ...previous, sha256_after: sha256(after) };
    } else {
      let backupFile: string | null = null;
      if (before !== null) {
        backupFile = `${sha256(before)}.bak`;
        writeBackupFile(join(dir, backupFile), before);
      }
      const stat = before === null ? null : statSync(snap.target);
      manifest = {
        agent,
        path,
        existed: before !== null,
        sha256_before: before ? sha256(before) : null,
        sha256_after: sha256(after),
        mtime: stat ? Math.round(stat.mtimeMs) : null,
        mode: stat ? stat.mode & 0o777 : null,
        // Over earlier Phoenix entries the backup is not the user's pristine file.
        exact_restore: !hadPhoenix,
        backup_file: backupFile,
        created_at: new Date(this.now()).toISOString(),
      };
    }
    // The manifest goes down before the file: a crash in between leaves a record of a write that
    // did not happen (harmless: sha256_after then simply never matches), never the reverse.
    atomicWrite(
      snapshotTarget(this.manifestPath(agent)),
      Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
      { newFileMode: 0o600 },
    );
    atomicWrite(snap, after, {
      newFileMode,
      expectSha256: before === null ? null : sha256(before),
    });
  }

  private restore(
    agent: string,
    snap: TargetSnapshot,
    manifest: BackupManifest,
    original: Buffer | null,
    current: Buffer | null,
  ): void {
    const expectSha256 = current === null ? null : sha256(current);
    if (original === null) removeChecked(snap, expectSha256);
    else {
      atomicWrite(snap, original, {
        newFileMode: manifest.mode ?? undefined,
        expectSha256,
        ...(manifest.mtime === null ? {} : { mtime: new Date(manifest.mtime) }),
      });
    }
    this.dropManifest(agent);
  }
}

// ── file helpers ────────────────────────────────────────────────────────────────────────────

function readBytes(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new InstallError("io", `Could not read ${path}.`);
  }
}

function decode(bytes: Buffer): string {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw new InstallError(
      "invalid_file",
      "The file is not valid UTF-8, so Phoenix will not change it.",
    );
  }
  return text;
}

/** `doc` with every key of `defaults` it lacks, those first (Cursor wants `version` on top). */
function withMissingKeys(doc: JsonObject, defaults: JsonObject): JsonObject {
  const missing = Object.entries(defaults).filter(([key]) => !(key in doc));
  return missing.length === 0 ? doc : { ...Object.fromEntries(missing), ...doc };
}
