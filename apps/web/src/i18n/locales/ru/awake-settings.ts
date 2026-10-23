// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { awakeSettings as enAwakeSettings } from "../../en/awake-settings";

/** Machine-translated; unreviewed. */
export const awakeSettings: Record<keyof typeof enAwakeSettings, string> = {
  "awakeSettings.title": "Не засыпать",
  "awakeSettings.intro":
    "Не даёт этому компьютеру заснуть в течение заданного времени, например пока идёт сборка или работает агент. У сеанса всегда есть конец: от 1 минуты до 7 дней.",
  "awakeSettings.approval":
    "Запуск, продление и завершение сеанса сначала запрашивают ваше подтверждение в разделе «Подтверждения». Пока вы не подтвердите, ничего не меняется.",
  "awakeSettings.off": "Функция «Не засыпать» выключена, поэтому сеанс запустить нельзя.",
  "awakeSettings.enable": "Включить «Не засыпать»",
  "awakeSettings.status.title": "Текущий сеанс",
  "awakeSettings.status.idle": "Сеанс не запущен. Компьютер засыпает как обычно.",
  "awakeSettings.status.unreadable": "Не удалось прочитать состояние «Не засыпать».",
  "awakeSettings.status.mode.timed": "(по таймеру)",
  "awakeSettings.status.mode.agents_grace": "(пока работают агенты)",
  "awakeSettings.status.label": "Метка: {label}",
  "awakeSettings.end.button": "Завершить сеанс",
  "awakeSettings.start.title": "Запустить сеанс",
  "awakeSettings.start.durations": "Готовые значения длительности",
  "awakeSettings.start.minutes": "Минуты",
  "awakeSettings.start.label": "Метка (необязательно)",
  "awakeSettings.start.labelInvalid":
    "Метка должна содержать от 1 до {max} символов, без управляющих и невидимых символов.",
  "awakeSettings.start.submit": "Запросить запуск",
  "awakeSettings.outcome.waiting": "Ожидание вашего подтверждения в «Подтверждениях»…",
  "awakeSettings.outcome.succeeded.start": "Подтверждено: сеанс запущен.",
  "awakeSettings.outcome.succeeded.extend": "Подтверждено: к сеансу добавлено время.",
  "awakeSettings.outcome.succeeded.end": "Подтверждено: сеанс завершён.",
  "awakeSettings.outcome.denied": "Вы отклонили запрос, ничего не изменено.",
  "awakeSettings.outcome.blocked": "Включена аварийная остановка, ничего не изменено.",
  "awakeSettings.outcome.timeout":
    "Запрос не был подтверждён вовремя или был отменён, ничего не изменено.",
  "awakeSettings.outcome.failed": "«Не засыпать» не удалось это выполнить: {message}",
};
