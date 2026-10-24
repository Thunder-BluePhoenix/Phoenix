// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { calendar as enCalendar } from "../../en/calendar";

/** Machine-translated; unreviewed. */
export const calendar: Record<keyof typeof enCalendar, string> = {
  "calendar.title": "Preparación de reuniones",
  "calendar.disabled": "El calendario está desactivado. Actívalo para ver las próximas reuniones.",
  "calendar.empty": "No hay próximas reuniones.",
  "calendar.loading": "Leyendo reuniones…",
  "calendar.error": "No se pudo leer el calendario.",
  "calendar.refresh": "Actualizar reuniones",
  "calendar.prep": "Preparación",
  "calendar.decisions": "Decisiones anteriores",
  "calendar.actions": "Tareas pendientes",
  "calendar.noPrep": "No hay decisiones revisadas ni tareas pendientes relevantes.",
  "calendar.notetaker": "Iniciar toma de notas",
  "calendar.notetakerInfo": "La grabación solo comienza cuando eliges iniciarla y otorgas permiso.",
  "calendar.freeze": "Bloqueo de despliegue",
  "calendar.busy": "Evento privado",
  "calendar.source": "De {meeting}",
  "calendar.unconfigured":
    "No hay ningún proveedor de calendario conectado. Conecta Google, Microsoft o CalDAV para ver reuniones.",
  "calendar.unavailable":
    "El feed del calendario no está disponible. No se pueden mostrar las próximas reuniones ni los bloqueos de despliegue.",
  "calendar.stale":
    "El feed del calendario está desactualizado. No se puede confiar en las reuniones ni los bloqueos de despliegue hasta actualizarlo.",
  "calendar.lastChecked": "Última lectura correcta: {time}",
  "calendar.prepIncomplete": "La preparación está incompleta para algunas reuniones.",
};
