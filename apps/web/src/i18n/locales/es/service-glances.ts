// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { serviceGlances as enServiceGlances } from "../../en/service-glances";

/** Machine-translated; unreviewed (see ../../README.md). */
export const serviceGlances: Record<keyof typeof enServiceGlances, string> = {
  "services.glance.heading": "{name} de un vistazo",
  "services.glance.disabled": "{name} está desactivado. Actívalo en Capacidades para verlo aquí.",
  "services.glance.loading": "Cargando…",
  "services.glance.error": "No se pudo leer {name}.",
  "services.glance.stale": "No se pudo actualizar {name}; se muestran los últimos datos.",
  "services.glance.unreadable": "{name} devolvió datos que esta página no puede leer.",
  "services.glance.updated": "Actualizado {time}",
  "services.glance.state.unknown": "Desconocido",
  "services.glance.vercel.notConfigured":
    "Añade un token de Vercel en Ajustes para ver los despliegues.",
  "services.glance.vercel.empty": "Aún no hay despliegues.",
  "services.glance.vercel.summary": "Despliegues recientes: {count}",
  "services.glance.vercel.failed": "Fallidos: {count}",
  "services.glance.vercel.building": "En curso: {count}",
  "services.glance.vercel.state.queued": "En cola",
  "services.glance.vercel.state.initializing": "Iniciando",
  "services.glance.vercel.state.building": "Compilando",
  "services.glance.vercel.state.ready": "Listo",
  "services.glance.vercel.state.error": "Fallido",
  "services.glance.vercel.state.canceled": "Cancelado",
  "services.glance.stripe.notConfigured":
    "Añade en Ajustes una clave de Stripe restringida de solo lectura para ver los pagos.",
  "services.glance.stripe.empty": "No hay pagos recientes.",
  "services.glance.stripe.counted": "Últimos pagos contados: {count}",
  "services.glance.stripe.succeeded": "Correctos: {count}",
  "services.glance.stripe.failed": "Fallidos: {count}",
  "services.glance.stripe.pending": "Pendientes: {count}",
  "services.glance.stripe.received": "Recibido: {amounts}",
  "services.glance.stripe.failedAmount": "Importes fallidos: {amounts}",
  "services.glance.stripe.available": "Saldo disponible: {amounts}",
  "services.glance.stripe.pendingBalance": "Saldo pendiente: {amounts}",
  "services.glance.stripe.privacy":
    "Solo importes y recuentos. Nunca se muestran clientes ni tarjetas.",
  "services.glance.stripe.state.succeeded": "Correcto",
  "services.glance.stripe.state.failed": "Fallido",
  "services.glance.stripe.state.pending": "Pendiente",
  "services.glance.stripe.state.refunded": "Reembolsado",
  "services.glance.n8n.notConfigured":
    "Indica tu dirección de n8n y añade una clave de API en Ajustes para ver las ejecuciones.",
  "services.glance.n8n.empty": "No hay ejecuciones recientes.",
  "services.glance.n8n.summary": "Ejecuciones recientes: {count}",
  "services.glance.n8n.failed": "Fallidas: {count}",
  "services.glance.n8n.workflows": "Flujos activos: {active} de {total}",
  "services.glance.n8n.host": "La clave de API se envía a {host}",
  "services.glance.n8n.state.success": "Correcta",
  "services.glance.n8n.state.error": "Fallida",
  "services.glance.n8n.state.crashed": "Interrumpida",
  "services.glance.n8n.state.running": "En ejecución",
  "services.glance.n8n.state.waiting": "En espera",
  "services.glance.n8n.state.new": "En cola",
};
