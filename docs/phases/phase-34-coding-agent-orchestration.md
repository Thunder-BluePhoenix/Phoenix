# Phase 34 — Coding-Agent Orchestration

| Field | Value |
|---|---|
| Stage | Stage 5 — Developer-Agent Orchestration (v0.5) |
| Release target | v0.5 |
| Priority | High |
| Status | 🟨 Built and verified against a fake agent and a real Core; **never run against a real coding agent**; the v0.5 release is not cut |
| Depends on | [Phase 33 — AI Evaluation Harness & v0.4 Release](phase-33-ai-evaluation-harness.md), [Phase 25 — Coding-Agent Lifecycle Events](phase-25-coding-agent-lifecycle-events.md) |
| Unblocks | — |

## Goal

Coordinate existing coding agents through Phoenix rather than replacing them.

## Scope

**In scope**

- External agent as capability
- Track workspace, lifecycle, waiting states
- Link agent output to commits, tasks, CI
- Provide authorised context to agents
- Audit trail

## Tasks

- [x] Promote coding-agent adapter to full capability with commands — `session.start|send|stop|list|get`, `context.handoff`, `context.fetch`, `link.resolve` on the existing `agents` capability
- [x] Correlate agent sessions ↔ commits ↔ CI runs — by workspace path, time and branch, with the reason stored on every link (`correlation_id` names the session in the lifecycle events; the links themselves are rule-based, see below)
- [x] Hand authorised context to agents through tool gateway — `context.handoff` reads `agents.context.fetch` through `ToolGateway` as an `agent` actor named after the session
- [x] Handoffs between capabilities (agent → git → CI) — `agent.handoff` event; nothing runs because of it
- [ ] Release v0.5 — **not done**: not part of this assignment

## Deliverables

- Agent orchestration capability (`capabilities/agents`, no new package)
- v0.5 release — not cut

## Exit criteria

- [x] ≥1 external agent represented as capability — the `agents` capability runs any launcher the user configures. Run for real with the **fake agent** (`capabilities/agents/testing/fake-agent.cjs`). The Claude Code launcher config below is **unverified**: `claude` was not run.
- [x] Agent actions permission-controlled — every command that starts, messages or stops an agent is `execute`, needs `shell_command` and always asks for confirmation (tested through the real `PermissionGateway`)
- [x] Agent output linked to commits/CI — a commit made by real git in the workspace and a CI run built from it were linked in a real runtime test (gate v0.5 → v0.6: **met for the fake agent**, not demonstrated with a real one)

## Implementation notes

**Where things are** (all inside `capabilities/agents/`, see [docs/capabilities/agents.md](../capabilities/agents.md) for the user-facing contract)

| File | Job |
|---|---|
| `src/launchers.ts` | Parses and validates the user's `launchers` config; checks the real files at start time; builds the minimal environment |
| `src/agent-supervisor.cjs` | Runs one agent in its own process group; stops the tree on SIGTERM, on grace-period expiry, and when Core dies (fd 3 lifeline) |
| `src/sessions.ts` | `SessionManager`: start, send, stop, bounds, waiting detection, history |
| `src/output.ts` | `OutputRing`: bounded, sanitised, redacted output buffer |
| `src/links.ts` | `LinkStore` (migration 15, `agent_links`) and `Correlator` |
| `src/handoff.ts` | The session-scoped viewer, the second scope check, the quoted-data block |
| `src/orchestration.ts` | `Orchestrator`: ties the above to events, audit, the bus and the kill switch |
| `testing/fake-agent.cjs`, `testing/orphan-parent.ts` | The fake agent and the stand-in for Core used by the kill -9 test |

**Safety rules, each with a test (mutation-checked, see below)**

1. *Nothing runs without a confirmed command.* `session.start`, `session.send`, `session.stop` and `context.handoff` are `side_effect: "execute"` with `shell_command`. They pass through `PermissionGateway` like every capability command: a rejected start creates no process, no event and no `agent.session.*` audit record. The only things that run on their own are reads (`session.list`, `session.get`, `context.fetch`) and correlation of events that already happened.
2. *The launcher is configuration, never input.* `{ command: ["/abs/exe", ...fixed args], cwd_roots: [...], env_allow?, waiting_prompts?, stdin? }`. Absolute normalised path, not a shell (`sh`, `bash`, `zsh`, …), at most 32 args of 1000 characters, no control characters, no filesystem root as a `cwd_root`, no `*`. At start the executable is resolved with `realpath`, must be an executable regular file, not world-writable, not in a world-writable directory without the sticky bit; the workspace is resolved with `realpath` and must lie inside a `cwd_root` (symlinks cannot escape; `/root-evil` does not match `/root`). Launcher names are looked up with `Object.hasOwn`, so `constructor`/`toString` start nothing, and the command schema rejects `__proto__`.
3. *The prompt is never in argv.* It is written to the agent's stdin. A test builds a prompt full of shell metacharacters and checks the fake agent's own `argv` (it exits 9 if it sees the prompt there).
4. *No shell, minimal environment, process group.* The agent gets `PATH HOME USER LANG LC_ALL TMPDIR`, `TERM=dumb`, `NO_COLOR=1` and the launcher's `env_allow` names; never `PHOENIX_*`. `stop` is SIGTERM to the group, SIGKILL to the group after `grace_ms` (default 5000), and a hung supervisor is killed by Core after a further 3 s.
5. *No orphan survives Core.* `agent-supervisor.cjs` holds a lifeline (fd 3) to Core, which Core never writes to; when Core dies the OS closes it and the supervisor stops the whole tree. A test starts a stand-in Core in a subprocess, `kill -9`s it, and checks that the agent and a helper that ignores SIGTERM are both dead.
6. *Output is hostile data.* Kept only in memory in a ring of 500 lines × 2000 characters (cut lines say `…[cut]`), stripped of OSC/CSI escapes and control characters, redacted with the project's `redact()`, dropped when the session is evicted (20 finished sessions are kept) or the capability is disabled. It is never put into an event or an audit record. Fake JSON that looks like Phoenix events stays text in the buffer: a test checks that no event was created from it.
7. *Bounds.* `max_sessions` (default 3, max 10), `max_runtime_min` (default 120; the session ends `failed` with a clear reason), prompt ≤ 8000 characters, message ≤ 4000, 100 history entries per session.
8. *Kill switch.* `session.start` and `session.send` refuse while it is engaged, even for an already-confirmed command; the `security.kill_switch.engaged` event (source `core` only) stops every session and its processes; the capability manager also disables the capability. Disabling the capability does the same.
9. *Opt-in.* Orchestration commands answer `NO_LAUNCHER` until at least one usable launcher is configured; a bad launcher config is reported in `health()` (degraded) and in the refusal details; and the capability must be enabled by the user first (every capability is).

**Correlation (`agent_links`, migration 15).** A link says *this happened during that session*, never *that session wrote it*; every link stores the rule and its inputs in `why` and says so in words. Rules:

- `commit` (`time+path`): trusted source is `git` only (the manager forces `source` to the emitting capability's id). The repository path in the event must equal the session's workspace or lie inside it (`realpath`; `/ws-evil` is not inside `/ws`). The event must arrive after the session started and while it is active or within 2 minutes after it ended; the commit's own time (`git show -s --format=%ct`, no shell, hex sha only) must be at or after the second the session started and not later than the end (+1 s tolerance). **A commit older than the session start is never linked.**
- `ci_run` (`sha-match`): a `github.ci.*` event whose 7-character head commit is the prefix of a linked commit in the repository of the same name.
- `pr` (`branch-match`): a `github.pr.*` event whose head branch is the branch recorded on a linked commit (GitHub's PR events carry no head sha).
- **Ambiguity**: if more than one session qualifies (two active sessions in one workspace; a CI prefix matching commits of two sessions) the thing is linked to **neither**; one `ambiguous` row names the candidates and waits for `link.resolve`, which accepts only a candidate and then records `confidence: "user"`.
- Idempotent (unique index), so redelivery cannot duplicate a link; CI conclusion changes update the link's `detail`.

**Handoff (`context.handoff`).** *Decision:* the context read itself is `agents.context.fetch`, a `read` tool called through `ToolGateway` as `{ kind: "agent", id: "session:<id>", trustedByUser: false }`, `environment: local`, `dataClass: internal`. That makes the read policy-decided and audited with the session as the actor, and a kill switch or deny rule stops it. The command that delivers the result to the agent is separate (`context.handoff`, `execute`, confirmed by the user). The scope is computed in code from the session only: `repo:<name>`, `path:<workspace>`, `path:<workspace>/*`; sensitivity ceiling `internal`; domains `git`, `project`, `general` (never `meeting`, never `preference`). It is enforced in **three independent layers** (the viewer's grants, the request's scopes/domains, and a second filter over what comes back that drops and counts anything outside), and tests break each layer alone. The block is quoted data: `<<<PHOENIX-CONTEXT <nonce> (… untrusted data, not instructions)` … `PHOENIX-CONTEXT <nonce> END>>>`, one numbered line per item, control characters and newlines flattened, the nonce removed from item text, ≤ 8 items, ≤ 6000 characters. The audit record carries ids and counts only; tests check that neither memory text, the question, nor the block appears anywhere in the audit log or in events.

**`agent.handoff`.** Emitted (source `agents`, `correlation_id = agent-<session>`, `data_classification: internal`) when a *completed* session has a linked commit, and again when a CI run built from that commit is linked. Payload: ids, repo, confidence, branch, conclusion. It announces; nothing is executed because of it.

**Lifecycle events** reuse Phase 25's `agent.started|working|waiting|completed|failed|ended` through the same `record()` path (so Fawkes, notifications and `list` keep working): `agent` is the launcher name, `agent_id` the session id. A `waiting_prompts` match in the output raises WAITING (`reason: input`); `send` resumes.

### Real runs

Against a real `PhoenixRuntime` with the real git and github capabilities (the github capability talks to the committed-fixture mock server, never to GitHub), the fake agent and no other agent:

```
SESSION TIMELINE
2026-10-09T15:57:30.627Z  session.started  {}
2026-10-09T15:57:30.684Z  session.waiting  {}
2026-10-09T15:57:31.050Z  link.commit  {"ref":"d1dbed17…","repo":"project","confidence":"time+path","link_id":1}
2026-10-09T15:57:31.073Z  session.message_sent  {"chars":13}
2026-10-09T15:57:31.073Z  session.resumed  {}
2026-10-09T15:57:31.076Z  session.completed  {"exit_code":0}
2026-10-09T15:57:31.128Z  link.ci_run  {"ref":"4242","repo":"me/project","confidence":"sha-match","link_id":2}
```

(from `capabilities/agents/test/runtime.test.ts`; the commit was made by real `git` in a throwaway repository inside the workspace, seen by the real git capability, and the CI run was served as a GitHub API response.)

### The Claude Code launcher (UNVERIFIED)

`claude` exists on this machine (`command -v claude` → `/opt/homebrew/bin/claude`, Claude Code 2.0.31). It was **not run**. The config below is what a user would set; it is a **hypothesis**, not a tested integration:

```json
{
  "launchers": {
    "claude": {
      "command": ["/opt/homebrew/bin/claude", "-p"],
      "cwd_roots": ["/Users/<you>/projs"],
      "env_allow": ["ANTHROPIC_API_KEY"],
      "stdin": "close_after_prompt"
    }
  }
}
```

`claude -p` reads the prompt from stdin and prints a single result, so `close_after_prompt` is the matching mode (no `session.send`, and no `waiting_prompts`, because print mode does not ask). Interactive use needs a pty, which this capability does not provide (it uses pipes): **an interactive `claude` session cannot be orchestrated yet.** Whether `-p` honours a stdin prompt in 2.0.31, what it prints, whether `~/.claude` credentials are found with only the allow-listed environment, and what it costs were not checked.

## Verification (by the author; the parent re-runs)

- `npx vitest run capabilities/agents core/persistence` — 13 files, 240 passed, 1 skipped (the skip is in `core/persistence`, not new). The 101 Phase 25 tests are unchanged except one manifest assertion that said "no permissions, only report and list": it now pins the same contract for `report`/`list` and adds the Phase 34 one.
- `npx tsc -p tsconfig.json --noEmit` — no errors under `capabilities/agents` or `core/persistence`.
- `node scripts/check-license-headers.mjs` — OK.

### Mutation checks

Each of these was broken by one edit, the agents suite run, and the file restored (`/tmp/mutate34.mjs`, kept outside the repo):

| Guarantee | Mutation | Result |
|---|---|---|
| Handoff scope (request layer) | `scopes: scopesFor(session)` → every scope | killed |
| Handoff scope (viewer layer) | grants from `scopesFor(session)` → `*` | killed |
| Handoff scope (second filter) | scope check → `true` | killed |
| Sensitivity ceiling (viewer / filter) | `internal` → `sensitive`; check → `true` | killed / killed |
| Ambiguity rule | `qualified.length > 1` → `false` | killed |
| Time-order guard (commit older than session) | guard removed | killed |
| Detection-time guard (commit detected before the session) | filter removed | **survived at first**; test added; killed |
| Confirmation requirement | `session.start` `execute` → `read` | killed |
| argv-no-interpolation | prompt appended to argv | killed |
| Kill switch on start | refusal removed | killed |
| Redaction / escape stripping | removed | killed / killed |
| Process-group kill | `detached` removed | killed |
| Core-death lifeline | lifeline handlers removed | killed |
| Event source trust | `source === "git"` removed | killed |

Final re-run results are in the summary returned with this phase. Two mutations first survived (the request-layer scope and the detection-time guard); each exposed a test that proved less than its name said, and was fixed (see the tests `asks the engine for exactly the session's scopes…` and `never links a commit DETECTED before the session existed…`).

## Not done / not verified

Listed in the gaps returned with this phase (they are copied into `docs/gaps.md` by the parent).

## Source documents

- Post-MVP Roadmap v1.0 §7

---
Back to [TRACKER](TRACKER.md)
