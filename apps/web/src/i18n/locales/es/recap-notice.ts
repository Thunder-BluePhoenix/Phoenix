// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { recapNotice as enrecapNotice } from "../../en/recap-notice";

/** Machine-translated; unreviewed. */
export const recapNotice: Record<keyof typeof enrecapNotice, string> = {
  "recapNotice.title": "Aviso del resumen semanal",
  "recapNotice.intro":
    "Cada lunes a las 09:00 hora local, muestra un aviso en la lista de notificaciones de Phoenix con los recuentos de la semana pasada. Desactivado por defecto. Usa un texto fijo solo con números (sin nombres, rutas ni títulos), no llama a ningún modelo ni usa la red, y se omite durante las horas de silencio de Proactivo, en el modo silencioso de notificaciones y durante una parada de emergencia. Como máximo uno por semana; si Phoenix no estaba en ejecución el lunes, se muestra una vez más tarde esa semana.",
  "recapNotice.enable": "Mostrar un aviso del resumen semanal el lunes",
  "recapNotice.last": "Último aviso de la semana {week}.",
  "recapNotice.never": "Todavía no se ha mostrado ningún aviso del resumen semanal.",
  "recapNotice.error": "No se pudo cargar o guardar el ajuste del aviso del resumen semanal.",
  "recapNotice.midweek": "Si lo activas a mitad de semana, espera al próximo lunes.",
};
