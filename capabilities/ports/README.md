# Port & process radar (`ports`)

Lists listening TCP ports with their program, project folder name and age; flags forgotten dev servers and heavy processes; can stop
one after approval. Full description, rules and verification status: [docs/port-radar.md](../../docs/port-radar.md).

| Command           | Side effect | Notes                                                                                                                                                                    |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list`            | `read`      | Snapshot of listening ports.                                                                                                                                             |
| `stop_process`    | `execute`   | SIGTERM only. Confirms every time. Needs `{pid, port, start, command, uid}` as listed.                                                                                   |
| `force_stop`      | `execute`   | SIGKILL; a separate confirmation, only after a `stop_process` SIGTERM and a 5 s wait.                                                                                    |
| `restart_process` | `execute`   | `stop_process` path, then the owner's restart recipe (config `restart_recipes`) only if the program exited. Confirms every time and shows recipe, exact argv and folder. |

`restart_process` starts only a recipe the owner wrote in the config (`src/recipes.ts`, `src/restart.ts`); Phoenix never rebuilds a
program's command line from `ps` or `lsof`. See [Restarting](../../docs/port-radar.md#restarting-owner-written-recipes-only).

Layout: `src/parse.ts` (pure parsers), `src/collect.ts` (injected `Runner`), `src/project.ts` (`.git` walk), `src/policy.ts` (stop
rules, flags), `src/snapshot.ts`, `src/stop.ts` (proof, SIGTERM, force), `src/real.ts` (the only `process.kill`), `src/index.ts`
(manifest). Tests use `testing/fakes.ts`, a pretend machine; no test signals a real process. The single real, read-only test is
skipped unless `PHOENIX_REAL_PORTS=1`.
