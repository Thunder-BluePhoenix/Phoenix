// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamStatus as enTeamStatus } from "../../en/team-status";

/** Machine-translated; unreviewed. */
export const teamStatus: Record<keyof typeof enTeamStatus, string> = {
  "teamStatus.title": "Presencia del equipo",
  "teamStatus.intro":
    "La presencia del equipo está desactivada por defecto. Al activarla, Phoenix envía solo los tipos de estado que marques (desplegando, ejecutando un agente, en una reunión) como una trama cifrada a los compañeros que añadiste, y nunca nombra un repositorio, una rama ni una persona.",
  "teamStatus.notAvailable":
    "La presencia del equipo no está disponible: este Phoenix Core no tiene un almacén de secretos del sistema operativo donde guardar tu clave.",
  "teamStatus.loadFailed": "No se pudo cargar la presencia del equipo.",
  "teamStatus.listSeparator": ", ",
  "teamStatus.kind.deploying": "desplegando",
  "teamStatus.kind.agentRun": "ejecutando un agente",
  "teamStatus.kind.meeting": "en una reunión",
  "teamStatus.relay.label": "Dirección del relé",
  "teamStatus.route.label": "Ruta (opcional)",
  "teamStatus.route.hint":
    "Deja la ruta vacía para crear un equipo nuevo. Pega aquí una ruta para unirte al mismo equipo que un compañero.",
  "teamStatus.route.shown": "Ruta del relé",
  "teamStatus.turnOn": "Activar",
  "teamStatus.resume": "Reactivar",
  "teamStatus.pause": "Pausar",
  "teamStatus.leave": "Salir del equipo",
  "teamStatus.leave.ask": "¿Salir del equipo y olvidar a todos?",
  "teamStatus.state.line": "Conexión: {state}",
  "teamStatus.state.connected": "conectado",
  "teamStatus.state.connecting": "conectando",
  "teamStatus.state.paused": "en pausa",
  "teamStatus.lastError": "Último error: {error}",
  "teamStatus.self.id": "Tu id de equipo",
  "teamStatus.self.publicKey": "Tu clave pública",
  "teamStatus.self.hint":
    "Entrega ambas a un compañero para que pueda añadirte. Tu clave privada nunca sale de este ordenador.",
  "teamStatus.sharing.title": "Lo que comparto",
  "teamStatus.sharing.master": "Compartir mi estado con mi equipo",
  "teamStatus.sharing.deploying": "Desplegando",
  "teamStatus.sharing.agentRun": "Ejecutando un agente durante mucho tiempo",
  "teamStatus.sharing.meeting": "En una reunión",
  "teamStatus.outgoing.now": "Los compañeros ven ahora: {kinds}.",
  "teamStatus.outgoing.none": "Los compañeros no ven nada tuyo ahora.",
  "teamStatus.members.title": "Compañeros",
  "teamStatus.members.none": "Aún no has añadido compañeros.",
  "teamStatus.members.removeLabel": "Quitar a {label}",
  "teamStatus.members.id": "Id de equipo del compañero",
  "teamStatus.members.label": "Nombre que mostrar",
  "teamStatus.members.add": "Añadir compañero",
  "teamStatus.presence.title": "Quién está por aquí",
  "teamStatus.presence.none": "No hay compañeros que mostrar.",
  "teamStatus.presence.nothing": "nada compartido",
};
