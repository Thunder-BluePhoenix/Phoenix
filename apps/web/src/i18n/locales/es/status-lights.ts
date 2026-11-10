// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { statusLights as enStatusLights } from "../../en/status-lights";

/** Machine-translated; unreviewed. */
export const statusLights: Record<keyof typeof enStatusLights, string> = {
  "statusLights.limits":
    "Solo se envían colores fijos, nunca texto. Las credenciales (una clave de aplicación de Hue, un token de Luxafor) son de solo escritura: una vez guardadas, no se vuelven a mostrar. Los nombres y los identificadores que informa una luz se muestran como texto sin formato.",
  "statusLights.line.luxafor": "App de Luxafor en {address}",
  "statusLights.line.hue": "Luz Hue en el puente {bridge}",

  "statusLights.error.unavailable":
    "Este Phoenix Core no tiene almacén de credenciales del sistema operativo, por lo que no se puede conservar una credencial.",
  "statusLights.error.save":
    "No se pudo guardar la lista de luces. Revisa el nombre y la dirección.",
  "statusLights.error.capability": "No se pudo cambiar el ajuste Luces de estado.",
  "statusLights.error.hueName":
    "Dale al puente un nombre con letras, dígitos y . _ : - (hasta 160 caracteres).",
  "statusLights.error.hueInspect":
    "El puente no respondió en esa dirección. Usa su dirección IPv4 en tu propia red.",
  "statusLights.error.huePair":
    "Error al emparejar. Pulsa el botón redondo de enlace del puente y vuelve a intentarlo.",
  "statusLights.error.hueRemove": "No se pudo quitar el puente.",
  "statusLights.error.hueLights": "No se pudieron listar las luces de este puente.",
  "statusLights.error.luxaforToken":
    "No se guardó el token. Necesita de 1 a 128 caracteres imprimibles sin espacios.",
  "statusLights.error.lifx":
    "La detección de LIFX no terminó. Espera unos segundos y vuelve a intentarlo.",
  "statusLights.error.quietInvalid":
    "Introduce dos horas y una zona horaria real, como Europe/Paris.",

  "statusLights.hue.title": "Philips Hue",
  "statusLights.hue.notAvailable":
    "Hue no está disponible: este Phoenix Core no tiene almacén de credenciales del sistema operativo.",
  "statusLights.hue.loadFailed": "No se pudieron cargar los puentes Hue.",
  "statusLights.hue.intro":
    "Un puente emparejado solo es de confianza mientras presente el certificado cuya huella SHA-256 confirmaste. Su clave de aplicación se guarda en el almacén de credenciales de tu sistema operativo y nunca se muestra.",
  "statusLights.hue.empty": "Ningún puente emparejado.",
  "statusLights.hue.bridgeLine": "en {address}:{port}",
  "statusLights.hue.fingerprint": "Huella SHA-256:",
  "statusLights.hue.find": "Mostrar luces",
  "statusLights.hue.findNamed": "Mostrar las luces del puente {name}",
  "statusLights.hue.remove": "Quitar puente",
  "statusLights.hue.removeNamed": "Quitar el puente {name}",
  "statusLights.hue.removeNote":
    "Quitar un puente elimina su clave almacenada. Las luces que lo usan dejan de contactarse.",
  "statusLights.hue.noLights": "Este puente no informó de ninguna luz.",
  "statusLights.hue.alreadyAdded": "Añadida",
  "statusLights.hue.add": "Añadir",
  "statusLights.hue.addNamed": "Añadir la luz Hue {name}",
  "statusLights.hue.pairTitle": "Emparejar un puente",
  "statusLights.hue.name": "Nombre de este puente",
  "statusLights.hue.address": "Dirección del puente en tu red (por ejemplo 192.168.1.2)",
  "statusLights.hue.lookup": "Leer el certificado del puente",
  "statusLights.hue.confirmGroup": "Confirmar el certificado del puente",
  "statusLights.hue.found": "Un puente respondió en {address}:{port}.",
  "statusLights.hue.certName": "Sujeto del certificado: {name}",
  "statusLights.hue.linkStep":
    "Pulsa ahora el botón redondo de enlace de la parte superior del puente y confirma abajo. El emparejamiento se rechaza si el botón no se pulsó en los últimos 30 segundos aproximadamente.",
  "statusLights.hue.confirm":
    "He comparado esta huella con la de mi puente y confío en este puente.",
  "statusLights.hue.pair": "Emparejar y fijar esta huella",
  "statusLights.hue.cancel": "Cancelar",

  "statusLights.luxafor.title": "Luxafor",
  "statusLights.luxafor.intro":
    "Phoenix solo se comunica con el webhook local de la app de Luxafor, mediante HTTP simple en tu propia red. La app responde que todo fue bien sea cual sea el token, así que un token guardado no demuestra que la luz cambiara.",
  "statusLights.luxafor.name": "Nombre de esta luz Luxafor",
  "statusLights.luxafor.address": "Dirección del ordenador que ejecuta la app de Luxafor",
  "statusLights.luxafor.add": "Añadir luz Luxafor",
  "statusLights.luxafor.token": "Token del webhook",
  "statusLights.luxafor.tokenNamed": "Token del webhook de {name}",
  "statusLights.luxafor.save": "Definir o reemplazar el token",
  "statusLights.luxafor.saved": "Token guardado.",
  "statusLights.luxafor.writeOnly":
    "El token no se vuelve a mostrar. Para borrarlo, quita esta luz.",

  "statusLights.lifx.title": "LIFX",
  "statusLights.lifx.intro":
    "La detección envía una difusión en tu red y lista las luces que responden. No se añade nada y no se envía ningún color hasta que actives una luz.",
  "statusLights.lifx.discover": "Buscar luces LIFX",
  "statusLights.lifx.none": "Ninguna luz LIFX respondió.",
  "statusLights.lifx.line": "Luz LIFX {serial} en {address}",
  "statusLights.lifx.added": "Añadida",
  "statusLights.lifx.enable": "Añadir esta luz",
  "statusLights.lifx.enableNamed": "Añadir la luz LIFX {serial}",

  "statusLights.quiet.title": "Horas de silencio",
  "statusLights.quiet.intro":
    "Las luces permanecen apagadas entre estas horas, en la zona horaria que elijas.",
  "statusLights.quiet.off": "Las horas de silencio están desactivadas.",
  "statusLights.quiet.on": "Las luces están apagadas de {start} a {end} ({timezone}).",
  "statusLights.quiet.start": "Desde",
  "statusLights.quiet.end": "Hasta",
  "statusLights.quiet.timezone": "Zona horaria",
  "statusLights.quiet.save": "Guardar horas de silencio",
  "statusLights.quiet.clear": "Desactivar las horas de silencio",
};
