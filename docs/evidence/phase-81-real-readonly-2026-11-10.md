# Phase 81 real read-only evidence, 2026-11-10

Scope: the Phase 81 model list, status and health paths against a REAL loopback Ollama (0.15.5, `GET /api/version`), through a real in-process Core (`startCore`, in-memory database, real global `fetch` wrapped by a recorder that throws on any non-GET). Nothing was pulled, deleted, loaded, created or modified; no `ollama` CLI was used. No `:cloud` model was ever called: the only requests sent to Ollama were `GET /api/version`, `GET /api/tags`, `GET /api/ps` (listed below; the recorder fails the test on any other method). The pull/remove exit criterion stays **unverified**.

Run by an agent on the owner's machine (macOS arm64, Node v22.19.0). Single run per command shown; the harness was run several times while being developed (see "All runs").

## Installed models (raw `curl -s http://127.0.0.1:11434/api/tags`, pretty-printed)

| name                    | size (bytes) | family     | parameters | quantisation | remote_host                                        |
| ----------------------- | ------------ | ---------- | ---------- | ------------ | -------------------------------------------------- |
| nomic-embed-text:latest | 274302450    | nomic-bert | 137M       | F16          | none                                               |
| llama3.2:latest         | 2019393189   | llama      | 3.2B       | Q4_K_M       | none                                               |
| kimi-k2.5:cloud         | 340          | (empty)    | (empty)    | (empty)      | https://ollama.com:443 (remote_model kimi-k2.5)    |
| gpt-oss:120b-cloud      | 384          | gptoss     | 116.8B     | MXFP4        | https://ollama.com:443 (remote_model gpt-oss:120b) |

The two `:cloud` entries are 340/384-byte stubs that forward every prompt to ollama.com.

## Command

```
export PATH=/Users/bluephoenix/.nvm/versions/node/v22.19.0/bin:$PATH
PHOENIX_REAL_OLLAMA=1 ./node_modules/.bin/vitest run core/runtime/test/real-ollama-models.test.ts --testTimeout=60000 --disable-console-intercept
```

Test file: `core/runtime/test/real-ollama-models.test.ts` (3 tests, gated behind `PHOENIX_REAL_OLLAMA`, so CI never runs it).

## Finding (security) found by the first run, BEFORE the fix

The first run failed. Raw `list_models` (Phase 81 machine capability, `GET /api/tags` then `/api/ps`) before the fix:

```
RAW list_models {"status":"succeeded","result":[{"provider":"ollama","name":"nomic-embed-text:latest","sizeBytes":274302450,"loaded":false},{"provider":"ollama","name":"llama3.2:latest","sizeBytes":2019393189,"loaded":false},{"provider":"ollama","name":"kimi-k2.5:cloud","sizeBytes":340,"loaded":false},{"provider":"ollama","name":"gpt-oss:120b-cloud","sizeBytes":384,"loaded":false}]}
```

The Phase 81 model manager (`capabilities/machine/src/models.ts`) presented the two cloud-backed models as ordinary local Ollama models (and `suggest_cleanup` offered them for removal; `run_model` on one would have POSTed `/api/generate` with `keep_alive`, i.e. made Ollama contact ollama.com). It did not look at `remote_host` / `remote_model` or at the `:cloud` / `-cloud` name. No page or user text goes through the manager itself (`run_model` sends an empty prompt), so this is a mislabelling plus a remote-contact path, not a text leak. The AI provider layer was already correct (see below).

### Fix

- `capabilities/machine/src/models.ts`: `isRemoteModelName` (`/(^|[:\-])cloud$/i`, same rule as `ai/models/src/ollama.ts`); `listModels` drops entries whose name matches or that carry `remote_host` / `remote_model`; `parseModelRequest` (used by `check_fit`, `download_model`, `run_model`, `remove_model`) refuses such a name with `MachineError("unsupported")` before any request is made.
- Regression tests in `capabilities/machine/test/machine.test.ts` ("cloud-backed Ollama models are not local models", 5 cases).
- Mutation results: disabling the name refusal fails the 4 command cases (download/run/remove/check_fit); disabling the list filter (name, `remote_host`, `remote_model`) fails the list/cleanup case. Restored afterwards; 16/16 pass.

## Raw output AFTER the fix

```
RAW health_snapshot {"id":"op_mwayqh5f059f8c959","capabilityId":"machine","command":"health_snapshot","status":"succeeded","createdAt":"2026-11-10T17:27:28.851Z","updatedAt":"2026-11-10T17:27:28.862Z","result":{"platform":"darwin","reading":{"diskFreeBytes":313773133824,"diskTotalBytes":994662584320,"memoryFreeBytes":8737570816,"memoryTotalBytes":51539607552,"cpuPercent":25.732421875,"batteryPercent":100,"charging":false,"temperatureCelsius":null},"warnings":[]}}
RAW list_models {"id":"op_mwayqh6c11d3a0f45","capabilityId":"machine","command":"list_models","status":"succeeded","createdAt":"2026-11-10T17:27:28.884Z","updatedAt":"2026-11-10T17:27:28.891Z","result":[{"provider":"ollama","name":"nomic-embed-text:latest","sizeBytes":274302450,"loaded":false},{"provider":"ollama","name":"llama3.2:latest","sizeBytes":2019393189,"loaded":true}]}
RAW api_ps_direct ["llama3.2:latest"]
RAW check_fit {"id":"op_mwayqh772db74ee9a","capabilityId":"machine","command":"check_fit","status":"failed","createdAt":"2026-11-10T17:27:28.915Z","updatedAt":"2026-11-10T17:27:28.927Z","error":{"code":"CAPABILITY_UNAVAILABLE","message":"Verified model size unavailable; download refused","details":[]}}
RAW suggest_cleanup {"id":"op_mwayqh863b71d0d87","capabilityId":"machine","command":"suggest_cleanup","status":"succeeded","createdAt":"2026-11-10T17:27:28.950Z","updatedAt":"2026-11-10T17:27:28.951Z","result":{"suggestions":[{"provider":"ollama","name":"nomic-embed-text:latest","sizeBytes":274302450,"loaded":false,"action":"remove_model"}]}}
RAW ai_status_ollama {"id":"ollama","label":"Ollama (this device)","locality":"local","kind":"builtin","available":true,"reason":null,"key_policy":"none","key_set":false,"default_model":"llama3.2","base_url":null,"models":[{"id":"nomic-embed-text:latest","kind":"embed"},{"id":"llama3.2:latest","kind":"chat"}],"models_error":null}
RAW machine_requests [{"method":"GET","url":"http://127.0.0.1:11434/api/tags"},{"method":"GET","url":"http://127.0.0.1:11434/api/ps"},{"method":"GET","url":"http://127.0.0.1:11434/api/tags"},{"method":"GET","url":"http://127.0.0.1:11434/api/ps"}]
RAW ai_requests [{"method":"GET","url":"http://127.0.0.1:11434/api/version"},{"method":"GET","url":"http://127.0.0.1:11434/api/version"},{"method":"GET","url":"http://127.0.0.1:11434/api/version"},{"method":"GET","url":"http://127.0.0.1:11434/api/tags"}]
RAW generateLocal kimi-k2.5:cloud "Every allowed AI provider failed"
RAW generateLocal gpt-oss:120b-cloud "Every allowed AI provider failed"
RAW generateLocal_requests [{"method":"GET","url":"http://127.0.0.1:11434/api/version"},{"method":"GET","url":"http://127.0.0.1:11434/api/version"},{"method":"GET","url":"http://127.0.0.1:11434/api/version"}]
RAW OllamaProvider.models [{"id":"nomic-embed-text:latest","kind":"embed","sizeBytes":274302450,"remote":false},{"id":"llama3.2:latest","kind":"chat","sizeBytes":2019393189,"remote":false},{"id":"kimi-k2.5:cloud","kind":"chat","sizeBytes":340,"remote":true},{"id":"gpt-oss:120b-cloud","kind":"chat","sizeBytes":384,"remote":true}]
RAW OllamaProvider_requests [{"method":"GET","url":"http://127.0.0.1:11434/api/tags"}]
```

(`health_snapshot` is the real local machine reading; `temperatureCelsius: null` is the documented macOS limit. `check_fit` refused with "Verified model size unavailable" because production wiring passes no `catalogSize`; that is the documented fail-closed behaviour.)

## What this confirms

- `list_models` (Phase 81) reports exactly the 2 local models with names and sizes matching `/api/tags`; `loaded` matches `/api/ps` read in the same test (`api_ps_direct`; llama3.2 was loaded by another process at that moment, so `loaded: true` there is correct, not a Phoenix action).
- `suggest_cleanup` suggests only local, unloaded models.
- `/api/ai/status?models=ollama` (Core): provider `ollama`, locality `local`, available `true`, models = the 2 local ones (cloud ones filtered by `remote`).
- `OllamaProvider.models()` (real): `remote:false` for both local models, `remote:true` for both `:cloud` models; `generate` and `embed` with either `:cloud` model reject with kind `config` and made no request (only one `GET /api/tags`).
- `AiService.generateLocal` with `model: "kimi-k2.5:cloud"` and `"gpt-oss:120b-cloud"` rejects ("Every allowed AI provider failed", the Ollama adapter's `config` refusal) and the recorded requests are only the three `GET /api/version` health probes: no POST, and the canary string `REAL-OLLAMA-CLOUD-CANARY-81` never appears in any request. `trustedLocal`/`generateLocal` was not at fault; no change to `ai/models`.
- Family/parameter details are visible only in raw `/api/tags`; Phoenix's `LocalModel` view carries provider, name, sizeBytes and loaded only (family is not reported by Phase 81; not changed).

## All runs

1. First run (pre-fix): 1 failed (cloud models in `list_models`), 1 passed.
2. After the fix, before adding the OllamaProvider test: 2/2 passed.
3. Added OllamaProvider test and `check_fit`: failed once because the test asserted `loaded:false` for llama3.2 while another process had loaded it (`/api/ps`); test corrected to compare with a direct `/api/ps` GET (a test bug, not a Phoenix bug).
4. Final: 3/3 passed (output above). Nothing was tuned to a model's output; no generation was performed at all.

## Still unverified: download and removal

`core/runtime/test/real-ollama-pull.test.ts` is written and was NOT run. It pulls then deletes, so it needs both variables. Owner approval command (pick a tiny model not already installed and its exact size in bytes from the Ollama library page; the fit check needs a trusted size and production has no catalog, so the test injects it):

```
PHOENIX_REAL_OLLAMA_PULL=<tiny-model-name> PHOENIX_REAL_OLLAMA_PULL_BYTES=<size-in-bytes> \
  ./node_modules/.bin/vitest run core/runtime/test/real-ollama-pull.test.ts
```

It refuses a `:cloud`/`-cloud` name, refuses to run if the model is already installed (so it never deletes a pre-existing model), approves the two gateway confirmations through `/api/confirmations`, checks the list before, during and after, and prints the audit rows. Because it injects `catalogSize`, it does not prove the production wiring (which refuses downloads); that stays the separate limitation row.
