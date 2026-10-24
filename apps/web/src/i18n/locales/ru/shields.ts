// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shields as enShields } from "../../en/shields";

/** Machine-translated; unreviewed. */
export const shields: Record<keyof typeof enShields, string> = {
  "shields.title": "Блокировка рекламы и трекеров",
  "shields.intro":
    "Эти настройки будут действовать в браузере Phoenix, когда он выйдет. У Phoenix пока нет окна браузера, поэтому сегодня ничто не блокируется ни на одной странице. Так можно блокировать только сетевые запросы: скрытие элементов страницы не поддерживается, и это не копия защиты какого-либо другого браузера.",
  "shields.unavailable": "Настройки блокировки рекламы и трекеров недоступны в Phoenix Core.",
  "shields.loadFailed": "Не удалось прочитать настройки блокировки из Phoenix Core.",
  "shields.global.label": "Блокировать рекламу и трекеры",
  "shields.global.hint":
    "Если выключено, ни один список не применяется ни к одному сайту. Если включено, а списки не загружены, используется короткий встроенный список известных рекламных и аналитических хостов.",
  "shields.lists.title": "Списки фильтров",
  "shields.lists.note":
    "Списки не входят в Phoenix и никогда не загружаются сами. Нажатие «Обновить» один раз обращается к easylist.to, чтобы загрузить этот список. Ничего о вас и ваших страницах не отправляется.",
  "shields.list.purpose.ads": "Блокирует рекламу",
  "shields.list.purpose.trackers": "Блокирует слежку",
  "shields.list.never": "Никогда не загружался.",
  "shields.list.damaged":
    "Сохранённая копия повреждена и не используется. Нажмите «Обновить», чтобы загрузить её снова.",
  "shields.list.status":
    "Загружен {date} · правил блокировки: {rules} · правил для элементов страницы пропущено: {cosmetic}",
  "shields.list.version": "Версия списка {version}",
  "shields.list.due":
    "Список советует искать новую версию после {date}. Phoenix никогда не проверяет сам.",
  "shields.list.licence": "Лицензия: {licence}. Указание авторства: {attribution}.",
  "shields.list.source": "Обновление обращается к {source}",
  "shields.list.enable": "Использовать {name}",
  "shields.list.enableNeedsDownload": "Загрузите список, прежде чем включать его.",
  "shields.list.update": "Обновить",
  "shields.list.updateFirst": "Загрузить",
  "shields.list.updating": "Загрузка…",
  "shields.list.updated": "{name} обновлён.",
  "shields.list.remove": "Удалить загруженную копию",
  "shields.list.removed": "Загруженная копия {name} удалена.",
  "shields.sites.title": "Сайты с выключенной блокировкой",
  "shields.sites.empty": "Ни у одного сайта блокировка не выключена.",
  "shields.sites.add.label": "Название сайта, например example.com",
  "shields.sites.add.submit": "Выключить блокировку для этого сайта",
  "shields.sites.remove": "Снова включить блокировку для {site}",
  "shields.sites.hint":
    "Вводите только название сайта, не адрес. Сайт и его поддомены включены. Собственная реклама YouTube не трогается, пока разрешён музыкальный сайт YouTube; это задаётся в музыкальных сайтах, а не здесь.",
};
