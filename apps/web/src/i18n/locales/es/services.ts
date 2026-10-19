// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { services as enservices } from "../../en/services";

/** Machine-translated; unreviewed (see ../../README.md). */
export const services: Record<keyof typeof enservices, string> = {
  "services.common.notYetLoaded": "Aún no se ha cargado.",

  "services.overview.nothingRunning": "No hay nada en ejecución.",
  "services.overview.taskProgress": "Progreso de {title}",
  "services.overview.showFewer": "Mostrar menos",
  "services.overview.showAll":
    "{count, plural, one {Mostrar # tarea} other {Mostrar las # tareas}}",
  "services.overview.stateFor": "desde hace {since}",
  "services.overview.recordingActive": "La grabación está activa.",
  "services.overview.activeTasks": "Tareas activas",
  "services.overview.quickActions": "Acciones rápidas",
  "services.overview.dismissErrors": "Descartar errores",
  "services.overview.wake": "Despertar a Fawkes",
  "services.overview.pause": "Pausar a Fawkes",
  "services.overview.releaseStop": "Liberar la parada de emergencia",
  "services.overview.confirmStop": "Confirmar: detener todas las capacidades",
  "services.overview.emergencyStop": "Parada de emergencia",
  "services.overview.stopOn":
    "La parada de emergencia está activada: todas las capacidades están desactivadas y las acciones bloqueadas.",

  "services.integrations.agents.title": "Agentes de programación",
  "services.integrations.agents.empty": "Ningún agente de programación ha informado todavía.",
  "services.integrations.agents.stateReason": "{state} ({reason})",
  "services.integrations.agents.state.started": "Iniciado",
  "services.integrations.agents.state.working": "Trabajando",
  "services.integrations.agents.state.waiting": "Necesita tu respuesta",
  "services.integrations.agents.state.idle": "Inactivo",
  "services.integrations.agents.state.completed": "Terminado",
  "services.integrations.agents.state.failed": "Fallido",
  "services.integrations.frappe.title": "Sitios de Frappe",
  "services.integrations.frappe.empty":
    "No se encontraron sitios. Selecciona un bench en Capacidades.",
  "services.integrations.frappe.status.checking": "Comprobando",
  "services.integrations.frappe.status.healthy": "Correcto",
  "services.integrations.frappe.status.unhealthy": "No responde",
  "services.integrations.frappe.responseMs": "{ms} ms",
  "services.integrations.frappe.lastHealthy": "Último estado correcto: {ago}",

  "services.capabilities.empty": "No hay capacidades instaladas.",
  "services.capabilities.status.installed": "No activada",
  "services.capabilities.status.enabled": "Activada",
  "services.capabilities.status.disabled": "Desactivada",
  "services.capabilities.status.failed": "No se pudo iniciar",
  "services.capabilities.status.disconnected": "No está en ejecución",
  "services.capabilities.health.healthy": "correcta",
  "services.capabilities.health.degraded": "degradada",
  "services.capabilities.health.unhealthy": "con fallos",
  "services.capabilities.enable": "Activar",
  "services.capabilities.disable": "Desactivar",
  "services.capabilities.enableNamed": "Activar {name}",
  "services.capabilities.disableNamed": "Desactivar {name}",
  "services.capabilities.version": "v{version}",
  "services.capabilities.stoppedByKill": "detenida por la parada de emergencia",
  "services.capabilities.permissions": "Permisos ({count})",
  "services.capabilities.granted": "(concedido)",
  "services.capabilities.notGranted": "(no concedido)",
  "services.capabilities.accesses": "Accede a: {categories}",

  "services.media.heading": "Reproduciendo · {name}",
  "services.media.notRunning": "{name} no está en ejecución.",
  "services.media.nothingPlaying": "No se reproduce nada",
  "services.media.previous": "Anterior",
  "services.media.next": "Siguiente",
  "services.media.play": "Reproducir",
  "services.media.pause": "Pausar",
  "services.media.shuffleOn": "Aleatorio activado",
  "services.media.shuffleOff": "Aleatorio desactivado",
  "services.media.repeat": "Repetir: {mode}",
  "services.media.repeatMode.off": "no",
  "services.media.repeatMode.one": "una",
  "services.media.repeatMode.all": "todas",
  "services.media.seek": "Posición",
  "services.media.volume": "Volumen",
  "services.media.waitingApproval": "Esperando tu aprobación…",

  "services.portfolio.title": "Cartera",
  "services.portfolio.change24h": "24 h",
  "services.portfolio.chart": "Valor en 7 días",
  "services.portfolio.unpriced":
    "{count, plural, one {# sin precio, no incluido en el total.} other {# sin precio, no incluidos en el total.}}",
  "services.portfolio.sourceError": "{name}: {error}",
  "services.portfolio.sourceUnreadable": "{name}: no se pudo leer",
  "services.portfolio.prices": "Precios: {source}.",
  "services.portfolio.updated": "Actualizado {ago}.",

  "services.ai.title": "Proveedores de IA",
  "services.ai.empty": "No se encontraron proveedores de IA.",
  "services.ai.locality.local": "En este dispositivo",
  "services.ai.locality.cloud": "Nube (sale de este dispositivo)",
  "services.ai.automatic": "Automático (primero en este dispositivo)",
  "services.ai.defaultModel": "modelo predeterminado",
  "services.ai.provider.available": "Disponible",
  "services.ai.provider.unavailable": "No disponible",
  "services.ai.provider.unavailableReason": "No disponible: {reason}",
  "services.ai.provider.keyNotNeeded": "No necesita clave",
  "services.ai.provider.keySet": "Clave establecida",
  "services.ai.provider.keyMissing": "Falta la clave",
  "services.ai.provider.replaceKey": "Reemplazar clave",
  "services.ai.provider.setKey": "Establecer clave",
  "services.ai.provider.apiKey": "Clave de API de {provider}",
  "services.ai.provider.keyNote":
    "Solo escritura: se guarda en el llavero de tu OS y no se vuelve a mostrar. Solo se usa si permites la IA externa.",
  "services.ai.provider.saveKey": "Guardar la clave de {provider}",
  "services.ai.provider.removeKey": "Quitar la clave de {provider}",
  "services.ai.provider.keySaved":
    "Clave establecida. Se guarda en el llavero de tu OS y no se vuelve a mostrar.",
  "services.ai.provider.keyRemoved": "Clave eliminada de tu llavero.",
  "services.ai.endpoints.legend": "Endpoints personalizados (servidores compatibles con OpenAI)",
  "services.ai.endpoints.note":
    "Phoenix determina si una dirección está en este equipo o en la nube; tú no puedes indicarlo. Cualquier dirección que no sea este equipo debe usar https.",
  "services.ai.endpoints.empty": "No hay endpoints personalizados.",
  "services.ai.endpoints.list": "Endpoints personalizados",
  "services.ai.endpoints.remove": "Quitar el endpoint {label}",
  "services.ai.endpoints.id": "ID",
  "services.ai.endpoints.baseUrl": "URL base",
  "services.ai.endpoints.addressLocal": "Esta dirección está en este dispositivo.",
  "services.ai.endpoints.addressCloud":
    "Esta dirección está en la nube (sale de este dispositivo).",
  "services.ai.endpoints.preset": "Preajuste (opcional)",
  "services.ai.endpoints.add": "Añadir endpoint",
  "services.ai.endpoints.added": "Endpoint {name} añadido.",
  "services.ai.endpoints.removed": "Endpoint {name} eliminado.",
  "services.ai.endpoints.tooMany": "Puedes añadir como máximo {max} endpoints.",
  "services.ai.endpoints.badId":
    "El ID debe tener de 2 a 24 caracteres: letras minúsculas, dígitos y guiones, y empezar por una letra.",
  "services.ai.endpoints.idTaken": "Otro proveedor ya usa ese ID.",
  "services.ai.endpoints.badName": "El nombre debe tener de 1 a 40 caracteres.",
  "services.ai.endpoints.urlInvalid":
    "Introduce una dirección completa, como https://api.example.com/v1.",
  "services.ai.endpoints.urlScheme": "La dirección debe empezar por https:// o http://.",
  "services.ai.endpoints.urlInsecure":
    "Usa https; http sin cifrar solo se permite para este equipo.",
  "services.ai.routing.legend": "Qué modelo hace cada cosa",
  "services.ai.routing.note":
    "Una ruta en la nube sigue necesitando el permiso para enviar datos a IA externa y la aceptación para el tipo de memoria, ambos más abajo. Sin ellos no se envía nada y se muestra el motivo.",
  "services.ai.routing.providerLocal": "{label} (en este dispositivo)",
  "services.ai.routing.providerCloud": "{label} (nube)",
  "services.ai.routing.chat.name": "Chat",
  "services.ai.routing.chat.help": "Respuestas a tus preguntas en el chat y en Ask Fawkes.",
  "services.ai.routing.chat.provider": "Proveedor del chat",
  "services.ai.routing.chat.model": "Modelo del chat (opcional)",
  "services.ai.routing.chat.save": "Guardar ruta del chat",
  "services.ai.routing.chat.saved": "Ruta del chat guardada.",
  "services.ai.routing.summaries.name": "Resúmenes",
  "services.ai.routing.summaries.help":
    "Resúmenes de reuniones, planes, extracción y diagnóstico de CI.",
  "services.ai.routing.summaries.provider": "Proveedor de resúmenes",
  "services.ai.routing.summaries.model": "Modelo de resúmenes (opcional)",
  "services.ai.routing.summaries.save": "Guardar ruta de resúmenes",
  "services.ai.routing.summaries.saved": "Ruta de resúmenes guardada.",
  "services.ai.routing.cleanup.name": "Limpieza",
  "services.ai.routing.cleanup.help": "Pulido del texto dictado.",
  "services.ai.routing.cleanup.provider": "Proveedor de limpieza",
  "services.ai.routing.cleanup.model": "Modelo de limpieza (opcional)",
  "services.ai.routing.cleanup.save": "Guardar ruta de limpieza",
  "services.ai.routing.cleanup.saved": "Ruta de limpieza guardada.",
  "services.ai.prices.legend": "Precios (opcional)",
  "services.ai.prices.note":
    "Phoenix no incluye precios. Los costes se muestran solo a partir de los números que introduzcas.",
  "services.ai.prices.modelKey": "Clave del modelo, fila {n}",
  "services.ai.prices.input": "Entrada, $ por 1M de tokens, fila {n}",
  "services.ai.prices.output": "Salida, $ por 1M de tokens, fila {n}",
  "services.ai.prices.removeRow": "Quitar la fila de precio {n}",
  "services.ai.prices.add": "Añadir precio",
  "services.ai.prices.save": "Guardar precios",
  "services.ai.prices.saved": "Precios guardados.",
  "services.ai.prices.badKey":
    'Usa el formato provider:model para la clave del modelo, por ejemplo "openai:gpt-4o".',
  "services.ai.prices.duplicateKey": "La clave de modelo {key} aparece dos veces.",
  "services.ai.prices.badNumber":
    "Los precios de {key} deben ser números iguales o mayores que cero.",

  "services.model.loading": "Modelo: cargando…",
  "services.model.button": "Modelo: {label}",
  "services.model.current": "{model} · {provider}",
  "services.model.default": "Predeterminado ({model})",
  "services.model.keyHint":
    "Añade la clave en Ajustes, Proveedores de IA. Aun así puedes elegirlo.",
  "services.model.aiOff": "La IA está desactivada",
  "services.model.providers": "Proveedores",
  "services.model.models": "Modelos",
  "services.model.modelsFor": "Modelos de {provider}",
  "services.model.loadingModels": "Cargando modelos…",
  "services.model.loadFailed": "No se pudo cargar la lista de modelos",
  "services.model.listFailed":
    "No se pudieron listar los modelos: {error}. Solo se muestra el modelo predeterminado.",
  "services.model.notListed": "Este proveedor no listó sus modelos.",
  "services.model.cloudNote":
    "Un modelo en la nube solo recibe lo que has permitido en Ajustes, IA.",

  "services.demo.banner": "Demo - no se guarda nada",
  "services.demo.bannerDetail":
    "Es un recorrido guionizado en un Core temporal y aparte. Tus datos no se tocan.",
  "services.demo.settingsTitle": "Modo demo",
  "services.demo.settingsIntro":
    "Mira cómo reacciona Fawkes a compilaciones, agentes, despliegues y reuniones. La demo se ejecuta en un Core aparte que lo mantiene todo en memoria, no envía nada a ningún sitio y se elimina al detenerla. Tus propios datos ni se leen ni se modifican.",
  "services.demo.start": "Iniciar demo",
  "services.demo.starting": "Iniciando demo...",
  "services.demo.stop": "Detener la demo y volver",
  "services.demo.play": "Reproducir este paso",
  "services.demo.next": "Paso siguiente",
  "services.demo.previous": "Paso anterior",
  "services.demo.playing": "Reproduciendo",
  "services.demo.finished": "Ese era el último paso. Detén la demo para volver a tu Phoenix.",
  "services.demo.stepOf": "Paso {n} / {total}",
  "services.demo.stepCount": "{count, plural, one {# paso} other {# pasos}}",
  "services.demo.startFailed": "No se pudo iniciar la demo",
  "services.demo.stopFailed":
    "No se pudo detener la demo limpiamente; se detiene sola cuando está inactiva",
  "services.demo.playFailed": "No se pudo reproducir el paso de la demo",
  "services.demo.invalidSession": "Core envió una dirección de demo no válida; no se abrió la demo",
  "services.demo.offline":
    "No se puede acceder al Core de la demo. Puede que se haya detenido por inactividad.",
  "services.demo.recordingActive":
    "Se está grabando una llamada. Detén la grabación antes de iniciar la demo.",
  "services.demo.voiceStopped":
    "La escucha por voz se desactivó para la demo. Vuelve a activarla después.",
  "services.demo.failureDetail": "{message}: {detail}",
  "services.demo.caption.build-pass":
    "Una compilación se ejecuta y pasa. Fawkes trabaja mientras corre y luego lo celebra. Nada de esto es real.",
  "services.demo.caption.build-fail":
    "Una compilación falla. Fawkes muestra el error y lo mantiene en pantalla hasta que lo confirmes.",
  "services.demo.caption.tests":
    "Las pruebas se ejecutan y pasan. Fawkes muestra el trabajo y lo quita al terminar.",
  "services.demo.caption.agent-waiting":
    "Un agente de programación trabaja y luego te necesita. Fawkes espera y te dice qué está esperando.",
  "services.demo.caption.agent-done":
    "Un agente de programación termina. Fawkes marca la tarea como completada.",
  "services.demo.caption.deploy": "Un despliegue en staging avanza. Fawkes lo sigue paso a paso.",
  "services.demo.caption.deploy-fail":
    "Un despliegue en producción falla. Fawkes lo señala de inmediato como un error.",
  "services.demo.caption.meeting":
    "Una reunión se graba, se transcribe y se resume. Fawkes muestra el indicador de grabación mientras dura.",
  "services.demo.caption.frappe-down":
    "Un sitio de Frappe se cae y luego se recupera. Fawkes te avisa y lo quita.",
  "services.demo.caption.merge-conflict":
    "Aparece un conflicto de fusión y se resuelve. Fawkes te avisa y después se aplica el commit.",
};
