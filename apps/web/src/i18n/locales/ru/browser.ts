// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browser as enBrowser } from "../../en/browser";

/** Machine-translated; unreviewed. */
export const browser: Record<keyof typeof enBrowser, string> = {
  "browser.tabs.label": "Вкладки",
  "browser.tab.untitled": "Новая вкладка",
  "browser.tab.loading": "Загрузка",
  "browser.tab.close": "Закрыть вкладку {title}",
  "browser.tab.new": "Новая вкладка",
  "browser.nav.back": "Назад",
  "browser.nav.forward": "Вперёд",
  "browser.nav.reload": "Обновить",
  "browser.address.label": "Адрес или поиск",
  "browser.address.placeholder": "Введите запрос или адрес",
  "browser.address.go": "Перейти",
  "browser.address.blocked": "Не открыто: {text}",
  "browser.deny.unparseable": "Это не допустимый веб-адрес.",
  "browser.deny.scheme_not_allowed": "Можно открывать только защищённые веб-адреса (https).",
  "browser.deny.dangerous_scheme":
    "Адреса, которые выполняют код или содержат саму страницу, открыть нельзя.",
  "browser.deny.file_blocked": "Файлы на этом компьютере здесь открыть нельзя.",
  "browser.deny.credentials_in_url": "Адреса с именем пользователя или паролем отклоняются.",
  "browser.deny.private_network":
    "Адреса этого компьютера или вашей локальной сети здесь вводить нельзя. Откройте страницу программы через радар портов.",
  "browser.deny.bad_port": "Этот порт заблокирован, так как принадлежит не веб-службе.",
  "browser.deny.insecure_blocked": "Обычные адреса http не открываются.",
  "browser.deny.site_denied": "Этот сайт в списке блокировки.",
  "browser.deny.dns_private":
    "Это имя указывает на адрес этого компьютера или вашей локальной сети.",
  "browser.deny.port_radar_invalid":
    "Запрос радара портов не был обычной страницей на этом компьютере и был проигнорирован.",
  "browser.deny.unknown": "Этот адрес отклонён.",
  "browser.zoom.label": "Масштаб",
  "browser.zoom.out": "Уменьшить",
  "browser.zoom.in": "Увеличить",
  "browser.zoom.reset": "Сбросить масштаб до {percent}",
  "browser.shields.label": "Блокировать рекламу и трекеры на {site}",
  "browser.shields.saveFailed": "Выбор применён здесь, но не удалось сохранить его в Phoenix Core.",
  "browser.shields.blocked":
    "{count, plural, one {# запрос заблокирован} few {# запроса заблокировано} many {# запросов заблокировано} other {# запроса заблокировано}}",
  "browser.empty": "Нет открытых вкладок. Введите адрес или запрос выше.",
  "browser.noShell":
    "Эта страница — панель инструментов браузера Phoenix. Она работает только в настольном приложении Phoenix.",
  "browser.radar.title": "Открыть программу на этом компьютере?",
  "browser.radar.body":
    "Радар портов просит открыть этот адрес. Это программа, запущенная на этом компьютере, а не сайт, и соединение не зашифровано.",
  "browser.radar.url": "Адрес: {url}",
  "browser.radar.open": "Открыть",
  "browser.radar.cancel": "Отмена",
  "browser.error.action": "Браузер не смог это выполнить.",
};
