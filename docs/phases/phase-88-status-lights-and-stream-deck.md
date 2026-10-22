# Phase 88 — Physical Status Lights & Stream Deck

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Built as code and wired into Core for the Elgato Key Light only; every check is simulated (fakes and a fake Key Light on loopback). The capability is in `builtins.ts` (installed, never enabled). **Not done:** Hue, Luxafor and LIFX transports, the Stream Deck plugin. No real light or Stream Deck was driven; the exit criterion is not met |
| Depends on | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md) |
| Unblocks | — |

## Goal

Fawkes' state in the physical world.

## Tasks

- [ ] Lights: Philips Hue, Elgato Key Light, Luxafor/busy lights, LIFX; map states to colours (red while recording). The event-to-colour mapping is built and a Key Light transport is wired (`PUT http://<ip>:<port>/elgato/lights`, no redirects, 5 s timeout); Hue, Luxafor and LIFX request formats are checked for shape only. Simulated. Unticked: no real light was driven.
- [ ] Stream Deck plugin: approve/deny, start recording, keep awake, state icons. **No plugin exists.** Only the approve key's restrictions are built: a denylist of sensitive permissions, an empty allow-list by default, and off unless enabled.
- [ ] Respects focus mode and quiet hours. Quiet hours and focus darken the lights (fail dark). Simulated. Unticked: Core does not pass `focusMode` to the capability, and there is no Settings UI for quiet hours.

## Deliverables

- `capabilities/status-lights` (`@phoenix/capability-status-lights`): mapping, consent, quiet hours, serialized writes. Now in `core/runtime/src/builtins.ts` via `createStatusLightsCapability` (installed, never enabled); `builtinCapabilities(env, agents, planning, host)` takes a `BuiltinHost` with `statusLights` options and `onAwakeSession`. Simulated evidence only. See [status-lights.md](../status-lights.md).
- `core/runtime/src/status-lights/provision.ts` (`StatusLightProvisioning`): provisioned lights (id, kind `key-light`, IPv4 `address` that must be private, link-local or loopback and never a hostname, `port` default 9123) in settings key `status-lights.provisioned`, re-validated on read (an entry that no longer validates is dropped). `keyLightTransport` does `PUT http://<ip>:<port>/elgato/lights`. Routes `GET/PUT /api/status-lights/devices` (`PUT` replaces the list, at most 16, audited as `status_lights.provisioned`). Privacy row `status_lights_devices`. Test `core/runtime/test/status-lights-wiring.test.ts` (fake Key Light on loopback).
- Consent is a separate capability setting (`devices` in the status-lights capability config); provisioning alone never lights anything. Only events with source `agents` (and `core` for `notetaker.*`) drive colours.
- Not built: Hue (needs bridge pairing and a key), Luxafor (USB HID) and LIFX (UDP) transports, the Stream Deck plugin and deck surface. Settings section: see `apps/web/src/components/StatusLightsSettings.tsx`; quiet hours and the deck still have no Settings UI.

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

Hue, Luxafor and LIFX transports (Hue needs bridge pairing and a key, Luxafor USB HID, LIFX UDP), the Stream Deck plugin and deck surface, any real light, and a Settings UI for quiet hours and the deck.

### What was not run

Any real light, bridge or Stream Deck, including the Key Light transport. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
