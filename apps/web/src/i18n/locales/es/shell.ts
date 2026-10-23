// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shell as enShell } from "../../en/shell";

/** Machine-translated; unreviewed (see ../../README.md). */
export const shell: Record<keyof typeof enShell, string> = {
  "shell.nav.home": "Inicio de Phoenix",
  "shell.nav.main": "Principal",
  "shell.nav.meetings": "Reuniones",
  "shell.nav.provenance": "Procedencia",
  "shell.nav.agents": "Agentes",
  "shell.nav.workflows": "Flujos de trabajo",
  "shell.nav.recap": "Resumen",
  "shell.nav.settings": "Ajustes",
  "shell.nav.recording": "Grabando",
  "shell.app.skipToContent": "Saltar al contenido",
  "shell.app.tagline": "Phoenix es la plataforma. Fawkes es la mascota.",
  "shell.app.noToken":
    "Esta página no tiene token de sesión. Abre Phoenix desde la dirección que imprime {command}.",
  "shell.app.hint": "Haz clic en Fawkes en la barra superior para ver qué está haciendo Phoenix.",
  "shell.language.title": "Idioma",
  "shell.language.label": "Idioma de la interfaz",
  "shell.language.available":
    "{count, plural, one {Hay # idioma disponible.} other {Hay # idiomas disponibles.}}",
  "shell.language.machineNote":
    "El texto en idiomas distintos del inglés es de traducción automática y aún no ha sido revisado por hablantes nativos.",
  "shell.language.saved": "Idioma cambiado.",
  "shell.language.failed": "No se pudo guardar el idioma. Inténtalo de nuevo.",

  "shell.palette.title": "Paleta de comandos",
  "shell.palette.inputLabel": "Buscar comandos",
  "shell.palette.placeholder": "Escribe un comando…",
  "shell.palette.results": "Comandos",
  "shell.palette.hint": "Las flechas arriba y abajo eligen, Enter ejecuta, Escape cierra.",
  "shell.palette.count": "{count, plural, one {# comando} other {# comandos}}",
  "shell.palette.empty": "Ningún comando coincide con “{query}”.",

  "shell.cmd.palette.open": "Abrir la paleta de comandos",
  "shell.cmd.nav.home": "Ir al inicio",
  "shell.cmd.nav.meetings": "Ir a Reuniones",
  "shell.cmd.nav.provenance": "Ir a Procedencia",
  "shell.cmd.nav.agents": "Ir a Agentes",
  "shell.cmd.nav.workflows": "Ir a Flujos de trabajo",
  "shell.cmd.nav.recap": "Ir a Resumen",
  "shell.cmd.nav.settings": "Ir a Ajustes",
  "shell.cmd.settings.language": "Abrir Ajustes: Idioma",
  "shell.cmd.panel.overview": "Panel de Fawkes: Resumen",
  "shell.cmd.panel.chat": "Panel de Fawkes: Chat",
  "shell.cmd.panel.activity": "Panel de Fawkes: Actividad",
  "shell.cmd.panel.capabilities": "Panel de Fawkes: Capacidades",
  "shell.cmd.panel.memory": "Panel de Fawkes: Memoria",
  "shell.cmd.panel.wardrobe": "Abrir el Armario",
  "shell.cmd.demo.start": "Iniciar la demostración",
  "shell.cmd.demo.stop": "Detener la demostración",
  "shell.cmd.pills.next": "Cambiar a la siguiente etiqueta de fuente",
  "shell.cmd.pills.previous": "Cambiar a la etiqueta de fuente anterior",
  "shell.cmd.mute.toggle": "Silenciar o reactivar sonidos y notificaciones",

  "shell.shortcuts.title": "Atajos globales",
  "shell.shortcuts.desktopOnly":
    "Los atajos globales son una función de la aplicación de escritorio de Phoenix. No están disponibles en un navegador.",
  "shell.shortcuts.intro":
    "Los atajos globales funcionan desde cualquier aplicación mientras la aplicación de escritorio de Phoenix está en ejecución.",
  "shell.shortcuts.loading": "Cargando atajos…",
  "shell.shortcuts.loadFailed": "No se pudieron leer los atajos de la aplicación de escritorio.",
  "shell.shortcuts.enable": "Activar los atajos globales",
  "shell.shortcuts.warning":
    "Advertencia: mientras los atajos globales están activados, cada uno quita su combinación de teclas a todas las demás aplicaciones. Están desactivados hasta que los actives. Cada atajo necesita al menos dos teclas modificadoras (Ctrl, Alt, Shift o Cmd), así que no interfiere con la escritura normal.",
  "shell.shortcuts.mute": "Silenciar sonidos y notificaciones",
  "shell.shortcuts.muteHelp":
    "Fawkes sigue mostrando lo que hace; solo se silencian sus sonidos y sus burbujas de notificación.",
  "shell.shortcuts.list": "Acciones de atajo",
  "shell.shortcuts.action.open_chat": "Abrir el chat",
  "shell.shortcuts.action.jump_to_alert": "Saltar a la alerta",
  "shell.shortcuts.action.jump_to_terminal": "Saltar al terminal",
  "shell.shortcuts.action.switch_pills": "Cambiar las etiquetas",
  "shell.shortcuts.action.mute": "Silenciar sonidos y notificaciones",
  "shell.shortcuts.action.send_to_desktop": "Enviar a Fawkes al escritorio",
  "shell.shortcuts.action.wardrobe": "Abrir el Armario",
  "shell.shortcuts.binding.none": "Sin asignar",
  "shell.shortcuts.default": "Predeterminado: {keys}",
  "shell.shortcuts.state.active": "Activo",
  "shell.shortcuts.state.off": "Inactivo: los atajos globales están desactivados",
  "shell.shortcuts.state.unbound": "Inactivo: no hay ninguna combinación de teclas asignada",
  "shell.shortcuts.state.rejected": "Inactivo: esta combinación de teclas no está permitida",
  "shell.shortcuts.state.unavailable":
    "Inactivo: puede que otra aplicación ya use esta combinación de teclas, o que el sistema no la permita",
  "shell.shortcuts.changeFor": "Cambiar el atajo de {action}",
  "shell.shortcuts.capture": "Pulsa la nueva combinación de teclas",
  "shell.shortcuts.captureFor": "Nueva combinación de teclas para {action}",
  "shell.shortcuts.captureHelp": "Pulsa las teclas a la vez. Escape cancela.",
  "shell.shortcuts.resetFor": "Restablecer el atajo de {action} a su valor predeterminado",
  "shell.shortcuts.resetAll": "Restablecer todos los atajos",
  "shell.shortcuts.saved": "El atajo de {action} ahora es {keys}.",
  "shell.shortcuts.resetDone": "Se restableció el atajo de {action}.",
  "shell.shortcuts.resetAllDone": "Se restablecieron todos los atajos.",
  "shell.shortcuts.reason.invalid": "Ese atajo no es válido.",
  "shell.shortcuts.reason.unsupportedKey":
    "No se puede usar esa tecla. Usa una letra, un dígito, una tecla F o una flecha junto con teclas modificadoras.",
  "shell.shortcuts.reason.needs_modifiers":
    "Un atajo necesita al menos dos teclas modificadoras (Ctrl, Alt, Shift o Cmd), para que no ocupe la escritura normal.",
  "shell.shortcuts.reason.needs_third_modifier":
    "Ctrl+Alt y Alt+Shift con una letra o un dígito escriben símbolos en muchos teclados (AltGr u Option). Añade una tercera tecla modificadora.",
  "shell.shortcuts.reason.reserved": "El sistema ya usa esa combinación de teclas.",
  "shell.shortcuts.reason.dictation_chord":
    "Esa combinación de teclas la usa el dictado (pegar de nuevo).",
  "shell.shortcuts.reason.conflict": "Otro atajo de Phoenix ya usa esa combinación de teclas.",
  "shell.shortcuts.reason.unavailable":
    "El sistema no registró esa combinación de teclas. Puede que otra aplicación ya la use.",
  "shell.shortcuts.reason.forbidden": "Esta ventana no puede cambiar los atajos.",
  "shell.shortcuts.reason.unknown_action": "Esa no es una acción de atajo.",
  "shell.shortcuts.reason.unknown": "No se pudo cambiar el atajo.",
};
