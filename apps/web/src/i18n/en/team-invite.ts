// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** The team invite: share my identity, and add a teammate from a pasted invite (Phase 92). */
export const teamInvite = {
  "teamInvite.share.title": "Share my identity",
  "teamInvite.share.intro":
    "Send this invite to a teammate by chat or email. It holds only your team id, your public key and the name you type below. It has no secret in it, and your private key never leaves this computer.",
  "teamInvite.share.label": "Name to put in the invite (optional)",
  "teamInvite.share.invalid": "An invite could not be made from this identity.",
  "teamInvite.share.invite": "Your invite",
  "teamInvite.share.copy": "Copy invite",
  "teamInvite.share.copied": "Invite copied to the clipboard.",
  "teamInvite.share.copyFailed":
    "Phoenix could not use the clipboard. Select the invite above and copy it by hand.",
  "teamInvite.share.fingerprintHint":
    "Read the fingerprint to your teammate by voice or in another chat, so they can check that the invite they received is yours.",
  "teamInvite.fingerprint": "Key fingerprint",
  "teamInvite.checksumNote":
    "The short code at the end of an invite only catches copying mistakes. It does not prove who made the invite; only comparing the fingerprint does.",
  "teamInvite.refusal.empty": "Paste an invite first.",
  "teamInvite.refusal.tooLong": "That is too long to be a team invite.",
  "teamInvite.refusal.format": "That is not a Phoenix team invite.",
  "teamInvite.refusal.version":
    "This invite is from a different version of Phoenix that this one cannot read.",
  "teamInvite.refusal.checksum":
    "The invite was changed or copied incorrectly. Ask your teammate to send it again.",
  "teamInvite.refusal.content": "The invite is damaged or has unexpected contents.",
  "teamInvite.refusal.id": "The invite has an invalid team id.",
  "teamInvite.refusal.key": "The invite has an invalid public key.",
  "teamInvite.refusal.label": "The invite has an invalid name.",
  "teamInvite.refusal.unsupported": "This browser cannot check invites.",
  "teamInvite.refusal.own": "That invite is your own identity.",
  "teamInvite.refusal.duplicate":
    "That teammate is already on your list. Remove them first to change their key.",
  "teamInvite.add.title": "Add a teammate",
  "teamInvite.add.paste": "Paste a teammate's invite",
  "teamInvite.add.preview": "Check these details before you add this teammate.",
  "teamInvite.add.noLabel": "The invite has no name; type one to show.",
  "teamInvite.add.theirLabel": "The invite says the name is: {label}",
  "teamInvite.add.confirm":
    "I compared this fingerprint with my teammate by voice or in another chat, and it matches.",
} as const;
