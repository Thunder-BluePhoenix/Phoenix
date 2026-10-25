// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserProfiles as enBrowserProfiles } from "../../en/browser-profiles";

/** Machine-translated; unreviewed. */
export const browserProfiles: Record<keyof typeof enBrowserProfiles, string> = {
  "browserProfiles.title": "Perfiles de navegador",
  "browserProfiles.intro":
    "Phoenix aún no tiene navegador propio, así que aquí no se abre ninguna página: un perfil es un registro de marcadores, una elección de sincronización y extensiones.",
  "browserProfiles.unavailable":
    "Los perfiles de navegador no están disponibles: Phoenix Core no tiene un almacén de secretos del sistema operativo donde guardarlos de forma segura.",
  "browserProfiles.loadFailed": "No se pudieron leer los perfiles de navegador desde Phoenix Core.",
  "browserProfiles.empty": "Aún no hay perfiles.",
  "browserProfiles.list": "Perfiles",
  "browserProfiles.create.name": "Nombre del perfil",
  "browserProfiles.create.submit": "Crear perfil",
  "browserProfiles.counts":
    "Marcadores: {bookmarks} · Historial: {history} · Extensiones: {extensions}",
  "browserProfiles.sync.label": "Sincronizar este perfil entre mis dispositivos",
  "browserProfiles.sync.hint":
    "La sincronización solo funciona si la sincronización de cuenta también está configurada en Ajustes → Sincronización.",
  "browserProfiles.import.label":
    "Marcadores que importar (archivo HTML exportado por un navegador)",
  "browserProfiles.import.hint":
    "Pega el contenido del archivo. Hasta 256 KiB cada vez; divide una exportación mayor en partes.",
  "browserProfiles.import.submit": "Importar marcadores",
  "browserProfiles.import.result": "Importados {imported}, omitidos {skipped}.",
  "browserProfiles.publish.submit": "Publicar en mis otros dispositivos",
  "browserProfiles.publish.done": "Publicado.",
  "browserProfiles.remove.start": "Eliminar perfil",
  "browserProfiles.remove.ask":
    "¿Eliminar «{name}»? Se borrarán sus marcadores, historial, extensiones y credenciales guardadas, y no se puede deshacer.",
  "browserProfiles.remove.done":
    "Perfil eliminado. Se borraron sus marcadores, historial, extensiones y credenciales guardadas. Sus datos web guardados (cookies y almacenamiento de sitios) se borran cuando la ventana del navegador de Phoenix está abierta, porque solo esa ventana puede pedírselo al shell de escritorio.",
  "browserProfiles.purge.pending":
    "Los datos web guardados de {count, plural, one {# perfil eliminado están} other {# perfiles eliminados están}} pendientes de borrar. Abre el navegador de Phoenix para terminar.",
  "browserProfiles.devices.heading": "Otros dispositivos",
  "browserProfiles.devices.check": "Buscar perfiles de mis otros dispositivos",
  "browserProfiles.devices.none": "No hay perfiles nuevos de tus otros dispositivos.",
  "browserProfiles.devices.found": "Perfiles de tus otros dispositivos",
  "browserProfiles.devices.adopt": "Adoptar",
  "browserProfiles.devices.adoptLabel": "Adoptar {name} en este dispositivo",
  "browserProfiles.devices.adopted": "Perfil adoptado.",
  "browserProfiles.ext.heading": "Extensiones",
  "browserProfiles.ext.admin": "Las extensiones las instala tu administrador.",
  "browserProfiles.ext.none": "No hay extensiones.",
  "browserProfiles.ext.loadFailed": "No se pudieron leer las extensiones.",
  "browserProfiles.ext.version": "Versión {version}",
  "browserProfiles.ext.origins": "Sitios: {origins}",
  "browserProfiles.ext.permissions": "Permisos: {permissions}",
  "browserProfiles.ext.noneListed": "ninguno",
  "browserProfiles.ext.approved": "Aprobada",
  "browserProfiles.ext.notApproved": "No aprobada",
  "browserProfiles.ext.revoked": "Revocada",
  "browserProfiles.ext.untrusted": "Firmante no confiable",
  "browserProfiles.ext.approve": "Aprobar",
  "browserProfiles.ext.approveLabel": "Aprobar la extensión {id}",
  "browserProfiles.ext.withdraw": "Retirar aprobación",
  "browserProfiles.ext.withdrawLabel": "Retirar la aprobación de la extensión {id}",
  "browserProfiles.ext.remove": "Eliminar",
  "browserProfiles.ext.removeLabel": "Eliminar la extensión {id}",
  "browserProfiles.ext.waiting": "Esperando tu respuesta a la pregunta de aprobación…",
  "browserProfiles.music.title": "Sitios de música",
  "browserProfiles.music.intro":
    "Phoenix no reproduce música. Activar un sitio solo permite a Phoenix crear una dirección de búsqueda para él, que abres tú mismo. Todos los sitios están desactivados hasta que los actives.",
  "browserProfiles.music.unavailable":
    "Los sitios de música no están disponibles en este Phoenix Core.",
  "browserProfiles.music.loadFailed":
    "No se pudieron leer los sitios de música desde Phoenix Core.",
  "browserProfiles.music.list": "Sitios de música",
  "browserProfiles.music.hosts": "Direcciones usadas: {hosts}",
  "browserProfiles.music.adBlocking":
    "Mientras YouTube esté activado, el bloqueo de anuncios no se aplica a su propio reproductor.",
  "browserProfiles.music.site.youtube": "YouTube",
  "browserProfiles.music.site.soundcloud": "SoundCloud",
  "browserProfiles.music.site.bandcamp": "Bandcamp",
  "browserProfiles.music.site.spotify-web": "Spotify Web",
  "browserProfiles.music.site.other": "Sitio de música {site}",
  "browserProfiles.music.search.label": "Buscar en {site}",
  "browserProfiles.music.search.submit": "Buscar",
  "browserProfiles.music.search.open": "Dirección de búsqueda (se abre en una pestaña nueva):",
  "browserProfiles.music.search.badAddress":
    "Phoenix Core devolvió una dirección que no se puede abrir.",
};
