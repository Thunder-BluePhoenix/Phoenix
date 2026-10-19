// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shell as enShell } from "../../en/shell";

/** Machine-translated; unreviewed (see ../../README.md). */
export const shell: Record<keyof typeof enShell, string> = {
  "shell.nav.home": "Início do Phoenix",
  "shell.nav.main": "Principal",
  "shell.nav.meetings": "Reuniões",
  "shell.nav.provenance": "Proveniência",
  "shell.nav.agents": "Agentes",
  "shell.nav.workflows": "Fluxos de trabalho",
  "shell.nav.recap": "Resumo",
  "shell.nav.settings": "Configurações",
  "shell.nav.recording": "Gravando",
  "shell.app.skipToContent": "Ir para o conteúdo",
  "shell.app.tagline": "O Phoenix é a plataforma. O Fawkes é o mascote.",
  "shell.app.noToken": "Esta página não tem token de sessão. Abra o Phoenix pelo endereço exibido por <code>pnpm dev:core</code>.",
  "shell.app.hint": "Clique no Fawkes na barra superior para ver o que o Phoenix está fazendo.",
  "shell.language.title": "Idioma",
  "shell.language.label": "Idioma da interface",
  "shell.language.available": "{count, plural, one {# idioma disponível.} many {# de idiomas disponíveis.} other {# idiomas disponíveis.}}",
  "shell.language.machineNote": "O texto em idiomas diferentes do inglês é traduzido automaticamente e ainda não foi revisado por falantes nativos.",
  "shell.language.saved": "Idioma alterado.",
  "shell.language.failed": "Não foi possível salvar o idioma. Tente novamente.",
};
