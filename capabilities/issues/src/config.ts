// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { GithubProvider, REPO_PATTERN } from "./github";
import { JiraProvider } from "./jira";
import { LinearProvider } from "./linear";
import type { ProviderOptions } from "./provider-base";
import type { IssueProvider } from "./types";
import { isRecord } from "./validate";

export const TRACKER_KINDS = ["github", "linear", "jira"] as const;
export type TrackerKind = (typeof TRACKER_KINDS)[number];

export type TrackerSpec =
  | { kind: "github"; repositories: string[]; login?: string; apiUrl?: string }
  | { kind: "linear"; apiUrl?: string }
  | { kind: "jira"; site: string };

export interface ParsedTrackers {
  specs: TrackerSpec[];
  /** Configuration mistakes, one sentence each; the rest of the configuration still applies. */
  problems: string[];
}

/** Optional string property; a present value of the wrong type is reported by the caller. */
function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Reads `config.trackers`. The manifest's config schema rejects most mistakes before the
 * capability starts; this still checks everything it relies on, so a hand-edited or
 * future-versioned configuration degrades one tracker instead of the whole capability.
 */
export function parseTrackers(config: Readonly<Record<string, unknown>>): ParsedTrackers {
  const specs: TrackerSpec[] = [];
  const problems: string[] = [];
  const raw = config.trackers;
  if (raw === undefined) return { specs, problems };
  if (!Array.isArray(raw)) return { specs, problems: ['"trackers" must be a list'] };
  const used: Record<string, true> = {};
  for (const item of raw) {
    if (!isRecord(item) || typeof item.kind !== "string") {
      problems.push("A tracker entry has no kind");
      continue;
    }
    const kind = item.kind;
    if (used[kind]) {
      problems.push(`Tracker "${kind}" is configured more than once; only the first is used`);
      continue;
    }
    if (kind === "github") {
      const repos = Array.isArray(item.repositories) ? item.repositories : [];
      const valid = repos.filter((r): r is string => typeof r === "string" && REPO_PATTERN.test(r));
      if (valid.length === 0 || valid.length !== repos.length) {
        problems.push('GitHub needs "repositories" as a list of owner/name');
        continue;
      }
      const login = str(item.login);
      const apiUrl = str(item.api_url);
      specs.push({
        kind,
        repositories: valid,
        ...(login ? { login } : {}),
        ...(apiUrl ? { apiUrl } : {}),
      });
    } else if (kind === "linear") {
      const apiUrl = str(item.api_url);
      specs.push({ kind, ...(apiUrl ? { apiUrl } : {}) });
    } else if (kind === "jira") {
      const site = str(item.site);
      if (!site) {
        problems.push('Jira needs "site", e.g. https://yourcompany.atlassian.net');
        continue;
      }
      specs.push({ kind, site });
    } else {
      problems.push(`Unknown tracker "${kind.slice(0, 30)}"`);
      continue;
    }
    used[kind] = true;
  }
  return { specs, problems };
}

export function createProvider(spec: TrackerSpec, options: ProviderOptions): IssueProvider {
  switch (spec.kind) {
    case "github":
      return new GithubProvider(
        {
          repositories: spec.repositories,
          ...(spec.login ? { login: spec.login } : {}),
          ...(spec.apiUrl ? { apiUrl: spec.apiUrl } : {}),
        },
        options,
      );
    case "linear":
      return new LinearProvider(spec.apiUrl ? { apiUrl: spec.apiUrl } : {}, options);
    case "jira":
      return new JiraProvider({ site: spec.site }, options);
  }
}

/** JSON Schema for the capability's configuration (checked by the manager before it is stored). */
export const CONFIG_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    poll_ms: { type: "integer", minimum: 250, maximum: 3_600_000 },
    trackers: {
      type: "array",
      maxItems: 3,
      items: {
        oneOf: [
          {
            type: "object",
            required: ["kind", "repositories"],
            additionalProperties: false,
            properties: {
              kind: { const: "github" },
              repositories: {
                type: "array",
                minItems: 1,
                maxItems: 20,
                uniqueItems: true,
                items: { type: "string", pattern: REPO_PATTERN.source },
              },
              login: { type: "string", pattern: "^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$" },
              api_url: { type: "string", pattern: "^https?://[^\\s]+$" },
            },
          },
          {
            type: "object",
            required: ["kind"],
            additionalProperties: false,
            properties: {
              kind: { const: "linear" },
              api_url: { type: "string", pattern: "^https?://[^\\s]+$" },
            },
          },
          {
            type: "object",
            required: ["kind", "site"],
            additionalProperties: false,
            properties: {
              kind: { const: "jira" },
              site: { type: "string", pattern: "^https?://[^\\s]+$" },
            },
          },
        ],
      },
    },
  },
};
