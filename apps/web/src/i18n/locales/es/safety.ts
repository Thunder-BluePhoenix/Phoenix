// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { safety as ensafety } from "../../en/safety";

/** Machine-translated; unreviewed (see ../../README.md). */
export const safety: Record<keyof typeof ensafety, string> = {
  "safety.title": "Red de seguridad del agente",
  "safety.intro":
    "Antes de la primera edición notificada de un agente de programación en una sesión, Phoenix guarda una instantánea del proyecto en el propio repositorio git del proyecto (una referencia oculta; nunca se tocan tus ramas, el índice ni los stashes). Puedes revertir los archivos a ella, tras una vista previa y con tu aprobación.",
  "safety.timing":
    "Claude Code notifica un paso después de que la herramienta se ejecute, así que la instantánea se toma con la primera notificación de una edición: esa primera edición normalmente ya está incluida. La reversión deshace lo que el agente hizo después, no la primera edición en sí.",
  "safety.ignored":
    "Los archivos que git ignora (resultados de compilación, registros, dependencias) no se guardan y nunca se restauran ni se eliminan.",
  "safety.loadFailed": "No se pudo cargar la red de seguridad: {error}",
  "safety.killSwitch":
    "El interruptor de emergencia está activado, así que no se toman nuevos puntos de control.",

  "safety.warnings.title": "Avisos de Fawkes",
  "safety.warnings.loop": "Bucle",
  "safety.warnings.stall": "Atascado",
  "safety.warnings.line": "{kind} · {agent} en {repository}: {reason}",

  "safety.checkpoints.title": "Puntos de control",
  "safety.checkpoints.none":
    "Aún no hay ningún punto de control. Se toma uno cuando se notifica la primera edición de un agente.",
  "safety.checkpoints.row": "{agent} en {repository}",
  "safety.checkpoints.facts":
    "Tomado {taken} · {count, plural, one {# archivo} other {# archivos}} · se conserva hasta {expires}",
  "safety.checkpoints.rolledBack": "Revertido {when}",
  "safety.checkpoints.preview": "Vista previa de la reversión…",
  "safety.checkpoints.previewLabel":
    "Vista previa de la reversión al punto de control de {agent} en {repository}",
  "safety.checkpoints.close": "Cerrar vista previa",

  "safety.skipped.title": "Sesiones sin punto de control",
  "safety.skipped.line": "{agent} en {repository}: {reason}",
  "safety.skipped.disabled": "la red de seguridad está desactivada",
  "safety.skipped.kill_switch": "el interruptor de emergencia estaba activado",
  "safety.skipped.not_git":
    "esta carpeta no es un repositorio git, así que no hay nada de lo que tomar una instantánea",
  "safety.skipped.git_unavailable": "no se pudo ejecutar git",
  "safety.skipped.too_many_files": "el proyecto tiene más archivos que el límite",
  "safety.skipped.too_large": "el proyecto supera el límite de tamaño",
  "safety.skipped.throttled": "ya se tomó un punto de control en este proyecto en el último minuto",
  "safety.skipped.snapshot_failed": "git no pudo tomar la instantánea",

  "safety.preview.title": "Vista previa de la reversión",
  "safety.preview.counts":
    "{restore, plural, one {Se restauraría # archivo} other {Se restaurarían # archivos}}, {remove, plural, one {se eliminaría # archivo nuevo} other {se eliminarían # archivos nuevos}}, {kept, plural, one {se dejaría sin tocar # diferencia} other {se dejarían sin tocar # diferencias}}.",
  "safety.preview.restore": "Restaurados al punto de control",
  "safety.preview.remove": "Archivos nuevos que se eliminarían",
  "safety.preview.kept": "Sin tocar",
  "safety.preview.change.modified": "modificado",
  "safety.preview.change.deleted": "eliminado por el agente",
  "safety.preview.change.type_changed": "tipo cambiado",
  "safety.preview.why.tracked_by_head": "git lo rastrea, así que no se elimina",
  "safety.preview.why.ignored": "ignorado por git",
  "safety.preview.why.submodule": "un submódulo",
  "safety.preview.why.unsafe_path": "ruta no segura para tocar",
  "safety.preview.why.not_a_file": "no es un archivo normal",
  "safety.preview.truncated": "Las listas están recortadas; los recuentos de arriba son exactos.",
  "safety.preview.diff": "Cambios desde el punto de control",
  "safety.preview.diffTruncated": "El diff se ha recortado en su límite de tamaño.",
  "safety.preview.diffRedacted": "Se ocultó parte del texto que parecía un secreto.",
  "safety.preview.diffEmpty": "No hay cambios de texto que mostrar.",
  "safety.preview.nothing":
    "Los archivos ya coinciden con el punto de control. No hay nada que revertir.",
  "safety.preview.refusal.repository_missing": "El proyecto ya no es un repositorio git aquí.",
  "safety.preview.refusal.checkpoint_gone": "La instantánea ya no está en el repositorio.",
  "safety.preview.refusal.head_moved":
    "El HEAD del repositorio se movió desde el punto de control (un commit o un cambio de rama). Phoenix no revertirá a través de eso; no se cambió nada.",
  "safety.preview.refusal.snapshot_failed": "Git no pudo leer el árbol de trabajo.",
  "safety.preview.approvalNote":
    "Revertir pide primero tu aprobación. Nunca cambia el historial de git, las ramas, el índice ni los stashes, y se niega si los archivos cambian después de esta vista previa.",

  "safety.rollback.button": "Revertir…",
  "safety.rollback.waiting": "Esperando tu aprobación en la lista de aprobaciones de arriba…",
  "safety.rollback.done":
    "Revertido: {restored, plural, one {# archivo restaurado} other {# archivos restaurados}}, {removed, plural, one {# archivo nuevo eliminado} other {# archivos nuevos eliminados}}.",
  "safety.rollback.exact": "Los archivos ahora coinciden con el punto de control.",
  "safety.rollback.inexact":
    "Se dejaron sin tocar algunas diferencias, así que los archivos no coinciden exactamente con el punto de control.",

  "safety.settings.title": "Ajustes",
  "safety.settings.enabled":
    "Tomar un punto de control cuando se notifique la primera edición de un agente",
  "safety.settings.notify": "Enviar una notificación cuando Fawkes avise de un bucle o un atasco",
  "safety.settings.retention": "Conservar los puntos de control durante (días)",
  "safety.settings.maxFiles": "Omitir proyectos con más archivos que",
  "safety.settings.loopThreshold": "Aviso de bucle tras este número de repeticiones",
  "safety.settings.waitingMin": "Avisar cuando un agente lleve esperándote (minutos)",
  "safety.settings.idleMin": "Avisar cuando un agente activo lleve en silencio (minutos)",
  "safety.settings.saved": "Guardado.",
  "safety.settings.detectNote":
    "Los hooks no informan de códigos de salida ni del contenido de los archivos, así que un bucle significa el mismo comando ejecutado una y otra vez, o un archivo cuyas ediciones se deshacen entre sí (según el recuento de líneas).",
};
