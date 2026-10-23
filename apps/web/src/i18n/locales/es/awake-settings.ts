// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { awakeSettings as enAwakeSettings } from "../../en/awake-settings";

/** Machine-translated; unreviewed. */
export const awakeSettings: Record<keyof typeof enAwakeSettings, string> = {
  "awakeSettings.title": "Mantener despierto",
  "awakeSettings.intro":
    "Evita que este equipo se suspenda durante un tiempo determinado, por ejemplo mientras se ejecuta una compilación o un agente. Una sesión siempre tiene un final: de 1 minuto a 7 días.",
  "awakeSettings.approval":
    "Iniciar, ampliar y terminar una sesión piden primero tu aprobación en Aprobaciones. Nada cambia hasta que apruebes.",
  "awakeSettings.off":
    "Mantener despierto está desactivado, así que no se puede iniciar ninguna sesión.",
  "awakeSettings.enable": "Activar Mantener despierto",
  "awakeSettings.status.title": "Sesión actual",
  "awakeSettings.status.idle":
    "No hay ninguna sesión en curso. El equipo se suspende con normalidad.",
  "awakeSettings.status.unreadable": "No se pudo leer el estado de Mantener despierto.",
  "awakeSettings.status.mode.timed": "(con tiempo límite)",
  "awakeSettings.status.mode.agents_grace": "(mientras trabajan los agentes)",
  "awakeSettings.status.label": "Etiqueta: {label}",
  "awakeSettings.end.button": "Terminar sesión",
  "awakeSettings.start.title": "Iniciar una sesión",
  "awakeSettings.start.durations": "Duraciones predefinidas",
  "awakeSettings.start.minutes": "Minutos",
  "awakeSettings.start.label": "Etiqueta (opcional)",
  "awakeSettings.start.labelInvalid":
    "La etiqueta debe tener de 1 a {max} caracteres, sin caracteres de control ni invisibles.",
  "awakeSettings.start.submit": "Pedir iniciar",
  "awakeSettings.outcome.waiting": "Esperando tu aprobación en Aprobaciones…",
  "awakeSettings.outcome.succeeded.start": "Aprobado: la sesión ha comenzado.",
  "awakeSettings.outcome.succeeded.extend": "Aprobado: se añadió tiempo a la sesión.",
  "awakeSettings.outcome.succeeded.end": "Aprobado: la sesión ha terminado.",
  "awakeSettings.outcome.denied": "Lo rechazaste, así que no se cambió nada.",
  "awakeSettings.outcome.blocked":
    "La parada de emergencia está activa, así que no se cambió nada.",
  "awakeSettings.outcome.timeout":
    "La solicitud no se aprobó a tiempo o se canceló, así que no se cambió nada.",
  "awakeSettings.outcome.failed": "Mantener despierto no pudo hacerlo: {message}",
};
