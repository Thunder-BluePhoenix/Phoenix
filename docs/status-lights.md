# Status lights & Stream Deck (`status-lights`, Phase 88)

Fawkes' state in the physical world: a light you own follows IDLE, WORKING, WAITING, ERROR and RECORDING, and a Stream Deck shows the
same state with approve / deny / record / keep-awake keys. Package `capabilities/status-lights`, capability id `status-lights`.

Installed, never auto-enabled. Permission: `network` (lights are reached over a LAN or USB transport the host provides). **Every light
is off until you consent to that light**; nothing is discovered, scanned or contacted on its own.

**Verification status: simulated only.** Everything below is proven against recording fakes (a fake event feed, fake transports, a fake
deck surface). No real Hue bridge, Key Light, Luxafor, LIFX bulb or Stream Deck was driven, so the Phase 88 exit criterion "a real light
follows Fawkes through IDLE, WORKING, ERROR and RECORDING" is **not met**. The Hue request, Key Light request, Luxafor report and LIFX
frame are built from the vendors' documented formats and checked only for their shape.

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
zone fails **dark**. Focus mode comes from the host (`focusMode()` option). Neither is polled: call `capability.refresh()` when focus
mode changes; quiet-hours boundaries are re-evaluated on every event and on `refresh()`.

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

```ts
const statusLights = createStatusLightsCapability({
  devices: () => provisionedDevices, // Device[] with injected DeviceTransport; ids are host-provisioned
  feed: () => bus, // anything with subscribe(id, patterns, listener); EventBus fits
  focusMode: () => focus.snapshot().active,
  deck: () => ({ surface: deckSurface, actions: deckActions }), // DeckSurface + DeckActions ports
});
```

Add to `core/runtime/src/builtins.ts`, subscribe `statusLights.refresh()` to focus changes and to pending-confirmation changes, and
supply the real `DeviceTransport`s (Hue bridge HTTPS with its key from the OS secret store, Key Light LAN PUT, Luxafor USB HID report,
LIFX UDP) and the Stream Deck plugin bridge in the host. Those are deliberately outside this package: it contains no socket, HID or
plugin code.

## Not done

- No real transport, bridge pairing, discovery, or Stream Deck plugin (manifest, property inspector, artwork). The deck is a port.
- No real-device run, so the exit criterion is unmet; Hue colour accuracy, LIFX frame acceptance and Luxafor colour order are unchecked.
- No Settings UI for the `devices`, `quiet_hours` and `stream_deck` config yet (web strings and nine locales would be needed).
- Key icons are names (`state-working`, `approve`, ...); Phoenix's own artwork for them is not drawn. Nothing from Coucou is used.

## Tests

`capabilities/status-lights/test/` (119 tests, vitest): `devices` (per-vendor requests, Hue id validation, LIFX frame), `controller`
(mapping, spoofed sources, consent, revoke, stuck/failing writes, focus, quiet hours incl. time zone and midnight, shutdown, hostile
text), `deck` (approve/deny rules, recording refusal), `capability` (through the real manager and bus: config validation, events,
commands, deck, failure events, re-enable). Fakes: `testing/fakes.ts`. No test opens a socket or uses a real timer.
