// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mission as enmission } from "../../en/mission";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mission: Record<keyof typeof enmission, string> = {
  "mission.title": "Центр управления",
  "mission.nav": "Миссия",
  "mission.note":
    "Токены и стоимость — это то, что сообщают сами агенты. Они не сверяются со счётом провайдера.",
  "mission.sourceMissing":
    "Некоторые сеансы агентов сейчас не удалось прочитать (функция агентов выключена или не отвечает), поэтому на доске могут отсутствовать сеансы.",
  "mission.refresh": "Обновить",
  "mission.loadFailed": "Не удалось загрузить центр управления.",

  "mission.filter.search": "Поиск сеансов",
  "mission.filter.searchPlaceholder": "Агент, проект или ID сеанса",
  "mission.filter.agent": "Агент",
  "mission.filter.project": "Проект",
  "mission.filter.state": "Состояние",
  "mission.filter.all": "Все",
  "mission.filter.clear": "Сбросить фильтры",

  "mission.state.working": "Работает",
  "mission.state.waiting": "Ждёт вас",
  "mission.state.finished": "Завершён",
  "mission.state.stuck": "Завис",
  "mission.reason.permission": "Нужно ваше разрешение",
  "mission.reason.input": "У него есть вопрос к вам",
  "mission.reason.idle": "Простаивает у приглашения",
  "mission.stuck.noReport": "Нет отчёта дольше предела простоя",
  "mission.stuck.safetyStall": "Помечен защитной сетью как зависший",

  "mission.board.title": "Сеансы",
  "mission.board.empty": "Нет сеансов агентов для показа.",
  "mission.board.noMatch": "Нет сеансов, подходящих под фильтры.",
  "mission.column.count":
    "{count, plural, one {# сеанс} few {# сеанса} many {# сеансов} other {# сеанса}}",
  "mission.column.empty": "Нет",

  "mission.card.open": "Подробнее",
  "mission.card.focus": "Перейти к терминалу",
  "mission.card.focused": "Окно терминала выведено на передний план.",
  "mission.card.unnamedProject": "неизвестный проект",
  "mission.card.tokens": "{input} вход, {output} выход",
  "mission.card.noTokens": "Количество токенов не сообщено",
  "mission.card.cost": "Стоимость {cost}",
  "mission.card.costPartial":
    "Стоимость {cost} или больше (у части использования стоимость неизвестна)",
  "mission.card.costUnknown": "Стоимость неизвестна",
  "mission.card.lastSeen": "Последний отклик {ago}",
  "mission.card.steps": "{count, plural, one {# шаг} few {# шага} many {# шагов} other {# шага}}",

  "mission.totals.title": "Токены и стоимость",
  "mission.totals.window":
    "{days, plural, one {Последний # день} few {Последние # дня} many {Последние # дней} other {Последние # дня}}",
  "mission.totals.input": "Входные токены",
  "mission.totals.output": "Выходные токены",
  "mission.totals.cost": "Стоимость",
  "mission.totals.unknown": "неизвестно",
  "mission.totals.partial": "{cost} или больше",
  "mission.totals.unpriced":
    "Цена не задана для: {models}. Их стоимость неизвестна, а не нулевая. Добавьте цену ниже, чтобы увидеть стоимость.",
  "mission.totals.empty": "За этот период ни один агент не сообщил о токенах или стоимости.",

  "mission.by.day": "По дням",
  "mission.by.agent": "По агентам",
  "mission.by.project": "По проектам",
  "mission.by.session": "По сеансам",
  "mission.col.day": "День",
  "mission.col.agent": "Агент",
  "mission.col.project": "Проект",
  "mission.col.session": "Сеанс",
  "mission.col.input": "Вход",
  "mission.col.output": "Выход",
  "mission.col.cost": "Стоимость",

  "mission.budgets.title": "Бюджеты",
  "mission.budgets.note":
    "Оповещение приходит до достижения лимита, при {thresholds} от него, один раз в день на каждый бюджет. Бюджеты стоимости учитывают только использование с известной стоимостью.",
  "mission.budgets.none": "Бюджетов пока нет.",
  "mission.budgets.line": "{scope}, {metric}{agent}: {used} из {limit} ({pct}%)",
  "mission.budgets.lineUnknown":
    "{scope}, {metric}{agent}: использование неизвестно, лимит {limit}",
  "mission.budgets.lineAtLeast":
    "{scope}, {metric}{agent}: не менее {used} из {limit} ({pct}%); часть использования без известной стоимости не учтена",
  "mission.ingest.notice":
    "Сегодня Core урезал до лимита {clamped, plural, one {# отчёт} few {# отчёта} many {# отчётов} other {# отчёта}} и отклонил {refused, plural, one {# отчёт} few {# отчёта} many {# отчётов} other {# отчёта}}, поэтому цифры ниже могут быть меньше сообщённых агентами. Агенты: {agents}.",
  "mission.budgets.agentSuffix": " ({agent})",
  "mission.budgets.scope": "Применяется к",
  "mission.budgets.scope.daily": "Всему дню",
  "mission.budgets.scope.session": "Каждому сеансу",
  "mission.budgets.metric": "Измеряется в",
  "mission.budgets.metric.tokens": "Токенах",
  "mission.budgets.metric.cost": "Долларах США",
  "mission.budgets.limit": "Лимит",
  "mission.budgets.agent": "Агент (необязательно)",
  "mission.budgets.add": "Добавить бюджет",
  "mission.budgets.remove": "Удалить бюджет {id}",
  "mission.budgets.invalid": "Введите лимит больше нуля.",

  "mission.prices.title": "Цены",
  "mission.prices.note":
    "В Phoenix нет встроенных цен. Введите свои, в долларах США за миллион токенов, под названием модели, которое сообщает агент.",
  "mission.prices.aiNote": "Модели, для которых цена задана и в настройках ИИ: {models}.",
  "mission.prices.none": "Цен пока нет.",
  "mission.prices.model": "Модель",
  "mission.prices.input": "Вход за миллион токенов",
  "mission.prices.output": "Выход за миллион токенов",
  "mission.prices.line": "{model}: {input} вход, {output} выход за миллион токенов",
  "mission.prices.add": "Сохранить цену",
  "mission.prices.remove": "Удалить цену для {model}",
  "mission.prices.invalid": "Введите название модели и две цены, равные нулю или больше.",

  "mission.stall.label": "Помечать активный сеанс зависшим, если за столько минут не было отчёта",
  "mission.stall.save": "Сохранить",

  "mission.keep.label": "Удалять записи об использовании старше этого числа дней (от 7 до 3650)",
  "mission.keep.save": "Сохранить",

  "mission.saved": "Сохранено",
  "mission.delete.button": "Удалить все данные об использовании агентов",
  "mission.delete.warning":
    "Удалить все сохранённые данные о токенах и стоимости? Бюджеты и цены останутся. Это нельзя отменить.",
  "mission.delete.confirm": "Да, удалить",
  "mission.delete.done":
    "{count, plural, one {Удалена # запись} few {Удалено # записи} many {Удалено # записей} other {Удалено # записи}}",
};
