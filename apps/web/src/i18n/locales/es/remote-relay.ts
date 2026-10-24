// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { remoteRelay as enRemoteRelay } from "../../en/remote-relay";

/** Machine-translated; unreviewed. */
export const remoteRelay: Record<keyof typeof enRemoteRelay, string> = {
  "relay.title": "Relé remoto",
  "relay.intro":
    "Un relé permite que un teléfono emparejado responda a las aprobaciones pendientes de Phoenix cuando no está en su red doméstica. Está desactivado de forma predeterminada y usted elige la dirección del relé. No se envía nada hasta que lo active.",
  "relay.notAvailable":
    "El relé remoto no está disponible: este Phoenix Core no tiene un almacén de secretos del sistema operativo donde guardar la clave del relé.",
  "relay.loadFailed": "No se pudo cargar el estado del relé remoto.",

  "relay.privacy.title": "Qué puede y qué no puede ver el relé",
  "relay.privacy.cannot":
    "No puede leer, cambiar, falsificar ni reproducir nada. Cada mensaje está cifrado de extremo a extremo entre Phoenix y un dispositivo emparejado, y Phoenix firma y comprueba la decisión de un dispositivo antes de que cuente.",
  "relay.privacy.sees":
    "Puede ver el id de ruta aleatorio, a qué dirección va dirigido un mensaje (este equipo o un dispositivo) y el tamaño y la hora de cada mensaje. También puede descartar, retrasar o repetir mensajes, o dejar de funcionar.",
  "relay.privacy.tls":
    "Una conexión segura (https) con el relé oculta esa información de enrutamiento a las personas de la red. La protección de los propios mensajes no depende de ella.",

  "relay.status.title": "Estado",
  "relay.status.off": "Desactivado",
  "relay.status.connected": "Activado y conectado al relé",
  "relay.status.connecting": "Activado, sin conexión con el relé en este momento",
  "relay.status.url": "Dirección del relé",
  "relay.status.route": "Ruta",
  "relay.status.lastError": "Último problema notificado: {message}",

  "relay.enable.label": "Dirección del relé",
  "relay.enable.hint":
    "Use una dirección https:// de un relé que usted gestione o en el que confíe. El http:// simple solo se acepta para este equipo.",
  "relay.enable.note":
    "Al activarlo se crean una nueva ruta aleatoria y una nueva clave de relé para este equipo. La clave privada permanece en el almacén de secretos del sistema operativo y nunca se muestra.",
  "relay.enable.button": "Activar",
  "relay.url.empty": "Introduzca la dirección del relé.",
  "relay.url.tooLong": "La dirección del relé es demasiado larga.",
  "relay.url.notUrl": "Eso no es una dirección web.",
  "relay.url.https": "La dirección del relé debe empezar por https://.",
  "relay.url.credentials":
    "La dirección del relé no puede contener un nombre de usuario, una contraseña, una consulta ni un fragmento.",
  "relay.saved.on": "Relé remoto activado.",
  "relay.saved.off": "Relé remoto desactivado. Se descartaron la ruta y la clave del relé.",

  "relay.disable.button": "Desactivar",
  "relay.disable.ask":
    "¿Desactivar el relé remoto? Esto descarta la ruta y la clave privada del relé de este equipo. Los dispositivos que las fijaron dejan de funcionar y, cuando vuelva a activar el relé, habrá que darles los nuevos datos.",
  "relay.disable.yes": "Sí, desactivar y descartar",
  "relay.disable.no": "Mantener activado",

  "relay.details.show": "Mostrar los datos del relé para un dispositivo",
  "relay.details.hide": "Ocultar los datos",
  "relay.details.title": "Datos que hay que dar a un dispositivo",
  "relay.details.intro":
    "Un dispositivo los fija al emparejarse. El emparejamiento en sí es el emparejamiento del enlace con el teléfono. Phoenix no tiene código ni enlace de emparejamiento para el relé, así que entregue estos valores al dispositivo de una forma en la que confíe.",
  "relay.details.url": "Dirección del relé",
  "relay.details.route": "Id de ruta",
  "relay.details.key": "Clave pública del relé de este equipo",
  "relay.details.warn":
    "El id de ruta es una dirección, no una contraseña. Estos datos se vuelven a ocultar al cerrar este panel, al desactivar el relé o cuando cambia la ruta.",

  "relay.devices.title": "Dispositivos emparejados",
  "relay.devices.none":
    "Todavía no hay ningún dispositivo emparejado. Empareje uno en la sección del enlace con el teléfono.",
  "relay.devices.note":
    "Estos son los dispositivos emparejados mediante el enlace con el teléfono. Si revoca uno allí, el relé lo detiene con su siguiente mensaje.",
  "relay.devices.loadFailed": "No se pudieron cargar los dispositivos emparejados.",
  "relay.devices.unnamed": "Dispositivo sin nombre",
  "relay.devices.fingerprint": "Huella de la clave",
  "relay.devices.revoked": "Revocado el {date}",
  "relay.devices.push": "Enviar aprobaciones a {name}",
  "relay.devices.pushed": "Se enviaron las aprobaciones pendientes a {name}.",
};
