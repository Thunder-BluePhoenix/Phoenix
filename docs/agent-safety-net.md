# Agent safety net (Phase 77)

Checkpoints before a coding agent's first edit, a one-click rollback with preview and approval, and
warnings when an agent loops or stalls. Everything is local: no network, no AI, no new dependency.

> **Status.** Built and tested against temp git repositories and scripted fake steps only. The exit
> criterion "a real agent session is rolled back exactly to its checkpoint" is **not met**: no real
> Claude Code or Codex session was ever run. "A simulated loop and stall each raise a warning" is
> met in simulation only (`core/runtime/test/agent-safety-detectors.test.ts`).

## When is the checkpoint taken? (read this)

Claude Code reports steps from its **PostToolUse** hook (`capabilities/agents/src/claude-hook.ts`
maps `PostToolUse` to a step; `claudeHooksConfig` in `claude.ts` keeps `PreToolUse` for
`AskUserQuestion` approvals only, "so a tool is not counted twice"). A step therefore reaches Core
**after the tool ran**, so the first edit has already been applied when Phoenix hears about it.

So the checkpoint is **taken at the first report of an edit**:

- the first edit of the session is normally **already inside** the snapshot;
- rolling back restores the project to _just after the agent's first edit_, undoing everything the
  agent did afterwards, not that first edit itself;
- a project's own uncommitted work that existed before the agent started is in the snapshot too, so
  rolling back never discards it, but it also cannot separate "the agent's first edit" from it.

Taking the snapshot _before_ the first edit would need a `PreToolUse` hook on edit tools, which would
change the hook installers (not part of this phase). If the agent made several edits between two
reports, or Phoenix started after the session did, the snapshot is later still. Codex steps are
reported through its own adapter and have the same property.

## What a checkpoint is

A commit under `refs/phoenix/checkpoints/cp_<16 hex>` in **the project's own repository**, built
without touching anything of the user's:

1. a temporary index file in a fresh temp directory (`GIT_INDEX_FILE`), filled with `git read-tree
HEAD` and `git add -A` (modified, deleted and untracked files; ignore rules apply, nothing is
   forced);
2. `git write-tree`, then `git commit-tree` with a fixed author (`Phoenix <phoenix-safety@localhost.invalid>`)
   and HEAD as parent;
3. `git update-ref refs/phoenix/checkpoints/<id> <commit>`.

The only writes into `.git` are new objects and that one ref. The user's branches, HEAD, index
(including staged changes), stashes, config and working tree are not touched (asserted byte-for-byte in
the tests). Every git call is `execFile` with an argv array (never a shell), from a neutral working
directory, with no system/global git config, `core.hooksPath=/dev/null`, `core.fsmonitor=false` and every
`clean`/`smudge`/`process` filter the repository defines switched off.

Metadata (agent, session id, project path, ref, commit, HEAD at that time, file count, expiry) lives in
`agent_checkpoints` (migration 31). **No file name and no file content** is stored there; the API shows
the project's folder name, never its path.

### What is and is not saved

- Saved: tracked files with their current content (including uncommitted edits), deleted-tracked files
  as deleted, **untracked files**.
- **Not saved: anything git ignores** (`.gitignore`, `.git/info/exclude`, and the user's global
  `~/.config/git/ignore` if present): build output, logs, `node_modules`. Rollback never restores or
  deletes such files either. A tracked file that matches an ignore rule is still saved (it is in HEAD).
- Non-git folders: no checkpoint; the UI lists the session with "not a git repository".
- Size guard: a project above `max_files` (default 20 000) or `max_bytes` (default 512 MiB) is skipped
  and reported in the UI ("too many files" / "too large"). Nothing is written when skipped.
- One checkpoint per `(agent, session_id)`, at its first edit step. Disabled while the kill switch is on.
- Volume limits: at most **one checkpoint per project per minute** (a further first edit in the same project within
  a minute is skipped and listed as "throttled"; the clock is Core's, injected in tests) and at most **50
  checkpoints** in total: after each new one the oldest rows are removed, ref first, with the same exact-ref guard
  as pruning.
- Objects stay in `.git/objects` until git's own garbage collection removes them after the ref is gone.
  A snapshot contains file contents, **including secrets in untracked files**; it lives in the project's
  own repository, readable by whoever reads that repository. Delete-all (below) removes the refs.

## Rollback

`GET /api/agent-safety/checkpoints/:id/preview` compares the checkpoint's tree with the working tree
as it is _now_ (built in a temp index the same way) and returns names, counts and a bounded, redacted
diff (git's output is cut to 250 000 characters and each line to 2 000 before `redactSecrets`, control characters
stripped, then cut at 200 000 characters), plus
`preview_hash`: SHA-256 over the checkpoint, HEAD, both trees and the exact file lists.

`POST /api/agent-safety/checkpoints/:id/rollback {"preview_hash": "..."}`:

1. rebuilds the plan; **refuses** if the hash differs (`preview_stale`), before the owner is asked;
2. asks the owner through the permission gateway: capability `agent-safety`, command
   `checkpoint.rollback`, side effect `execute`, the summary names the project, time, counts and the
   hash prefix. The request waits for the confirmation card; rejecting it changes nothing;
3. **recomputes the plan after approval** and refuses again on any difference (a file that changed while
   the owner was deciding);
4. restores **only paths that differ**, with `git checkout-index` from a temp index holding the
   checkpoint tree (the user's index is never read or written);
5. deletes a file that did not exist at the checkpoint **only if** it is listed in the preview, is not
   tracked by HEAD, is not matched by an ignore rule, and is a regular file or symlink. Directories
   are never removed (empty directories may remain);
6. never touches `.git`, never resets HEAD, a branch, the index or a stash; paths with `.git`
   components, `..`, absolute paths, submodules and paths below a symlinked directory are kept out of the
   plan ("left alone" in the preview).

**HEAD moved ⇒ refusal.** If HEAD is no longer the commit the checkpoint was taken on (the agent
committed, or the branch changed) the preview reports `head_moved`, offers no hash and no rollback, and
the API refuses. Phoenix does not try to undo commits, `reset`, or rewrite history; use git for that.

The result and the outcome are audited (`action.authorized`, `action.succeeded` / `action.failed`
with checkpoint id, counts and hash prefix; no file names). `exact` in the result says whether the working
tree now equals the checkpoint's tree (it is `false` when some differences were deliberately left alone).

File names and the project folder name shown in the preview and in the confirmation summary have control, format
(bidi overrides such as U+202E, zero-width) and line/paragraph separator characters replaced by `?`.

Limits: file modes and symlink targets follow `checkout-index`; a file that is not writable, or a rollback
interrupted halfway (power loss), can leave the tree partly restored (`apply_failed` is reported); the
preview then shows the remaining difference. Two rollbacks of one project cannot run at once.

## Retention and deletion

- Default **7 days** (`retention_days`, 1–365). Expired checkpoints (ref, then row) are pruned at Core
  start, hourly (the runtime's maintenance timer) and after each new checkpoint; the 50-checkpoint cap is applied at
  the same moments.
- Pruning deletes **only** refs that match exactly `refs/phoenix/checkpoints/cp_<16 hex>` _and_ equal the
  row's own id. A tampered database row naming `refs/heads/main`, a tag, `refs/stash` or a path with `..`
  deletes nothing but the row (tested).
- If the repository cannot be reached when a ref should go (git missing), the row is kept and retried.
- Privacy: `POST /api/privacy/delete {"data":"agent_checkpoints","confirm":true}` removes the rows now and
  the refs they named in the background; refs that could not be removed yet are kept on a retry list
  (setting `agents.safety.orphans`, retried hourly). The inventory lists `agent_checkpoints` with its
  count.

## Loop and stall detection

Pure detectors (`detectors.ts`, injected clock) fed from events Core already publishes:
`agent.session.step`, `agent.approval.requested/resolved`, and the `agents` capability's
`agent.waiting/working/completed/failed/ended`. Only events from the right source are read (a look-alike
from another source is ignored).

What hooks actually report limits what can be seen:

| Detector       | Rule                                                                                                                   | Honest limit                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Loop: command  | the same `run` target N times in a row (default **3**); another command ends the streak; reads/edits in between do not | steps carry **no exit code**, so "the same _failing_ command" is "the same command again and again"                                                                                  |
| Loop: file     | consecutive edits of one file whose line counts swap (+a −r, then +r −a) N−1 times                                     | only line **counts** are known, never content; equal-sized or `Write` edits are invisible; per-step counts come from the cumulative totals and are used only when no edit was missed |
| Stall: waiting | an agent waiting on the user (approval request, `agent.waiting`) for more than **10 min**                              | an approval that names no session is matched to that agent's latest session in the same project                                                                                      |
| Stall: idle    | an active session (not finished/ended, not waiting) silent for more than **30 min**                                    | silence is measured from Core's clock at the last report                                                                                                                             |

Each finding raises **one** WARNING event per episode (dedup: a pattern warns again only after it
breaks or the session moves): `agent.safety.loop` / `agent.safety.stall`, source `core`, severity
`warning`, subject `agent-safety`, payload `{agent, session_id, kind, reason, repository}` (reason
redacted, commands clipped to 80 characters). Core-only: `POST /api/events` refuses these types.

- **Pet state.** Two state rules (added through `StateEngine.addRules`, the default mapping is untouched)
  map both events to Fawkes `WARNING` with the reason as explanation, for 10 minutes.
- **Notification.** The existing `NotificationService` notifies on every `warning` event once
  (`min_severity` defaults to `warning`). The `notify` setting adds or removes `agent-safety` from the
  notification preferences' muted sources; muting stops the notification, not the pet state or the event.
- Settings (`POST /api/agent-safety/settings`, validated, unknown keys refused): `enabled`, `notify`,
  `retention_days`, `max_files`, `max_bytes`, `loop_threshold` (2–20), `waiting_min`, `idle_min`.

## API

| Route                                             |                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/agent-safety`                           | settings, kill switch, checkpoints (newest 100), sessions that got none and why |
| `POST /api/agent-safety/settings`                 | partial update                                                                  |
| `GET /api/agent-safety/checkpoints/:id/preview`   | plan, hash, bounded diff                                                        |
| `POST /api/agent-safety/checkpoints/:id/rollback` | `{preview_hash}`; waits for the owner's approval                                |

A Core-only ephemeral `agent.safety.checkpoint` event (taken/skipped, names only) keeps open screens
fresh. The UI is `AgentSafety.tsx`, a section on the Agent sessions page.

## Files

`core/runtime/src/agent-safety/{git,checkpoints,rollback,detectors,settings,service,index}.ts`,
`core/persistence/src/checkpoint-store.ts`, `core/api/src/safety-routes.ts`,
`apps/web/src/components/AgentSafety.tsx`, `apps/web/src/core/safety.ts`, i18n namespace `safety`.

## Not verified / known gaps

- No real agent session, no real Claude Code/Codex hook, no real rollback of an agent's work.
- The checkpoint comes after the first edit (see above).
- Symlinks below the project root are refused in the plan, but a race between planning and writing
  (another process swapping a directory for a symlink) is not defended beyond the recomputed hash.
- Windows and Linux were not exercised; the git plumbing is portable but only macOS was run.
- Submodule contents, git LFS pointers and sparse checkouts are not specially handled.
- The `agent_checkpoints` table has no column for the retry list; it lives in a setting.
- **The warning card text is partly attacker-chosen.** Loop and stall reasons contain the agent's own command or file
  name (redacted and clipped, but chosen by the agent); the rollback summary names the project folder, cleaned of
  hidden characters but chosen by whoever created the folder.
- **Reservation of `agent.safety.*` events is incomplete for external capabilities.** `POST /api/events` refuses
  `agent.safety.loop|stall|checkpoint` from any poster, but an external capability that declares `agent.*` events in
  its manifest can emit other `agent.*` types that this service reads only when their source is the right one.
- The safety net is not tamper-resistant: an agent that can run `git update-ref -d` on its own checkpoint ref, or edit
  Core's database, removes its own checkpoint. It protects against mistakes, not a hostile agent.
