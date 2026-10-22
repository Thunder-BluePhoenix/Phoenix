// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { safety as ensafety } from "../../en/safety";

/** Machine-translated; unreviewed (see ../../README.md). */
export const safety: Record<keyof typeof ensafety, string> = {
  "safety.title": "Filet de sécurité des agents",
  "safety.intro":
    "Avant la première modification signalée par un agent de programmation au cours d'une session, Phoenix enregistre un instantané du projet dans le dépôt git du projet lui-même (une référence masquée ; vos branches, votre index et vos remisages ne sont jamais touchés). Vous pouvez y restaurer les fichiers, après un aperçu et avec votre approbation.",
  "safety.timing":
    "Claude Code signale une étape après l'exécution de l'outil ; l'instantané est donc pris au premier signalement d'une modification : cette première modification y figure normalement déjà. Une restauration annule ce que l'agent a fait après elle, pas la première modification elle-même.",
  "safety.ignored":
    "Les fichiers ignorés par git (résultats de compilation, journaux, dépendances) ne sont pas enregistrés et ne sont jamais restaurés ni supprimés.",
  "safety.loadFailed": "Impossible de charger le filet de sécurité : {error}",
  "safety.killSwitch": "Le coupe-circuit est activé : aucun nouveau point de contrôle n'est créé.",

  "safety.warnings.title": "Avertissements de Fawkes",
  "safety.warnings.loop": "Boucle",
  "safety.warnings.stall": "Bloqué",
  "safety.warnings.line": "{kind} · {agent} dans {repository} : {reason}",

  "safety.checkpoints.title": "Points de contrôle",
  "safety.checkpoints.none":
    "Aucun point de contrôle pour l'instant. Il en est créé un lorsque la première modification d'un agent est signalée.",
  "safety.checkpoints.row": "{agent} dans {repository}",
  "safety.checkpoints.facts":
    "Créé {taken} · {count, plural, one {# fichier} other {# fichiers}} · conservé jusqu'au {expires}",
  "safety.checkpoints.rolledBack": "Restauré {when}",
  "safety.checkpoints.preview": "Aperçu de la restauration…",
  "safety.checkpoints.previewLabel":
    "Aperçu de la restauration vers le point de contrôle de {agent} dans {repository}",
  "safety.checkpoints.close": "Fermer l'aperçu",

  "safety.skipped.title": "Sessions sans point de contrôle",
  "safety.skipped.line": "{agent} dans {repository} : {reason}",
  "safety.skipped.disabled": "le filet de sécurité est désactivé",
  "safety.skipped.kill_switch": "le coupe-circuit était activé",
  "safety.skipped.not_git": "ce dossier n'est pas un dépôt git, il n'y a donc rien à enregistrer",
  "safety.skipped.git_unavailable": "git n'a pas pu être exécuté",
  "safety.skipped.too_many_files": "le projet contient plus de fichiers que la limite",
  "safety.skipped.too_large": "le projet dépasse la limite de taille",
  "safety.skipped.throttled":
    "un point de contrôle a déjà été pris dans ce projet depuis moins d'une minute",
  "safety.skipped.snapshot_failed": "git n'a pas pu prendre l'instantané",

  "safety.preview.title": "Aperçu de la restauration",
  "safety.preview.counts":
    "{restore, plural, one {# fichier serait restauré} other {# fichiers seraient restaurés}}, {remove, plural, one {# nouveau fichier serait supprimé} other {# nouveaux fichiers seraient supprimés}}, {kept, plural, one {# différence serait laissée telle quelle} other {# différences seraient laissées telles quelles}}.",
  "safety.preview.restore": "Restaurés à l'état du point de contrôle",
  "safety.preview.remove": "Nouveaux fichiers qui seraient supprimés",
  "safety.preview.kept": "Laissés tels quels",
  "safety.preview.change.modified": "modifié",
  "safety.preview.change.deleted": "supprimé par l'agent",
  "safety.preview.change.type_changed": "type modifié",
  "safety.preview.why.tracked_by_head": "suivi par git, donc non supprimé",
  "safety.preview.why.ignored": "ignoré par git",
  "safety.preview.why.submodule": "un sous-module",
  "safety.preview.why.unsafe_path": "chemin dangereux à modifier",
  "safety.preview.why.not_a_file": "pas un fichier ordinaire",
  "safety.preview.truncated": "Les listes sont tronquées ; les totaux ci-dessus sont exacts.",
  "safety.preview.diff": "Modifications depuis le point de contrôle",
  "safety.preview.diffTruncated": "Le diff est tronqué à sa limite de taille.",
  "safety.preview.diffRedacted": "Du texte qui ressemblait à un secret a été masqué.",
  "safety.preview.diffEmpty": "Aucune modification de texte à afficher.",
  "safety.preview.nothing":
    "Les fichiers correspondent déjà au point de contrôle. Il n'y a rien à restaurer.",
  "safety.preview.refusal.repository_missing": "Le projet n'est plus un dépôt git à cet endroit.",
  "safety.preview.refusal.checkpoint_gone": "L'instantané ne se trouve plus dans le dépôt.",
  "safety.preview.refusal.head_moved":
    "Le HEAD du dépôt a bougé depuis le point de contrôle (un commit ou un changement de branche). Phoenix ne restaurera pas au-delà ; rien n'a été modifié.",
  "safety.preview.refusal.snapshot_failed": "Git n'a pas pu lire l'arbre de travail.",
  "safety.preview.approvalNote":
    "La restauration demande d'abord votre approbation. Elle ne modifie jamais l'historique git, les branches, l'index ni les remisages, et elle est refusée si les fichiers changent après cet aperçu.",

  "safety.rollback.button": "Restaurer…",
  "safety.rollback.waiting":
    "En attente de votre approbation dans la liste des approbations ci-dessus…",
  "safety.rollback.done":
    "Restauration effectuée : {restored, plural, one {# fichier restauré} other {# fichiers restaurés}}, {removed, plural, one {# nouveau fichier supprimé} other {# nouveaux fichiers supprimés}}.",
  "safety.rollback.exact": "Les fichiers correspondent maintenant au point de contrôle.",
  "safety.rollback.inexact":
    "Certaines différences ont été laissées telles quelles ; les fichiers ne correspondent donc pas exactement au point de contrôle.",

  "safety.settings.title": "Réglages",
  "safety.settings.enabled":
    "Créer un point de contrôle lorsque la première modification d'un agent est signalée",
  "safety.settings.notify":
    "Envoyer une notification lorsque Fawkes signale une boucle ou un blocage",
  "safety.settings.retention": "Conserver les points de contrôle pendant (jours)",
  "safety.settings.maxFiles": "Ignorer les projets de plus de fichiers que",
  "safety.settings.loopThreshold": "Avertir d'une boucle après ce nombre de répétitions",
  "safety.settings.waitingMin": "Avertir lorsqu'un agent vous attend depuis (minutes)",
  "safety.settings.idleMin": "Avertir lorsqu'un agent actif reste silencieux pendant (minutes)",
  "safety.settings.saved": "Enregistré.",
  "safety.settings.detectNote":
    "Les hooks ne transmettent ni codes de sortie ni contenu de fichiers : une boucle correspond donc à la même commande exécutée encore et encore, ou à un fichier dont les modifications s'annulent mutuellement (d'après le nombre de lignes).",
};
