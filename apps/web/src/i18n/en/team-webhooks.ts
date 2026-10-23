// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Settings screen for incoming webhook sources (Phase 92). */
export const teamWebhooks = {
  "teamWebhooks.title": "Incoming webhooks",
  "teamWebhooks.intro":
    "Incoming webhooks are off by default. A source gives another tool its own address and secret; when that tool sends a correctly signed message, Phoenix turns it into a local event. Nothing is sent anywhere, and what a source sends is treated as untrusted text.",
  "teamWebhooks.notAvailable":
    "Incoming webhooks are not available: this Phoenix Core has no operating system secret store to keep source secrets in.",
  "teamWebhooks.loadFailed": "Incoming webhooks could not be loaded.",
  "teamWebhooks.master": "Accept incoming webhooks",

  "teamWebhooks.secret.title": "Secret for {id}",
  "teamWebhooks.secret.warning":
    "This secret is shown only once. Copy it now and keep it in the sending tool. Phoenix keeps it only in the operating system secret store and cannot show it again; if you lose it, delete the source and create a new one.",
  "teamWebhooks.secret.path": "Address to send to (on this Core)",
  "teamWebhooks.secret.label": "Signing secret",
  "teamWebhooks.secret.copy": "Copy secret",
  "teamWebhooks.secret.copied": "Copied to the clipboard.",
  "teamWebhooks.secret.copyFailed":
    "Phoenix could not use the clipboard. Select the secret above and copy it by hand before you close this.",
  "teamWebhooks.secret.done": "I have saved it, close",

  "teamWebhooks.sources.title": "Sources",
  "teamWebhooks.sources.none": "You have not created any webhook sources yet.",
  "teamWebhooks.row.path": "Address: {path}",
  "teamWebhooks.row.types": "Event types: {types}",
  "teamWebhooks.row.never": "Nothing received yet.",
  "teamWebhooks.row.last": "Last accepted: {time}",
  "teamWebhooks.delete.label": "Delete source {id}",
  "teamWebhooks.delete.ask":
    "Delete {id}? Its secret stops working immediately and the sending tool must be changed.",

  "teamWebhooks.create.title": "Create a source",
  "teamWebhooks.create.id": "Source name",
  "teamWebhooks.create.idHint":
    "3 to 32 characters: lowercase letters, digits, - or _, starting with a letter.",
  "teamWebhooks.create.types": "Event types it may send",
  "teamWebhooks.create.typesHint":
    "Separate with commas, for example ci.finished. Each type starts with one of: {namespaces}.",
  "teamWebhooks.create.typesTooMany": "List at most {max} event types.",
  "teamWebhooks.create.typesInvalid":
    "An event type is lowercase words joined by dots, such as ci.finished.",
  "teamWebhooks.create.typesNamespace": "An event type must start with one of: {namespaces}.",
  "teamWebhooks.create.limit": "You have reached the limit of {max} sources. Delete one first.",
  "teamWebhooks.create.submit": "Create source",

  "teamWebhooks.row.disabledNote":
    "This source is disabled: Phoenix refuses everything sent to it.",
  "teamWebhooks.toggle.enable": "Enable",
  "teamWebhooks.toggle.disable": "Disable",
  "teamWebhooks.toggle.enableLabel": "Enable source {id}",
  "teamWebhooks.toggle.disableLabel": "Disable source {id}",
  "teamWebhooks.rotate.button": "Rotate secret",
  "teamWebhooks.rotate.label": "Rotate the secret of source {id}",
  "teamWebhooks.rotate.ask":
    "Rotate the secret of {id}? The old secret stops working immediately, so the sending tool is refused until you give it the new secret.",
  "teamWebhooks.secret.rotatedNote":
    "This is the new secret. The old secret has stopped working; update the sending tool with this one.",
} as const;
