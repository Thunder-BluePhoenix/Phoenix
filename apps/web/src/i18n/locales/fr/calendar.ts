// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { calendar as enCalendar } from "../../en/calendar";

/** Machine-translated; unreviewed. */
export const calendar: Record<keyof typeof enCalendar, string> = {
  "calendar.title": "Préparation des réunions",
  "calendar.disabled": "Le calendrier est désactivé. Activez-le pour voir les prochaines réunions.",
  "calendar.empty": "Aucune réunion à venir.",
  "calendar.loading": "Lecture des réunions…",
  "calendar.error": "Impossible de lire le calendrier.",
  "calendar.refresh": "Actualiser les réunions",
  "calendar.prep": "Préparation",
  "calendar.decisions": "Décisions précédentes",
  "calendar.actions": "Actions en cours",
  "calendar.noPrep": "Aucune décision validée ni action ouverte pertinente.",
  "calendar.notetaker": "Démarrer la prise de notes",
  "calendar.notetakerInfo":
    "L’enregistrement ne démarre qu’après votre choix et votre autorisation.",
  "calendar.freeze": "Gel des déploiements",
  "calendar.busy": "Événement privé",
  "calendar.source": "De {meeting}",
  "calendar.unconfigured":
    "Aucun fournisseur de calendrier n’est connecté. Connectez Google, Microsoft, CalDAV ou Calendrier macOS pour voir les réunions.",
  "calendar.unavailable":
    "Le flux du calendrier est indisponible. Les prochaines réunions et les gels de déploiement ne peuvent pas être affichés.",
  "calendar.stale":
    "Le flux du calendrier est obsolète. Les réunions et gels de déploiement ne sont pas fiables tant qu’il n’est pas actualisé.",
  "calendar.lastChecked": "Dernière lecture réussie : {time}",
  "calendar.prepIncomplete": "La préparation est incomplète pour certaines réunions.",
};
