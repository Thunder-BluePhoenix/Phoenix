// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { serviceGlancesB as enServiceGlancesB } from "../../en/service-glances-b";

/** Machine-translated; unreviewed (see ../../README.md). */
export const serviceGlancesB: Record<keyof typeof enServiceGlancesB, string> = {
  "services.glance.resend.notConfigured":
    "Добавьте API-ключ Resend в секреты возможности Resend, чтобы видеть здесь статус доставки.",
  "services.glance.resend.empty": "Недавно отправленных писем для подсчёта нет.",
  "services.glance.resend.summary":
    "{count, plural, one {# недавнее письмо} few {# недавних письма} many {# недавних писем} other {# недавнего письма}}",
  "services.glance.resend.newest": "Последнее: {time}",
  "services.glance.resend.privacy":
    "Только количество. Темы и получатели здесь никогда не показываются.",
  "services.glance.resend.state.delivered": "Доставлено",
  "services.glance.resend.state.inFlight": "В пути",
  "services.glance.resend.state.delayed": "Задержано",
  "services.glance.resend.state.bounced": "Возвращено",
  "services.glance.resend.state.complained": "Отмечено как спам",
  "services.glance.resend.state.failed": "Не удалось",
  "services.glance.resend.state.other": "Другое",

  "services.glance.notion.notConfigured":
    "Добавьте токен интеграции Notion в секреты возможности Notion, чтобы видеть здесь отслеживаемые страницы.",
  "services.glance.notion.empty":
    "Нет отслеживаемых страниц или баз данных. Укажите их по id в настройках возможности Notion.",
  "services.glance.notion.summary":
    "{count, plural, one {# отслеживаемый элемент} few {# отслеживаемых элемента} many {# отслеживаемых элементов} other {# отслеживаемого элемента}}",
  "services.glance.notion.privacy":
    "Только заголовки и время правки. Содержимое страниц никогда не читается.",
  "services.glance.notion.untitled": "Без названия",
  "services.glance.notion.kind.page": "Страница",
  "services.glance.notion.kind.database": "База данных",
  "services.glance.notion.kind.archived": "В архиве",
  "services.glance.notion.edited": "Изменено {time}",
  "services.glance.notion.open": "Открыть в Notion",
  "services.glance.notion.openNamed": "Открыть {title} в Notion",

  "services.glance.calcom.notConfigured":
    "Добавьте API-ключ Cal.com в секреты возможности Cal.com, чтобы видеть здесь свои бронирования.",
  "services.glance.calcom.empty": "Предстоящих бронирований нет.",
  "services.glance.calcom.summary":
    "{count, plural, one {# предстоящее бронирование} few {# предстоящих бронирования} many {# предстоящих бронирований} other {# предстоящего бронирования}}",
  "services.glance.calcom.privacy":
    "Только время и число участников. Имена и адреса электронной почты здесь никогда не показываются.",
  "services.glance.calcom.booking": "Бронирование",
  "services.glance.calcom.status.accepted": "Подтверждено",
  "services.glance.calcom.status.pending": "Ожидает подтверждения",
  "services.glance.calcom.status.other": "Другое",
  "services.glance.calcom.attendees":
    "{count, plural, one {# участник} few {# участника} many {# участников} other {# участника}}",
  "services.glance.calcom.more":
    "{count, plural, one {ещё # бронирование} few {ещё # бронирования} many {ещё # бронирований} other {ещё # бронирования}}",
};
