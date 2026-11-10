// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { capabilityLabels as enCapabilityLabels } from "../../en/capability-labels";

/** Machine-translated; unreviewed. */
export const capabilityLabels: Record<keyof typeof enCapabilityLabels, string> = {
  "capabilityLabels.kage.name": "Kage",
  "capabilityLabels.kage.description":
    "Capture de réunions, transcriptions et résumés depuis votre serveur Kage.",
  "capabilityLabels.git.name": "Git",
  "capabilityLabels.git.description":
    "Surveille les dépôts locaux sélectionnés : commits, branches et conflits.",
  "capabilityLabels.github.name": "GitHub",
  "capabilityLabels.github.description":
    "Pull requests, demandes de revue, exécutions d'Actions et déploiements des dépôts choisis.",
  "capabilityLabels.vercel.name": "Vercel",
  "capabilityLabels.vercel.description": "Déploiements Vercel de votre compte ou de votre équipe.",
  "capabilityLabels.stripe.name": "Stripe",
  "capabilityLabels.stripe.description":
    "Paiements Stripe récents et résumé en lecture seule des nombres, montants et solde.",
  "capabilityLabels.n8n.name": "n8n",
  "capabilityLabels.n8n.description": "Exécutions de workflows de votre propre n8n.",
  "capabilityLabels.resend.name": "Resend",
  "capabilityLabels.resend.description":
    "Statut de livraison des e-mails envoyés par votre compte Resend.",
  "capabilityLabels.notion.name": "Notion",
  "capabilityLabels.notion.description":
    "Prévient Fawkes quand une page ou base Notion de votre liste est modifiée.",
  "capabilityLabels.calcom.name": "Cal.com",
  "capabilityLabels.calcom.description":
    "Réservations Cal.com à venir, avec un rappel peu avant le début.",
  "capabilityLabels.calendar.name": "Aperçu du calendrier",
  "capabilityLabels.calendar.description":
    "Réunions à venir et périodes de gel des déploiements, en lecture seule.",
  "capabilityLabels.spotify.name": "Spotify",
  "capabilityLabels.spotify.description":
    "Ce que lit l'app de bureau Spotify, et contrôles de lecture sur macOS.",
  "capabilityLabels.apple-music.name": "Apple Music",
  "capabilityLabels.apple-music.description":
    "Ce que lit l'app Musique, et contrôles de lecture sur macOS.",
  "capabilityLabels.mpris.name": "Lecteurs multimédias Linux (MPRIS)",
  "capabilityLabels.mpris.description":
    "Ce que lit un lecteur multimédia local, et contrôles de lecture sur Linux et Windows.",
  "capabilityLabels.portfolio.name": "Portefeuille",
  "capabilityLabels.portfolio.description":
    "Portefeuille crypto en lecture seule : soldes des adresses publiques et des plateformes d'échange.",
  "capabilityLabels.terminal.name": "Terminal",
  "capabilityLabels.terminal.description":
    "Affiche les commandes lancées avec phoenix run à leur début et à leur fin.",
  "capabilityLabels.docker.name": "Docker",
  "capabilityLabels.docker.description":
    "Surveille les conteneurs Docker locaux : démarrages, arrêts, plantages et bilans de santé en échec.",
  "capabilityLabels.frappe.name": "Frappe / ERPNext",
  "capabilityLabels.frappe.description":
    "Surveille l'état de vos sites Frappe locaux et crée une tâche après votre confirmation.",
  "capabilityLabels.machine.name": "Santé de la machine et modèles locaux",
  "capabilityLabels.machine.description":
    "État des ressources locales et gestion des modèles locaux.",
  "capabilityLabels.agents.name": "Agents de code",
  "capabilityLabels.agents.description":
    "Indique si les agents de code travaillent, attendent, ont terminé ou ont échoué, et les démarre ou les arrête sur confirmation.",
  "capabilityLabels.awake.name": "Maintien en éveil",
  "capabilityLabels.awake.description":
    "Garde cet ordinateur éveillé pendant une durée définie, avec des seuils de sécurité.",
  "capabilityLabels.issues.name": "Suivi des tickets",
  "capabilityLabels.issues.description":
    "Prévient Fawkes quand un ticket GitHub, Linear ou Jira vous est assigné ou change.",
  "capabilityLabels.plans.name": "Contexte de revue de plan",
  "capabilityLabels.plans.description":
    "Contexte agrégé en lecture seule pour la revue consultative d'un plan d'ingénierie.",
  "capabilityLabels.ports.name": "Radar de ports et processus",
  "capabilityLabels.ports.description":
    "Liste les ports TCP en écoute avec leur processus et signale les serveurs de dev oubliés ou gourmands.",
  "capabilityLabels.screen-region.name": "Capture d'une zone d'écran",
  "capabilityLabels.screen-region.description":
    "Vous laisse tracer une zone de l'écran et la renvoie sous forme d'image après confirmation.",
  "capabilityLabels.browser.name": "Actions du navigateur Phoenix",
  "capabilityLabels.browser.description":
    "Permet à Fawkes d'agir dans l'onglet actif du navigateur Phoenix, une action confirmée à la fois.",
  "capabilityLabels.web-search.name": "Recherche web",
  "capabilityLabels.web-search.description":
    "Envoie une courte requête à une chaîne de moteurs de recherche et renvoie titres, liens et extraits.",
  "capabilityLabels.status-lights.name": "Voyants d'état et Stream Deck",
  "capabilityLabels.status-lights.description":
    "Affiche l'activité de Fawkes sur les lumières de votre choix et permet à un Stream Deck de répondre aux approbations.",
  "capabilityLabels.chat-approvals.name": "Approbations par chat",
  "capabilityLabels.chat-approvals.description":
    "Publie des cartes d'approbation sur Slack et Discord et laisse un propriétaire autorisé y répondre.",
  "capabilityLabels.capture-microphone.name": "Capture du microphone",
  "capabilityLabels.capture-microphone.description":
    "Vous permet de choisir la capture du microphone pour le traitement IA local, avec approbation à chaque fois.",
  "capabilityLabels.capture-screen.name": "Capture d'écran",
  "capabilityLabels.capture-screen.description":
    "Vous permet de choisir la capture d'écran pour le traitement IA local, avec approbation à chaque fois.",
  "capabilityLabels.mock.name": "Simulation",
  "capabilityLabels.mock.description":
    "Joue des scénarios de démo pour voir Fawkes réagir (développement uniquement).",
  "capabilityLabels.field.base_url": "Adresse du serveur",
  "capabilityLabels.field.poll_ms": "Vérifier toutes les (ms)",
  "capabilityLabels.field.bot_path": "Chemin du bot Kage",
  "capabilityLabels.field.bot_name": "Nom affiché du bot",
  "capabilityLabels.field.max_duration_min": "Durée maximale de capture (min)",
  "capabilityLabels.field.git.repositories": "Dépôts (un chemin absolu par ligne)",
  "capabilityLabels.field.github.repositories": "Dépôts (un propriétaire/nom par ligne)",
  "capabilityLabels.field.api_url": "Adresse de l'API GitHub",
  "capabilityLabels.field.team_id": "ID de l'équipe",
  "capabilityLabels.field.project": "Projet (nom ou ID)",
  "capabilityLabels.field.remind_minutes":
    "Rappeler tant de minutes avant une réservation (0 = désactivé)",
  "capabilityLabels.field.google": "Google Agenda",
  "capabilityLabels.field.microsoft": "Calendrier Microsoft",
  "capabilityLabels.field.caldav": "CalDAV",
  "capabilityLabels.field.macos": "Calendrier macOS",
  "capabilityLabels.field.caldav_url": "Adresse du calendrier CalDAV",
  "capabilityLabels.field.caldav_timezone": "Fuseau horaire CalDAV",
  "capabilityLabels.field.freeze": "Bloquer les déploiements pendant les gels de déploiement",
  "capabilityLabels.field.player": "Lecteur multimédia",
  "capabilityLabels.field.price_url": "Adresse du service de prix",
  "capabilityLabels.field.socket_path": "Chemin du socket Docker",
  "capabilityLabels.field.benches": "Benches Frappe (un chemin absolu par ligne)",
  "capabilityLabels.field.timeout_ms": "Délai d'attente des requêtes (ms)",
  "capabilityLabels.field.include_prompt_title": "Afficher un court titre tiré du prompt",
  "capabilityLabels.field.silent_after_min": "Oublier une session silencieuse après (min)",
  "capabilityLabels.field.max_sessions": "Nombre maximal de sessions simultanées",
  "capabilityLabels.field.max_runtime_min": "Durée maximale d'une session (min)",
  "capabilityLabels.field.grace_ms": "Délai avant l'arrêt forcé d'un agent stoppé (ms)",
  "capabilityLabels.field.battery_floor_percent": "Seuil de batterie (%)",
  "capabilityLabels.field.floors_enabled": "Seuils de batterie et de chaleur",
  "capabilityLabels.field.floor_low_power_percent": "Mode économie d'énergie sous (% de batterie)",
  "capabilityLabels.field.floor_end_percent": "Terminer la session sous (% de batterie)",
  "capabilityLabels.field.floor_thermal_low_power": "Mode économie d'énergie au niveau de chaleur",
  "capabilityLabels.field.floor_thermal_end": "Terminer la session au niveau de chaleur",
  "capabilityLabels.field.ports.watch": "Actualiser la liste en arrière-plan",
  "capabilityLabels.field.forgotten_after_hours":
    "Signaler un serveur de dev comme oublié après (heures)",
  "capabilityLabels.field.heavy_cpu_percent": "CPU d'un processus gourmand (%)",
  "capabilityLabels.field.heavy_memory_mb": "Mémoire d'un processus gourmand (Mo)",
  "capabilityLabels.field.restart_roots": "Dossiers de redémarrage (un chemin absolu par ligne)",
  "capabilityLabels.field.searxng_url": "Adresse de SearXNG",
  "capabilityLabels.field.devices": "Lumières autorisées (un ID par ligne)",
  "capabilityLabels.field.speed": "Vitesse de lecture",
  "capabilityLabels.field.projects": "Projets accessibles depuis le chat (un par ligne)",
  "capabilityLabels.field.phoenix_confirmations":
    "Répondre aux confirmations Phoenix depuis le chat",
  "capabilityLabels.field.token_ttl_seconds": "Validité du bouton (secondes)",
};
