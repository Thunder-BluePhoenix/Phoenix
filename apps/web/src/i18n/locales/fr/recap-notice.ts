// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { recapNotice as enrecapNotice } from "../../en/recap-notice";

/** Machine-translated; unreviewed. */
export const recapNotice: Record<keyof typeof enrecapNotice, string> = {
  "recapNotice.title": "Notification du récapitulatif hebdomadaire",
  "recapNotice.intro":
    "Chaque lundi à 09:00 heure locale, affiche une notification dans la liste de notifications de Phoenix avec les chiffres de la semaine passée. Désactivé par défaut. Le texte est fixe et ne contient que des nombres (ni noms, ni chemins, ni titres), n’appelle aucun modèle ni le réseau, et est ignoré pendant les heures calmes du mode proactif, en mode silencieux des notifications et pendant un arrêt d’urgence. Au plus une par semaine ; si Phoenix ne tournait pas le lundi, elle s’affiche une fois plus tard dans la semaine.",
  "recapNotice.enable": "Afficher une notification de récapitulatif le lundi",
  "recapNotice.last": "Dernière notification pour la semaine {week}.",
  "recapNotice.never": "Aucune notification de récapitulatif hebdomadaire n’a encore été affichée.",
  "recapNotice.error":
    "Impossible de charger ou d’enregistrer le réglage de la notification du récapitulatif hebdomadaire.",
  "recapNotice.midweek": "L’activer en milieu de semaine attend le lundi suivant.",
};
