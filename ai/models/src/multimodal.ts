// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Locality, PrivacyClass } from "./types";

export type MultimodalRole = "speech-transcription" | "vision-understanding";

/** Captured microphone and screen content is always sensitive, regardless of caller labels. */
export interface MultimodalProvider {
  id: string;
  locality: Locality;
  roles: readonly MultimodalRole[];
  available: boolean;
}

export interface MultimodalPlan {
  role: MultimodalRole;
  privacy: PrivacyClass;
  order: string[];
  refused: { providerId: string; reason: string }[];
}

/** No cloud fallback or preference may override this boundary. Availability must be checked first. */
export function routeMultimodal(
  role: MultimodalRole,
  providers: readonly MultimodalProvider[],
  preferred?: string,
): MultimodalPlan {
  const eligible: string[] = [];
  const refused: MultimodalPlan["refused"] = [];
  for (const provider of providers) {
    const reason =
      provider.locality !== "local"
        ? "captured inputs cannot be sent to cloud providers"
        : !provider.roles.includes(role)
          ? `does not support ${role}`
          : !provider.available
            ? "local model/service unavailable"
            : undefined;
    if (reason) refused.push({ providerId: provider.id, reason });
    else eligible.push(provider.id);
  }
  eligible.sort((a, b) => Number(b === preferred) - Number(a === preferred) || a.localeCompare(b));
  return { role, privacy: "sensitive", order: eligible, refused };
}
