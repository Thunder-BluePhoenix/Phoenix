# Phase 88 — Physical Status Lights & Stream Deck

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Built as code with injected transports; every check is simulated. **Not wired:** no real Hue, Key Light, Luxafor or LIFX transport, no Stream Deck plugin, and the capability is not in `builtins.ts`. No real light or Stream Deck was driven; the exit criterion is not met |
| Depends on | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md) |
| Unblocks | — |

## Goal

Fawkes' state in the physical world.

## Tasks

- [ ] Lights: Philips Hue, Elgato Key Light, Luxafor/busy lights, LIFX; map states to colours (red while recording). The event-to-colour mapping is built; transports are injected and request formats are checked for shape only. Simulated. Unticked: no real transport and no real light.
- [ ] Stream Deck plugin: approve/deny, start recording, keep awake, state icons. **No plugin exists.** Only the approve key's restrictions are built: a denylist of sensitive permissions, an empty allow-list by default, and off unless enabled.
- [ ] Respects focus mode and quiet hours. Quiet hours and focus darken the lights (fail dark). Simulated. Unticked: not connected to the real focus mode.

## Deliverables

- `capabilities/status-lights` (`@phoenix/capability-status-lights`): mapping, consent, quiet hours, serialized writes. Built, not added to `builtins.ts`; simulated evidence only. See [status-lights.md](../status-lights.md).
- Not built: real light transports and the Stream Deck plugin.

## Exit criteria

- [ ] A real light follows Fawkes through IDLE, WORKING, ERROR and RECORDING. **Unmet.** No real light was driven.

## Implementation notes

### What was built

- **Mapping:** events map to colours; `agent.*` events are trusted only from source agents and `notetaker.*` only from core.
- **Consent:** per-device consent is re-read at write time, and revoking aborts an in-flight write.
- **Quiet hours and focus** darken the light (fail dark).
- **Writes** are serialized, newest wins. Device failures emit events without error text.
- **Stream Deck approve key** is restricted: a denylist of sensitive permissions, an empty allow-list by default, and off unless enabled.
- Documentation: [status-lights.md](../status-lights.md).

### Deviations

- Transports are injected rather than implemented, so the four named vendors are not supported yet.

### What was not built

Real Hue, Key Light, Luxafor and LIFX transports, the Stream Deck plugin, and registration in `builtins.ts`.

### What was not run

Any real light, bridge or Stream Deck. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
