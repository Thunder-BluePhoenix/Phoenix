// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { digest as endigest } from "../../en/digest";

/** Machine-translated; unreviewed. */
export const digest: Record<keyof typeof endigest, string> = {
  "digest.title": "Resumen diario",
  "digest.yesterday": "Ayer",
  "digest.today": "Hoy (planes confirmados)",
  "digest.blockers": "Bloqueos",
  "digest.endOfDay": "Fin del día",
  "digest.source": "Fuente",
  "digest.none": "Sin actividad vinculada",
  "digest.date": "Fecha",
  "digest.localNote":
    "Generado localmente a partir de actividad vinculada. No se usa ningún modelo en la nube.",
  "digest.error": "No se pudo cargar o copiar el resumen.",
  "digest.loading": "Cargando resumen…",
  "digest.copy": "Copiar con fuentes",
  "digest.copied": "Copiado",
  "digest.slackHeading": "Enviar a Slack",
  "digest.slackDisclosure":
    "El envío comparte este resumen, actividad citada, afirmaciones de eventos no verificadas y contenido posiblemente derivado de reuniones con el canal de Slack configurado. Core solicita confirmación antes de cada envío.",
  "digest.slackOptIn": "Permitir el envío del resumen diario a Slack",
  "digest.sendSlack": "Enviar a Slack",
  "digest.slack.disabled": "El envío del resumen diario a Slack está desactivado.",
  "digest.slack.chat_unavailable": "Primero habilite las aprobaciones de chat.",
  "digest.slack.slack_unconfigured": "Primero configure y habilite Slack en Aprobaciones de chat.",
  "digest.slack.missing_token": "El token configurado del bot de Slack no está disponible.",
  "digest.slack.emergency_stop": "El envío está bloqueado por la parada de emergencia.",
  "digest.slack.ready": "El envío a Slack está listo.",
  "digest.slackUnavailable": "El envío del resumen diario a Slack no está disponible.",
  "digest.slackWaiting": "Esperando su confirmación de Core…",
  "digest.slackError": "No se pudo completar el envío a Slack. No se reintentó automáticamente.",
  "digest.slackSent": "El resumen diario de {day} se envió a Slack.",
  "digest.sendUnavailable":
    "El envío a Slack y Teams no está disponible hasta conectar una integración aprobada.",
  "digest.back": "Volver al resumen",
  "digest.eventTitle": "Evidencia del evento",
  "digest.eventMissing": "Este evento ya no está disponible.",
  "digest.unverified":
    "Sin verificar: es una afirmación de evento almacenada localmente, no evidencia verificada por el proveedor.",
  "digest.commitTitle": "Commit",
  "digest.commitMissing": "Este commit no está en un repositorio vigilado.",
  "digest.noneIncomplete": "No se encontró nada en las fuentes que se pudieron leer.",
  "digest.noticeHeading": "Resumen incompleto",
  "digest.noticeUnavailable":
    "No se pudo leer, por lo que al resumen le puede faltar actividad: {sources}.",
  "digest.noticePartial":
    "Solo se leyeron los registros más recientes; puede faltar actividad anterior: {sources}.",
  "digest.noticeUnattributed":
    "No hay identidad de git (user.email) configurada, así que los commits se omitieron en lugar de mostrarse como tuyos: {sources}.",
  "digest.sources.git": "repositorios git",
  "digest.sources.events": "historial de eventos",
  "digest.sources.sessions": "sesiones de agente",
  "digest.sources.meetings": "reuniones",
};
