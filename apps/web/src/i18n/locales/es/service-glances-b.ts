// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { serviceGlancesB as enServiceGlancesB } from "../../en/service-glances-b";

/** Machine-translated; unreviewed (see ../../README.md). */
export const serviceGlancesB: Record<keyof typeof enServiceGlancesB, string> = {
  "services.glance.resend.notConfigured":
    "Añade una clave de API de Resend en los secretos de la capacidad Resend para ver aquí el estado de las entregas.",
  "services.glance.resend.empty": "No hay correos enviados recientemente que contar.",
  "services.glance.resend.summary":
    "{count, plural, one {# correo reciente} other {# correos recientes}}",
  "services.glance.resend.newest": "El más reciente: {time}",
  "services.glance.resend.privacy":
    "Solo recuentos. Aquí nunca se muestran los asuntos ni los destinatarios.",
  "services.glance.resend.state.delivered": "Entregado",
  "services.glance.resend.state.inFlight": "En camino",
  "services.glance.resend.state.delayed": "Retrasado",
  "services.glance.resend.state.bounced": "Rebotado",
  "services.glance.resend.state.complained": "Marcado como spam",
  "services.glance.resend.state.failed": "Fallido",
  "services.glance.resend.state.other": "Otro",

  "services.glance.notion.notConfigured":
    "Añade un token de integración de Notion en los secretos de la capacidad Notion para ver aquí tus páginas vigiladas.",
  "services.glance.notion.empty":
    "No hay páginas ni bases de datos vigiladas que mostrar. Indícalas por id en los ajustes de la capacidad Notion.",
  "services.glance.notion.summary":
    "{count, plural, one {# elemento vigilado} other {# elementos vigilados}}",
  "services.glance.notion.privacy":
    "Solo títulos y horas de edición. Nunca se lee el contenido de las páginas.",
  "services.glance.notion.untitled": "Sin título",
  "services.glance.notion.kind.page": "Página",
  "services.glance.notion.kind.database": "Base de datos",
  "services.glance.notion.kind.archived": "Archivado",
  "services.glance.notion.edited": "Editado {time}",
  "services.glance.notion.open": "Abrir en Notion",
  "services.glance.notion.openNamed": "Abrir {title} en Notion",

  "services.glance.calcom.notConfigured":
    "Añade una clave de API de Cal.com en los secretos de la capacidad Cal.com para ver aquí tus reservas.",
  "services.glance.calcom.empty": "No hay reservas próximas.",
  "services.glance.calcom.summary":
    "{count, plural, one {# reserva próxima} other {# reservas próximas}}",
  "services.glance.calcom.privacy":
    "Solo horas y número de asistentes. Aquí nunca se muestran nombres ni direcciones de correo.",
  "services.glance.calcom.booking": "Reserva",
  "services.glance.calcom.status.accepted": "Confirmada",
  "services.glance.calcom.status.pending": "Esperando confirmación",
  "services.glance.calcom.status.other": "Otro",
  "services.glance.calcom.attendees": "{count, plural, one {# asistente} other {# asistentes}}",
  "services.glance.calcom.more": "{count, plural, one {# reserva más} other {# reservas más}}",
};
