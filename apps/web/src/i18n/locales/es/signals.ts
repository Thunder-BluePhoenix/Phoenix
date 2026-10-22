// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { signals as ensignals } from "../../en/signals";

/** Machine-translated; unreviewed. */
export const signals: Record<keyof typeof ensignals, string> = {
  "signals.title": "Señales de ingeniería",
  "signals.intro":
    "Consulta avisos de dependencias, pruebas inestables, tendencias de duración y diferencias en claves de configuración de los repositorios que elijas. La lectura no modifica archivos.",
  "signals.root": "Carpeta del repositorio",
  "signals.add": "Vigilar carpeta",
  "signals.remove": "Dejar de vigilar",
  "signals.refresh": "Comprobar ahora",
  "signals.empty": "No hay señales actuales para los repositorios vigilados.",
  "signals.unconfigured": "Elige una carpeta de repositorio para empezar.",
  "signals.error": "No se pudieron leer las señales de ingeniería.",
  "signals.advisory": "Aviso de dependencia",
  "signals.flaky_test": "Prueba inestable",
  "signals.duration_trend": "Aumento de duración",
  "signals.config_drift": "Falta una clave de configuración",
  "signals.optin":
    "Las notificaciones proactivas requieren consentimiento explícito y respetan las horas de silencio y el límite por hora.",
  "signals.privacy": "Solo se comparan nombres de claves; nunca se muestran valores.",
  "signals.unknown.advisories":
    "Avisos de dependencias no evaluados (estado desconocido, no limpio):",
  "signals.unknown.history":
    "Historial de pruebas y tendencias de duración no evaluados (estado desconocido, no limpio):",
};
