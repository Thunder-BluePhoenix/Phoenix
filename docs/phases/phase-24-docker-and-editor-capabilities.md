# Phase 24 — Docker & Editor Capabilities

| Field | Value |
|---|---|
| Stage | Stage 2 — Useful Fawkes (v0.2) |
| Release target | v0.2 |
| Priority | Medium |
| Status | 🟨 Built and registered in Core. Docker run against a real daemon (Colima); the VS Code extension has never been loaded in a real VS Code (see [gaps register](../gaps.md)) |
| Depends on | [Phase 21 — Post-MVP Stabilisation](phase-21-post-mvp-stabilization.md) |
| Unblocks | [Phase 26 — Issue Tracker Capabilities & v0.2 Release](phase-26-issue-tracker-capabilities.md) |

## Goal

Add container lifecycle and editor (VS Code-compatible) events.

## Scope

**In scope**

- Docker container lifecycle, build, health
- Editor events (workspace open, save, tasks, diagnostics count)

**Out of scope**

- Kubernetes (later ecosystem)

## Tasks

- [x] Docker: read-only socket access with explicit permission (`container_access`; GET-only by construction)
- [~] Events: container started/stopped/died/unhealthy/healthy done; **image build start/fail not built, and cannot be built honestly** (the Engine API has no build event; see notes)
- [x] Editor extension that emits workspace, task, diagnostics-count and save-count events to Phoenix (`integrations/vscode/`; never loaded in a real VS Code)
- [x] Map unhealthy → WARNING (a crash of a running container → ERROR)

## Deliverables

- capabilities/docker
- Editor extension

## Exit criteria

- [x] Unhealthy container visible in Fawkes — shown with the harness against a mock Docker Engine on a unix socket (WARNING "Container web is unhealthy", clears on recovery). Also run against a real Docker daemon (Colima VM, socket `~/.colima/default/docker.sock`; Docker engine version not recorded) with throwaway containers: an unhealthy one showed Fawkes WARNING "Container px-unhealthy is unhealthy"; a container that really exited with code 3 showed ERROR "Container px-crash exited with code 3"; seeded environment secrets and labels never appeared in events or command output; `PHOENIX_REAL_DOCKER=1 vitest run capabilities/docker/test/real-docker.test.ts` passes (2). Image-build events remain unobserved (see gaps).

## Implementation notes

**Docker (`capabilities/docker`)**

- Talks to the Engine API over the unix socket with `node:http` (`socketPath`); no CLI, no dependencies. Socket order: `socket_path` setting (if set it is the only candidate) → `$DOCKER_HOST` (`unix://` only; `tcp://`, `ssh://` etc. are refused and the reason is shown, because Docker API traffic never goes over the network) → `/var/run/docker.sock` → `~/.docker/run/docker.sock` → `~/.colima/default/docker.sock` → `~/.orbstack/run/docker.sock`.
- Read-only is structural: `dockerGet` in `src/engine.ts` is the only code that touches the socket, hard-codes `GET`, and refuses any path outside `/_ping`, `/containers/json?all=true` and `/containers/<id>/json`. `test/read-only.test.ts` checks the requests the mock actually received, the refusal list, and the source for any mutating method or endpoint.
- Permission: `container_access` only. `filesystem_read` is not requested: connecting to a socket is not a file read, and the only file-system call is a `stat()` of candidate socket paths.
- Polling (default 3 s) rather than `/events`: the stream needs reconnect, resume and de-duplication to be dependable, and a stateless poll cannot get stuck. Cost: up to one interval of latency, and a container that starts and stops entirely between two polls is not seen.
- First poll is a baseline (nothing replayed) except containers that are running and unhealthy right now. Docker not running → health `degraded` with "Docker is not running (… looked at …)", no events, no warning at Fawkes, polling continues quietly.
- Events carry container id (12 chars), name, image, state, exit code, OOM flag and the two Compose labels (`project`, `service`) only. Environment, other labels, mounts, command lines and ports are never read into a snapshot; `test/docker.test.ts` seeds all of them with secrets and scans events, the store, Fawkes state, the command result and the capability view.
- Fawkes: `unhealthy` → WARNING "Container {subject} is unhealthy"; `died` → ERROR; `healthy`, `started`, `stopped`, `removed` clear that container's condition (one `correlation_id` per container). A stop is not an alarm: exit 0, and 137/143 without an OOM kill, are `stopped`. A running container whose health goes to `starting` (restart) keeps its warning until it is `healthy`.

**VS Code extension (`integrations/vscode`)**

- Plain JavaScript with JSDoc, no build step, no dependencies, not a pnpm workspace member. All logic is in `src/*.js` (no `vscode` import); `extension.js` is a thin shell. Try it: `code --extensionDevelopmentPath=$PWD/integrations/vscode`, start Phoenix Core, then enable **Editor (VS Code)** in Settings → Capabilities (it is granted `filesystem_read`).
- It is its own external capability `editor` (`events: editor.*`, no commands): it serves a loopback `/health` + `/phoenix/lifecycle` endpoint, registers via `POST /api/capabilities/register` with the session token, and posts with its capability token. Events are only sent while the user has the capability enabled. Core and token discovery follow `sdk/capability/src/session.ts`; the Core URL must be loopback.
- Events: `editor.workspace.opened`, `editor.task.started|passed|failed|cancelled`, `editor.diagnostics.changed` (error/warning **counts** only, debounced 3 s quiet / 15 s max), `editor.files.saved` (see below). Fawkes: task started → WORKING (30 min timeout), passed → SUCCESS (4 s), failed → ERROR, cancelled → clear. Diagnostics counts do not change Fawkes, on purpose (a red squiggle mid-typing is not an incident).
- **Save events (decision).** A per-save event naming the file would break the counts-only rule (`events.js` header: no paths, contents, messages, command lines or environment), so `editor.file.saved` is **refused**. What fits the existing contract is `editor.files.saved` with payload `{count}` only: `src/saves.js` counts `workspace.onDidSaveTextDocument` notifications through a handler that takes **no argument** (the document is never read, so there is no path, name, language or text), and reports the total once after 10 s of quiet (60 s maximum wait), so "save all" or format-on-save is one event. No `subject`, no Fawkes state rule, data category "number of files saved" declared. Tests: `integrations/vscode/test/events.test.ts` ("files saved"), `discovery-diagnostics.test.ts` ("save counter"), `extension.test.ts` ("sends saves as one count with no file identity", against the vscode **stub**). Disabling the `onDidSaveTextDocument` wiring or adding a `subject` to the event makes those tests fail. It has not run in a real VS Code, and the count does not say which files, so it cannot drive per-file reactions.
- **Docker image builds (decision, no feed).** The Engine API `/events` reference ([docs.docker.com/reference/api/engine/version/v1.52](https://docs.docker.com/reference/api/engine/version/v1.52/#tag/System/operation/SystemEvents), same list in [docker events](https://docs.docker.com/reference/cli/docker/system/events/)) gives images only `create, delete, import, load, pull, push, save, tag, untag, prune`, and "The Builder reports `prune` events". There is no build-started or build-failed event, and BuildKit (the default builder on Linux per the same spec's `/build` `version` parameter) does not report builds there. Building them would need `POST /build` (which this capability must never issue) or a BuildKit/buildx integration. Nothing was built; `phoenix run docker build` through the terminal capability remains the supported way.
- Tested: the logic modules, the Core client against a real in-process Core (registration, enable/disable, Fawkes states, Core restart on the same port, wrong token, hostile callbacks), and `extension.js` against a **stub** of the `vscode` API.

## Source documents

- Post-MVP Roadmap v1.0 §4
- Fawkes PRD v1.0 §10

---
Back to [TRACKER](TRACKER.md)
