// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { CapabilityModule } from "@phoenix/capability-manager";
import { validateManifest } from "@phoenix/protocol";

/**
 * Declares a builtin (in-process) capability. Validates the manifest and
 * checks every declared command has a handler, so mistakes surface at import
 * time instead of when a user enables the capability.
 *
 * Only Core loads these modules, so a manifest that declares `agent.*` is accepted here (the
 * `agents` capability does); an out-of-process capability goes through `runExternalCapability`,
 * which refuses it. The manager still blocks publishing into `agent.safety.*`.
 */
export function defineCapability<M extends CapabilityModule>(module: M): M {
  const result = validateManifest(module.manifest, { allowReservedEventOverlap: true });
  if (!result.ok) {
    throw new Error(
      `Invalid manifest for "${module.manifest?.id}": ${result.error.details.join("; ")}`,
    );
  }
  const missing = module.manifest.commands
    .filter((c) => !module.commands?.[c.name])
    .map((c) => c.name);
  if (missing.length) {
    throw new Error(`Capability "${module.manifest.id}" has no handler for: ${missing.join(", ")}`);
  }
  return module;
}
