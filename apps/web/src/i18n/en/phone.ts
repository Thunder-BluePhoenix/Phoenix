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
  "phone.addressChanged.title": "This computer's address changed",
  "phone.addressChanged.mayNotReach":
    "A phone you already paired may not be able to reach this computer any more: it still remembers the old address. Nothing was opened on another network.",
  "phone.addressChanged.pick": "Network address",
  "phone.addressChanged.use": "Use this address",
  "phone.addressChanged.none":
    "No private local network address was found right now. Connect to your network and come back, or turn the phone link off.",
  "phone.addressChanged.off": "Turn the phone link off",
  "phone.addressChanged.repair":
    "After choosing an address, show a new pairing code and pair the phone again if it still cannot connect.",
  "phone.saved.address": "Phone link address changed.",

  "phone.port.label": "Port",
  "phone.port.save": "Save port",
  "phone.port.invalid": "Enter a whole number from 1024 to 65535.",
  "phone.port.note":
    "The phone link listens on this port (1024 to 65535; the default is 47821). A new port takes effect when the link next opens; if it is on now it restarts on the new port and any pairing code on screen stops working. Phones you paired earlier may still use the old port and need to be paired again.",
  "phone.saved.port": "Phone link port saved: {port}.",

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
  "phone.pair.link": "Pairing link (if the phone cannot scan the QR code):",
  "phone.pair.qrLabel": "QR code with the pairing link",
  "phone.pair.qrHint":
    "Scan it with the app on the phone you are pairing. It contains the code above, so show it only to your own phone.",
  "phone.pair.qrUnavailable": "A QR code could not be made for this link; use the link below.",
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
