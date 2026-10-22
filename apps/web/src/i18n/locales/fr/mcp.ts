// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mcp as enmcp } from "../../en/mcp";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mcp: Record<keyof typeof enmcp, string> = {
  "mcp.title": "Serveur MCP Phoenix",
  "mcp.intro":
    "Permet aux agents de code et autres clients MCP de cet ordinateur de lire du contexte Phoenix et de vous demander une approbation. C'est désactivé tant que vous ne l'activez pas, et chaque client n'obtient rien tant que vous ne le lui accordez pas.",
  "mcp.unavailable": "Impossible de charger les réglages du serveur MCP.",
  "mcp.demoUnavailable": "Le serveur MCP n'est pas disponible en mode démo.",
  "mcp.warning.title": "Avant de l'activer",
  "mcp.warning.local":
    "Cela ouvre un écouteur distinct sur cet ordinateur uniquement (127.0.0.1). Les autres ordinateurs et les pages web ne peuvent pas l'atteindre.",
  "mcp.warning.token":
    "Chaque client a son propre jeton, affiché une seule fois. Tout programme qui détient un jeton peut utiliser ce que vous avez accordé à ce client.",
  "mcp.warning.untrusted":
    "Ce que Phoenix renvoie est marqué comme données non fiables, mais un modèle qui le lit peut quand même être trompé par le texte qu'il contient. N'accordez que le nécessaire.",
  "mcp.warning.approval":
    "Une approbation demandée par un client apparaît avec vos autres approbations d'agents. Vous seul, ici ou sur un téléphone associé, pouvez y répondre.",
  "mcp.enable.label": "Autoriser les clients MCP de cet ordinateur à se connecter",
  "mcp.saved.on": "Le serveur MCP est activé.",
  "mcp.saved.off": "Le serveur MCP est désactivé.",
  "mcp.port.label": "Port",
  "mcp.port.save": "Enregistrer le port",
  "mcp.port.saved": "Port enregistré.",
  "mcp.killSwitch":
    "Le coupe-circuit est activé : le serveur MCP est fermé. Réactivez-le ici après avoir désactivé le coupe-circuit.",
  "mcp.notListening":
    "Le serveur MCP est activé mais n'écoute pas. Vérifiez que le port est libre.",
  "mcp.listening.url": "Adresse",
  "mcp.new.title": "Ajouter un client",
  "mcp.new.name": "Nom du client",
  "mcp.new.create": "Créer le client",
  "mcp.new.created": "Client créé. Il n'a encore aucune autorisation.",
  "mcp.token.title": "Copiez ce jeton maintenant",
  "mcp.token.note":
    "Il n'est affiché qu'une seule fois et Phoenix n'en conserve qu'une empreinte. Placez-le dans l'environnement du client sous le nom PHOENIX_MCP_TOKEN, jamais sur une ligne de commande.",
  "mcp.token.label": "Jeton du client",
  "mcp.token.copy": "Copier le jeton",
  "mcp.token.copied": "Jeton copié.",
  "mcp.token.copyFailed": "Copie impossible. Sélectionnez le jeton et copiez-le à la main.",
  "mcp.token.done": "Je l'ai enregistré",
  "mcp.clients.title": "Clients",
  "mcp.clients.none": "Aucun client pour l'instant.",
  "mcp.client.created": "Créé le {date}",
  "mcp.client.id": "ID du client {id} (affiché sur les cartes d'approbation de ce client)",
  "mcp.client.lastUsed": "Dernière utilisation {when}",
  "mcp.client.neverUsed": "Jamais utilisé",
  "mcp.client.revokedOn": "Révoqué le {date}",
  "mcp.client.noGrants":
    "Aucune autorisation : ce client peut se connecter mais tout lui est refusé.",
  "mcp.grants.title": "Ce que {name} peut faire",
  "mcp.grants.tools": "Outils de lecture",
  "mcp.grants.tool.phoenix_activity": "Sessions d'agents récentes",
  "mcp.grants.tool.phoenix_meetings": "Décisions et résumés de réunions",
  "mcp.grants.tool.phoenix_graph_query": "Questions sur le graphe de connaissances",
  "mcp.grants.tool.phoenix_ci_git_state": "État de Git et de la CI",
  "mcp.grants.tool.phoenix_memory_search": "Recherche dans la mémoire",
  "mcp.grants.actions": "Actions",
  "mcp.grants.requestApproval": "Me demander une approbation",
  "mcp.grants.notify": "Indiquer son état à Fawkes (au travail, en attente, terminé)",
  "mcp.grants.memory": "Mémoire lisible",
  "mcp.grants.memory.note":
    "La recherche en mémoire, le graphe et les réunions ne voient que les portées ci-dessous, jamais tout ce que vous pouvez voir.",
  "mcp.grants.memory.none": "Aucune portée de mémoire accordée.",
  "mcp.grants.memory.scope": "Portée",
  "mcp.grants.memory.sensitivity": "Sensibilité maximale",
  "mcp.grants.memory.add": "Ajouter la portée",
  "mcp.grants.memory.remove": "Retirer la portée {scope}",
  "mcp.grants.memory.invalid":
    "Une portée est *, global, ou repo:, path: ou meeting: suivi de texte.",
  "mcp.sensitivity.public": "public",
  "mcp.sensitivity.internal": "interne",
  "mcp.sensitivity.sensitive": "sensible (réunions)",
  "mcp.grants.save": "Enregistrer les autorisations",
  "mcp.grants.saved": "Autorisations enregistrées.",
  "mcp.revoke": "Révoquer {name}",
  "mcp.revoke.ask": "Révoquer {name} ? Il est refusé immédiatement, même au milieu d'un appel.",
  "mcp.revoke.yes": "Oui, révoquer",
  "mcp.revoke.no": "Garder",
  "mcp.revoke.done": "Client révoqué.",
};
