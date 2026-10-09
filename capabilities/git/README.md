# capabilities/git

Watches local repositories you select and emits `git.*` events ([Phase 17](../../docs/phases/phase-17-git-capability.md)).
Read-only: it only runs `git status` and `git log` (the `recent_commits` command uses `git log` only), with `GIT_OPTIONAL_LOCKS=0` so it never takes the index lock.

| Event                                                | When                                     | Fawkes                 |
| ---------------------------------------------------- | ---------------------------------------- | ---------------------- |
| `git.commit.created`                                 | HEAD moves on the same branch            | activity feed          |
| `git.branch.changed`                                 | branch switch or detached HEAD           | activity feed          |
| `git.working_tree.dirty` / `.clean`                  | first uncommitted change / back to clean | activity feed          |
| `git.merge_conflict` / `git.merge_conflict_resolved` | unmerged paths appear / disappear        | WARNING until resolved |

Commit messages are secret-redacted and truncated to 200 characters. Repository status shows in the Pet Panel under the capability's health.

## Selecting repositories

```sh
TOKEN=$(cat .phoenix/dev/session.token)
curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"config":{"repositories":["/absolute/path/to/repo"],"poll_ms":2000}}' \
  http://127.0.0.1:4870/api/capabilities/git/config
curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4870/api/capabilities/git/enable
```

Enabling grants `repository_access`. Change the list by disabling, reconfiguring and enabling again.

## `recent_commits` command (read-only)

Tool name `git.recent_commits`; side effect `read`, permission `repository_access` (nothing added). Input (`additionalProperties: false`):

```json
{ "repo_path"?: "/absolute/path/of/a/watched/repo", "limit"?: 1..50 (default 10), "path_filter"?: "relative/path", "ref"?: "<7-40 hex>" }
```

`ref` starts the listing at that commit and returns only it and its ancestors (the commits that led to it). It must be 7 to 40 hexadecimal characters, nothing else, so it cannot be read as an option, a branch, a revision range or a path. The output then carries `ref: { requested, found }`; when the commit is not in the repository `found` is false and `commits` is empty. Each commit also has `committer_date` (when it was applied here; it differs from `author_date` after a rebase or cherry-pick).

`repo_path` must be one of the configured `repositories` (otherwise the command fails); it may be omitted when exactly one repository is watched. `path_filter` is a repository-relative path of at most 200 characters, without a leading `-`, control characters, absolute path or `..` segment, and is passed to git after `--` as a literal pathspec.

Output:

```json
{
  "repository": "repo-dir-name",
  "ref": { "requested": "<hex>", "found": true },
  "commits": [
    {
      "sha": "<40 hex>",
      "short_sha": "<7 hex>",
      "subject": "…",
      "author_date": "2026-10-09T09:08:00.000Z",
      "committer_date": "2026-10-09T09:08:00.000Z",
      "files_changed": 12,
      "files": ["path", "…"]
    }
  ],
  "truncated": false
}
```

Subjects are secret-redacted and clipped to 200 characters; `files` lists at most 30 paths (200 characters each) while `files_changed` counts all of them (0 for merge commits). Author names and emails are never returned. An empty repository gives `commits: []`. The only process started is `git --no-pager --literal-pathspecs … log --no-color --name-only -n <limit+1> --end-of-options [<ref>] [-- <path_filter>]` (with `ref` it first runs `git cat-file -e <ref>^{commit}`) (no shell); `truncated` is true when more commits exist.
