// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamInvite as enTeamInvite } from "../../en/team-invite";

/** Machine-translated; unreviewed. */
export const teamInvite: Record<keyof typeof enTeamInvite, string> = {
  "teamInvite.share.title": "Compartir mi identidad",
  "teamInvite.share.intro":
    "Envía esta invitación a un compañero por chat o correo. Solo contiene tu id de equipo, tu clave pública y el nombre que escribas abajo. No lleva ningún secreto y tu clave privada nunca sale de este equipo.",
  "teamInvite.share.label": "Nombre para la invitación (opcional)",
  "teamInvite.share.invalid": "No se pudo crear una invitación con esta identidad.",
  "teamInvite.share.invite": "Tu invitación",
  "teamInvite.share.copy": "Copiar invitación",
  "teamInvite.share.copied": "Invitación copiada al portapapeles.",
  "teamInvite.share.copyFailed":
    "Phoenix no pudo usar el portapapeles. Selecciona la invitación de arriba y cópiala a mano.",
  "teamInvite.share.fingerprintHint":
    "Dile la huella a tu compañero por voz o en otro chat, para que compruebe que la invitación recibida es la tuya.",
  "teamInvite.fingerprint": "Huella de la clave",
  "teamInvite.checksumNote":
    "El código corto al final de una invitación solo detecta errores de copia. No demuestra quién creó la invitación; solo comparar la huella lo hace.",
  "teamInvite.refusal.empty": "Pega primero una invitación.",
  "teamInvite.refusal.tooLong": "Es demasiado largo para ser una invitación de equipo.",
  "teamInvite.refusal.format": "Esto no es una invitación de equipo de Phoenix.",
  "teamInvite.refusal.version":
    "Esta invitación es de otra versión de Phoenix que esta no puede leer.",
  "teamInvite.refusal.checksum":
    "La invitación se modificó o se copió mal. Pide a tu compañero que la envíe de nuevo.",
  "teamInvite.refusal.content": "La invitación está dañada o tiene un contenido inesperado.",
  "teamInvite.refusal.id": "La invitación tiene un id de equipo no válido.",
  "teamInvite.refusal.key": "La invitación tiene una clave pública no válida.",
  "teamInvite.refusal.label": "La invitación tiene un nombre no válido.",
  "teamInvite.refusal.unsupported": "Este navegador no puede comprobar invitaciones.",
  "teamInvite.refusal.own": "Esa invitación es tu propia identidad.",
  "teamInvite.refusal.duplicate":
    "Ese compañero ya está en tu lista. Quítalo primero para cambiar su clave.",
  "teamInvite.add.title": "Añadir un compañero",
  "teamInvite.add.paste": "Pega la invitación de un compañero",
  "teamInvite.add.preview": "Comprueba estos datos antes de añadir a este compañero.",
  "teamInvite.add.noLabel": "La invitación no tiene nombre; escribe uno para mostrar.",
  "teamInvite.add.theirLabel": "La invitación dice que el nombre es: {label}",
  "teamInvite.add.confirm":
    "He comparado esta huella con mi compañero por voz o en otro chat, y coincide.",
};
