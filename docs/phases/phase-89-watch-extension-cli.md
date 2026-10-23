# Phase 89 — Apple Watch, Browser Extension & phoenix CLI

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Only the `phoenix` CLI is built (tested with fakes and loopback). `phoenix awake` is built too. **Not built:** the Apple Watch app, the browser extension (documented only) and `phoenix ask`. No surface performed a real action end to end; the exit criterion is not met |
| Depends on | [Phase 71 — Phone Link & Mobile Companions](phase-71-phone-link-and-mobile.md) |
| Unblocks | — |

## Goal

Phoenix from the wrist, the browser and the terminal.

## Tasks

- [ ] Apple Watch app: state, approvals with wrist confirmation (through the iPhone app). **Not built.**
- [ ] Browser extension: Fawkes on GitHub PR pages, meeting record button on Meet, send page to Phoenix. **Not built;** documented only in [companion-clients.md](../companion-clients.md).
- [ ] `phoenix status`, `phoenix ask "why did CI fail?"`, `phoenix awake 2h`, `phoenix approve`. `phoenix status`, `phoenix approvals list/approve/deny`, `phoenix events tail [--follow]` and `phoenix awake <duration> | extend | end | status` are built (awake: real Core and real keep-awake capability on a fake machine; the person approves in Phoenix). **`phoenix ask` is not built.** Simulated. Unticked.

## Deliverables

- `apps/phoenix-cli` (`@phoenix/cli`): `phoenix status`, `phoenix approvals list|approve|deny`, `phoenix events tail [--follow]`, `phoenix awake`. Built; added to the root `tsconfig` include; simulated evidence only. See [phoenix-cli.md](../phoenix-cli.md) and [companion-clients.md](../companion-clients.md).
- Not built: `apps/watch`, `apps/extension`.

## Exit criteria

- [ ] Each surface performs one real action end to end. **Unmet.** The watch app and the extension do not exist, and the CLI was tested against fakes and loopback servers only.

## Implementation notes

### What was built

- **CLI commands:** `phoenix status`, `phoenix approvals list | approve | deny`, `phoenix events tail [--follow]`, `phoenix awake <duration> | extend | end | status` (confirmation stays with the person; a no or the emergency stop exits `4`).
- **Safety:** loopback only; the token comes from the environment or a file and is never printed; redirects are refused; `approve` needs a `--ref` or an interactive confirm; untrusted text is sanitised.
- Documentation: [phoenix-cli.md](../phoenix-cli.md), [companion-clients.md](../companion-clients.md).

### Deviations

- The `--ref` check is **client-side**: Core routes take no hash, so the CLI cannot bind the decision to a request hash on the server.

### Security review

A static read-only review by tools (not a human audit) found that `--json` output did not escape format and bidirectional characters; it now does (fixed, with a test).

### What was not built

The Apple Watch app, the browser extension and `phoenix ask`.

### What was not run

Any real watch or browser, and any use of the CLI beyond tests against fakes and loopback servers. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
