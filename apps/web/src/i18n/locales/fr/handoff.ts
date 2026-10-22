// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { handoff as enhandoff } from "../../en/handoff";

/** Machine-translated; unreviewed (see ../../README.md). */
export const handoff: Record<keyof typeof enhandoff, string> = {
  "handoff.title": "Notes de passation",
  "handoff.intro":
    "Une note de passation est un court résumé que Phoenix construit avec des règles fixes, sans modèle, à partir de ce qu’un agent de programmation a signalé pendant une session : l’objectif (seulement si l’agent a signalé un titre de tâche), les fichiers modifiés avec le nombre de lignes, les commandes exécutées (secrets retirés) et les questions ouvertes. Phoenix n’a rien vérifié de tout cela : considérez-le comme ce que l’agent a dit, pas comme une preuve. Les notes sont stockées sur cet ordinateur, dans le dossier de données de Phoenix, lisibles par vous seul ; les 50 plus récentes sont conservées, et « Tout supprimer » pour « handoff » dans Confidentialité les efface.",

  "handoff.settings.legend": "Réglages de passation",
  "handoff.settings.auto": "Écrire une note à la fin d’une session d’agent",
  "handoff.settings.allowCloud":
    "Laisser un modèle dans le cloud écrire le résumé facultatif (désactivé : uniquement un modèle sur cet appareil)",
  "handoff.settings.cloudWarning":
    "Si vous l’activez, le texte de la note (commandes expurgées et noms de fichiers) peut quitter cet ordinateur vers un modèle cloud lorsque vous demandez un résumé. Les autorisations cloud des réglages d’IA s’appliquent toujours en plus de ce choix.",
  "handoff.settings.saved": "Réglages enregistrés.",
  "handoff.settings.unavailable": "Les réglages de passation n’ont pas pu être chargés.",
  "handoff.notes.unavailable": "Les notes de passation n’ont pas pu être chargées.",
  "handoff.guard.unavailable":
    "Les résultats de la protection des secrets n’ont pas pu être chargés.",
  "handoff.notes.title": "Notes enregistrées",
  "handoff.notes.listLabel": "Notes de passation",
  "handoff.notes.empty": "Aucune note de passation n’a encore été écrite.",
  "handoff.notes.open": "{date} {time} · {agent}",
  "handoff.notes.meta": "{project} · {files} · {lines}",
  "handoff.notes.files": "{count, plural, one {# fichier} many {# de fichiers} other {# fichiers}}",
  "handoff.notes.lines": "+{added} −{removed}",
  "handoff.notes.noProject": "aucun projet",
  "handoff.notes.hasSummary": "Résumé du modèle",
  "handoff.notes.detailLabel": "Note sélectionnée",
  "handoff.notes.loading": "Chargement de la note…",
  "handoff.notes.trigger.auto": "Écrite automatiquement",
  "handoff.notes.trigger.user": "Vous l’avez demandée",
  "handoff.notes.textLabel": "Texte de la note",

  "handoff.summary.title": "Résumé du modèle",
  "handoff.summary.processedBy": "Écrit par : {by}",
  "handoff.summary.warning":
    "Un modèle a écrit ce résumé et il peut être faux. Vérifiez-le avant de vous y fier.",
  "handoff.summary.add": "Ajouter un résumé du modèle",
  "handoff.summary.note":
    "Phoenix n’utilise qu’un modèle sur cet appareil, sauf si vous avez autorisé un modèle cloud ci-dessus.",
  "handoff.summary.added": "Résumé ajouté.",

  "handoff.delete.button": "Supprimer la note",
  "handoff.delete.done": "Note supprimée.",

  "handoff.generate.title": "Écrire une note pour une session",
  "handoff.generate.sessionLabel": "Session",
  "handoff.generate.choose": "Choisir une session",
  "handoff.generate.option": "{agent} · {repository} · {time}",
  "handoff.generate.none":
    "Aucune session d’agent de programmation n’est connue pour l’instant : il n’y a donc rien à noter.",
  "handoff.generate.button": "Écrire une note",
  "handoff.generate.done": "Note écrite.",

  "handoff.attach.title": "Utiliser cette note",
  "handoff.attach.targetLabel": "Destination",
  "handoff.attach.target.commit_message": "Un message de commit",
  "handoff.attach.target.pr_description": "Une description de pull request",
  "handoff.attach.target.task": "Un ticket GitHub",
  "handoff.attach.repositoryLabel": "Dépôt GitHub (owner/name)",
  "handoff.attach.repositoryInvalid":
    "Saisissez le dépôt sous la forme owner/name, par exemple acme/app.",
  "handoff.attach.preview": "Aperçu",
  "handoff.attach.previewAgain": "Refaire l’aperçu",
  "handoff.attach.confirm": "Confirmer",
  "handoff.attach.previewLabel": "Aperçu de ce qui sera joint",
  "handoff.attach.issueTitle": "Titre du ticket : {title}",
  "handoff.attach.textLabel": "Exactement ce texte",
  "handoff.attach.delivery.copy":
    "Phoenix ne l’écrit nulle part : confirmez pour le copier, puis collez-le vous-même.",
  "handoff.attach.delivery.copyPr":
    "Phoenix n’a pas encore de commande qui modifie la description d’une pull request : copie uniquement. Confirmez pour le copier, puis collez-le vous-même.",
  "handoff.attach.delivery.issue":
    "Phoenix créera un ticket GitHub dans {repository} avec la capacité github. Une seconde confirmation vous sera demandée, et le jeton d’écriture est nécessaire.",
  "handoff.attach.stale":
    "La note a changé après cet aperçu : rien n’a été joint. Refaites l’aperçu.",
  "handoff.attach.copied": "Copié dans le presse-papiers. Collez-le où vous en avez besoin.",
  "handoff.attach.copyByHand":
    "Phoenix n’a pas pu utiliser le presse-papiers. Sélectionnez le texte ci-dessous et copiez-le à la main.",
  "handoff.attach.issueCreated": "Ticket n° {number} créé dans {repository}.",
  "handoff.attach.issueExisting": "Le ticket n° {number} de {repository} existait déjà.",
  "handoff.attach.issueAddress": "Adresse : {url}",

  "handoff.guard.title": "Protection des secrets",
  "handoff.guard.intro":
    "La protection des secrets est installée avec l’installateur de hooks d’agents ci-dessus : elle fait partie des hooks que Phoenix ajoute à Claude Code et Codex. Elle bloque un appel d’outil, un git commit ou un git push dont l’entrée ou les modifications indexées contiennent un secret reconnu par le détecteur de Phoenix, et indique à l’agent quel type de secret a été trouvé et où, jamais le secret lui-même.",
  "handoff.guard.override":
    "Vous ne pouvez passer outre un blocage qu’au moyen d’une carte d’approbation ; l’agent ne le peut pas.",
  "handoff.guard.heuristic":
    "Le détecteur est heuristique, pas une promesse que rien ne fuit : un secret qu’il ne reconnaît pas n’est pas détecté.",
  "handoff.guard.failOpen":
    "Si Phoenix Core ou le hook ne peut pas s’exécuter, le travail de l’agent continue (la protection échoue en laissant passer), sauf qu’un secret trouvé est toujours bloqué.",
  "handoff.guard.countsLabel": "Résultats de la protection des secrets",
  "handoff.guard.allowed": "Autorisés après vérification : {count}",
  "handoff.guard.blocked": "Bloqués : {count}",
  "handoff.guard.overridden": "Autorisés après votre approbation : {count}",
  "handoff.guard.since": "Compté depuis le {date} à {time}",
  "handoff.guard.noResults": "Aucun résultat pour l’instant.",
  "handoff.guard.recentLabel": "Résultats récents de la protection des secrets",
  "handoff.guard.row": "{date} {time} · {agent} · {tool}",
  "handoff.guard.outcome.blocked": "bloqué",
  "handoff.guard.outcome.overridden": "autorisé après votre approbation",
  "handoff.guard.finding": "{kind} dans {location}",
};
