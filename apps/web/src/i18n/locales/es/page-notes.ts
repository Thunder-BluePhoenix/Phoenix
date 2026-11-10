// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { pageNotes as enPageNotes } from "../../en/page-notes";

/** Machine-translated; unreviewed (see ../../README.md). */
export const pageNotes: Record<keyof typeof enPageNotes, string> = {
  "pageNotes.title": "Páginas enviadas desde tu navegador",
  "pageNotes.intro":
    "Páginas que elegiste enviar con la extensión de navegador de Phoenix. La dirección, el título y el texto seleccionado los escribió el sitio web, por eso se muestran como texto sin formato. Phoenix no los abre, no los lee ni los envía a una IA; elimina los que no quieras conservar.",
  "pageNotes.loading": "Cargando páginas…",
  "pageNotes.loadFailed": "No se pudo cargar la lista de páginas.",
  "pageNotes.empty": "No se ha enviado ninguna página.",
  "pageNotes.list": "Páginas enviadas desde tu navegador",
  "pageNotes.untitled": "(sin título)",
  "pageNotes.received": "Recibida {time}",
  "pageNotes.selection": "Texto seleccionado",
  "pageNotes.delete": "Eliminar",
  "pageNotes.deleteLabel": "Eliminar la página {title}",
};
