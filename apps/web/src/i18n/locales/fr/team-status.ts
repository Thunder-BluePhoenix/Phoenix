// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamStatus as enTeamStatus } from "../../en/team-status";

/** Machine-translated; unreviewed. */
export const teamStatus: Record<keyof typeof enTeamStatus, string> = {
  "teamStatus.title": "Présence de l'équipe",
  "teamStatus.intro":
    "La présence de l'équipe est désactivée par défaut. Une fois activée, Phoenix envoie uniquement les types d'état que vous cochez (déploiement, exécution d'un agent, réunion) sous forme de trame chiffrée aux coéquipiers que vous avez ajoutés, et ne nomme jamais un dépôt, une branche ou une personne.",
  "teamStatus.notAvailable":
    "La présence de l'équipe n'est pas disponible : ce Phoenix Core n'a pas de coffre de secrets du système d'exploitation pour conserver votre clé.",
  "teamStatus.loadFailed": "Impossible de charger la présence de l'équipe.",
  "teamStatus.listSeparator": ", ",
  "teamStatus.kind.deploying": "déploie",
  "teamStatus.kind.agentRun": "exécute un agent",
  "teamStatus.kind.meeting": "en réunion",
  "teamStatus.relay.label": "Adresse du relais",
  "teamStatus.route.label": "Route (facultatif)",
  "teamStatus.route.hint":
    "Laissez la route vide pour créer une nouvelle équipe. Collez ici une route pour rejoindre la même équipe qu'un coéquipier.",
  "teamStatus.route.shown": "Route du relais",
  "teamStatus.turnOn": "Activer",
  "teamStatus.resume": "Réactiver",
  "teamStatus.pause": "Mettre en pause",
  "teamStatus.leave": "Quitter l'équipe",
  "teamStatus.leave.ask": "Quitter l'équipe et oublier tout le monde ?",
  "teamStatus.state.line": "Connexion : {state}",
  "teamStatus.state.connected": "connecté",
  "teamStatus.state.connecting": "connexion en cours",
  "teamStatus.state.paused": "en pause",
  "teamStatus.lastError": "Dernière erreur : {error}",
  "teamStatus.self.id": "Votre identifiant d'équipe",
  "teamStatus.self.publicKey": "Votre clé publique",
  "teamStatus.self.hint":
    "Donnez les deux à un coéquipier pour qu'il puisse vous ajouter. Votre clé privée ne quitte jamais cet ordinateur.",
  "teamStatus.sharing.title": "Ce que je partage",
  "teamStatus.sharing.master": "Partager mon état avec mon équipe",
  "teamStatus.sharing.deploying": "Déploiement",
  "teamStatus.sharing.agentRun": "Exécution d'un agent pendant longtemps",
  "teamStatus.sharing.meeting": "En réunion",
  "teamStatus.outgoing.now": "Les coéquipiers voient en ce moment : {kinds}.",
  "teamStatus.outgoing.none": "Les coéquipiers ne voient rien de vous en ce moment.",
  "teamStatus.members.title": "Coéquipiers",
  "teamStatus.members.none": "Vous n'avez encore ajouté aucun coéquipier.",
  "teamStatus.members.removeLabel": "Retirer {label}",
  "teamStatus.members.id": "Identifiant d'équipe du coéquipier",
  "teamStatus.members.label": "Nom à afficher",
  "teamStatus.members.publicKey": "Clé publique du coéquipier",
  "teamStatus.members.add": "Ajouter un coéquipier",
  "teamStatus.presence.title": "Qui est là",
  "teamStatus.presence.none": "Aucun coéquipier à afficher.",
  "teamStatus.presence.nothing": "rien de partagé",
};
