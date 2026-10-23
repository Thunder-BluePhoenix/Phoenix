// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { serviceGlancesB as enServiceGlancesB } from "../../en/service-glances-b";

/** Machine-translated; unreviewed (see ../../README.md). */
export const serviceGlancesB: Record<keyof typeof enServiceGlancesB, string> = {
  "services.glance.resend.notConfigured":
    "Ajoutez une clé d’API Resend dans les secrets de la capacité Resend pour voir ici l’état des envois.",
  "services.glance.resend.empty": "Aucun e-mail envoyé récemment à compter.",
  "services.glance.resend.summary":
    "{count, plural, one {# e-mail récent} other {# e-mails récents}}",
  "services.glance.resend.newest": "Le plus récent : {time}",
  "services.glance.resend.privacy":
    "Décomptes uniquement. Les objets et les destinataires ne sont jamais affichés ici.",
  "services.glance.resend.state.delivered": "Remis",
  "services.glance.resend.state.inFlight": "En route",
  "services.glance.resend.state.delayed": "Retardé",
  "services.glance.resend.state.bounced": "Rejeté",
  "services.glance.resend.state.complained": "Marqué comme spam",
  "services.glance.resend.state.failed": "Échec",
  "services.glance.resend.state.other": "Autre",

  "services.glance.notion.notConfigured":
    "Ajoutez un jeton d’intégration Notion dans les secrets de la capacité Notion pour voir ici vos pages suivies.",
  "services.glance.notion.empty":
    "Aucune page ni base de données suivie à afficher. Listez-les par identifiant dans les réglages de la capacité Notion.",
  "services.glance.notion.summary":
    "{count, plural, one {# élément suivi} other {# éléments suivis}}",
  "services.glance.notion.privacy":
    "Titres et heures de modification uniquement. Le contenu des pages n’est jamais lu.",
  "services.glance.notion.untitled": "Sans titre",
  "services.glance.notion.kind.page": "Page",
  "services.glance.notion.kind.database": "Base de données",
  "services.glance.notion.kind.archived": "Archivé",
  "services.glance.notion.edited": "Modifié {time}",
  "services.glance.notion.open": "Ouvrir dans Notion",
  "services.glance.notion.openNamed": "Ouvrir {title} dans Notion",

  "services.glance.calcom.notConfigured":
    "Ajoutez une clé d’API Cal.com dans les secrets de la capacité Cal.com pour voir ici vos réservations.",
  "services.glance.calcom.empty": "Aucune réservation à venir.",
  "services.glance.calcom.summary":
    "{count, plural, one {# réservation à venir} other {# réservations à venir}}",
  "services.glance.calcom.privacy":
    "Heures et nombre de participants uniquement. Les noms et les adresses e-mail ne sont jamais affichés ici.",
  "services.glance.calcom.booking": "Réservation",
  "services.glance.calcom.status.accepted": "Confirmée",
  "services.glance.calcom.status.pending": "En attente de confirmation",
  "services.glance.calcom.status.other": "Autre",
  "services.glance.calcom.attendees": "{count, plural, one {# participant} other {# participants}}",
  "services.glance.calcom.more":
    "{count, plural, one {# réservation de plus} other {# réservations de plus}}",
};
