// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { signals as ensignals } from "../../en/signals";

/** Machine-translated; unreviewed. */
export const signals: Record<keyof typeof ensignals, string> = {
  "signals.title": "Signaux d’ingénierie",
  "signals.intro":
    "Consultez les avis sur les dépendances, les tests instables, les tendances de durée et les écarts de clés de configuration dans les dépôts choisis. La lecture ne modifie aucun fichier.",
  "signals.root": "Dossier du dépôt",
  "signals.add": "Surveiller le dossier",
  "signals.remove": "Arrêter la surveillance",
  "signals.refresh": "Vérifier maintenant",
  "signals.empty": "Aucun signal actuel dans les dépôts surveillés.",
  "signals.unconfigured": "Choisissez un dossier de dépôt à surveiller.",
  "signals.error": "Impossible de lire les signaux d’ingénierie.",
  "signals.advisory": "Avis sur une dépendance",
  "signals.flaky_test": "Test instable",
  "signals.duration_trend": "Durée en hausse",
  "signals.config_drift": "Clé de configuration manquante",
  "signals.optin":
    "Les notifications proactives exigent un accord explicite et respectent les heures calmes et la limite horaire.",
  "signals.privacy":
    "Seuls les noms des clés sont comparés ; les valeurs ne sont jamais affichées.",
  "signals.unknown.advisories":
    "Avis sur les dépendances non évalués (état inconnu, pas « aucun problème ») :",
  "signals.unknown.history":
    "Historique des tests et tendances de durée non évalués (état inconnu, pas « aucun problème ») :",
};
