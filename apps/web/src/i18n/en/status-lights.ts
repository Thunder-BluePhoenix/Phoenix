// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Settings for Hue, Luxafor, LIFX and quiet hours (Phase 88). Errors are fixed texts, never a device's or Core's own words. */
export const statusLights = {
  "statusLights.limits":
    "Only fixed colours are sent, never any text. Credentials (a Hue application key, a Luxafor token) are write-only: once saved they are never shown again. Names and ids a light reports are shown as plain text.",
  "statusLights.line.luxafor": "Luxafor app at {address}",
  "statusLights.line.hue": "Hue light on bridge {bridge}",

  "statusLights.error.unavailable":
    "This Phoenix Core has no OS credential store, so a credential cannot be kept.",
  "statusLights.error.save": "The light list could not be saved. Check the name and address.",
  "statusLights.error.capability": "The Status lights setting could not be changed.",
  "statusLights.error.hueName":
    "Give the bridge a name of letters, digits and . _ : - (up to 160 characters).",
  "statusLights.error.hueInspect":
    "The bridge did not answer on that address. Use its IPv4 address on your own network.",
  "statusLights.error.huePair":
    "Pairing failed. Press the round link button on the bridge, then try again.",
  "statusLights.error.hueRemove": "The bridge could not be removed.",
  "statusLights.error.hueLights": "The lights on this bridge could not be listed.",
  "statusLights.error.luxaforToken":
    "The token was not saved. It needs 1 to 128 printable characters without spaces.",
  "statusLights.error.lifx": "LIFX discovery did not finish. Wait a few seconds and try again.",
  "statusLights.error.quietInvalid": "Enter two times and a real time zone, such as Europe/Paris.",

  "statusLights.hue.title": "Philips Hue",
  "statusLights.hue.notAvailable":
    "Hue is not available: this Phoenix Core has no OS credential store.",
  "statusLights.hue.loadFailed": "Hue bridges could not be loaded.",
  "statusLights.hue.intro":
    "A paired bridge is trusted only while it presents the certificate whose SHA-256 fingerprint you confirmed. Its application key is kept in your OS credential store and is never shown.",
  "statusLights.hue.empty": "No bridge paired.",
  "statusLights.hue.bridgeLine": "at {address}:{port}",
  "statusLights.hue.fingerprint": "SHA-256 fingerprint:",
  "statusLights.hue.find": "Show lights",
  "statusLights.hue.findNamed": "Show the lights on bridge {name}",
  "statusLights.hue.remove": "Remove bridge",
  "statusLights.hue.removeNamed": "Remove bridge {name}",
  "statusLights.hue.removeNote":
    "Removing a bridge deletes its stored key. Lights that use it are no longer contacted.",
  "statusLights.hue.noLights": "This bridge reported no lights.",
  "statusLights.hue.alreadyAdded": "Added",
  "statusLights.hue.add": "Add",
  "statusLights.hue.addNamed": "Add Hue light {name}",
  "statusLights.hue.pairTitle": "Pair a bridge",
  "statusLights.hue.name": "Name for this bridge",
  "statusLights.hue.address": "Bridge address on your network (for example 192.168.1.2)",
  "statusLights.hue.lookup": "Read the bridge certificate",
  "statusLights.hue.confirmGroup": "Confirm the bridge certificate",
  "statusLights.hue.found": "A bridge answered at {address}:{port}.",
  "statusLights.hue.certName": "Certificate subject: {name}",
  "statusLights.hue.linkStep":
    "Press the round link button on top of the bridge now, then confirm below. Pairing is refused unless the button was pressed in the last 30 seconds or so.",
  "statusLights.hue.confirm":
    "I compared this fingerprint with the one on my bridge, and I trust this bridge.",
  "statusLights.hue.pair": "Pair and pin this fingerprint",
  "statusLights.hue.cancel": "Cancel",

  "statusLights.luxafor.title": "Luxafor",
  "statusLights.luxafor.intro":
    "Phoenix talks only to the Luxafor app's local webhook, over plain HTTP on your own network. The app answers success whatever the token is, so a saved token does not prove the light changed.",
  "statusLights.luxafor.name": "Name of this Luxafor light",
  "statusLights.luxafor.address": "Address of the computer running the Luxafor app",
  "statusLights.luxafor.add": "Add Luxafor light",
  "statusLights.luxafor.token": "Webhook token",
  "statusLights.luxafor.tokenNamed": "Webhook token for {name}",
  "statusLights.luxafor.save": "Set or replace token",
  "statusLights.luxafor.saved": "Token saved.",
  "statusLights.luxafor.writeOnly":
    "The token is never shown again. To clear it, remove this light.",

  "statusLights.lifx.title": "LIFX",
  "statusLights.lifx.intro":
    "Discovery sends one broadcast on your network and lists the lights that answer. Nothing is added and no colour is sent until you enable a light.",
  "statusLights.lifx.discover": "Find LIFX lights",
  "statusLights.lifx.none": "No LIFX light answered.",
  "statusLights.lifx.line": "LIFX light {serial} at {address}",
  "statusLights.lifx.added": "Added",
  "statusLights.lifx.enable": "Add this light",
  "statusLights.lifx.enableNamed": "Add LIFX light {serial}",

  "statusLights.quiet.title": "Quiet hours",
  "statusLights.quiet.intro": "Lights stay dark between these times, in the time zone you choose.",
  "statusLights.quiet.off": "Quiet hours are off.",
  "statusLights.quiet.on": "Lights are dark from {start} to {end} ({timezone}).",
  "statusLights.quiet.start": "From",
  "statusLights.quiet.end": "Until",
  "statusLights.quiet.timezone": "Time zone",
  "statusLights.quiet.save": "Save quiet hours",
  "statusLights.quiet.clear": "Turn off quiet hours",
} as const;
