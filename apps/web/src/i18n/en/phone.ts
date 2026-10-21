// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for the phone screens. */
export const phone = {
  "phone.title": "Phone link",
  "phone.intro":
    "Pair a phone so it can approve or refuse things Phoenix asks about. It is off until you turn it on.",
  "phone.unavailable": "Phone link settings could not be loaded.",

  "phone.warning.title": "Before you turn this on",
  "phone.warning.network":
    "Turning it on opens a separate HTTPS listener that other devices on your local network can reach (not the internet).",
  "phone.warning.pairing":
    "Only phones you pair, and then confirm here, can approve anything. Pairing needs a code shown on this screen.",
  "phone.warning.trust": "Only turn it on for networks you trust, such as your home network.",
  "phone.warning.presence":
    "Phoenix cannot check that a person is at this computer: any program on this computer that holds the Core session token can also pair phones.",

  "phone.enable.label": "Allow phones on my local network to connect",
  "phone.saved.on": "Phone link is on.",
  "phone.saved.off": "Phone link is off.",
  "phone.saved.verifyOn": "Approvals from a phone now ask for biometric or device verification.",
  "phone.saved.verifyOff": "Approvals from a phone no longer ask for device verification.",
  "phone.killSwitch":
    "The kill switch is on, so the phone listener is closed. Turn the phone link on again here after you release the kill switch.",
  "phone.lockedOut": "Pairing is locked until {time} because too many wrong codes were entered.",
  "phone.notListening": "Phone link is on, but the listener is not running yet.",
  "phone.addressChanged":
    "The network address you chose is no longer available, so the phone link stays off. Choose an address again to turn it back on.",

  "phone.listen.address": "Address and port",
  "phone.listen.fingerprint": "Certificate fingerprint (SHA-256)",

  "phone.pair.show": "Show pairing code",
  "phone.pair.cancel": "Cancel code",
  "phone.pair.cancelled": "Pairing code cancelled.",
  "phone.pair.expired": "The pairing code expired. Show a new one to pair a phone.",
  "phone.pair.instruction":
    "On the phone, enter or scan this code, and check that the fingerprint it shows matches the one below. If it does not match, do not continue.",
  "phone.pair.codeLabel": "Pairing code",
  "phone.pair.remaining": "Expires in {time}",
  "phone.pair.fingerprint": "Certificate fingerprint:",
  "phone.pair.link": "Pairing link (a QR code is not available):",
  "phone.pair.hiddenActive":
    "A pairing code is active until {time}. It is not shown again; cancel it and show a new one.",

  "phone.pending.question": 'Pair "{name}"?',
  "phone.pending.fingerprint": "Key fingerprint",
  "phone.pending.yes": "Yes, pair this phone",
  "phone.pending.no": "No, refuse",
  "phone.pending.waiting": "Waiting for Phoenix to ask for your confirmation.",
  "phone.pending.approved": "Phone paired.",
  "phone.pending.rejected": "Pairing refused.",

  "phone.verify.label": "Require biometric or device verification on approvals",
  "phone.verify.note":
    "The phone reports whether the person was verified (fingerprint, face or screen lock). Phoenix cannot check that report itself.",

  "phone.devices.title": "Paired phones",
  "phone.devices.none": "No phones are paired.",
  "phone.devices.fingerprint": "Key fingerprint",
  "phone.devices.created": "Paired {date}",
  "phone.devices.lastSeen": "last seen {when}",
  "phone.devices.neverSeen": "never seen",
  "phone.devices.revoked": "Revoked {date}",
  "phone.devices.revoke": "Revoke {name}",
  "phone.devices.revokeAsk": 'Revoke "{name}"? It will no longer be able to approve anything.',
  "phone.devices.revokeYes": "Yes, revoke",
  "phone.devices.revokeNo": "Keep it",
  "phone.devices.revokedDone": "Phone revoked.",
  "phone.device.unnamed": "Unnamed phone",
} as const;
