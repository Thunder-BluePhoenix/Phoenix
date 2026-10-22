// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mcp as enmcp } from "../../en/mcp";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mcp: Record<keyof typeof enmcp, string> = {
  "mcp.title": "Servidor MCP de Phoenix",
  "mcp.intro":
    "Permite que agentes de código y otros clientes MCP de este equipo lean contexto de Phoenix y te pidan aprobación. Está desactivado hasta que lo actives, y cada cliente no recibe nada hasta que se lo concedas.",
  "mcp.unavailable": "No se pudieron cargar los ajustes del servidor MCP.",
  "mcp.demoUnavailable": "El servidor MCP no está disponible en el modo de demostración.",
  "mcp.warning.title": "Antes de activarlo",
  "mcp.warning.local":
    "Abre un servicio de escucha aparte solo en este equipo (127.0.0.1). Otros equipos y páginas web no pueden acceder a él.",
  "mcp.warning.token":
    "Cada cliente tiene su propio token, que se muestra una sola vez. Cualquier programa que tenga un token puede usar lo que le concediste a ese cliente.",
  "mcp.warning.untrusted":
    "Lo que devuelve Phoenix está marcado como datos no confiables, pero un modelo que lo lea aún puede ser engañado por el texto que contiene. Concede solo lo necesario.",
  "mcp.warning.approval":
    "Una aprobación que pide un cliente aparece junto con tus otras aprobaciones de agentes. Solo tú, aquí o en un teléfono vinculado, puedes responderla.",
  "mcp.enable.label": "Permitir que los clientes MCP de este equipo se conecten",
  "mcp.saved.on": "El servidor MCP está activado.",
  "mcp.saved.off": "El servidor MCP está desactivado.",
  "mcp.port.label": "Puerto",
  "mcp.port.save": "Guardar puerto",
  "mcp.port.saved": "Puerto guardado.",
  "mcp.killSwitch":
    "La parada de emergencia está activa: el servidor MCP está cerrado. Vuelve a activarlo aquí cuando la desactives.",
  "mcp.notListening":
    "El servidor MCP está activado pero no escucha. Comprueba que el puerto esté libre.",
  "mcp.listening.url": "Dirección",
  "mcp.new.title": "Añadir un cliente",
  "mcp.new.name": "Nombre del cliente",
  "mcp.new.create": "Crear cliente",
  "mcp.new.created": "Cliente creado. Aún no tiene permisos.",
  "mcp.token.title": "Copia este token ahora",
  "mcp.token.note":
    "Solo se muestra una vez y Phoenix guarda únicamente una huella. Ponlo en el entorno del cliente como PHOENIX_MCP_TOKEN, nunca en una línea de comandos.",
  "mcp.token.label": "Token del cliente",
  "mcp.token.copy": "Copiar token",
  "mcp.token.copied": "Token copiado.",
  "mcp.token.copyFailed": "No se pudo copiar. Selecciona el token y cópialo a mano.",
  "mcp.token.done": "Ya lo guardé",
  "mcp.clients.title": "Clientes",
  "mcp.clients.none": "Aún no hay clientes.",
  "mcp.client.created": "Creado el {date}",
  "mcp.client.id": "ID de cliente {id} (aparece en las tarjetas de aprobación de este cliente)",
  "mcp.client.lastUsed": "Último uso {when}",
  "mcp.client.neverUsed": "Nunca usado",
  "mcp.client.revokedOn": "Revocado el {date}",
  "mcp.client.noGrants": "Sin permisos: este cliente puede conectarse, pero se le rechaza todo.",
  "mcp.grants.title": "Qué puede hacer {name}",
  "mcp.grants.tools": "Herramientas de lectura",
  "mcp.grants.tool.phoenix_activity": "Sesiones de agentes recientes",
  "mcp.grants.tool.phoenix_meetings": "Decisiones y resúmenes de reuniones",
  "mcp.grants.tool.phoenix_graph_query": "Preguntas al grafo de conocimiento",
  "mcp.grants.tool.phoenix_ci_git_state": "Estado de Git y de la CI",
  "mcp.grants.tool.phoenix_memory_search": "Búsqueda en la memoria",
  "mcp.grants.actions": "Acciones",
  "mcp.grants.requestApproval": "Pedirme aprobación",
  "mcp.grants.notify": "Informar a Fawkes de su estado (trabajando, esperando, terminado)",
  "mcp.grants.memory": "Memoria que puede leer",
  "mcp.grants.memory.note":
    "La búsqueda en memoria, el grafo y las reuniones solo ven los ámbitos de abajo, nunca todo lo que tú puedes ver.",
  "mcp.grants.memory.none": "No se ha concedido ningún ámbito de memoria.",
  "mcp.grants.memory.scope": "Ámbito",
  "mcp.grants.memory.sensitivity": "Sensibilidad máxima",
  "mcp.grants.memory.add": "Añadir ámbito",
  "mcp.grants.memory.remove": "Quitar el ámbito {scope}",
  "mcp.grants.memory.invalid":
    "Un ámbito es *, global, o repo:, path: o meeting: seguido de texto.",
  "mcp.sensitivity.public": "público",
  "mcp.sensitivity.internal": "interno",
  "mcp.sensitivity.sensitive": "sensible (reuniones)",
  "mcp.grants.save": "Guardar permisos",
  "mcp.grants.saved": "Permisos guardados.",
  "mcp.revoke": "Revocar {name}",
  "mcp.revoke.ask": "¿Revocar {name}? Se le rechaza de inmediato, incluso en mitad de una llamada.",
  "mcp.revoke.yes": "Sí, revocar",
  "mcp.revoke.no": "Mantener",
  "mcp.revoke.done": "Cliente revocado.",
};
