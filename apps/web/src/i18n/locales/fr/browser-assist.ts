// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserAssist as enBrowserAssist } from "../../en/browser-assist";

/** Machine-translated; unreviewed. */
export const browserAssist: Record<keyof typeof enBrowserAssist, string> = {
  "browser.assist.open": "Demander de l'aide à Fawkes pour cette page",
  "browser.assist.title": "Demander de l'aide à Fawkes pour cette page",
  "browser.assist.goalLabel": "Que voulez-vous faire sur cette page ?",
  "browser.assist.goalPlaceholder": "Par exemple : ajoute le bleu au panier",
  "browser.assist.propose": "Proposer des étapes",
  "browser.assist.proposing": "Interrogation du modèle local…",
  "browser.assist.close": "Fermer l'assistant",
  "browser.assist.goalTooLong": "L'objectif peut contenir au plus {max} caractères.",
  "browser.assist.goalControl": "L'objectif ne peut pas contenir de caractères de contrôle.",
  "browser.assist.goalHidden":
    "L'objectif ne peut pas contenir de caractères de direction du texte ni de largeur nulle.",
  "browser.assist.requestFailed": "L'assistant est injoignable. Rien n'a été exécuté.",
  "browser.assist.noLocalModel":
    "Aucun modèle n'est disponible sur l'appareil, donc Fawkes n'a pas lu cette page. Le texte de la page n'est jamais envoyé à un service cloud.",
  "browser.assist.localModelFailed":
    "Le modèle de l'appareil a échoué. Rien n'a été exécuté et rien n'a été envoyé ailleurs.",
  "browser.assist.noBrowser": "Cette application Phoenix n'a pas de navigateur dont lire une page.",
  "browser.assist.inert":
    "Proposé par un modèle local qui a lu cette page. Rien n'a été exécuté. Ces étapes sont du texte brut et peuvent être fausses.",
  "browser.assist.forPage": "Pour la page : {url}",
  "browser.assist.dropped":
    "{count, plural, one {# suggestion du modèle a été refusée et n'est pas affichée.} other {# suggestions du modèle ont été refusées et ne sont pas affichées.}}",
  "browser.assist.noSteps": "Le modèle n'a proposé aucune étape pour cette page.",
  "browser.assist.kind.click": "Cliquer sur",
  "browser.assist.kind.type": "Saisir dans",
  "browser.assist.kind.submit": "Envoyer le formulaire",
  "browser.assist.typeText": "le texte : {text}",
  "browser.assist.run": "Exécuter cette étape",
  "browser.assist.step.running": "En attente de votre approbation…",
  "browser.assist.step.done": "Terminé. Rien d'autre n'a été exécuté.",
  "browser.assist.refused.noTab": "Aucun onglet actif sur lequel exécuter cette étape.",
  "browser.assist.refused.moved":
    "L'onglet n'est plus sur la page pour laquelle ces étapes ont été proposées. Redemandez.",
  "browser.assist.failed.denied": "Vous avez refusé cette étape.",
  "browser.assist.failed.blocked":
    "Phoenix a refusé cette étape (la page ou le contrôle n'est pas autorisé).",
  "browser.assist.failed.unavailable": "Le navigateur est injoignable.",
  "browser.assist.failed.timeout": "L'étape a expiré. Elle a pu s'exécuter ou non.",
  "browser.assist.failed.failed": "L'étape ne s'est pas exécutée.",
};
