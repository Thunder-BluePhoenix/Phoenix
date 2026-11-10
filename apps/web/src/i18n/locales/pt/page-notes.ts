// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { pageNotes as enPageNotes } from "../../en/page-notes";

/** Machine-translated; unreviewed (see ../../README.md). */
export const pageNotes: Record<keyof typeof enPageNotes, string> = {
  "pageNotes.title": "Páginas enviadas do seu navegador",
  "pageNotes.intro":
    "Páginas que você escolheu enviar com a extensão de navegador do Phoenix. O endereço, o título e o texto selecionado foram escritos pelo site, por isso aparecem como texto simples. O Phoenix não os abre, não os lê nem os envia a uma IA; exclua o que não quiser guardar.",
  "pageNotes.loading": "Carregando páginas…",
  "pageNotes.loadFailed": "Não foi possível carregar a lista de páginas.",
  "pageNotes.empty": "Nenhuma página foi enviada.",
  "pageNotes.list": "Páginas enviadas do seu navegador",
  "pageNotes.untitled": "(sem título)",
  "pageNotes.received": "Recebida {time}",
  "pageNotes.selection": "Texto selecionado",
  "pageNotes.delete": "Excluir",
  "pageNotes.deleteLabel": "Excluir a página {title}",
};
