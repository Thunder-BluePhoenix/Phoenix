// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { sounds as ensounds } from "../../en/sounds";

/** Machine-translated; unreviewed (see ../../README.md). */
export const sounds: Record<keyof typeof ensounds, string> = {
  "sounds.title": "Sons de Fawkes",
  "sounds.intro":
    "Courtes tonalités que Fawkes émet quand quelque chose se passe. Désactivées par défaut. Elles sont produites par Phoenix lui-même et ne jouent jamais en mode silencieux, pendant les heures calmes, en sourdine, pendant l’arrêt d’urgence ni dans la démo.",
  "sounds.enabled": "Autoriser Fawkes à faire des sons",
  "sounds.volume": "Volume",
  "sounds.volumeValue": "{percent} pour cent",
  "sounds.event.launch": "Bonjour",
  "sounds.event.poke": "Pichenette",
  "sounds.event.dizzy": "Étourdi",
  "sounds.event.recover": "Rétabli",
  "sounds.event.completion": "Tâche terminée",
  "sounds.event.needsYou": "A besoin de vous",
  "sounds.event.failure": "Quelque chose a échoué",
  "sounds.preview.legend": "Écouter un son",
  "sounds.preview.play": "Jouer : {name}",
  "sounds.preview.hint":
    "Un aperçu se joue au volume ci-dessus même quand les sons sont désactivés, et seulement après que vous avez utilisé la page.",
  "sounds.preview.muted": "Fawkes est en sourdine, rien n’a donc été joué.",
  "sounds.preview.silentVolume": "Le volume est à 0, rien n’a donc été joué.",
  "sounds.preview.quiet":
    "Le mode silencieux, les heures calmes, l’arrêt d’urgence ou la démo est actif, rien n’a donc été joué.",
  "sounds.preview.noGesture":
    "Cliquez ou appuyez d’abord sur une touche dans la page, puis réessayez.",
  "sounds.preview.failed": "Le son n’a pas pu être joué sur cet appareil.",
  "sounds.saveFailed": "Impossible d’enregistrer les réglages du son.",
  "sounds.loadFailed": "Impossible de charger les réglages du son.",
  "sounds.note":
    "Un dossier de vos propres sons n’est pas encore disponible ; seules les tonalités intégrées de Phoenix sont utilisées.",
};
