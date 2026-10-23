// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for Fawkes' sounds (Settings > Fawkes sounds). */
export const sounds = {
  "sounds.title": "Fawkes sounds",
  "sounds.intro":
    "Short tones that Fawkes makes when something happens. Off by default. They are made by Phoenix itself and never play in quiet mode, in quiet hours, while muted, during the emergency stop or in the demo.",
  "sounds.enabled": "Let Fawkes make sounds",
  "sounds.volume": "Volume",
  "sounds.volumeValue": "{percent} percent",
  "sounds.event.launch": "Hello",
  "sounds.event.poke": "Poke",
  "sounds.event.dizzy": "Dizzy",
  "sounds.event.recover": "Recovered",
  "sounds.event.completion": "Task finished",
  "sounds.event.needsYou": "Needs you",
  "sounds.event.failure": "Something failed",
  "sounds.preview.legend": "Listen to a sound",
  "sounds.preview.play": "Play: {name}",
  "sounds.preview.hint":
    "A preview plays at the volume above even while sounds are off, and only after you have used the page.",
  "sounds.preview.muted": "Fawkes is muted, so nothing was played.",
  "sounds.preview.silentVolume": "The volume is 0, so nothing was played.",
  "sounds.preview.quiet":
    "Quiet mode, quiet hours, the emergency stop or the demo is on, so nothing was played.",
  "sounds.preview.noGesture": "Click or press a key on the page first, then try again.",
  "sounds.preview.failed": "The sound could not be played on this device.",
  "sounds.saveFailed": "Could not save the sound settings.",
  "sounds.loadFailed": "Could not load the sound settings.",
  "sounds.note":
    "A folder of your own sounds is not available yet; only Phoenix's built-in tones are used.",
} as const;
