// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamWebhooks as enTeamWebhooks } from "../../en/team-webhooks";

/** Machine-translated; unreviewed. */
export const teamWebhooks: Record<keyof typeof enTeamWebhooks, string> = {
  "teamWebhooks.title": "Webhooks entrants",
  "teamWebhooks.intro":
    "Les webhooks entrants sont désactivés par défaut. Une source donne à un autre outil sa propre adresse et son propre secret ; quand cet outil envoie un message correctement signé, Phoenix le transforme en événement local. Rien n'est envoyé ailleurs, et ce qu'une source envoie est traité comme du texte non fiable.",
  "teamWebhooks.notAvailable":
    "Les webhooks entrants ne sont pas disponibles : ce Phoenix Core n'a pas de coffre de secrets du système d'exploitation pour conserver les secrets des sources.",
  "teamWebhooks.loadFailed": "Impossible de charger les webhooks entrants.",
  "teamWebhooks.master": "Accepter les webhooks entrants",
  "teamWebhooks.secret.title": "Secret de {id}",
  "teamWebhooks.secret.warning":
    "Ce secret n'est affiché qu'une seule fois. Copiez-le maintenant et conservez-le dans l'outil émetteur. Phoenix le garde uniquement dans le coffre de secrets du système d'exploitation et ne pourra plus l'afficher ; si vous le perdez, supprimez la source et créez-en une nouvelle.",
  "teamWebhooks.secret.path": "Adresse d'envoi (sur ce Core)",
  "teamWebhooks.secret.label": "Secret de signature",
  "teamWebhooks.secret.copy": "Copier le secret",
  "teamWebhooks.secret.copied": "Copié dans le presse-papiers.",
  "teamWebhooks.secret.copyFailed":
    "Phoenix n'a pas pu utiliser le presse-papiers. Sélectionnez le secret ci-dessus et copiez-le à la main avant de fermer.",
  "teamWebhooks.secret.done": "Je l'ai enregistré, fermer",
  "teamWebhooks.sources.title": "Sources",
  "teamWebhooks.sources.none": "Vous n'avez pas encore créé de source de webhook.",
  "teamWebhooks.row.path": "Adresse : {path}",
  "teamWebhooks.row.types": "Types d'événements : {types}",
  "teamWebhooks.row.never": "Rien reçu pour l'instant.",
  "teamWebhooks.row.last": "Dernier message accepté : {time}",
  "teamWebhooks.delete.label": "Supprimer la source {id}",
  "teamWebhooks.delete.ask":
    "Supprimer {id} ? Son secret cesse de fonctionner immédiatement et l'outil émetteur doit être modifié.",
  "teamWebhooks.create.title": "Créer une source",
  "teamWebhooks.create.id": "Nom de la source",
  "teamWebhooks.create.idHint":
    "3 à 32 caractères : lettres minuscules, chiffres, - ou _, en commençant par une lettre.",
  "teamWebhooks.create.types": "Types d'événements autorisés",
  "teamWebhooks.create.typesHint":
    "Séparez par des virgules, par exemple ci.finished. Chaque type commence par l'un de : {namespaces}.",
  "teamWebhooks.create.typesTooMany": "Indiquez au plus {max} types d'événements.",
  "teamWebhooks.create.typesInvalid":
    "Un type d'événement est composé de mots en minuscules séparés par des points, comme ci.finished.",
  "teamWebhooks.create.typesNamespace":
    "Un type d'événement doit commencer par l'un de : {namespaces}.",
  "teamWebhooks.create.limit":
    "Vous avez atteint la limite de {max} sources. Supprimez-en une d'abord.",
  "teamWebhooks.create.submit": "Créer la source",
  "teamWebhooks.row.disabledNote":
    "Cette source est désactivée : Phoenix refuse tout ce qui lui est envoyé.",
  "teamWebhooks.toggle.enable": "Activer",
  "teamWebhooks.toggle.disable": "Désactiver",
  "teamWebhooks.toggle.enableLabel": "Activer la source {id}",
  "teamWebhooks.toggle.disableLabel": "Désactiver la source {id}",
  "teamWebhooks.rotate.button": "Renouveler le secret",
  "teamWebhooks.rotate.label": "Renouveler le secret de la source {id}",
  "teamWebhooks.rotate.ask":
    "Renouveler le secret de {id} ? L'ancien secret cesse de fonctionner immédiatement, donc l'outil émetteur sera refusé tant que vous ne lui aurez pas donné le nouveau secret.",
  "teamWebhooks.secret.rotatedNote":
    "Voici le nouveau secret. L'ancien a cessé de fonctionner ; mettez à jour l'outil émetteur avec celui-ci.",
};
