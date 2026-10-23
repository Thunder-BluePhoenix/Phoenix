# Handoff notes and the secret guard (Phase 79)

Two features for people who hand work between coding agents and between themselves.

- **Secret guard**: a hook, installed next to Phoenix's other agent hooks, that stops an agent from putting a
  secret into a tool call or into a `git commit` / `git push`.
- **Handoff notes**: a short, boring summary of what an agent session did, to paste into a commit message, a PR
  description or a task.

Everything here is built and tested against **simulated** inputs only (fake secrets built at runtime, fake agents,
scripted model providers, a fake GitHub command). Nothing has been run against a real Claude Code, a real Codex, a
real model or a real pull request. See [What is not proven](#what-is-not-proven).

## Secret guard

### Install

The guard is one more script, `capabilities/agents/src/guard-hook.ts`, written through the same
preview / hash / apply installer as every other hook (`capabilities/agents/src/relay/**`). Install, repair and
uninstall keep the user's own hooks: only entries whose command runs Phoenix's `guard-hook.ts` are Phoenix's, and a
user hook that merely mentions the name is left alone.

- **Claude Code**: a `PreToolUse` group with **no matcher**, so it sees every tool's input.
- **Codex**: a `PreToolUse` entry written the same way. That wiring is **unverified** against a real Codex build.

The deny output follows the documented hook contracts: the script exits `0` and prints one JSON line with
`hookSpecificOutput.permissionDecision: "deny"` and a reason
([Claude Code hooks](https://code.claude.com/docs/en/hooks), [Codex hooks](https://developers.openai.com/codex/hooks)).
It never prints `allow`, so the agent's own permission prompt is not bypassed.

`phoenix-agent claude-hooks` / `codex-hooks` (the printers for people who edit config by hand) include the
guard as a `PreToolUse` group with no matcher, as the installer does. `--no-guard` leaves it out. The installer and
the printers build the group from the same function, so they cannot drift apart. The printed Codex block was checked
against the documented shape only, never run in a real Codex.

### What it looks at

- Every string in the tool input (keys such as `old_string` are skipped: they are what the agent is replacing).
- For `git commit` and `git push`: the **added lines** of the staged diff (commit) or of the unpushed commits (push).
  Findings name the file and line.
- If the same command also stages (`git add ...`, `commit -a`), the hook runs before the command, so it scans the
  working tree (changes against HEAD plus untracked files) instead. That is a superset of what will be committed, so
  it can block more than the commit would contain.
- A diff row `+++ <text>` is a file header only before the first `@@` of a file; inside a hunk it is an ordinary added
  line (whose content starts with `++ `) and is scanned like any other.
- `git push` scans `@{u}..HEAD` when the branch has an upstream. Without one (a first push), it falls back to
  `git log -p HEAD --not --remotes` (at most 200 commits): every commit no remote-tracking branch has. If neither
  range can be resolved, stderr says so and only the staged changes and the tool input are scanned.
- Which commands count as `git commit` / `git push`: the word `git` after whitespace, a shell operator, a quote or a
  path separator, so `git commit`, `FOO=1 git -C d commit`, `/usr/bin/git commit`, `bash -c "git commit -m x"`,
  `sh -c 'git push'` and `eval "git push"` are recognised, while `digit commit` and `legit push` are not. **Not
  recognised, by design:** an alias (`git ci`), a script (`./release.sh`), a task runner (`make push`) or any wrapper
  that commits or pushes on the agent's behalf. For those the tool input is still scanned, but no diff is gathered.
  The command is read in full whatever its length; a very long command that mentions `commit` or `push` still
  gathers the staged diff.

Detector kinds: `bearer_token`, `github_token`, `api_key`, `slack_token`, `aws_access_key`, `private_key`,
`stripe_key` (live `sk_live_` / `rk_live_` keys; test-mode keys are deliberately not matched), `gitlab_token`
(`glpat-`), `npm_token` (`npm_` plus 36 characters), `jwt` (three dot-separated parts, the first two starting
`eyJ`), and the
guard-only `secret_assignment` (a secret-named variable assigned a long random-looking value). These are heuristics:
they miss secrets that look like ordinary text and can flag test fixtures.

### What the explanation says

The reason names the **kind and the place** (for example `github_token in tool_input.command` or
`private_key in config/app.pem line 12`). It never contains the matched text. A location that itself looks like a
secret is replaced with `[hidden: looks like a secret]`. Core refuses any report where it finds a secret in a field.

### Fail closed or fail open

| Situation                                                                                                                                                                        | Result                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A secret was found                                                                                                                                                               | **Blocked** (closed).                                                                                                                                                       |
| The hook's stdin is longer than 4,000,000 bytes                                                                                                                                  | **Blocked** (closed) with a reason; no override card (nothing complete to bind it to).                                                                                      |
| The tool input is longer than the scan limit (1,000,000 characters, or more than 200 list items, or nested deeper than 8 levels) and nothing was found in the part that was read | **Blocked** (closed) with a reason; no override card. The agent is told to split the work.                                                                                  |
| A staged diff longer than the scan limit, or git output past its buffer                                                                                                          | Scanned up to the limit; **allowed** if nothing is found there, with a stderr note (a large honest commit stays possible).                                                  |
| `git push` range cannot be resolved                                                                                                                                              | Staged changes and tool input are scanned; allowed if clean, with a stderr note.                                                                                            |
| The hook crashed before deciding, the payload was unreadable or not a PreToolUse event, git could not be read                                                                    | Allowed (open), with a note on stderr.                                                                                                                                      |
| The hook's hard deadline (the override card's lifetime plus 2 s) passes while it is still working                                                                                | The process exits `0` with no output: allowed (open). A card that nobody answers keeps the block, because the deny line is printed when the card ends, before the deadline. |
| Phoenix Core is down                                                                                                                                                             | The block still stands; the result report and the override card are skipped.                                                                                                |

Failing open on our own errors is a deliberate trade-off: a guard that bricks every tool call when it has a bug would
be switched off by the first person it annoyed. A found secret never fails open, and neither does input whose size
the agent itself chooses (oversize stdin, an oversized tool input): padding must not hide a secret.

### Override

The only way past a block is the owner. The hook creates a Phase 56 approval card (`tool: "SecretGuard"`). The card's
`input_summary.detail` carries `{"blocked_tool", "content_hash", "session_id"}`, a SHA-256 of the scanned content and
the agent's session, so the approval covers **that** content in **that** session and nothing else: a different call gets a different hash and a new card. The hook honours an
answer only if `behavior` is `allow` **and** `decidedBy` is `user`; a rule or policy allow does not count, a deny or
no answer (timeout, Core down, no session id to ask against) keeps the block.

### Audit

The hook reports every block, override and scanned-and-clean commit/push to `POST /api/secret-guard/result`
(`blocked`, `overridden`, `allowed`). The body is outcome, agent, session, tool, findings (kind and place), content
hash and scope, nothing else. Core validates every field, refuses any payload that contains a secret, and accepts an
`overridden` report only if the audit log holds a matching `agent_approval.resolved` row for tool `SecretGuard`: same
agent, `allow`, decided by the user, same content hash, same session id, and an approval id that no earlier override
has used (**one approval proves one override**; the id is stored in the override's audit row, so a replay is refused
after a restart too). `blocked` and `allowed` reports are limited to 60 per minute; beyond that Core answers
`PERMISSION_DENIED` and records nothing (an `overridden` report is bounded by the owner's approvals instead). It writes `secret_guard.blocked`, `secret_guard.overridden`
or `secret_guard.allowed`. `GET /api/secret-guard` returns counts and the most recent rows from the same audit log.

## Handoff notes

### What a note is

A note is generated **without a model** from what the agent reported through the live-session routes: the task title
as the goal (only when the agent reported one), changed files with +/- counts, de-duplicated commands, and open
questions from pending approvals. Commands are redacted and any line that still looks like a secret is hidden. Paths
inside the project are made relative and a path outside it is shown by file name only. The note says it was built
from what the agent reported, not checked against the repository. Names go into Markdown as code spans that cannot be
closed from inside.

Notes are written when you ask (`POST /api/handoff/notes`) and, unless turned off, when the agents capability
reports `agent.ended` for a session (`trigger: "auto"`; once per unchanged session; events from other sources are
ignored; this includes the task text used as the goal, which is only read from `agents`-source events).

### Storage

`<dataDir>/handoff/hn_<id>.json`: directory `0700`, files `0600`, written atomically, at most 50 notes of at most
64 KiB (oldest dropped), and files that are not Phoenix's own are never touched or listed. A hand-edited file that no
longer validates is not served. Privacy kind `handoff` (delete-all with `{ "data": "handoff", "confirm": true }`) and
inventory row `handoff_notes`. Settings key `handoff.settings`: `auto` (default on) and `allow_cloud` (default off).
Nothing is written while the emergency stop is engaged.

### Optional model summary

`POST /api/handoff/notes/:id/summary` asks the AI layer for a short summary of the already-redacted note text.

- By default the request is classed `sensitive`; the AI gate then only lets it reach Ollama running on this device.
  A cloud provider is refused even when every AI grant is on.
- With `allow_cloud` the request is `internal`, and a cloud provider still needs the user's own AI settings and
  grants.
- Belt and braces: if an answer comes back from a non-local provider while cloud is not allowed, it is **discarded**
  (`SECURITY_POLICY_BLOCKED`).
- The reply is stored with control characters removed, secrets redacted, risky lines dropped and a length bound, and
  is labelled with the provider, model and where it ran.

### Attach

Every attach is a preview first. Confirming needs the preview's hash, which covers the note, target and repository,
so a changed note (for example a summary added after the preview) makes it stale. The text is scanned for secrets
again before it is shown or handed back.

| Target                   | What confirm does                                                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commit message           | Hands the text back to copy. Phoenix never runs `git commit`.                                                                                                                            |
| Pull request description | Copy only, shown as **not wired**: Phoenix has no command that edits a PR.                                                                                                               |
| Task                     | Creates a GitHub issue through the existing `github` `issue.create` command and the permission gateway (it confirms and needs the write token), with idempotency key `handoff-<noteId>`. |

The approval card for the task target is the github capability's own `issue.create` card. Its schema flags
`repository` and `title` with `x-phoenix-confirm`, so the card names the repository and the issue title (clipped to
80 characters from the front). The **body is not shown on the card**; it was shown in full in the attach preview whose
hash the confirmation is bound to.

Each attach is audited with the note id, target and delivery, never the text.

### Web

Settings has a Handoff notes section (`HandoffNotes.tsx`): the list, a note with its text, summary on request, the
attach preview/confirm flow, the two settings, delete, and the guard's counts and recent rows. All text is rendered
as text.

## What is not proven

- No real Claude Code or Codex run has loaded this hook; the deny shape and the Codex `PreToolUse` wiring come from
  the published docs and are unverified.
- The exit criterion "a planted test secret in an agent's commit is blocked" is **unmet**: it is covered with a
  simulated hook payload in a temp git repository, not by a real agent attempting a commit.
- The exit criterion "a note is attached to a real PR" is **unmet**: PR attach is copy-only, the task path is a
  fake `issue.create`.
- Detectors are heuristics. The guard is a safety net, not a guarantee, and it is bypassed by a command run outside
  an agent with the hook installed.
- **The guard is not tamper-resistant.** An agent that can edit its own hook configuration (for example
  `~/.claude/settings.json`) or the Phoenix checkout can remove or change the hook. The detector has ten value patterns
  plus one assignment rule; a secret it does not recognise (Stripe test keys, GitLab deploy tokens, PyPI or cloud
  tokens other than AWS access keys) is not blocked.
- **The override card text is partly attacker-chosen.** It names finding kinds and locations (file names and line
  numbers from the agent's own diff or tool input). Locations are cleaned of control characters and anything that looks
  like a secret, and are clipped, but a file name can still say something misleading. The decision is bound to the
  content hash and session, not to the wording.
- **The `agent.safety.*` namespace is closed for capability manifests and publishing** (see
  [agent-safety-net.md](agent-safety-net.md#reserved-namespace-agentsafety); simulation only). `POST /api/events`
  still refuses a fixed list of Core-only types, and an external capability whose manifest declares other `agent.*`
  types is now refused too, because `agent.*` could cover the reserved names. Handoff notes only trust
  `agents`-source events for goals and session ends.
- Redaction (`redactSecrets`) cuts any run of more than 256 word characters to its last 256 before matching, to keep
  its cost linear on hostile input; git diff text is cut to 250,000 characters and each line to 2,000 before it
  reaches the redactor.
