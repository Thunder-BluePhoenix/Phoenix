// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mission as enmission } from "../../en/mission";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mission: Record<keyof typeof enmission, string> = {
  "mission.title": "Centre de contrôle",
  "mission.nav": "Mission",
  "mission.note":
    "Les jetons et le coût sont ceux que les agents rapportent eux-mêmes. Ils ne sont pas vérifiés par rapport à la facture du fournisseur.",
  "mission.sourceMissing":
    "Certaines sessions d’agents n’ont pas pu être lues pour le moment (la fonction agents est désactivée ou ne répond pas) ; il peut donc manquer des sessions sur le tableau.",
  "mission.refresh": "Actualiser",
  "mission.loadFailed": "Le centre de contrôle n’a pas pu être chargé.",

  "mission.filter.search": "Rechercher des sessions",
  "mission.filter.searchPlaceholder": "Agent, projet ou identifiant de session",
  "mission.filter.agent": "Agent",
  "mission.filter.project": "Projet",
  "mission.filter.state": "État",
  "mission.filter.all": "Tous",
  "mission.filter.clear": "Effacer les filtres",

  "mission.state.working": "En cours",
  "mission.state.waiting": "Vous attend",
  "mission.state.finished": "Terminée",
  "mission.state.stuck": "Bloquée",
  "mission.reason.permission": "A besoin de votre autorisation",
  "mission.reason.input": "A une question pour vous",
  "mission.reason.idle": "Inactive à l’invite de commande",
  "mission.stuck.noReport": "Aucun rapport depuis plus longtemps que le délai de blocage",
  "mission.stuck.safetyStall": "Signalée comme bloquée par le filet de sécurité",

  "mission.board.title": "Sessions",
  "mission.board.empty": "Aucune session d’agent à afficher.",
  "mission.board.noMatch": "Aucune session ne correspond aux filtres.",
  "mission.column.count": "{count, plural, one {# session} other {# sessions}}",
  "mission.column.empty": "Aucune",

  "mission.card.open": "Détails",
  "mission.card.focus": "Aller au terminal",
  "mission.card.focused": "La fenêtre du terminal a été mise au premier plan.",
  "mission.card.unnamedProject": "projet inconnu",
  "mission.card.tokens": "{input} en entrée, {output} en sortie",
  "mission.card.noTokens": "Aucun nombre de jetons rapporté",
  "mission.card.cost": "Coût {cost}",
  "mission.card.costPartial":
    "Coût de {cost} ou plus (une partie de l’usage n’a pas de coût connu)",
  "mission.card.costUnknown": "Coût inconnu",
  "mission.card.lastSeen": "Dernier signe {ago}",
  "mission.card.steps": "{count, plural, one {# étape} other {# étapes}}",

  "mission.totals.title": "Jetons et coût",
  "mission.totals.window": "{days, plural, one {Dernier # jour} other {Derniers # jours}}",
  "mission.totals.input": "Jetons d’entrée",
  "mission.totals.output": "Jetons de sortie",
  "mission.totals.cost": "Coût",
  "mission.totals.unknown": "inconnu",
  "mission.totals.partial": "{cost} ou plus",
  "mission.totals.unpriced":
    "Aucun prix n’est défini pour : {models}. Leur coût est inconnu, pas nul. Ajoutez un prix ci-dessous pour voir un coût.",
  "mission.totals.empty": "Aucun agent n’a rapporté de jetons ni de coût sur cette période.",

  "mission.by.day": "Par jour",
  "mission.by.agent": "Par agent",
  "mission.by.project": "Par projet",
  "mission.by.session": "Par session",
  "mission.col.day": "Jour",
  "mission.col.agent": "Agent",
  "mission.col.project": "Projet",
  "mission.col.session": "Session",
  "mission.col.input": "Entrée",
  "mission.col.output": "Sortie",
  "mission.col.cost": "Coût",

  "mission.budgets.title": "Budgets",
  "mission.budgets.note":
    "Une alerte arrive avant qu’une limite soit atteinte, à {thresholds} de celle-ci, une fois par budget et par jour. Les budgets de coût ne comptent que l’usage dont le coût est connu.",
  "mission.budgets.none": "Aucun budget pour l’instant.",
  "mission.budgets.line": "{scope}, {metric}{agent} : {used} sur {limit} ({pct}%)",
  "mission.budgets.lineAtLeast":
    "{scope}, {metric}{agent} : au moins {used} sur {limit} ({pct}%) ; une partie de l’usage n’a pas de coût connu et n’est pas comptée",
  "mission.ingest.notice":
    "Aujourd’hui, Core a ramené {clamped, plural, one {# rapport} other {# rapports}} à une limite et refusé {refused, plural, one {# rapport} other {# rapports}} ; les chiffres ci-dessous peuvent donc être inférieurs à ceux des agents. Agents : {agents}.",
  "mission.budgets.lineUnknown": "{scope}, {metric}{agent} : usage inconnu, limite {limit}",
  "mission.budgets.agentSuffix": " ({agent})",
  "mission.budgets.scope": "S’applique à",
  "mission.budgets.scope.daily": "Toute la journée",
  "mission.budgets.scope.session": "Chaque session",
  "mission.budgets.metric": "Mesuré en",
  "mission.budgets.metric.tokens": "Jetons",
  "mission.budgets.metric.cost": "Dollars américains",
  "mission.budgets.limit": "Limite",
  "mission.budgets.agent": "Agent (facultatif)",
  "mission.budgets.add": "Ajouter un budget",
  "mission.budgets.remove": "Supprimer le budget {id}",
  "mission.budgets.invalid": "Saisissez une limite supérieure à zéro.",

  "mission.prices.title": "Prix",
  "mission.prices.note":
    "Phoenix n’a aucun prix intégré. Saisissez les vôtres, en dollars américains par million de jetons, sous le nom de modèle que rapporte l’agent.",
  "mission.prices.aiNote": "Modèles qui ont aussi un prix dans les réglages IA : {models}.",
  "mission.prices.none": "Aucun prix pour l’instant.",
  "mission.prices.model": "Modèle",
  "mission.prices.input": "Entrée par million de jetons",
  "mission.prices.output": "Sortie par million de jetons",
  "mission.prices.line": "{model} : {input} en entrée, {output} en sortie par million de jetons",
  "mission.prices.add": "Enregistrer le prix",
  "mission.prices.remove": "Supprimer le prix de {model}",
  "mission.prices.invalid": "Saisissez un nom de modèle et deux prix supérieurs ou égaux à zéro.",

  "mission.stall.label":
    "Marquer une session active comme bloquée après ce nombre de minutes sans rapport",
  "mission.stall.save": "Enregistrer",

  "mission.keep.label":
    "Supprimer les enregistrements d’usage plus anciens que ce nombre de jours (de 7 à 3650)",
  "mission.keep.save": "Enregistrer",

  "mission.saved": "Enregistré",
  "mission.delete.button": "Supprimer tout l’usage des agents",
  "mission.delete.warning":
    "Supprimer tous les nombres de jetons et de coût enregistrés ? Les budgets et les prix sont conservés. Cette action est irréversible.",
  "mission.delete.confirm": "Oui, supprimer",
  "mission.delete.done":
    "{count, plural, one {# enregistrement supprimé} other {# enregistrements supprimés}}",
};
