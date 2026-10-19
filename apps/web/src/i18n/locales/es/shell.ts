// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shell as enShell } from "../../en/shell";

/** Machine-translated; unreviewed (see ../../README.md). */
export const shell: Record<keyof typeof enShell, string> = {
  "shell.nav.home": "Inicio de Phoenix",
  "shell.nav.main": "Principal",
  "shell.nav.meetings": "Reuniones",
  "shell.nav.provenance": "Procedencia",
  "shell.nav.agents": "Agentes",
  "shell.nav.workflows": "Flujos de trabajo",
  "shell.nav.recap": "Resumen",
  "shell.nav.settings": "Ajustes",
  "shell.nav.recording": "Grabando",
  "shell.app.skipToContent": "Saltar al contenido",
  "shell.app.tagline": "Phoenix es la plataforma. Fawkes es la mascota.",
  "shell.app.noToken": "Esta página no tiene token de sesión. Abre Phoenix desde la dirección que imprime <code>pnpm dev:core</code>.",
  "shell.app.hint": "Haz clic en Fawkes en la barra superior para ver qué está haciendo Phoenix.",
  "shell.language.title": "Idioma",
  "shell.language.label": "Idioma de la interfaz",
  "shell.language.available": "{count, plural, one {Hay # idioma disponible.} other {Hay # idiomas disponibles.}}",
  "shell.language.machineNote": "El texto en idiomas distintos del inglés es de traducción automática y aún no ha sido revisado por hablantes nativos.",
  "shell.language.saved": "Idioma cambiado.",
  "shell.language.failed": "No se pudo guardar el idioma. Inténtalo de nuevo.",
};
