// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browser as enBrowser } from "../../en/browser";

/** Machine-translated; unreviewed. */
export const browser: Record<keyof typeof enBrowser, string> = {
  "browser.tabs.label": "Pestañas",
  "browser.tab.untitled": "Nueva pestaña",
  "browser.tab.loading": "Cargando",
  "browser.tab.close": "Cerrar la pestaña {title}",
  "browser.tab.new": "Nueva pestaña",
  "browser.nav.back": "Atrás",
  "browser.nav.forward": "Adelante",
  "browser.nav.reload": "Recargar",
  "browser.address.label": "Dirección o búsqueda",
  "browser.address.placeholder": "Busca o escribe una dirección",
  "browser.address.go": "Ir",
  "browser.address.blocked": "No se abrió: {text}",
  "browser.deny.unparseable": "No es una dirección web válida.",
  "browser.deny.scheme_not_allowed": "Solo se pueden abrir direcciones web seguras (https).",
  "browser.deny.dangerous_scheme":
    "No se pueden abrir direcciones que ejecutan código o contienen la propia página.",
  "browser.deny.file_blocked": "Aquí no se pueden abrir archivos de este equipo.",
  "browser.deny.credentials_in_url":
    "Se rechazan las direcciones con nombre de usuario o contraseña.",
  "browser.deny.private_network":
    "Aquí no se pueden escribir direcciones de este equipo ni de tu red local. Abre la página de un programa desde el radar de puertos.",
  "browser.deny.bad_port":
    "Ese puerto está bloqueado porque pertenece a un servicio que no es web.",
  "browser.deny.insecure_blocked": "No se abren direcciones http sin cifrar.",
  "browser.deny.site_denied": "Este sitio está en la lista de bloqueados.",
  "browser.deny.dns_private": "Ese nombre apunta a una dirección de este equipo o de tu red local.",
  "browser.deny.port_radar_invalid":
    "La solicitud del radar de puertos no era una página simple de este equipo, así que se ignoró.",
  "browser.deny.unknown": "Se rechazó esa dirección.",
  "browser.zoom.label": "Zoom",
  "browser.zoom.out": "Reducir zoom",
  "browser.zoom.in": "Aumentar zoom",
  "browser.zoom.reset": "Restablecer zoom a {percent}",
  "browser.shields.label": "Bloquear anuncios y rastreadores en {site}",
  "browser.shields.saveFailed": "La opción se aplicó aquí pero no se pudo guardar en Phoenix Core.",
  "browser.shields.blocked":
    "{count, plural, one {# solicitud bloqueada} other {# solicitudes bloqueadas}}",
  "browser.empty": "No hay ninguna pestaña abierta. Escribe una dirección o una búsqueda arriba.",
  "browser.noShell":
    "Esta página es la barra de herramientas del navegador Phoenix. Solo funciona dentro de la aplicación de escritorio de Phoenix.",
  "browser.radar.title": "¿Abrir un programa de este equipo?",
  "browser.radar.body":
    "El radar de puertos pide abrir esta dirección. Es un programa que se ejecuta en este equipo, no un sitio web, y no está cifrada.",
  "browser.radar.url": "Dirección: {url}",
  "browser.radar.open": "Abrir",
  "browser.radar.cancel": "Cancelar",
  "browser.error.action": "El navegador no pudo hacer eso.",
  "browser.profile.label": "Las pestañas nuevas se abren en",
  "browser.profile.private": "Privado (no se guarda nada)",
  "browser.tab.profile": "Perfil: {name}",
  "browser.deny.profile_invalid": "Ese perfil no es válido, así que no se abrió nada.",
  "browser.deny.profile_unsupported":
    "Los perfiles guardados no están disponibles en esta versión del navegador.",
  "browser.deny.profile_busy":
    "Ese perfil se está eliminando o está ocupado. Inténtalo de nuevo en un momento.",
  "browser.deny.profile_failed": "No se pudo abrir el almacenamiento web del perfil.",
  "browser.purge.running": "Borrando los datos web guardados de un perfil eliminado…",
  "browser.purge.failed":
    "Aún no se pudieron borrar los datos web guardados de un perfil eliminado. Phoenix lo intentará de nuevo.",
};
