// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shields as enShields } from "../../en/shields";

/** Machine-translated; unreviewed. */
export const shields: Record<keyof typeof enShields, string> = {
  "shields.title": "Bloqueo de anuncios y rastreadores",
  "shields.intro":
    "Estos ajustes se aplican en el navegador de Phoenix cuando se publique. Phoenix aún no tiene ventana de navegador, así que hoy no se bloquea nada en ninguna página. Solo se pueden bloquear peticiones de red de este modo: no se admite ocultar elementos de la página, y esto no es una copia de las protecciones de ningún otro navegador.",
  "shields.unavailable":
    "Los ajustes de bloqueo de anuncios y rastreadores no están disponibles en Phoenix Core.",
  "shields.loadFailed": "No se pudieron leer los ajustes de bloqueo desde Phoenix Core.",
  "shields.global.label": "Bloquear anuncios y rastreadores",
  "shields.global.hint":
    "Si está desactivado, no se aplica ninguna lista a ningún sitio. Si está activado y no hay ninguna lista descargada, se usa una lista corta integrada de hosts conocidos de anuncios y analítica.",
  "shields.lists.title": "Listas de filtros",
  "shields.lists.note":
    "Las listas no vienen con Phoenix y nunca se descargan por sí solas. Al pulsar Actualizar se contacta una vez con easylist.to para descargar esa lista. No se envía nada sobre ti ni sobre tus páginas.",
  "shields.list.purpose.ads": "Bloquea publicidad",
  "shields.list.purpose.trackers": "Bloquea rastreo",
  "shields.list.never": "Nunca descargada.",
  "shields.list.damaged":
    "La copia guardada está dañada y no se usa. Pulsa Actualizar para descargarla de nuevo.",
  "shields.list.status":
    "Descargada {date} · {rules} reglas de bloqueo · {cosmetic} reglas de elementos de página ignoradas",
  "shields.list.version": "Versión de la lista {version}",
  "shields.list.due":
    "La lista sugiere buscar una versión nueva después del {date}. Phoenix nunca lo comprueba por sí mismo.",
  "shields.list.licence": "Licencia: {licence}. Crédito: {attribution}.",
  "shields.list.source": "La actualización contacta con {source}",
  "shields.list.enable": "Usar {name}",
  "shields.list.enableNeedsDownload": "Descarga la lista antes de activarla.",
  "shields.list.update": "Actualizar",
  "shields.list.updateFirst": "Descargar",
  "shields.list.updating": "Descargando…",
  "shields.list.updated": "{name} se actualizó.",
  "shields.list.remove": "Eliminar la copia descargada",
  "shields.list.removed": "Se eliminó la copia descargada de {name}.",
  "shields.sites.title": "Sitios con el bloqueo desactivado",
  "shields.sites.empty": "Ningún sitio tiene el bloqueo desactivado.",
  "shields.sites.add.label": "Nombre del sitio, por ejemplo example.com",
  "shields.sites.add.submit": "Desactivar el bloqueo en este sitio",
  "shields.sites.remove": "Volver a activar el bloqueo en {site}",
  "shields.sites.hint":
    "Escribe solo el nombre del sitio, no una dirección. Se incluyen el sitio y sus subdominios. Los anuncios propios de YouTube se respetan mientras el sitio de música YouTube esté permitido, y eso se ajusta en sitios de música, no aquí.",
};
