// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { serviceGlances as enServiceGlances } from "../../en/service-glances";

/** Machine-translated; unreviewed (see ../../README.md). */
export const serviceGlances: Record<keyof typeof enServiceGlances, string> = {
  "services.glance.heading": "{name}: краткий обзор",
  "services.glance.disabled":
    "{name} выключен. Включите его в разделе «Возможности», чтобы видеть здесь.",
  "services.glance.loading": "Загрузка…",
  "services.glance.error": "Не удалось прочитать данные {name}.",
  "services.glance.stale": "Не удалось обновить {name}; показаны последние данные.",
  "services.glance.unreadable": "{name} вернул данные, которые эта страница не может прочитать.",
  "services.glance.updated": "Обновлено {time}",
  "services.glance.state.unknown": "Неизвестно",
  "services.glance.vercel.notConfigured":
    "Добавьте токен Vercel в настройках, чтобы увидеть развёртывания.",
  "services.glance.vercel.empty": "Развёртываний пока нет.",
  "services.glance.vercel.summary": "Недавние развёртывания: {count}",
  "services.glance.vercel.failed": "С ошибкой: {count}",
  "services.glance.vercel.building": "Выполняются: {count}",
  "services.glance.vercel.state.queued": "В очереди",
  "services.glance.vercel.state.initializing": "Запуск",
  "services.glance.vercel.state.building": "Сборка",
  "services.glance.vercel.state.ready": "Готово",
  "services.glance.vercel.state.error": "Ошибка",
  "services.glance.vercel.state.canceled": "Отменено",
  "services.glance.stripe.notConfigured":
    "Добавьте в настройках ограниченный ключ Stripe только для чтения, чтобы увидеть платежи.",
  "services.glance.stripe.empty": "Недавних платежей нет.",
  "services.glance.stripe.counted": "Учтено последних платежей: {count}",
  "services.glance.stripe.succeeded": "Успешных: {count}",
  "services.glance.stripe.failed": "Неудачных: {count}",
  "services.glance.stripe.pending": "Ожидают: {count}",
  "services.glance.stripe.received": "Получено: {amounts}",
  "services.glance.stripe.failedAmount": "Суммы неудачных: {amounts}",
  "services.glance.stripe.available": "Доступный баланс: {amounts}",
  "services.glance.stripe.pendingBalance": "Баланс в ожидании: {amounts}",
  "services.glance.stripe.privacy":
    "Только суммы и количества. Клиенты и карты никогда не показываются.",
  "services.glance.stripe.state.succeeded": "Успешно",
  "services.glance.stripe.state.failed": "Неудачно",
  "services.glance.stripe.state.pending": "Ожидает",
  "services.glance.stripe.state.refunded": "Возвращён",
  "services.glance.n8n.notConfigured":
    "Укажите адрес n8n и добавьте ключ API в настройках, чтобы увидеть запуски.",
  "services.glance.n8n.empty": "Недавних запусков нет.",
  "services.glance.n8n.summary": "Недавние запуски: {count}",
  "services.glance.n8n.failed": "С ошибкой: {count}",
  "services.glance.n8n.workflows": "Активные рабочие процессы: {active} из {total}",
  "services.glance.n8n.host": "Ключ API отправляется на {host}",
  "services.glance.n8n.state.success": "Успешно",
  "services.glance.n8n.state.error": "Ошибка",
  "services.glance.n8n.state.crashed": "Аварийно завершён",
  "services.glance.n8n.state.running": "Выполняется",
  "services.glance.n8n.state.waiting": "Ожидает",
  "services.glance.n8n.state.new": "В очереди",
};
