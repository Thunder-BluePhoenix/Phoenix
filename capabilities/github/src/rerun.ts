// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `ci.rerun_failed` (Phase 31): re-runs the failed jobs of ONE GitHub Actions workflow run. It is
// the second command of this capability that WRITES to GitHub (the first is `issue.create`).
//
// Endpoint (GitHub REST, "Re-run failed jobs from a workflow run", read 2026-11-10):
//   POST https://api.github.com/repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs
//   https://docs.github.com/en/rest/actions/workflow-runs#re-run-failed-jobs-from-a-workflow-run
// The page documents status 201 and the optional body field `enable_debug_logging`; it lists no
// other status code for this endpoint, so the 403/404/409/422 mapping below is a defensive
// choice, not something checked against GitHub's documentation or the live service.
//
// Safety properties, each pinned by a test:
//   * Its own secret, `ci_write_token` (fine-grained: Actions read and write). The read `token`
//     and the issue `write_token` are never used, and a missing secret fails before any request.
//   * `external` in the manifest: the capability manager asks for confirmation on every call and
//     the policy engine rates it high risk. An agent is never trusted to skip that.
//   * The host is fixed to api.github.com. The capability's `api_url` setting (GitHub Enterprise,
//     tests) is NOT honoured here, so this credential cannot be pointed at another host.
//   * Redirects are refused, the request has a 15 s timeout, the reply is capped at 256 KiB and
//     never used: the result is built from the validated input only.
//   * Every failure is a fixed message. Nothing from the request, the response or the credential
//     is ever put into an error.
//   * No body is sent (no debug logging switch), no automatic retry, and nothing calls this
//     command by itself: it runs only when a person confirms it.
import { GithubClient, GithubError, readCapped } from "./client";
import { isRecord } from "./guards";
import { WRITE_TOKEN_RE } from "./issues";
import { parseRunDetail } from "./parse";

export const CI_WRITE_TOKEN_SECRET = "ci_write_token";

/** Fixed: never taken from configuration. */
export const CI_RERUN_ORIGIN = "https://api.github.com";
export const CI_RERUN_TIMEOUT_MS = 15_000;
export const CI_RERUN_MAX_REPLY_BYTES = 256 * 1024;

const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

export interface CiRerunInput {
  repository: string;
  run_id: number;
}

export interface CiRerunResult {
  status: "requested";
  repository: string;
  run_id: number;
}

export interface CiRerunOptions {
  token: string | undefined;
  signal: AbortSignal;
}

const FAILURES: Readonly<Record<number, { kind: GithubError["kind"]; message: string }>> = {
  401: {
    kind: "auth",
    message: `GitHub rejected the ${CI_WRITE_TOKEN_SECRET} (401): check that it is valid and not expired. Nothing was re-run`,
  },
  403: {
    kind: "forbidden",
    message: `GitHub refused the re-run (403): the ${CI_WRITE_TOKEN_SECRET} needs Actions: read and write on this repository. Nothing was re-run`,
  },
  404: {
    kind: "not_found",
    message: `GitHub could not find the repository or the run (404), or the ${CI_WRITE_TOKEN_SECRET} cannot see it. Nothing was re-run`,
  },
  409: {
    kind: "http",
    message:
      "GitHub reports a conflict (409): the run is probably not in a state that can be re-run. Nothing was re-run",
  },
  422: {
    kind: "http",
    message:
      "GitHub rejected the re-run request as invalid (422): the run probably cannot be re-run. Nothing was re-run",
  },
  429: {
    kind: "rate_limit",
    message: "GitHub rate limit reached (429). Nothing was re-run",
  },
};

const UNKNOWN_OUTCOME =
  "GitHub did not answer in time or the connection dropped; the re-run may or may not have been requested. Check the run on GitHub before asking again";

/**
 * Splits and strictly validates `owner/name` and the run id. Throws GithubError("invalid") with a
 * fixed message; the rejected value is never echoed.
 */
export function parseCiRerunInput(input: unknown): {
  owner: string;
  repo: string;
  runId: number;
} {
  if (!isRecord(input)) throw new GithubError("invalid", "The input must be an object");
  for (const key of Object.keys(input)) {
    if (key !== "repository" && key !== "run_id") {
      throw new GithubError("invalid", "The input has a field this command does not accept");
    }
  }
  const { repository, run_id: runId } = input;
  if (typeof repository !== "string" || repository.length > 140) {
    throw new GithubError("invalid", 'repository must be "owner/name"');
  }
  const parts = repository.split("/");
  const [owner, repo] = parts;
  if (
    parts.length !== 2 ||
    owner === undefined ||
    repo === undefined ||
    !OWNER_RE.test(owner) ||
    !REPO_RE.test(repo)
  ) {
    throw new GithubError("invalid", 'repository must be "owner/name"');
  }
  if (typeof runId !== "number" || !Number.isSafeInteger(runId) || runId < 1) {
    throw new GithubError("invalid", "run_id must be a positive integer");
  }
  return { owner, repo, runId };
}

/** The exact URL the POST goes to, built only from validated parts. */
export function ciRerunUrl(owner: string, repo: string, runId: number): string {
  return `${CI_RERUN_ORIGIN}/repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`;
}

/**
 * Asks GitHub to re-run the failed jobs of one run. Resolves only on a 201. Throws GithubError
 * with a fixed message otherwise. The caller must already hold the user's confirmation.
 */
export async function rerunFailedJobs(
  input: unknown,
  options: CiRerunOptions,
): Promise<CiRerunResult> {
  const { owner, repo, runId } = parseCiRerunInput(input);
  const { token } = options;
  if (token === undefined || token === "") {
    throw new GithubError(
      "auth",
      `No ${CI_WRITE_TOKEN_SECRET} is set. Re-running CI needs its own token with Actions write access; the read token is never used for writing`,
    );
  }
  if (!WRITE_TOKEN_RE.test(token)) {
    throw new GithubError("auth", `The ${CI_WRITE_TOKEN_SECRET} is not a usable token`);
  }
  let res: Response;
  try {
    res = await fetch(ciRerunUrl(owner, repo, runId), {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "phoenix-github-capability",
        authorization: `Bearer ${token}`,
      },
      redirect: "error",
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(CI_RERUN_TIMEOUT_MS)]),
    });
  } catch {
    throw new GithubError("network", UNKNOWN_OUTCOME);
  }
  if (res.status !== 201) {
    await res.body?.cancel().catch(() => {});
    if (res.status >= 300 && res.status < 400) {
      throw new GithubError("invalid", "GitHub answered with a redirect, which is not followed");
    }
    const known = FAILURES[res.status];
    if (known) throw new GithubError(known.kind, known.message);
    throw new GithubError(
      "http",
      res.status >= 500
        ? `GitHub answered HTTP ${res.status}; the re-run may or may not have been requested. Check the run on GitHub before asking again`
        : `GitHub answered HTTP ${res.status}`,
    );
  }
  // The reply is read within the cap and must be empty or one JSON object, and is then dropped:
  // nothing GitHub wrote reaches the result.
  let readable = true;
  try {
    const text = await readCapped(res, CI_RERUN_MAX_REPLY_BYTES, CI_RERUN_TIMEOUT_MS);
    if (text.trim() !== "") readable = isRecord(JSON.parse(text));
  } catch {
    readable = false;
  }
  if (!readable) {
    throw new GithubError(
      "invalid",
      "GitHub answered 201 with a reply Phoenix could not read; the re-run was probably requested. Check the run on GitHub before asking again",
    );
  }
  return { status: "requested", repository: `${owner}/${repo}`, run_id: runId };
}

/** What the verify step saw when it re-read the run after the call. */
export interface CiRerunVerification {
  /** False when the re-read failed; the re-run request itself still stands. */
  checked: boolean;
  run_status?: string;
  run_conclusion?: string | null;
  attempt?: number;
  /** True only when the run is no longer `completed` (GitHub shows it queued or running again). */
  rerun_observed?: boolean;
  note: string;
}

/**
 * Verify step: re-reads the run with the READ client (GET only; the write credential is never
 * used here) and reports its status. GitHub may still show the old `completed` state for a short
 * while, so `rerun_observed: false` means "not seen yet", never "failed". A failed re-read is
 * reported as `checked: false` with a fixed note: it never turns a requested re-run into an error.
 */
export async function verifyRerun(
  http: GithubClient,
  repository: string,
  runId: number,
): Promise<CiRerunVerification> {
  try {
    const got = await http.get(`/repos/${repository}/actions/runs/${runId}`, parseRunDetail);
    const run = got.value;
    if (!run || run.id !== runId) {
      return { checked: false, note: "The run could not be read back after the request" };
    }
    const observed = run.status !== "completed";
    return {
      checked: true,
      run_status: run.status,
      run_conclusion: run.conclusion,
      attempt: run.attempt,
      rerun_observed: observed,
      note: observed
        ? "GitHub shows the run as started again"
        : "GitHub still shows the run as completed; it may not have updated yet. Check again shortly",
    };
  } catch {
    return { checked: false, note: "The run could not be read back after the request" };
  }
}
