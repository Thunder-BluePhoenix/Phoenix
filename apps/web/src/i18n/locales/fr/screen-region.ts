// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "Capturer une région pour un ticket",
  "screenRegion.intro":
    "Choisissez Choisir une région de l’écran, confirmez dans Approbations, puis faites glisser la zone voulue avec le sélecteur du système (Échap annule). Uniquement sur macOS. L’image reste sur cette page et n’est pas enregistrée. Le ticket lui-même est créé en texte seul, après votre approbation. Pour Linear et Jira, vous pouvez ensuite joindre l’image masquée à ce ticket dans une étape séparée, avec sa propre confirmation ; GitHub reste en texte seul.",
  "screenRegion.projectLabel":
    "Dépôt GitHub (owner/name), ID d’équipe Linear ou clé de projet Jira",
  "screenRegion.linearTeamInvalid":
    "Un ID d’équipe Linear ressemble à 6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f ; rien n’a été envoyé.",
  "screenRegion.jiraProjectInvalid":
    "Une clé de projet Jira se compose de majuscules, de chiffres ou de tirets bas, par exemple PROJ ; rien n’a été envoyé.",
  "screenRegion.issuesUnavailable":
    "La capacité Suivi des tickets est désactivée ou n’a pas les commandes de création et de pièce jointe ; rien n’a été envoyé. Activez-la d’abord.",
  "screenRegion.issuesNoWriteCredential":
    "Aucun identifiant d’écriture pour {tracker} n’est défini dans Suivi des tickets (les clés d’interrogation ne servent jamais à écrire) ; rien n’a été envoyé.",
  "screenRegion.issueKeyInvalid": "Ce n’est pas une clé de ticket valide ; rien n’a été envoyé.",
  "focus.screenshot.textOnly":
    "Le ticket est créé en texte seul. La capture n’en fait pas partie ; pour Linear et Jira, vous pourrez la proposer ensuite séparément.",
  "focus.screenshot.attach.title": "Joindre la capture (facultatif)",
  "focus.screenshot.attach.intro":
    "Le ticket {key} de {tracker} a été créé sans l’image. Vous pouvez maintenant y joindre la capture masquée. C’est un envoi séparé que Core vous demande d’approuver à nouveau. GitHub ne reçoit jamais l’image.",
  "focus.screenshot.attach.prepare": "Afficher ce qui serait joint",
  "focus.screenshot.attach.details": "Ce qui serait joint",
  "focus.screenshot.attach.tracker": "Service : {tracker}",
  "focus.screenshot.attach.issue": "Ticket : {key}",
  "focus.screenshot.attach.file": "Nom du fichier : {name}",
  "focus.screenshot.attach.size": "Taille : {bytes} octets",
  "focus.screenshot.attach.hash": "Empreinte du contenu (SHA-256, 12 premiers caractères) : {hash}",
  "focus.screenshot.attach.redacted":
    "Voici l’image telle qu’elle est masquée et annotée sur cette page ; les masquages sont déjà intégrés. Rien n’a encore été envoyé.",
  "focus.screenshot.attach.confirm": "Oui, envoyer cette image à {tracker}",
  "focus.screenshot.attach.send": "Demander l’approbation et joindre",
  "focus.screenshot.attach.done": "La capture a été jointe à {key}.",
  "focus.screenshot.attach.problem.badImage":
    "L’image n’est pas un PNG valide et n’a pas été envoyée.",
  "focus.screenshot.attach.problem.tooLarge": "L’image dépasse 5 Mio et n’a pas été envoyée.",
  "focus.screenshot.attach.problem.changed":
    "L’image a changé après votre relecture ; relisez-la. Rien n’a été envoyé.",
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
};
