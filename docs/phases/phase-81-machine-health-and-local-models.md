# Phase 81 — Machine Health & Local Model Manager

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Built; every check is simulated (injected fakes, temporary directories, in-memory database). Nothing ran against a real Ollama, LM Studio or a Linux or Windows machine. Model download fails closed in production (no trusted size catalog is injected), so the "a model is downloaded and removed through Phoenix" criterion is not met |
| Depends on | [Phase 27 — Model Adapter & Router](phase-27-model-adapter-and-router.md) |
| Unblocks | — |

## Goal

Machine health in Fawkes, and local models that fit your machine.

## Tasks

- [ ] Disk space, memory pressure, CPU, battery and temperature with thresholds → Fawkes WARNING. `health_snapshot` reads the five measurements; thresholds emit `machine.health.warning` and `machine.health.recovered` through state rules ([machine-health.md](../machine-health.md)). Simulated. Unticked because the Linux and Windows probes were never run on those systems and temperature is unavailable on macOS and Windows.
- [ ] Local model manager for Ollama/LM Studio: list, download, remove, run. `list_models` (read) and `download_model`, `run_model`, `remove_model` (execute, approval each time), loopback Ollama and LM Studio only; LM Studio removal is refused because it has no deletion API. Simulated with fake HTTP. Unticked because **download fails closed in production** (see the fit check) and no real Ollama or LM Studio was exercised through Phoenix.
- [ ] Fit check before download: model size vs free memory and disk. `check_fit` needs a trusted injected `catalogSize`; production passes none (`core/runtime/src/builtins.ts`), so `check_fit` and `download_model` refuse with "Verified model size unavailable". Tested with a fake catalog only. Unticked.
- [ ] Clean-up suggestions (old models, caches) with approval. `suggest_cleanup` (read) only suggests; it deletes nothing, and removal is a separate approved `remove_model`. Simulated. Unticked because suggestions cover installed models only, not caches, and nothing real was removed.

## Deliverables

- capabilities/machine: built (`@phoenix/capability-machine`, `capabilities/machine/**`, [machine-health.md](../machine-health.md)); simulated evidence only.
- Model manager UI: `MachineHealth` is mounted in Settings (`apps/web/src/components/MachineHealth.tsx`).

## Exit criteria

- [ ] Low-disk warning fires on a simulated threshold. **Met as a simulation only:** a simulated low-disk reading crosses the threshold and `machine.health.warning` / `machine.health.recovered` flow through the state rules. No real low-disk condition was produced.
- [ ] A model is downloaded and removed through Phoenix. **Unmet.** Download refuses in production (no trusted `catalogSize`), and no real Ollama or LM Studio was exercised through Phoenix.

## Implementation notes

### What was built

- **Commands**: `health_snapshot`, `list_models`, `check_fit`, `suggest_cleanup` (read) and `download_model`, `run_model`, `remove_model` (execute, approval each time). Loopback Ollama and LM Studio only; response size capped by streaming (2,000,000 bytes).
- **Health thresholds** emit `machine.health.warning` and `machine.health.recovered` through state rules.
- **Web and docs**: `MachineHealth` in Settings, `machine.*` interface strings (English plus nine machine-translated, unreviewed locales), [machine-health.md](../machine-health.md). New workspace package `@phoenix/capability-machine` (GPL, workspace); no new third-party dependency and no migration.

### Deviations

- Download and fit check fail closed because no trusted model size source exists; the production wiring passes none.
- LM Studio removal is refused (no API).

### Security review

A static read-only review by tools (not a human audit) was followed by fixes, each with tests. **Residual:** model names may carry a registry host; it is shown in the approval prompt and there is no allowlist.

### What was not built

A trusted model size catalog; LM Studio removal; cache clean-up.

### What was not run

Any real Ollama or LM Studio through Phoenix; the Linux and Windows health probes. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
