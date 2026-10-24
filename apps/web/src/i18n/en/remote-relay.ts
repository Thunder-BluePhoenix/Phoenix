// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Settings screen for the remote access relay (Phase 87). */
export const remoteRelay = {
  "relay.title": "Remote relay",
  "relay.intro":
    "A relay lets a paired phone answer Phoenix's pending approvals when it is not on your home network. It is off by default and you choose the relay address. Nothing is sent until you turn it on.",
  "relay.notAvailable":
    "The remote relay is not available: this Phoenix Core has no operating system secret store to keep the relay key in.",
  "relay.loadFailed": "The remote relay status could not be loaded.",

  "relay.privacy.title": "What the relay can and cannot see",
  "relay.privacy.cannot":
    "It cannot read, change, forge or replay anything. Every message is end-to-end encrypted between Phoenix and a paired device, and a decision from a device is signed and checked by Phoenix before it counts.",
  "relay.privacy.sees":
    "It can see the random route id, which address a message is for (this computer or a device), and the size and time of each message. It can also drop, delay or repeat messages, or stop working.",
  "relay.privacy.tls":
    "A secure (https) connection to the relay hides that routing information from people on the network. The protection of the messages themselves does not depend on it.",

  "relay.status.title": "Status",
  "relay.status.off": "Off",
  "relay.status.connected": "On and connected to the relay",
  "relay.status.connecting": "On, not connected to the relay right now",
  "relay.status.url": "Relay address",
  "relay.status.route": "Route",
  "relay.status.lastError": "Last problem reported: {message}",

  "relay.enable.label": "Relay address",
  "relay.enable.hint":
    "Use an https:// address of a relay you run or trust. Plain http:// is accepted only for this computer.",
  "relay.enable.note":
    "Turning it on creates a new random route and a new relay key for this computer. The private key stays in the operating system secret store and is never shown.",
  "relay.enable.button": "Turn on",
  "relay.url.empty": "Enter the relay address.",
  "relay.url.tooLong": "The relay address is too long.",
  "relay.url.notUrl": "That is not a web address.",
  "relay.url.https": "The relay address must start with https://.",
  "relay.url.credentials":
    "The relay address cannot contain a user name, a password, a query or a fragment.",
  "relay.saved.on": "Remote relay turned on.",
  "relay.saved.off": "Remote relay turned off. The route and the relay key were discarded.",

  "relay.disable.button": "Turn off",
  "relay.disable.ask":
    "Turn off the remote relay? This discards the route and this computer's relay private key. Devices that pinned them stop working, and after you turn the relay on again they must be given the new details.",
  "relay.disable.yes": "Yes, turn off and discard",
  "relay.disable.no": "Keep it on",

  "relay.details.show": "Show the relay details for a device",
  "relay.details.hide": "Hide the details",
  "relay.details.title": "Details to give a device",
  "relay.details.intro":
    "A device pins these when it pairs. The pairing itself is the phone link pairing. Phoenix has no pairing code or link for the relay, so give these values to the device in a way you trust.",
  "relay.details.url": "Relay address",
  "relay.details.route": "Route id",
  "relay.details.key": "This computer's relay public key",
  "relay.details.warn":
    "The route id is an address, not a password. These details are hidden again when you close this panel, turn the relay off or the route changes.",

  "relay.devices.title": "Paired devices",
  "relay.devices.none": "No device is paired yet. Pair one in the phone link section.",
  "relay.devices.note":
    "These are the devices paired through the phone link. Revoking one there stops it on the relay on its very next message.",
  "relay.devices.loadFailed": "The paired devices could not be loaded.",
  "relay.devices.unnamed": "Unnamed device",
  "relay.devices.fingerprint": "Key fingerprint",
  "relay.devices.revoked": "Revoked {date}",
  "relay.devices.push": "Send approvals to {name}",
  "relay.devices.pushed": "Sent the pending approvals to {name}.",
} as const;
