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
  "shell.app.noToken": "У этой страницы нет токена сессии. Откройте Phoenix по адресу, который выводит <code>pnpm dev:core</code>.",
  "shell.app.hint": "Нажмите на Fawkes в верхней панели, чтобы увидеть, что делает Phoenix.",
  "shell.language.title": "Язык",
  "shell.language.label": "Язык интерфейса",
  "shell.language.available": "{count, plural, one {Доступен # язык.} few {Доступно # языка.} many {Доступно # языков.} other {Доступно # языка.}}",
  "shell.language.machineNote": "Тексты на языках, кроме английского, переведены машиной и ещё не проверены носителями языка.",
  "shell.language.saved": "Язык изменён.",
  "shell.language.failed": "Не удалось сохранить язык. Повторите попытку.",
};
