// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "Capturar una región para una incidencia",
  "screenRegion.intro":
    "Pulsa Elegir región de pantalla, confirma en Aprobaciones y arrastra el área que quieras con el selector del sistema (Esc cancela). Solo funciona en macOS. La imagen se queda en esta página y no se guarda; la incidencia se crea solo como texto, en GitHub, tras aprobarla de nuevo.",
  "screenRegion.unavailable":
    "La captura de región está desactivada. Activa la capacidad Captura de región de pantalla y permite la captura de pantalla para usarla. Solo funciona en macOS.",
  "screenRegion.cancelled": "Cancelaste la selección, así que no se capturó nada.",
  "screenRegion.declined": "Lo rechazaste, así que no se capturó nada.",
  "screenRegion.blocked": "La parada de emergencia está activa, así que no se capturó nada.",
  "screenRegion.timeout":
    "No se eligió ninguna región a tiempo o la solicitud no se aprobó; no se capturó nada.",
  "screenRegion.failed": "No se pudo capturar la región: {message}",
  "screenRegion.badImage": "La captura no era una imagen PNG válida y se descartó.",
  "screenRegion.tooLarge": "La región capturada supera 5 MiB y se descartó.",
  "screenRegion.unsupported": "La captura de región solo es compatible con macOS.",
  "screenRegion.expired": "La captura ya no estaba disponible. Elige una región de nuevo.",
  "screenRegion.trackerUnsupported":
    "Solo GitHub puede crear una incidencia desde aquí; Linear y Jira aún no, así que no se envió nada.",
};
