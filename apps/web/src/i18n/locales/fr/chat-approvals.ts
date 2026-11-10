// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { chatApprovals as enChatApprovals } from "../../en/chat-approvals";

/** Machine-translated; unreviewed. */
export const chatApprovals: Record<keyof typeof enChatApprovals, string> = {
  "chatApprovals.title": "Approbations par chat",
  "chatApprovals.notAvailable":
    "Les approbations par chat ne sont pas disponibles dans ce Phoenix Core.",
  "chatApprovals.intro":
    "Répondez à une approbation d’agent ou de Phoenix en attente depuis Slack ou Discord, et soyez notifié dans Teams. Tout est désactivé tant que vous ne l’activez pas ici, pour chaque fournisseur et chaque projet.",
  "chatApprovals.limits":
    "Jamais utilisé avec un vrai espace Slack, Discord ou Teams : le code n’est testé qu’avec des rappels simulés. Teams est en notification seule (un lien vers Phoenix, jamais de bouton Autoriser). Un appui sur un bouton est vérifié par la signature du fournisseur et votre liste d’approbateurs, et la décision est journalisée.",
  "chatApprovals.noDm":
    "Les résumés et notifications vont uniquement au canal défini ci-dessous. Les messages privés à une personne ne sont pas implémentés.",
  "chatApprovals.capabilityOff":
    "La capacité Approbations par chat est désactivée, donc rien n’est envoyé.",
  "chatApprovals.enable": "Activer la capacité",
  "chatApprovals.ready": "Prêt : ce fournisseur peut publier des cartes.",
  "chatApprovals.notReady":
    "Pas prêt : il doit être activé, avec un identifiant d’espace, un identifiant de canal et au moins un approbateur.",
  "chatApprovals.teamsNote":
    "Teams est en notification seule. Son adresse de webhook et sa clé de lien sont enregistrées plus bas.",
  "chatApprovals.save": "Enregistrer les approbations par chat",
  "chatApprovals.saved": "Enregistré.",
  "chatApprovals.provider.slack": "Slack",
  "chatApprovals.provider.discord": "Discord",
  "chatApprovals.provider.teams": "Microsoft Teams",
  "chatApprovals.enabledNamed": "Activer {name}",
  "chatApprovals.notifyNamed": "Envoyer une notification générique sur {name}",
  "chatApprovals.digestNamed": "Inclure {name} dans les résumés",
  "chatApprovals.notify": "Notifier (sans détails) pour les demandes non activées",
  "chatApprovals.digest.send": "Recevoir le résumé",
  "chatApprovals.workspace.slack": "Identifiant d’espace Slack (équipe)",
  "chatApprovals.workspace.discord": "Identifiant de serveur Discord (guild)",
  "chatApprovals.channel.slack": "Identifiant du canal Slack",
  "chatApprovals.channel.discord": "Identifiant du canal Discord",
  "chatApprovals.approvers.label":
    "Identifiants d’utilisateurs {name} autorisés à décider (un par ligne)",
  "chatApprovals.approvers.hint":
    "Lettres et chiffres uniquement, 24 caractères maximum chacun, 20 au plus. Une liste vide signifie que personne ne peut décider.",
  "chatApprovals.projects.title": "Projets autorisés",
  "chatApprovals.projects.hint":
    "Seules les approbations d’agent de ces projets peuvent être traitées depuis le chat. Vide : aucune.",
  "chatApprovals.projects.label": "Noms de projets (un par ligne)",
  "chatApprovals.digest.title": "Résumé planifié",
  "chatApprovals.digest.intro":
    "Désactivé par défaut. Envoie des totaux et des identifiants courts d’approbation au canal ci-dessus, uniquement aux fournisseurs qui reçoivent le résumé, jamais pendant les heures calmes et jamais s’il ne s’est rien passé.",
  "chatApprovals.digest.enabled": "Envoyer un résumé planifié",
  "chatApprovals.digest.interval": "Minutes entre deux résumés",
  "chatApprovals.digest.hint": "De {min} (une heure) à {max} minutes (une semaine).",
  "chatApprovals.cred.title": "Identifiants",
  "chatApprovals.cred.writeOnly":
    "Écriture seule. Ce que vous saisissez est envoyé au coffre d’identifiants de Core et retiré de cette page aussitôt. Les valeurs enregistrées ne sont plus jamais affichées.",
  "chatApprovals.cred.save": "Enregistrer",
  "chatApprovals.cred.stored": "Enregistré",
  "chatApprovals.cred.notStored": "Non enregistré",
  "chatApprovals.cred.remove": "Supprimer",
  "chatApprovals.cred.removeNamed": "Supprimer {name} enregistré",
  "chatApprovals.field.slackBot": "Jeton du bot Slack",
  "chatApprovals.field.slackSigning": "Secret de signature Slack",
  "chatApprovals.field.discordBot": "Jeton du bot Discord",
  "chatApprovals.field.discordKey": "Clé publique de l’application Discord",
  "chatApprovals.field.teamsWebhook": "Adresse du webhook Teams",
  "chatApprovals.field.teamsKey": "Clé de lien Teams",
  "chatApprovals.error.ids":
    "Les identifiants d’espace et de canal ne contiennent que des lettres et des chiffres, 24 caractères au maximum.",
  "chatApprovals.error.approvers":
    "Les identifiants d’approbateurs ne contiennent que des lettres et des chiffres, 24 caractères chacun au maximum, 20 au plus.",
  "chatApprovals.error.projects":
    "Les noms de projets doivent comporter de 1 à 120 caractères visibles, 200 projets au plus.",
  "chatApprovals.error.interval":
    "L’intervalle du résumé doit être un nombre entier de 60 à 10080 minutes.",
  "chatApprovals.error.save": "Le réglage des approbations par chat n’a pas pu être enregistré.",
  "chatApprovals.error.capability": "La capacité Approbations par chat n’a pas pu être modifiée.",
  "chatApprovals.error.unavailable":
    "Ce Phoenix Core n’a pas de coffre d’identifiants du système, donc un identifiant ne peut pas être conservé.",
  "chatApprovals.error.cred": "L’identifiant n’a pas été enregistré ou supprimé.",
  "chatApprovals.error.credShape":
    "Cette valeur ne semble pas correcte pour ce champ, elle n’a donc pas été envoyée. Vérifiez-la et réessayez.",
};
