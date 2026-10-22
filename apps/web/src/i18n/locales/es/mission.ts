// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mission as enmission } from "../../en/mission";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mission: Record<keyof typeof enmission, string> = {
  "mission.title": "Control de misión",
  "mission.nav": "Misión",
  "mission.note":
    "Los tokens y el costo son lo que informan los propios agentes. No se verifican con la factura del proveedor.",
  "mission.sourceMissing":
    "No se pudieron leer algunas sesiones de agentes en este momento (la función de agentes está desactivada o no responde), así que puede que falten sesiones en el tablero.",
  "mission.refresh": "Actualizar",
  "mission.loadFailed": "No se pudo cargar el control de misión.",

  "mission.filter.search": "Buscar sesiones",
  "mission.filter.searchPlaceholder": "Agente, proyecto o id de sesión",
  "mission.filter.agent": "Agente",
  "mission.filter.project": "Proyecto",
  "mission.filter.state": "Estado",
  "mission.filter.all": "Todos",
  "mission.filter.clear": "Borrar filtros",

  "mission.state.working": "Trabajando",
  "mission.state.waiting": "Esperándote",
  "mission.state.finished": "Terminada",
  "mission.state.stuck": "Atascada",
  "mission.reason.permission": "Necesita tu permiso",
  "mission.reason.input": "Tiene una pregunta para ti",
  "mission.reason.idle": "Inactiva en su prompt",
  "mission.stuck.noReport": "Sin informe durante más tiempo del límite de bloqueo",
  "mission.stuck.safetyStall": "Marcada como bloqueada por la red de seguridad",

  "mission.board.title": "Sesiones",
  "mission.board.empty": "No hay sesiones de agentes que mostrar.",
  "mission.board.noMatch": "Ninguna sesión coincide con los filtros.",
  "mission.column.count": "{count, plural, one {# sesión} other {# sesiones}}",
  "mission.column.empty": "Ninguna",

  "mission.card.open": "Detalles",
  "mission.card.focus": "Ir al terminal",
  "mission.card.focused": "La ventana del terminal se ha traído al frente.",
  "mission.card.unnamedProject": "proyecto desconocido",
  "mission.card.tokens": "{input} de entrada, {output} de salida",
  "mission.card.noTokens": "No se informaron recuentos de tokens",
  "mission.card.cost": "Costo {cost}",
  "mission.card.costPartial": "Costo de {cost} o más (parte del uso no tiene costo conocido)",
  "mission.card.costUnknown": "Costo desconocido",
  "mission.card.lastSeen": "Último aviso {ago}",
  "mission.card.steps": "{count, plural, one {# paso} other {# pasos}}",

  "mission.totals.title": "Tokens y costo",
  "mission.totals.window": "Últimos {days, plural, one {# día} other {# días}}",
  "mission.totals.input": "Tokens de entrada",
  "mission.totals.output": "Tokens de salida",
  "mission.totals.cost": "Costo",
  "mission.totals.unknown": "desconocido",
  "mission.totals.partial": "{cost} o más",
  "mission.totals.unpriced":
    "No hay precio definido para: {models}. Su costo es desconocido, no cero. Añade un precio abajo para ver un costo.",
  "mission.totals.empty": "Ningún agente ha informado de tokens ni de costo en este periodo.",

  "mission.by.day": "Por día",
  "mission.by.agent": "Por agente",
  "mission.by.project": "Por proyecto",
  "mission.by.session": "Por sesión",
  "mission.col.day": "Día",
  "mission.col.agent": "Agente",
  "mission.col.project": "Proyecto",
  "mission.col.session": "Sesión",
  "mission.col.input": "Entrada",
  "mission.col.output": "Salida",
  "mission.col.cost": "Costo",

  "mission.budgets.title": "Presupuestos",
  "mission.budgets.note":
    "Se envía una alerta antes de llegar a un límite, al {thresholds} de este, una vez por presupuesto al día. Los presupuestos de costo solo cuentan el uso con costo conocido.",
  "mission.budgets.none": "Aún no hay presupuestos.",
  "mission.budgets.line": "{scope}, {metric}{agent}: {used} de {limit} ({pct}%)",
  "mission.budgets.lineAtLeast":
    "{scope}, {metric}{agent}: al menos {used} de {limit} ({pct}%); parte del uso no tiene costo conocido y no se cuenta",
  "mission.ingest.notice":
    "Hoy Core recortó {clamped, plural, one {# informe} other {# informes}} a un límite y rechazó {refused, plural, one {# informe} other {# informes}}, así que las cifras de abajo pueden ser menores que lo que informaron los agentes. Agentes: {agents}.",
  "mission.budgets.lineUnknown": "{scope}, {metric}{agent}: uso desconocido, límite {limit}",
  "mission.budgets.agentSuffix": " ({agent})",
  "mission.budgets.scope": "Se aplica a",
  "mission.budgets.scope.daily": "Todo el día",
  "mission.budgets.scope.session": "Cada sesión",
  "mission.budgets.metric": "Medido en",
  "mission.budgets.metric.tokens": "Tokens",
  "mission.budgets.metric.cost": "Dólares estadounidenses",
  "mission.budgets.limit": "Límite",
  "mission.budgets.agent": "Agente (opcional)",
  "mission.budgets.add": "Añadir presupuesto",
  "mission.budgets.remove": "Quitar el presupuesto {id}",
  "mission.budgets.invalid": "Introduce un límite mayor que cero.",

  "mission.prices.title": "Precios",
  "mission.prices.note":
    "Phoenix no incluye precios. Introduce los tuyos, en dólares estadounidenses por millón de tokens, con el nombre de modelo que informa el agente.",
  "mission.prices.aiNote": "Modelos que también tienen un precio en los ajustes de IA: {models}.",
  "mission.prices.none": "Aún no hay precios.",
  "mission.prices.model": "Modelo",
  "mission.prices.input": "Entrada por millón de tokens",
  "mission.prices.output": "Salida por millón de tokens",
  "mission.prices.line": "{model}: {input} de entrada, {output} de salida por millón de tokens",
  "mission.prices.add": "Guardar precio",
  "mission.prices.remove": "Quitar el precio de {model}",
  "mission.prices.invalid": "Introduce un nombre de modelo y dos precios de cero o más.",

  "mission.stall.label": "Marcar como atascada una sesión activa tras tantos minutos sin informe",
  "mission.stall.save": "Guardar",

  "mission.saved": "Guardado",
  "mission.delete.button": "Borrar todo el uso de agentes",
  "mission.delete.warning":
    "¿Borrar todas las cifras de tokens y costo almacenadas? Los presupuestos y los precios se conservan. Esta acción no se puede deshacer.",
  "mission.delete.confirm": "Sí, borrar",
  "mission.delete.done": "{count, plural, one {# registro borrado} other {# registros borrados}}",
};
