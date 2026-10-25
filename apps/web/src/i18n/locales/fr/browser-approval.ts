// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserApproval as enBrowserApproval } from "../../en/browser-approval";

/** Machine-translated; unreviewed. */
export const browserApproval: Record<keyof typeof enBrowserApproval, string> = {
  "browserApproval.action": "Action du navigateur",
  "browserApproval.action.click": "Cliquer sur un élément de la page",
  "browserApproval.action.type": "Saisir du texte dans un champ de la page",
  "browserApproval.action.submit": "Envoyer un formulaire de la page",
  "browserApproval.action.download": "Lancer un téléchargement depuis la page",
  "browserApproval.action.navigate": "Aller à une autre adresse",
  "browserApproval.action.missing": "La demande n’indique pas de quel type d’action il s’agit.",
  "browserApproval.page": "Page",
  "browserApproval.page.missing": "La demande ne nomme pas la page.",
  "browserApproval.selector": "Élément",
  "browserApproval.selector.missing": "La demande ne nomme aucun élément.",
  "browserApproval.destination": "Destination",
  "browserApproval.destination.missing": "La demande ne nomme aucune destination.",
  "browserApproval.queryHidden":
    "L’adresse contient aussi une partie requête, qui n’est pas affichée.",
  "browserApproval.text": "Texte qui sera saisi (affiché en entier)",
  "browserApproval.text.missing": "La demande ne contient pas le texte.",
  "browserApproval.textLength": "Longueur du texte",
  "browserApproval.textLength.value": "{length} caractères",
  "browserApproval.textLength.missing": "La longueur du texte est absente.",
};
