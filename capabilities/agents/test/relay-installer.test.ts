// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The hook installer against temp homes only (see relay-rig.ts). Real agents are never run and no
// real agent directory is read or written.
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOOK_SCRIPT_PATTERN } from "../src/relay/commands";
import { InstallError, StaleFileError } from "../src/relay/installer";
import { jsonAdapters, pluginAdapters, rig, tempDir } from "./relay-rig";
import { HookInstaller } from "../src/relay/installer";

const USER_HOOK = { type: "command", command: "echo mine" };
const settings = (obj: unknown, eol = "\n", tail = true) =>
  JSON.stringify(obj, null, 2).replace(/\n/g, eol) + (tail ? eol : "");

/** Seed files per adapter shape, covering the edge cases the byte-identical rule must survive. */
function seedsFor(id: string, shape: "grouped" | "flat"): Record<string, Buffer | string | null> {
  const mine = shape === "grouped" ? { hooks: [USER_HOOK] } : USER_HOOK;
  const userEvent = id === "cursor" ? "stop" : id === "copilot-cli" ? "agentStop" : "Stop";
  const withHooks = {
    theme: "dark",
    hooks: { [userEvent]: [mine] },
    statusLine: { type: "command", command: "my-status" },
  };
  return {
    missing: null,
    empty: "",
    "empty object": "{}\n",
    "no trailing newline": settings({ theme: "dark" }, "\n", false),
    crlf: settings(withHooks, "\r\n"),
    "existing hooks + statusLine": settings(withHooks),
    "tab indent": JSON.stringify({ a: 1, hooks: {} }, null, "\t") + "\n",
    bom: "\uFEFF" + settings({ theme: "dark" }),
  };
}

const bytes = (path: string) => (existsSync(path) ? readFileSync(path) : null);

describe.each(jsonAdapters.map((a) => [a.id, a] as const))(
  "%s: install → uninstall",
  (id, adapter) => {
    const seeds = seedsFor(id, adapter.shape);

    it.each(Object.keys(seeds))("leaves the file byte-identical (%s)", (name) => {
      const seed = seeds[name]!;
      const r = rig(id, seed);
      const original = bytes(r.path);
      const preview = r.installer.preview("install", id);
      expect(preview.changed).toBe(true);
      r.installer.apply("install", id, preview.hash);
      const installed = bytes(r.path)!;
      expect(installed.toString()).toMatch(HOOK_SCRIPT_PATTERN);
      // the file is still valid JSON for the agent
      expect(() => JSON.parse(installed.toString().replace(/^\uFEFF/, ""))).not.toThrow();

      const out = r.installer.preview("uninstall", id);
      r.installer.apply("uninstall", id, out.hash);
      const restored = bytes(r.path);
      expect(restored === null ? null : restored.toString("hex")).toBe(
        original === null ? null : original.toString("hex"),
      );
      expect(r.installer.list().find((a) => a.id === id)!.state).toBe("not_installed");
    });

    it("is idempotent: a second install is a no-op that writes nothing", () => {
      const r = rig(id, seeds["existing hooks + statusLine"]!);
      r.installer.apply("install", id, r.installer.preview("install", id).hash);
      const once = bytes(r.path)!;
      const second = r.installer.preview("install", id);
      expect(second.changed).toBe(false);
      expect(second.diff).toBe("");
      r.installer.apply("install", id, second.hash);
      expect(bytes(r.path)!.equals(once)).toBe(true);
    });

    it("never removes or reorders the user's hooks or statusLine", () => {
      const r = rig(id, seeds["existing hooks + statusLine"]!);
      r.installer.apply("install", id, r.installer.preview("install", id).hash);
      const doc = JSON.parse(readFileSync(r.path, "utf8")) as Record<string, any>;
      if (id === "claude-code") {
        // wrapped, not replaced: the user's command is still what runs, behind --then
        expect(doc.statusLine.command).toMatch(/statusline\.ts' --then 'my-status'$/);
      } else {
        expect(doc.statusLine).toEqual({ type: "command", command: "my-status" });
      }
      expect(doc.theme).toBe("dark");
      const userEvent = id === "cursor" ? "stop" : id === "copilot-cli" ? "agentStop" : "Stop";
      const list = doc.hooks[userEvent] as unknown[];
      expect(JSON.stringify(list[0])).toContain("echo mine"); // the user's entry stays first
      // keys the user had keep their order; only a missing `version`/`schema_version` is added in front
      expect(Object.keys(doc).filter((k) => k !== "version" && k !== "schema_version")).toEqual([
        "theme",
        "hooks",
        "statusLine",
      ]);
    });

    it("refuses to write when the file changed after the preview", () => {
      const r = rig(id, seeds["existing hooks + statusLine"]!);
      const preview = r.installer.preview("install", id);
      const edited = readFileSync(r.path, "utf8").replace("dark", "light");
      writeFileSync(r.path, edited);
      expect(() => r.installer.apply("install", id, preview.hash)).toThrow(StaleFileError);
      expect(readFileSync(r.path, "utf8")).toBe(edited);
      expect(existsSync(r.backupDir)).toBe(false);
    });

    it("uninstall after a user edit removes only Phoenix's entries and keeps the edit", () => {
      const r = rig(id, seeds["existing hooks + statusLine"]!);
      r.installer.apply("install", id, r.installer.preview("install", id).hash);
      const doc = JSON.parse(readFileSync(r.path, "utf8")) as Record<string, unknown>;
      doc.theme = "solarized";
      doc.extra = { added: "later" };
      writeFileSync(r.path, JSON.stringify(doc, null, 2) + "\n");

      const out = r.installer.preview("uninstall", id);
      expect(out.notes.join(" ")).toMatch(/changed after Phoenix wrote it/);
      const applied = r.installer.apply("uninstall", id, out.hash);
      expect(applied.kept_user_edits).toBe(true);
      const after = JSON.parse(readFileSync(r.path, "utf8")) as Record<string, any>;
      expect(after.theme).toBe("solarized");
      expect(after.extra).toEqual({ added: "later" });
      expect(after.statusLine).toEqual({ type: "command", command: "my-status" });
      expect(readFileSync(r.path, "utf8")).not.toMatch(HOOK_SCRIPT_PATTERN);
      const userEvent = id === "cursor" ? "stop" : id === "copilot-cli" ? "agentStop" : "Stop";
      expect(JSON.stringify(after.hooks[userEvent])).toContain("echo mine");
    });

    it("health notices vanished hooks and repair puts them back", () => {
      const r = rig(id, seeds["existing hooks + statusLine"]!);
      r.installer.apply("install", id, r.installer.preview("install", id).hash);
      expect(r.installer.list().find((a) => a.id === id)!.state).toBe("installed");

      // an agent update / manual edit drops every Phoenix entry but one event is kept intact
      const doc = JSON.parse(readFileSync(r.path, "utf8")) as Record<string, any>;
      const events = Object.keys(doc.hooks);
      const userEvent = id === "cursor" ? "stop" : id === "copilot-cli" ? "agentStop" : "Stop";
      const dropped = events.find(
        (e) => e !== userEvent && HOOK_SCRIPT_PATTERN.test(JSON.stringify(doc.hooks[e])),
      )!;
      delete doc.hooks[dropped];
      writeFileSync(r.path, JSON.stringify(doc, null, 2) + "\n");
      const sick = r.installer.list().find((a) => a.id === id)!;
      expect(sick.state).toBe("needs_repair");
      expect(sick.missing).toContain(dropped);

      const fix = r.installer.preview("repair", id);
      expect(fix.changed).toBe(true);
      r.installer.apply("repair", id, fix.hash);
      expect(r.installer.list().find((a) => a.id === id)!.state).toBe("installed");
      // the user's own entry survived the repair
      expect(readFileSync(r.path, "utf8")).toContain("echo mine");
    });

    it("detects the whole file being replaced (all hooks gone) as needs_repair", () => {
      const r = rig(id, seeds["empty object"]!);
      r.installer.apply("install", id, r.installer.preview("install", id).hash);
      writeFileSync(r.path, "{}\n");
      expect(r.installer.list().find((a) => a.id === id)!.state).toBe("needs_repair");
      r.installer.apply("repair", id, r.installer.preview("repair", id).hash);
      expect(r.installer.list().find((a) => a.id === id)!.state).toBe("installed");
    });

    it("writes a backup with a manifest and shows the diff before writing", () => {
      const r = rig(id, seeds["existing hooks + statusLine"]!);
      const before = readFileSync(r.path);
      const preview = r.installer.preview("install", id);
      expect(readFileSync(r.path).equals(before)).toBe(true); // preview writes nothing
      expect(preview.diff).toMatch(/^--- a\/.*\n\+\+\+ b\/.*\n@@ /);
      expect(preview.diff).toContain("+");
      r.installer.apply("install", id, preview.hash);
      const manifest = JSON.parse(readFileSync(join(r.backupDir, id, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        agent: id,
        path: r.path,
        existed: true,
        exact_restore: true,
      });
      expect(manifest.sha256_before).toMatch(/^[0-9a-f]{64}$/);
      expect(manifest.sha256_after).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof manifest.mtime).toBe("number");
      expect(statSync(join(r.backupDir, id)).mode & 0o777).toBe(0o700);
      expect(readdirSync(join(r.backupDir, id)).some((f) => f.endsWith(".bak"))).toBe(true);
    });

    it("keeps the file mode and restores it", () => {
      const r = rig(id, seeds["existing hooks + statusLine"]!, 0o640);
      r.installer.apply("install", id, r.installer.preview("install", id).hash);
      expect(statSync(r.path).mode & 0o777).toBe(0o640);
      r.installer.apply("uninstall", id, r.installer.preview("uninstall", id).hash);
      expect(statSync(r.path).mode & 0o777).toBe(0o640);
    });

    it("refuses files it cannot edit safely (invalid JSON, array root, bad hooks type)", () => {
      for (const bad of ["{ nope", "[]", settings({ hooks: [] })]) {
        const r = rig(id, bad);
        expect(() => r.installer.preview("install", id)).toThrow(InstallError);
        expect(readFileSync(r.path, "utf8")).toBe(bad);
      }
    });

    it("only offers detected agents", () => {
      const r = rig(id, null);
      const others = r.installer.list().filter((a) => a.id !== id && a.support === "supported");
      expect(others.every((a) => !a.detected)).toBe(true);
      expect(() => r.installer.preview("install", others[0]!.id)).toThrow(/not found/);
    });
  },
);

describe("plugin agents (OpenCode, Amp)", () => {
  it.each(pluginAdapters.map((a) => [a.id] as const))(
    "%s: install writes one marked file, uninstall deletes it",
    (id) => {
      const r = rig(id, null);
      const preview = r.installer.preview("install", id);
      expect(preview.diff).toContain("phoenix_managed");
      r.installer.apply("install", id, preview.hash);
      expect(readFileSync(r.path, "utf8")).toContain("phoenix_managed");
      expect(r.installer.list().find((a) => a.id === id)!.state).toBe("installed");
      expect(r.installer.preview("install", id).changed).toBe(false);

      writeFileSync(r.path, "// something else\n");
      expect(r.installer.list().find((a) => a.id === id)!.state).toBe("not_installed");
      writeFileSync(r.path, readFileSync(r.path, "utf8") + "phoenix_managed\n");
      expect(r.installer.list().find((a) => a.id === id)!.state).toBe("needs_repair");
      r.installer.apply("repair", id, r.installer.preview("repair", id).hash);
      expect(r.installer.list().find((a) => a.id === id)!.state).toBe("installed");

      r.installer.apply("uninstall", id, r.installer.preview("uninstall", id).hash);
      expect(existsSync(r.path)).toBe(false);
    },
  );

  it.each(pluginAdapters.map((a) => [a.id] as const))(
    "%s: never overwrites a file Phoenix did not write",
    (id) => {
      const r = rig(id, "// the user's own plugin\n");
      expect(() => r.installer.preview("install", id)).toThrow(/did not write/);
      expect(readFileSync(r.path, "utf8")).toBe("// the user's own plugin\n");
    },
  );

  it.each(pluginAdapters.map((a) => [a.id] as const))(
    "%s: a plugin the user edited is kept on uninstall",
    (id) => {
      const r = rig(id, null);
      r.installer.apply("install", id, r.installer.preview("install", id).hash);
      writeFileSync(r.path, readFileSync(r.path, "utf8") + "// my tweak\n");
      const out = r.installer.preview("uninstall", id);
      expect(out.changed).toBe(false);
      expect(r.installer.apply("uninstall", id, out.hash).kept_user_edits).toBe(true);
      expect(readFileSync(r.path, "utf8")).toContain("my tweak");
    },
  );
});

describe("unsupported agents", () => {
  it("are listed with the reason and doc URL and refuse every action", () => {
    const r = rig("claude-code", null);
    const list = r.installer.list();
    for (const id of ["hermes", "antigravity", "claude-desktop"]) {
      const entry = list.find((a) => a.id === id)!;
      expect(entry).toMatchObject({ support: "unsupported", state: "unsupported" });
      expect(entry.reason).toMatch(/^unsupported:/);
      expect(entry.doc_url).toMatch(/^https:\/\//);
      for (const action of ["install", "uninstall", "repair"] as const) {
        expect(() => r.installer.preview(action, id)).toThrow(/unsupported/);
      }
    }
    expect(() => r.installer.preview("install", "nope")).toThrow(/Unknown agent/);
  });
});

describe("engine details", () => {
  it("writes through a symlinked settings file and keeps the link", () => {
    const r = rig("claude-code", null);
    const real = join(tempDir(), "dotfiles-settings.json");
    writeFileSync(real, "{}\n");
    symlinkSync(real, r.path);
    r.installer.apply("install", "claude-code", r.installer.preview("install", "claude-code").hash);
    expect(readFileSync(real, "utf8")).toMatch(HOOK_SCRIPT_PATTERN);
    expect(readFileSync(r.path, "utf8")).toBe(readFileSync(real, "utf8"));
    r.installer.apply(
      "uninstall",
      "claude-code",
      r.installer.preview("uninstall", "claude-code").hash,
    );
    expect(readFileSync(real, "utf8")).toBe("{}\n");
  });

  it("leaves no temp file behind and a failed write keeps the original", () => {
    const r = rig("claude-code", "{}\n");
    const preview = r.installer.preview("install", "claude-code");
    chmodSync(join(r.home, ".claude"), 0o500); // the directory refuses the temp file
    try {
      if (process.getuid?.() !== 0) {
        expect(() => r.installer.apply("install", "claude-code", preview.hash)).toThrow(
          InstallError,
        );
        expect(readFileSync(r.path, "utf8")).toBe("{}\n");
      }
    } finally {
      chmodSync(join(r.home, ".claude"), 0o700);
    }
    expect(readdirSync(join(r.home, ".claude")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("a second install after repair keeps the ORIGINAL backup, so uninstall still restores the user's file", () => {
    const original = settings({ theme: "dark", hooks: { Stop: [{ hooks: [USER_HOOK] }] } });
    const r = rig("claude-code", original);
    r.installer.apply("install", "claude-code", r.installer.preview("install", "claude-code").hash);
    writeFileSync(r.path, "{}\n"); // an update wiped everything
    r.installer.apply("repair", "claude-code", r.installer.preview("repair", "claude-code").hash);
    const out = r.installer.preview("uninstall", "claude-code");
    r.installer.apply("uninstall", "claude-code", out.hash);
    // the file now is what the user had after the wipe, minus Phoenix: not the pre-install bytes
    expect(readFileSync(r.path, "utf8")).toBe("{}\n");
  });

  it("two installers over the same files agree (the hash is a pure function of the file)", () => {
    const r = rig("codex", "{}\n");
    const other = new HookInstaller({
      home: r.home,
      env: { PATH: "" },
      platform: "linux",
      backupDir: tempDir(),
      commands: { root: "/opt/phoenix" },
    });
    expect(other.preview("install", "codex").hash).toBe(
      r.installer.preview("install", "codex").hash,
    );
  });

  it("the sentinel only matches Phoenix's hook scripts", () => {
    expect(
      HOOK_SCRIPT_PATTERN.test(
        "'/x/node_modules/.bin/tsx' '/opt/phoenix/capabilities/agents/src/claude-hook.ts'",
      ),
    ).toBe(true);
    expect(HOOK_SCRIPT_PATTERN.test("echo capabilities/agents/src/claude-hook.tsx")).toBe(false);
    expect(HOOK_SCRIPT_PATTERN.test("my-linter --fix")).toBe(false);
  });
});
