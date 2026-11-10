// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { pageNotes as enPageNotes } from "../../en/page-notes";

/** Machine-translated; unreviewed (see ../../README.md). */
export const pageNotes: Record<keyof typeof enPageNotes, string> = {
  "pageNotes.title": "Pages envoyées depuis votre navigateur",
  "pageNotes.intro":
    "Pages que vous avez choisi d'envoyer avec l'extension de navigateur Phoenix. L'adresse, le titre et le texte sélectionné ont été écrits par le site web ; ils sont donc affichés en texte brut. Phoenix ne les ouvre pas, ne les lit pas et ne les envoie pas à une IA ; supprimez celles que vous ne voulez pas garder.",
  "pageNotes.loading": "Chargement des pages…",
  "pageNotes.loadFailed": "La liste des pages n'a pas pu être chargée.",
  "pageNotes.empty": "Aucune page n'a été envoyée.",
  "pageNotes.list": "Pages envoyées depuis votre navigateur",
  "pageNotes.untitled": "(sans titre)",
  "pageNotes.received": "Reçue {time}",
  "pageNotes.selection": "Texte sélectionné",
  "pageNotes.delete": "Supprimer",
  "pageNotes.deleteLabel": "Supprimer la page {title}",
};
