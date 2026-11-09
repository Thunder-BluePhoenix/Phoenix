// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "Capturar una región para una incidencia",
  "screenRegion.intro":
    "Elija Elegir región de pantalla, confirme en Aprobaciones y arrastre el área que quiera con el selector del sistema (Esc cancela). Solo macOS. La imagen se queda en esta página y no se guarda. La incidencia se crea solo con texto, después de que usted la apruebe. En Linear y Jira puede elegir después adjuntar la imagen censurada a esa incidencia en un paso aparte con su propia confirmación; GitHub es solo texto.",
  "screenRegion.projectLabel":
    "Repositorio de GitHub (owner/name), ID de equipo de Linear o clave de proyecto de Jira",
  "screenRegion.linearTeamInvalid":
    "Un ID de equipo de Linear se parece a 6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f; no se envió nada.",
  "screenRegion.jiraProjectInvalid":
    "Una clave de proyecto de Jira son mayúsculas, dígitos o guiones bajos, como PROJ; no se envió nada.",
  "screenRegion.issuesUnavailable":
    "La capacidad Seguimiento de incidencias está desactivada o no tiene los comandos de crear y adjuntar, así que no se envió nada. Actívela primero.",
  "screenRegion.issuesNoWriteCredential":
    "No hay credencial de escritura para {tracker} en Seguimiento de incidencias (las claves de sondeo nunca se usan para escribir), así que no se envió nada.",
  "screenRegion.issueKeyInvalid": "Esa no es una clave de incidencia válida; no se envió nada.",
  "focus.screenshot.textOnly":
    "La incidencia se crea solo con texto. La captura no forma parte de ella; en Linear y Jira puede ofrecerla aparte después.",
  "focus.screenshot.attach.title": "Adjuntar la captura (opcional)",
  "focus.screenshot.attach.intro":
    "La incidencia {key} de {tracker} se creó sin la imagen. Ahora puede adjuntarle la captura censurada. Es una subida aparte que Core le pide aprobar de nuevo. GitHub nunca recibe la imagen.",
  "focus.screenshot.attach.prepare": "Mostrar lo que se adjuntaría",
  "focus.screenshot.attach.details": "Lo que se adjuntaría",
  "focus.screenshot.attach.tracker": "Servicio: {tracker}",
  "focus.screenshot.attach.issue": "Incidencia: {key}",
  "focus.screenshot.attach.file": "Nombre de archivo: {name}",
  "focus.screenshot.attach.size": "Tamaño: {bytes} bytes",
  "focus.screenshot.attach.hash": "Hash del contenido (SHA-256, primeros 12 caracteres): {hash}",
  "focus.screenshot.attach.redacted":
    "Esta es la imagen tal como está censurada y anotada en esta página; las censuras ya están integradas. Todavía no se ha enviado nada.",
  "focus.screenshot.attach.confirm": "Sí, subir esta imagen a {tracker}",
  "focus.screenshot.attach.send": "Pedir aprobación y adjuntar",
  "focus.screenshot.attach.done": "La captura se adjuntó a {key}.",
  "focus.screenshot.attach.problem.badImage": "La imagen no es un PNG válido y no se envió.",
  "focus.screenshot.attach.problem.tooLarge": "La imagen supera 5 MiB y no se envió.",
  "focus.screenshot.attach.problem.changed":
    "La imagen cambió después de revisarla; revísela de nuevo. No se envió nada.",
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
};
