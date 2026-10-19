// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Validation of Vercel REST responses. Everything Vercel (or whatever answers in its place) sends
// is untrusted: wrong types, odd ids and giant strings are dropped or clipped here, so the rest of
// the capability only ever sees small, well-formed values.
import {
  epochMs,
  expectObject,
  httpsUrl,
  isObject,
  parseList,
  str,
  type Json,
} from "@phoenix/service-kit";

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const PROJECT = /^[A-Za-z0-9._-]{1,100}$/;
const HOST = /^[A-Za-z0-9.-]{1,253}$/;
const TARGET = /^[a-z0-9-]{1,50}$/;
const SHA = /^[0-9a-f]{40}$/i;
const REPO_PART = /^[A-Za-z0-9_.-]{1,100}$/;

/** Most deployments read per poll. */
export const MAX_DEPLOYMENTS = 100;

export interface Deployment {
  id: string;
  /** Vercel project name. */
  project: string;
  /** Vercel's own state word, upper case (QUEUED, BUILDING, READY, ERROR, CANCELED, …). */
  state: string;
  /** "production", "preview" or another environment name. */
  target: string;
  /** Epoch ms. */
  createdAt: number;
  /** https link: the inspector page when Vercel gives one, else the deployment URL. */
  url?: string | undefined;
  branch?: string | undefined;
  /** Full 40-hex commit sha, lower case. */
  sha?: string | undefined;
  /** "owner/name", when the deployment came from a GitHub repository. */
  repository?: string | undefined;
  actor?: string | undefined;
}

/** One deployment from the list or detail endpoint, or undefined when it is unusable. */
export function parseDeployment(raw: Json): Deployment | undefined {
  const id = str(raw.uid ?? raw.id, 100);
  const project = str(raw.name, 100);
  const createdAt = epochMs(raw.createdAt ?? raw.created);
  if (!id || !ID.test(id) || !project || !PROJECT.test(project) || createdAt === undefined) {
    return undefined;
  }
  const meta = isObject(raw.meta) ? raw.meta : {};
  const host = str(raw.url, 253);
  const org = str(meta.githubOrg, 100);
  const repo = str(meta.githubRepo, 100);
  const sha = str(meta.githubCommitSha, 40);
  const target = str(raw.target, 50)?.toLowerCase();
  const creator = isObject(raw.creator) ? str(raw.creator.username, 100) : undefined;
  return {
    id,
    project,
    state: (str(raw.state ?? raw.readyState, 30) ?? "UNKNOWN").toUpperCase(),
    target: target !== undefined && TARGET.test(target) ? target : "preview",
    createdAt,
    url:
      httpsUrl(raw.inspectorUrl) ??
      (host && HOST.test(host) ? httpsUrl(`https://${host}`) : undefined),
    branch: str(meta.githubCommitRef, 100),
    sha: sha !== undefined && SHA.test(sha) ? sha.toLowerCase() : undefined,
    repository:
      org !== undefined && repo !== undefined && REPO_PART.test(org) && REPO_PART.test(repo)
        ? `${org}/${repo}`
        : undefined,
    actor: creator,
  };
}

/** GET /v6/deployments. Entries that do not parse are skipped; a body of the wrong shape throws. */
export function parseDeployments(body: unknown): Deployment[] {
  return parseList(expectObject(body).deployments, parseDeployment, MAX_DEPLOYMENTS);
}

/** What POST /v13/deployments answers: just enough to tell the user what started. */
export interface CreatedDeployment {
  id: string;
  state: string;
  url?: string | undefined;
}

export function parseCreated(body: unknown): CreatedDeployment {
  const raw = expectObject(body);
  const id = str(raw.id ?? raw.uid, 100);
  if (!id || !ID.test(id)) throw new TypeError("deployment id missing");
  const host = str(raw.url, 253);
  return {
    id,
    state: (str(raw.readyState ?? raw.state, 30) ?? "UNKNOWN").toUpperCase(),
    url: host && HOST.test(host) ? httpsUrl(`https://${host}`) : undefined,
  };
}
