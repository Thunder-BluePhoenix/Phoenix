// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shell as enShell } from "../../en/shell";

/** Machine-translated; unreviewed (see ../../README.md). */
export const shell: Record<keyof typeof enShell, string> = {
  "shell.nav.home": "Accueil Phoenix",
  "shell.nav.main": "Principal",
  "shell.nav.meetings": "Réunions",
  "shell.nav.provenance": "Provenance",
  "shell.nav.agents": "Agents",
  "shell.nav.workflows": "Workflows",
  "shell.nav.recap": "Récapitulatif",
  "shell.nav.settings": "Paramètres",
  "shell.nav.recording": "Enregistrement",
  "shell.app.skipToContent": "Aller au contenu",
  "shell.app.tagline": "Phoenix est la plateforme. Fawkes est la mascotte.",
  "shell.app.noToken": "Cette page n’a pas de jeton de session. Ouvrez Phoenix depuis l’adresse affichée par <code>pnpm dev:core</code>.",
  "shell.app.hint": "Cliquez sur Fawkes dans la barre du haut pour voir ce que fait Phoenix.",
  "shell.language.title": "Langue",
  "shell.language.label": "Langue de l’interface",
  "shell.language.available": "{count, plural, one {# langue est disponible.} many {# de langues sont disponibles.} other {# langues sont disponibles.}}",
  "shell.language.machineNote": "Les textes dans les langues autres que l’anglais sont traduits automatiquement et n’ont pas encore été relus par des locuteurs natifs.",
  "shell.language.saved": "Langue modifiée.",
  "shell.language.failed": "Impossible d’enregistrer la langue. Réessayez.",
};
