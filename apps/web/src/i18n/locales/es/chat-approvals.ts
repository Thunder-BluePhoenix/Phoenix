// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { chatApprovals as enChatApprovals } from "../../en/chat-approvals";

/** Machine-translated; unreviewed. */
export const chatApprovals: Record<keyof typeof enChatApprovals, string> = {
  "chatApprovals.title": "Aprobaciones por chat",
  "chatApprovals.notAvailable":
    "Las aprobaciones por chat no están disponibles en este Phoenix Core.",
  "chatApprovals.intro":
    "Responde a una aprobación pendiente de un agente o de Phoenix desde Slack o Discord, y recibe avisos en Teams. Todo está desactivado hasta que lo actives aquí, por proveedor y por proyecto.",
  "chatApprovals.limits":
    "Nunca se ha usado con un espacio real de Slack, Discord o Teams: el código solo se ha probado con devoluciones de llamada simuladas. Teams es solo de aviso (un enlace a Phoenix, nunca un botón Permitir). Una pulsación se comprueba con la firma del proveedor y tu lista de aprobadores, y la decisión queda auditada.",
  "chatApprovals.noDm":
    "Los resúmenes y avisos van solo al canal indicado abajo. Los mensajes directos a una persona no están implementados.",
  "chatApprovals.capabilityOff":
    "La capacidad Aprobaciones por chat está desactivada, así que no se envía nada.",
  "chatApprovals.enable": "Activar la capacidad",
  "chatApprovals.ready": "Listo: este proveedor puede publicar tarjetas.",
  "chatApprovals.notReady":
    "No está listo: debe estar activado, con un id de espacio, un id de canal y al menos un aprobador.",
  "chatApprovals.teamsNote":
    "Teams es solo de aviso. Su dirección de webhook y su clave de enlace se guardan más abajo.",
  "chatApprovals.save": "Guardar aprobaciones por chat",
  "chatApprovals.saved": "Guardado.",
  "chatApprovals.provider.slack": "Slack",
  "chatApprovals.provider.discord": "Discord",
  "chatApprovals.provider.teams": "Microsoft Teams",
  "chatApprovals.enabledNamed": "Activar {name}",
  "chatApprovals.notifyNamed": "Enviar un aviso genérico en {name}",
  "chatApprovals.digestNamed": "Incluir {name} en los resúmenes",
  "chatApprovals.notify": "Avisar (sin detalles) de solicitudes no activadas",
  "chatApprovals.digest.send": "Recibir el resumen",
  "chatApprovals.workspace.slack": "Id del espacio de Slack (equipo)",
  "chatApprovals.workspace.discord": "Id del servidor de Discord (guild)",
  "chatApprovals.channel.slack": "Id del canal de Slack",
  "chatApprovals.channel.discord": "Id del canal de Discord",
  "chatApprovals.approvers.label": "Ids de usuario de {name} que pueden decidir (uno por línea)",
  "chatApprovals.approvers.hint":
    "Solo letras y dígitos, hasta 24 caracteres cada uno, como máximo 20. Una lista vacía significa que nadie puede decidir.",
  "chatApprovals.projects.title": "Proyectos permitidos",
  "chatApprovals.projects.hint":
    "Solo las aprobaciones de agente de estos proyectos pueden responderse desde el chat. Vacío: ninguno.",
  "chatApprovals.projects.label": "Nombres de proyecto (uno por línea)",
  "chatApprovals.digest.title": "Resumen programado",
  "chatApprovals.digest.intro":
    "Desactivado por defecto. Envía recuentos e ids cortos de aprobación al canal de arriba, solo a los proveedores que reciben el resumen, nunca en horas de silencio y nunca si no pasó nada.",
  "chatApprovals.digest.enabled": "Enviar un resumen programado",
  "chatApprovals.digest.interval": "Minutos entre resúmenes",
  "chatApprovals.digest.hint": "De {min} (una hora) a {max} minutos (una semana).",
  "chatApprovals.cred.title": "Credenciales",
  "chatApprovals.cred.writeOnly":
    "Solo escritura. Lo que escribes se envía al almacén de credenciales de Core y se borra de esta página al instante. Los valores guardados no se vuelven a mostrar.",
  "chatApprovals.cred.save": "Guardar",
  "chatApprovals.cred.stored": "Guardado",
  "chatApprovals.cred.notStored": "No guardado",
  "chatApprovals.cred.remove": "Quitar",
  "chatApprovals.cred.removeNamed": "Quitar {name} guardado",
  "chatApprovals.field.slackBot": "Token del bot de Slack",
  "chatApprovals.field.slackSigning": "Secreto de firma de Slack",
  "chatApprovals.field.discordBot": "Token del bot de Discord",
  "chatApprovals.field.discordKey": "Clave pública de la aplicación de Discord",
  "chatApprovals.field.teamsWebhook": "Dirección del webhook de Teams",
  "chatApprovals.field.teamsKey": "Clave de enlace de Teams",
  "chatApprovals.error.ids":
    "Los ids de espacio y de canal solo llevan letras y dígitos, hasta 24 caracteres.",
  "chatApprovals.error.approvers":
    "Los ids de aprobador solo llevan letras y dígitos, hasta 24 caracteres cada uno, como máximo 20.",
  "chatApprovals.error.projects":
    "Los nombres de proyecto deben tener de 1 a 120 caracteres visibles, como máximo 200 proyectos.",
  "chatApprovals.error.interval":
    "El intervalo del resumen debe ser un número entero de 60 a 10080 minutos.",
  "chatApprovals.error.save": "No se pudo guardar el ajuste de aprobaciones por chat.",
  "chatApprovals.error.capability": "No se pudo cambiar la capacidad Aprobaciones por chat.",
  "chatApprovals.error.unavailable":
    "Este Phoenix Core no tiene almacén de credenciales del sistema, así que no se puede conservar una credencial.",
  "chatApprovals.error.cred": "La credencial no se guardó o no se quitó.",
  "chatApprovals.error.credShape":
    "Ese valor no parece correcto para este campo, así que no se envió. Revísalo e inténtalo de nuevo.",
};
