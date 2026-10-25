// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { readFileSync, statSync } from "node:fs";
import { loadConfig, type PhoenixConfig } from "@phoenix/config";
import { createLogger } from "@phoenix/logging";
import { KeychainSecretStore, type SecretStore } from "@phoenix/persistence";
import { BrowserRelay } from "@phoenix/capability-browser";
import { builtinCapabilities } from "./builtins";
import { settingsReminderStore } from "./calendar";
import { dockerIdleFrom } from "./docker-idle";
import { PhoenixRuntime } from "./runtime";
import { explainStartupError } from "./startup-errors";
import { statusLightsHost } from "./status-lights/host";

/**
 * Prints why Core cannot start and exits. Failures a user can fix get one plain sentence; anything
 * else keeps its full detail, because a stack trace is what a bug report needs.
 */
function fail(err: unknown, where: { port?: number; dataDir?: string } = {}): never {
  const explained = explainStartupError(err, where);
  if (explained) console.error(`Phoenix Core could not start: ${explained}`);
  else console.error("Phoenix Core could not start:", err);
  process.exit(1);
}

let config: PhoenixConfig;
try {
  config = loadConfig();
} catch (err) {
  fail(err);
}
const logger = createLogger({ level: config.logLevel });
let secrets: SecretStore | undefined;
try {
  secrets = new KeychainSecretStore();
} catch (err) {
  logger.warn("OS secret storage unavailable; capability credentials cannot be stored", {
    error: (err as Error).message,
  });
}
const trustedKeyFile = process.env.PHOENIX_REGISTRY_TRUSTED_KEY_FILE;
const indexFile = process.env.PHOENIX_REGISTRY_INDEX_FILE;
const artifactDirectory = process.env.PHOENIX_REGISTRY_ARTIFACT_DIR;
const whisperModelPath = process.env.PHOENIX_WHISPER_MODEL_PATH;
// Owner opt-in speech engines. Parakeet's model location comes from the environment only.
const parakeetModelDir = process.env.PHOENIX_PARAKEET_MODEL_DIR;
const speechEngines = process.env.PHOENIX_SPEECH_ENGINES;
const visionModel = process.env.PHOENIX_VISION_MODEL;
if (
  ![trustedKeyFile, indexFile, artifactDirectory].every(Boolean) &&
  [trustedKeyFile, indexFile, artifactDirectory].some(Boolean)
) {
  fail(
    new Error(
      "PHOENIX_REGISTRY_TRUSTED_KEY_FILE, PHOENIX_REGISTRY_INDEX_FILE and PHOENIX_REGISTRY_ARTIFACT_DIR are required together",
    ),
  );
}
// Browser-extension signer registry (docs/browser-profiles.md): both are host-chosen local files.
// The root key is pinned here, never fetched and never taken from the registry document.
const signerRootKeyFile = process.env.PHOENIX_EXTENSION_SIGNER_ROOT_KEY_FILE;
const signerRegistryFile = process.env.PHOENIX_EXTENSION_SIGNER_REGISTRY_FILE;
if (Boolean(signerRootKeyFile) !== Boolean(signerRegistryFile)) {
  fail(
    new Error(
      "PHOENIX_EXTENSION_SIGNER_ROOT_KEY_FILE and PHOENIX_EXTENSION_SIGNER_REGISTRY_FILE are required together",
    ),
  );
}
let extensionSignerRegistry: { rootPublicKey: string; registryFile: string } | undefined;
if (signerRootKeyFile && signerRegistryFile) {
  try {
    if (statSync(signerRootKeyFile).size > 16 * 1024) throw new Error("root key file too large");
    extensionSignerRegistry = {
      rootPublicKey: readFileSync(signerRootKeyFile, "utf8"),
      registryFile: signerRegistryFile,
    };
  } catch {
    fail(new Error("PHOENIX_EXTENSION_SIGNER_ROOT_KEY_FILE could not be read"));
  }
}
const browserRelay = new BrowserRelay();
let runtime: PhoenixRuntime;
try {
  runtime = new PhoenixRuntime({
    config,
    logger,
    browserRelay,
    ...(secrets ? { secrets } : {}),
    ...(trustedKeyFile && indexFile && artifactDirectory
      ? { registry: { trustedKeyFile, indexFile, artifactDirectory } }
      : {}),
    ...(extensionSignerRegistry ? { extensionSignerRegistry } : {}),
    ...(whisperModelPath ? { whisperModelPath } : {}),
    ...(parakeetModelDir ? { parakeetModelDir } : {}),
    ...(speechEngines ? { speechEngines } : {}),
    ...(visionModel ? { visionModel } : {}),
    capabilities: builtinCapabilities(
      config.env,
      () => runtime.agentsServices(),
      () => ({
        reviewContext: (id: string) =>
          runtime.planning.reviewContext(id, runtime.memory.settings().allow_sensitive_meetings),
      }),
      {
        statusLights: statusLightsHost(() => runtime),
        onAwakeSession: (session) => {
          runtime.scheduledAwake.bindSession(session);
          runtime.awakeStatus.bind(session);
        },
        onAwakeQuitCheck: (check) => runtime.quitCheck.bind(check),
        dockerIdle: dockerIdleFrom({
          invokeAndWait: (...args) => runtime.capabilities.invokeAndWait(...args),
        }),
        calendarReminders: settingsReminderStore(() => runtime.settings),
        browserRelay,
      },
    ),
  });
} catch (err) {
  fail(err, { port: config.port, dataDir: config.dataDir });
}

const shutdown = (signal: string) => {
  logger.info("shutting down", { signal });
  runtime.stop().then(
    () => process.exit(0),
    (err: unknown) => {
      logger.error("shutdown failed", { error: err });
      process.exit(1);
    },
  );
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

runtime.start().catch((err: unknown) => {
  // The sockets and database were opened by now; release them so the next start is clean.
  void runtime.stop().finally(() => fail(err, { port: config.port, dataDir: config.dataDir }));
});
