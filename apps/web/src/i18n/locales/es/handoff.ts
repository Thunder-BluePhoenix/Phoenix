// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { handoff as enhandoff } from "../../en/handoff";

/** Machine-translated; unreviewed (see ../../README.md). */
export const handoff: Record<keyof typeof enhandoff, string> = {
  "handoff.title": "Notas de traspaso",
  "handoff.intro":
    "Una nota de traspaso es un resumen breve que Phoenix elabora con reglas fijas, sin ningún modelo, a partir de lo que un agente de programación informó durante una sesión: el objetivo (solo cuando el agente informó de un título de tarea), los archivos que cambió con el número de líneas, los comandos que ejecutó (sin secretos) y las preguntas abiertas. Phoenix no ha comprobado nada de eso, así que tómalo como lo que dijo el agente, no como una prueba. Las notas se guardan en este equipo, en la carpeta de datos de Phoenix, legibles solo por ti; se conservan las 50 más recientes, y “Eliminar todo” de “handoff” en Privacidad las borra.",

  "handoff.settings.legend": "Ajustes de traspaso",
  "handoff.settings.auto": "Escribir una nota cuando termine una sesión de un agente",
  "handoff.settings.allowCloud":
    "Permitir que un modelo en la nube escriba el resumen opcional (desactivado: solo un modelo de este dispositivo)",
  "handoff.settings.cloudWarning":
    "Si lo activas, el texto de la nota (comandos con datos ocultos y nombres de archivo) puede salir de este equipo hacia un modelo en la nube cuando pidas un resumen. Los permisos de nube de los ajustes de IA se siguen aplicando además de esta opción.",
  "handoff.settings.saved": "Ajustes guardados.",
  "handoff.settings.unavailable": "No se pudieron cargar los ajustes de traspaso.",
  "handoff.notes.unavailable": "No se pudieron cargar las notas de traspaso.",
  "handoff.guard.unavailable": "No se pudieron cargar los resultados del guardián de secretos.",
  "handoff.notes.title": "Notas guardadas",
  "handoff.notes.listLabel": "Notas de traspaso",
  "handoff.notes.empty": "Todavía no se ha escrito ninguna nota de traspaso.",
  "handoff.notes.open": "{date} {time} · {agent}",
  "handoff.notes.meta": "{project} · {files} · {lines}",
  "handoff.notes.files": "{count, plural, one {# archivo} many {# de archivos} other {# archivos}}",
  "handoff.notes.lines": "+{added} −{removed}",
  "handoff.notes.noProject": "sin proyecto",
  "handoff.notes.hasSummary": "Resumen de modelo",
  "handoff.notes.detailLabel": "Nota seleccionada",
  "handoff.notes.loading": "Cargando la nota…",
  "handoff.notes.trigger.auto": "Escrita automáticamente",
  "handoff.notes.trigger.user": "La pediste tú",
  "handoff.notes.textLabel": "Texto de la nota",

  "handoff.summary.title": "Resumen de modelo",
  "handoff.summary.processedBy": "Escrito por: {by}",
  "handoff.summary.warning":
    "Un modelo escribió este resumen y puede contener errores. Compruébalo antes de fiarte de él.",
  "handoff.summary.add": "Añadir un resumen de modelo",
  "handoff.summary.note":
    "Phoenix solo usa un modelo de este dispositivo, salvo que hayas permitido un modelo en la nube más arriba.",
  "handoff.summary.added": "Resumen añadido.",

  "handoff.delete.button": "Eliminar nota",
  "handoff.delete.done": "Nota eliminada.",

  "handoff.generate.title": "Escribir una nota para una sesión",
  "handoff.generate.sessionLabel": "Sesión",
  "handoff.generate.choose": "Elige una sesión",
  "handoff.generate.option": "{agent} · {repository} · {time}",
  "handoff.generate.none":
    "Aún no se conoce ninguna sesión de agente de programación, así que no hay nada sobre lo que escribir una nota.",
  "handoff.generate.button": "Escribir una nota",
  "handoff.generate.done": "Nota escrita.",

  "handoff.attach.title": "Usar esta nota",
  "handoff.attach.targetLabel": "Adónde va",
  "handoff.attach.target.commit_message": "Un mensaje de commit",
  "handoff.attach.target.pr_description": "La descripción de una pull request",
  "handoff.attach.target.task": "Una issue de GitHub",
  "handoff.attach.repositoryLabel": "Repositorio de GitHub (owner/name)",
  "handoff.attach.repositoryInvalid":
    "Escribe el repositorio como owner/name, por ejemplo acme/app.",
  "handoff.attach.preview": "Vista previa",
  "handoff.attach.previewAgain": "Ver de nuevo la vista previa",
  "handoff.attach.confirm": "Confirmar",
  "handoff.attach.previewLabel": "Vista previa de lo que se adjuntará",
  "handoff.attach.issueTitle": "Título de la issue: {title}",
  "handoff.attach.textLabel": "Exactamente este texto",
  "handoff.attach.delivery.copy":
    "Phoenix no lo escribe en ningún sitio: confirma para copiarlo y luego pégalo tú mismo.",
  "handoff.attach.delivery.copyPr":
    "Phoenix todavía no tiene ningún comando que edite la descripción de una pull request: solo copiar. Confirma para copiarlo y luego pégalo tú mismo.",
  "handoff.attach.delivery.issue":
    "Phoenix creará una issue de GitHub en {repository} con la capacidad github. Se te pedirá confirmar una vez más y necesita el token de escritura.",
  "handoff.attach.stale":
    "La nota cambió después de esta vista previa, así que no se adjuntó nada. Vuelve a ver la vista previa.",
  "handoff.attach.copied": "Copiado al portapapeles. Pégalo donde lo necesites.",
  "handoff.attach.copyByHand":
    "Phoenix no pudo usar el portapapeles. Selecciona el texto de abajo y cópialo a mano.",
  "handoff.attach.issueCreated": "Se creó la issue #{number} en {repository}.",
  "handoff.attach.issueExisting": "La issue #{number} en {repository} ya existía.",
  "handoff.attach.issueAddress": "Dirección: {url}",

  "handoff.guard.title": "Guardián de secretos",
  "handoff.guard.intro":
    "El guardián de secretos se instala con el instalador de hooks de agentes de arriba: forma parte de los hooks que Phoenix añade a Claude Code y Codex. Bloquea una llamada a una herramienta, un git commit o un git push cuya entrada o cambios preparados contengan un secreto que reconoce el detector de Phoenix, y le dice al agente qué tipo de secreto se encontró y dónde, nunca el secreto.",
  "handoff.guard.override":
    "Solo puedes anular un bloqueo mediante una tarjeta de aprobación; el agente no puede anularlo.",
  "handoff.guard.heuristic":
    "El detector es heurístico, no una garantía de que nada se filtre: un secreto que no reconoce no se detecta.",
  "handoff.guard.failOpen":
    "Si Phoenix Core o el hook no pueden ejecutarse, el trabajo del agente continúa (el guardián falla en abierto), salvo que un secreto encontrado siempre se bloquea.",
  "handoff.guard.countsLabel": "Resultados del guardián de secretos",
  "handoff.guard.allowed": "Permitidas tras una comprobación: {count}",
  "handoff.guard.blocked": "Bloqueadas: {count}",
  "handoff.guard.overridden": "Permitidas tras tu aprobación: {count}",
  "handoff.guard.since": "Contado desde {date} {time}",
  "handoff.guard.noResults": "Aún no hay resultados.",
  "handoff.guard.recentLabel": "Resultados recientes del guardián de secretos",
  "handoff.guard.row": "{date} {time} · {agent} · {tool}",
  "handoff.guard.outcome.blocked": "bloqueada",
  "handoff.guard.outcome.overridden": "permitida tras tu aprobación",
  "handoff.guard.finding": "{kind} en {location}",
};
