// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mcp as enmcp } from "../../en/mcp";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mcp: Record<keyof typeof enmcp, string> = {
  "mcp.title": "MCP-сервер Phoenix",
  "mcp.intro":
    "Позволяет кодовым агентам и другим MCP-клиентам на этом компьютере читать контекст Phoenix и запрашивать у вас одобрение. Пока вы не включите, он выключен, а каждый клиент ничего не получает, пока вы это не разрешите.",
  "mcp.unavailable": "Не удалось загрузить настройки MCP-сервера.",
  "mcp.demoUnavailable": "MCP-сервер недоступен в демонстрационном режиме.",
  "mcp.warning.title": "Перед включением",
  "mcp.warning.local":
    "Открывается отдельный слушатель только на этом компьютере (127.0.0.1). Другие компьютеры и веб-страницы до него не доберутся.",
  "mcp.warning.token":
    "У каждого клиента свой токен, он показывается один раз. Любая программа, у которой есть токен, может использовать всё, что вы разрешили этому клиенту.",
  "mcp.warning.untrusted":
    "То, что возвращает Phoenix, помечено как недоверенные данные, но модель, читающая их, всё равно может быть введена в заблуждение текстом внутри. Разрешайте только необходимое.",
  "mcp.warning.approval":
    "Одобрение, запрошенное клиентом, появляется вместе с другими одобрениями агентов. Ответить на него можете только вы, здесь или на связанном телефоне.",
  "mcp.enable.label": "Разрешить MCP-клиентам на этом компьютере подключаться",
  "mcp.saved.on": "MCP-сервер включён.",
  "mcp.saved.off": "MCP-сервер выключен.",
  "mcp.port.label": "Порт",
  "mcp.port.save": "Сохранить порт",
  "mcp.port.saved": "Порт сохранён.",
  "mcp.killSwitch":
    "Включена аварийная остановка: MCP-сервер закрыт. Включите его здесь снова, когда снимете аварийную остановку.",
  "mcp.notListening": "MCP-сервер включён, но не слушает. Проверьте, что порт свободен.",
  "mcp.listening.url": "Адрес",
  "mcp.new.title": "Добавить клиента",
  "mcp.new.name": "Имя клиента",
  "mcp.new.create": "Создать клиента",
  "mcp.new.created": "Клиент создан. У него пока нет разрешений.",
  "mcp.token.title": "Скопируйте этот токен сейчас",
  "mcp.token.note":
    "Он показывается только один раз, а Phoenix хранит лишь его отпечаток. Поместите его в окружение клиента как PHOENIX_MCP_TOKEN, но никогда не в командную строку.",
  "mcp.token.label": "Токен клиента",
  "mcp.token.copy": "Скопировать токен",
  "mcp.token.copied": "Токен скопирован.",
  "mcp.token.copyFailed": "Не удалось скопировать. Выделите токен и скопируйте вручную.",
  "mcp.token.done": "Я сохранил его",
  "mcp.clients.title": "Клиенты",
  "mcp.clients.none": "Клиентов пока нет.",
  "mcp.client.created": "Создан {date}",
  "mcp.client.id": "ID клиента {id} (показывается на карточках подтверждения этого клиента)",
  "mcp.client.lastUsed": "Последнее использование {when}",
  "mcp.client.neverUsed": "Не использовался",
  "mcp.client.revokedOn": "Отозван {date}",
  "mcp.client.noGrants": "Нет разрешений: клиент может подключиться, но ему отказывают во всём.",
  "mcp.grants.title": "Что может {name}",
  "mcp.grants.tools": "Инструменты чтения",
  "mcp.grants.tool.phoenix_activity": "Недавние сессии агентов",
  "mcp.grants.tool.phoenix_meetings": "Решения и сводки встреч",
  "mcp.grants.tool.phoenix_graph_query": "Вопросы к графу знаний",
  "mcp.grants.tool.phoenix_ci_git_state": "Состояние Git и CI",
  "mcp.grants.tool.phoenix_memory_search": "Поиск по памяти",
  "mcp.grants.actions": "Действия",
  "mcp.grants.requestApproval": "Запрашивать у меня одобрение",
  "mcp.grants.notify": "Сообщать Fawkes своё состояние (работает, ждёт, готово)",
  "mcp.grants.memory": "Память, которую можно читать",
  "mcp.grants.memory.note":
    "Поиск по памяти, граф и встречи видят только области ниже, но не всё, что видите вы.",
  "mcp.grants.memory.none": "Ни одна область памяти не разрешена.",
  "mcp.grants.memory.scope": "Область",
  "mcp.grants.memory.sensitivity": "Максимальная чувствительность",
  "mcp.grants.memory.add": "Добавить область",
  "mcp.grants.memory.remove": "Удалить область {scope}",
  "mcp.grants.memory.invalid":
    "Область — это *, global либо repo:, path: или meeting: с текстом после.",
  "mcp.sensitivity.public": "публичная",
  "mcp.sensitivity.internal": "внутренняя",
  "mcp.sensitivity.sensitive": "чувствительная (встречи)",
  "mcp.grants.save": "Сохранить разрешения",
  "mcp.grants.saved": "Разрешения сохранены.",
  "mcp.revoke": "Отозвать {name}",
  "mcp.revoke.ask": "Отозвать {name}? Ему сразу откажут, даже посреди вызова.",
  "mcp.revoke.yes": "Да, отозвать",
  "mcp.revoke.no": "Оставить",
  "mcp.revoke.done": "Клиент отозван.",
};
