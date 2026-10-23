// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { phone as enphone } from "../../en/phone";

/** Machine-translated; unreviewed (see ../../README.md). */
export const phone: Record<keyof typeof enphone, string> = {
  "phone.title": "Enlace con el teléfono",
  "phone.intro":
    "Vincula un teléfono para que pueda aprobar o rechazar lo que Phoenix te pregunte. Está desactivado hasta que lo actives.",
  "phone.unavailable": "No se pudo cargar la configuración del enlace con el teléfono.",
  "phone.warning.title": "Antes de activarlo",
  "phone.warning.network":
    "Al activarlo se abre un servicio HTTPS independiente al que pueden llegar otros dispositivos de tu red local (no de internet).",
  "phone.warning.pairing":
    "Solo los teléfonos que vincules y luego confirmes aquí pueden aprobar algo. Vincular requiere un código que se muestra en esta pantalla.",
  "phone.warning.trust": "Actívalo solo en redes de confianza, como la de tu casa.",
  "phone.warning.presence":
    "Phoenix no puede comprobar que haya una persona frente a este equipo: cualquier programa de este equipo que tenga el token de sesión de Core también puede vincular teléfonos.",
  "phone.enable.label": "Permitir que los teléfonos de mi red local se conecten",
  "phone.saved.on": "El enlace con el teléfono está activado.",
  "phone.saved.off": "El enlace con el teléfono está desactivado.",
  "phone.saved.verifyOn":
    "Las aprobaciones desde un teléfono ahora piden verificación biométrica o del dispositivo.",
  "phone.saved.verifyOff":
    "Las aprobaciones desde un teléfono ya no piden verificación del dispositivo.",
  "phone.killSwitch":
    "El interruptor de emergencia está activado, así que el servicio del teléfono está cerrado. Vuelve a activar aquí el enlace con el teléfono cuando lo desactives.",
  "phone.lockedOut":
    "La vinculación está bloqueada hasta las {time} porque se introdujeron demasiados códigos incorrectos.",
  "phone.notListening":
    "El enlace con el teléfono está activado, pero el servicio aún no se está ejecutando.",
  "phone.addressChanged":
    "La dirección de red que elegiste ya no está disponible, así que el enlace con el teléfono sigue desactivado. Elige una dirección de nuevo para volver a activarlo.",
  "phone.addressChanged.title": "La dirección de este equipo cambió",
  "phone.addressChanged.mayNotReach":
    "Es posible que un teléfono que ya vinculaste no pueda llegar a este equipo, porque aún recuerda la dirección anterior. No se abrió nada en otra red.",
  "phone.addressChanged.pick": "Dirección de red",
  "phone.addressChanged.use": "Usar esta dirección",
  "phone.addressChanged.none":
    "Ahora mismo no se encontró ninguna dirección privada de la red local. Conéctate a tu red y vuelve, o desactiva el enlace con el teléfono.",
  "phone.addressChanged.off": "Desactivar el enlace con el teléfono",
  "phone.addressChanged.repair":
    "Tras elegir una dirección, muestra un nuevo código de vinculación y vuelve a vincular el teléfono si sigue sin poder conectarse.",
  "phone.saved.address": "Se cambió la dirección del enlace con el teléfono.",
  "phone.port.label": "Puerto",
  "phone.port.save": "Guardar puerto",
  "phone.port.invalid": "Introduce un número entero de 1024 a 65535.",
  "phone.port.note":
    "El enlace con el teléfono escucha en este puerto (de 1024 a 65535; el predeterminado es 47821). Un puerto nuevo se aplica la próxima vez que se abra el enlace; si ahora está activado, se reinicia en el puerto nuevo y cualquier código de vinculación en pantalla deja de funcionar. Los teléfonos que vinculaste antes pueden seguir usando el puerto anterior y tendrás que vincularlos de nuevo.",
  "phone.saved.port": "Puerto del enlace con el teléfono guardado: {port}.",
  "phone.pair.qrLabel": "Código QR con el enlace de vinculación",
  "phone.pair.qrHint":
    "Escanéalo con la aplicación del teléfono que vas a vincular. Contiene el código de arriba, así que muéstralo solo a tu propio teléfono.",
  "phone.pair.qrUnavailable":
    "No se pudo crear un código QR para este enlace; usa el enlace de abajo.",
  "phone.listen.address": "Dirección y puerto",
  "phone.listen.fingerprint": "Huella del certificado (SHA-256)",
  "phone.pair.show": "Mostrar código de vinculación",
  "phone.pair.cancel": "Cancelar código",
  "phone.pair.cancelled": "Código de vinculación cancelado.",
  "phone.pair.expired":
    "El código de vinculación caducó. Muestra uno nuevo para vincular un teléfono.",
  "phone.pair.instruction":
    "En el teléfono, introduce o escanea este código y comprueba que la huella que muestra coincide con la de abajo. Si no coincide, no continúes.",
  "phone.pair.codeLabel": "Código de vinculación",
  "phone.pair.remaining": "Caduca en {time}",
  "phone.pair.fingerprint": "Huella del certificado:",
  "phone.pair.link": "Enlace de vinculación (si el teléfono no puede escanear el código QR):",
  "phone.pair.hiddenActive":
    "Hay un código de vinculación activo hasta las {time}. No se vuelve a mostrar; cancélalo y muestra uno nuevo.",
  "phone.pending.question": '¿Vincular "{name}"?',
  "phone.pending.fingerprint": "Huella de la clave",
  "phone.pending.yes": "Sí, vincular este teléfono",
  "phone.pending.no": "No, rechazar",
  "phone.pending.waiting": "Esperando a que Phoenix pida tu confirmación.",
  "phone.pending.approved": "Teléfono vinculado.",
  "phone.pending.rejected": "Vinculación rechazada.",
  "phone.verify.label": "Exigir verificación biométrica o del dispositivo en las aprobaciones",
  "phone.verify.note":
    "El teléfono informa de si se verificó a la persona (huella, rostro o bloqueo de pantalla). Phoenix no puede comprobar ese informe por sí mismo.",
  "phone.devices.title": "Teléfonos vinculados",
  "phone.devices.none": "No hay teléfonos vinculados.",
  "phone.devices.fingerprint": "Huella de la clave",
  "phone.devices.created": "Vinculado el {date}",
  "phone.devices.lastSeen": "visto por última vez {when}",
  "phone.devices.neverSeen": "nunca visto",
  "phone.devices.revoked": "Revocado el {date}",
  "phone.devices.revoke": "Revocar {name}",
  "phone.devices.revokeAsk": '¿Revocar "{name}"? Ya no podrá aprobar nada.',
  "phone.devices.revokeYes": "Sí, revocar",
  "phone.devices.revokeNo": "Conservar",
  "phone.devices.revokedDone": "Teléfono revocado.",
  "phone.device.unnamed": "Teléfono sin nombre",
};
