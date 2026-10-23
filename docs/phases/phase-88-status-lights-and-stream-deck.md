# Phase 88 — Physical Status Lights & Stream Deck

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Built as code and wired into Core for the Elgato Key Light and LIFX (UDP); every check is simulated (fakes, a fake Key Light on loopback and a fake LIFX light on a loopback UDP socket). The capability is in `builtins.ts` (installed, never enabled). **Not done:** Hue and Luxafor transports, the Stream Deck plugin. No real light or Stream Deck was driven; the exit criterion is not met |
| Depends on | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md) |
| Unblocks | — |

## Goal

Fawkes' state in the physical world.

## Tasks

- [ ] Lights: Philips Hue, Elgato Key Light, Luxafor/busy lights, LIFX; map states to colours (red while recording). The event-to-colour mapping is built and two transports are wired: a Key Light (`PUT http://<ip>:<port>/elgato/lights`, no redirects, 5 s timeout) and LIFX (one acknowledged unicast UDP datagram per command, SetColor 102 and SetLightPower 117, byte-checked against LIFX's public LAN protocol documentation, paced to at most two changes a second). Hue and Luxafor request formats are checked for shape only. Simulated. Unticked: no real light was driven, and Hue and Luxafor have no transport.
- [ ] Stream Deck plugin: approve/deny, start recording, keep awake, state icons. **No plugin exists.** Only the approve key's restrictions are built: a denylist of sensitive permissions, an empty allow-list by default, and off unless enabled.
- [ ] Respects focus mode and quiet hours. Quiet hours and focus darken the lights (fail dark). Core now passes `focusMode` (from `FocusController`) and a `focusChanges` subscription to the capability, so a lit light goes dark when Focus starts and returns when it ends (fake Key Light, simulated). Unticked: there is no Settings UI for quiet hours, and no real light was driven.

## Deliverables

- `capabilities/status-lights` (`@phoenix/capability-status-lights`): mapping, consent, quiet hours, serialized writes. Now in `core/runtime/src/builtins.ts` via `createStatusLightsCapability` (installed, never enabled); `builtinCapabilities(env, agents, planning, host)` takes a `BuiltinHost` with `statusLights` options and `onAwakeSession`. Simulated evidence only. See [status-lights.md](../status-lights.md).
- `core/runtime/src/status-lights/provision.ts` (`StatusLightProvisioning`): provisioned lights (id, kind `key-light` with `address`, `port` default 9123, or kind `lifx` with `address`, `port` 56700 and the bulb's 6-byte serial `mac` stored as 12 lower-case hex digits; the `address` must be a private, link-local or loopback IPv4 literal, never a hostname, and for LIFX never a `.0`/`.255` network or broadcast address) in settings key `status-lights.provisioned`, re-validated on read (an entry that no longer validates is dropped; entries stored before LIFX existed are Key Lights and stay valid). `keyLightTransport` does `PUT http://<ip>:<port>/elgato/lights`; `lifx-transport.ts` sends one datagram per command to the provisioned address only and waits up to 2 s for the matching Acknowledgement (no retries, at least 250 ms between datagrams); `capabilities/status-lights/src/lifx.ts` builds the frames. Routes `GET/PUT /api/status-lights/devices` (`PUT` replaces the list, at most 16, audited as `status_lights.provisioned` with count and kinds; addresses and serials are not logged). Privacy row `status_lights_devices`. Tests `core/runtime/test/status-lights-wiring.test.ts` and `lifx-transport.test.ts` (fake lights on loopback) and `capabilities/status-lights/test/lifx.test.ts`.
- Consent is a separate capability setting (`devices` in the status-lights capability config); provisioning alone never lights anything. Only events with source `agents` (and `core` for `notetaker.*`) drive colours.
- Not built: Hue (needs bridge pairing and a key) and Luxafor (USB HID) transports, the Stream Deck plugin and deck surface (Core passes no `deck` ports), LIFX discovery, a Settings control for the LIFX serial (a LIFX light is added through the API). Settings section: see `apps/web/src/components/StatusLightsSettings.tsx`; quiet hours and the deck still have no Settings UI. The new light strings are machine-translated and unreviewed in the eight non-English locales.

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

- Hue and Luxafor transports are injected rather than implemented, so those two named vendors are not supported yet.

### What was not built

Hue and Luxafor transports (Hue needs bridge pairing and a key, Luxafor USB HID), the Stream Deck plugin and deck surface, LIFX discovery, any real light, and a Settings UI for quiet hours and the deck.

### What was not run

Any real light, bridge or Stream Deck, including the Key Light and LIFX transports. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
