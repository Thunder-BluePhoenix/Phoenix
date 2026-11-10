// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { capabilityLabels as enCapabilityLabels } from "../../en/capability-labels";

/** Machine-translated; unreviewed. */
export const capabilityLabels: Record<keyof typeof enCapabilityLabels, string> = {
  "capabilityLabels.kage.name": "Kage",
  "capabilityLabels.kage.description": "Запись встреч, расшифровки и сводки с вашего сервера Kage.",
  "capabilityLabels.git.name": "Git",
  "capabilityLabels.git.description":
    "Следит за коммитами, ветками и конфликтами в выбранных локальных репозиториях.",
  "capabilityLabels.github.name": "GitHub",
  "capabilityLabels.github.description":
    "Pull request'ы, запросы на ревью, запуски Actions и деплои выбранных репозиториев.",
  "capabilityLabels.vercel.name": "Vercel",
  "capabilityLabels.vercel.description": "Деплои Vercel из вашего аккаунта или команды.",
  "capabilityLabels.stripe.name": "Stripe",
  "capabilityLabels.stripe.description":
    "Последние платежи Stripe и сводка только для чтения: количество, суммы и баланс.",
  "capabilityLabels.n8n.name": "n8n",
  "capabilityLabels.n8n.description": "Выполнения рабочих процессов в вашем n8n.",
  "capabilityLabels.resend.name": "Resend",
  "capabilityLabels.resend.description":
    "Статус доставки писем, отправленных из вашего аккаунта Resend.",
  "capabilityLabels.notion.name": "Notion",
  "capabilityLabels.notion.description":
    "Сообщает Fawkes, когда изменяется страница или база данных Notion из вашего списка.",
  "capabilityLabels.calcom.name": "Cal.com",
  "capabilityLabels.calcom.description":
    "Ближайшие бронирования Cal.com с напоминанием незадолго до начала.",
  "capabilityLabels.calendar.name": "Учёт календаря",
  "capabilityLabels.calendar.description":
    "Ближайшие встречи и периоды заморозки деплоев, только для чтения.",
  "capabilityLabels.spotify.name": "Spotify",
  "capabilityLabels.spotify.description":
    "Что играет в приложении Spotify на компьютере, и управление воспроизведением в macOS.",
  "capabilityLabels.apple-music.name": "Apple Music",
  "capabilityLabels.apple-music.description":
    "Что играет в приложении «Музыка», и управление воспроизведением в macOS.",
  "capabilityLabels.mpris.name": "Медиаплееры Linux (MPRIS)",
  "capabilityLabels.mpris.description":
    "Что играет в локальном медиаплеере, и управление воспроизведением в Linux и Windows.",
  "capabilityLabels.portfolio.name": "Портфель",
  "capabilityLabels.portfolio.description":
    "Крипто-портфель только для чтения: балансы публичных адресов и бирж.",
  "capabilityLabels.terminal.name": "Терминал",
  "capabilityLabels.terminal.description":
    "Показывает команды, запущенные через phoenix run, при их старте и завершении.",
  "capabilityLabels.docker.name": "Docker",
  "capabilityLabels.docker.description":
    "Следит за локальными контейнерами Docker: запуски, остановки, сбои и неудачные проверки состояния.",
  "capabilityLabels.frappe.name": "Frappe / ERPNext",
  "capabilityLabels.frappe.description":
    "Следит за состоянием локальных сайтов Frappe и создаёт задачу после вашего подтверждения.",
  "capabilityLabels.machine.name": "Состояние машины и локальные модели",
  "capabilityLabels.machine.description":
    "Состояние локальных ресурсов и управление локальными моделями.",
  "capabilityLabels.agents.name": "Кодинг-агенты",
  "capabilityLabels.agents.description":
    "Показывает, работают ли кодинг-агенты, ждут, завершили или потерпели неудачу, и запускает или останавливает их с вашего подтверждения.",
  "capabilityLabels.awake.name": "Не засыпать",
  "capabilityLabels.awake.description":
    "Не даёт компьютеру уснуть в течение заданного времени, с защитными порогами.",
  "capabilityLabels.issues.name": "Трекеры задач",
  "capabilityLabels.issues.description":
    "Сообщает Fawkes, когда задача в GitHub, Linear или Jira назначена вам или изменилась.",
  "capabilityLabels.plans.name": "Контекст для ревью планов",
  "capabilityLabels.plans.description":
    "Сводный контекст только для чтения для консультативного ревью инженерного плана.",
  "capabilityLabels.ports.name": "Радар портов и процессов",
  "capabilityLabels.ports.description":
    "Показывает прослушиваемые TCP-порты и их процессы и отмечает забытые или тяжёлые dev-серверы.",
  "capabilityLabels.screen-region.name": "Захват области экрана",
  "capabilityLabels.screen-region.description":
    "Позволяет выделить область экрана и после подтверждения возвращает её как изображение.",
  "capabilityLabels.browser.name": "Действия в браузере Phoenix",
  "capabilityLabels.browser.description":
    "Позволяет Fawkes действовать в активной вкладке браузера Phoenix, по одному подтверждённому действию.",
  "capabilityLabels.web-search.name": "Веб-поиск",
  "capabilityLabels.web-search.description":
    "Отправляет короткий текстовый запрос в цепочку поисковых провайдеров и возвращает заголовки, ссылки и фрагменты.",
  "capabilityLabels.status-lights.name": "Индикаторы статуса и Stream Deck",
  "capabilityLabels.status-lights.description":
    "Показывает, что делает Fawkes, на выбранных вами лампах и позволяет отвечать на запросы подтверждения через Stream Deck.",
  "capabilityLabels.chat-approvals.name": "Подтверждения в чате",
  "capabilityLabels.chat-approvals.description":
    "Отправляет карточки подтверждения в Slack и Discord и позволяет отвечать на них владельцу из списка разрешённых.",
  "capabilityLabels.capture-microphone.name": "Запись с микрофона",
  "capabilityLabels.capture-microphone.description":
    "Позволяет выбрать запись с микрофона для локальной обработки ИИ, с подтверждением каждый раз.",
  "capabilityLabels.capture-screen.name": "Захват экрана",
  "capabilityLabels.capture-screen.description":
    "Позволяет выбрать захват экрана для локальной обработки ИИ, с подтверждением каждый раз.",
  "capabilityLabels.mock.name": "Имитация",
  "capabilityLabels.mock.description":
    "Воспроизводит демо-сценарии, чтобы вы увидели реакцию Fawkes (только для разработки).",
  "capabilityLabels.field.base_url": "Адрес сервера",
  "capabilityLabels.field.poll_ms": "Проверять каждые (мс)",
  "capabilityLabels.field.bot_path": "Путь к боту Kage",
  "capabilityLabels.field.bot_name": "Отображаемое имя бота",
  "capabilityLabels.field.max_duration_min": "Максимальная длительность записи (мин)",
  "capabilityLabels.field.git.repositories": "Репозитории (один абсолютный путь на строку)",
  "capabilityLabels.field.github.repositories": "Репозитории (один owner/name на строку)",
  "capabilityLabels.field.api_url": "Адрес API GitHub",
  "capabilityLabels.field.team_id": "ID команды",
  "capabilityLabels.field.project": "Проект (имя или id)",
  "capabilityLabels.field.remind_minutes": "Напоминать за столько минут до брони (0 = выкл.)",
  "capabilityLabels.field.google": "Google Calendar",
  "capabilityLabels.field.microsoft": "Microsoft Calendar",
  "capabilityLabels.field.caldav": "CalDAV",
  "capabilityLabels.field.macos": "Календарь macOS",
  "capabilityLabels.field.caldav_url": "Адрес календаря CalDAV",
  "capabilityLabels.field.caldav_timezone": "Часовой пояс CalDAV",
  "capabilityLabels.field.freeze": "Блокировать деплои во время событий заморозки деплоев",
  "capabilityLabels.field.player": "Медиаплеер",
  "capabilityLabels.field.price_url": "Адрес сервиса цен",
  "capabilityLabels.field.socket_path": "Путь к сокету Docker",
  "capabilityLabels.field.benches": "Frappe bench'и (один абсолютный путь на строку)",
  "capabilityLabels.field.timeout_ms": "Тайм-аут запроса (мс)",
  "capabilityLabels.field.include_prompt_title": "Показывать краткий заголовок из запроса",
  "capabilityLabels.field.silent_after_min": "Забывать молчащую сессию через (мин)",
  "capabilityLabels.field.max_sessions": "Максимум одновременных сессий",
  "capabilityLabels.field.max_runtime_min": "Максимальная длительность сессии (мин)",
  "capabilityLabels.field.grace_ms":
    "Отсрочка перед принудительным завершением остановленного агента (мс)",
  "capabilityLabels.field.battery_floor_percent": "Порог батареи (%)",
  "capabilityLabels.field.floors_enabled": "Пороги батареи и нагрева",
  "capabilityLabels.field.floor_low_power_percent": "Режим энергосбережения при заряде ниже (%)",
  "capabilityLabels.field.floor_end_percent": "Завершить сессию при заряде ниже (%)",
  "capabilityLabels.field.floor_thermal_low_power": "Режим энергосбережения при уровне нагрева",
  "capabilityLabels.field.floor_thermal_end": "Завершить сессию при уровне нагрева",
  "capabilityLabels.field.ports.watch": "Обновлять список в фоне",
  "capabilityLabels.field.forgotten_after_hours": "Считать dev-сервер забытым через (ч)",
  "capabilityLabels.field.heavy_cpu_percent": "Нагрузка процесса на CPU (%)",
  "capabilityLabels.field.heavy_memory_mb": "Память процесса (МБ)",
  "capabilityLabels.field.restart_roots": "Папки для перезапуска (один абсолютный путь на строку)",
  "capabilityLabels.field.searxng_url": "Адрес SearXNG",
  "capabilityLabels.field.devices": "Лампы, на которые вы согласны (один id на строку)",
  "capabilityLabels.field.speed": "Скорость воспроизведения",
  "capabilityLabels.field.projects": "Проекты, доступные для ответа из чата (по одному на строку)",
  "capabilityLabels.field.phoenix_confirmations": "Отвечать на подтверждения Phoenix из чата",
  "capabilityLabels.field.token_ttl_seconds": "Срок действия кнопки (секунды)",
};
