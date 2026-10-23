// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamWebhooks as enTeamWebhooks } from "../../en/team-webhooks";

/** Machine-translated; unreviewed. */
export const teamWebhooks: Record<keyof typeof enTeamWebhooks, string> = {
  "teamWebhooks.title": "Webhooks entrantes",
  "teamWebhooks.intro":
    "Los webhooks entrantes están desactivados por defecto. Una fuente da a otra herramienta su propia dirección y su propio secreto; cuando esa herramienta envía un mensaje correctamente firmado, Phoenix lo convierte en un evento local. No se envía nada a ningún sitio, y lo que envía una fuente se trata como texto no confiable.",
  "teamWebhooks.notAvailable":
    "Los webhooks entrantes no están disponibles: este Phoenix Core no tiene un almacén de secretos del sistema operativo donde guardar los secretos de las fuentes.",
  "teamWebhooks.loadFailed": "No se pudieron cargar los webhooks entrantes.",
  "teamWebhooks.master": "Aceptar webhooks entrantes",
  "teamWebhooks.secret.title": "Secreto de {id}",
  "teamWebhooks.secret.warning":
    "Este secreto se muestra solo una vez. Cópialo ahora y guárdalo en la herramienta que envía. Phoenix lo guarda únicamente en el almacén de secretos del sistema operativo y no puede mostrarlo de nuevo; si lo pierdes, elimina la fuente y crea una nueva.",
  "teamWebhooks.secret.path": "Dirección de envío (en este Core)",
  "teamWebhooks.secret.label": "Secreto de firma",
  "teamWebhooks.secret.copy": "Copiar secreto",
  "teamWebhooks.secret.copied": "Copiado al portapapeles.",
  "teamWebhooks.secret.copyFailed":
    "Phoenix no pudo usar el portapapeles. Selecciona el secreto de arriba y cópialo a mano antes de cerrar.",
  "teamWebhooks.secret.done": "Ya lo guardé, cerrar",
  "teamWebhooks.sources.title": "Fuentes",
  "teamWebhooks.sources.none": "Aún no has creado ninguna fuente de webhook.",
  "teamWebhooks.row.path": "Dirección: {path}",
  "teamWebhooks.row.types": "Tipos de evento: {types}",
  "teamWebhooks.row.never": "Todavía no se ha recibido nada.",
  "teamWebhooks.row.last": "Último aceptado: {time}",
  "teamWebhooks.delete.label": "Eliminar la fuente {id}",
  "teamWebhooks.delete.ask":
    "¿Eliminar {id}? Su secreto deja de funcionar de inmediato y hay que cambiar la herramienta que envía.",
  "teamWebhooks.create.title": "Crear una fuente",
  "teamWebhooks.create.id": "Nombre de la fuente",
  "teamWebhooks.create.idHint":
    "De 3 a 32 caracteres: letras minúsculas, dígitos, - o _, empezando por una letra.",
  "teamWebhooks.create.types": "Tipos de evento que puede enviar",
  "teamWebhooks.create.typesHint":
    "Sepáralos con comas, por ejemplo ci.finished. Cada tipo empieza por uno de: {namespaces}.",
  "teamWebhooks.create.typesTooMany": "Indica como máximo {max} tipos de evento.",
  "teamWebhooks.create.typesInvalid":
    "Un tipo de evento son palabras en minúsculas unidas por puntos, como ci.finished.",
  "teamWebhooks.create.typesNamespace": "Un tipo de evento debe empezar por uno de: {namespaces}.",
  "teamWebhooks.create.limit": "Has llegado al límite de {max} fuentes. Elimina una primero.",
  "teamWebhooks.create.submit": "Crear fuente",
};
