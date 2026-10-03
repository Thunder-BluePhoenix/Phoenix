# capabilities/git

Watches local repositories you select and emits `git.*` events ([Phase 17](../../docs/phases/phase-17-git-capability.md)).
Read-only: it only runs `git status` and `git log`, with `GIT_OPTIONAL_LOCKS=0` so it never takes the index lock.

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
