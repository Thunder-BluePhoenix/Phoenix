// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { capture as encapture } from "../../en/capture";

/** Machine-translated; unreviewed (see ../../README.md). */
export const capture: Record<keyof typeof encapture, string> = {
  // Shared audio/mic
  "capture.audio.connectionFailed": "Falló la conexión de audio.",
  "capture.audio.connectionClosed": "Se cerró la conexión de audio.",
  "capture.audio.invalidReply": "Respuesta no válida de Core.",
  "capture.audio.micUnavailable": "Micrófono no disponible: {reason}",
  "capture.audio.waitingForPermission": "Esperando el permiso del micrófono…",
  "capture.audio.coreNotConnected": "Phoenix Core no está conectado.",
  "capture.audio.emergencyStop": "La parada de emergencia está activada.",
  "capture.audio.recognizerAvailable": "Reconocedor de voz: disponible. {detail}",
  "capture.audio.recognizerUnavailable": "Reconocedor de voz: no disponible. {detail}",
  "capture.audio.onDisk":
    "Audio en disco: este motor escribe el audio en un archivo temporal privado mientras reconoce y lo borra enseguida.",
  "capture.mic.unsupported": "Este navegador no puede usar un micrófono",
  "capture.mic.sampleRate": "Este dispositivo no puede proporcionar audio de micrófono a 16 kHz",
  "capture.notetaker.settings.title": "Asistente de notas",
  "capture.notetaker.settings.savedOn": "El asistente de notas está activado.",
  "capture.notetaker.settings.savedOff": "El asistente de notas está desactivado.",
  "capture.notetaker.settings.intro":
    "El asistente de notas graba una llamada en este equipo, sin que se una ningún bot, y la convierte en una transcripción, un resumen y tareas pendientes que puedes revisar. Está {off} hasta que lo actives aquí. Activarlo {not} equivale al consentimiento de nadie para ser grabado: cada grabación te lo vuelve a preguntar.",
  "capture.notetaker.settings.introOff": "desactivado",
  "capture.notetaker.settings.introNot": "no",
  "capture.notetaker.settings.audio.lead": "El audio nunca se almacena.",
  "capture.notetaker.settings.audio.body":
    "Solo se conserva en memoria, se convierte en texto en fragmentos cortos en este dispositivo y se borra en cuanto termina cada fragmento o se detiene la grabación.",
  "capture.notetaker.settings.kept.lead": "Qué se conserva:",
  "capture.notetaker.settings.kept.body":
    "la transcripción, escrita mientras avanza la llamada, y un resumen creado por un modelo en este dispositivo. Si ningún modelo responde, recibes la transcripción sin resumen.",
  "capture.notetaker.settings.speakers.lead": "Interlocutores:",
  "capture.notetaker.settings.speakers.body":
    "solo “Tú” y “Otros”. Phoenix no distingue entre las demás personas.",
  "capture.notetaker.settings.captured.lead": "Qué se captura:",
  "capture.notetaker.settings.banner":
    "Fawkes muestra “Grabando” en todas las vistas, y un botón Detener, durante toda la grabación.",
  "capture.notetaker.settings.toggle": "Activar el asistente de notas",
  "capture.notetaker.settings.killSwitch":
    "La parada de emergencia está activada: la grabación está bloqueada.",
  "capture.notetaker.banner.title": "Grabando una llamada",
  "capture.notetaker.banner.stop": "Detener la grabación",
  "capture.notetaker.banner.stopping": "Deteniendo…",
  "capture.notetaker.micOnly":
    "Solo se graba tu micrófono; no se captura a los demás participantes.",
  "capture.notetaker.consent.title": "Antes de grabar",
  "capture.notetaker.consent.notice":
    "Avisa a todos en la llamada de que se está grabando. Grabar sin consentimiento puede ser ilegal donde vives tú o donde viven ellos.",
  "capture.notetaker.consent.checkbox": "He avisado a todos en la llamada de que se está grabando",
  "capture.notetaker.consent.titleField": "Título {optional}",
  "capture.notetaker.consent.optional": "(opcional)",
  "capture.notetaker.consent.start": "Iniciar la grabación",
  "capture.notetaker.blocked.unavailable": "El estado del asistente de notas no está disponible.",
  "capture.notetaker.blocked.off":
    "El asistente de notas está desactivado. Actívalo en Ajustes, en Asistente de notas.",
  "capture.notetaker.blocked.noConsentChannel":
    "Para grabar hace falta una forma de confianza de preguntarte antes. {detail}",
  "capture.notetaker.blocked.inProgress": "Ya hay una grabación en curso.",
  "capture.notetaker.record.title": "Grabar una llamada",
  "capture.notetaker.record.intro":
    "Graba el micrófono de este equipo, sin bot. El audio nunca se almacena; obtienes una transcripción y, si responde un modelo en este dispositivo, un resumen.",
  "capture.notetaker.record.saved": "Se guardó la grabación.",
  "capture.notetaker.record.openMeeting": "Abrir la reunión",
  "capture.notetaker.recorder.stopped":
    "La grabación se detuvo. Lo transcrito hasta ahora está guardado.",
  "capture.notetaker.recorder.stoppedWithReason":
    "La grabación se detuvo: {reason}. Lo transcrito hasta ahora está guardado.",
  "capture.voice.phase.idle": "La voz está desactivada",
  "capture.voice.phase.starting": "Iniciando el micrófono…",
  "capture.voice.phase.waiting": "Esperando “OK Fawkes”",
  "capture.voice.phase.awake": "Fawkes está escuchando tu petición",
  "capture.voice.phase.thinking": "Trabajando en tu petición…",
  "capture.voice.banner.label": "Asistente de voz",
  "capture.voice.banner.live": "Micrófono activado. {phase}.",
  "capture.voice.banner.stop": "Dejar de escuchar",
  "capture.voice.banner.fawkes": "Fawkes:",
  "capture.voice.banner.openDraft": "Abrir el borrador del correo",
  "capture.voice.blocked.unavailable": "El estado del asistente de voz no está disponible.",
  "capture.voice.blocked.off": "El asistente de voz está desactivado. Actívalo en Ajustes, en Voz.",
  "capture.voice.reason.stopped": "Voz detenida.",
  "capture.voice.reason.disabled": "Se desactivó la voz.",
  "capture.voice.reason.killSwitch": "Voz detenida: la parada de emergencia está activada.",
  "capture.voice.reason.badFrame": "Voz detenida: el micrófono envió audio no válido.",
  "capture.voice.reason.tooFast": "Voz detenida: el micrófono envió audio demasiado rápido.",
  "capture.voice.reason.connectionClosed": "Voz detenida: se cerró la conexión.",
  "capture.voice.reason.streamNotOpened": "Voz detenida: el micrófono no se inició a tiempo.",
  "capture.voice.reason.recogniserFailed": "Voz detenida: falló el reconocimiento de voz.",
  "capture.voice.reason.shutdown": "Voz detenida: Phoenix Core se está deteniendo.",
  "capture.voice.reason.refused": "Voz detenida: Core rechazó el audio.",
  "capture.voice.micCouldNotStart": "No se pudo iniciar el micrófono: {reason}",
  "capture.voice.settings.titleShort": "Voz",
  "capture.voice.settings.title": "Voz (“OK Fawkes”)",
  "capture.voice.settings.unavailable": "Los ajustes de voz no están disponibles en Phoenix Core.",
  "capture.voice.settings.savedOn": "La voz está activada.",
  "capture.voice.settings.savedOff": "La voz está desactivada. Se liberó el micrófono.",
  "capture.voice.settings.intro":
    "Di “OK Fawkes” y pregunta por tus servicios. Está {off} hasta que lo actives aquí, y activarlo es tu consentimiento solo para la voz.",
  "capture.voice.settings.introOff": "desactivado",
  "capture.voice.settings.whileOn.lead": "Mientras está activada:",
  "capture.voice.settings.whileOn.body":
    "esta página mantiene tu micrófono abierto y muestra “Micrófono activado” todo el tiempo. En este dispositivo se hace una comprobación sencilla de volumen en cada momento de sonido; solo cuando alguien habla se entrega un clip corto al reconocedor de voz de este dispositivo.",
  "capture.voice.settings.leaves.lead": "Qué sale de este dispositivo:",
  "capture.voice.settings.leaves.body":
    "nada. El reconocimiento es local; no hay ruta de voz en la nube. Phoenix no produce audio: las respuestas las lee en voz alta tu navegador, cuando puede.",
  "capture.voice.settings.kept.lead": "Qué se conserva:",
  "capture.voice.settings.kept.body":
    "el audio permanece en memoria unos segundos y se borra cuando se ha entendido, cuando lo detienes o cuando se usa la parada de emergencia. Nunca se escribe en disco ni se almacena ninguna transcripción. El registro de auditoría anota que hubo una petición y qué herramienta usó, nunca lo que dijiste.",
  "capture.voice.settings.canDo.lead": "Qué puede hacer:",
  "capture.voice.settings.canDo.body":
    "leer el estado de los servicios que has activado, abrir la píldora y preparar un borrador de correo para que lo revises. No puede cambiar nada y nunca puede aprobar una acción: solo tú puedes, en el panel de la mascota. Sí puede decir “denegar”.",
  "capture.voice.settings.limits.lead": "Límites:",
  "capture.voice.settings.limits.body":
    "la frase de activación se detecta transcribiendo clips cortos de voz (no es un detector de palabras clave dedicado), por lo que puede no detectarla o confundir palabras parecidas.",
  "capture.voice.settings.toggle": "Activar “OK Fawkes”",
  "capture.voice.settings.killSwitch":
    "La parada de emergencia está activada: la voz está bloqueada.",
  "capture.voice.settings.notListening":
    "La voz está activada, pero esta página aún no escucha (tras recargar, el navegador vuelve a preguntar).",
  "capture.voice.settings.start": "Empezar a escuchar",
  "capture.voice.window.title": "Asistente de voz (OK Fawkes)",
  "capture.voice.window.intro":
    "Di «OK Fawkes» y pregunta. La voz se activa en Ajustes, en «Voz»; esta ventana solo inicia y detiene la escucha.",
  "capture.voice.window.shell":
    "Phoenix muestra LISTENING en el título de esta ventana y en la información de la bandeja mientras el micrófono está activo. «Stop voice listening» en el menú de la bandeja lo detiene desde la propia aplicación.",
  "capture.voice.window.listening": "LISTENING: el micrófono está activo.",
  "capture.voice.window.off": "El micrófono está apagado.",
  "capture.multimodal.title": "Captura puntual del dispositivo",
  "capture.multimodal.intro":
    "Solicitada por: el usuario. Core comprueba tu concesión de capacidad y pide aprobación en cada uso antes de que tu navegador pida acceso al dispositivo. No se captura nada en segundo plano; no hay alternativa en la nube.",
  "capture.multimodal.statusUnavailable": "El estado de captura de Core no está disponible.",
  "capture.multimodal.killSwitch": "Captura no disponible: la parada de emergencia está activada.",
  "capture.multimodal.kind.microphone": "Micrófono · un segundo de audio WAV",
  "capture.multimodal.kind.screen": "Pantalla · un fotograma PNG",
  "capture.multimodal.modality":
    "{label}. Modelo: {model}; proveedor: {provider}; ubicación: {locality}. {detail}",
  "capture.multimodal.notReported": "no indicado por Core",
  "capture.multimodal.modalityUnavailable": "no disponible",
  "capture.multimodal.statusPending": "El estado aún no está disponible.",
  "capture.multimodal.grant.microphone":
    "la concesión de la capacidad de micrófono no está disponible; actívala en Capacidades antes de capturar.",
  "capture.multimodal.grant.screen":
    "la concesión de la capacidad de pantalla no está disponible; actívala en Capacidades antes de capturar.",
  "capture.multimodal.capture.microphone": "Capturar micrófono",
  "capture.multimodal.capture.screen": "Capturar pantalla",
  "capture.multimodal.stop": "Detener la captura",
  "capture.multimodal.phase.waitingApproval":
    "Esperando la aprobación de Core. Revisa la solicitud de abajo; aún no hay ningún dispositivo activo.",
  "capture.multimodal.phase.approvedMicrophone":
    "Core aprobó. Solicitando acceso al micrófono durante un segundo.",
  "capture.multimodal.phase.approvedScreen": "Core aprobó. Solicitando un fotograma de pantalla.",
  "capture.multimodal.phase.processing": "Procesando de forma local; el dispositivo está detenido.",
  "capture.multimodal.error.connectionUnavailable": "La conexión de captura no está disponible.",
  "capture.multimodal.error.invalidResponse": "Respuesta de captura de Core no válida.",
  "capture.multimodal.error.browserUnavailable": "La captura del navegador no está disponible.",
  "capture.multimodal.error.frameSize": "La captura supera el tamaño de fotograma permitido.",
  "capture.multimodal.error.deviceDenied": "Se denegó el acceso al dispositivo en el navegador.",
  "capture.multimodal.error.invalidResult":
    "Core devolvió un resultado de captura local no válido.",
  "capture.multimodal.error.refused": "Core rechazó la captura.",
  "capture.multimodal.error.unexpected": "Respuesta de captura de Core inesperada.",
  "capture.multimodal.error.connectionFailed": "Falló la conexión de captura.",
  "capture.multimodal.error.ended": "La captura terminó sin resultado ni aprobación.",
  "capture.multimodal.result.heading": "{what} · {provider} ({locality})",
  "capture.multimodal.result.transcript": "Transcripción",
  "capture.multimodal.result.screen": "Descripción de la pantalla",
  "capture.multimodal.result.clear": "Borrar resultado",

  // Dictation and the pill
  "capture.dictation.mode.asSaid": "Tal cual (sin limpieza)",
  "capture.dictation.mode.natural": "Natural (quitar muletillas)",
  "capture.dictation.mode.polished": "Pulido (corregir también la gramática)",
  "capture.dictation.duration.minutesSeconds": "{minutes} min {seconds} s",
  "capture.dictation.duration.seconds": "{seconds} s",
  "capture.dictation.blocked.statusUnavailable": "El estado del dictado no está disponible.",
  "capture.dictation.blocked.off": "El dictado está desactivado. Actívalo en Ajustes, en Dictado.",
  "capture.dictation.stopped.plain": "Dictado detenido.",
  "capture.dictation.stopped.reason": "Dictado detenido: {reason}.",
  "capture.dictation.nothingRecognised": "No se reconoció nada.",
  "capture.dictation.button.start": "Dictar",
  "capture.dictation.button.starting": "Iniciando…",
  "capture.dictation.button.recognising": "Reconociendo…",
  "capture.dictation.button.stop": "Dejar de dictar",
  "capture.dictation.button.cancel": "Cancelar el dictado",
  "capture.dictation.hint": "Usa tu micrófono solo mientras dictas; el audio no se almacena.",
  "capture.dictation.indicator.listening": "Escuchando: tu micrófono está activado.",
  "capture.dictation.settings.title": "Dictado",
  "capture.dictation.settings.unavailable":
    "Los ajustes de dictado no están disponibles en Phoenix Core.",
  "capture.dictation.settings.intro":
    "El dictado convierte tu voz en texto en este dispositivo. Está {off} hasta que lo actives aquí, y activarlo es tu consentimiento solo para el dictado.",
  "capture.dictation.settings.intro.off": "desactivado",
  "capture.dictation.settings.enable": "Activar el dictado",
  "capture.dictation.privacy.leaves.lead": "Qué sale de este dispositivo:",
  "capture.dictation.privacy.leaves.body":
    "nada. La voz se reconoce en este dispositivo; la limpieza opcional usa solo un modelo de este dispositivo y nunca se envía a un proveedor en la nube, aunque hayas permitido la IA en la nube para otras cosas.",
  "capture.dictation.privacy.memory.lead": "Qué permanece en memoria:",
  "capture.dictation.privacy.memory.body":
    "el audio, durante un dictado (como máximo {seconds, plural, one {# segundo} other {# segundos}}). Nunca se escribe en disco y se borra cuando el dictado termina, se cancela o se usa la parada de emergencia.",
  "capture.dictation.privacy.stored.lead": "Qué se almacena:",
  "capture.dictation.privacy.stored.body":
    "tus ajustes y las listas de palabras de abajo, y recuentos por día y aplicación (palabras, tiempo hablado, número de dictados). Nunca el texto que dictas ni el audio.",
  "capture.dictation.privacy.microphone":
    "El micrófono solo está activado mientras dictas, y Fawkes muestra “Escuchando” todo el tiempo.",
  "capture.dictation.killSwitch":
    "La parada de emergencia está activada: el dictado está bloqueado.",
  "capture.dictation.saved.on": "El dictado está activado.",
  "capture.dictation.saved.off": "El dictado está desactivado.",
  "capture.dictation.saved.defaultMode": "Se guardó la limpieza predeterminada.",
  "capture.dictation.saved.appModes": "Se guardaron los modos de limpieza por aplicación.",
  "capture.dictation.saved.typing": "Se guardó la velocidad de escritura.",
  "capture.dictation.saved.vocabulary": "Se guardaron las listas de palabras.",
  "capture.dictation.saved.statsDeleted": "Se eliminaron todas las estadísticas de dictado.",
  "capture.dictation.cleanup.heading": "Limpieza",
  "capture.dictation.cleanup.default": "Limpieza predeterminada",
  "capture.dictation.typing.heading": "Velocidad de escritura",
  "capture.dictation.typing.label": "¿Qué tan rápido escribes? (palabras por minuto)",
  "capture.dictation.typing.save": "Guardar velocidad de escritura",
  "capture.dictation.typing.invalid": "Introduce un número entero de {min} a {max}.",
  "capture.dictation.appModes.summary":
    "Limpieza por aplicación ({count} de {max}). Una aplicación que no figura usa la predeterminada.",
  "capture.dictation.appModes.entry": "{app}: {mode}",
  "capture.dictation.appModes.remove": "Quitar {app}",
  "capture.dictation.appModes.idLabel":
    "Identificador de la aplicación (por ejemplo, un bundle id)",
  "capture.dictation.appModes.modeLabel": "Limpieza para esta aplicación",
  "capture.dictation.appModes.set": "Establecer limpieza de la aplicación",
  "capture.dictation.appModes.invalid":
    "Usa letras, dígitos, punto, guion o guion bajo (máximo {max}).",
  "capture.dictation.problem.plainWords":
    "Usa palabras simples separadas por un solo espacio (sin puntuación).",
  "capture.dictation.problem.maxChars":
    "{n, plural, one {Máximo # carácter.} other {Máximo # caracteres.}}",
  "capture.dictation.problem.maxWords":
    "{n, plural, one {Máximo # palabra.} other {Máximo # palabras.}}",
  "capture.dictation.problem.term":
    "{n, plural, one {Hasta # carácter visible, sin espacios en los extremos.} other {Hasta # caracteres visibles, sin espacios en los extremos.}}",
  "capture.dictation.problem.soundsLike":
    "Hace falta “Suena como” cuando el término no son palabras simples: {problem}",
  "capture.dictation.problem.replacement":
    "{n, plural, one {Hasta # carácter visible.} other {Hasta # caracteres visibles.}}",
  "capture.dictation.problem.snippet":
    "{n, plural, one {Hasta # carácter; sin caracteres de control ni ocultos.} other {Hasta # caracteres; sin caracteres de control ni ocultos.}}",
  "capture.dictation.vocabulary.heading": "Diccionario, reemplazos y fragmentos",
  "capture.dictation.vocabulary.intro":
    "Todo lo de aquí es texto literal: no hay patrones. La coincidencia ignora mayúsculas y minúsculas y funciona con palabras completas.",
  "capture.dictation.vocabulary.save": "Guardar listas de palabras",
  "capture.dictation.dictionary.heading": "Diccionario ({count} de {max})",
  "capture.dictation.dictionary.intro": "Escribe un nombre o término como quieres que aparezca.",
  "capture.dictation.dictionary.entry": "“{soundsLike}” → {term}",
  "capture.dictation.dictionary.remove": "Quitar la entrada del diccionario {term}",
  "capture.dictation.dictionary.term": "Término",
  "capture.dictation.dictionary.soundsLike": "Suena como (opcional)",
  "capture.dictation.dictionary.add": "Añadir entrada al diccionario",
  "capture.dictation.replacements.heading": "Reemplazos ({count} de {max})",
  "capture.dictation.replacements.entry": "“{from}” → “{to}”",
  "capture.dictation.replacements.entryRemoved": "“{from}” → (eliminado)",
  "capture.dictation.replacements.remove": "Quitar el reemplazo {from}",
  "capture.dictation.replacements.from": "Reemplazar las palabras",
  "capture.dictation.replacements.to": "Por (si está vacío, las elimina)",
  "capture.dictation.replacements.add": "Añadir reemplazo",
  "capture.dictation.snippets.heading": "Fragmentos ({count} de {max})",
  "capture.dictation.snippets.intro":
    "Un fragmento se expande solo cuando todo el dictado es exactamente su disparador.",
  "capture.dictation.snippets.entry": "“{trigger}” → {text}",
  "capture.dictation.snippets.remove": "Quitar el fragmento {trigger}",
  "capture.dictation.snippets.trigger": "Cuando diga",
  "capture.dictation.snippets.text": "Insertar este texto",
  "capture.dictation.snippets.add": "Añadir fragmento",
  "capture.dictation.stats.heading": "Estadísticas",
  "capture.dictation.stats.none": "Aún no hay dictados.",
  "capture.dictation.stats.words": "Palabras dictadas",
  "capture.dictation.stats.sessions": "Dictados",
  "capture.dictation.stats.saved": "Tiempo ahorrado",
  "capture.dictation.stats.savedValue":
    "{duration} (escribiendo a {wpm, plural, one {# palabra por minuto} other {# palabras por minuto}})",
  "capture.dictation.stats.average": "Velocidad media al hablar",
  "capture.dictation.stats.wordsPerMinute":
    "{n, plural, one {# palabra por minuto} other {# palabras por minuto}}",
  "capture.dictation.stats.streak": "Racha",
  "capture.dictation.stats.days": "{n, plural, one {# día} other {# días}}",
  "capture.dictation.stats.topApps": "Aplicaciones principales",
  "capture.dictation.stats.noApps": "ninguna",
  "capture.dictation.stats.unknownApp": "aplicación desconocida",
  "capture.dictation.stats.appWords": "{app} ({n, plural, one {# palabra} other {# palabras}})",
  "capture.dictation.stats.note":
    "Son solo recuentos. Los nombres de las aplicaciones son privados y no se envían a ninguna parte. Core los conserva hasta que los elimines.",
  "capture.dictation.stats.confirmGroup": "Confirmar la eliminación de las estadísticas",
  "capture.dictation.stats.confirmText":
    "¿Eliminar todas las estadísticas de dictado? Esta acción no se puede deshacer.",
  "capture.dictation.stats.confirmYes": "Sí, eliminar todo",
  "capture.dictation.stats.confirmKeep": "Conservarlas",
  "capture.dictation.stats.delete": "Eliminar todas las estadísticas de dictado",
  "capture.pill.waiting": "Esperando el micrófono…",
  "capture.pill.listening": "Escuchando: tu micrófono está activado",
  "capture.pill.recognising": "Reconociendo…",
  "capture.pill.ready": "Listo",
  "capture.pill.stop": "Detener",
  "capture.pill.recordCall": "Grabar una llamada",
  "capture.pill.recordCall.title": "Grabar una llamada: abre el grabador de llamadas en Phoenix",
  "capture.pill.openPhoenix": "Abrir Phoenix",
  "capture.pill.pasteFailed": "No se pudo pegar el texto.",
  "capture.pill.outcome.typed": "Escrito",
  "capture.pill.outcome.pasted": "Pegado",

  // Attachments, chat, answers, retrieval
  "capture.attachments.kind.text": "Texto",
  "capture.attachments.kind.image": "Imagen",
  "capture.attachments.kind.folder": "Carpeta",
  "capture.attachments.origin.drop": "por arrastre",
  "capture.attachments.origin.window": "ventana",
  "capture.attachments.origin.paste": "por pegado",
  "capture.attachments.localOnly": "Solo local",
  "capture.attachments.dropZone.label": "Suelta archivos en {label}",
  "capture.attachments.dropZone.over": "Suelta para adjuntar.",
  "capture.attachments.dropZone.hint":
    "Suelta aquí archivos de texto, imágenes PNG/JPEG o una carpeta, o {attach} Adjuntar no envía nada.",
  "capture.attachments.dropZone.attachFiles": "adjunta archivos…",
  "capture.attachments.dropZone.choose": "Elegir archivos para adjuntar",
  "capture.attachments.dropZone.reading": "Leyendo lo que soltaste…",
  "capture.attachments.preview.imageAlt": "Vista previa de {name}",
  "capture.attachments.preview.listingBroken": "No se puede mostrar el listado almacenado.",
  "capture.attachments.preview.filesIn": "Archivos en {name}",
  "capture.attachments.preview.contentsOf": "Contenido de {name}",
  "capture.attachments.chip.include": "Incluir {name} en la pregunta",
  "capture.attachments.chip.meta": "{kind} · {size} · {origin}",
  "capture.attachments.chip.metaFiles":
    "{kind}, {files, plural, one {# archivo} other {# archivos}} · {size} · {origin}",
  "capture.attachments.chip.previewLabel": "Vista previa de {name}",
  "capture.attachments.chip.removeLabel": "Quitar {name}",
  "capture.attachments.chip.preview": "Vista previa",
  "capture.attachments.chip.hide": "Ocultar",
  "capture.attachments.tray.label": "Adjuntos",
  "capture.attachments.tray.heading": "Adjuntos ({n})",
  "capture.attachments.tray.localOnlyTitle":
    "Los archivos adjuntos solo los lee un modelo de este dispositivo",
  "capture.attachments.tray.clearAll": "Borrar todo",
  "capture.attachments.tray.noteTicked":
    "Se conservan solo en la memoria de Phoenix Core (nunca se guardan en disco) hasta {minutes, plural, one {# minuto} other {# minutos}}. Al pulsar “Preguntar sobre los adjuntos”, se envía {n, plural, one {el elemento marcado} other {los # elementos marcados}}, completo, a un modelo de este dispositivo. Nada sale de este dispositivo.",
  "capture.attachments.tray.noteNone":
    "Se conservan solo en la memoria de Phoenix Core (nunca se guardan en disco) hasta {minutes, plural, one {# minuto} other {# minutos}}. No se envía nada hasta que preguntes.",
  "capture.attachments.tray.tooMany":
    "Una pregunta puede usar como máximo {max, plural, one {# elemento} other {# elementos}}. Desmarca {n} para preguntar.",
  "capture.attachments.draft.open": "Redactar correo",
  "capture.attachments.draft.to": "Para (opcional)",
  "capture.attachments.draft.message": "Mensaje (este texto exacto va en el borrador)",
  "capture.attachments.draft.count":
    "{n} / {max} caracteres. Abre tu aplicación de correo con un borrador. Phoenix no lo envía.",
  "capture.attachments.draft.submit": "Abrir borrador de correo",
  "capture.attachments.draft.openFailed": "No se pudo abrir tu aplicación de correo.",
  "capture.attachments.answer.local": "gratis, en este dispositivo",
  "capture.attachments.answer.cloud": "nube",
  "capture.attachments.answer.processed": "Procesado por {by} · {where}",
  "capture.attachments.answer.processedVision":
    "Procesado por {by} · imágenes leídas por {vision} en este dispositivo · {where}",
  "capture.attachments.answer.from": "De: {names}. Texto generado, no un hecho almacenado.",
  "capture.attachments.fawkesDrop.heading": "Dale un archivo a Fawkes",
  "capture.attachments.fawkesDrop.hint":
    "Suelta un archivo, una imagen o una carpeta sobre Fawkes y luego pregunta por ello en la pestaña Chat.",
  "capture.attachments.fawkesDrop.count": "{n} adjuntos.",
  "capture.attachments.file.badName":
    "{name}: el nombre está vacío, es demasiado largo o contiene caracteres ocultos",
  "capture.attachments.file.imageTooBig": "{name}: una imagen puede pesar como máximo 5 MiB",
  "capture.attachments.file.unreadable": "{name}: no se pudo leer el archivo",
  "capture.attachments.file.unsupported":
    "{name}: tipo no admitido (archivos de texto, imágenes PNG/JPEG o una carpeta)",
  "capture.attachments.file.tooLargeBytes":
    "{name}: demasiado grande (un archivo de texto puede tener como máximo {max} caracteres)",
  "capture.attachments.file.empty": "{name}: el archivo está vacío",
  "capture.attachments.file.tooLarge":
    "{name}: demasiado grande ({chars} caracteres; el límite es {max})",
  "capture.attachments.skip.unreadableFolder":
    "{label}: {n, plural, one {se omitió # carpeta que no se pudo leer} other {se omitieron # carpetas que no se pudieron leer}}",
  "capture.attachments.skip.unusualName":
    "{label}: {n, plural, one {se omitió # entrada con un nombre inusual} other {se omitieron # entradas con un nombre inusual}}",
  "capture.attachments.skip.hidden":
    "{label}: {n, plural, one {se omitió # archivo o carpeta oculto} other {se omitieron # archivos y carpetas ocultos}} (nombres con punto, node_modules, .git)",
  "capture.attachments.skip.longPath":
    "{label}: se omitieron {n} entradas con una ruta de más de {pathChars} caracteres",
  "capture.attachments.skip.tooDeep":
    "{label}: se omitieron {n} carpetas anidadas a más de {depth} niveles",
  "capture.attachments.skip.special":
    "{label}: {n, plural, one {se omitió # entrada que no es ni archivo ni carpeta} other {se omitieron # entradas que no son ni archivo ni carpeta}}",
  "capture.attachments.skip.unreadableFile":
    "{label}: {n, plural, one {se omitió # archivo que no se pudo leer} other {se omitieron # archivos que no se pudieron leer}}",
  "capture.attachments.skip.longText":
    "{label}: {n, plural, one {se omitió # archivo de texto demasiado largo para incluirlo (listado sin contenido)} other {se omitieron # archivos de texto demasiado largos para incluirlos (listados sin contenido)}}",
  "capture.attachments.folder.capped": "{label}: solo se listaron los primeros {max} archivos",
  "capture.attachments.folder.noFiles": "{label}: no se encontraron archivos legibles",
  "capture.attachments.folder.badName": "{label}: el nombre de la carpeta no se puede usar",
  "capture.attachments.notice.uploadFailed": "{name}: {reason}",
  "capture.attachments.notice.attached":
    "{n, plural, one {Se adjuntó # elemento.} other {Se adjuntaron # elementos.}} Aún no se ha enviado nada a ninguna parte.",
  "capture.attachments.notice.nothingAttached": "No se adjuntó nada.",
  "capture.attachments.notice.withProblems": "{head} {problems}",
  "capture.attachments.nativeDrop.folder":
    "{name}: no se puede soltar una carpeta aquí. Usa el cuadro de chat o el Pet Panel.",
  "capture.attachments.nativeDrop.skipped":
    "Solo se usan los primeros {max} archivos de lo que sueltas; se ignoraron {n} más.",
  "capture.attachments.mail.subject": "Sobre: {name}",
  "capture.attachments.mail.empty": "Escribe primero lo que quieres compartir.",
  "capture.attachments.mail.tooLong":
    "El mensaje supera en {over} caracteres el límite de {limit}. Acórtalo.",
  "capture.attachments.mail.badAddress":
    "Introduce una sola dirección de correo o deja vacío el destinatario.",
  "capture.attachments.mail.urlTooLong":
    "Los enlaces de correo tan largos no son fiables ({length} de {limit} caracteres una vez codificados). Acorta el mensaje.",
  "capture.chat.ciForm.badRepository":
    "Introduce el repositorio como “propietario/nombre”, por ejemplo “acme/app”.",
  "capture.chat.ciForm.badRunId":
    "El id de ejecución debe ser un número entero positivo, o dejarse vacío para la última ejecución fallida.",
  "capture.chat.ciForm.label": "Diagnosticar un fallo de CI",
  "capture.chat.ciForm.intro":
    "Fawkes leerá la ejecución fallida de GitHub Actions y tu historial local de git. No cambia nada.",
  "capture.chat.ciForm.repository": "Repositorio (propietario/nombre)",
  "capture.chat.ciForm.runId":
    "Id de ejecución (opcional; vacío significa la última ejecución fallida)",
  "capture.chat.ciForm.start": "Iniciar diagnóstico",
  "capture.chat.who.you": "Tú",
  "capture.chat.status": "Fawkes está {state}.",
  "capture.chat.intro":
    "Pregunta qué recuerda Fawkes. Las respuestas muestran primero los hechos almacenados con sus fuentes; todo lo generado está etiquetado. Esta conversación se conserva solo en esta página y desaparece al recargar.",
  "capture.chat.empty": "Aún no hay mensajes.",
  "capture.chat.conversation": "Conversación",
  "capture.chat.waiting": "Esperando la respuesta de Phoenix Core…",
  "capture.chat.dropLabel": "el cuadro de chat",
  "capture.chat.message": "Mensaje para Fawkes",
  "capture.chat.count": "{n} / {max} caracteres · Intro envía, Mayús+Intro inicia una línea nueva",
  "capture.chat.send": "Enviar",
  "capture.chat.sending": "Enviando…",
  "capture.chat.askAttachments": "Preguntar sobre los adjuntos",
  "capture.chat.askAttachmentsNone": "Adjunta algo primero o marca un adjunto",
  "capture.chat.askAttachmentsTitle":
    "Envía tu pregunta y los adjuntos marcados a un modelo de este dispositivo",
  "capture.chat.diagnose": "Diagnosticar un fallo de CI",
  "capture.chat.automationOff":
    "La automatización está desactivada, así que Fawkes no puede iniciar tareas. Actívala en Ajustes, en Automatización.",
  "capture.chat.attachmentQuestion": "{text}\n(sobre: {names})",
  "capture.chat.error.askMemory": "Falló la consulta a la memoria: {reason}.",
  "capture.chat.error.askAttachments": "Falló la pregunta sobre los adjuntos: {reason}.",
  "capture.chat.error.automationOff":
    "La automatización está desactivada, así que no se inició ninguna tarea. Actívala en Ajustes, en Automatización.",
  "capture.chat.error.startTask": "No se pudo iniciar la tarea: {reason}.",
  "capture.chat.ciUser.latest":
    "Diagnosticar un fallo de CI en {repository} (la última ejecución fallida)",
  "capture.chat.ciUser.run": "Diagnosticar un fallo de CI en {repository} (ejecución {run})",
  "capture.answer.sensitivity.public": "Público",
  "capture.answer.sensitivity.internal": "Interno",
  "capture.answer.sensitivity.sensitive": "Sensible",
  "capture.answer.classification.storedFact": "Hecho almacenado",
  "capture.answer.classification.retrievedEvidence": "Evidencia recuperada, no un hecho afirmado",
  "capture.answer.classification.storedInterpretation": "Interpretación almacenada, no un hecho",
  "capture.answer.freshness.stale": "Observación obsoleta",
  "capture.answer.freshness.fresh": "Observación reciente",
  "capture.answer.confidenceUnknown": "desconocida",
  "capture.answer.record":
    "{classification} · id de origen {id} · {domain} · de {source}{ref} · observado {observed} · {sensitivity} · {freshness} · confianza {confidence}",
  "capture.answer.attribution.whereLocal": "en este dispositivo",
  "capture.answer.attribution.whereCloud": "en la nube (sale de este dispositivo)",
  "capture.answer.attribution.costUnknown": "coste desconocido",
  "capture.answer.attribution.costFree": "gratis, en este dispositivo",
  "capture.answer.attribution.costAbout": "unos ${amount} (según tus precios)",
  "capture.answer.attribution.defaultModel": "su modelo predeterminado",
  "capture.answer.attribution.line":
    "Respondido por {model} mediante {provider} · {where} · {cost}",
  "capture.answer.facts.heading": "Hechos almacenados",
  "capture.answer.facts.empty": "Ningún hecho almacenado coincidió con tu pregunta.",
  "capture.answer.evidence.heading": "Evidencia recuperada (no son hechos almacenados)",
  "capture.answer.evidence.empty": "Ninguna evidencia recuperada coincidió.",
  "capture.answer.interpretations.heading":
    "Interpretaciones almacenadas anteriores (no son hechos)",
  "capture.answer.interpretations.empty": "Ninguna interpretación anterior coincidió.",
  "capture.answer.hypothesis.heading": "Hipótesis generada",
  "capture.answer.hypothesis.label":
    "Hipótesis generada por {by}, no un hecho almacenado ni una conclusión establecida.",
  "capture.answer.hypothesis.anAiModel": "un modelo de IA",
  "capture.answer.hypothesis.noInterpretation": "Se usó IA, pero no dio ninguna interpretación.",
  "capture.answer.hypothesis.noAi": "No se usó IA.",
  "capture.retrieval.hybrid":
    "Encontrado por palabras clave y por significado (búsqueda inteligente).",
  "capture.retrieval.keywordsOnly": "Encontrado solo por palabras clave.",
  "capture.retrieval.notUsed": "No se usó la búsqueda inteligente: {reason}.",
  "capture.retrieval.skipped.aiDisabled": "la IA está desactivada",
  "capture.retrieval.truncated":
    "Se omitieron los recuerdos más antiguos para mantener la rapidez.",
};
