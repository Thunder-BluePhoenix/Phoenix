// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { digest as endigest } from "../../en/digest";

/** Machine-translated; unreviewed. */
export const digest: Record<keyof typeof endigest, string> = {
  "digest.title": "Résumé quotidien",
  "digest.yesterday": "Hier",
  "digest.today": "Aujourd’hui (plans confirmés)",
  "digest.blockers": "Obstacles",
  "digest.endOfDay": "Fin de journée",
  "digest.source": "Source",
  "digest.none": "Aucune activité liée",
  "digest.date": "Date",
  "digest.localNote": "Créé localement à partir des activités liées. Aucun modèle cloud utilisé.",
  "digest.error": "Impossible de charger ou copier le résumé.",
  "digest.loading": "Chargement du résumé…",
  "digest.copy": "Copier avec les sources",
  "digest.copied": "Copié",
  "digest.sendUnavailable":
    "L’envoi vers Slack et Teams est indisponible sans intégration approuvée.",
  "digest.back": "Retour au résumé",
  "digest.eventTitle": "Preuve de l’événement",
  "digest.eventMissing": "Cet événement n’est plus disponible.",
  "digest.unverified":
    "Non vérifié : il s’agit d’une déclaration d’événement stockée localement, non vérifiée par un fournisseur.",
  "digest.commitTitle": "Commit",
  "digest.commitMissing": "Ce commit n’est pas dans un dépôt surveillé.",
  "digest.noneIncomplete": "Rien trouvé dans les sources lisibles.",
  "digest.noticeHeading": "Résumé incomplet",
  "digest.noticeUnavailable": "Lecture impossible, il peut donc manquer de l’activité : {sources}.",
  "digest.noticePartial":
    "Seuls les enregistrements les plus récents ont été lus ; l’activité plus ancienne peut manquer : {sources}.",
  "digest.noticeUnattributed":
    "Aucune identité git (user.email) n’est configurée ; les commits ont été exclus plutôt que présentés comme les vôtres : {sources}.",
  "digest.sources.git": "dépôts git",
  "digest.sources.events": "historique des événements",
  "digest.sources.sessions": "sessions d’agent",
  "digest.sources.meetings": "réunions",
};
