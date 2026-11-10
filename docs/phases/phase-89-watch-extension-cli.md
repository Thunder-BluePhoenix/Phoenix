# Phase 89 — Apple Watch, Browser Extension & phoenix CLI

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Only the `phoenix` CLI is built (tested with fakes and loopback). `phoenix awake` is built too. The browser extension's one action, "Send page to Phoenix", is built (extension, native-messaging host, Core route, review list) and tested only with fakes and an in-process Core; it was never loaded in a real browser. **Not built:** the Apple Watch app, PR-page Fawkes and the Meet record button. No surface performed a real action end to end; the exit criterion is not met |
| Depends on | [Phase 71 — Phone Link & Mobile Companions](phase-71-phone-link-and-mobile.md) |
| Unblocks | — |

## Goal

Phoenix from the wrist, the browser and the terminal.

## Tasks

- [ ] Apple Watch app: state, approvals with wrist confirmation (through the iPhone app). **Not built.**
- [ ] Browser extension: Fawkes on GitHub PR pages, meeting record button on Meet, send page to Phoenix. **Send page to Phoenix is built** (never loaded in a real browser; no store review); the PR-page Fawkes and Meet record button are **not built**. See [companion-clients.md](../companion-clients.md). Unticked.
- [ ] `phoenix status`, `phoenix ask "why did CI fail?"`, `phoenix awake 2h`, `phoenix approve`. `phoenix status`, `phoenix approvals list/approve/deny`, `phoenix events tail [--follow]` and `phoenix awake <duration> | extend | end | status` are built (awake: real Core and real keep-awake capability on a fake machine; the person approves in Phoenix). `phoenix ask "…"` is built as a question about stored memory through `POST /api/memory/ask` (fails closed when Core produced no AI answer; tested against a fake Core and a real Core with AI off, never a real model). It does not diagnose arbitrary CI runs. Simulated. Unticked.

## Deliverables

- `apps/phoenix-cli` (`@phoenix/cli`): `phoenix status`, `phoenix approvals list|approve|deny`, `phoenix events tail [--follow]`, `phoenix awake`. Built; added to the root `tsconfig` include; simulated evidence only. See [phoenix-cli.md](../phoenix-cli.md) and [companion-clients.md](../companion-clients.md).
- `apps/extension`: MV3 "Send page to Phoenix" button, native-messaging host `dev.phoenix.companion`, per-user install/uninstall script, icon generator. Core `POST /api/companion/page` with `GET`/`DELETE` list routes and a Settings list. Built; fakes and in-process Core only.
- Not built: `apps/watch`; the extension's PR-page Fawkes and Meet record button.

## Exit criteria

- [ ] Each surface performs one real action end to end. **Unmet.** The watch app does not exist, the extension's one action was never run in a real browser, and the CLI was tested against fakes and loopback servers only.

## Implementation notes

### What was built

- **CLI commands:** `phoenix status`, `phoenix approvals list | approve | deny`, `phoenix events tail [--follow]`, `phoenix awake <duration> | extend | end | status` (confirmation stays with the person; a no or the emergency stop exits `4`).
- **Safety:** loopback only; the token comes from the environment or a file and is never printed; redirects are refused; `approve` needs a `--ref` or an interactive confirm; untrusted text is sanitised.
- Documentation: [phoenix-cli.md](../phoenix-cli.md), [companion-clients.md](../companion-clients.md).

- **Extension (Send page to Phoenix):** click-only (`activeTab`, no host permissions, no content script); sends url, title and optional selection through a native-messaging host that holds the session token (the extension never does) and talks only to `http://127.0.0.1:<port>`; Core stores a bounded page note as untrusted data with an audit entry; the person reviews and deletes it in Settings. Nothing is acted on or sent to a model. Details and limits: [companion-clients.md](../companion-clients.md).

### Deviations

- The CLI's short `--ref` remains a client-side convenience, but Core now issues and verifies a full reference for requests labelled `phoenix-cli`; this removes the list/decision TOCTOU window. It does not authenticate the person holding the session token.

### Security review

A static read-only review by tools (not a human audit) found that `--json` output did not escape format and bidirectional characters; it now does (fixed, with a test).

### What was not built

The Apple Watch app, the extension's PR-page Fawkes and Meet record button. `phoenix ask` answers only from memory and was never run against a real model.

### What was not run

Any real watch; the extension was never loaded in a real browser, the host was never started by one, never run against a real Core process (only an in-process test Core), no store review, no Windows host registration. Any use of the CLI beyond tests against fakes and loopback servers. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
