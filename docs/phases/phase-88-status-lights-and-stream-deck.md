# Phase 88 — Physical Status Lights & Stream Deck

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Built as code and wired into Core for the Elgato Key Light, LIFX (UDP, with discovery), Philips Hue (owner-entered bridge, fingerprint-pinned TLS, link-button pairing) and Luxafor (the app's local webhook); every check is simulated (fakes, a fake Key Light, a fake Luxafor webhook, a fake Hue link and a loopback TLS server, fake LIFX sockets). The capability is in `builtins.ts` (installed, never enabled). A Stream Deck plugin bundle exists (`apps/streamdeck`, a state key and an approval-gated keep-awake key, fake-WebSocket tested, never loaded in the Stream Deck app). **Not done:** a Stream Deck approve/deny/record key, Luxafor USB HID. No real light or Stream Deck was driven; the exit criterion is not met |
| Depends on | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md) |
| Unblocks | — |

## Goal

Fawkes' state in the physical world.

## Tasks

- [ ] Lights: Philips Hue, Elgato Key Light, Luxafor/busy lights, LIFX; map states to colours (red while recording). The event-to-colour mapping is built and two transports are wired: a Key Light (`PUT http://<ip>:<port>/elgato/lights`, no redirects, 5 s timeout) and LIFX (one acknowledged unicast UDP datagram per command, SetColor 102 and SetLightPower 117, byte-checked against LIFX's public LAN protocol documentation, paced to at most two changes a second). Hue (CLIP v2 over pinned TLS, key in the credential store) and Luxafor (documented local webhook) now have transports, and LIFX has an owner-confirmed discovery broadcast; see [status-lights.md](../status-lights.md). Simulated. Unticked: no real light, bridge or Luxafor app was contacted.
- [ ] Stream Deck plugin: approve/deny, start recording, keep awake, state icons. A plugin exists in `apps/streamdeck` with two keys: a state key (the existing display state name and colour, view only) and keep awake 30 min (asks Core to run `awake.start`, which confirms on screen every time). **No approve, deny, start-recording or per-state-icon key is built**, on purpose: no key may approve an approval. The capability's own approve-key restrictions (a denylist of sensitive permissions, an empty allow-list by default, off unless enabled) are built but still have no host surface. The plugin was never loaded in the Stream Deck app, packaged, signed or shown on hardware.
- [ ] Respects focus mode and quiet hours. Quiet hours and focus darken the lights (fail dark). Core now passes `focusMode` (from `FocusController`) and a `focusChanges` subscription to the capability, so a lit light goes dark when Focus starts and returns when it ends (fake Key Light, simulated). A Settings control for quiet hours now writes `quiet_hours` into the capability config (fake-tested). Unticked: no real light was driven.

## Deliverables

- `capabilities/status-lights` (`@phoenix/capability-status-lights`): mapping, consent, quiet hours, serialized writes. Now in `core/runtime/src/builtins.ts` via `createStatusLightsCapability` (installed, never enabled); `builtinCapabilities(env, agents, planning, host)` takes a `BuiltinHost` with `statusLights` options and `onAwakeSession`. Simulated evidence only. See [status-lights.md](../status-lights.md).
- `core/runtime/src/status-lights/provision.ts` (`StatusLightProvisioning`): provisioned lights (id, kind `key-light` with `address`, `port` default 9123, or kind `lifx` with `address`, `port` 56700 and the bulb's 6-byte serial `mac` stored as 12 lower-case hex digits; the `address` must be a private, link-local or loopback IPv4 literal, never a hostname, and for LIFX never a `.0`/`.255` network or broadcast address) in settings key `status-lights.provisioned`, re-validated on read (an entry that no longer validates is dropped; entries stored before LIFX existed are Key Lights and stay valid). `keyLightTransport` does `PUT http://<ip>:<port>/elgato/lights`; `lifx-transport.ts` sends one datagram per command to the provisioned address only and waits up to 2 s for the matching Acknowledgement (no retries, at least 250 ms between datagrams); `capabilities/status-lights/src/lifx.ts` builds the frames. Routes `GET/PUT /api/status-lights/devices` (`PUT` replaces the list, at most 16, audited as `status_lights.provisioned` with count and kinds; addresses and serials are not logged). Privacy row `status_lights_devices`. Tests `core/runtime/test/status-lights-wiring.test.ts` and `lifx-transport.test.ts` (fake lights on loopback) and `capabilities/status-lights/test/lifx.test.ts`.
- Consent is a separate capability setting (`devices` in the status-lights capability config); provisioning alone never lights anything. Only events with source `agents` (and `core` for `notetaker.*`) drive colours.
- Hue, Luxafor (webhook only) and LIFX discovery: `core/runtime/src/status-lights/{hue,hue-link,luxafor,lifx-discovery,pacer}.ts`, routes under `/api/status-lights/{hue,luxafor,lifx}`; fake-tested only, no real bridge, Luxafor app or bulb contacted.
- Stream Deck plugin: `apps/streamdeck/com.phoenix.fawkes.sdPlugin/` (manifest, `bin/plugin.js`, narrow local host `bin/host.js` that holds the token, tests in `apps/streamdeck/test`), no npm dependency; see [status-lights.md](../status-lights.md). Not built: a deck surface for the capability's `deck` ports (Core still passes none), Luxafor USB HID (native dependency), the Stream Deck Settings UI. Settings section: `apps/web/src/components/StatusLightsSettings.tsx` (Hue pairing with an explicit link-button step and fingerprint confirm, a write-only Luxafor token, LIFX discovery with an explicit add per light, quiet hours), tested only against a fake Core in `apps/web/test/status-lights-settings.test.tsx`; no real bridge, Luxafor app or bulb was used. The new light strings are machine-translated and unreviewed in the eight non-English locales.

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

- Luxafor is supported only through its local webhook, not USB HID, and its 200 answer does not prove the light changed. Hue trusts the fingerprint the owner confirmed (not the Signify CA chain).

### What was not built

A Stream Deck approve/deny/record key and the capability's host deck surface (Core passes no `deck` ports), Elgato CLI packaging and signing, Luxafor USB HID, any real light, and a Settings UI for the deck.

### What was not run

Any real light, Hue bridge, Luxafor app or Stream Deck, including the Key Light, LIFX, Hue and Luxafor transports. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
