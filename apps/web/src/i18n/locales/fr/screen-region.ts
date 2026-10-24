// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "Capturer une région pour un ticket",
  "screenRegion.intro":
    "Choisissez Choisir une région de l’écran, confirmez dans Approbations, puis faites glisser la zone voulue avec le sélecteur du système (Échap annule). Uniquement sur macOS. L’image reste sur cette page et n’est pas enregistrée ; le ticket est créé en texte seul, sur GitHub, après une nouvelle approbation.",
  "screenRegion.unavailable":
    "La capture de région est désactivée. Activez la capacité Capture de région d’écran et autorisez la capture d’écran pour l’utiliser. Elle ne fonctionne que sur macOS.",
  "screenRegion.cancelled": "Vous avez annulé la sélection, rien n’a été capturé.",
  "screenRegion.declined": "Vous avez refusé, rien n’a donc été capturé.",
  "screenRegion.blocked": "L’arrêt d’urgence est activé, rien n’a donc été capturé.",
  "screenRegion.timeout":
    "Aucune région n’a été choisie à temps ou la demande n’a pas été approuvée ; rien n’a été capturé.",
  "screenRegion.failed": "La région n’a pas pu être capturée : {message}",
  "screenRegion.badImage": "La capture n’était pas une image PNG valide et a été écartée.",
  "screenRegion.tooLarge": "La région capturée dépasse 5 Mio et a été écartée.",
  "screenRegion.unsupported": "La capture de région n’est prise en charge que sur macOS.",
  "screenRegion.expired": "La capture n’était plus disponible. Choisissez à nouveau une région.",
  "screenRegion.trackerUnsupported":
    "Seul GitHub peut créer un ticket d’ici ; Linear et Jira ne le peuvent pas encore, rien n’a donc été envoyé.",
};
