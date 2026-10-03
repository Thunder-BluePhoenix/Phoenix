# capabilities/terminal

Shows the commands you run through `phoenix run` as they start and finish ([Phase 18](../../docs/phases/phase-18-terminal-process-capability.md)).
**Observation only:** your terminal runs the command; Phoenix never executes anything.

```sh
alias phoenix="$PWD/node_modules/.bin/tsx $PWD/capabilities/terminal/src/cli.ts"   # from the repo root
phoenix run pnpm test
phoenix run --kind build ./scripts/release.sh
```

- Enable the **Terminal** capability in the Pet Panel first; until then (or if Core is not running) the command still runs and you get a one-line "not reported" note.
- The exit code is passed through unchanged; Ctrl-C goes to your command.
- `--kind build|test|command` overrides the guess (build words like `make`, `tsc`, `build` → `build.*`; test runners → `test.*`; anything else → `command.*`).

| Report   | Event                                                | Fawkes                           |
| -------- | ---------------------------------------------------- | -------------------------------- |
| started  | `build.started` / `test.started` / `command.started` | WORKING                          |
| exit 0   | `build.passed` / `test.passed` / `command.completed` | SUCCESS (brief)                  |
| non-zero | `build.failed` / `test.failed` / `command.failed`    | ERROR, e.g. "Build failed: make" |

Command lines and the failure excerpt (last 20 output lines) are secret-redacted twice, in the CLI and in the capability, and stay in the local event store.

Limitations: output is piped (to keep the failure excerpt), so the command does not see a TTY, and some tools drop colour. There are no automatic shell hooks; wrap the commands you care about.
