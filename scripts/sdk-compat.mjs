// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// Build and test the actual packed SDK, never the workspace source export.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdk = join(root, "sdk/capability");
const requireSdk = createRequire(join(sdk, "package.json"));
const { build: bundle } = requireSdk("esbuild");
const ts = requireSdk("typescript");
const { Extractor, ExtractorConfig } = requireSdk("@microsoft/api-extractor");
const output = join(sdk, "dist");
const names = new Map([
  ["@phoenix/protocol", join(root, "protocol")],
  ["@phoenix/sdk-events", join(root, "sdk/events")],
  ["@phoenix/capability-manager", join(root, "core/capability-manager")],
  ["@phoenix/event-bus", join(root, "core/event-bus")],
  ["@phoenix/logging", join(root, "core/logging")],
]);

function fail(message) {
  throw new Error(message);
}

async function build() {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const staging = await mkdtemp(join(tmpdir(), "phoenix-sdk-types-"));
  try {
    const paths = Object.fromEntries(
      [...names].map(([name, folder]) => [name, [join(folder, "src/index.ts")]]),
    );
    const config = {
      compilerOptions: {
        target: "ES2023",
        lib: ["ES2024"],
        module: "ESNext",
        moduleResolution: "Bundler",
        resolveJsonModule: true,
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: staging,
        rootDir: root,
        types: ["node"],
        baseUrl: root,
        paths,
      },
      include: ["sdk/capability/src/**/*.ts"],
      exclude: ["**/test/**"],
    };
    const configPath = join(root, ".sdk-compat-types.json");
    // TypeScript's in-memory configuration avoids writing a temporary file in the source tree.
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root, undefined, configPath);
    if (parsed.errors.length)
      fail(ts.formatDiagnosticsWithColorAndContext(parsed.errors, diagnosticsHost));
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const emitted = program.emit();
    const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitted.diagnostics);
    if (diagnostics.length) {
      fail(ts.formatDiagnosticsWithColorAndContext(diagnostics, diagnosticsHost));
    }
    const declarations = join(staging, "sdk/capability/src/index.d.ts");
    // TypeScript reports emitSkipped for the imported JSON schema while still writing .d.ts files.
    await readFile(declarations);
    const stagedPaths = Object.fromEntries(
      [...names].map(([name, folder]) => [
        name,
        [join(staging, relative(root, folder), "src/index.d.ts")],
      ]),
    );
    const extractor = ExtractorConfig.prepare({
      configObject: {
        projectFolder: root,
        mainEntryPointFilePath: declarations,
        bundledPackages: [...names.keys()],
        compiler: {
          overrideTsconfig: {
            compilerOptions: {
              target: "ES2023",
              module: "ESNext",
              moduleResolution: "Bundler",
              skipLibCheck: true,
              types: ["node"],
              baseUrl: root,
              paths: stagedPaths,
            },
            files: [declarations],
          },
        },
        dtsRollup: { enabled: true, untrimmedFilePath: join(output, "index.d.ts") },
        apiReport: { enabled: false },
        docModel: { enabled: false },
        messages: {
          extractorMessageReporting: {
            default: { logLevel: "warning" },
            "ae-missing-release-tag": { logLevel: "none" },
            "ae-forgotten-export": { logLevel: "none" },
          },
          tsdocMessageReporting: { default: { logLevel: "warning" } },
        },
      },
      configObjectFullPath: join(sdk, "api-extractor.json"),
      packageJsonFullPath: join(sdk, "package.json"),
    });
    const result = Extractor.invoke(extractor, { localBuild: true, showVerboseMessages: false });
    if (!result.succeeded) fail("SDK API declaration extraction failed");
    await bundle({
      entryPoints: [join(sdk, "src/index.ts")],
      outfile: join(output, "index.js"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      packages: "bundle",
      external: ["node:*"],
      plugins: [
        {
          name: "bundle-private-workspace-packages",
          setup(plugin) {
            plugin.onResolve({ filter: /^@phoenix\// }, (args) => {
              const folder = names.get(args.path);
              if (!folder) fail(`Unrecognized private dependency: ${args.path}`);
              return { path: join(folder, "src/index.ts") };
            });
          },
        },
      ],
    });
    await copyFile(join(root, "LICENSE"), join(output, "LICENSE"));
    console.log("SDK JS, rolled-up declarations and GPL license prepared in sdk/capability/dist");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

const diagnosticsHost = {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => root,
  getNewLine: () => "\n",
};

async function check() {
  const scratch = await mkdtemp(join(tmpdir(), "phoenix-sdk-consumer-"));
  try {
    // npm pack honors package.json files/exports; installed files cannot resolve sibling workspaces.
    const tarball = execFileSync("npm", ["pack", sdk, "--pack-destination", scratch, "--silent"], {
      cwd: scratch,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .at(-1);
    if (!tarball) fail("npm pack did not produce an SDK archive");
    const consumer = join(scratch, "consumer");
    await mkdir(consumer);
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    execFileSync(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--offline",
        join(scratch, tarball),
      ],
      {
        cwd: consumer,
        stdio: "pipe",
      },
    );
    const installed = join(consumer, "node_modules/@phoenix/sdk");
    const installedPackage = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
    const installedEntry = join(installed, installedPackage.exports["."].default);
    const imported = await import(pathToFileURL(installedEntry));
    assert(
      (await readFile(join(installed, "dist/LICENSE"), "utf8")).includes(
        "GNU GENERAL PUBLIC LICENSE",
      ),
    );
    assert.equal(imported.CAPABILITY_MANIFEST_VERSION, "1");
    assert.equal(imported.CAPABILITY_PROTOCOL_MAJOR, "1");
    const oldManifest = {
      id: "compat-fixture",
      name: "Compatibility fixture",
      version: "0.1.0",
      description: "Local-only SDK consumer fixture",
      license: "GPL-3.0-or-later",
      events: ["build.*"],
      commands: [],
      permissions: [],
    };
    const explicitManifest = {
      ...oldManifest,
      manifest_version: "1",
      compatibility: { protocol: "1" },
    };
    for (const manifest of [oldManifest, explicitManifest]) {
      assert.deepEqual(imported.defineCapability({ manifest }).manifest, manifest);
    }
    assert.throws(
      () => imported.defineCapability({ manifest: { ...oldManifest, manifest_version: "2" } }),
      /Invalid manifest/,
    );
    assert.throws(
      () =>
        imported.defineCapability({
          manifest: { ...oldManifest, compatibility: { protocol: "2" } },
        }),
      /Invalid manifest/,
    );
    const previous = JSON.parse(
      await readFile(join(root, "protocol/fixtures/appendix-a.events.json"), "utf8"),
    );
    assert(previous.length > 0 && previous.every((event) => event.version === "1.0"));
    const validationBundle = join(scratch, "validation.mjs");
    await bundle({
      entryPoints: [join(root, "protocol/src/validate.ts")],
      outfile: validationBundle,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
    });
    const { validateEvent } = await import(pathToFileURL(validationBundle));
    for (const event of previous)
      assert.equal(validateEvent(event).ok, true, `${event.event_id}: historical 1.0 rejected`);
    const received = [];
    const core = createServer(async (req, res) => {
      const parts = [];
      for await (const part of req) parts.push(part);
      const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/capabilities/register") {
        assert.equal(req.headers.authorization, "Bearer local-test-token");
        assert.equal(body.manifest.id, oldManifest.id);
        res.end(JSON.stringify({ token: "local-capability-token" }));
      } else if (req.url === `/api/capabilities/${oldManifest.id}/events`) {
        assert.equal(req.headers["x-phoenix-capability-token"], "local-capability-token");
        received.push(body);
        res.end(JSON.stringify({ event_id: body.event_id }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ message: "Unknown fixture route" }));
      }
    });
    await new Promise((resolve) => core.listen(0, "127.0.0.1", resolve));
    try {
      const capability = await imported.runExternalCapability({
        manifest: explicitManifest,
        sessionToken: "local-test-token",
        coreUrl: `http://127.0.0.1:${core.address().port}`,
      });
      try {
        const sent = await capability.emit(imported.events.build.started("pnpm build"));
        assert.equal(sent.ok, true);
        assert.equal(received.length, 1);
        assert.equal(received[0].version, "1.1");
        assert.equal(received[0].source, oldManifest.id);
        assert.equal(validateEvent(received[0]).ok, true);
      } finally {
        await capability.close();
      }
    } finally {
      await new Promise((resolve, reject) =>
        core.close((error) => (error ? reject(error) : resolve())),
      );
    }
    assert.equal(imported.resolveSessionToken("fixture-token"), "fixture-token");
    const client = join(consumer, "client.mjs");
    await writeFile(
      client,
      'import { defineCapability, events } from "@phoenix/sdk";\nconsole.log(defineCapability, events.build.started("fixture").event_type);\n',
    );
    execFileSync("node", [client], { cwd: consumer, stdio: "pipe" });
    await writeFile(
      join(consumer, "client.ts"),
      'import { defineCapability, events, type CapabilityManifest, type CapabilityModule, type ExternalCapabilityOptions } from "@phoenix/sdk";\nconst manifest: CapabilityManifest = { id: "fixture", name: "Fixture", version: "0.1.0", description: "Compatibility", license: "GPL-3.0-or-later", events: [], commands: [], permissions: [] };\nconst module: CapabilityModule = { manifest };\nconst options: ExternalCapabilityOptions = { manifest };\ndefineCapability(module);\nevents.build.started("fixture");\nvoid options;\n',
    );
    await writeFile(
      join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2023",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
        files: ["client.ts"],
      }),
    );
    const compiler = join(root, "node_modules/typescript/bin/tsc");
    execFileSync(process.execPath, [compiler, "-p", join(consumer, "tsconfig.json")], {
      cwd: consumer,
      stdio: "pipe",
    });
    const declarations = await readFile(
      join(installed, installedPackage.exports["."].types),
      "utf8",
    );
    if (
      /\bfrom ["']@phoenix\//.test(declarations) ||
      /\bimport\(["']@phoenix\//.test(declarations)
    ) {
      fail("Packed declarations still reference private workspace packages");
    }
    console.log(
      "Packed SDK consumer import, declarations and manifest legacy/explicit v1 passed; historical wire 1.0 fixture recognized; no second SDK/manifest major claimed.",
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const action = process.argv[2];
if (action === "build") await build();
else if (action === "check") await check();
else fail("Usage: node scripts/sdk-compat.mjs build|check");
