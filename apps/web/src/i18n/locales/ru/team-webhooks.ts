// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamWebhooks as enTeamWebhooks } from "../../en/team-webhooks";

/** Machine-translated; unreviewed. */
export const teamWebhooks: Record<keyof typeof enTeamWebhooks, string> = {
  "teamWebhooks.title": "Входящие вебхуки",
  "teamWebhooks.intro":
    "Входящие вебхуки по умолчанию выключены. Источник даёт другому инструменту собственный адрес и секрет; когда инструмент присылает правильно подписанное сообщение, Phoenix превращает его в локальное событие. Ничего никуда не отправляется, а то, что присылает источник, считается недоверенным текстом.",
  "teamWebhooks.notAvailable":
    "Входящие вебхуки недоступны: у этого Phoenix Core нет хранилища секретов операционной системы для секретов источников.",
  "teamWebhooks.loadFailed": "Не удалось загрузить входящие вебхуки.",
  "teamWebhooks.master": "Принимать входящие вебхуки",
  "teamWebhooks.secret.title": "Секрет для {id}",
  "teamWebhooks.secret.warning":
    "Этот секрет показывается только один раз. Скопируйте его сейчас и сохраните в отправляющем инструменте. Phoenix хранит его только в хранилище секретов операционной системы и больше не сможет показать; если вы его потеряете, удалите источник и создайте новый.",
  "teamWebhooks.secret.path": "Адрес для отправки (на этом Core)",
  "teamWebhooks.secret.label": "Секрет подписи",
  "teamWebhooks.secret.copy": "Скопировать секрет",
  "teamWebhooks.secret.copied": "Скопировано в буфер обмена.",
  "teamWebhooks.secret.copyFailed":
    "Phoenix не смог использовать буфер обмена. Выделите секрет выше и скопируйте вручную, прежде чем закрыть.",
  "teamWebhooks.secret.done": "Я сохранил, закрыть",
  "teamWebhooks.sources.title": "Источники",
  "teamWebhooks.sources.none": "Вы ещё не создали ни одного источника вебхуков.",
  "teamWebhooks.row.path": "Адрес: {path}",
  "teamWebhooks.row.types": "Типы событий: {types}",
  "teamWebhooks.row.never": "Пока ничего не получено.",
  "teamWebhooks.row.last": "Последнее принятое: {time}",
  "teamWebhooks.delete.label": "Удалить источник {id}",
  "teamWebhooks.delete.ask":
    "Удалить {id}? Его секрет немедленно перестанет работать, и отправляющий инструмент придётся изменить.",
  "teamWebhooks.create.title": "Создать источник",
  "teamWebhooks.create.id": "Имя источника",
  "teamWebhooks.create.idHint":
    "От 3 до 32 символов: строчные буквы, цифры, - или _, начиная с буквы.",
  "teamWebhooks.create.types": "Типы событий, которые он может отправлять",
  "teamWebhooks.create.typesHint":
    "Разделяйте запятыми, например ci.finished. Каждый тип начинается с одного из: {namespaces}.",
  "teamWebhooks.create.typesTooMany": "Укажите не более {max} типов событий.",
  "teamWebhooks.create.typesInvalid":
    "Тип события — слова в нижнем регистре, соединённые точками, например ci.finished.",
  "teamWebhooks.create.typesNamespace": "Тип события должен начинаться с одного из: {namespaces}.",
  "teamWebhooks.create.limit": "Достигнут предел в {max} источников. Сначала удалите один.",
  "teamWebhooks.create.submit": "Создать источник",
};
