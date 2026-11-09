// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserChrome as enBrowserChrome } from "../../en/browser-chrome";

/** Machine-translated; unreviewed. */
export const browserChrome: Record<keyof typeof enBrowserChrome, string> = {
  "browser.find.open": "Buscar en la página",
  "browser.find.label": "Buscar en la página",
  "browser.find.placeholder": "Buscar en la página",
  "browser.find.next": "Siguiente resultado",
  "browser.find.prev": "Resultado anterior",
  "browser.find.close": "Cerrar la búsqueda",
  "browser.find.searching": "Buscando…",
  "browser.find.found": "Encontrado en esta página.",
  "browser.find.notFound": "No se encontró en esta página.",
  "browser.find.tooLong": "El texto de búsqueda puede tener como máximo {max} caracteres.",
  "browser.find.control": "El texto de búsqueda no puede contener caracteres de control.",
  "browser.find.bidi":
    "El texto de búsqueda no puede contener caracteres de control de dirección del texto.",
  "browser.find.failed": "No se pudo buscar en esta página.",
  "browser.find.bad_query": "El navegador rechazó ese texto de búsqueda.",
  "browser.find.unknown_tab": "Esa pestaña ya no existe.",
  "browser.find.no_page": "Todavía no hay una página en la que buscar.",
  "browser.permission.title": "Una página pide permiso",
  "browser.permission.origin": "Sitio: {origin}",
  "browser.permission.asks": "Quiere usar: {permission}",
  "browser.permission.allow": "Permitir una vez",
  "browser.permission.deny": "Denegar",
  "browser.permission.countdown":
    "Se denegará automáticamente en {seconds, plural, one {# segundo} other {# segundos}}.",
  "browser.permission.more":
    "{count, plural, one {# solicitud más está en espera} other {# solicitudes más están en espera}}",
  "browser.permission.kind.microphone": "tu micrófono",
  "browser.permission.kind.camera": "tu cámara",
  "browser.permission.kind.geolocation": "tu ubicación",
  "browser.permission.kind.notifications": "las notificaciones",
  "browser.permission.kind.clipboard-read": "leer tu portapapeles",
  "browser.permission.kind.display-capture": "tu pantalla",
  "browser.permission.kind.midi": "dispositivos MIDI",
  "browser.permission.kind.sensors": "los sensores de movimiento y otros",
  "browser.permission.kind.media-key-system-access": "contenido protegido (DRM)",
  "browser.permission.kind.local-fonts": "las fuentes instaladas en este equipo",
  "browser.permission.kind.window-management": "tus pantallas y ventanas",
  "browser.permission.kind.pointer-lock": "el puntero del ratón",
  "browser.permission.kind.automatic-downloads": "varias descargas a la vez",
  "browser.permission.kind.file-system-access": "archivos de este equipo",
  "browser.permission.kind.autoplay": "reproducir sonido automáticamente",
  "browser.permission.kind.other": "otra cosa",
  "browser.corner.noShell": "No está conectado a la aplicación de escritorio de Phoenix.",
  "browser.corner.noTab": "No hay ninguna pestaña abierta.",
  "browser.corner.loading": "Cargando la página.",
  "browser.corner.idle": "La página está cargada.",
  "browser.corner.permission": "Una página pide permiso. Respóndela, por favor.",
  "browser.corner.shieldsOff": "El bloqueo de anuncios y rastreadores está desactivado en {site}.",
  "browser.corner.blocked":
    "{count, plural, one {# solicitud se bloqueó en esta página.} other {# solicitudes se bloquearon en esta página.}}",
  "browser.corner.setting":
    "Mostrar a Fawkes en la esquina del navegador Phoenix (solo aplicación de escritorio)",
  "browser.corner.settingHint":
    "Activado por defecto. Un pequeño Fawkes en la barra de herramientas del navegador muestra si la página está cargando, si se pide un permiso, si el bloqueo está desactivado o si se hizo una búsqueda. Nunca aparece dentro de una página web.",
};
