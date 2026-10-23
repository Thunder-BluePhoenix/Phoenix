// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { serviceGlances as enServiceGlances } from "../../en/service-glances";

/** Machine-translated; unreviewed (see ../../README.md). */
export const serviceGlances: Record<keyof typeof enServiceGlances, string> = {
  "services.glance.heading": "{name} en un coup d’œil",
  "services.glance.disabled": "{name} est désactivé. Activez-le dans Capacités pour le voir ici.",
  "services.glance.loading": "Chargement…",
  "services.glance.error": "Impossible de lire {name}.",
  "services.glance.stale": "Impossible d’actualiser {name} ; dernières données affichées.",
  "services.glance.unreadable": "{name} a renvoyé des données que cette page ne peut pas lire.",
  "services.glance.updated": "Mis à jour {time}",
  "services.glance.state.unknown": "Inconnu",
  "services.glance.vercel.notConfigured":
    "Ajoutez un jeton Vercel dans les Réglages pour voir les déploiements.",
  "services.glance.vercel.empty": "Aucun déploiement pour l’instant.",
  "services.glance.vercel.summary": "Déploiements récents : {count}",
  "services.glance.vercel.failed": "Échoués : {count}",
  "services.glance.vercel.building": "En cours : {count}",
  "services.glance.vercel.state.queued": "En file d’attente",
  "services.glance.vercel.state.initializing": "Démarrage",
  "services.glance.vercel.state.building": "Compilation",
  "services.glance.vercel.state.ready": "Prêt",
  "services.glance.vercel.state.error": "Échoué",
  "services.glance.vercel.state.canceled": "Annulé",
  "services.glance.stripe.notConfigured":
    "Ajoutez dans les Réglages une clé Stripe restreinte en lecture seule pour voir les paiements.",
  "services.glance.stripe.empty": "Aucun paiement récent.",
  "services.glance.stripe.counted": "Derniers paiements comptés : {count}",
  "services.glance.stripe.succeeded": "Réussis : {count}",
  "services.glance.stripe.failed": "Échoués : {count}",
  "services.glance.stripe.pending": "En attente : {count}",
  "services.glance.stripe.received": "Reçu : {amounts}",
  "services.glance.stripe.failedAmount": "Montants échoués : {amounts}",
  "services.glance.stripe.available": "Solde disponible : {amounts}",
  "services.glance.stripe.pendingBalance": "Solde en attente : {amounts}",
  "services.glance.stripe.privacy":
    "Montants et nombres uniquement. Les clients et les cartes ne sont jamais affichés.",
  "services.glance.stripe.state.succeeded": "Réussi",
  "services.glance.stripe.state.failed": "Échoué",
  "services.glance.stripe.state.pending": "En attente",
  "services.glance.stripe.state.refunded": "Remboursé",
  "services.glance.n8n.notConfigured":
    "Indiquez votre adresse n8n et ajoutez une clé d’API dans les Réglages pour voir les exécutions.",
  "services.glance.n8n.empty": "Aucune exécution récente.",
  "services.glance.n8n.summary": "Exécutions récentes : {count}",
  "services.glance.n8n.failed": "Échouées : {count}",
  "services.glance.n8n.workflows": "Workflows actifs : {active} sur {total}",
  "services.glance.n8n.host": "La clé d’API est envoyée à {host}",
  "services.glance.n8n.state.success": "Réussie",
  "services.glance.n8n.state.error": "Échouée",
  "services.glance.n8n.state.crashed": "Plantée",
  "services.glance.n8n.state.running": "En cours",
  "services.glance.n8n.state.waiting": "En attente",
  "services.glance.n8n.state.new": "En file d’attente",
};
