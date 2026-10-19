// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shell as enShell } from "../../en/shell";

/** Machine-translated; unreviewed (see ../../README.md). */
export const shell: Record<keyof typeof enShell, string> = {
  "shell.nav.home": "Главная Phoenix",
  "shell.nav.main": "Основная",
  "shell.nav.meetings": "Встречи",
  "shell.nav.provenance": "Происхождение",
  "shell.nav.agents": "Агенты",
  "shell.nav.workflows": "Рабочие процессы",
  "shell.nav.recap": "Итоги",
  "shell.nav.settings": "Настройки",
  "shell.nav.recording": "Запись",
  "shell.app.skipToContent": "Перейти к содержимому",
  "shell.app.tagline": "Phoenix — это платформа. Fawkes — это питомец.",
  "shell.app.noToken":
    "У этой страницы нет токена сессии. Откройте Phoenix по адресу, который выводит {command}.",
  "shell.app.hint": "Нажмите на Fawkes в верхней панели, чтобы увидеть, что делает Phoenix.",
  "shell.language.title": "Язык",
  "shell.language.label": "Язык интерфейса",
  "shell.language.available":
    "{count, plural, one {Доступен # язык.} few {Доступно # языка.} many {Доступно # языков.} other {Доступно # языка.}}",
  "shell.language.machineNote":
    "Тексты на языках, кроме английского, переведены машиной и ещё не проверены носителями языка.",
  "shell.language.saved": "Язык изменён.",
  "shell.language.failed": "Не удалось сохранить язык. Повторите попытку.",

  "shell.palette.title": "Палитра команд",
  "shell.palette.inputLabel": "Поиск команд",
  "shell.palette.placeholder": "Введите команду…",
  "shell.palette.results": "Команды",
  "shell.palette.hint": "Стрелки вверх и вниз выбирают, Enter запускает, Escape закрывает.",
  "shell.palette.count":
    "{count, plural, one {# команда} few {# команды} many {# команд} other {# команды}}",
  "shell.palette.empty": "Нет команды, подходящей к «{query}».",

  "shell.cmd.palette.open": "Открыть палитру команд",
  "shell.cmd.nav.home": "Перейти на главную",
  "shell.cmd.nav.meetings": "Перейти во Встречи",
  "shell.cmd.nav.provenance": "Перейти в Происхождение",
  "shell.cmd.nav.agents": "Перейти в Агенты",
  "shell.cmd.nav.workflows": "Перейти в Рабочие процессы",
  "shell.cmd.nav.recap": "Перейти в Итоги",
  "shell.cmd.nav.settings": "Перейти в Настройки",
  "shell.cmd.settings.language": "Открыть настройки: Язык",
  "shell.cmd.panel.overview": "Панель Fawkes: Обзор",
  "shell.cmd.panel.chat": "Панель Fawkes: Чат",
  "shell.cmd.panel.activity": "Панель Fawkes: Активность",
  "shell.cmd.panel.capabilities": "Панель Fawkes: Возможности",
  "shell.cmd.panel.memory": "Панель Fawkes: Память",
  "shell.cmd.panel.wardrobe": "Открыть Гардероб",
  "shell.cmd.demo.start": "Запустить демо",
  "shell.cmd.demo.stop": "Остановить демо",
  "shell.cmd.mute.toggle": "Выключить или включить звуки и уведомления",

  "shell.shortcuts.title": "Глобальные сочетания клавиш",
  "shell.shortcuts.desktopOnly":
    "Глобальные сочетания клавиш — функция настольного приложения Phoenix. В браузере они недоступны.",
  "shell.shortcuts.intro":
    "Глобальные сочетания клавиш работают в любом приложении, пока запущено настольное приложение Phoenix.",
  "shell.shortcuts.loading": "Загрузка сочетаний клавиш…",
  "shell.shortcuts.loadFailed": "Не удалось прочитать сочетания клавиш из настольного приложения.",
  "shell.shortcuts.enable": "Включить глобальные сочетания клавиш",
  "shell.shortcuts.warning":
    "Внимание: пока глобальные сочетания клавиш включены, каждое из них отнимает свою комбинацию клавиш у всех остальных приложений. По умолчанию они выключены. Каждому сочетанию нужно минимум две клавиши-модификатора (Ctrl, Alt, Shift или Cmd), чтобы оно не мешало обычному набору текста.",
  "shell.shortcuts.mute": "Выключить звуки и уведомления",
  "shell.shortcuts.muteHelp":
    "Fawkes по-прежнему показывает, что делает; отключаются только его звуки и всплывающие уведомления.",
  "shell.shortcuts.list": "Действия сочетаний клавиш",
  "shell.shortcuts.action.open_chat": "Открыть чат",
  "shell.shortcuts.action.jump_to_alert": "Перейти к оповещению",
  "shell.shortcuts.action.jump_to_terminal": "Перейти к терминалу",
  "shell.shortcuts.action.switch_pills": "Переключить метки",
  "shell.shortcuts.action.mute": "Выключить звуки и уведомления",
  "shell.shortcuts.action.send_to_desktop": "Отправить Fawkes на рабочий стол",
  "shell.shortcuts.action.wardrobe": "Открыть Гардероб",
  "shell.shortcuts.binding.none": "Не задано",
  "shell.shortcuts.default": "По умолчанию: {keys}",
  "shell.shortcuts.state.active": "Активно",
  "shell.shortcuts.state.off": "Не активно: глобальные сочетания клавиш выключены",
  "shell.shortcuts.state.unbound": "Не активно: комбинация клавиш не задана",
  "shell.shortcuts.state.rejected": "Не активно: эта комбинация клавиш не разрешена",
  "shell.shortcuts.state.unavailable":
    "Не активно: возможно, эту комбинацию клавиш уже использует другое приложение, или система её не разрешает",
  "shell.shortcuts.changeFor": "Изменить сочетание клавиш для «{action}»",
  "shell.shortcuts.capture": "Нажмите новую комбинацию клавиш",
  "shell.shortcuts.captureFor": "Новая комбинация клавиш для «{action}»",
  "shell.shortcuts.captureHelp": "Нажмите клавиши одновременно. Escape отменяет.",
  "shell.shortcuts.resetFor": "Сбросить сочетание клавиш для «{action}» к значению по умолчанию",
  "shell.shortcuts.resetAll": "Сбросить все сочетания клавиш",
  "shell.shortcuts.saved": "Сочетание клавиш для «{action}» теперь {keys}.",
  "shell.shortcuts.resetDone": "Сочетание клавиш для «{action}» сброшено.",
  "shell.shortcuts.resetAllDone": "Все сочетания клавиш сброшены.",
  "shell.shortcuts.reason.invalid": "Это недопустимое сочетание клавиш.",
  "shell.shortcuts.reason.unsupportedKey":
    "Эту клавишу использовать нельзя. Используйте букву, цифру, клавишу F или стрелку вместе с клавишами-модификаторами.",
  "shell.shortcuts.reason.needs_modifiers":
    "Сочетанию нужно минимум две клавиши-модификатора (Ctrl, Alt, Shift или Cmd), чтобы оно не перехватывало обычный набор текста.",
  "shell.shortcuts.reason.needs_third_modifier":
    "На многих клавиатурах Ctrl+Alt и Alt+Shift с буквой или цифрой вводят символы (AltGr или Option). Добавьте третий модификатор.",
  "shell.shortcuts.reason.reserved": "Эту комбинацию клавиш уже использует система.",
  "shell.shortcuts.reason.dictation_chord":
    "Эта комбинация клавиш используется для диктовки (повторная вставка).",
  "shell.shortcuts.reason.conflict":
    "Эту комбинацию клавиш уже использует другое сочетание Phoenix.",
  "shell.shortcuts.reason.unavailable":
    "Система не зарегистрировала эту комбинацию клавиш. Возможно, её уже использует другое приложение.",
  "shell.shortcuts.reason.forbidden": "Это окно не может менять сочетания клавиш.",
  "shell.shortcuts.reason.unknown_action": "Это не действие сочетания клавиш.",
  "shell.shortcuts.reason.unknown": "Не удалось изменить сочетание клавиш.",
};
