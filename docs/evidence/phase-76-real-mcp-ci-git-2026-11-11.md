# Phase 76: `phoenix_ci_git_state` through the real git and GitHub capabilities (2026-11-11)

Test: `core/runtime/test/real-mcp-ci-git.test.ts` (guard `PHOENIX_REAL_MCP_CIGIT=1`), run once under Node v22.19.0. Raw data: `phase-76-real-mcp-ci-git-2026-11-11-raw.json`.

## What ran

- A temporary git repository (`demo-repo`): 3 commits, branch `feature/x`, the last commit subject `touch /Users/someone/secret-project/file.txt`, one modified tracked file, one untracked file.
- A real in-process Core with the real `createGitCapability()` and `createGithubCapability()`, `git.repositories = [<temp repo>]`, `github.repositories = [Thunder-BluePhoenix/Phoenix]`, both enabled through `POST /api/capabilities/:id/config` and `/enable`. In-memory secret store: no token existed and none was read (`authorization_header_sent: false` on every GitHub request).
- The production MCP route: `POST /api/mcp/settings`, `POST /api/mcp/clients`, grant `tools: ["phoenix_ci_git_state"]` only. Over real loopback HTTP JSON-RPC: `initialize`, `notifications/initialized` (202), `tools/list`, `tools/call phoenix_ci_git_state`.
- **The caller was the in-repo JSON-RPC client, not a real MCP client with a model.**
- GitHub: a recording fetch wrapper allowed only `GET` to `https://api.github.com` (throws otherwise, budget 5). 3 requests were sent (`actions/runs`, `pulls`, `deployments`), all HTTP 200, `x-ratelimit-remaining` 56 → 54. Not rate-limited this run. Nothing was refused.

## Tool result (`untrusted_data`)

```json
{
  "git": {
    "available": true,
    "data": {
      "repositories": [
        {
          "branch": "feature/x",
          "head": "9b3beeb13efec2e7b806a47629a9e2345696eed9",
          "changed": 2,
          "name": "demo-repo",
          "conflicts": []
        }
      ]
    }
  },
  "github": {
    "available": true,
    "data": {
      "authenticated": false,
      "repositories": [
        {
          "repository": "Thunder-BluePhoenix/Phoenix",
          "latest_run": {
            "run_id": 42968069913,
            "workflow": "CI",
            "status": "in_progress",
            "conclusion": null,
            "branch": "main",
            "url": "https://github.com/Thunder-BluePhoenix/Phoenix/actions/runs/42968069913"
          },
          "open_pull_requests": 0,
          "pull_requests_truncated": false,
          "checked_at": "2026-11-11T05:53:33.339Z"
        }
      ]
    }
  }
}
```

- git.status: 1 repository, name `demo-repo`, branch `feature/x`, `changed: 2` (modified + untracked), no conflicts.
- github.status: unauthenticated, default branch not reported by this command; latest CI run is `CI` on `main`, `in_progress` at that moment; 0 open pull requests.
- Leak checks (all false): temp-repo path, its realpath, the tmpdir prefix, `/Users`, the commit subject text and its path, a `path` key, a `title` key, the MCP client token, `bearer`, a GitHub token shape. The result carries no pull request title (there were no open PRs, so this is not a test of title handling).
- Policy engine: two `policy.decision` rows, `effect: allow`, `risk: low`, `trustedByUser: false`, `sideEffect: read`, actor `agent:mcp:<client>`, matched `builtin:baseline` (`git.status` id 7, `github.status` id 11), each followed by `tool.succeeded`.
- Audit rows for the call: `mcp.session.started`, `mcp.call` (`allowed`, `ok: true`, `ms: 2252`), plus the policy and tool rows above.

## Second call without the grant

A second client holding only `phoenix_activity`: `tools/list` returned `["phoenix_activity"]`; `tools/call phoenix_ci_git_state` returned JSON-RPC `-32602 "Unknown tool"` (same as an unknown tool), audit `mcp.call.denied` with `reason: not_granted`, and no further GitHub request (still 3).

## Findings

No leak found: no source change was needed and `docs/mcp-server.md` already says what happened (folder name only, untrusted agent actor, audited).

Limits: the commit subject is not part of `git.status`, so this run does not exercise subject redaction; the one GitHub repository was public with 0 open PRs; unauthenticated GitHub could have been rate limited (60/hour) but was not; a single run, no repetition.
