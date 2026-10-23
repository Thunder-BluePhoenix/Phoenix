// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { automation as enAutomation } from "../../en/automation";

/** Machine-translated; unreviewed (see ../../README.md). */
export const automation: Record<keyof typeof enAutomation, string> = {
  // ---- workflows: tables and checks (core/workflows.ts) ----
  "automation.workflows.environment.local": "Local",
  "automation.workflows.environment.dev": "Desarrollo",
  "automation.workflows.environment.staging": "Preproducción",
  "automation.workflows.environment.production": "PRODUCCIÓN",
  "automation.workflows.environment.productionLive": "PRODUCCIÓN (modifica sistemas en vivo)",

  "automation.workflows.runStatus.queued": "En cola",
  "automation.workflows.runStatus.running": "En ejecución",
  "automation.workflows.runStatus.waiting_approval": "Esperando tu aprobación",
  "automation.workflows.runStatus.compensating": "Deshaciendo pasos anteriores",
  "automation.workflows.runStatus.succeeded": "Correcta",
  "automation.workflows.runStatus.rejected": "Rechazada por ti",
  "automation.workflows.runStatus.failed": "Fallida",
  "automation.workflows.runStatus.failed_needs_attention": "Fallida: requiere tu atención",
  "automation.workflows.runStatus.cancelled": "Cancelada",
  "automation.workflows.runStatus.interrupted": "Interrumpida (Phoenix se reinició)",
  "automation.workflows.runStatus.refused": "Denegada: no se permitió su ejecución",

  "automation.workflows.stepStatus.running": "En ejecución",
  "automation.workflows.stepStatus.waiting": "En espera",
  "automation.workflows.stepStatus.succeeded": "Correcto",
  "automation.workflows.stepStatus.failed": "Fallido",
  "automation.workflows.stepStatus.timed_out": "Tiempo agotado (resultado desconocido)",
  "automation.workflows.stepStatus.rejected": "Rechazado",
  "automation.workflows.stepStatus.expired": "Caducado",
  "automation.workflows.stepStatus.unknown": "Resultado desconocido",

  "automation.workflows.authorisation.notNeeded": "No requiere autorización",
  "automation.workflows.authorisation.authorised": "Autorizado para producción",
  "automation.workflows.authorisation.notAuthorised": "SIN autorización: se deniegan los disparos",

  "automation.workflows.expiry.invalid": "Eso no es una fecha y hora válidas.",
  "automation.workflows.expiry.past": "La caducidad debe estar en el futuro.",
  "automation.workflows.expiry.tooFar": "La caducidad puede ser como máximo dentro de {days} días.",
  "automation.workflows.refused.noReason": "No se indicó ningún motivo.",
  "automation.workflows.payload.invalidJson": "La carga útil no es un JSON válido.",
  "automation.workflows.payload.notObject": "La carga útil debe ser un objeto JSON, como '{}'.",
  "automation.workflows.payload.tooMany": "La carga útil puede tener como máximo {max} claves.",

  // ---- workflows: the list ----
  "automation.workflows.title": "Flujos de trabajo",
  "automation.workflows.intro":
    "Un flujo de trabajo reacciona a un evento con una lista fija de pasos. Un flujo de trabajo que modifica producción no hace nada hasta que autorices exactamente la definición que revisaste.",
  "automation.workflows.empty":
    "Aún no hay flujos de trabajo. Crea uno revisando una definición más abajo.",
  "automation.workflows.row.runsWhen": "Se ejecuta cuando ocurre {event} · versión {version}",
  "automation.workflows.row.cannotRun": "No se puede ejecutar: {problems}",
  "automation.workflows.row.metrics": "{started} ejecución(es), {succeeded} correcta(s)",

  // ---- workflows: the numbers of one workflow ----
  "automation.workflows.metrics.title": "Cifras",
  "automation.workflows.metrics.label": "Métricas",
  "automation.workflows.metrics.none":
    "Este flujo de trabajo aún no se ha ejecutado, así que no hay cifras.",
  "automation.workflows.metrics.started": "Ejecuciones iniciadas",
  "automation.workflows.metrics.succeeded": "Correctas",
  "automation.workflows.metrics.failed": "Fallidas",
  "automation.workflows.metrics.attention": "Requieren tu atención",
  "automation.workflows.metrics.cancelled": "Canceladas",
  "automation.workflows.metrics.refused": "Denegadas",
  "automation.workflows.metrics.interrupted": "Interrumpidas",
  "automation.workflows.metrics.stepsFailed": "Pasos fallidos",
  "automation.workflows.metrics.stepsFailedValue": "{count} ({percent}% de los pasos)",
  "automation.workflows.metrics.approvalsWaiting": "Aprobaciones pendientes",
  "automation.workflows.metrics.approvalsOutcome":
    "Aprobaciones aprobadas / rechazadas / caducadas",
  "automation.workflows.metrics.approvalsOutcomeValue": "{approved} / {rejected} / {expired}",
  "automation.workflows.metrics.runTime": "Tiempo de ejecución (mediana / percentil 90)",
  "automation.workflows.metrics.runTimeValue":
    "{median} ms / {p90} ms en {samples, plural, one {# ejecución} many {# de ejecuciones} other {# ejecuciones}}",
  "automation.workflows.metrics.noFinishedRuns": "sin ejecuciones finalizadas",

  // ---- workflows: the definition editor ----
  "automation.workflows.editor.titleEdit": "Editar definición",
  "automation.workflows.editor.titleCreate": "Crear flujo de trabajo",
  "automation.workflows.editor.introExisting":
    'Introduce la definición JSON completa. Mantén "enabled": {enabled}; esta edición conserva el estado actual del interruptor. Guardar no la autoriza ni la ejecuta. Comprobar nunca guarda.',
  "automation.workflows.editor.introNew":
    'Introduce la definición JSON completa. Las definiciones nuevas deben tener "enabled": false. Guardar no las ejecuta, activa ni autoriza. Comprobar nunca guarda.',
  "automation.workflows.editor.label": "Definición del flujo de trabajo (JSON)",
  "automation.workflows.editor.check": "Comprobar borrador",
  "automation.workflows.editor.enterJson":
    "Introduce una definición JSON de flujo de trabajo antes de comprobarla.",
  "automation.workflows.editor.notObject":
    "La definición de un flujo de trabajo debe ser un objeto JSON.",
  "automation.workflows.editor.keepEnabled":
    'Mantén "enabled": {enabled}. Cambia el interruptor por separado después de guardar.',
  "automation.workflows.editor.setDisabled":
    'Establece "enabled": false. Guardar una definición nueva no debe activarla.',
  "automation.workflows.editor.keepId":
    "La edición debe conservar el mismo ID de flujo de trabajo. Usa Crear flujo de trabajo para un ID nuevo.",
  "automation.workflows.editor.notValid": "No válido: {problems}",
  "automation.workflows.editor.noHash": "La validación no devolvió un hash de definición válido.",
  "automation.workflows.editor.hashDiffers":
    "El hash de la definición guardada difiere del hash revisado. Revisa la definición almacenada antes de usarla.",
  "automation.workflows.editor.savedExisting":
    "Definición guardada. El estado del interruptor existente no cambia; guardar no la autoriza.",
  "automation.workflows.editor.savedNew":
    "Definición guardada desactivada. Guardar no la autoriza ni la activa.",
  "automation.workflows.editor.reviewed": "Definición revisada",
  "automation.workflows.editor.validLead": "Borrador válido.",
  "automation.workflows.editor.valid":
    "{lead} Revisa esta definición exacta y su hash antes de guardar. Cualquier cambio requiere otra comprobación.",
  "automation.workflows.editor.toSave": "Definición que se guardará",
  "automation.workflows.editor.hash": "Hash validado: {hash}",
  "automation.workflows.editor.authRequired": "Requiere autorización por separado: {reasons}",
  "automation.workflows.editor.authNotRequired": "No requiere autorización.",
  "automation.workflows.editor.switchOn": "Guardar nunca autoriza; el interruptor sigue activado.",
  "automation.workflows.editor.switchOff":
    "Guardar nunca autoriza; el interruptor sigue desactivado.",
  "automation.workflows.editor.switchNew":
    "Guardar nunca autoriza; el flujo de trabajo nuevo permanece desactivado.",
  "automation.workflows.editor.confirm": "Confirmar: guardar exactamente esta definición",
  "automation.workflows.editor.reviewStored": "Revisar flujo de trabajo almacenado",

  // ---- workflows: checking the stored definition ----
  "automation.workflows.validate.button": "Comprobar la definición",
  "automation.workflows.validate.dryRun": "Una simulación. No se guarda nada y nada se ejecuta.",
  "automation.workflows.validate.validLead": "Válida.",
  "automation.workflows.validate.valid": "{lead} Hash {hash}. {authorisation}",
  "automation.workflows.validate.needsAuth": "Requiere tu autorización: {reasons}.",
  "automation.workflows.validate.noAuth": "No requiere autorización.",
  "automation.workflows.validate.invalidLead": "No válida.",
  "automation.workflows.validate.invalid":
    "{lead} {count, plural, one {# problema:} many {# de problemas:} other {# problemas:}}",
  "automation.workflows.validate.problems": "Problemas",

  // ---- workflows: authorising ----
  "automation.workflows.authorise.title": "Autorizar para producción",
  "automation.workflows.authorise.notNeeded": "Este flujo de trabajo no requiere autorización.",
  "automation.workflows.authorise.why": "Por qué requiere tu autorización:",
  "automation.workflows.authorise.reasons": "Motivos",
  "automation.workflows.authorise.intro":
    "Esto permitirá que el flujo de trabajo {name} se ejecute cada vez que ocurra {event}, sin más preguntas para estos pasos, salvo que el propio flujo de trabajo las haga:",
  "automation.workflows.authorise.allowed": "Lo que se permitiría ejecutar",
  "automation.workflows.authorise.noTools": "No llama a ninguna herramienta.",
  "automation.workflows.authorise.step": "El paso {step} llama a {tool}",
  "automation.workflows.authorise.stepUndo": "El paso {step} llama a {tool} (deshacer: {undo})",
  "automation.workflows.authorise.being":
    "Definición que se autoriza: versión {version}, hash {hash}",
  "automation.workflows.authorise.expires": "Caduca {hint}",
  "automation.workflows.authorise.expiresHint": "(opcional, en un máximo de {days} días)",
  "automation.workflows.authorise.submit": "Autorizar exactamente esta definición",
  "automation.workflows.authorise.done":
    "Versión {version} autorizada. Cualquier cambio posterior en la definición anula la autorización.",

  // ---- workflows: run now ----
  "automation.workflows.runNow.title": "Ejecutar ahora",
  "automation.workflows.runNow.intro":
    "Inicia el flujo de trabajo manualmente con las mismas comprobaciones que cuando ocurre su evento: activado, no detenido por la parada de emergencia, válido y autorizado si modifica producción.",
  "automation.workflows.runNow.payload": "Datos que habría llevado el evento {hint}",
  "automation.workflows.runNow.payloadHint": "(un objeto JSON, opcional)",
  "automation.workflows.runNow.button": "Ejecutar ahora",
  "automation.workflows.runNow.cannotRun": "No se puede ejecutar: {problems}",
  "automation.workflows.runNow.enableFirst": "Activa el flujo de trabajo para ejecutarlo.",
  "automation.workflows.runNow.refusedLead": "Se denegó el inicio.",
  "automation.workflows.runNow.seeRefused": "Ver la ejecución denegada",
  "automation.workflows.runNow.started": "Iniciada. {link}",
  "automation.workflows.runNow.follow": "Seguir la ejecución",

  // ---- workflows: one workflow ----
  "automation.workflows.detail.all": "Todos los flujos de trabajo",
  "automation.workflows.detail.backAll": "← Todos los flujos de trabajo",
  "automation.workflows.detail.productionLead": "Producción.",
  "automation.workflows.detail.production":
    "{lead} Este flujo de trabajo puede modificar sistemas en vivo. Solo se ejecuta mientras tengas autorizada su definición exacta.",
  "automation.workflows.detail.cannotRunNow": "No se puede ejecutar ahora mismo:",
  "automation.workflows.detail.definition": "Definición",
  "automation.workflows.detail.versionHash": "Versión {version} · hash {hash}",
  "automation.workflows.detail.runsWhen": "Se ejecuta cuando ocurre {event}.",
  "automation.workflows.detail.runsWhenAnd": "Se ejecuta cuando ocurre {event} y {condition}.",
  "automation.workflows.detail.tools": "Herramientas que puede llamar",
  "automation.workflows.detail.toolsLabel": "Herramientas",
  "automation.workflows.detail.none": "Ninguna.",
  "automation.workflows.detail.toolStep": "Paso {step}: {tool}",
  "automation.workflows.detail.flagged": "Acción de producción o crítica",
  "automation.workflows.detail.declaredUndo": "deshacer declarado: {undo}",
  "automation.workflows.detail.definitionText":
    "Definición (texto de solo lectura, con desplazamiento)",
  "automation.workflows.detail.unreadable": "No se pudo leer la definición almacenada.",
  "automation.workflows.detail.switch": "Interruptor",
  "automation.workflows.detail.enable": "Activar",
  "automation.workflows.detail.disable": "Desactivar",
  "automation.workflows.detail.switchNote":
    "Activar no autoriza. Un flujo de trabajo de producción activado y no autorizado registra cada disparo como denegado.",
  "automation.workflows.detail.authorisations": "Autorizaciones",
  "automation.workflows.detail.noneYet": "Todavía ninguna.",
  "automation.workflows.detail.inForce": "En vigor",
  "automation.workflows.detail.revoked": "Revocada",
  "automation.workflows.detail.notInForce": "No está en vigor",
  "automation.workflows.detail.authorisedBy": "por {by} el {date}",
  "automation.workflows.detail.authExpires": "caduca {date}",
  "automation.workflows.detail.authChanged": "la definición cambió o caducó",
  "automation.workflows.detail.forHash": "para el hash {hash}",
  "automation.workflows.detail.confirmRevoke": "Confirmar: revocar la autorización",
  "automation.workflows.detail.revoke": "Revocar autorización…",
  "automation.workflows.detail.revokeNote":
    "Las ejecuciones en curso se detienen en su siguiente paso.",
  "automation.workflows.detail.recentRuns": "Ejecuciones recientes",
  "automation.workflows.detail.noRuns": "Aún no hay ejecuciones.",

  // ---- workflows: runs and steps ----
  "automation.workflows.run.needsLook": "(requiere revisión)",
  "automation.workflows.run.notSuccess": "(no fue correcta)",
  "automation.workflows.run.nowAtStep": "ahora en el paso {step}",
  "automation.workflows.run.atStep": "en el paso {step}",
  "automation.workflows.run.backToWorkflow": "Volver al flujo de trabajo",
  "automation.workflows.run.title": "Ejecución de {name}",
  "automation.workflows.run.created": "Creada el {date}",
  "automation.workflows.run.finished": "finalizada el {date}",
  "automation.workflows.run.chainDepth": "profundidad de cadena {depth}",
  "automation.workflows.run.waitingForYou": "Esperando por ti",
  "automation.workflows.run.stop": "Detener esta ejecución",
  "automation.workflows.run.confirmCancel": "Confirmar: cancelar esta ejecución",
  "automation.workflows.run.keepRunning": "Seguir ejecutando",
  "automation.workflows.run.cancel": "Cancelar esta ejecución…",
  "automation.workflows.run.cancelNote":
    "Cancelar no ejecuta los pasos de deshacer declarados. Un paso que ya esté en curso aún podría terminar.",
  "automation.workflows.run.trigger": "Qué la inició",
  "automation.workflows.run.triggerText": "Disparador (texto sin formato, con desplazamiento)",
  "automation.workflows.run.stepsHeading": "Pasos ({count})",
  "automation.workflows.run.stepsLabel": "Pasos",
  "automation.workflows.run.noSteps": "No ha comenzado ningún paso.",
  "automation.workflows.step.undo": "Deshacer: {step}",
  "automation.workflows.step.attempts":
    "{count, plural, one {# intento} many {# de intentos} other {# intentos}}",
  "automation.workflows.step.changesState": "Modifica el estado",
  "automation.workflows.step.destructive": "{lead}: este paso puede modificar un sistema real.",
  "automation.workflows.step.tool": "Herramienta {tool}",
  "automation.workflows.step.input":
    "Entrada del paso {step} (texto sin formato, con desplazamiento)",
  "automation.workflows.step.output":
    "Salida del paso {step} (texto sin formato, con desplazamiento)",

  // ---- plans: tables and checks (core/plans.ts) ----
  "automation.plans.status.draft": "Borrador: aún no propuesto",
  "automation.plans.status.proposed": "Propuesto: esperando tu aprobación",
  "automation.plans.status.approved": "Aprobado: listo para crear",
  "automation.plans.status.creating": "Creando tareas…",
  "automation.plans.status.created": "Creado",
  "automation.plans.status.failed": "Fallido: algunas tareas no se crearon",
  "automation.plans.status.cancelled": "Cancelado",
  "automation.plans.basis.meeting": "de la reunión",
  "automation.plans.basis.suggested": "sugerido por el modelo",
  "automation.plans.basis.user": "escrito por ti",
  "automation.plans.run.pending": "Sin iniciar",
  "automation.plans.run.attempting": "En curso",
  "automation.plans.run.created": "Creada",
  "automation.plans.run.failed": "Fallida",
  "automation.plans.tool.githubIssue": "Crear una incidencia de GitHub",
  "automation.plans.tool.frappeTask": "Crear una tarea de Frappe",
  "automation.plans.kind.decision": "decisión",
  "automation.plans.kind.action_item": "elemento de acción",
  "automation.plans.kind.requirement": "requisito",
  "automation.plans.authorship.rules":
    "Borrador basado en reglas: no lo escribió ninguna IA, solo reformula el elemento de la reunión.",
  "automation.plans.authorship.model":
    "Salida del modelo ({model}): compárala con la reunión antes de aprobar.",
  "automation.plans.destination.github": "Repositorio de GitHub {repository}",
  "automation.plans.destination.frappe": "Sitio de Frappe {site}",
  "automation.plans.problem.repository": 'El repositorio debe tener el formato "owner/name".',
  "automation.plans.problem.site": "Ese no es un nombre de sitio de Frappe válido.",
  "automation.plans.problem.titleEmpty": "El título no puede estar vacío.",
  "automation.plans.problem.titleLong": "El título supera {max}.",
  "automation.plans.problem.summaryEmpty": "El resumen no puede estar vacío.",
  "automation.plans.problem.summaryLong": "El resumen supera {max}.",
  "automation.plans.problem.taskCount": "Un plan necesita de 1 a {max} tareas.",
  "automation.plans.problem.taskTitle": "La tarea {n} necesita un título.",
  "automation.plans.problem.bodyLong": "El cuerpo supera {max}.",
  "automation.plans.problem.labelCount": "Como máximo {max} etiquetas.",
  "automation.plans.problem.labelLong": "Una etiqueta supera {max}.",

  // ---- plans: make a plan from a meeting item ----
  "automation.plans.off": "La planificación está desactivada.",
  "automation.plans.make.open": "Crear un plan…",
  "automation.plans.make.openFrom": "Crear un plan a partir de {kind}: {text}",
  "automation.plans.make.intro":
    "Un plan es un borrador de tareas de ingeniería. No se crea nada hasta que lo apruebes y confirmes cada tarea.",
  "automation.plans.make.where": "¿Dónde irían las tareas?",
  "automation.plans.make.githubIssues": "Incidencias de GitHub",
  "automation.plans.make.frappeTasks": "Tareas de Frappe",
  "automation.plans.make.repository": "Repositorio (owner/name)",
  "automation.plans.make.site": "Sitio de Frappe",
  "automation.plans.make.chooseSite": "Elige un sitio",
  "automation.plans.make.drafting": "Redactando el plan…",
  "automation.plans.make.draft": "Redactar un plan",
  "automation.plans.make.localModel":
    "Un modelo local puede tardar un minuto. No se envía nada a ningún otro sitio.",
  "automation.plans.make.drafted": "Plan redactado.",
  "automation.plans.make.openPlan": "Abrir el plan",

  // ---- plans: on a meeting ----
  "automation.plans.meeting.title": "Planes y tareas de esta reunión",
  "automation.plans.meeting.plans": "Planes",
  "automation.plans.meeting.summary":
    "{status} · {count, plural, one {# tarea} many {# de tareas} other {# tareas}} · {system}",
  "automation.plans.meeting.tasksCreated": "Tareas creadas",
  "automation.plans.meeting.tasksLabel": "Tareas creadas a partir de esta reunión",
  "automation.plans.link.frappeTask": "Tarea {id}",
  "automation.plans.link.detail": "tarea {index} de {plan} · aprobado el {date}",
  "automation.plans.link.itsPlan": "su plan",

  // ---- plans: the editor ----
  "automation.plans.editor.label": "Editar el plan",
  "automation.plans.editor.title": "Título {hint}",
  "automation.plans.editor.summary": "Resumen {hint}",
  "automation.plans.editor.upTo": "(hasta {max})",
  "automation.plans.editor.tasks": "Tareas {hint}",
  "automation.plans.editor.tasksRange": "(de 1 a {max})",
  "automation.plans.editor.task": "Tarea {n}",
  "automation.plans.editor.taskTitle": "Título de la tarea {n}",
  "automation.plans.editor.taskBody": "Cuerpo de la tarea {n} {hint}",
  "automation.plans.editor.taskLabels": "Etiquetas de la tarea {n} {hint}",
  "automation.plans.editor.labelsHint": "(separadas por comas, hasta {max})",
  "automation.plans.editor.removeTask": "Quitar la tarea {n}",
  "automation.plans.editor.addTask": "Añadir una tarea",
  "automation.plans.editor.note":
    "Al guardar, el plan vuelve a borrador y se borra cualquier aprobación. Después debes proponerlo y aprobarlo de nuevo.",
  "automation.plans.editor.save": "Guardar cambios",

  // ---- plans: preview and results ----
  "automation.plans.preview.title": "Exactamente lo que se enviaría",
  "automation.plans.preview.intro":
    "Cada tarea es una llamada hecha en tu nombre. Esta es la entrada real, mostrada como texto sin formato.",
  "automation.plans.preview.calls": "Llamadas que se realizarían",
  "automation.plans.preview.task": "Tarea {n}: {tool}",
  "automation.plans.preview.decision": "(efecto: {effect}, riesgo: {risk})",
  "automation.plans.preview.input":
    "Entrada de la tarea {n} (texto sin formato, con desplazamiento)",
  "automation.plans.runs.title": "Tarea por tarea",
  "automation.plans.runs.label": "Resultados de las tareas",
  "automation.plans.runs.task": "Tarea {n}:",
  "automation.plans.runs.attempts":
    "{count, plural, one {# intento} many {# de intentos} other {# intentos}}",
  "automation.plans.runs.frappeTask": "Tarea de Frappe {id}",
  "automation.plans.runs.stopped":
    "Detenido en la tarea {n}: {message}. No se creó nada después. Puedes ejecutar Crear de nuevo: las tareas que ya existen se encuentran, no se duplican.",

  // ---- plans: one plan ----
  "automation.plans.page.allMeetings": "Todas las reuniones",
  "automation.plans.page.meeting": "← La reunión",
  "automation.plans.page.rules": "Borrador basado en reglas",
  "automation.plans.page.model": "Salida del modelo",
  "automation.plans.page.destination": "Destino: {destination}",
  "automation.plans.page.from": "De {kind}: {text}",
  "automation.plans.page.owner": "responsable {owner}",
  "automation.plans.page.due": "vence {due}",
  "automation.plans.page.proposedNotice": "Propuesto. Revisa la vista previa y luego aprueba.",
  "automation.plans.page.approvedNotice": "Aprobado. Todavía no se ha creado nada.",
  "automation.plans.page.savedNotice":
    "Guardado. El plan vuelve a ser un borrador; propónlo para aprobarlo.",
  "automation.plans.page.cancelledNotice": "Cancelado. No se creó nada.",
  "automation.plans.page.plan": "El plan",
  "automation.plans.page.tasks": "Tareas ({count})",
  "automation.plans.page.tasksLabel": "Tareas",
  "automation.plans.page.labels": "Etiquetas:",
  "automation.plans.page.edit": "Editar el plan",
  "automation.plans.page.acceptance": "Criterios de aceptación",
  "automation.plans.page.risks": "Riesgos",
  "automation.plans.page.questions": "Preguntas abiertas",
  "automation.plans.frappe.doctype": "DocType de Frappe propuesto: {doctype}",
  "automation.plans.frappe.note":
    "Solo es un diseño sugerido. Crear tareas no crea este DocType, sus campos, su flujo de trabajo ni sus permisos.",
  "automation.plans.frappe.fields": "Campos",
  "automation.plans.frappe.fieldsLabel": "Campos de Frappe propuestos",
  "automation.plans.frappe.required": "obligatorio",
  "automation.plans.frappe.noFields": "No se propuso ningún campo.",
  "automation.plans.frappe.states": "Estados del flujo de trabajo",
  "automation.plans.frappe.statesLabel": "Estados del flujo de trabajo de Frappe propuestos",
  "automation.plans.frappe.noStates": "No se propuso ningún estado de flujo de trabajo.",
  "automation.plans.frappe.permissions": "Permisos",
  "automation.plans.frappe.permissionsLabel": "Permisos de Frappe propuestos",
  "automation.plans.frappe.noPermissions": "No se propuso ningún permiso.",
  "automation.plans.frappe.access": "{role}: {access}",
  "automation.plans.frappe.read": "lectura",
  "automation.plans.frappe.write": "escritura",
  "automation.plans.frappe.create": "creación",
  "automation.plans.frappe.noAccess": "sin acceso",
  "automation.plans.decide.title": "Decidir",
  "automation.plans.decide.fingerprint":
    "Huella de lo que estás viendo: {hash}. La aprobación cubre exactamente este contenido; si el plan cambia, se deniega.",
  "automation.plans.decide.propose": "Proponer este plan",
  "automation.plans.decide.nameMeeting": "Nombrar la reunión en las tareas creadas",
  "automation.plans.decide.approve": "Aprobar este plan exacto",
  "automation.plans.decide.approved": "Aprobado por {by} el {date}.",
  "automation.plans.decide.approvedNamed":
    "Aprobado por {by} el {date} · la reunión se nombra en las tareas.",
  "automation.plans.decide.understand":
    "Entiendo que esto crea {count, plural, one {# tarea} many {# de tareas} other {# tareas}} en {destination}, en mi nombre.",
  "automation.plans.decide.createRemaining": "Crear las tareas restantes",
  "automation.plans.decide.create": "Crear tareas",
  "automation.plans.decide.waiting": "Esperando tu aprobación de la tarea {n} de {total}.",
  "automation.plans.decide.waitingNote":
    "Core te pregunta antes de crear cada tarea. Responde más abajo; esta página espera el tiempo que haga falta.",
  "automation.plans.decide.cancel": "Cancelar este plan",

  // ---- automation settings (AutomationSettings.tsx) ----
  "automation.settings.title": "Automatización",
  "automation.settings.intro":
    "La automatización está desactivada hasta que la actives. Mientras esté desactivada, Fawkes no inicia tareas ni ejecuta nada por sí mismo. Cuando está activada, Fawkes solo puede iniciar una tarea cuando tú se lo pides, por ejemplo «Diagnosticar un fallo de CI» en la pestaña Chat. Lee datos y propone; todo lo que cambie algo espera tu aprobación, y puedes cancelar una tarea en cualquier momento. Desactivar la automatización cancela todas las tareas en ejecución.",
  "automation.settings.allow": "Permitir que Fawkes ejecute las tareas que yo inicie",
  "automation.settings.statusOn":
    "La automatización está activada. {active, plural, one {Hay # tarea} many {Hay # de tareas} other {Hay # tareas}} en ejecución (como máximo {max} a la vez).",
  "automation.settings.statusOff":
    "La automatización está desactivada. {active, plural, one {Hay # tarea} many {Hay # de tareas} other {Hay # tareas}} en ejecución (como máximo {max} a la vez).",
  "automation.settings.unavailable":
    "Los ajustes de automatización no están disponibles desde Phoenix Core ({error}).",

  // ---- proactive suggestions (ProactiveSettings.tsx) ----
  "automation.proactive.title": "Sugerencias proactivas",
  "automation.proactive.intro":
    "Desactivadas por defecto. Kage puede sugerir elementos de reuniones aceptados y sin asignar cuando está disponible. Las señales de ingeniería solo pueden analizar las raíces de repositorios vigilados que añadas explícitamente; su proveedor de avisos no está disponible, por lo que nunca informa avisos. La evaluación es manual salvo que elijas explícitamente una cadencia tras activar la opción. El trabajo programado se ejecuta localmente y respeta las horas de silencio, los límites de frecuencia y la parada de emergencia.",
  "automation.proactive.status":
    "Fuente de Kage: {source}. Las sugerencias están {state} ({cadence}).",
  "automation.proactive.sourceAvailable": "disponible",
  "automation.proactive.sourceUnavailable": "no disponible",
  "automation.proactive.stateOn": "activadas",
  "automation.proactive.stateOff": "desactivadas",
  "automation.proactive.cadenceEvery":
    "cada {minutes, plural, one {# minuto} many {# de minutos} other {# minutos}}",
  "automation.proactive.cadenceManual": "solo manual",
  "automation.proactive.optIn": "Participar",
  "automation.proactive.enable": "Activar las sugerencias proactivas",
  "automation.proactive.kageItems": "Elementos de acción de Kage aceptados y sin asignar",
  "automation.proactive.engineeringSignals": "Señales de ingeniería de repositorios vigilados",
  "automation.proactive.engineeringSignalsStatus": "Las señales de ingeniería están {state}.",
  "automation.proactive.cadence": "Cadencia de evaluación automática",
  "automation.proactive.cadenceOff": "Solo manual (desactivada)",
  "automation.proactive.cadence15": "Cada 15 minutos",
  "automation.proactive.cadence30": "Cada 30 minutos",
  "automation.proactive.cadence60": "Cada hora",
  "automation.proactive.cadence1440": "Cada día",
  "automation.proactive.quietHours": "Horas de silencio",
  "automation.proactive.useQuiet": "Usar horas de silencio",
  "automation.proactive.timezone": "Zona horaria (IANA)",
  "automation.proactive.quietFrom": "Silencio desde",
  "automation.proactive.quietUntil": "Silencio hasta",
  "automation.proactive.maxPerHour": "Máximo de sugerencias por hora",
  "automation.proactive.preview": "Vista previa de sugerencias",
  "automation.proactive.evaluate": "Evaluar ahora",
  "automation.proactive.refreshNoise": "Actualizar métricas de ruido",
  "automation.proactive.delivered": "Sugerencias entregadas",
  "automation.proactive.dismiss": "Descartar {title}",
  "automation.proactive.previewHeading": "Vista previa fundamentada",
  "automation.proactive.previewLabel": "Vista previa de sugerencias",
  "automation.proactive.previewEmpty":
    "No hay elementos de acción de Kage aceptados y sin asignar que cumplan los requisitos.",
  "automation.proactive.evidence":
    "Evidencia: reunión {meeting}, elemento {item} ({source}): «{quote}»",
  "automation.proactive.sourceTranscript": "transcripción",
  "automation.proactive.sourceSummary": "resumen",
  "automation.proactive.noiseLabel": "Métricas de ruido de las sugerencias",
  "automation.proactive.noiseDelivered": "Entregadas",
  "automation.proactive.noiseDismissed": "Descartadas",
  "automation.proactive.noiseSuppressed": "Suprimidas",
  "automation.proactive.noiseRate": "Tasa de descarte",
  "automation.proactive.saved": "Preferencias de sugerencias guardadas.",
  "automation.proactive.previewCount":
    "{count, plural, one {# sugerencia fundamentada en la vista previa.} many {# de sugerencias fundamentadas en la vista previa.} other {# sugerencias fundamentadas en la vista previa.}}",
  "automation.proactive.evaluated": "{delivered} entregadas; {suppressed} suprimidas.",
  "automation.proactive.dismissed": "Sugerencia descartada.",

  // ---- capability registry (RegistrySettings.tsx) ----
  "automation.registry.title": "Registro de capacidades",
  "automation.registry.intro":
    "Explora los metadatos de un índice firmado, configurado localmente y de confianza para el host. Phoenix Core verifica la firma del índice antes de devolver las entradas. Explorar no instala ni ejecuta código de terceros.",
  "automation.registry.noInstall":
    "Instalación no disponible: no hay un sandbox del sistema operativo auditado. Aquí no se pueden instalar capacidades de terceros.",
  "automation.registry.unavailable": "Registro no disponible",
  "automation.registry.loadFailed": "No se pudo cargar el registro: {error}",
  "automation.registry.loading": "Cargando registro…",
  "automation.registry.notConfigured":
    "No hay ningún registro local configurado. Pide al administrador del host que configure una clave de confianza y un índice firmado para explorar capacidades.",
  "automation.registry.indexSignature":
    "Firma del índice: verificada con el firmante Ed25519 {signer}, de confianza para el host.",
  "automation.registry.signature": "Firma: {signature}",
  "automation.registry.indexHash": "SHA-256 del índice firmado: {hash}",
  "automation.registry.empty": "El registro firmado no contiene capacidades.",
  "automation.registry.preview": "Vista previa de {name} {version}",
  "automation.registry.previewFailed": "Vista previa no disponible: {error}",
  "automation.registry.previewLoading": "Cargando vista previa verificada…",
  "automation.registry.permissions": "Permisos",
  "automation.registry.noDescription": "No se proporcionó descripción",
  "automation.registry.noneDeclared": "Ninguno declarado.",
  "automation.registry.dataCategories": "Categorías de datos",
  "automation.registry.licence": "Licencia",
  "automation.registry.licenceLine": "{licence}. {policy}",
  "automation.registry.security": "Seguridad",
  "automation.registry.securityContact": "Contacto de seguridad",
  "automation.registry.advisories": "Avisos de seguridad",
  "automation.registry.provenance": "Procedencia firmada",
  "automation.registry.artifact":
    "SHA-256 del artefacto declarado por el índice firmado: {hash} ({bytes, plural, one {# byte} many {# de bytes} other {# bytes}}). Verificación del artefacto: no verificado; los bytes del artefacto no se han descargado ni comprobado. Explorar no ejecuta el artefacto.",
  "automation.registry.sandbox":
    "Sandbox: no disponible. La instalación está desactivada; no se enviará ninguna solicitud de instalación.",

  // ---- encrypted sync (SyncSettings.tsx) ----
  "automation.sync.title": "Sincronización cifrada",
  "automation.sync.intro":
    "Opcional y desactivada por defecto. La sincronización requiere tu propio relé HTTPS disponible y autenticación en el relé; Phoenix no ofrece un relé alojado. Configurarla es una participación explícita: no envía nada durante la configuración, pero después los registros en cola se sincronizan automáticamente mientras haya conexión. Sincronizar ahora inicia un intento inmediato. El adaptador prepara solo los dos ajustes sin contenido que selecciones explícitamente; los cambios locales posteriores requieren Publicar actual. El texto de reuniones, personas y memoria nunca se incluye mediante este adaptador.",
  "automation.sync.unavailable":
    "Los ajustes de sincronización no están disponibles desde Phoenix Core. Esta solicitud de estado no contactó con el relé.",
  "automation.sync.relayNone": "no configurado",
  "automation.sync.relayUnknown": "relé configurado (URL no disponible)",
  "automation.sync.statusOn":
    "La sincronización está activada. {pending} en cola; {conflicts, plural, one {# conflicto} many {# de conflictos} other {# conflictos}}.",
  "automation.sync.statusOff":
    "La sincronización está desactivada. {pending} en cola; {conflicts, plural, one {# conflicto} many {# de conflictos} other {# conflictos}}.",
  "automation.sync.chooseExclusions":
    "Elige las exclusiones antes de participar; las clases y los proyectos excluidos no se suben.",
  "automation.sync.excludeClasses": "Excluir clases de datos",
  "automation.sync.class.preference": "preferencia",
  "automation.sync.class.context": "contexto",
  "automation.sync.class.project_profile": "perfil de proyecto",
  "automation.sync.excludeProject": "Excluir proyecto por nombre",
  "automation.sync.excludeProjectButton": "Excluir proyecto",
  "automation.sync.removeExclusion": "Quitar la exclusión de {name}",
  "automation.sync.exclusionsSaved": "Exclusiones guardadas.",
  "automation.sync.adapterLegend": "Incluir ajustes existentes de forma individual",
  "automation.sync.adapterNote":
    "Solo son aptos el movimiento reducido (preferencia) y el número de resultados de búsqueda (configuración de contexto), ambos del ámbito del propietario de la cuenta; no hay fuentes del ámbito de proyecto. Al seleccionar, se prepara el valor actual. Publica explícitamente un cambio local posterior. Los valores entrantes permanecen preparados hasta que los revises y confirmes aplicarlos localmente. Excluir una clase también elimina su selección del adaptador cuando es posible; los registros ya publicados deben eliminarse y sincronizarse primero. Deseleccionar no borra el texto cifrado subido; elimina su elemento sincronizado por separado si es necesario.",
  "automation.sync.adapter.reducedMotion": "Preferencia de movimiento reducido",
  "automation.sync.adapter.searchCount": "Metadatos del número de resultados de búsqueda",
  "automation.sync.adapterSaved":
    "Selección del adaptador guardada. Los ajustes actuales recién seleccionados quedan preparados; no se incluye ninguna otra fuente.",
  "automation.sync.adapterApplied": "Ajuste sincronizado seleccionado aplicado localmente.",
  "automation.sync.adapterPublished":
    "Ajuste local actual preparado para la sincronización cifrada.",
  "automation.sync.publish": "Publicar {key} actual",
  "automation.sync.reviewApply": "Revisar la aplicación de {key}",
  "automation.sync.applyPreview": "Vista previa de aplicación del ajuste",
  "automation.sync.applyText":
    "¿Aplicar la revisión {revision} descifrada y preparada de {key} al ajuste local existente? Solo reemplazará el valor actual tras la confirmación. Los valores actual y entrante están ocultos; identifica las versiones por origen y revisión, o cancela. Un cambio del valor local o de la revisión preparada invalida esta vista previa.",
  "automation.sync.confirmApply": "Confirmar la aplicación del ajuste",
  "automation.sync.cancelApply": "Cancelar la aplicación",
  "automation.sync.relayLine":
    "Relé: {relay}. Identidad: {identity}. Se requiere un relé accesible; este estado no demuestra que el relé esté disponible.",
  "automation.sync.identityNone": "no disponible",
  "automation.sync.identityNote":
    "Esta identidad representa la cuenta de la clave de recuperación compartida, no un dispositivo concreto. Los dispositivos con la misma clave y el mismo token del relé no pueden revocarse individualmente, y no está establecida la protección contra repetición del relé.",
  "automation.sync.syncNow": "Sincronizar ahora",
  "automation.sync.turnOff": "Desactivar la sincronización",
  "automation.sync.turnedOff":
    "La sincronización está desactivada. Los registros en cola permanecen locales.",
  "automation.sync.offlineNote":
    "Si el relé está sin conexión, una sincronización manual informa de un error y los elementos pendientes permanecen en cola para reintentarlo más tarde. En los conflictos nunca se sobrescribe en silencio.",
  "automation.sync.syncedPending":
    "{pending, plural, one {# elemento sigue} many {# de elementos siguen} other {# elementos siguen}} en cola. Revisa más abajo el estado y los conflictos.",
  "automation.sync.syncedDone":
    "Sincronización finalizada. Revisa más abajo los elementos y los conflictos.",
  "automation.sync.items": "Elementos sincronizados",
  "automation.sync.itemsNote":
    "Solo metadatos; no se muestran el contenido de los elementos ni los valores en conflicto.",
  "automation.sync.noItems": "No hay registros de sincronización preparados.",
  "automation.sync.itemLine":
    "{id} · {dataClass} · propietario {owner} · ámbito {scope} · proyecto {project} · revisión {revision} · actualizado {updated} · {state}",
  "automation.sync.projectNone": "ninguno",
  "automation.sync.updatedUnknown": "desconocido",
  "automation.sync.state.deletionQueued": "eliminación en cola",
  "automation.sync.state.deleted": "eliminado",
  "automation.sync.state.queued": "en cola",
  "automation.sync.state.synced": "sincronizado",
  "automation.sync.conflictMissing":
    "Conflicto: este registro falta en el relé. Conserva el local para restaurarlo en el relé, o acepta la eliminación remota para eliminar el registro de sincronización preparado localmente. No se sobrescribe nada automáticamente.",
  "automation.sync.conflictRemote":
    "Conflicto: revisión remota {revision}, actualizada {updated}. No se sobrescribe nada hasta que elijas un lado.",
  "automation.sync.reviewKeepLocal": "Revisar conservar el local de {id}",
  "automation.sync.reviewKeepRemote": "Revisar conservar el remoto de {id}",
  "automation.sync.reviewAcceptDeletion": "Revisar aceptar la eliminación remota de {id}",
  "automation.sync.reviewDeletion": "Revisar la eliminación remota de {id}",
  "automation.sync.resolutionPreview": "Vista previa de la resolución del conflicto",
  "automation.sync.previewFor": "Vista previa de {id} ({scope}):",
  "automation.sync.previewAcceptDeletion":
    "Aceptar la eliminación remota: elimina ahora el registro de sincronización preparado localmente; no se sube nada.",
  "automation.sync.previewRestore":
    "Restaurar el remoto faltante: pone en cola la versión local para subirla en la próxima sincronización correcta.",
  "automation.sync.previewKeepRemote":
    "Conservar el remoto: reemplaza ahora el registro de sincronización preparado localmente por la versión remota.",
  "automation.sync.previewKeepLocal":
    "Conservar el local: pone en cola esta versión para subirla en la próxima sincronización correcta. Un cambio remoto más reciente seguirá requiriendo resolución.",
  "automation.sync.previewTail":
    "Aquí se oculta el contenido de los elementos; si no puedes identificar las versiones a partir de los metadatos, cancela. Esto no se puede deshacer desde aquí.",
  "automation.sync.confirmAcceptDeletion": "Confirmar aceptar la eliminación remota",
  "automation.sync.confirmRestore": "Confirmar restaurar el remoto faltante",
  "automation.sync.confirmKeepLocal": "Confirmar conservar el local",
  "automation.sync.confirmKeepRemote": "Confirmar conservar el remoto",
  "automation.sync.cancelResolution": "Cancelar la resolución",
  "automation.sync.resolvedDeletion":
    "Eliminación remota aceptada. El registro de sincronización preparado localmente ya está eliminado; no hay nada en cola para subir.",
  "automation.sync.resolvedChoice":
    "Elección del conflicto guardada. Los cambios pendientes se sincronizan automáticamente mientras haya conexión; Sincronizar ahora inicia un intento inmediato.",
  "automation.sync.deletionConfirmation": "Confirmación de eliminación remota",
  "automation.sync.deletionText":
    "¿Eliminar {id} ({scope}) del relé? Esto pone en cola una lápida localmente; la copia remota solo se elimina tras una sincronización correcta. Esto no se puede deshacer desde aquí.",
  "automation.sync.confirmDeletion": "Confirmar eliminación remota",
  "automation.sync.cancelDeletion": "Cancelar la eliminación",
  "automation.sync.deletionQueued":
    "Eliminación en cola. La copia remota no se elimina hasta que haya una sincronización correcta.",
  "automation.sync.relayUrl": "URL HTTPS del relé",
  "automation.sync.relayToken": "Token de autenticación del relé",
  "automation.sync.restoreKey":
    "Clave de recuperación existente (opcional, para restaurar una identidad)",
  "automation.sync.optInNote":
    "Participación explícita: configurar guarda localmente las credenciales del relé y activa la sincronización automática de los registros en cola mientras haya conexión. Una identidad nueva muestra una clave de recuperación una sola vez: guárdala de inmediato; no se puede recuperar después. Volver a configurar tras desactivar la sincronización reutiliza la identidad almacenada localmente, si está disponible. Nunca compartas tu clave con el operador del relé.",
  "automation.sync.configure": "Configurar la sincronización cifrada",
  "automation.sync.configured":
    "La sincronización está configurada. Los registros en cola se sincronizan automáticamente mientras haya conexión; Sincronizar ahora inicia un intento inmediato.",
  "automation.sync.recoveryGroup": "Clave de recuperación de un solo uso",
  "automation.sync.recoveryText":
    "Copia y guarda ahora esta clave de recuperación en un lugar seguro. Solo se muestra una vez y no se puede recuperar después. No la compartas.",
  "automation.sync.copyKey": "Copiar la clave de recuperación",
  "automation.sync.savedKey": "He guardado la clave — cerrar",
  "automation.sync.refresh": "Actualizar el estado de la sincronización",
};
