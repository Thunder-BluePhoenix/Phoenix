# Status lights & Stream Deck (`status-lights`, Phase 88)

Fawkes' state in the physical world: a light you own follows IDLE, WORKING, WAITING, ERROR and RECORDING, and a Stream Deck shows the
same state with approve / deny / record / keep-awake keys. Package `capabilities/status-lights`, capability id `status-lights`.

Installed, never auto-enabled. Permission: `network` (lights are reached over a LAN or USB transport the host provides). **Every light
is off until you consent to that light**; nothing is discovered, scanned or contacted on its own.

**Verification status: simulated only.** Everything below is proven against recording fakes (a fake event feed, fake transports, a fake
deck surface) and, for the two wired transports, a fake Key Light (HTTP) and a fake LIFX light (a real UDP socket on loopback). No real
Hue bridge, Key Light, Luxafor, LIFX bulb or Stream Deck was driven, so the Phase 88 exit criterion "a real light follows Fawkes through
IDLE, WORKING, ERROR and RECORDING" is **not met**. The Hue request, Key Light request and Luxafor report are built from the vendors'
documented formats and checked only for their shape. The LIFX frames are checked byte for byte against the layout in LIFX's public LAN
protocol documentation, never against a real bulb's firmware.

## Colours

| State       | Meaning                                          | Colour (RGB)    | Key Light (white only) |
| ----------- | ------------------------------------------------ | --------------- | ---------------------- |
| `IDLE`      | nothing happening, or focus mode / quiet hours   | off (0,0,0)     | off                    |
| `WORKING`   | an agent is working                              | blue (0,96,255) | on, brightness 35      |
| `WAITING`   | an agent needs you                               | amber           | on, brightness 35      |
| `ERROR`     | an agent failed                                  | red (255,32,24) | on, brightness 35      |
| `RECORDING` | the notetaker is recording (red while recording) | red (255,0,0)   | on, brightness 100     |

Several agents: the most urgent wins (`ERROR` > `WAITING` > `WORKING`). `RECORDING` outranks all of it while it lasts, and the agent
state returns when it ends. The agent table is bounded (64) so an event flood only evicts the oldest entry.

## Event → colour

Only the envelope `source` + `event_type` choose a colour, and only from trusted sources:

| Source   | Event                                                                    | State                     |
| -------- | ------------------------------------------------------------------------ | ------------------------- |
| `agents` | `agent.working` / `agent.waiting` / `agent.failed`                       | WORKING / WAITING / ERROR |
| `agents` | `agent.completed` / `agent.ended` / `agent.idle`                         | that agent is done        |
| `core`   | `notetaker.recording` / `notetaker.idle` (Core only; reserved namespace) | RECORDING / not recording |

An event from any other source with these names, or with these names from the wrong source, is ignored. Event subjects, payload text,
task names and agent ids are never put in a device request: the payload's `agent_id` is only a bounded in-memory key. A device receives
a fixed colour, or for Hue a fixed path built from the `resource` id the host provisioned (validated as a UUID). There is no code path
from event content to a URL, header, path or byte of a frame.

## Consent, revoke, failure

- **Per-device consent.** Config `devices` lists the ids of the lights you allow. A provisioned light not listed is never written to.
  Consent is read again at write time, so a withdrawal wins over a write already queued.
- **Revoke.** Command `revoke {device_id}` (side effect `none`: it only removes access, so it never asks) aborts the write in flight
  and blocks that light until the capability is enabled again with the id still in `devices`. The host also calls
  `controller.consentChanged(id)` after a settings change that adds or removes a light.
- **Serial writes, newest wins.** Each light has one write at a time; a newer colour aborts a stuck older write and queued stale colours
  are dropped, so a slow bulb cannot show an old state late. An unchanged colour is not resent.
- **Failures.** A failed write emits `status_lights.device.failed` (ephemeral, `warning`, payload `{device_id}` only; never the error
  text) once per failure streak, retries on the next change, and `status_lights.device.recovered` after the next success. Health is
  `degraded` while any light fails.
- **Disable / shutdown.** Consented lights are switched to IDLE (off) with a 3 s limit per write, so a disabled capability does not
  leave a red light on; unconsented and revoked lights get nothing.

## Focus mode and quiet hours

Both force the lights (and the deck's state key) to IDLE while the Fawkes state keeps being tracked, so the right colour returns when
they end. That includes a recording: the light is dark during quiet hours even while recording (the on-screen RECORDING indicator is
unaffected). Config `quiet_hours {timezone, start, end}` takes 24 h `HH:MM` and may cross midnight. A malformed time or unknown time
zone fails **dark**. Focus mode comes from the host (`focusMode()` option). Core supplies it (`focusMode: () =>
focus.snapshot().active`, the same `FocusController` that gates notifications) and also `focusChanges`, a subscription to that
controller, so the lights go dark when a manual or Pomodoro Focus session starts and return the instant it stops or expires, without
polling and without the host calling `refresh()`. The subscription exists only while the capability is enabled. Quiet-hours boundaries
are re-evaluated on every event and on `refresh()`.

## Stream Deck

Enabled with config `stream_deck.enabled`. Fixed layout (position is the meaning, never text):

| Key | Face                                     | Press                                                                                         |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| 0   | state icon + the light colour            | nothing                                                                                       |
| 1   | approve (lit when something is allowed)  | resolves the first allowed pending confirmation as approved through Core's permission gateway |
| 2   | deny (lit when something is pending)     | resolves the first pending confirmation as denied                                             |
| 3   | record                                   | asks the Pet Panel to open the recording consent dialog; **a key press is never consent**     |
| 4   | keep awake (`awake_minutes`, default 30) | asks Core to run `awake.start`, which confirms on screen                                      |

The approve key refuses, in code, anything that needs `meeting_recording`, `microphone`, `camera`, `screen_capture` or
`production_action`, anything that is not a `write`/`execute` action, this capability's own requests, and every capability not listed
in `stream_deck.approve_capabilities` (empty by default: it approves nothing). Deny is always allowed. Key labels show only
`capability command` when both are plain identifiers, else `?`. A failing action is contained and logged by key name.

## Integration (host side)

The capability is in `core/runtime/src/builtins.ts` (installed, never enabled). `builtinCapabilities(env, agents, planning, host)`
takes a `BuiltinHost` whose `statusLights` options give the lights, the event feed and Focus mode; `core/runtime/src/main.ts` builds them
with `statusLightsHost(() => runtime)` (`core/runtime/src/status-lights/host.ts`).

```ts
const statusLights = createStatusLightsCapability({
  devices: () => provisionedDevices, // Device[] with injected DeviceTransport; ids are host-provisioned
  feed: () => bus, // anything with subscribe(id, patterns, listener); EventBus fits
  focusMode: () => focus.snapshot().active,
  focusChanges: (listener) => focus.subscribe(listener), // returns the unsubscribe function
  deck: () => ({ surface: deckSurface, actions: deckActions }), // DeckSurface + DeckActions ports
});
```

- **Provisioning** (`core/runtime/src/status-lights/provision.ts`, `StatusLightProvisioning`). A provisioned light is
  `{id, kind: "key-light", address, port}` or `{id, kind: "lifx", address, port, mac}`. `kind` is required on a write; a stored entry
  written before LIFX existed already has `kind: "key-light"` and stays valid unchanged. The `address` must be an IPv4 literal that is
  private, link-local or loopback; a hostname is never accepted. A LIFX `address` must also be a unicast address: a last octet of `.0`
  or `.255` (a possible network or broadcast address) is refused. The Key Light port defaults to 9123; the LIFX port defaults to 56700
  and only 56700 is accepted, except on a loopback address (so a fake light can listen elsewhere in tests). A LIFX `mac` is the
  bulb's 6-byte serial, 12 hex digits or six colon pairs (any case), stored lower-case; all-zero and all-ones serials are refused, and
  `mac` on a Key Light is refused. The list is stored in settings key `status-lights.provisioned` and re-validated on every read: a
  stored entry that no longer validates is dropped. Privacy row `status_lights_devices`.
- **Routes** (session token only): `GET /api/status-lights/devices` and `PUT /api/status-lights/devices`. `PUT` replaces the whole
  list (at most 16, only the fields `id`, `kind`, `address`, `port`, `mac`) and is audited as `status_lights.provisioned` with the
  count and the kinds; addresses and serials are not written to the audit log.
- **Key Light transport.** `keyLightTransport` does `PUT http://<ip>:<port>/elgato/lights` with no redirects and a 5 s timeout.
- **LIFX transport** (`capabilities/status-lights/src/lifx.ts` for the frames, `core/runtime/src/status-lights/lifx-transport.ts` for
  the socket). Frames follow lan.developer.lifx.com: a 36 byte little-endian header (size, protocol 1024 + addressable, `tagged` 0,
  a fixed non-0/1 source, the 6 byte serial zero-padded to 8, `ack_required` set and `res_required` clear, a per-light sequence that
  wraps at 255, the type) plus SetColor (102, 13 byte payload, 49 bytes) or SetLightPower (117, 6 byte payload, 42 bytes). A state is
  sent as SetColor then SetLightPower on, or only SetLightPower off for IDLE, so a bulb that was off never flashes its old colour. The
  colour is the table's RGB as HSBK at the Key Light's brightness (35 %, 100 % while recording, 3500 K). Each command is one unicast
  UDP datagram to the provisioned `<ip>:<port>` only, from a fresh connected socket (so only that address can answer), followed by a
  wait of at most 2 s for that light's Acknowledgement (45) matching source, sequence and serial; without it the write fails and is
  reported like any other failed write. There are no retries: the controller's newest-wins writer sends the next state instead. A
  light gets at most one datagram per 250 ms (a state change is two), so it can change at most twice a second. The transport only
  sends bytes that `lifxCommandHeader` accepts (a SetColor or SetLightPower for exactly its own serial, never tagged or broadcast), and
  is not constructed for a hostname, a non-LAN, network or broadcast address, a bad serial or a bad port. No discovery (GetService) or
  broadcast is ever sent.
- **Consent is separate.** The `devices` setting of the status-lights capability config lists the lights you allow. Provisioning alone
  never lights anything.
- **Trusted events.** Only events with source `agents` (and `core` for `notetaker.*`) drive colours.
- **Settings section:** see `apps/web/src/components/StatusLightsSettings.tsx`. It lists and keeps LIFX lights (so removing a Key Light
  does not drop them) but only adds Key Lights; a LIFX light is added through `PUT /api/status-lights/devices` with its serial. The new
  and changed `awakeSchedule.lights.*` strings exist in all nine locales; the non-English ones are machine-translated and unreviewed.
- **Tests.** `core/runtime/test/status-lights-wiring.test.ts` (fake Key Light on loopback, provisioning/audit, LIFX over UDP, Focus
  following), `core/runtime/test/lifx-transport.test.ts` (fake LIFX light on a real loopback UDP socket, `fake-lifx.ts`),
  `capabilities/status-lights/test/lifx.test.ts` (byte-exact frames).

`main.ts` still passes no `deck` ports: Core supplies lights, the event feed and Focus mode, not a Stream Deck surface.

## Not done

- Hue (needs bridge pairing and a key) and Luxafor (USB HID) transports, bridge pairing, discovery, and the Stream Deck
  plugin (manifest, property inspector, artwork). The deck is a port with no host surface.
- LIFX discovery and any Settings control for the serial (a LIFX light is added through the API only).
- No real-device run, so the exit criterion is unmet; the Key Light and LIFX transports were never run against a real light; Hue colour
  accuracy, LIFX bulb acceptance (colour accuracy, multizone or matrix devices, Thread-only firmware) and Luxafor colour order are
  unchecked.
- No Settings UI for `quiet_hours` and the deck yet (web strings and nine locales would be needed).
- Key icons are names (`state-working`, `approve`, ...); Phoenix's own artwork for them is not drawn. Nothing from Coucou is used.

## Tests

`capabilities/status-lights/test/` (`devices` (per-vendor requests, Hue id validation, LIFX state-to-frame mapping), `lifx` (byte-exact
SetColor, SetLightPower, Acknowledgement, serial validation), `controller`
(mapping, spoofed sources, consent, revoke, stuck/failing writes, focus, quiet hours incl. time zone and midnight, shutdown, hostile
text), `deck` (approve/deny rules, recording refusal), `capability` (through the real manager and bus: config validation, events,
commands, deck, failure events, focus subscription, re-enable). Fakes: `testing/fakes.ts` open no socket. The LIFX transport tests in
`core/runtime/test/` open real loopback UDP sockets and use short real timers for the acknowledgement timeout and the pacing check.
