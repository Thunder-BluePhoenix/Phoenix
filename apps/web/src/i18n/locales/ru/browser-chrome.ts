// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserChrome as enBrowserChrome } from "../../en/browser-chrome";

/** Machine-translated; unreviewed. */
export const browserChrome: Record<keyof typeof enBrowserChrome, string> = {
  "browser.find.open": "Найти на странице",
  "browser.find.label": "Найти на странице",
  "browser.find.placeholder": "Найти на странице",
  "browser.find.next": "Следующее совпадение",
  "browser.find.prev": "Предыдущее совпадение",
  "browser.find.close": "Закрыть поиск",
  "browser.find.searching": "Поиск…",
  "browser.find.found": "Найдено на этой странице.",
  "browser.find.notFound": "На этой странице не найдено.",
  "browser.find.tooLong": "Текст поиска может содержать не более {max} символов.",
  "browser.find.control": "Текст поиска не может содержать управляющие символы.",
  "browser.find.bidi": "Текст поиска не может содержать символы управления направлением текста.",
  "browser.find.failed": "Не удалось выполнить поиск на этой странице.",
  "browser.find.bad_query": "Браузер отклонил этот текст поиска.",
  "browser.find.unknown_tab": "Этой вкладки больше нет.",
  "browser.find.no_page": "Пока нет страницы для поиска.",
  "browser.permission.title": "Страница запрашивает разрешение",
  "browser.permission.origin": "Сайт: {origin}",
  "browser.permission.asks": "Хочет использовать: {permission}",
  "browser.permission.allow": "Разрешить один раз",
  "browser.permission.deny": "Запретить",
  "browser.permission.countdown":
    "Будет автоматически запрещено через {seconds, plural, one {# секунду} few {# секунды} many {# секунд} other {# секунды}}.",
  "browser.permission.more":
    "{count, plural, one {Ещё # запрос ожидает} few {Ещё # запроса ожидают} many {Ещё # запросов ожидают} other {Ещё # запроса ожидают}}",
  "browser.permission.kind.microphone": "микрофон",
  "browser.permission.kind.camera": "камеру",
  "browser.permission.kind.geolocation": "ваше местоположение",
  "browser.permission.kind.notifications": "уведомления",
  "browser.permission.kind.clipboard-read": "чтение буфера обмена",
  "browser.permission.kind.display-capture": "ваш экран",
  "browser.permission.kind.midi": "устройства MIDI",
  "browser.permission.kind.sensors": "датчики движения и другие",
  "browser.permission.kind.media-key-system-access": "защищённый (DRM) контент",
  "browser.permission.kind.local-fonts": "шрифты, установленные на этом компьютере",
  "browser.permission.kind.window-management": "ваши экраны и окна",
  "browser.permission.kind.pointer-lock": "указатель мыши",
  "browser.permission.kind.automatic-downloads": "несколько загрузок сразу",
  "browser.permission.kind.file-system-access": "файлы на этом компьютере",
  "browser.permission.kind.autoplay": "автоматическое воспроизведение звука",
  "browser.permission.kind.other": "что-то другое",
  "browser.corner.noShell": "Нет соединения с настольным приложением Phoenix.",
  "browser.corner.noTab": "Нет открытых вкладок.",
  "browser.corner.loading": "Страница загружается.",
  "browser.corner.idle": "Страница загружена.",
  "browser.corner.permission": "Страница запрашивает разрешение. Пожалуйста, ответьте.",
  "browser.corner.shieldsOff": "Блокировка рекламы и трекеров отключена на {site}.",
  "browser.corner.blocked":
    "{count, plural, one {# запрос заблокирован на этой странице.} few {# запроса заблокировано на этой странице.} many {# запросов заблокировано на этой странице.} other {# запроса заблокировано на этой странице.}}",
  "browser.corner.setting":
    "Показывать Fawkes в углу браузера Phoenix (только настольное приложение)",
  "browser.corner.settingHint":
    "Включено по умолчанию. Маленький Fawkes на панели инструментов браузера показывает, загружается ли страница, запрашивается ли разрешение, отключена ли блокировка и выполнялся ли поиск. Он никогда не появляется внутри веб-страницы.",
};
