// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { loadConfig, type PhoenixConfig } from "@phoenix/config";
import { createLogger } from "@phoenix/logging";
import { KeychainSecretStore, type SecretStore } from "@phoenix/persistence";
import { builtinCapabilities } from "./builtins";
import { settingsReminderStore } from "./calendar";
import { dockerIdleFrom } from "./docker-idle";
import { PhoenixRuntime } from "./runtime";
import { explainStartupError } from "./startup-errors";

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
let runtime: PhoenixRuntime;
try {
  runtime = new PhoenixRuntime({
    config,
    logger,
    ...(secrets ? { secrets } : {}),
    ...(trustedKeyFile && indexFile && artifactDirectory
      ? { registry: { trustedKeyFile, indexFile, artifactDirectory } }
      : {}),
    ...(whisperModelPath ? { whisperModelPath } : {}),
    ...(visionModel ? { visionModel } : {}),
    capabilities: builtinCapabilities(
      config.env,
      () => runtime.agentsServices(),
      () => ({
        reviewContext: (id: string) =>
          runtime.planning.reviewContext(id, runtime.memory.settings().allow_sensitive_meetings),
      }),
      {
        statusLights: {
          devices: () => runtime.statusLights.devices(),
          feed: () => runtime.bus,
        },
        onAwakeSession: (session) => runtime.scheduledAwake.bindSession(session),
        dockerIdle: dockerIdleFrom({
          invokeAndWait: (...args) => runtime.capabilities.invokeAndWait(...args),
        }),
        calendarReminders: settingsReminderStore(() => runtime.settings),
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
