// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { focus as enFocus } from "../../en/focus";

/** Machine-translated; unreviewed. */
export const focus: Record<keyof typeof enFocus, string> = {
  "focus.title": "Modo de concentración",
  "focus.start": "Iniciar concentración",
  "focus.stop": "Terminar concentración",
  "focus.minutes": "Minutos (vacío para duración ilimitada)",
  "focus.remaining": "Minutos restantes: {count}",
  "focus.active": "Concentración activa",
  "focus.inactive": "Concentración desactivada",
  "focus.held": "Notificaciones retenidas: {count}",
  "focus.osDnd": "No molestar del sistema está activo",
  "focus.osUnknown": "Estado de No molestar no disponible",
  "focus.refresh": "Actualizar estado del sistema",
  "focus.pomodoro": "Iniciar Pomodoro",
  "focus.systemUnavailable":
    "No hay No molestar del sistema disponible; el modo de concentración solo controla las notificaciones de Phoenix.",
  "focus.screenshot.title": "Captura a incidencia",
  "focus.screenshot.capture": "Seleccionar región de pantalla…",
  "focus.screenshot.permission": "Se requiere permiso para grabar la pantalla.",
  "focus.screenshot.error": "No se pudo completar: {error}",
  "focus.screenshot.box": "Recuadro",
  "focus.screenshot.arrow": "Flecha",
  "focus.screenshot.text": "Texto",
  "focus.screenshot.redact": "Ocultar permanentemente",
  "focus.screenshot.annotationText": "Texto de anotación",
  "focus.screenshot.project": "Repositorio o proyecto",
  "focus.screenshot.issueTitle": "Título de incidencia",
  "focus.screenshot.body": "Descripción",
  "focus.screenshot.preview": "Vista previa",
  "focus.screenshot.create": "Solicitar aprobación y crear incidencia",
  "focus.screenshot.draft": "Borrador (sin crear)",
  "focus.screenshot.attachment": "Captura adjunta si se admite",
  "focus.screenshot.noAttachment":
    "Este servicio no admite capturas adjuntas; no se enviará la imagen.",
  "focus.screenshot.created": "Incidencia creada: {url}",
  "focus.screenshot.declined": "No se aprobó; no se envió nada.",
  "focus.screenshot.tracker": "Gestor de incidencias",
  "focus.screenshot.tracker.github": "GitHub",
  "focus.screenshot.tracker.linear": "Linear",
  "focus.screenshot.tracker.jira": "Jira",
  "focus.issueDraft.title": "Incidencia a partir de una imagen que tienes",
  "focus.issueDraft.intro":
    "Suelta, pega o elige un PNG o JPEG que ya tengas, escribe la incidencia y revisa exactamente lo que se enviará. Phoenix no captura tu pantalla. La incidencia se crea en GitHub solo después de que confirmes aquí y otra vez en Aprobaciones.",
  "focus.issueDraft.unavailable.capability":
    "La integración de GitHub no está activada o no puede crear incidencias; no se puede crear nada.",
  "focus.issueDraft.unavailable.token":
    "No hay un token de escritura de GitHub para la integración de GitHub; no se puede crear nada.",
  "focus.issueDraft.dropLabel": "Suelta una imagen para la incidencia",
  "focus.issueDraft.dropHint": "Suelta o pega aquí un PNG o JPEG, o {choose}.",
  "focus.issueDraft.choose": "elige una imagen…",
  "focus.issueDraft.chooseLabel": "Elegir una imagen para la incidencia",
  "focus.issueDraft.imageAlt": "Imagen para la incidencia: {name}",
  "focus.issueDraft.imageRemove": "Quitar la imagen",
  "focus.issueDraft.oneImage": "Añade una sola imagen a la vez.",
  "focus.issueDraft.imageRequired": "Añade primero una imagen.",
  "focus.issueDraft.titleRequired": "Escribe un título para la incidencia.",
  "focus.issueDraft.titleTooLong": "El título puede tener como máximo {max} caracteres.",
  "focus.issueDraft.bodyTooLong": "La descripción puede tener como máximo {max} caracteres.",
  "focus.issueDraft.secretInTitle":
    "El título parece contener una contraseña, clave o token. Quítalo; no se envió nada.",
  "focus.issueDraft.secretInBody":
    "La descripción parece contener una contraseña, clave o token. Quítalo; no se envió nada.",
  "focus.issueDraft.secretInBoth":
    "El título y la descripción parecen contener una contraseña, clave o token. Quítalo; no se envió nada.",
  "focus.issueDraft.previewRepository": "Repositorio: {repository}",
  "focus.issueDraft.previewTitle": "Título: {title}",
  "focus.issueDraft.previewBody": "Descripción, exactamente como se enviará:",
  "focus.issueDraft.previewNoBody": "No se enviará ninguna descripción.",
  "focus.issueDraft.imageLocal":
    "La imagen ({name}) NO se envía. Las incidencias de GitHub se crean solo con texto; la imagen se queda en este dispositivo y no se guarda. Añádela tú mismo a la incidencia si quieres que esté allí.",
  "focus.issueDraft.approval":
    "Todavía no se crea nada. Después de pulsar el botón, Phoenix pide tu aprobación en Aprobaciones antes de enviar nada a GitHub.",
  "focus.issueDraft.create": "Pedir la creación de la incidencia",
  "focus.issueDraft.waiting": "Esperando tu aprobación en Aprobaciones…",
  "focus.issueDraft.denied": "Rechazaste la solicitud; no se envió nada a GitHub.",
  "focus.issueDraft.blocked": "La parada de emergencia está activada; no se envió nada a GitHub.",
  "focus.issueDraft.timeout": "La solicitud no se aprobó a tiempo o se canceló; no se envió nada.",
  "focus.issueDraft.failed": "No se pudo crear la incidencia: {message}",
};
