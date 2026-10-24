# Keep-awake privileged helper (Phase 73)

There is no helper _process_. Phoenix never holds root and never installs anything itself. The
"helper" is two things you install on purpose, from scripts you can read:

| File                                                               | Owner | What it is                                                                             |
| ------------------------------------------------------------------ | ----- | -------------------------------------------------------------------------------------- |
| `/etc/sudoers.d/phoenix-awake`                                     | root  | A sudoers rule: your account may run **exactly four command lines** without a password |
| `~/Library/Application Support/Phoenix/phoenix-awake-backstop.mjs` | you   | The backstop script (a copy of `phoenix-awake-backstop.mjs` here)                      |
| `~/Library/LaunchAgents/dev.phoenix.awake-backstop.plist`          | you   | A user-level launchd job that runs the backstop every 60 s                             |
| `~/Library/Logs/phoenix-awake-backstop.log`                        | you   | launchd's output for the job                                                           |

The four command lines (literal, no wildcard; `sudo` matches arguments one by one):

```
/usr/bin/pmset -a disablesleep 1
/usr/bin/pmset -a disablesleep 0
/usr/bin/pmset -a lowpowermode 1
/usr/bin/pmset -a lowpowermode 0
```

`lowpowermode` is included because `pmset -a lowpowermode` writes system power settings and so needs
root like `disablesleep`; the battery and heat floors turn Low Power Mode on through it.

The single allow-list is `validateHelperCommand` in `src/power/helper-client.ts`. Phoenix calls
`sudo -n <command>` only after that function accepts the argv; a non-zero exit means "helper not
installed" and the session carries on without lid-closed mode.

## Install / uninstall

Read `scripts/awake/install-helper.sh` first. Then:

```
./scripts/awake/install-helper.sh --print-plan        # what would be created; touches nothing, no root
./scripts/awake/install-helper.sh --print-sudoers     # the exact rule
sudo ./scripts/awake/install-helper.sh --yes
sudo ./scripts/awake/uninstall-helper.sh --yes        # removes every file listed above
```

Both scripts refuse to run unless root and `--yes`. The rule is **account-wide**: any process running as you can use the four lines without a password. Files under your home are created and removed as you, and the scripts refuse when a path component is a symlink or not yours. `--dry-run` prints each step without running it. `--data-dir DIR` (absolute) is the Core data folder; the backstop watches `DIR/capabilities/awake/recovery-journal.jsonl` (without it the installer follows Core's rule: `PHOENIX_DATA_DIR`, else `~/.phoenix/<PHOENIX_ENV>`); see `docs/awake-helper.md`. The rule is checked with `visudo -cf` before it
is put in place, and `visudo -c` after uninstall.

## What was and was not verified

Nothing here has ever been installed, loaded or run as root by the authors. Verified only by tests
that run the scripts in `--print-*` mode in a temp HOME without root, and by pure-function tests of
the allow-list, the decision, the journal format and the generated text. See `docs/awake-helper.md`.
