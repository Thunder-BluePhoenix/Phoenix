// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { awakeSettings as enAwakeSettings } from "../../en/awake-settings";

/** Machine-translated; unreviewed. */
export const awakeSettings: Record<keyof typeof enAwakeSettings, string> = {
  "awakeSettings.title": "Rester éveillé",
  "awakeSettings.intro":
    "Empêche cet ordinateur de se mettre en veille pendant une durée donnée, par exemple pendant qu’une compilation ou un agent tourne. Une session a toujours une fin : de 1 minute à 7 jours.",
  "awakeSettings.approval":
    "Démarrer, prolonger et terminer une session demandent chacun d’abord votre approbation dans Approbations. Rien ne change tant que vous n’avez pas approuvé.",
  "awakeSettings.off": "« Rester éveillé » est désactivé : aucune session ne peut démarrer.",
  "awakeSettings.enable": "Activer « Rester éveillé »",
  "awakeSettings.status.title": "Session en cours",
  "awakeSettings.status.idle":
    "Aucune session en cours. L’ordinateur se met en veille normalement.",
  "awakeSettings.status.unreadable": "L’état de « Rester éveillé » n’a pas pu être lu.",
  "awakeSettings.status.mode.timed": "(minutée)",
  "awakeSettings.status.mode.agents_grace": "(pendant que les agents travaillent)",
  "awakeSettings.status.label": "Libellé : {label}",
  "awakeSettings.end.button": "Terminer la session",
  "awakeSettings.start.title": "Démarrer une session",
  "awakeSettings.start.durations": "Durées prédéfinies",
  "awakeSettings.start.minutes": "Minutes",
  "awakeSettings.start.label": "Libellé (facultatif)",
  "awakeSettings.start.labelInvalid":
    "Le libellé doit comporter de 1 à {max} caractères, sans caractères de contrôle ni invisibles.",
  "awakeSettings.start.submit": "Demander le démarrage",
  "awakeSettings.outcome.waiting": "En attente de votre approbation dans Approbations…",
  "awakeSettings.outcome.succeeded.start": "Approuvé : la session a démarré.",
  "awakeSettings.outcome.succeeded.extend": "Approuvé : du temps a été ajouté à la session.",
  "awakeSettings.outcome.succeeded.end": "Approuvé : la session est terminée.",
  "awakeSettings.outcome.denied": "Vous avez refusé : rien n’a été modifié.",
  "awakeSettings.outcome.blocked": "L’arrêt d’urgence est actif : rien n’a été modifié.",
  "awakeSettings.outcome.timeout":
    "La demande n’a pas été approuvée à temps ou a été annulée : rien n’a été modifié.",
  "awakeSettings.outcome.failed": "« Rester éveillé » n’a pas pu le faire : {message}",
};
